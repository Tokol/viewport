// background.js — Store build (no debugger)
// Locked preview window + rotation + overlay reinjection
// Exact viewport calibration + strong clamp + watchdog
// Clean screenshots via captureVisibleTab (overlay hides itself first)
// Precision panel: store prefs + ACK; Refresh tab + ACK; Batch open.

const LOCKS = new Map();        // windowId -> { width, height, tabId, deviceName, url, prefs? }
const PREVIEW_TABS = new Map(); // tabId   -> { windowId, deviceName, size }
const guards = new Map();       // windowId -> intervalId
const watchers = new Map();     // windowId -> intervalId

const EPS = 1;
const GUARD_MS = 2000;
const POLL_EVERY = 30;
const WATCH_EVERY = 60;

/* ---------------- messaging ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg?.type) {

        case "OPEN_PREVIEW": {
            const { url, device } = msg.payload || {};
            openLockedWindow(url, device);
            break;
        }

        case "OPEN_PREVIEW_BATCH": {
            const { url, devices } = msg.payload || {};
            if (url && Array.isArray(devices) && devices.length) openBatch(url, devices);
            break;
        }

        // overlay hides itself before calling this
        case "FRT_SHOOT_NOW":
        case "FRT_SCREENSHOT": {
            const { windowId, deviceName, size, url } = msg.payload || {};
            if (windowId) captureNow(windowId, deviceName, size, url);
            break;
        }

        case "FRT_CLOSE_WINDOW": {
            const { windowId } = msg.payload || {};
            if (windowId) chrome.windows.remove(windowId);
            break;
        }

        // Theme message is a no-op in Store build (overlay handles its own theme)
        case "FRT_THEME": {
            break;
        }

        // Rotation: re-calibrate outer window so inner viewport == requested size
        case "FRT_ROTATE": {
            const { windowId, size } = msg.payload || {};
            const lock = windowId ? LOCKS.get(windowId) : null;
            if (!lock) break;

            if (lock.tabId) {
                PREVIEW_TABS.set(lock.tabId, {
                    windowId,
                    deviceName: lock.deviceName,
                    size: { width: size.width, height: size.height }
                });
            }

            calibrateWindowForViewport(windowId, lock.tabId, size.width, size.height, () => {
                if (lock.tabId) {
                    chrome.tabs.sendMessage(lock.tabId, {
                        type: "FRT_ROTATED_OK",
                        windowId,
                        size: { width: size.width, height: size.height }
                    });
                }
            });
            break;
        }

        // Precision sheet → just persist (for Dev build you would apply CDP here)
        case "FRT_PRECISION_APPLY": {
            const { windowId, prefs } = msg.payload || {};
            const lock = windowId ? LOCKS.get(windowId) : null;
            if (lock) { lock.prefs = prefs; LOCKS.set(windowId, lock); }
            sendResponse({ ok: true });
            return true; // async-safe
        }

        // Reload the tab in the preview window
        case "FRT_REFRESH": {
            const { windowId } = msg.payload || {};
            chrome.windows.get(windowId, { populate: true }, (w) => {
                const tabId = w?.tabs?.[0]?.id;
                if (tabId) chrome.tabs.reload(tabId, { bypassCache: false });
                sendResponse({ ok: true });
            });
            return true; // async
        }

        // Overlay asked to be (re)injected
        case "FRT_NEED_OVERLAY": {
            const tabId = sender?.tab?.id;
            if (!tabId) break;
            const ctx = PREVIEW_TABS.get(tabId);
            if (ctx) injectOverlay(ctx.windowId, tabId, ctx.deviceName, ctx.size);
            break;
        }
    }
    return true;
});

/* ---------------- batch open ---------------- */
function openBatch(url, devices) {
    devices.forEach((device, i) => setTimeout(() => openLockedWindow(url, device), i * 60));
}

/* ---------------- screenshots ---------------- */
function captureNow(windowId, deviceName, size, urlStr) {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
        const name = `frt_${safeHost(urlStr)}_${safe(deviceName)}_${size.width}x${size.height}_${stamp()}.png`;
        if (chrome.runtime.lastError || !dataUrl) {
            console.warn("captureVisibleTab failed:", chrome.runtime.lastError);
            chrome.windows.get(windowId, { populate: true }, (w) => {
                const tab = w?.tabs?.[0];
                if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "FRT_SHOT_OK" });
            });
            return;
        }
        chrome.downloads.download({ url: dataUrl, filename: name, saveAs: false }, () => {
            chrome.windows.get(windowId, { populate: true }, (w) => {
                const tab = w?.tabs?.[0];
                if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "FRT_SHOT_OK" });
            });
        });
    });
}

/* ---------------- open window ---------------- */
function openLockedWindow(url, device) {
    const width  = Math.max(100, device.width  | 0);
    const height = Math.max(100, device.height | 0);

    chrome.windows.create(
        { url, type: "popup", width, height, focused: true, state: "normal" },
        (win) => {
            if (!win) return;
            const tabId = win.tabs && win.tabs[0] && win.tabs[0].id;

            LOCKS.set(win.id, { width, height, tabId, deviceName: device.name, url });
            PREVIEW_TABS.set(tabId, { windowId: win.id, deviceName: device.name, size: { width, height } });
            startWatchdog(win.id);

            const onRemoved = (removedId) => {
                if (removedId === win.id) {
                    stopGuard(removedId);
                    stopWatchdog(removedId);
                    const lk = LOCKS.get(removedId);
                    if (lk?.tabId) PREVIEW_TABS.delete(lk.tabId);
                    LOCKS.delete(removedId);
                    chrome.windows.onRemoved.removeListener(onRemoved);
                }
            };
            chrome.windows.onRemoved.addListener(onRemoved);
        }
    );
}

