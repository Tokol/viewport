// popup.js — collapsible "Add Device" + delete custom devices + MULTI-SELECT batch open

const STORAGE_KEY = "userDevicesV2";

const currentUrlEl   = document.getElementById("currentUrl");
const statusEl       = document.getElementById("status");
const catalogEl      = document.getElementById("catalog");

// Add Device form refs
const devName        = document.getElementById("devName");
const devWidth       = document.getElementById("devWidth");
const devHeight      = document.getElementById("devHeight");
const addDeviceBtn   = document.getElementById("addDeviceBtn");

// Collapsible IDs for Add Device
const addHeader      = document.getElementById("addHeader");
const addBody        = document.getElementById("addBody");
const addToggle      = document.getElementById("addToggle");

// Multi-select controls
const multiToggle     = document.getElementById("multiToggle");
const openSelectedBtn = document.getElementById("openSelectedBtn");

// Categories & presets (CSS viewport sizes; rotate inside the preview window)
const CATEGORIES = ["iPhone", "Android", "Tablet/iPad", "Desktop/Laptop", "Your Devices"];
const PRESETS = [
    // iPhone
    { name: "iPhone 5/SE (1st gen)", width: 320, height: 568, category: "iPhone" },
    { name: "iPhone 6/7/8/SE(2/3)",  width: 375, height: 667, category: "iPhone" },
    { name: "iPhone 12/13 mini",     width: 360, height: 780, category: "iPhone" },
    { name: "iPhone X/XS/11 Pro",    width: 375, height: 812, category: "iPhone" },
    { name: "iPhone 12/13/14",       width: 390, height: 844, category: "iPhone" },
    { name: "iPhone 12/13/14 Pro Max / 14 Plus", width: 428, height: 926, category: "iPhone" },
    { name: "iPhone 15 Pro",         width: 393, height: 852, category: "iPhone" },
    { name: "iPhone 15 Pro Max",     width: 430, height: 932, category: "iPhone" },

    // Android phones
    { name: "Android – Small (legacy)", width: 360, height: 640, category: "Android" },
    { name: "Android – Common",         width: 360, height: 800, category: "Android" },
    { name: "Pixel 5",                  width: 393, height: 851, category: "Android" },
    { name: "Samsung Galaxy (many)",    width: 412, height: 915, category: "Android" },
    { name: "Pixel 7 Pro",              width: 412, height: 892, category: "Android" },
    { name: "Galaxy Z Fold (inner)",    width: 768, height: 1000, category: "Android" },

    // Tablets / iPad
    { name: "iPad Mini",                width: 768,  height: 1024, category: "Tablet/iPad" },
    { name: "iPad Air / iPad Pro 11\"", width: 834,  height: 1194, category: "Tablet/iPad" },
    { name: "iPad Pro 12.9\"",          width: 1024, height: 1366, category: "Tablet/iPad" },
    { name: "Android Tablet (8\")",     width: 800,  height: 1280, category: "Tablet/iPad" },

    // Desktop / Laptop (landscape)
    { name: "Laptop 13\" (MBA 13)",     width: 1440, height: 900,  category: "Desktop/Laptop" },
    { name: "Laptop 15–16\" (MBP 16)",  width: 1920, height: 1200, category: "Desktop/Laptop" },
    { name: "Desktop Full HD",          width: 1920, height: 1080, category: "Desktop/Laptop" },
    { name: "Desktop 2K (QHD)",         width: 2560, height: 1440, category: "Desktop/Laptop" },
    { name: "Desktop 4K UHD",           width: 3840, height: 2160, category: "Desktop/Laptop" },
    { name: "Ultrawide 34\"",           width: 3440, height: 1440, category: "Desktop/Laptop" },
];

// State
let currentUrl = null;
let userDevices = [];
let multiMode = false;
let selectedKeys = [];
let currentDeviceIndex = new Map();

