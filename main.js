const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain, dialog, Notification, globalShortcut, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://ogubjsuqdsbdewhwlkit.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ndWJqc3VxZHNiZGV3aHdsa2l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDgxNjIsImV4cCI6MjA5NDQ4NDE2Mn0.YPh-jc0VCf_QYk9v6EbhLNL7wssne-MWR75y7VTkEik";
const APP_URL = "https://www.pufflabs.work/communications";
const HOME_ORIGIN = "https://www.pufflabs.work";
const SCHEME = "pufflabs";
const UPDATE_URL = "https://www.pufflabs.work/desktop/latest.json"; // {version,url}
const DOWNLOAD_PAGE = "https://www.pufflabs.work/download";

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";

app.userAgentFallback = IS_WIN
  ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ---------- settings (local to this Mac, JSON in userData) ---------- */
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
const DEFAULTS = { launchAtLogin: false, runInBackground: true, dockBadge: true, bounce: true, showTrayTimer: true, nativeNotifications: true, notifyDMs: true, notifyMentions: true, notifyChannelWide: true, notifyOther: true, notifPreview: true, notifSilent: false, globalHotkey: true };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) }; } catch (e) { return { ...DEFAULTS }; } }
function saveSettings() { try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch (e) {} }
let settings = DEFAULTS;
let snoozeUntil = 0;
function setSnooze(until) { snoozeUntil = until && until > Date.now() ? until : 0; try { updateTrayMenu(); } catch (e) {} if (snoozeUntil) { try { setTimeout(() => { if (Date.now() >= snoozeUntil) { snoozeUntil = 0; try { updateTrayMenu(); } catch (e) {} } }, (snoozeUntil - Date.now()) + 500); } catch (e) {} } }
function applySettings() { try { app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin }); } catch (e) {} if (!settings.dockBadge && app.dock) app.dock.setBadge(""); }

/* ---------- supabase / login (unchanged bridge) ---------- */
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; }
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: memStorage() } });
let loggingIn = false;
async function startLogin() {
  if (loggingIn) return; loggingIn = true;
  try {
    const { data, error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: SCHEME + "://auth-callback", skipBrowserRedirect: true } });
    if (error || !data || !data.url) { console.error("[auth] url", error); loggingIn = false; return; }
    shell.openExternal(data.url);
  } catch (e) { console.error("[auth] startLogin", e); loggingIn = false; }
}
async function handleDeepLink(url) {
  if (!url || url.indexOf(SCHEME + "://") !== 0) return;
  try {
    const code = new URL(url).searchParams.get("code"); if (!code) { loggingIn = false; return; }
    const { data, error } = await sb.auth.exchangeCodeForSession(code); loggingIn = false;
    if (error || !data || !data.session) { console.error("[auth] exchange", error); return; }
    const at = data.session.access_token, rt = data.session.refresh_token;
    if (!win) createWindow();
    await win.loadURL(HOME_ORIGIN + "/login");
    console.log("[auth] setSession ->", await win.webContents.executeJavaScript("window.pufflabsAuth.setSession(" + JSON.stringify(at) + "," + JSON.stringify(rt) + ")"));
    await win.loadURL(APP_URL); showWindow();
  } catch (e) { console.error("[auth] deeplink", e); }
}

/* ---------- window ---------- */
let win = null, tray = null, prefsWin = null, lastUnread = 0;
let timerState = { running: false, label: "", projectName: "", categoryLabel: "", recent: [], projects: [] };
let lastTrayTitle = null, lastMenuSig = "";
function trayMenuSignature(s) {
  return JSON.stringify({ r: s.running, p: s.projectName, c: s.categoryLabel, t: s.running ? "" : s.label, rec: (s.recent || []).map((x) => x.id + "|" + x.name), ids: (s.projects || []).map((x) => x.id + "|" + x.name) });
}
function stayInApp(u) { try { const x = new URL(u); const h = x.hostname.toLowerCase(); const okHost = (d) => h === d || h.endsWith("." + d); return x.origin === HOME_ORIGIN || okHost("google.com") || okHost("gstatic.com") || okHost("supabase.co"); } catch (e) { return false; } }
function showWindow() { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); }

