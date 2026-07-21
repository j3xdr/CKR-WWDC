/* CKR WWDC client — public farm UI only (no admin) */
(function () {
  "use strict";

  const cfg = window.CKR_CONFIG;
  if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
    document.body.innerHTML =
      "<p style='padding:2rem;color:#f6e7c8;font-family:sans-serif'>ขาดไฟล์ config.js</p>";
    return;
  }

  const REMEMBER_KEY = "ckr_wwdc_remember";
  const API = cfg.API_BASE || "";

  /** Prefer localStorage when "remember me"; otherwise sessionStorage (clears on tab close). */
  function wantsRemember() {
    const pref = localStorage.getItem(REMEMBER_KEY);
    if (pref === null) return true; // default: remember
    return pref === "1";
  }

  function setRememberPref(on) {
    if (on) localStorage.setItem(REMEMBER_KEY, "1");
    else localStorage.setItem(REMEMBER_KEY, "0");
  }

  const authStorage = {
    getItem(key) {
      const primary = wantsRemember() ? localStorage : sessionStorage;
      const secondary = wantsRemember() ? sessionStorage : localStorage;
      return primary.getItem(key) ?? secondary.getItem(key);
    },
    setItem(key, value) {
      if (wantsRemember()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    },
    removeItem(key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    },
  };

  const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  const $ = (id) => document.getElementById(id);
  const loginView = $("login-view");
  const userView = $("user-view");

  let accessToken = null;
  let profile = null;
  let stageTimer = null;

  const ERR_TH = {
    insufficient_tokens: "โทเค็นไม่พอ กรุณาติดต่อแอดมิน",
    farm_busy: "ระบบกำลังยุ่งอยู่ ลองใหม่อีกสักครู่",
    farm_error: "การฟาร์มล้มเหลว ลองใหม่อีกครั้ง",
    consume_failed: "หักโทเค็นไม่สำเร็จ ลองใหม่อีกครั้ง",
    login_no_session: "เข้าสู่ระบบไม่สำเร็จ",
    Invalid: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  };

  function thError(raw) {
    if (!raw) return "เกิดข้อผิดพลาด";
    const s = String(raw);
    for (const [k, v] of Object.entries(ERR_TH)) {
      if (s.includes(k)) return v;
    }
    if (/invalid|wrong|credential|password|user/i.test(s)) {
      return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    }
    if (/network|fetch|Failed to fetch/i.test(s)) {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง";
    }
    // Never dump technical blobs
    if (/traceback|grpc|RpcError|Stack|Exception|at 0x|python/i.test(s)) {
      return "เกิดข้อผิดพลาดระหว่างฟาร์ม ลองใหม่อีกครั้ง";
    }
    if (s.length > 120 || /[{}\[\]]/.test(s)) {
      return "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    }
    return s;
  }

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
      const detail = data?.detail || data?.reason || data?.error || res.statusText;
      const err = new Error(typeof detail === "string" ? detail : "request_failed");
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
    $("nav-balance-num").textContent = String(bal);
    $("who-user").textContent =
      profile?.username || profile?.display_name || "—";
  }

  async function refreshMe() {
    const data = await api("/api/me");
    profile = data.profile;
    paintProfile();
    showApp();
  }

  /* ---------- Friendly farm logs (Thai, non-technical) ---------- */
  const LIVE_STAGES = [
    "กำลังเตรียมการวิ่ง…",
    "กำลังเข้าสู่ระบบเกม…",
    "กำลังเคลียร์รางวัลค้าง…",
    "กำลังจับคู่…",
    "กำลังวิ่งฟาร์ม…",
    "กำลังส่งผลคะแนน…",
    "กำลังรับรางวัล…",
  ];

  const LOG_RULES = [
    { re: /LOGIN OK|login ok|devsisters|เข้าสู่ระบบเกม/i, text: "เข้าสู่ระบบเกมแล้ว", kind: "ok" },
    { re: /\[1\/4\]|clearing pending/i, text: "กำลังเคลียร์รางวัลค้าง…", kind: "pending" },
    { re: /cleared pending/i, text: "เคลียร์รางวัลค้างแล้ว", kind: "ok" },
    { re: /BLOCKED|corrupt_pending|CORRUPT/i, text: "บัญชีติดรางวัลค้าง — ลองใหม่ภายหลัง", kind: "err" },
    { re: /\[2\/4\]|matchmaking \.\.\./i, text: "กำลังจับคู่…", kind: "pending" },
    { re: /matchmaking failed|MATCHMAKING ERROR/i, text: "จับคู่ไม่สำเร็จ ลองใหม่อีกครั้ง", kind: "err" },
    { re: /ingame_id\s*=/i, text: "จับคู่สำเร็จ กำลังเริ่มวิ่ง", kind: "ok" },
    { re: /\[3\/4\]|playing \+|submitted run_end|state ->/i, text: "กำลังวิ่งฟาร์ม…", kind: "pending" },
    { re: /quit acknowledged/i, text: "จบการวิ่งแล้ว", kind: "ok" },
    { re: /\[4\/4\]|claiming reward/i, text: "กำลังรับรางวัล…", kind: "pending" },
    { re: /not finalized yet|retrying/i, text: "รอรับรางวัลอีกสักครู่…", kind: "pending" },
    { re: /REWARD CLAIMED/i, text: "สำเร็จแล้ว รับรางวัลเรียบร้อย", kind: "ok" },
    { re: /claim_timeout|could not claim/i, text: "รับรางวัลไม่ทัน ลองใหม่อีกครั้ง", kind: "err" },
    { re: /INGAME ERROR|ingame rpc|finalize rpc/i, text: "การวิ่งสะดุด ลองใหม่อีกครั้ง", kind: "err" },
  ];

  const TECH_NOISE =
    /traceback|grpc|RpcError|Stack|Exception|0x[0-9a-f]+|partyrun|protobuf|descriptor|endpoint|Bearer|authorization|python|File "|line \d+|http[s]?:\/\//i;

  function sanitizeLogs(rawLogs, result, ok) {
    const lines = Array.isArray(rawLogs) ? rawLogs : [];
    const steps = [];
    const seen = new Set();

    function push(text, kind) {
      if (!text || seen.has(text)) return;
      seen.add(text);
      steps.push({ text, kind: kind || "pending" });
    }

    for (const line of lines) {
      const s = String(line || "");
      if (!s.trim() || TECH_NOISE.test(s)) continue;
      let matched = false;
      for (const rule of LOG_RULES) {
        if (rule.re.test(s)) {
          push(rule.text, rule.kind);
          matched = true;
          break;
        }
      }
      // Skip unmapped technical lines entirely
      if (!matched) continue;
    }

    // Structured steps from API (if ever added)
    if (Array.isArray(result?.steps)) {
      for (const step of result.steps) {
        if (typeof step === "string") push(step, "pending");
        else if (step?.th || step?.text) push(step.th || step.text, step.kind || "pending");
      }
    }

    if (ok) {
      push("สำเร็จแล้ว", "ok");
      const reward = result?.reward;
      if (reward && typeof reward === "object") {
        const bits = [];
        if (reward.coin?.delta) bits.push("เหรียญ +" + reward.coin.delta);
        if (reward.exp?.delta) bits.push("EXP +" + reward.exp.delta);
        if (reward.gem?.delta) bits.push("เพชร +" + reward.gem.delta);
        if (bits.length) push("ได้รับ: " + bits.join(" · "), "ok");
      }
    } else if (result?.error === "corrupt_pending") {
      push("บัญชีติดรางวัลค้าง — ลองใหม่ภายหลัง", "err");
    } else if (result?.error === "matchmaking_failed") {
      push("จับคู่ไม่สำเร็จ ลองใหม่อีกครั้ง", "err");
    } else if (result?.error === "claim_timeout") {
      push("รับรางวัลไม่ทัน ลองใหม่อีกครั้ง", "err");
    } else if (!steps.length) {
      push("การฟาร์มไม่สำเร็จ ลองใหม่อีกครั้ง", "err");
    }

    return steps;
  }

  function renderLog(steps) {
    const wrap = $("farm-log-wrap");
    const list = $("farm-log");
    const empty = $("farm-empty");
    wrap.classList.remove("hidden");
    list.innerHTML = "";
    if (!steps.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    for (const step of steps) {
      const li = document.createElement("li");
      li.textContent = step.text;
      if (step.kind) li.classList.add(step.kind);
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;
  }

  function clearStageTimer() {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }
  }

  function startLiveStages() {
    clearStageTimer();
    let i = 0;
    const shown = [{ text: LIVE_STAGES[0], kind: "pending" }];
    renderLog(shown);
    stageTimer = setInterval(() => {
      i = Math.min(i + 1, LIVE_STAGES.length - 1);
      shown.push({ text: LIVE_STAGES[i], kind: "pending" });
      // Keep unique progressive stages
      const dedup = [];
      const seen = new Set();
      for (const s of shown) {
        if (seen.has(s.text)) continue;
        seen.add(s.text);
        dedup.push(s);
      }
      renderLog(dedup);
      if (i >= LIVE_STAGES.length - 1) clearStageTimer();
    }, 4500);
  }

  /* ---------- DevPlay autofill guards ---------- */
  function armReadonlyUnlock(el) {
    if (!el) return;
    const unlock = () => {
      el.removeAttribute("readonly");
    };
    el.addEventListener("focus", unlock);
    el.addEventListener("pointerdown", unlock);
    // Clear any browser-injected values after paint
    requestAnimationFrame(() => {
      if (el.value && document.activeElement !== el) {
        // If it looks like website login bleed, clear
        el.value = "";
      }
      el.setAttribute("readonly", "readonly");
    });
  }

  function setupDevPlayAutofillGuards() {
    const mail = $("dp-acct-mail");
    const secret = $("dp-acct-secret");
    armReadonlyUnlock(mail);
    armReadonlyUnlock(secret);
    // Extra: clear if autofill dumps login creds shortly after load
    setTimeout(() => {
      if (mail && document.activeElement !== mail) mail.value = "";
      if (secret && document.activeElement !== secret) secret.value = "";
      if (mail) mail.setAttribute("readonly", "readonly");
      if (secret) secret.setAttribute("readonly", "readonly");
    }, 300);
    setTimeout(() => {
      if (mail && document.activeElement !== mail && mail.value) {
        /* keep user typing; only clear if still untouched via trap */
      }
    }, 800);
  }

  /* ---------- Auth bootstrap ---------- */
  async function bootstrap() {
    const rememberEl = $("remember-me");
    if (rememberEl) {
      const pref = localStorage.getItem(REMEMBER_KEY);
      rememberEl.checked = pref !== "0";
    }

    setupDevPlayAutofillGuards();

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
      setStatus($("login-status"), thError(e.message) || "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "err");
    }
  }

  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const remember = !!$("remember-me")?.checked;
    setRememberPref(remember);

    setStatus($("login-status"), "กำลังเข้าสู่ระบบ…", "muted");
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
      // Re-arm DevPlay fields after login so they stay empty
      setupDevPlayAutofillGuards();
    } catch (e) {
      setStatus($("login-status"), thError(e.message) || "เข้าสู่ระบบไม่สำเร็จ", "err");
    } finally {
      $("login-btn").disabled = false;
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    accessToken = null;
    profile = null;
    // Clear both storages so remember-off sessions don't linger
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes("auth-token")) keys.push(k);
      }
      keys.forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    } catch (_) {}
    showLogin();
  });

  $("farm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("farm-btn");
    btn.disabled = true;
    setStatus($("farm-status"), "กำลังฟาร์ม… อาจใช้เวลาสักครู่", "muted");
    startLiveStages();

    try {
      const data = await api("/api/farm/run", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
          score: Number($("farm-score").value) || 0,
          coin: Number($("farm-coin").value) || 0,
          exp: Number($("farm-exp").value) || 0,
        },
      });
      clearStageTimer();
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        paintProfile();
      }
      const steps = sanitizeLogs(data.logs || data.steps, data.result || data, !!data.ok);
      renderLog(steps);
      setStatus(
        $("farm-status"),
        data.ok
          ? "ฟาร์มสำเร็จแล้ว · หัก 1 โทเค็น"
          : "ฟาร์มจบแล้วแต่มีปัญหา · โทเค็นถูกหักแล้ว",
        data.ok ? "ok" : "err"
      );
    } catch (e) {
      clearStageTimer();
      setStatus($("farm-status"), thError(e.message) || "ฟาร์มไม่สำเร็จ", "err");
      const steps = sanitizeLogs(e.data?.logs || [], e.data?.result, false);
      if (!steps.length) {
        renderLog([{ text: thError(e.message) || "ฟาร์มไม่สำเร็จ", kind: "err" }]);
      } else {
        renderLog(steps);
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