/* ---------------- reinject overlay after nav ---------------- */
chrome.tabs.onUpdated.addListener((updatedTabId, info) => {
    if (info.status !== "complete") return;
    const ctx = PREVIEW_TABS.get(updatedTabId);
    if (!ctx) return;

    calibrateWindowForViewport(ctx.windowId, updatedTabId, ctx.size.width, ctx.size.height, () => {
        injectOverlay(ctx.windowId, updatedTabId, ctx.deviceName, ctx.size);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => { PREVIEW_TABS.delete(tabId); });

/* ---------------- clamp + watchdog ---------------- */
chrome.windows.onBoundsChanged.addListener((windowId) => {
    const lock = LOCKS.get(windowId);
    if (!lock) return;

    chrome.windows.get(windowId, { populate: false }, (w) => {
        if (!w) return;

        if (w.state !== "normal") {
            chrome.windows.update(windowId, { state: "normal", width: lock.width, height: lock.height });
            startGuard(windowId, lock);
            return;
        }
        const bad = Math.abs((w.width ?? 0) - lock.width) > EPS ||
            Math.abs((w.height ?? 0) - lock.height) > EPS;
        if (bad) {
            chrome.windows.update(windowId, { width: lock.width, height: lock.height });
            startGuard(windowId, lock);
        }
    });
});

function startGuard(windowId, lock) {
    stopGuard(windowId);
    const t0 = Date.now();
    const id = setInterval(() => {
        if (Date.now() - t0 > GUARD_MS) return stopGuard(windowId);
        chrome.windows.update(windowId, { state: "normal", width: lock.width, height: lock.height });
    }, POLL_EVERY);
    guards.set(windowId, id);
}
function stopGuard(windowId) {
    const id = guards.get(windowId);
    if (id) { clearInterval(id); guards.delete(windowId); }
}

function startWatchdog(windowId) {
    if (watchers.has(windowId)) return;
    const id = setInterval(() => {
        const lock = LOCKS.get(windowId);
        if (!lock) return stopWatchdog(windowId);
        chrome.windows.get(windowId, { populate: false }, (w) => {
            if (!w) return;
            if (w.state !== "normal") {
                chrome.windows.update(windowId, { state:"normal", width:lock.width, height:lock.height });
                return;
            }
            const badW = Math.abs((w.width ?? 0) - lock.width) > EPS;
            const badH = Math.abs((w.height ?? 0) - lock.height) > EPS;
            if (badW || badH) chrome.windows.update(windowId, { width: lock.width, height: lock.height });
        });
    }, WATCH_EVERY);
    watchers.set(windowId, id);
}
function stopWatchdog(windowId) {
    const id = watchers.get(windowId);
    if (id) { clearInterval(id); watchers.delete(windowId); }
}

/* ---------------- viewport calibration ---------------- */
function measureViewport(tabId, cb) {
    chrome.scripting.executeScript(
        { target: { tabId }, func: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }) },
        (res) => { if (chrome.runtime.lastError || !res || !res[0]) cb && cb(null); else cb && cb(res[0].result); }
    );
}
function calibrateWindowForViewport(windowId, tabId, targetW, targetH, done) {
    chrome.windows.get(windowId, { populate: false }, (w) => {
        if (!w) return done && done();
        const outerW = w.width, outerH = w.height;

        measureViewport(tabId, (vp) => {
            if (!vp) return done && done();
            const newOuterW = Math.max(100, outerW + (targetW - vp.w));
            const newOuterH = Math.max(100, outerH + (targetH - vp.h));
            const close = Math.abs(targetW - vp.w) <= 1 && Math.abs(targetH - vp.h) <= 1;
            if (close) return done && done();

            chrome.windows.update(windowId, { width: Math.round(newOuterW), height: Math.round(newOuterH) }, () => {
                const lock = LOCKS.get(windowId);
                if (lock) { lock.width = Math.round(newOuterW); lock.height = Math.round(newOuterH); LOCKS.set(windowId, lock); }
                setTimeout(() => {
                    measureViewport(tabId, (vp2) => {
                        if (!vp2) return done && done();
                        const dw = targetW - vp2.w, dh = targetH - vp2.h;
                        if (Math.abs(dw) > 1 || Math.abs(dh) > 1) {
                            chrome.windows.get(windowId, { populate: false }, (w2) => {
                                if (!w2) return done && done();
                                const finalW = Math.max(100, w2.width + dw);
                                const finalH = Math.max(100, w2.height + dh);
                                chrome.windows.update(windowId, { width: Math.round(finalW), height: Math.round(finalH) }, () => {
                                    const l2 = LOCKS.get(windowId);
                                    if (l2) { l2.width = Math.round(finalW); l2.height = Math.round(finalH); LOCKS.set(windowId, l2); }
                                    done && done();
                                });
                            });
                        } else { done && done(); }
                    });
                }, 100);
            });
        });
    });
}

/* ---------------- overlay injection ---------------- */
function injectOverlay(windowId, tabId, deviceName, size) {
    chrome.scripting.insertCSS({ target: { tabId }, files: ["styles/overlay.css"] }, () => {
        chrome.scripting.executeScript({ target: { tabId }, files: ["scripts/overlay.js"] }, () => {
            chrome.tabs.sendMessage(tabId, { type: "FRT_OVERLAY_INIT", payload: { deviceName, windowId, size } });
        });
    });
}

/* ---------------- utils ---------------- */
function stamp(){ const d=new Date(), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; }
function safe(s){ return (s||"").replace(/[\\/:*?"<>|]+/g,"_"); }
function safeHost(u){ try { return new URL(u).hostname; } catch { return "site"; } }
