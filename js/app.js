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
  const TELEGRAM_URL = "https://t.me/j3xdr";
  const API = cfg.API_BASE || "";
  const INT32_MAX = 2147483647;

  const DIGIT_TH = [
    "ศูนย์",
    "หนึ่ง",
    "สอง",
    "สาม",
    "สี่",
    "ห้า",
    "หก",
    "เจ็ด",
    "แปด",
    "เก้า",
  ];
  // index = จำนวนหลัก - 1 ของเลขตัวต้น
  const PLACE_TH = [
    "",
    "สิบ",
    "ร้อย",
    "พัน",
    "หมื่น",
    "แสน",
    "ล้าน",
    "สิบล้าน",
    "ร้อยล้าน",
    "พันล้าน",
  ];

  function digitsOnly(raw) {
    return String(raw || "").replace(/\D/g, "");
  }

  function formatCommas(digitStr) {
    if (!digitStr) return "";
    return digitStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function parseFarmNum(raw) {
    const d = digitsOnly(raw);
    if (!d) return 0;
    const n = Number(d);
    return Number.isFinite(n) ? n : 0;
  }

  /** บอกหลักจากเลขตัวต้นเท่านั้น เช่น 800000 → แปดแสน, 500 → ห้าร้อย */
  function thaiMagnitude(n) {
    if (!Number.isFinite(n) || n <= 0) return "";
    const s = String(Math.floor(Math.abs(n)));
    const first = Number(s[0]);
    const placeIdx = s.length - 1;
    if (placeIdx === 0) return DIGIT_TH[first] || "";
    const place = PLACE_TH[placeIdx];
    if (!place) return DIGIT_TH[first] || "";
    // กรณีพิเศษภาษาไทย: 10 → สิบ, 20 → ยี่สิบ
    if (placeIdx === 1) {
      if (first === 1) return "สิบ";
      if (first === 2) return "ยี่สิบ";
    }
    // 1 ที่หลักพันล้าน → "พันล้าน" ตามตัวอย่าง
    if (first === 1 && placeIdx === 9) return "พันล้าน";
    return (DIGIT_TH[first] || "") + place;
  }

  function syncFarmNumField(input, opts = {}) {
    const hint = $(input.id + "-hint");
    let digits = digitsOnly(input.value);
    if (!digits) {
      // ค่าว่างหลังโฟกัสเคลียร์ — อย่าใส่ 0 กลับทันที
      if (!opts.keepEmpty) {
        input.value = "0";
        if (hint) hint.textContent = "";
      } else {
        input.value = "";
        if (hint) hint.textContent = "";
      }
      return 0;
    }
    // คง "0" ไว้เป็นค่าเริ่มต้น (อย่าตัดเป็นว่าง)
    if (digits === "0") {
      input.value = "0";
      if (hint) hint.textContent = "";
      return 0;
    }
    // ตัดศูนย์นำหน้า ยกเว้นค่า 0 ล้วน
    digits = digits.replace(/^0+(?=\d)/, "");
    const n = Number(digits);
    if (!Number.isFinite(n) || n > INT32_MAX) {
      input.value = "0";
      if (hint) hint.textContent = "";
      if (!opts.silent) {
        showErrorModal(
          "ใส่ได้สูงสุด 2,147,483,647 เท่านั้น — ล้างช่องนี้แล้ว",
          "ตัวเลขเกินกำหนด"
        );
      }
      return 0;
    }
    input.value = formatCommas(digits);
    if (hint) hint.textContent = thaiMagnitude(n);
    return n;
  }

  function clearZeroPlaceholder(input) {
    if (input.disabled || input.readOnly) return;
    if (digitsOnly(input.value) === "0") {
      input.value = "";
      const hint = $(input.id + "-hint");
      if (hint) hint.textContent = "";
    }
  }

  function restoreZeroIfEmpty(input) {
    if (digitsOnly(input.value) === "") {
      input.value = "0";
      const hint = $(input.id + "-hint");
      if (hint) hint.textContent = "";
    } else {
      syncFarmNumField(input, { silent: true });
    }
  }

  function setFarmInputsLocked(locked) {
    ["farm-score", "farm-coin", "farm-exp"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.readOnly = !!locked;
      el.disabled = !!locked;
      el.classList.toggle("is-locked", !!locked);
      el.setAttribute("aria-disabled", locked ? "true" : "false");
    });
  }

  function setupFarmNumberInputs() {
    ["farm-score", "farm-coin", "farm-exp"].forEach((id) => {
      const el = $(id);
      if (!el || el.dataset.numBound === "1") return;
      el.dataset.numBound = "1";
      el.addEventListener("focus", () => clearZeroPlaceholder(el));
      el.addEventListener("pointerdown", () => clearZeroPlaceholder(el));
      el.addEventListener("input", () => syncFarmNumField(el, { keepEmpty: true }));
      el.addEventListener("blur", () => restoreZeroIfEmpty(el));
      syncFarmNumField(el, { silent: true });
    });
  }

  function wantsRemember() {
    const pref = localStorage.getItem(REMEMBER_KEY);
    if (pref === null) return true;
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
  const modalRoot = $("modal-root");
  const modalTitle = $("modal-title");
  const modalBody = $("modal-body");
  const modalIcon = $("modal-icon");
  const modalActions = $("modal-actions");

  let accessToken = null;
  let profile = null;
  let stageTimer = null;
  let balancePollTimer = null;
  let modalMode = null; // "empty" | "confirm" | "error" | null
  let farmRunning = false;

  const ERR_TH = {
    insufficient_tokens: "coins หมด กรุณาเติม",
    farm_busy: "ระบบกำลังยุ่งอยู่ ลองใหม่อีกสักครู่",
    farm_error: "การฟาร์มล้มเหลว ลองใหม่อีกครั้ง",
    consume_failed: "หักโทเค็นไม่สำเร็จ ลองใหม่อีกครั้ง",
    login_no_session: "เข้าสู่ระบบไม่สำเร็จ",
    Invalid: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    login_failed: "เข้าสู่ระบบเกมไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน DevPlay",
    LOGIN_FAILED: "เข้าสู่ระบบเกมไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน DevPlay",
    corrupt_pending:
      "บัญชีติดรางวัลค้างจากรอบก่อน รอรีเซ็ตประจำวันแล้วลองใหม่ (ลด EXP)",
    BLOCKED: "บัญชีติดรางวัลค้างจากรอบก่อน รอรีเซ็ตประจำวันแล้วลองใหม่",
    matchmaking_failed: "จับคู่ไม่สำเร็จ ลองใหม่อีกครั้ง",
    claim_timeout: "รับรางวัลไม่ทัน ลองใหม่อีกครั้ง (แมตช์อาจจบแล้ว)",
    could_not_claim: "รับรางวัลไม่ทัน ลองใหม่อีกครั้ง",
  };

  function thError(raw) {
    if (!raw) return "เกิดข้อผิดพลาด";
    const s = String(raw);
    for (const [k, v] of Object.entries(ERR_TH)) {
      if (s.includes(k)) return v;
    }
    if (/LOGIN FAILED|wrong email|password|DevPlay/i.test(s)) {
      return ERR_TH.login_failed;
    }
    if (/CORRUPT|corrupt_pending|BLOCKED/i.test(s)) {
      return ERR_TH.corrupt_pending;
    }
    if (/matchmaking failed/i.test(s)) {
      return ERR_TH.matchmaking_failed;
    }
    if (/could not claim|claim_timeout|not finalized/i.test(s)) {
      return ERR_TH.claim_timeout;
    }
    if (/invalid|wrong|credential|password|user/i.test(s)) {
      return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    }
    if (/network|fetch|Failed to fetch|network_error/i.test(s)) {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง";
    }
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

  function tokenBalance() {
    return Number(profile?.token_balance ?? 0);
  }

  function hasTokens() {
    return tokenBalance() >= 1;
  }

  /* ---------- Modal system ---------- */
  function clearModalActions() {
    modalActions.innerHTML = "";
    modalActions.className = "modal-actions";
  }

  function makeBtn(label, className, onClick, opts = {}) {
    const el = opts.href
      ? document.createElement("a")
      : document.createElement("button");
    el.className = "btn " + className;
    if (opts.href) {
      el.href = opts.href;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    } else {
      el.type = "button";
      el.addEventListener("click", onClick);
    }
    if (opts.icon) {
      const img = document.createElement("img");
      img.src = opts.icon;
      img.alt = "";
      img.width = 24;
      img.height = 24;
      el.appendChild(img);
    }
    el.appendChild(document.createTextNode(label));
    return el;
  }

  function openModal({ mode, title, body, icon, locked }) {
    modalMode = mode;
    modalTitle.textContent = title;
    modalBody.textContent = body;
    modalIcon.src = icon || "assets/coin.png";
    modalRoot.classList.toggle("locked", !!locked);
    modalRoot.classList.remove("hidden");
    modalRoot.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (modalMode === "empty") return; // cannot dismiss empty-coins
    modalMode = null;
    clearModalActions();
    modalRoot.classList.add("hidden");
    modalRoot.classList.remove("locked");
    modalRoot.setAttribute("aria-hidden", "true");
    stopBalancePoll();
  }

  function forceCloseModal() {
    modalMode = null;
    clearModalActions();
    modalRoot.classList.add("hidden");
    modalRoot.classList.remove("locked");
    modalRoot.setAttribute("aria-hidden", "true");
    stopBalancePoll();
  }

  function showEmptyCoinsModal() {
    clearModalActions();
    openModal({
      mode: "empty",
      title: "coins หมด กรุณาเติม",
      body: "โทเค็นหมดแล้ว ไม่สามารถวิ่งฟาร์มได้ จนกว่าจะเติมโทเค็นผ่านแอดมิน",
      icon: "assets/coin.png",
      locked: true,
    });
    modalActions.appendChild(
      makeBtn("ติดต่อแอดมินทาง Telegram", "btn-telegram", null, {
        href: TELEGRAM_URL,
        icon: "assets/telegram.png",
      })
    );
    modalActions.appendChild(
      makeBtn("ตรวจสอบยอดโทเค็นอีกครั้ง", "btn-ghost btn-wide", async () => {
        try {
          await refreshMe();
          if (hasTokens()) {
            forceCloseModal();
            setStatus($("farm-status"), "เติมโทเค็นแล้ว พร้อมวิ่งฟาร์ม", "ok");
          } else {
            setStatus($("farm-status"), "ยังมียอดเป็น 0 — รอแอดมินเติม", "err");
          }
        } catch (_) {
          setStatus($("farm-status"), "ตรวจยอดไม่สำเร็จ ลองใหม่", "err");
        }
      })
    );
    startBalancePoll();
  }

  function showErrorModal(message, title) {
    clearModalActions();
    openModal({
      mode: "error",
      title: title || "เกิดข้อผิดพลาด",
      body: message,
      icon: "assets/notice_b19.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function showConfirmModal() {
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันการวิ่งฟาร์ม?",
        body: "เมื่อกดยืนยัน จะหัก 1 โทเค็นทันที แม้ฟาร์มไม่สำเร็จ",
        icon: "assets/tr_event_116.png",
        locked: false,
      });
      modalActions.classList.add("row");
      modalActions.appendChild(
        makeBtn("ยกเลิก", "btn-ghost", () => {
          forceCloseModal();
          resolve(false);
        })
      );
      modalActions.appendChild(
        makeBtn("ยืนยัน", "btn-candy", () => {
          forceCloseModal();
          resolve(true);
        })
      );
    });
  }

  function startBalancePoll() {
    stopBalancePoll();
    balancePollTimer = setInterval(async () => {
      if (modalMode !== "empty" || !accessToken) return;
      try {
        const data = await api("/api/me");
        profile = data.profile;
        paintProfile();
        if (hasTokens()) {
          forceCloseModal();
          setStatus($("farm-status"), "เติมโทเค็นแล้ว พร้อมวิ่งฟาร์ม", "ok");
        }
      } catch (_) {}
    }, 8000);
  }

  function stopBalancePoll() {
    if (balancePollTimer) {
      clearInterval(balancePollTimer);
      balancePollTimer = null;
    }
  }

  function updateFarmAvailability() {
    const btn = $("farm-btn");
    if (!btn) return;
    const empty = !hasTokens();
    if (!farmRunning) {
      btn.disabled = empty;
    }
    setFarmInputsLocked(empty);
    if (empty && userView && !userView.classList.contains("hidden")) {
      if (modalMode !== "empty") showEmptyCoinsModal();
    } else if (!empty && modalMode === "empty") {
      forceCloseModal();
    }
  }

  function formatApiDetail(detail) {
    if (detail == null) return "";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const parts = detail.map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const loc = Array.isArray(item.loc)
          ? item.loc.filter((x) => x !== "body").join(".")
          : "";
        const msg = item.msg || item.type || "invalid";
        if (loc.includes("email") || /email/i.test(msg)) {
          return "อีเมล DevPlay ไม่ถูกต้อง";
        }
        if (loc.includes("password")) return "รหัสผ่าน DevPlay ว่างหรือไม่ถูกต้อง";
        if (loc.includes("score") || loc.includes("coin") || loc.includes("exp")) {
          return "ค่าคะแนน/เหรียญ/EXP ไม่ถูกต้องหรือเกินกำหนด";
        }
        return loc ? loc + ": " + msg : msg;
      });
      return parts.filter(Boolean).join(" · ") || "ข้อมูลไม่ถูกต้อง";
    }
    if (typeof detail === "object") {
      return detail.msg || detail.message || detail.reason || JSON.stringify(detail).slice(0, 160);
    }
    return String(detail);
  }

  async function api(path, options = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    let res;
    try {
      res = await fetch(API + path, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (netErr) {
      const err = new Error("network_error");
      err.cause = netErr;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const raw = data?.detail ?? data?.reason ?? data?.error ?? null;
      const detail = formatApiDetail(raw) || res.statusText || "request_failed";
      const err = new Error(detail);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showLogin() {
    stopBalancePoll();
    forceCloseModal();
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
    updateFarmAvailability();
  }

  function paintProfile() {
    const bal = tokenBalance();
    $("token-balance").textContent = String(bal);
    $("nav-balance-num").textContent = String(bal);
    $("who-user").textContent =
      profile?.username || profile?.display_name || "—";
    updateFarmAvailability();
  }

  async function refreshMe() {
    const data = await api("/api/me");
    profile = data.profile;
    paintProfile();
    showApp();
  }

  /* ---------- Friendly farm status pipeline ---------- */
  const PIPELINE_STEPS = [
    { id: "login", label: "เข้าสู่ระบบเกม" },
    { id: "clear", label: "เคลียร์รางวัลค้าง" },
    { id: "match", label: "จับคู่" },
    { id: "run", label: "วิ่งฟาร์ม" },
    { id: "claim", label: "รับรางวัล" },
    { id: "done", label: "สรุปผล" },
  ];

  let pipelineState = null; // { activeIdx, kinds: {id: pending|ok|err}, extras: [] }

  function formatNumTh(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? "");
    return String(Math.trunc(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function freshPipeline() {
    const kinds = {};
    for (const s of PIPELINE_STEPS) kinds[s.id] = "idle";
    return { activeIdx: 0, kinds, extras: [] };
  }

  function setPipelineActive(idx) {
    if (!pipelineState) pipelineState = freshPipeline();
    const max = PIPELINE_STEPS.length - 1;
    const next = Math.max(0, Math.min(idx, max));
    // Mark all before active as ok; active as pending; after as idle
    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      const id = PIPELINE_STEPS[i].id;
      if (i < next) pipelineState.kinds[id] = "ok";
      else if (i === next) pipelineState.kinds[id] = "pending";
      else if (pipelineState.kinds[id] === "pending") pipelineState.kinds[id] = "idle";
    }
    pipelineState.activeIdx = next;
    renderPipeline();
  }

  function markPipelineError(stepId, message) {
    if (!pipelineState) pipelineState = freshPipeline();
    let hit = false;
    for (const s of PIPELINE_STEPS) {
      if (s.id === stepId) {
        pipelineState.kinds[s.id] = "err";
        hit = true;
      } else if (!hit && pipelineState.kinds[s.id] !== "ok") {
        pipelineState.kinds[s.id] = "ok";
      } else if (hit && pipelineState.kinds[s.id] === "pending") {
        pipelineState.kinds[s.id] = "idle";
      }
    }
    if (message) {
      pipelineState.extras = [{ text: message, kind: "err" }];
    }
    renderPipeline();
  }

  function finalizePipelineSuccess(result) {
    if (!pipelineState) pipelineState = freshPipeline();
    for (const s of PIPELINE_STEPS) {
      pipelineState.kinds[s.id] = "ok";
    }
    pipelineState.activeIdx = PIPELINE_STEPS.length - 1;
    const extras = [];
    const summary = result?.reward_summary;
    const reward = result?.reward;
    const coinDelta = summary?.coin_delta ?? reward?.coin?.delta;
    const coinTotal = summary?.coin_total ?? reward?.coin?.total;
    const expDelta = summary?.exp_delta ?? reward?.exp?.delta;
    const expTotal = summary?.exp_total ?? reward?.exp?.total;
    const bits = [];
    if (coinDelta != null && coinDelta !== "") bits.push("เหรียญ +" + formatNumTh(coinDelta));
    if (expDelta != null && expDelta !== "") bits.push("EXP +" + formatNumTh(expDelta));
    if (bits.length) extras.push({ text: "ได้รับ: " + bits.join(" · "), kind: "ok" });
    if (coinTotal != null && coinTotal !== "") {
      extras.push({
        text: "เหรียญในเกมหลังเคลม: " + formatNumTh(coinTotal),
        kind: "ok",
      });
    }
    if (expTotal != null && expTotal !== "") {
      extras.push({
        text: "EXP รวมหลังเคลม: " + formatNumTh(expTotal),
        kind: "ok",
      });
    }
    const nick = summary?.nickname || result?.account?.nickname;
    if (nick) extras.push({ text: "บัญชีเกม: " + nick, kind: "ok" });
    extras.push({
      text: "ถ้าในเกมยังไม่เห็น ให้ปิดเกมแล้วเข้าใหม่",
      kind: "ok",
    });
    pipelineState.extras = extras;
    renderPipeline();
  }

  function applyLogsToPipeline(rawLogs) {
    if (!pipelineState) pipelineState = freshPipeline();
    const lines = Array.isArray(rawLogs) ? rawLogs : [];
    let idx = pipelineState.activeIdx || 0;
    let hardErr = null;
    for (const line of lines) {
      const s = String(line || "");
      if (!s.trim()) continue;
      if (/LOGIN FAILED/i.test(s)) {
        hardErr = { id: "login", msg: ERR_TH.login_failed };
        break;
      }
      if (/LOGIN OK|login ok/i.test(s)) idx = Math.max(idx, 1);
      if (/\[1\/4\]|clearing pending|cleared pending/i.test(s)) idx = Math.max(idx, 2);
      if (/BLOCKED|CORRUPT|corrupt_pending/i.test(s)) {
        hardErr = { id: "clear", msg: ERR_TH.corrupt_pending };
        break;
      }
      if (/\[2\/4\]|matchmaking|ingame_id\s*=/i.test(s)) idx = Math.max(idx, 3);
      if (/matchmaking failed|MATCHMAKING ERROR/i.test(s)) {
        hardErr = { id: "match", msg: ERR_TH.matchmaking_failed };
        break;
      }
      if (/\[3\/4\]|playing \+|submitted run_end|quit acknowledged/i.test(s)) {
        idx = Math.max(idx, 4);
      }
      if (/\[4\/4\]|claiming reward|not finalized|REWARD CLAIMED/i.test(s)) {
        idx = Math.max(idx, 5);
      }
      if (/claim_timeout|could not claim/i.test(s)) {
        hardErr = { id: "claim", msg: ERR_TH.claim_timeout };
        break;
      }
    }
    setPipelineActive(idx);
    if (hardErr) markPipelineError(hardErr.id, hardErr.msg);
  }

  function renderPipeline() {
    const wrap = $("farm-log-wrap");
    const list = $("farm-log");
    const empty = $("farm-empty");
    if (!wrap || !list) return;
    wrap.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
    list.innerHTML = "";
    if (!pipelineState) return;

    for (const s of PIPELINE_STEPS) {
      const kind = pipelineState.kinds[s.id] || "idle";
      if (kind === "idle") continue;
      const li = document.createElement("li");
      const label =
        kind === "pending"
          ? "กำลัง" + s.label + "…"
          : kind === "ok"
            ? s.label + "แล้ว"
            : s.label + "ไม่สำเร็จ";
      // Special polish for done step
      if (s.id === "done" && kind === "ok") li.textContent = "สำเร็จแล้ว";
      else if (s.id === "done" && kind === "pending") li.textContent = "กำลังสรุปผล…";
      else if (s.id === "login" && kind === "ok") li.textContent = "เข้าสู่ระบบเกมแล้ว";
      else if (s.id === "clear" && kind === "ok") li.textContent = "เคลียร์รางวัลค้างแล้ว";
      else if (s.id === "match" && kind === "ok") li.textContent = "จับคู่สำเร็จ";
      else if (s.id === "run" && kind === "ok") li.textContent = "จบการวิ่งแล้ว";
      else if (s.id === "claim" && kind === "ok") li.textContent = "รับรางวัลเรียบร้อย";
      else li.textContent = label;
      li.classList.add(kind === "pending" ? "pending" : kind);
      list.appendChild(li);
    }
    for (const extra of pipelineState.extras || []) {
      const li = document.createElement("li");
      li.textContent = extra.text;
      li.classList.add(extra.kind || "ok");
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
    pipelineState = freshPipeline();
    setPipelineActive(0);
    let tick = 0;
    stageTimer = setInterval(() => {
      tick += 1;
      const softIdx = Math.min(tick, 4);
      if (
        pipelineState &&
        pipelineState.kinds.done !== "ok" &&
        !PIPELINE_STEPS.some((s) => pipelineState.kinds[s.id] === "err")
      ) {
        if (softIdx > pipelineState.activeIdx) setPipelineActive(softIdx);
      }
      if (tick >= 4) clearStageTimer();
    }, 5000);
  }

  function buildFinalPipeline(rawLogs, result, ok) {
    clearStageTimer();
    pipelineState = freshPipeline();
    if (ok) {
      applyLogsToPipeline(rawLogs);
      finalizePipelineSuccess(result);
      return;
    }
    applyLogsToPipeline(rawLogs);
    const errCode = String(result?.error || "");
    let failId = "done";
    if (/login/i.test(errCode)) failId = "login";
    else if (/corrupt/i.test(errCode)) failId = "clear";
    else if (/matchmaking/i.test(errCode)) failId = "match";
    else if (/claim/i.test(errCode)) failId = "claim";
    else if (/ingame|farm/i.test(errCode)) failId = "run";
    const alreadyErr = PIPELINE_STEPS.some((s) => pipelineState.kinds[s.id] === "err");
    if (!alreadyErr) {
      markPipelineError(failId, farmErrorMessage(result, "การฟาร์มไม่สำเร็จ ลองใหม่อีกครั้ง"));
    } else if (!(pipelineState.extras || []).length) {
      pipelineState.extras = [
        { text: farmErrorMessage(result, "การฟาร์มไม่สำเร็จ ลองใหม่อีกครั้ง"), kind: "err" },
      ];
      renderPipeline();
    }
  }

  function farmErrorMessage(result, fallback) {
    const err = result?.error || fallback || "";
    return thError(err);
  }

  /* ---------- DevPlay autofill guards ---------- */
  function armReadonlyUnlock(el) {
    if (!el) return;
    const unlock = () => {
      el.removeAttribute("readonly");
    };
    el.addEventListener("focus", unlock);
    el.addEventListener("pointerdown", unlock);
    requestAnimationFrame(() => {
      if (el.value && document.activeElement !== el) {
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
    setTimeout(() => {
      if (mail && document.activeElement !== mail) mail.value = "";
      if (secret && document.activeElement !== secret) secret.value = "";
      if (mail) mail.setAttribute("readonly", "readonly");
      if (secret) secret.setAttribute("readonly", "readonly");
    }, 300);
  }

  async function runFarm() {
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    const btn = $("farm-btn");
    farmRunning = true;
    btn.disabled = true;
    setStatus($("farm-status"), "กำลังฟาร์ม… อาจใช้เวลาสักครู่", "muted");
    startLiveStages();

    try {
      const data = await api("/api/farm/run", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
          score: parseFarmNum($("farm-score").value),
          coin: parseFarmNum($("farm-coin").value),
          exp: parseFarmNum($("farm-exp").value),
        },
      });
      clearStageTimer();
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        paintProfile();
      } else {
        await refreshMe().catch(() => {});
      }

      const result = data.result || data;
      buildFinalPipeline(data.logs || data.steps || [], result, !!data.ok);

      if (data.ok) {
        setStatus($("farm-status"), "ฟาร์มสำเร็จ · หัก 1 โทเค็น", "ok");
      } else {
        const msg = farmErrorMessage(result, "ฟาร์มจบแล้วแต่มีปัญหา · โทเค็นถูกหักแล้ว");
        setStatus($("farm-status"), msg, "err");
        showErrorModal(msg, "ฟาร์มไม่สำเร็จ");
      }
    } catch (e) {
      clearStageTimer();
      const msg = thError(e.message) || "ฟาร์มไม่สำเร็จ";
      setStatus($("farm-status"), msg, "err");
      buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: e.message }, false);

      if (e.status === 402 || /insufficient_tokens/i.test(String(e.message))) {
        profile.token_balance = 0;
        paintProfile();
        showEmptyCoinsModal();
      } else {
        showErrorModal(msg, "ฟาร์มไม่สำเร็จ");
        if (typeof e.data?.token_balance === "number") {
          profile.token_balance = e.data.token_balance;
          paintProfile();
        }
      }
    } finally {
      farmRunning = false;
      updateFarmAvailability();
    }
  }

  /* ---------- Auth bootstrap ---------- */
  async function bootstrap() {
    const rememberEl = $("remember-me");
    if (rememberEl) {
      const pref = localStorage.getItem(REMEMBER_KEY);
      rememberEl.checked = pref !== "0";
    }

    setupDevPlayAutofillGuards();
    setupFarmNumberInputs();

    // Re-check balance when user returns from Telegram
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || !accessToken) return;
      if (modalMode !== "empty") return;
      try {
        await refreshMe();
      } catch (_) {}
    });

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
      setStatus(
        $("login-status"),
        thError(e.message) || "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
        "err"
      );
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
    if (farmRunning) return;

    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    const dpEmail = ($("dp-acct-mail").value || "").trim();
    const dpPass = $("dp-acct-secret").value || "";
    if (!dpEmail || !dpPass) {
      showErrorModal(
        "กรอกอีเมลและรหัสผ่าน DevPlay ของเกมให้ครบก่อนเริ่มฟาร์ม",
        "ข้อมูลไม่ครบ"
      );
      return;
    }

    const confirmed = await showConfirmModal();
    if (!confirmed) {
      setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
      return;
    }

    // Double-check balance after confirm (in case it changed)
    try {
      await refreshMe();
    } catch (_) {}

    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    await runFarm();
  });

  bootstrap();
})();
