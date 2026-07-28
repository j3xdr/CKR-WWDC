/* Public client config — anon key only (RLS-protected). Never put service_role here. */
window.CKR_CONFIG = {
  SUPABASE_URL: "https://huugsgfpgqamnaejydkm.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1dWdzZ2ZwZ3FhbW5hZWp5ZGttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjYyNzAsImV4cCI6MjEwMDIwMjI3MH0.ioHMbJ7_Mcb3zwniZQLBJpiUvdm9RHKIlCgfHiicWoY",
  // Local preview → local API; production Pages → Render
  API_BASE:
    typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "http://127.0.0.1:8787"
      : "https://ckr-wwdc.onrender.com",
};