function createWindow() {
  win = new BrowserWindow({
    ...savedBoundsOrDefault(), minWidth: 900, minHeight: 600, show: true,
    title: "PuffLabs", backgroundColor: "#030408",
    ...(IS_MAC ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 10 } } : { frame: false }),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, spellcheck: true },
  });
  win.loadURL(APP_URL);
  // Custom window controls: the web draws mac-style dots on Windows and needs
  // the maximize state; clear the taskbar flash when the window is focused.
  win.on("maximize", () => { try { win.webContents.send("win:maximized-changed", true); } catch (e) {} });
  win.on("unmaximize", () => { try { win.webContents.send("win:maximized-changed", false); } catch (e) {} });
  win.on("focus", () => { try { win.flashFrame(false); } catch (e) {} });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!stayInApp(url)) { shell.openExternal(url); return { action: "deny" }; }
    // Time-tracker pop-out: open it FRAMELESS like the main window (hidden
    // title bar + traffic lights over the dark UI). The additionalArguments
    // arg lets the web reserve clearance + a drag strip for just this window.
    let timerPip = false;
    try { const u = new URL(url); timerPip = u.pathname.startsWith("/timesheets/timer") || u.searchParams.get("pip") === "1"; } catch (e) {}
    if (timerPip) {
      return { action: "allow", overrideBrowserWindowOptions: {
        backgroundColor: "#0c0a1a", ...(IS_MAC ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 18 } } : { frame: false }),
        webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false, additionalArguments: ["--pufflabs-frameless-popout"] },
      } };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!stayInApp(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on("did-navigate", (_e, url) => { try { if (new URL(url).pathname.startsWith("/login") && !loggingIn) startLogin(); } catch (e) {} });
  // Dock unread badge + bounce on increase (from the "(N) " title the web app sets).
  win.webContents.on("page-title-updated", (_e, title) => {
    const n = parseInt((/^\((\d+)\)/.exec(title || "") || [])[1] || "0", 10);
    if (app.dock && settings.dockBadge) app.dock.setBadge(n ? String(n) : "");
    if (n > lastUnread && settings.bounce && app.dock) app.dock.bounce("informational");
    if (IS_WIN && n > lastUnread && settings.bounce) { try { if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true); } catch (e) {} }
    lastUnread = n;
  });
  // Background mode: closing hides to the menu bar instead of quitting.
  // Hide-on-close so the app keeps running in the tray, but DO NOT toggle
  // the Dock icon: app.dock.hide()/show() re-lays-out the whole Dock every
  // time (the "Finder icon glitches" Leon saw). The Dock icon now stays put.
  win.on("close", (e) => { if (settings.runInBackground && !app.isQuitting) { e.preventDefault(); win.hide(); } });
  win.on("resize", scheduleBoundsSave);
  win.on("move", scheduleBoundsSave);
  win.webContents.on("context-menu", (_e, params) => {
    const items = [];
    for (const sug of (params.dictionarySuggestions || [])) items.push({ label: sug, click: () => { try { win.webContents.replaceMisspelling(sug); } catch (e) {} } });
    if (params.misspelledWord) { if (items.length) items.push({ type: "separator" }); items.push({ label: "Add to Dictionary", click: () => { try { win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord); } catch (e) {} } }, { type: "separator" }); }
    items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
    try { Menu.buildFromTemplate(items).popup(); } catch (e) {}
  });
}

/* ---------- window bounds memory ---------- */
let boundsTimer = null;
function persistBounds() { try { if (win && !win.isDestroyed() && !win.isMinimized()) { settings.windowBounds = win.getBounds(); saveSettings(); } } catch (e) {} }
function scheduleBoundsSave() { if (boundsTimer) clearTimeout(boundsTimer); boundsTimer = setTimeout(persistBounds, 600); }
function savedBoundsOrDefault() { try { const b = settings.windowBounds; if (b && b.width >= 600 && b.height >= 400) return { x: b.x, y: b.y, width: b.width, height: b.height }; } catch (e) {} return { width: 1320, height: 880 }; }

