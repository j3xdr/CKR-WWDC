/* CKR WWDC client — public farm UI only (no admin) */
(function () {
  "use strict";

  const cfg = window.CKR_CONFIG;
  if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
    document.body.innerHTML = "<p style='padding:2rem'>Missing config.js</p>";
    return;
  }

  const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const API = cfg.API_BASE || "";

  const $ = (id) => document.getElementById(id);
  const loginView = $("login-view");
  const userView = $("user-view");

  let accessToken = null;
  let profile = null;

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "status " + (kind || "muted");
  }

  async function api(path, options = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    const res = await fetch(API + path, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const detail = data?.detail || data?.reason || res.statusText;
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showLogin() {
    loginView.classList.remove("hidden");
    userView.classList.add("hidden");
    $("logout-btn").classList.add("hidden");
    $("nav-balance").classList.add("hidden");
  }

  function showApp() {
    loginView.classList.add("hidden");
    userView.classList.remove("hidden");
    $("logout-btn").classList.remove("hidden");
    $("nav-balance").classList.remove("hidden");
  }

  function paintProfile() {
    const bal = profile?.token_balance ?? 0;
    $("token-balance").textContent = String(bal);
    $("nav-balance").textContent = bal + " tokens";
    $("who-user").textContent = profile?.username || profile?.display_name || "—";
  }

  async function refreshMe() {
    const data = await api("/api/me");
    profile = data.profile;
    paintProfile();
    showApp();
  }

  async function bootstrap() {
    const { data } = await sb.auth.getSession();
    if (!data?.session) {
      showLogin();
      return;
    }
    accessToken = data.session.access_token;
    try {
      await refreshMe();
    } catch (e) {
      await sb.auth.signOut();
      accessToken = null;
      showLogin();
      setStatus($("login-status"), e.message || "Session invalid", "err");
    }
  }

  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setStatus($("login-status"), "Signing in…", "muted");
    $("login-btn").disabled = true;
    try {
      const username = $("login-user").value.trim();
      const password = $("login-pass").value;
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      if (!data.access_token || !data.refresh_token) {
        throw new Error("login_no_session");
      }
      const { error } = await sb.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (error) throw error;
      accessToken = data.access_token;
      profile = data.profile;
      paintProfile();
      showApp();
      setStatus($("login-status"), "", "muted");
    } catch (e) {
      setStatus($("login-status"), e.message || "Login failed", "err");
    } finally {
      $("login-btn").disabled = false;
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    accessToken = null;
    profile = null;
    showLogin();
  });

  $("farm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("farm-btn");
    const logEl = $("farm-log");
    btn.disabled = true;
    setStatus($("farm-status"), "Running farm (may take a while)…", "muted");
    logEl.classList.remove("hidden");
    logEl.textContent = "…\n";
    try {
      const data = await api("/api/farm/run", {
        method: "POST",
        body: {
          email: $("farm-email").value.trim(),
          password: $("farm-pass").value,
          score: Number($("farm-score").value) || 0,
          coin: Number($("farm-coin").value) || 0,
          exp: Number($("farm-exp").value) || 0,
        },
      });
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        paintProfile();
      }
      const lines = (data.logs || []).join("\n");
      logEl.textContent = lines || JSON.stringify(data.result || data, null, 2);
      setStatus(
        $("farm-status"),
        data.ok ? "Farm succeeded. Token consumed." : "Farm finished with errors (token was consumed).",
        data.ok ? "ok" : "err"
      );
    } catch (e) {
      setStatus($("farm-status"), e.message || "Farm failed", "err");
      if (e.data?.logs) {
        logEl.textContent = e.data.logs.join("\n");
      }
      if (e.status === 402) {
        await refreshMe().catch(() => {});
      }
    } finally {
      btn.disabled = false;
    }
  });

  bootstrap();
})();