/* -------------------- boot -------------------- */
document.addEventListener("DOMContentLoaded", () => {
    // Detect current tab URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs && tabs[0] && tabs[0].url;
        if (url && /^https?:\/\//i.test(url)) {
            currentUrl = url;
            currentUrlEl.textContent = url;
        } else {
            currentUrl = null;
            currentUrlEl.textContent =
                "This tab’s URL can’t be used. Open a normal https/http page and reopen the popup.";
        }
        updateStatus();
    });

    // Collapsible Add Device
    if (addBody && addHeader && addToggle) {
        addBody.style.display = "none";
        addHeader.addEventListener("click", () => {
            const open = addBody.style.display === "block";
            addBody.style.display = open ? "none" : "block";
            addToggle.textContent = open ? "▸" : "▾";
        });
    }

    // Multi-select wiring
    if (multiToggle && openSelectedBtn) {
        multiToggle.addEventListener("change", () => {
            multiMode = multiToggle.checked;
            clearSelections();
            updateOpenSelectedBtn();
            updateStatus();
        });
        openSelectedBtn.addEventListener("click", onOpenSelectedBatch);
        updateOpenSelectedBtn();
    }

    loadUserDevices(renderCatalog);
    addDeviceBtn.addEventListener("click", onAddDevice);
});

/* -------------------- storage -------------------- */
function loadUserDevices(cb) {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
        userDevices = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        cb && cb();
    });
}
function saveUserDevices(list, cb) {
    chrome.storage.local.set({ [STORAGE_KEY]: list }, () => cb && cb());
}

/* -------------------- add device -------------------- */
function onAddDevice() {
    const name = (devName.value || "").trim();
    const width = parseInt(devWidth.value, 10);
    const height = parseInt(devHeight.value, 10);

    if (!name) return alert("Please enter a device name.");
    if (!Number.isFinite(width) || width <= 0) return alert("Width must be a positive number.");
    if (!Number.isFinite(height) || height <= 0) return alert("Height must be a positive number.");

    const exists = userDevices.some(
        (d) => d.name.toLowerCase() === name.toLowerCase() && d.width === width && d.height === height
    );
    if (exists) return alert("A device with the same name and size already exists.");

    userDevices.push({ name, width, height, category: "Your Devices", __custom: true });
    saveUserDevices(userDevices, () => {
        devName.value = ""; devWidth.value = ""; devHeight.value = "";
        renderCatalog();
        statusEl.textContent = `Added: ${name} (${width}×${height})`;
        if (addBody && addToggle) { addBody.style.display = "none"; addToggle.textContent = "▸"; }
    });
}

/* -------------------- helpers -------------------- */
function deviceKey(d) {
    return `${d.name}|${d.width}x${d.height}|${d.category || ""}|${d.__custom ? 1 : 0}`;
}
function updateOpenSelectedBtn() {
    if (!openSelectedBtn) return;
    const n = selectedKeys.length;
    openSelectedBtn.disabled = n === 0 || !currentUrl;
    openSelectedBtn.textContent = `Open Selected (${n})`;
}
function clearSelections() {
    selectedKeys = [];
    catalogEl.querySelectorAll(".tile.sel").forEach(t => t.classList.remove("sel"));
}

/* -------------------- batch open -------------------- */
function onOpenSelectedBatch() {
    if (!currentUrl) {
        alert("Active tab URL is not available. Open a standard https/http page.");
        return;
    }
    if (selectedKeys.length === 0) return;

    const devices = [];
    for (const k of selectedKeys) {
        const d = currentDeviceIndex.get(k);
        if (d) devices.push(d);
    }
    if (!devices.length) return;

    statusEl.textContent = `Opening ${devices.length} devices…`;

    chrome.runtime.sendMessage({
        type: "OPEN_PREVIEW_BATCH",
        payload: { url: currentUrl, devices }
    });

    clearSelections();
    updateOpenSelectedBtn();
    updateStatus();
}

