const { contextBridge } = require("electron");
const { createBrowserClient } = require("@supabase/ssr");

const SUPABASE_URL = "https://ogubjsuqdsbdewhwlkit.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ndWJqc3VxZHNiZGV3aHdsa2l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDgxNjIsImV4cCI6MjA5NDQ4NDE2Mn0.YPh-jc0VCf_QYk9v6EbhLNL7wssne-MWR75y7VTkEik";

// Exposed to the main process via executeJavaScript. Uses the SAME
// @supabase/ssr browser client the website uses, so setSession writes the
// sb-<ref>-auth-token cookie in the exact format the server expects.
contextBridge.exposeInMainWorld("pufflabsAuth", {
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
