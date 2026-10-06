/* Public client config — anon key only (RLS-protected). Never put service_role here. */
window.CKR_CONFIG = {
  TURNSTILE_SITEKEY: "0x4AAAAAAEibh24Z60Wii3FT",
  SUPABASE_URL: "https://api.crgwwdc.shop",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg4MDg3MTI0LCJleHAiOjIxMDM0NDcxMjR9.UV8pIHHx6w2e3KphxVyb5KFaTlat-QnU-IYJNSgcKRs",
  // Production API on VPS (self-hosted DB). Default is prod so login works.
  // ?api=local → local uvicorn :8788 tunneled to VPS Auth/REST. ?api=prod is explicit.
  API_BASE: (() => {
    const prod = "https://api.crgwwdc.shop";
    const local = "http://127.0.0.1:8788";
    if (typeof location === "undefined") return prod;
    const p = new URLSearchParams(location.search);
    if (p.get("api") === "prod") return prod;
    if (p.get("api") === "local") return local;
    const custom = p.get("api");
    if (custom && /^https?:\/\//i.test(custom)) return custom;
    return prod;
  })(),
};
