/* Public client config — anon key only (RLS-protected). Never put service_role here. */
window.CKR_CONFIG = {
  SUPABASE_URL: "https://huugsgfpgqamnaejydkm.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1dWdzZ2ZwZ3FhbW5hZWp5ZGttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjYyNzAsImV4cCI6MjEwMDIwMjI3MH0.ioHMbJ7_Mcb3zwniZQLBJpiUvdm9RHKIlCgfHiicWoY",
  // Production API on VPS. Local preview uses prod so login works.
  // ?api=local → uvicorn :8787. ?api=prod is explicit.
  API_BASE: (() => {
    const prod = "https://api.crgwwdc.shop";
    const local = "http://127.0.0.1:8787";
    if (typeof location === "undefined") return prod;
    const host = location.hostname;
    const p = new URLSearchParams(location.search);
    if (p.get("api") === "prod") return prod;
    if (p.get("api") === "local") return local;
    const custom = p.get("api");
    if (custom && /^https?:\/\//i.test(custom)) return custom;
    return prod;
  })(),
};
