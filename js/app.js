/* CKR WWDC client */
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

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.add("hidden"));
  }

  function showApp() {
    loginView.classList.add("hidden");
    userView.classList.remove("hidden");
    $("logout-btn").classList.remove("hidden");
    $("nav-balance").classList.remove("hidden");
    const isAdmin = profile?.role === "admin";
    document.querySelectorAll(".admin-only").forEach((el) => {
      el.classList.toggle("hidden", !isAdmin);
    });
  }

  function paintProfile() {
    const bal = profile?.token_balance ?? 0;
    $("token-balance").textContent = String(bal);
    $("nav-balance").textContent = bal + " tokens";
    $("who-email").textContent = profile?.email || "";
    $("who-role").textContent = "Role: " + (profile?.role || "—");
  }

  async function refreshMe() {
    const data = await api("/api/me");
    profile = data.profile;
    paintProfile();
    showApp();
    if (profile.role === "admin") {
      await loadUsers();
    }
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
      const email = $("login-email").value.trim();
      const password = $("login-pass").value;
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      accessToken = data.session.access_token;
      await refreshMe();
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

  $("lookup-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const q = $("lookup-q").value.trim();
    $("lookup-result").textContent = "Looking up…";
    try {
      const data = await api("/api/admin/lookup?q=" + encodeURIComponent(q));
      if (!data.ok) {
        $("lookup-result").textContent = data.reason || "not found";
        return;
      }
      $("lookup-result").innerHTML =
        "<strong>" +
        escapeHtml(data.email || data.username) +
        "</strong> · tokens: " +
        escapeHtml(data.token_balance) +
        " · role: " +
        escapeHtml(data.role) +
        "<br/><span class='muted'>" +
        escapeHtml(data.id) +
        "</span>";
      $("credit-q").value = data.email || data.username || q;
    } catch (e) {
      $("lookup-result").textContent = e.message;
    }
  });

  $("credit-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setStatus($("credit-status"), "Crediting…", "muted");
    try {
      const data = await api("/api/admin/add-tokens", {
        method: "POST",
        body: {
          query: $("credit-q").value.trim(),
          amount: Number($("credit-amt").value) || 0,
          reason: "admin_credit",
        },
      });
      setStatus($("credit-status"), "New balance: " + data.token_balance, "ok");
      await loadUsers();
    } catch (e) {
      setStatus($("credit-status"), e.message, "err");
    }
  });

  $("create-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setStatus($("create-status"), "Creating…", "muted");
    try {
      const data = await api("/api/admin/create-user", {
        method: "POST",
        body: {
          email: $("create-email").value.trim(),
          password: $("create-pass").value,
          username: $("create-user").value.trim() || null,
          initial_tokens: Number($("create-tokens").value) || 0,
        },
      });
      setStatus($("create-status"), "Created " + data.email + " · " + data.token_balance + " tokens", "ok");
      $("create-form").reset();
      await loadUsers();
    } catch (e) {
      setStatus($("create-status"), e.message, "err");
    }
  });

  async function loadUsers() {
    const tbody = $("users-body");
    tbody.innerHTML = "<tr><td colspan='4' class='muted'>Loading…</td></tr>";
    try {
      const data = await api("/api/admin/users");
      const users = data.users || [];
      if (!users.length) {
        tbody.innerHTML = "<tr><td colspan='4' class='muted'>No users</td></tr>";
        return;
      }
      tbody.innerHTML = users
        .map(
          (u) =>
            "<tr><td>" +
            escapeHtml(u.email) +
            "</td><td>" +
            escapeHtml(u.username || "—") +
            "</td><td>" +
            escapeHtml(u.role) +
            "</td><td>" +
            escapeHtml(u.token_balance ?? 0) +
            "</td></tr>"
        )
        .join("");
    } catch (e) {
      tbody.innerHTML = "<tr><td colspan='4' class='muted'>" + escapeHtml(e.message) + "</td></tr>";
    }
  }

  $("refresh-users").addEventListener("click", () => loadUsers());

  bootstrap();
})();