/* ---------- tray (menu bar) ---------- */
function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("PuffLabs · time tracker");
  // No tray.on("click", showWindow): with a context menu, left-click already
  // opens the menu, and showing/focusing the window stole focus from it (the
  // menu kept snapping shut). "Open PuffLabs" in the menu opens the app.
  updateTrayMenu();
}
function trayCommand(payload) {
  if (!win || win.isDestroyed()) createWindow();
  if (win && !win.isDestroyed()) win.webContents.send("tray:command", payload);
  // Only surface the window when STOPPING (the post-stop review modal must be
  // visible). Starting / switching from the tray stays in the background.
  if (payload && payload.action === "stop") showWindow();
}
function updateTrayMenu() {
  if (!tray) return;
  const items = [];
  // Each project opens a submenu to pick the bucket, then starts/switches.
  // NOTE: "&&" renders as a literal "&" (a single "&" is eaten as a mnemonic).
  const catSub = (pr) => [
    { label: "Production", click: () => trayCommand({ action: "start", projectId: pr.id, category: "production" }) },
    { label: "Meetings && training", click: () => trayCommand({ action: "start", projectId: pr.id, category: "meeting" }) },
  ];
  const projects = Array.isArray(timerState.projects) ? timerState.projects : [];
  const recent = Array.isArray(timerState.recent) ? timerState.recent : [];
  if (timerState.running) {
    items.push({ label: "● " + (timerState.projectName || "Tracking") + (timerState.categoryLabel ? "  ·  " + timerState.categoryLabel : ""), enabled: false });
    items.push({ label: "Stop && log", click: () => trayCommand({ action: "stop" }) });
  } else {
    items.push({ label: "Today: " + (timerState.label || "00:00:00"), enabled: false });
    // One-click resume of the last tracked project + its last bucket.
    if (recent.length > 0) {
      items.push({ label: "▶  Start " + recent[0].name, click: () => trayCommand({ action: "start-last" }) });
    }
  }
  items.push({ type: "separator" });
  // Up to 5 projects as a FLAT list in the main view (most-recent first, then
  // filled from the rest). Anything beyond 5 drops into a "More projects"
  // submenu. Each opens its Production / Meetings & training submenu.
  if (projects.length > 0) {
    const recentIds = new Set(recent.map((p) => p.id));
    const rest = projects.filter((p) => !recentIds.has(p.id));
    const mainList = [...recent, ...rest].slice(0, 5);
    const mainIds = new Set(mainList.map((p) => p.id));
    const overflow = projects.filter((p) => !mainIds.has(p.id));
    items.push({ label: timerState.running ? "Switch to" : "Projects", enabled: false });
    for (const pr of mainList) items.push({ label: pr.name, submenu: catSub(pr) });
    if (overflow.length > 0) {
      items.push({ label: "More projects", submenu: overflow.map((pr) => ({ label: pr.name, submenu: catSub(pr) })) });
    }
  } else {
    items.push({ label: "No projects assigned", enabled: false });
  }
  items.push({ type: "separator" });
  { const paused = Date.now() < snoozeUntil; const fmt = (t) => { try { return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }; const tomorrow8 = () => { const d = new Date(); d.setHours(d.getHours() < 8 ? 8 : 32, 0, 0, 0); return d.getTime(); }; items.push({ label: paused ? ("Notifications paused \u00b7 until " + fmt(snoozeUntil)) : "Pause notifications", submenu: paused ? [ { label: "Resume notifications", click: () => setSnooze(0) } ] : [ { label: "For 30 minutes", click: () => setSnooze(Date.now() + 1800000) }, { label: "For 1 hour", click: () => setSnooze(Date.now() + 3600000) }, { label: "Until tomorrow", click: () => setSnooze(tomorrow8()) }, { label: "Until I turn it back on", click: () => setSnooze(Date.now() + 3153600000000) } ] }); }
  items.push({ type: "separator" });
  items.push({ label: "Open PuffLabs", click: showWindow });
  items.push({ label: "Preferences…", accelerator: "CommandOrControl+,", click: openPrefs });
  items.push({ label: "Check for Updates…", click: () => checkForUpdates(false) });
  items.push({ type: "separator" });
  items.push({ label: "Quit PuffLabs", click: () => { app.isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
ipcMain.on("tray:timer", (_e, state) => {
  const next = {
    running: !!(state && state.running),
    label: (state && state.label) || "",
    projectName: (state && state.projectName) || "",
    categoryLabel: (state && state.categoryLabel) || "",
    recent: (state && Array.isArray(state.recent)) ? state.recent : [],
    projects: (state && Array.isArray(state.projects)) ? state.projects : [],
  };
  timerState = next;
  if (!tray) return;
  if (IS_MAC) {
    const title = (settings.showTrayTimer !== false && next.label) ? " " + next.label : "";
    if (title !== lastTrayTitle) { try { tray.setTitle(title); } catch (e) {} lastTrayTitle = title; }
  } else {
    // Windows tray has no title text; surface the running total in the tooltip.
    const tip = next.running ? ("PuffLabs · " + (next.projectName || "tracking") + (next.label ? "  " + next.label : "")) : (next.label ? ("PuffLabs · today " + next.label) : "PuffLabs · time tracker");
    if (tip !== lastTrayTitle) { try { tray.setToolTip(tip); } catch (e) {} lastTrayTitle = tip; }
  }
  const sig = trayMenuSignature(next);
  if (sig !== lastMenuSig) { lastMenuSig = sig; updateTrayMenu(); }
});

/* ---------- preferences window ---------- */
function openPrefs() {
  if (prefsWin) { prefsWin.focus(); return; }
  prefsWin = new BrowserWindow({ width: 720, height: 560, resizable: false, title: "Preferences", backgroundColor: "#0b0c14",
    webPreferences: { preload: path.join(__dirname, "prefs-preload.js"), contextIsolation: true } });
  prefsWin.loadFile("preferences.html");
  prefsWin.on("closed", () => { prefsWin = null; });
}
ipcMain.handle("prefs:get", () => settings);
ipcMain.handle("prefs:set", (_e, patch) => {
  settings = { ...settings, ...patch }; saveSettings(); applySettings(); applyGlobalHotkey();
  // Apply the menu-bar timer visibility immediately (don\u2019t wait for the
  // next push, which only happens on a store change / tick).
  if (tray && IS_MAC) {
    const title = (settings.showTrayTimer !== false && timerState.label) ? " " + timerState.label : "";
    try { tray.setTitle(title); } catch (e) {}
    lastTrayTitle = title;
  }
  return settings;
});
ipcMain.handle("prefs:version", () => app.getVersion());
ipcMain.handle("prefs:check-updates", () => checkForUpdates(false));
ipcMain.on("open-prefs", () => openPrefs());

/* ---------- custom window controls (the web draws mac-style dots on Windows;
   on macOS the OS draws the real traffic lights) ---------- */
ipcMain.on("win:minimize", (e) => { try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); } catch (er) {} });
ipcMain.on("win:maximize", (e) => { try { const w = BrowserWindow.fromWebContents(e.sender); if (w) { if (w.isMaximized()) w.unmaximize(); else w.maximize(); } } catch (er) {} });
ipcMain.on("win:close", (e) => { try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); } catch (er) {} });
ipcMain.handle("win:is-maximized", (e) => { try { const w = BrowserWindow.fromWebContents(e.sender); return !!(w && w.isMaximized()); } catch (er) { return false; } });
ipcMain.handle("prefs:test-notification", () => { try { const n = new Notification({ title: "PuffLabs", body: "Notifications are working. You'll get these for mentions, replies and direct messages." }); n.on("click", () => showWindow()); n.show(); return true; } catch (e) { return false; } });
ipcMain.on("notify:show", (_e, p) => { try { if (settings.nativeNotifications === false) return; if (Date.now() < snoozeUntil) return; if (!p || !p.title) return; { const k = p.kind || ""; const ok = k === "dm" ? settings.notifyDMs !== false : k === "channel_mention" ? settings.notifyMentions !== false : k === "channel_at_channel" ? settings.notifyChannelWide !== false : settings.notifyOther !== false; if (!ok) return; } const body = settings.notifPreview === false ? "New message" : String(p.body || ""); const n = new Notification({ title: String(p.title), body, silent: settings.notifSilent === true }); n.on("click", () => { showWindow(); if (p.url && win && !win.isDestroyed()) win.webContents.send("notify:click", String(p.url)); }); n.show(); } catch (e) {} });

/* ---------- update check (compares to a version file you control) ---------- */
function vGt(a, b) { const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; } return false; }
async function checkForUpdates(silent) {
  try {
    const r = await fetch(UPDATE_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("no feed");
    const j = await r.json();
    if (j && j.version && vGt(j.version, app.getVersion())) {
      const res = await dialog.showMessageBox({ type: "info", buttons: ["Download", "Later"], defaultId: 0, message: "Update available", detail: "PuffLabs " + j.version + " is available (you have " + app.getVersion() + ")." });
      if (res.response === 0) shell.openExternal((IS_WIN ? (j.url_win || j.url) : (j.url_mac || j.url)) || DOWNLOAD_PAGE);
    } else if (!silent) {
      dialog.showMessageBox({ type: "info", message: "You're up to date", detail: "PuffLabs " + app.getVersion() });
    }
  } catch (e) { if (!silent) dialog.showMessageBox({ type: "info", message: "Couldn't check for updates", detail: "Try again later." }); }
}

/* ---------- menu ---------- */
function buildMenu() {
  const tmpl = [];
  if (IS_MAC) {
    tmpl.push({ label: "PuffLabs", submenu: [ { role: "about" }, { label: "Preferences\u2026", accelerator: "CommandOrControl+,", click: openPrefs }, { label: "Check for Updates\u2026", click: () => checkForUpdates(false) }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { label: "Quit", accelerator: "CommandOrControl+Q", click: () => { app.isQuitting = true; app.quit(); } } ] });
  } else {
    tmpl.push({ label: "File", submenu: [ { label: "Preferences\u2026", accelerator: "CommandOrControl+,", click: openPrefs }, { label: "Check for Updates\u2026", click: () => checkForUpdates(false) }, { type: "separator" }, { label: "Quit", accelerator: "CommandOrControl+Q", click: () => { app.isQuitting = true; app.quit(); } } ] });
  }
  tmpl.push({ role: "editMenu" });
  tmpl.push({ label: "View", submenu: [ { label: "Communications", accelerator: "CommandOrControl+1", click: () => { showWindow(); win.loadURL(APP_URL); } }, { label: "Sign in", accelerator: "CommandOrControl+L", click: startLogin }, { type: "separator" }, { role: "reload" }, { role: "forceReload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" } ] });
  tmpl.push({ role: "windowMenu" });
  tmpl.push({ role: "help", submenu: [ { label: "Force Reload (fetch the latest build)", role: "forceReload" }, { label: "Clear Cache && Restart", click: clearCacheAndRestart }, { type: "separator" }, { label: "Check for Updates\u2026", click: () => checkForUpdates(false) }, { type: "separator" }, { label: "PuffLabs Website", click: () => shell.openExternal(HOME_ORIGIN) } ] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(tmpl));
}

async function clearCacheAndRestart() {
  try { const ses = (win && !win.isDestroyed()) ? win.webContents.session : session.defaultSession; await ses.clearCache(); } catch (e) {}
  try { app.relaunch(); } catch (e) {}
  app.isQuitting = true; app.exit(0);
}

function applyGlobalHotkey() {
  try { globalShortcut.unregister("CommandOrControl+Shift+P"); } catch (e) {}
  if (settings.globalHotkey === false) return;
  try { globalShortcut.register("CommandOrControl+Shift+P", () => { showWindow(); try { if (win && !win.isDestroyed()) win.webContents.executeJavaScript("window.dispatchEvent(new Event('pufflabs:open-command-palette'))").catch(() => {}); } catch (e) {} }); } catch (e) {}
}

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  // Protocol registration. macOS: a plain call. Windows in dev: pass the exe +
  // script path so the launched copy carries the pufflabs:// URL in argv.
  if (IS_WIN && process.defaultApp && process.argv.length >= 2) {
    try { app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]); } catch (e) {}
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
  app.on("open-url", (e, url) => { e.preventDefault(); handleDeepLink(url); });
  app.on("second-instance", (_e, argv) => { const u = argv.find((a) => a.startsWith(SCHEME + "://")); if (u) handleDeepLink(u); else showWindow(); });
  app.whenReady().then(() => {
    try { app.setAppUserModelId("work.pufflabs.desktop"); } catch (e) {}
    settings = loadSettings(); applySettings();
    const iconPath = path.join(__dirname, "icon.png");
    if (app.dock && fs.existsSync(iconPath)) { try { app.dock.setIcon(nativeImage.createFromPath(iconPath)); } catch (e) {} }
    createWindow(); createTray(); buildMenu();
    applyGlobalHotkey();
    // Windows first-launch-from-protocol: the deep link arrives in argv.
    if (IS_WIN) { try { const u = process.argv.find((a) => a.startsWith(SCHEME + "://")); if (u) handleDeepLink(u); } catch (e) {} }
    setTimeout(() => checkForUpdates(true), 4000);           // silent check on launch
    // Only surface a window when there ISN\u2019T one already visible. The old
    // unconditional showWindow() re-focused the window on every activate
    // (incl. clicking the menu-bar item), stealing focus from the tray menu
    // so it kept snapping shut.
    app.on("activate", () => {
      if (!win || win.isDestroyed()) createWindow();
      else if (!win.isVisible()) showWindow();
    });
  });
  app.on("before-quit", () => { app.isQuitting = true; try { globalShortcut.unregisterAll(); } catch (e) {} });
  // Stay alive in the background (tray) even with no windows.
  app.on("window-all-closed", () => { if (process.platform !== "darwin" && !settings.runInBackground) app.quit(); });
}