/* -------------------- catalog rendering -------------------- */
function renderCatalog() {
    catalogEl.innerHTML = "";
    const all = [...PRESETS, ...userDevices];

    // index for deviceKey -> device
    currentDeviceIndex = new Map();
    all.forEach(d => currentDeviceIndex.set(deviceKey(d), d));

    CATEGORIES.forEach((cat) => {
        const section = document.createElement("div");
        section.className = "section";

        const header = document.createElement("div");
        header.className = "section-header";

        const title = document.createElement("div");
        title.className = "section-title";
        title.textContent = cat;

        const toggle = document.createElement("div");
        toggle.className = "section-toggle";
        toggle.textContent = "▸";

        header.appendChild(title);
        header.appendChild(toggle);

        const body = document.createElement("div");
        body.className = "section-body";

        const grid = document.createElement("div");
        grid.className = "grid";

        const items = all.filter((d) => (d.category || "Your Devices") === cat);
        items.forEach((dev) => grid.appendChild(makeTile(dev)));

        if (cat === "Your Devices" && items.length === 0) {
            const empty = document.createElement("div");
            empty.style.fontSize = "12px";
            empty.style.color = "var(--muted)";
            empty.textContent = "No devices yet. Add one above.";
            body.appendChild(empty);
        }

        body.appendChild(grid);

        // collapsed by default
        body.style.display = "none";
        header.addEventListener("click", () => {
            const open = body.style.display === "block";
            body.style.display = open ? "none" : "block";
            toggle.textContent = open ? "▸" : "▾";
        });

        section.appendChild(header);
        section.appendChild(body);
        catalogEl.appendChild(section);
    });
}

/* -------------------- status line -------------------- */
function updateStatus() {
    if (!currentUrl) {
        statusEl.textContent = "Open a normal https/http page, then reopen the popup.";
        return;
    }
    if (multiMode) {
        const n = selectedKeys.length;
        statusEl.textContent = n
            ? `Selected ${n}. Click “Open Selected”.`
            : "Multi-select is ON. Pick devices, then click “Open Selected”.";
    } else {
        statusEl.textContent = "Click a device to open a preview.";
    }
}

/* -------------------- device tile -------------------- */
function makeTile(device) {
    const tile = document.createElement("div");
    tile.className = "tile";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = device.name;

    const dim = document.createElement("div");
    dim.className = "dim";
    dim.textContent = `${device.width}×${device.height}`;

    tile.appendChild(name);
    tile.appendChild(dim);

    // Open or select on click
    tile.addEventListener("click", (e) => {
        if (e.target.closest(".delete")) return;

        if (multiMode) {
            const key = deviceKey(device);
            const idx = selectedKeys.indexOf(key);
            if (idx >= 0) {
                selectedKeys.splice(idx, 1);
                tile.classList.remove("sel");
            } else {
                selectedKeys.push(key);
                tile.classList.add("sel");
            }
            updateOpenSelectedBtn();
            updateStatus();
            return;
        }

        // single open
        if (!currentUrl) {
            alert("Active tab URL is not available. Open a standard https/http page.");
            return;
        }
        catalogEl.querySelectorAll(".tile.active").forEach((t) => t.classList.remove("active"));
        tile.classList.add("active");
        statusEl.textContent = `Opening: ${device.name} (${device.width}×${device.height})…`;

        chrome.runtime.sendMessage({
            type: "OPEN_PREVIEW",
            payload: { url: currentUrl, device }
        });
    });




    // Delete icon for custom devices
    if (device.__custom) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "delete";
        del.title = "Delete";
        del.ariaLabel = "Delete device";
        del.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
           stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6
                 m3 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>`;
        del.addEventListener("click", (e) => {
            e.stopPropagation();
            const ok = confirm(`Delete "${device.name}"?`);
            if (!ok) return;

            const idx = userDevices.findIndex(d =>
                d.__custom && d.name === device.name && d.width === device.width && d.height === device.height
            );
            if (idx !== -1) {
                userDevices.splice(idx, 1);
                saveUserDevices(userDevices, () => {
                    const key = deviceKey(device);
                    const i2 = selectedKeys.indexOf(key);
                    if (i2 >= 0) selectedKeys.splice(i2, 1);
                    renderCatalog();
                    updateOpenSelectedBtn();
                    updateStatus();
                });
            }
        });
        tile.appendChild(del);
    }

    return tile;
}
