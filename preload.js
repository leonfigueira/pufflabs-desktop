const { contextBridge, ipcRenderer, webFrame } = require("electron");
const { createBrowserClient } = require("@supabase/ssr");

const SUPABASE_URL = "https://ogubjsuqdsbdewhwlkit.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ndWJqc3VxZHNiZGV3aHdsa2l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDgxNjIsImV4cCI6MjA5NDQ4NDE2Mn0.YPh-jc0VCf_QYk9v6EbhLNL7wssne-MWR75y7VTkEik";

// Exposed to the main process via executeJavaScript. Uses the SAME
// @supabase/ssr browser client the website uses, so setSession writes the
// sb-<ref>-auth-token cookie in the exact format the server expects.
contextBridge.exposeInMainWorld("pufflabsAuth", {
  // Ask the shell to open Google OAuth in the user's real browser (Google
  // blocks OAuth inside an app webview). The /login page calls this so sign-in
  // is an explicit, reliable, user-initiated action rather than an auto-timer.
  signIn: () => { try { ipcRenderer.send("auth:start-login"); } catch (e) {} },
  setSession: async (access_token, refresh_token) => {
    try {
      const sb = createBrowserClient(SUPABASE_URL, SUPABASE_ANON);
      const { error } = await sb.auth.setSession({ access_token, refresh_token });
      return error ? "err:" + error.message : "ok";
    } catch (e) {
      return "ex:" + String(e);
    }
  },
});

contextBridge.exposeInMainWorld("__PUFFLABS_DESKTOP__", true);

contextBridge.exposeInMainWorld("__PUFFLABS_FRAMELESS__", true);

// True ONLY in the frameless time-tracker pop-out window (main.js passes
// --pufflabs-frameless-popout via additionalArguments). The web reserves
// traffic-light clearance + a drag strip for just that window.
contextBridge.exposeInMainWorld(
  "__PUFFLABS_POPOUT_FRAMELESS__",
  process.argv.includes("--pufflabs-frameless-popout")
);

// Menu-bar (tray) timer bridge. The renderer holds the auth session +
// the timer store, so it pushes elapsed/project state to the main
// process (which paints the tray), and listens for tray menu clicks.
contextBridge.exposeInMainWorld("pufflabsTray", {
  update: (state) => { try { ipcRenderer.send("tray:timer", state); } catch (e) {} },
  onCommand: (cb) => {
    const handler = (_e, payload) => { try { cb(payload); } catch (e) {} };
    ipcRenderer.on("tray:command", handler);
    return () => { try { ipcRenderer.removeListener("tray:command", handler); } catch (e) {} };
  },
});

// App chrome bridge for the in-app Slack-style top bar (search /
// zoom / preferences). Zoom uses webFrame directly (renderer
// process); the Preferences button asks main to open the prefs
// window over IPC.
contextBridge.exposeInMainWorld("pufflabsApp", {
  zoomIn: () => { try { webFrame.setZoomLevel(Math.min(webFrame.getZoomLevel() + 0.5, 3)); } catch (e) {} },
  zoomOut: () => { try { webFrame.setZoomLevel(Math.max(webFrame.getZoomLevel() - 0.5, -3)); } catch (e) {} },
  zoomReset: () => { try { webFrame.setZoomLevel(0); } catch (e) {} },
  openPreferences: () => { try { ipcRenderer.send("open-prefs"); } catch (e) {} },
});

// Native notification bridge: the renderer asks main to show a macOS
// notification (main owns the on/off setting + reliable click focus).
contextBridge.exposeInMainWorld("pufflabsNotify", {
  show: (p) => { try { ipcRenderer.send("notify:show", p); } catch (e) {} },
  onClick: (cb) => {
    const handler = (_e, url) => { try { cb(url); } catch (e) {} };
    ipcRenderer.on("notify:click", handler);
    return () => { try { ipcRenderer.removeListener("notify:click", handler); } catch (e) {} };
  },
});

// Platform string so the web app can branch (e.g. draw mac-style window
// control dots only on Windows, where the OS draws none in a frameless window).
contextBridge.exposeInMainWorld("pufflabsPlatform", process.platform);

// Window controls for the frameless window. On Windows the web app draws the
// mac-style traffic-light dots in the top-left and calls these; on macOS the OS
// draws the real traffic lights so these go unused. Works for the main window
// AND the timer pop-out (main resolves the window from the IPC sender).
contextBridge.exposeInMainWorld("pufflabsWindow", {
  minimize: () => { try { ipcRenderer.send("win:minimize"); } catch (e) {} },
  maximize: () => { try { ipcRenderer.send("win:maximize"); } catch (e) {} },
  close: () => { try { ipcRenderer.send("win:close"); } catch (e) {} },
  isMaximized: () => { try { return ipcRenderer.invoke("win:is-maximized"); } catch (e) { return Promise.resolve(false); } },
  onMaximizedChanged: (cb) => {
    const handler = (_e, val) => { try { cb(!!val); } catch (e) {} };
    ipcRenderer.on("win:maximized-changed", handler);
    return () => { try { ipcRenderer.removeListener("win:maximized-changed", handler); } catch (e) {} };
  },
});
