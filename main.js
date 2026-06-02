const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain, dialog } = require("electron");
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

app.userAgentFallback =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ---------- settings (local to this Mac, JSON in userData) ---------- */
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");
const DEFAULTS = { launchAtLogin: false, runInBackground: true, dockBadge: true, bounce: true };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) }; } catch (e) { return { ...DEFAULTS }; } }
function saveSettings() { try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch (e) {} }
let settings = DEFAULTS;
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
function stayInApp(u) { try { const x = new URL(u); return x.origin === HOME_ORIGIN || x.hostname.endsWith("google.com") || x.hostname.endsWith("gstatic.com") || x.hostname.endsWith("supabase.co"); } catch (e) { return false; } }
function showWindow() { if (!win) createWindow(); win.show(); win.focus(); if (app.dock) app.dock.show(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 900, minHeight: 600, show: true,
    title: "PuffLabs", backgroundColor: "#030408",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: false },
  });
  win.loadURL(APP_URL);
  win.webContents.setWindowOpenHandler(({ url }) => { if (stayInApp(url)) return { action: "allow" }; shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!stayInApp(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on("did-navigate", (_e, url) => { try { if (new URL(url).pathname.startsWith("/login") && !loggingIn) startLogin(); } catch (e) {} });
  // Dock unread badge + bounce on increase (from the "(N) " title the web app sets).
  win.webContents.on("page-title-updated", (_e, title) => {
    const n = parseInt((/^\((\d+)\)/.exec(title || "") || [])[1] || "0", 10);
    if (app.dock && settings.dockBadge) app.dock.setBadge(n ? String(n) : "");
    if (n > lastUnread && settings.bounce && app.dock) app.dock.bounce("informational");
    lastUnread = n;
  });
  // Background mode: closing hides to the menu bar instead of quitting.
  win.on("close", (e) => { if (settings.runInBackground && !app.isQuitting) { e.preventDefault(); win.hide(); if (app.dock) app.dock.hide(); } });
}

/* ---------- tray (menu bar) ---------- */
function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("PuffLabs");
  tray.on("click", showWindow);
  updateTrayMenu();
}
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open PuffLabs", click: showWindow },
    { type: "separator" },
    { label: "Preferences…", accelerator: "Cmd+,", click: openPrefs },
    { label: "Check for Updates…", click: () => checkForUpdates(false) },
    { type: "separator" },
    { label: "Quit PuffLabs", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

/* ---------- preferences window ---------- */
function openPrefs() {
  if (prefsWin) { prefsWin.focus(); return; }
  prefsWin = new BrowserWindow({ width: 440, height: 460, resizable: false, title: "Preferences", backgroundColor: "#0b0c14",
    webPreferences: { preload: path.join(__dirname, "prefs-preload.js"), contextIsolation: true } });
  prefsWin.loadFile("preferences.html");
  prefsWin.on("closed", () => { prefsWin = null; });
}
ipcMain.handle("prefs:get", () => settings);
ipcMain.handle("prefs:set", (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(); applySettings(); return settings; });
ipcMain.handle("prefs:version", () => app.getVersion());
ipcMain.handle("prefs:check-updates", () => checkForUpdates(false));

/* ---------- update check (compares to a version file you control) ---------- */
function vGt(a, b) { const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; } return false; }
async function checkForUpdates(silent) {
  try {
    const r = await fetch(UPDATE_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("no feed");
    const j = await r.json();
    if (j && j.version && vGt(j.version, app.getVersion())) {
      const res = await dialog.showMessageBox({ type: "info", buttons: ["Download", "Later"], defaultId: 0, message: "Update available", detail: "PuffLabs " + j.version + " is available (you have " + app.getVersion() + ")." });
      if (res.response === 0) shell.openExternal(j.url || DOWNLOAD_PAGE);
    } else if (!silent) {
      dialog.showMessageBox({ type: "info", message: "You're up to date", detail: "PuffLabs " + app.getVersion() });
    }
  } catch (e) { if (!silent) dialog.showMessageBox({ type: "info", message: "Couldn't check for updates", detail: "Try again later." }); }
}

/* ---------- menu ---------- */
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "PuffLabs", submenu: [ { role: "about" }, { label: "Preferences…", accelerator: "Cmd+,", click: openPrefs }, { label: "Check for Updates…", click: () => checkForUpdates(false) }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { label: "Quit", accelerator: "Cmd+Q", click: () => { app.isQuitting = true; app.quit(); } } ] },
    { role: "editMenu" },
    { label: "View", submenu: [ { label: "Communications", accelerator: "Cmd+1", click: () => { showWindow(); win.loadURL(APP_URL); } }, { label: "Sign in", accelerator: "Cmd+L", click: startLogin }, { type: "separator" }, { role: "reload" }, { role: "forceReload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" } ] },
    { role: "windowMenu" },
  ]));
}

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.setAsDefaultProtocolClient(SCHEME);
  app.on("open-url", (e, url) => { e.preventDefault(); handleDeepLink(url); });
  app.on("second-instance", (_e, argv) => { const u = argv.find((a) => a.startsWith(SCHEME + "://")); if (u) handleDeepLink(u); else showWindow(); });
  app.whenReady().then(() => {
    settings = loadSettings(); applySettings();
    const iconPath = path.join(__dirname, "icon.png");
    if (app.dock && fs.existsSync(iconPath)) { try { app.dock.setIcon(nativeImage.createFromPath(iconPath)); } catch (e) {} }
    createWindow(); createTray(); buildMenu();
    setTimeout(() => checkForUpdates(true), 4000);           // silent check on launch
    app.on("activate", () => { showWindow(); });
  });
  app.on("before-quit", () => { app.isQuitting = true; });
  // Stay alive in the background (tray) even with no windows.
  app.on("window-all-closed", () => { if (process.platform !== "darwin" && !settings.runInBackground) app.quit(); });
}
