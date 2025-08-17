// overlay.js — Theme (system/light/dark) + Rotate + Refresh + Screenshot + Close
(() => {
    const THEME_KEY = "frt_theme_choice"; // per-tab (sessionStorage)

    const STATE = {
        windowId: null,
        deviceName: "Device",
        size: { width: 0, height: 0 },
        theme: "system",
    };

    /* ---------------- Messaging from background ---------------- */
    chrome.runtime.onMessage.addListener((msg) => {
        if (!msg) return;

        if (msg.type === "FRT_OVERLAY_INIT") {
            const { deviceName, windowId, size } = msg.payload || {};
            STATE.windowId  = windowId ?? STATE.windowId;
            STATE.deviceName = deviceName || STATE.deviceName;
            STATE.size = size || STATE.size;

            ensureOverlay();

            // restore theme
            const saved = sessionStorage.getItem(THEME_KEY);
            const mode = saved || "system";
            STATE.theme = mode;
            // set dropdown and apply
            const sel = document.getElementById("frt-theme");
            if (sel) sel.value = mode;
            applyTheme(mode);
        }

        if (msg.type === "FRT_ROTATED_OK") {
            STATE.size = msg.size || STATE.size;
            const t = document.getElementById("frt-title");
            if (t) t.textContent = titleText();
        }

        if (msg.type === "FRT_SHOT_OK") {
            // re-show toolbar after background finishes saving
            const bar = document.getElementById("frt-overlay");
            if (bar) bar.classList.remove("frt-hidden");
        }
    });

    // If we were injected late, ask bg to init us
    chrome.runtime.sendMessage({ type: "FRT_NEED_OVERLAY" });

    /* ---------------- Build UI ---------------- */
    function ensureOverlay() {
        if (document.getElementById("frt-overlay")) return;

        const bar = document.createElement("div");
        bar.id = "frt-overlay";

        const title = document.createElement("div");
        title.id = "frt-title";
        title.className = "title";
        title.textContent = titleText();

        const controls = document.createElement("div");
        controls.className = "controls";

        // Theme select
        const themeSel = document.createElement("select");
        themeSel.id = "frt-theme";
        themeSel.title = "Theme preview";
        ["system","light","dark"].forEach(v => {
            const o = document.createElement("option");
            o.value = v; o.textContent = v[0].toUpperCase() + v.slice(1);
            themeSel.appendChild(o);
        });
        themeSel.addEventListener("change", () => {
            STATE.theme = themeSel.value;
            sessionStorage.setItem(THEME_KEY, STATE.theme);
            applyTheme(STATE.theme);
            // Optional: background may emulate prefers-color-scheme in dev/precision builds
            chrome.runtime.sendMessage({ type: "FRT_THEME", payload: { windowId: STATE.windowId, mode: STATE.theme }});
        });

        // Buttons
        const btnRotate = makeBtn(iconRotate(), "Rotate", () => {
            const next = { width: STATE.size.height, height: STATE.size.width };
            chrome.runtime.sendMessage({ type: "FRT_ROTATE", payload: { windowId: STATE.windowId, size: next } });
            STATE.size = next;
            title.textContent = titleText();
        });

        const btnRefresh = makeBtn(iconRefresh(), "Refresh", () => {
            try { window.location.reload(); } catch {}
            // bg will re-inject overlay after navigation completes
        });

        const btnShot = makeBtn(iconCamera(), "Screenshot", async () => {
            const bar = document.getElementById("frt-overlay");
            if (!bar) return;
            // Hide -> wait 2 frames -> ask bg to capture -> bg will send FRT_SHOT_OK
            bar.classList.add("frt-hidden");
            await nextPaint(); await nextPaint();
            chrome.runtime.sendMessage({
                type: "FRT_SCREENSHOT",
                payload: {
                    windowId: STATE.windowId,
                    deviceName: STATE.deviceName,
                    size: STATE.size,
                    url: location.href
                }
            });
            // Safety: unhide if bg never answers (rare)
            setTimeout(() => bar.classList.remove("frt-hidden"), 2500);
        });

        const btnClose = makeBtn(iconClose(), "Close", () => {
            chrome.runtime.sendMessage({ type: "FRT_CLOSE_WINDOW", payload: { windowId: STATE.windowId } });
        });

        controls.append(themeSel, btnRotate, btnRefresh, btnShot, btnClose);
        bar.append(title, controls);
        document.documentElement.appendChild(bar);
    }

    function makeBtn(svg, label, onClick) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "frt-btn";
        b.title = label;
        b.setAttribute("aria-label", label);
        b.innerHTML = svg;
        b.addEventListener("click", onClick);
        return b;
    }

    function titleText() {
        const portrait = STATE.size.height >= STATE.size.width;
        return `${STATE.deviceName} · ${portrait ? "Portrait" : "Landscape"} · ${STATE.size.width}×${STATE.size.height}`;
    }

    function nextPaint() {
        return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    }

    /* ---------------- Theme logic (Store-safe) ---------------- */
    function applyTheme(mode) {
        const html = document.documentElement;
        const overlay = document.getElementById("frt-overlay");

        // reset first
        html.classList.remove("dark","light");
        html.style.colorScheme = "";
        html.style.filter = "";
        html.removeAttribute("data-frt-filter");
        if (overlay) overlay.classList.remove("frt-invert-cancel");

        if (mode === "system") return;

        if (mode === "light") {
            html.classList.add("light");
            html.style.colorScheme = "light";
            return;
        }

        // dark
        html.classList.add("dark");
        html.style.colorScheme = "dark";
        // Force a visible dark theme even if site ignores prefers-color-scheme:
        html.style.filter = "invert(1) hue-rotate(180deg)";
        html.setAttribute("data-frt-filter", "dark");
        if (overlay) overlay.classList.add("frt-invert-cancel");
    }

    /* ---------------- SVG icons ---------------- */
    function iconRotate(){
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="16 2 21 2 21 7"></polyline>
      <path d="M20.49 15a8 8 0 1 1-2.12-7.88L21 7"></path>
    </svg>`;
    }
    function iconRefresh(){
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`;
    }
    function iconCamera(){
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"></path>
      <circle cx="12" cy="13" r="4"></circle>
    </svg>`;
    }
    function iconClose(){
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>`;
    }
})();
