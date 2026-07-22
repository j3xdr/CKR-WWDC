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
  const SESSION_KEY = "ckr_session_token";
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
  const modalCard = modalRoot?.querySelector(".modal-card") || null;
  const MOTION_CLOSE_MS = 320;

  function prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) {
      return false;
    }
  }

  /* ---------- Adaptive floating bg (assets_web/bg) ---------- */
  const BG_FLOAT_BASE = "assets_web/bg/";
  const BG_FLOAT_COUNT = 70;
  const BG_EDGE_ZONES = [
    { top: [4, 22], left: [2, 18] },
    { top: [4, 22], left: [78, 94] },
    { top: [28, 48], left: [1, 12] },
    { top: [28, 48], left: [86, 96] },
    { top: [52, 72], left: [2, 16] },
    { top: [52, 72], left: [82, 95] },
    { top: [74, 90], left: [8, 28] },
    { top: [74, 90], left: [70, 90] },
    { top: [8, 18], left: [36, 62] },
  ];

  function bgFloatCountForWidth(w) {
    if (w < 480) return 3;
    if (w < 768) return 5;
    if (w < 1100) return 7;
    return 9;
  }

  function bgFloatSizeRange(w) {
    if (w < 480) return [36, 52];
    if (w < 768) return [40, 60];
    return [44, 72];
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function initBgFloaters() {
    const root = $("bg-floaters");
    if (!root) return;

    let lastCount = -1;
    let resizeTimer = 0;

    function rebuild() {
      const w = window.innerWidth || document.documentElement.clientWidth || 1024;
      const count = bgFloatCountForWidth(w);
      if (count === lastCount && root.childElementCount === count) return;
      lastCount = count;

      const indices = Array.from({ length: BG_FLOAT_COUNT }, (_, i) => i + 1);
      shuffleInPlace(indices);
      const picked = indices.slice(0, count);
      const zones = BG_EDGE_ZONES.slice();
      shuffleInPlace(zones);
      const [minW, maxW] = bgFloatSizeRange(w);

      root.replaceChildren();
      for (let i = 0; i < picked.length; i++) {
        const n = String(picked[i]).padStart(2, "0");
        const zone = zones[i % zones.length];
        const img = document.createElement("img");
        img.className = "float-deco";
        img.alt = "";
        img.decoding = "async";
        img.draggable = false;
        img.src = `${BG_FLOAT_BASE}upgrade02_${n}_shop.png`;
        const width = Math.round(randBetween(minW, maxW));
        const top = randBetween(zone.top[0], zone.top[1]);
        const left = randBetween(zone.left[0], zone.left[1]);
        const duration = randBetween(9, 16);
        const delay = -randBetween(0, 12);
        img.style.width = `${width}px`;
        img.style.top = `${top}%`;
        img.style.left = `${left}%`;
        img.style.animationDuration = `${duration.toFixed(1)}s`;
        img.style.animationDelay = `${delay.toFixed(1)}s`;
        root.appendChild(img);
      }
    }

    rebuild();
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(rebuild, 180);
    });
  }

  function animateOpen(root) {
    if (!root) return;
    root.classList.remove("hidden", "is-closing");
    root.setAttribute("aria-hidden", "false");
    void root.offsetWidth;
    requestAnimationFrame(() => {
      root.classList.add("is-open");
    });
  }

  function animateClose(root, onDone, opts = {}) {
    const instant = !!opts.instant || prefersReducedMotion();
    if (!root) {
      if (typeof onDone === "function") onDone();
      return;
    }
    const finish = () => {
      root.classList.add("hidden");
      root.classList.remove("is-open", "is-closing");
      root.setAttribute("aria-hidden", "true");
      if (typeof onDone === "function") onDone();
    };
    if (instant || root.classList.contains("hidden")) {
      finish();
      return;
    }
    root.classList.add("is-closing");
    setTimeout(finish, MOTION_CLOSE_MS);
  }

  let accessToken = null;
  let sessionToken = null;
  let profile = null;
  let stageTimer = null;
  let runStatusAutoCloseTimer = null;
  let balancePollTimer = null;
  let queuePollTimer = null;
  let modalMode = null; // "empty" | "confirm" | "error" | "queue" | "result" | "peek" | null
  let emptyModalDismissed = false; // user closed empty modal; don't auto-reopen
  let farmRunning = false;
  let peekRunning = false;
  let peekCooldownUntil = 0;
  let peekCooldownTimer = null;
  let selectedTopupTokens = 1;
  let topupPackages = [];
  let topupBusy = false;
  let topupExpandedPref = null; // kept for compat; vault is modal now
  let vaultOpen = false;
  let walletTutorialStep = 0;
  const WALLET_TUTORIAL_STEPS = [
    {
      img: "assets/wallet/wallet_1.jpg",
      shape: "wide",
      caption:
        "เปิดแอป TrueMoney Wallet แล้วแตะเมนู 「โอนเงิน」 บนหน้าหลัก",
    },
    {
      img: "assets/wallet/wallet_2.jpg",
      shape: "wide",
      caption: "เลือก 「ส่งซองทรูมันนี่」 จากรายการ",
    },
    {
      img: "assets/wallet/wallet_3.jpg",
      shape: "tall",
      caption:
        "เลือก 「ส่งให้คนเดียว」 → ใส่จำนวนเงินให้ตรงแพ็กที่เลือก → อายุซองอย่างน้อย 1 วัน",
    },
    {
      img: "assets/wallet/wallet_4.jpg",
      shape: "tall",
      caption: "ตรวจรายละเอียดและเลือกธีม แล้วกด 「ยืนยัน」",
    },
    {
      img: "assets/wallet/wallet_5.jpg",
      shape: "tall",
      caption:
        "เมื่อสร้างสำเร็จ กด 「แชร์ลิงก์」 หรือคัดลอกลิงก์ แล้วนำไปวางในตู้เติมโทเค็น",
    },
  ];
  let lastGate = null;
  let runStatusClosable = false;
  let pendingAfterRunStatus = null;
  let apiReady = false;
  const PEEK_COOLDOWN_SEC = 180;
  const PEEK_CD_KEY = "ckr_peek_cd_until";

  const ERR_TH = {
    insufficient_tokens: "coins หมด กรุณาเติม",
    insufficient_tokens_for_peek:
      "ต้องมีโทเค็นถึงจะดูสถานะบัญชีเกมได้ (ไม่หักโทเค็น)",
    peek_rate_limited: "ดูสถานะถี่เกินไป รอให้ครบเวลาก่อน",
    peek_failed: "ดูสถานะบัญชีเกมไม่สำเร็จ ลองใหม่",
    topup_rate_limited: "เติมถี่เกินไป รอสักครู่แล้วลองใหม่",
    topup_voucher_blocked: "ซองนี้ถูกลองผิดหลายครั้ง รอสักครู่แล้วลองใหม่",
    topup_not_configured: "ระบบเติมเงินยังไม่พร้อม ลองใหม่ภายหลัง",
    invalid_package: "แพ็กที่เลือกไม่ถูกต้อง",
    voucher_already_used: "ซองนี้ถูกใช้เติมไปแล้ว",
    CONDITION_NOT_MET: "ยอดซองไม่ตรงกับแพ็กที่เลือก",
    VOUCHER_OUT_OF_STOCK: "ซองนี้ถูกใช้หมดแล้ว",
    VOUCHER_NOT_FOUND: "ไม่พบซองนี้",
    VOUCHER_EXPIRED: "ซองหมดอายุแล้ว",
    CANNOT_GET_OWN_VOUCHER:
      "รับซองของตัวเองไม่ได้ — ต้องให้ลูกค้า (เบอร์อื่น) สร้างซองแล้วส่งลิงก์มา",
    TARGET_USER_REDEEMED: "เบอร์นี้รับซองนี้ไปแล้ว",
    INVALID_VOUCHER_CODE: "ลิงก์หรือโค้ดซองไม่ถูกต้อง",
    INVALID_PHONE_NUMBER: "เบอร์รับเงินไม่ถูกต้อง",
    MAINTENANCE: "ระบบซองอั่งเปาปิดปรับปรุงชั่วคราว",
    TIMEOUT: "เชื่อมต่อ TrueMoney หมดเวลา",
    NETWORK_ERROR: "เชื่อมต่อ TrueMoney ไม่ได้",
    topup_credit_failed: "รับซองแล้วแต่เติมโทเค็นไม่สำเร็จ — ติดต่อแอดมิน",
    session_replaced: "มีการเข้าสู่ระบบจากที่อื่น — กรุณาเข้าสู่ระบบใหม่",
    account_banned: "บัญชีถูกระงับ กรุณาติดต่อแอดมิน",
    maintenance: "ระบบปิดปรับปรุงชั่วคราว ลองใหม่ภายหลัง",
    value_capped:
      "ใส่ได้สูงสุด " + INT32_MAX.toLocaleString("th-TH") + " (Int32) ต่อช่อง",
    farm_busy: "ระบบกำลังยุ่งอยู่ ลองใหม่อีกสักครู่",
    farm_error: "การฟาร์มล้มเหลว ลองใหม่อีกครั้ง",
    consume_failed: "หักโทเค็นไม่สำเร็จ ลองใหม่อีกครั้ง",
    login_no_session: "เข้าสู่ระบบไม่สำเร็จ",
    network_error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง",
    Invalid: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    invalid_credentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    username_taken: "ชื่อผู้ใช้นี้ถูกใช้แล้ว ลองชื่ออื่น",
    password_mismatch: "รหัสผ่านกับยืนยันรหัสผ่านไม่ตรงกัน",
    invalid_username: "ชื่อผู้ใช้ไม่ถูกต้อง (ห้ามใช้อีเมล)",
    signup_rate_limited: "สมัครถี่เกินไป รอสักครู่แล้วลองใหม่",
    service_role_not_configured: "ระบบสมัครยังไม่พร้อม ลองใหม่ภายหลัง",
    auth_not_configured: "ระบบยืนยันตัวตนยังไม่พร้อม",
    register_session_failed: "สมัครสำเร็จแต่เข้าสู่ระบบอัตโนมัติไม่ได้ ลองล็อกอินเอง",
    login_failed: "เข้าสู่ระบบเกมไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน DevPlay",
    LOGIN_FAILED: "เข้าสู่ระบบเกมไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน DevPlay",
    corrupt_pending:
      "บัญชีติดรางวัลค้างจากรอบก่อน รอรีเซ็ตประจำวันแล้วลองใหม่ (ลด XP)",
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
    if (/Cannot redeem your voucher by yourself|own voucher/i.test(s)) {
      return ERR_TH.CANNOT_GET_OWN_VOUCHER;
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
    el.classList.remove("is-fresh");
    void el.offsetWidth;
    el.textContent = text || "";
    el.className = "status " + (kind || "muted") + (text ? " is-fresh" : "");
  }

  function loadStoredSessionToken() {
    try {
      return (
        sessionStorage.getItem(SESSION_KEY) ||
        localStorage.getItem(SESSION_KEY) ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function persistSessionToken(token) {
    sessionToken = token || null;
    try {
      if (!sessionToken) {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      if (wantsRemember()) {
        localStorage.setItem(SESSION_KEY, sessionToken);
        sessionStorage.removeItem(SESSION_KEY);
      } else {
        sessionStorage.setItem(SESSION_KEY, sessionToken);
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (_) {}
  }

  function clearSessionToken() {
    persistSessionToken(null);
  }

  function paintApiStatus(state, text) {
    const el = $("api-status");
    if (!el) return;
    el.className = "api-chip is-" + (state || "waking");
    el.textContent = text || "";
  }

  async function pingApiHealth(retries) {
    const tries = Math.max(1, Number(retries) || 1);
    paintApiStatus("waking", "กำลังปลุกเซิร์ฟเวอร์…");
    for (let i = 0; i < tries; i++) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => {
        try {
          ctrl?.abort();
        } catch (_) {}
      }, 4500);
      try {
        const res = await fetch(API + "/api/health", {
          method: "GET",
          signal: ctrl?.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          apiReady = true;
          paintApiStatus("ready", "API พร้อม");
          try {
            const data = await res.json();
            paintMaintenanceBanner(data);
          } catch (_) {
            paintMaintenanceBanner(null);
          }
          return true;
        }
      } catch (_) {
        clearTimeout(timer);
      }
      if (i < tries - 1) {
        paintApiStatus("waking", "กำลังปลุกเซิร์ฟเวอร์…");
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    apiReady = false;
    paintApiStatus("down", "API ยังไม่พร้อม");
    return false;
  }

  function paintMaintenanceBanner(health) {
    const el = $("maintenance-banner");
    if (!el) return;
    const farm = !!(health && health.farm_maintenance);
    const topup = !!(health && health.topup_maintenance);
    if (!farm && !topup) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    const parts = [];
    if (farm) parts.push("ฟาร์ม");
    if (topup) parts.push("เติมเงิน");
    el.textContent = "ปิดปรับปรุงชั่วคราว: " + parts.join(" · ");
    el.classList.remove("hidden");
  }

  async function ensureApiReady() {
    if (apiReady) return true;
    return pingApiHealth(2);
  }

  async function handleSessionReplaced() {
    try {
      await sb.auth.signOut();
    } catch (_) {}
    accessToken = null;
    profile = null;
    clearSessionToken();
    showLogin();
    showErrorModal(ERR_TH.session_replaced, "มีการเข้าสู่ระบบจากที่อื่น");
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

  function openModal({ mode, title, body, icon, locked, bodyHtml }) {
    modalMode = mode;
    modalTitle.textContent = title;
    if (bodyHtml) {
      modalBody.innerHTML = bodyHtml;
    } else {
      modalBody.textContent = body || "";
    }
    modalIcon.src = icon || "assets/coin.png";
    modalRoot.classList.toggle("locked", !!locked);
    const closeBtn = $("modal-close");
    if (closeBtn) {
      closeBtn.classList.toggle("is-hidden", !!locked);
      closeBtn.disabled = !!locked;
    }
    if (modalCard) {
      modalCard.classList.remove("is-shake");
      void modalCard.offsetWidth;
      if (mode === "error") modalCard.classList.add("is-shake");
    }
    animateOpen(modalRoot);
  }

  function closeModal() {
    if (modalMode === "queue") return;
    if (modalMode === "empty") emptyModalDismissed = true;
    modalMode = null;
    clearModalActions();
    clearPixelConfetti();
    animateClose(modalRoot, () => {
      modalRoot.classList.remove("locked");
      if (modalCard) modalCard.classList.remove("is-shake");
      stopBalancePoll();
    });
  }

  function forceCloseModal() {
    modalMode = null;
    clearModalActions();
    clearPixelConfetti();
    animateClose(
      modalRoot,
      () => {
        modalRoot.classList.remove("locked");
        if (modalCard) modalCard.classList.remove("is-shake");
        stopBalancePoll();
      },
      { instant: true }
    );
  }

  function showEmptyCoinsModal() {
    emptyModalDismissed = false;
    clearModalActions();
    openModal({
      mode: "empty",
      title: "โทเค็นหมดแล้ว",
      body: "เติมเองได้ทันที — เปิดตู้เติมโทเค็น เลือกแพ็ก แล้ววางลิงก์ซอง TrueMoney ไม่ต้องรอแอดมิน",
      icon: "assets/coin.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ไปเติมโทเค็น", "btn-candy", () => {
        closeModal();
        openVaultModal({ focusVoucher: true });
      })
    );
    modalActions.appendChild(
      makeBtn("ตรวจสอบยอดอีกครั้ง", "btn-run btn-wide", async () => {
        try {
          await refreshMe();
          if (hasTokens()) {
            forceCloseModal();
            setStatus($("farm-status"), "เติมโทเค็นแล้ว พร้อมวิ่งฟาร์ม", "ok");
          } else {
            setStatus(
              $("farm-status"),
              "ยังมียอดเป็น 0 — กด Coin Vault เพื่อเติมโทเค็นได้เลย",
              "err"
            );
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

  function showResultModal(summary) {
    const rows = [
      ["บัญชีเกม", escapeHtml(summary.account || "—")],
      [
        "เหรียญ",
        `<span class="result-delta">+${escapeHtml(summary.coinDelta)}</span> → ยอดรวม ${escapeHtml(summary.coinTotal)}`,
      ],
      [
        "XP",
        `<span class="result-delta">+${escapeHtml(summary.xpDelta)}</span> → ยอดรวม ${escapeHtml(summary.xpTotal)}`,
      ],
      [
        "โทเค็นเว็บ",
        `${escapeHtml(summary.tokensBefore)} → ${escapeHtml(summary.tokensAfter)} <span class="result-delta">(หัก 1)</span>`,
      ],
    ];
    const html =
      '<table class="result-table"><tbody>' +
      rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">ถ้าในเกมยังไม่เห็นยอด ให้ปิดเกมแล้วเข้าใหม่</p>';

    clearModalActions();
    openModal({
      mode: "result",
      title: "สรุปผลการฟาร์ม",
      bodyHtml: html,
      icon: "assets/coin.png",
      locked: false,
    });
    spawnPixelConfetti();
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function clearPixelConfetti() {
    const layer = $("modal-confetti");
    if (!layer) return;
    layer.classList.remove("is-active");
    layer.replaceChildren();
  }

  function spawnPixelConfetti() {
    const layer = $("modal-confetti");
    if (!layer) return;
    clearPixelConfetti();
    if (prefersReducedMotion()) return;
    const colors = ["#f0b429", "#f6e7c8", "#e23d2e", "#3ecf8e", "#ffd36a", "#ff8a5b"];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 20; i++) {
      const bit = document.createElement("span");
      bit.className = "pixel-bit";
      const size = 4 + Math.floor(Math.random() * 5);
      bit.style.width = size + "px";
      bit.style.height = size + "px";
      bit.style.left = Math.random() * 100 + "%";
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty("--dx", Math.round(Math.random() * 80 - 40) + "px");
      bit.style.setProperty("--delay", (Math.random() * 0.45).toFixed(2) + "s");
      bit.style.setProperty("--dur", (1.5 + Math.random() * 1.1).toFixed(2) + "s");
      frag.appendChild(bit);
    }
    layer.appendChild(frag);
    layer.classList.add("is-active");
    setTimeout(() => clearPixelConfetti(), 2800);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stopQueuePoll() {
    if (queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
  }

  function startQueuePoll() {
    stopQueuePoll();
    queuePollTimer = setInterval(() => {
      refreshGateAndQueueUi().catch(() => {});
    }, 2500);
  }

  function turnCountdownText(iso) {
    if (!iso) return "";
    const end = Date.parse(iso);
    if (!Number.isFinite(end)) return "";
    const sec = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function renderQueueModal(gate, opts = {}) {
    lastGate = gate || lastGate;
    const g = lastGate || {};
    const me = g.me || {};
    const waking = !!opts.waking;
    let bodyHtml = '<div class="queue-panel">';
    bodyHtml += '<div class="queue-spinner" aria-hidden="true"></div>';

    if (waking) {
      bodyHtml +=
        '<p class="queue-note">กำลังปลุกเซิร์ฟเวอร์… รอสักครู่แล้วระบบจะเข้าคิวให้อัตโนมัติ</p>';
    } else if (me.status === "active" || g.is_my_turn) {
      const left = turnCountdownText(me.turn_expires_at);
      bodyHtml +=
        '<div class="queue-stat"><span>สถานะ</span><strong>ถึงคิวของคุณแล้ว</strong></div>';
      bodyHtml +=
        '<div class="queue-stat"><span>เหลือเวลาเริ่มฟาร์ม</span><strong>' +
        escapeHtml(left || "2:00") +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note warn">ต้องกดเริ่มฟาร์มภายใน 2 นาที ไม่งั้นคิวจะข้ามไปคนถัดไป</p>';
    } else if (me.status === "waiting") {
      bodyHtml +=
        '<div class="queue-stat"><span>คิวของคุณ</span><strong>อันดับ ' +
        escapeHtml(me.position ?? "—") +
        "</strong></div>";
      bodyHtml +=
        '<div class="queue-stat"><span>ในคิวทั้งหมด</span><strong>' +
        escapeHtml(g.queue_length ?? 0) +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note">รอคิวอยู่ — ปิดหน้าต่างไม่ได้ จนกว่าจะถึงคิวของคุณ</p>';
    } else if (g.farm_busy) {
      bodyHtml +=
        '<div class="queue-stat"><span>สถานะ</span><strong>มีคนกำลังฟาร์ม</strong></div>';
      bodyHtml +=
        '<div class="queue-stat"><span>ในคิว</span><strong>' +
        escapeHtml(g.queue_length ?? 0) +
        "</strong></div>";
      bodyHtml +=
        '<p class="queue-note">กดเข้าคิวเพื่อจองลำดับ — คนกดก่อนได้คิวก่อน</p>';
    } else {
      bodyHtml +=
        '<p class="queue-note">ระบบกำลังจัดคิว…</p>';
    }
    bodyHtml += "</div>";

    clearModalActions();
    openModal({
      mode: "queue",
      title: waking ? "กำลังเชื่อมต่อเซิร์ฟเวอร์" : "คิวฟาร์ม",
      bodyHtml,
      icon: "assets/tr_event_116.png",
      locked: true,
    });

    if (!waking && !me.status && g.farm_busy) {
      modalActions.appendChild(
        makeBtn("เข้าคิว", "btn-candy", async () => {
          try {
            const data = await api("/api/farm/queue/join", { method: "POST", body: {} });
            renderQueueModal(data);
            startQueuePoll();
          } catch (e) {
            showErrorModal(thError(e.message) || "เข้าคิวไม่สำเร็จ", "คิว");
          }
        })
      );
    } else if (me.status === "active" || g.is_my_turn) {
      modalActions.appendChild(
        makeBtn("เริ่มฟาร์มเลย", "btn-run", () => {
          forceCloseModal();
          stopQueuePoll();
          $("farm-btn")?.focus();
          setStatus($("farm-status"), "ถึงคิวแล้ว — กดเริ่มฟาร์มได้เลย", "ok");
        })
      );
    }
  }

  async function refreshGateAndQueueUi() {
    if (!accessToken) return null;
    try {
      const data = await api("/api/farm/gate");
      lastGate = data;
      if (data.is_my_turn || data.me?.status === "waiting" || data.me?.status === "active") {
        renderQueueModal(data);
        startQueuePoll();
      } else if (modalMode === "queue" && !data.farm_busy && !data.me?.status) {
        forceCloseModal();
        stopQueuePoll();
      } else if (modalMode === "queue") {
        renderQueueModal(data);
      }
      return data;
    } catch (e) {
      if (/network|Failed to fetch|network_error/i.test(String(e.message))) {
        renderQueueModal(lastGate || { farm_busy: true, queue_length: 0 }, { waking: true });
        startQueuePoll();
      }
      return null;
    }
  }

  function setupXpCalculator() {
    const card = $("xp-calc-card");
    const openBtn = $("xp-calc-open");
    const closeBtn = $("xp-calc-close");
    const applyBtn = $("xp-calc-apply");
    const cur = $("xp-cur");
    const tgt = $("xp-tgt");
    const out = $("xp-calc-result");
    if (!card || !openBtn || !window.CKR_LEVEL_XP) return;

    function refresh() {
      const xp = window.CKR_LEVEL_XP.calculateRequiredXp(cur.value, tgt.value);
      if (xp == null) {
        out.innerHTML = "ใส่เลเวล 1–110 ให้ถูกต้อง";
        return;
      }
      out.innerHTML =
        "ต้องใช้ <strong>" + formatNumTh(xp) + "</strong> XP";
      out.dataset.xp = String(xp);
    }

    openBtn.addEventListener("click", () => {
      card.classList.remove("hidden");
      card.hidden = false;
      animateOpen(card);
      refresh();
    });
    closeBtn?.addEventListener("click", () => {
      animateClose(card, () => {
        card.hidden = true;
      });
    });
    cur?.addEventListener("input", refresh);
    tgt?.addEventListener("input", refresh);
    applyBtn?.addEventListener("click", () => {
      refresh();
      const xp = Number(out.dataset.xp || 0);
      const expInput = $("farm-exp");
      if (!expInput || !Number.isFinite(xp) || xp < 0) return;
      expInput.value = formatCommas(String(Math.trunc(xp)));
      syncFarmNumField(expInput, { silent: true });
      animateClose(card, () => {
        card.hidden = true;
      });
      setStatus($("farm-status"), "ใส่ XP จากเครื่องคิดเลขแล้ว", "ok");
    });
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

  function hasDevPlayCreds() {
    const mail = ($("dp-acct-mail")?.value || "").trim();
    const secret = $("dp-acct-secret")?.value || "";
    return !!(mail && secret);
  }

  function updateFarmAvailability() {
    const btn = $("farm-btn");
    const peekBtn = $("peek-btn");
    const empty = !hasTokens();
    const peekCdLeft = peekCooldownRemaining();
    const credsReady = hasDevPlayCreds();
    const peekWaiting = farmRunning || peekRunning || peekCdLeft > 0;

    if (btn && !farmRunning) {
      // Keep clickable when empty so user can reopen the fill-tokens modal
      btn.disabled = peekRunning;
    }
    if (peekBtn) {
      peekBtn.disabled = peekWaiting || !credsReady;
    }
    setFarmInputsLocked(empty);
    paintPeekCooldown();
    syncTopupPanel();
    if (empty && userView && !userView.classList.contains("hidden")) {
      if (modalMode !== "empty" && !emptyModalDismissed) showEmptyCoinsModal();
    } else if (!empty) {
      emptyModalDismissed = false;
      if (modalMode === "empty") forceCloseModal();
    }
  }

  function lockBodyScroll(lockClass) {
    const sb =
      window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty(
      "--scrollbar-compensation",
      Math.max(0, sb) + "px"
    );
    document.body.classList.add(lockClass);
  }

  function unlockBodyScroll(lockClass) {
    document.body.classList.remove(lockClass);
    if (
      !document.body.classList.contains("vault-open") &&
      !document.body.classList.contains("tutorial-open")
    ) {
      document.documentElement.style.removeProperty("--scrollbar-compensation");
    }
  }

  function openVaultModal(opts = {}) {
    const root = $("vault-modal");
    const toggle = $("topup-toggle");
    if (!root) return;
    vaultOpen = true;
    animateOpen(root);
    lockBodyScroll("vault-open");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    syncVaultDoorCopy();
    if (opts.focusVoucher) {
      const voucher = $("topup-voucher");
      if (voucher) setTimeout(() => voucher.focus(), 220);
    }
  }

  function closeVaultModal() {
    const root = $("vault-modal");
    const toggle = $("topup-toggle");
    if (!root) return;
    vaultOpen = false;
    unlockBodyScroll("vault-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    syncVaultDoorCopy();
    animateClose(root);
  }

  function syncVaultDoorCopy() {
    const title = $("topup-title");
    const hint = $("topup-head-hint");
    const empty = !hasTokens();
    // Keep door-card copy stable while modal is open — changing text caused layout jump.
    // Modal has its own #vault-modal-title; door only reflects empty vs ready CTA.
    if (title) {
      title.textContent = empty ? "ตู้เติมโทเค็น" : "เติมโทเค็น";
    }
    if (hint) {
      hint.textContent = empty
        ? "เลือกแท็บ → สร้างซอง → วางลิงก์"
        : "แตะเพื่อเปิดตู้";
    }
  }

  function syncTopupPanel(opts = {}) {
    const toggle = $("topup-toggle");
    if (!toggle) return;

    const forceOpen = !!opts.forceOpen;
    if (forceOpen) {
      openVaultModal({ focusVoucher: !!opts.focusVoucher });
      return;
    }

    syncVaultDoorCopy();
  }

  function paintWalletTutorial() {
    const step = WALLET_TUTORIAL_STEPS[walletTutorialStep];
    if (!step) return;
    const img = $("wallet-tutorial-img");
    const media = $("wallet-tutorial-media");
    const caption = $("wallet-tutorial-caption");
    const progress = $("wallet-tutorial-progress");
    const prev = $("wallet-tutorial-prev");
    const next = $("wallet-tutorial-next");
    const dots = $("wallet-tutorial-dots");

    if (img) {
      img.classList.add("is-switching");
      if (caption) caption.classList.add("is-switching");
      img.src = step.img;
      img.alt =
        "ขั้นตอนที่ " +
        (walletTutorialStep + 1) +
        " จาก " +
        WALLET_TUTORIAL_STEPS.length;
      requestAnimationFrame(() => {
        img.classList.remove("is-switching");
        if (caption) caption.classList.remove("is-switching");
      });
    }
    if (media) {
      media.classList.toggle("is-wide", step.shape === "wide");
      media.classList.toggle("is-tall", step.shape === "tall");
      media.scrollTop = 0;
    }
    if (caption) caption.textContent = step.caption;
    if (progress) {
      progress.textContent =
        walletTutorialStep + 1 + " / " + WALLET_TUTORIAL_STEPS.length;
    }
    if (prev) prev.disabled = walletTutorialStep <= 0;
    if (next) {
      const last = walletTutorialStep >= WALLET_TUTORIAL_STEPS.length - 1;
      next.textContent = last ? "ปิด" : "ถัดไป ›";
    }
    if (dots) {
      if (dots.childElementCount !== WALLET_TUTORIAL_STEPS.length) {
        dots.innerHTML = "";
        WALLET_TUTORIAL_STEPS.forEach((_, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "wallet-tutorial-dot";
          b.setAttribute("aria-label", "ไปขั้นตอนที่ " + (i + 1));
          b.addEventListener("click", () => {
            walletTutorialStep = i;
            paintWalletTutorial();
          });
          dots.appendChild(b);
        });
      }
      Array.from(dots.children).forEach((el, i) => {
        el.classList.toggle("is-active", i === walletTutorialStep);
        el.setAttribute(
          "aria-current",
          i === walletTutorialStep ? "step" : "false"
        );
      });
    }
  }

  function openWalletTutorial() {
    const root = $("wallet-tutorial");
    if (!root) return;
    walletTutorialStep = 0;
    paintWalletTutorial();
    animateOpen(root);
    lockBodyScroll("tutorial-open");
  }

  function closeWalletTutorial() {
    const root = $("wallet-tutorial");
    if (!root) return;
    unlockBodyScroll("tutorial-open");
    animateClose(root);
  }

  function peekCooldownRemaining() {
    return Math.max(0, Math.ceil((peekCooldownUntil - Date.now()) / 1000));
  }

  function peekCdStorageKey() {
    const id = profile?.id || "anon";
    return PEEK_CD_KEY + ":" + id;
  }

  function persistPeekCooldown() {
    try {
      if (peekCooldownUntil > Date.now()) {
        sessionStorage.setItem(peekCdStorageKey(), String(peekCooldownUntil));
      } else {
        sessionStorage.removeItem(peekCdStorageKey());
      }
    } catch (_) {}
  }

  function restorePeekCooldown() {
    try {
      const raw = sessionStorage.getItem(peekCdStorageKey());
      const until = Number(raw || 0);
      if (until > Date.now()) {
        startPeekCooldown(Math.ceil((until - Date.now()) / 1000));
      }
    } catch (_) {}
  }

  function formatPeekCountdown(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return mm + ":" + ss;
  }

  function paintPeekCooldown() {
    const el = $("peek-cooldown");
    if (!el) return;
    const left = peekCooldownRemaining();
    if (left > 0) {
      el.textContent = "ดูสถานะได้อีกครั้งใน " + formatPeekCountdown(left);
      el.classList.add("is-active");
    } else {
      el.textContent = hasTokens()
        ? "ไม่หักโทเค็น · ใช้ได้ทุก 3 นาที"
        : "ต้องมีโทเค็นถึงจะดูสถานะได้ (ไม่หัก)";
      el.classList.remove("is-active");
    }
  }

  function startPeekCooldown(retryAfterSec) {
    const sec = Math.max(0, Number(retryAfterSec) || PEEK_COOLDOWN_SEC);
    peekCooldownUntil = Date.now() + sec * 1000;
    persistPeekCooldown();
    if (peekCooldownTimer) clearInterval(peekCooldownTimer);
    paintPeekCooldown();
    updateFarmAvailability();
    peekCooldownTimer = setInterval(() => {
      if (peekCooldownRemaining() <= 0) {
        clearInterval(peekCooldownTimer);
        peekCooldownTimer = null;
        peekCooldownUntil = 0;
        persistPeekCooldown();
      }
      paintPeekCooldown();
      updateFarmAvailability();
    }, 1000);
  }

  function showPeekResultModal(data) {
    const dash = (v) =>
      v === null || v === undefined || v === "" ? "—" : formatNumTh(v);
    const treas = Array.isArray(data.treas) ? data.treas.join(", ") : "";
    const rows = [
      ["ชื่อในเกม", escapeHtml(data.nickname || "—")],
      ["เลเวล", escapeHtml(dash(data.level))],
      ["เหรียญ", escapeHtml(dash(data.coin))],
      ["XP", escapeHtml(dash(data.exp))],
      ["เทียร์", escapeHtml(dash(data.tier))],
      ["คุกกี้", escapeHtml(dash(data.cookie))],
      ["สัตว์เลี้ยง", escapeHtml(dash(data.pet))],
      ["สมบัติ", escapeHtml(treas || "—")],
    ];
    const html =
      '<table class="result-table"><tbody>' +
      rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">ไม่หักโทเค็น · กรอกคะแนน/เหรียญ/XP แล้วกดฟาร์มได้ตามปกติ</p>';

    clearModalActions();
    openModal({
      mode: "peek",
      title: "สถานะบัญชีเกม",
      bodyHtml: html,
      icon: "assets/crc_cookie_stone_box.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function renderFarmHistory(items) {
    const root = $("farm-history");
    if (!root) return;
    root.innerHTML = "";
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      root.innerHTML = '<li class="muted">ยังไม่มีประวัติ</li>';
      return;
    }
    list.slice(0, 8).forEach((row) => {
      const li = document.createElement("li");
      const st = row.status || "—";
      const stLabel =
        st === "succeeded"
          ? "สำเร็จ"
          : st === "failed"
            ? "ล้มเหลว"
            : st === "running"
              ? "กำลังรัน"
              : st;
      const stClass = st === "succeeded" ? "hist-ok" : st === "failed" ? "hist-warn" : "";
      li.innerHTML =
        "<span>S " +
        escapeHtml(formatNumTh(row.score)) +
        " · C " +
        escapeHtml(formatNumTh(row.coin)) +
        " · XP " +
        escapeHtml(formatNumTh(row.exp)) +
        "</span>" +
        '<span class="' +
        stClass +
        '">' +
        stLabel +
        "</span>" +
        '<span class="hist-meta">' +
        escapeHtml(formatTopupDay(row.created_at)) +
        (row.error ? " · " + escapeHtml(String(row.error).slice(0, 60)) : "") +
        "</span>";
      root.appendChild(li);
    });
  }

  async function loadFarmHistory() {
    if (!accessToken) {
      renderFarmHistory([]);
      return;
    }
    try {
      const data = await api("/api/farm/history");
      renderFarmHistory(data.items || []);
    } catch (_) {}
  }

  function fallbackTopupPackages() {
    return [
      { tokens: 1, price_baht: 100, save_baht: 0, promo: false },
      { tokens: 2, price_baht: 200, save_baht: 0, promo: false },
      { tokens: 3, price_baht: 270, save_baht: 30, promo: true },
      { tokens: 4, price_baht: 340, save_baht: 60, promo: true },
      { tokens: 5, price_baht: 400, save_baht: 100, promo: true },
      { tokens: 6, price_baht: 450, save_baht: 150, promo: true },
      { tokens: 7, price_baht: 490, save_baht: 210, promo: true },
      { tokens: 8, price_baht: 520, save_baht: 280, promo: true },
      { tokens: 9, price_baht: 560, save_baht: 340, promo: true },
      { tokens: 10, price_baht: 600, save_baht: 400, promo: true },
    ];
  }

  function getTopupPackage(tokens) {
    const list = topupPackages.length ? topupPackages : fallbackTopupPackages();
    return list.find((p) => p.tokens === tokens) || list[0] || null;
  }

  function paintTopupSelected() {
    const el = $("topup-selected-text");
    const stepAmt = $("topup-step-amount");
    if (!el) return;
    const pkg = getTopupPackage(selectedTopupTokens);
    if (!pkg) {
      el.textContent = "—";
      if (stepAmt) stepAmt.textContent = "—";
      return;
    }
    let text =
      formatNumTh(pkg.price_baht) + "฿ · " + pkg.tokens + " Token";
    if (pkg.save_baht > 0) {
      text += " · คุ้ม " + formatNumTh(pkg.save_baht) + "฿";
    }
    el.textContent = text;
    if (stepAmt) stepAmt.textContent = formatNumTh(pkg.price_baht) + "฿";
  }

  function flashTopupDoor() {
    const door = $("topup-toggle");
    const panel = $("topup");
    const target = door || panel;
    if (!target) return;
    target.classList.remove("is-flash");
    void target.offsetWidth;
    target.classList.add("is-flash");
    setTimeout(() => target.classList.remove("is-flash"), 1000);
  }

  function formatTopupDay(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString("th-TH", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "—";
    }
  }

  function renderTopupHistory(items) {
    const root = $("topup-history");
    if (!root) return;
    root.innerHTML = "";
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      root.innerHTML = '<li class="muted">ยังไม่มีประวัติ</li>';
      return;
    }
    list.slice(0, 8).forEach((row) => {
      const li = document.createElement("li");
      const status = row.credit_status === "needs_manual" ? "ต้องตามมือ" : "สำเร็จ";
      const statusClass =
        row.credit_status === "needs_manual" ? "hist-warn" : "hist-ok";
      li.innerHTML =
        "<span>" +
        escapeHtml(row.tokens || "—") +
        " Token · " +
        escapeHtml(formatNumTh(row.amount_baht)) +
        "฿</span>" +
        '<span class="' +
        statusClass +
        '">' +
        status +
        "</span>" +
        '<span class="hist-meta">' +
        escapeHtml(formatTopupDay(row.created_at)) +
        "</span>";
      root.appendChild(li);
    });
  }

  async function loadTopupHistory() {
    if (!accessToken) {
      renderTopupHistory([]);
      return;
    }
    try {
      const data = await api("/api/topup/history");
      renderTopupHistory(data.items || []);
    } catch (_) {
      /* keep previous */
    }
  }

  async function copyTopupPrice() {
    const pkg = getTopupPackage(selectedTopupTokens);
    if (!pkg) return;
    const text = String(pkg.price_baht);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setStatus($("topup-status"), "คัดลอกราคา " + text + "฿ แล้ว", "ok");
    } catch (_) {
      setStatus($("topup-status"), "คัดลอกไม่สำเร็จ — จำราคา " + text + "฿", "err");
    }
  }

  function renderTopupPackages() {
    const root = $("topup-packages");
    if (!root) return;
    root.innerHTML = "";
    const list = topupPackages.length ? topupPackages : fallbackTopupPackages();
    const ROV_RANKS = [
      "bronze",
      "silver",
      "gold",
      "platinum",
      "diamond",
      "commander",
      "conqueror",
      "glorious",
    ];
    let promoIdx = 0;
    list.forEach((pkg) => {
      const selected = pkg.tokens === selectedTopupTokens;
      const promo = pkg.save_baht > 0 || pkg.promo;
      const rank = promo
        ? ROV_RANKS[Math.min(promoIdx, ROV_RANKS.length - 1)]
        : null;
      if (promo) promoIdx += 1;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "vault-ingot" +
        (selected ? " is-selected" : "") +
        (promo ? " is-promo" : "") +
        (rank ? " rank-" + rank : " rank-base");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      let badgeHtml = "";
      if (promo && rank) {
        badgeHtml =
          '<span class="vault-ingot-badge rank-' +
          rank +
          '" title="คุ้ม">คุ้ม</span>';
      }
      btn.innerHTML =
        badgeHtml +
        '<span class="vault-ingot-amt">' +
        escapeHtml(pkg.tokens) +
        "</span>" +
        '<span class="vault-ingot-unit">Token</span>' +
        '<span class="vault-ingot-price">' +
        escapeHtml(formatNumTh(pkg.price_baht)) +
        "฿</span>";
      btn.addEventListener("click", () => {
        selectedTopupTokens = pkg.tokens;
        renderTopupPackages();
      });
      root.appendChild(btn);
    });
    paintTopupSelected();
  }

  async function loadTopupPackages() {
    try {
      const data = await api("/api/topup/packages");
      topupPackages = Array.isArray(data.packages) ? data.packages : [];
    } catch (_) {
      topupPackages = fallbackTopupPackages();
    }
    if (!topupPackages.some((p) => p.tokens === selectedTopupTokens)) {
      selectedTopupTokens = topupPackages[0]?.tokens || 1;
    }
    renderTopupPackages();
  }

  function showTopupSuccessModal(data) {
    const rows = [
      ["แพ็ก", escapeHtml(data.package_tokens) + " token"],
      ["ยอดที่รับ", escapeHtml(formatNumTh(data.amount_baht)) + "฿"],
      ["โทเค็นที่เติม", "+" + escapeHtml(data.tokens_credited)],
      ["ยอดคงเหลือ", escapeHtml(data.token_balance)],
    ];
    const html =
      '<table class="result-table"><tbody>' +
      rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join("") +
      "</tbody></table>";
    clearModalActions();
    openModal({
      mode: "result",
      title: "เติมโทเค็นสำเร็จ",
      bodyHtml: html,
      icon: "assets/coin.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function formatApiDetail(detail) {
    if (detail == null) return "";
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && !Array.isArray(detail)) {
      if (detail.code === "farm_busy" || detail.message === "farm_busy") {
        return "farm_busy";
      }
      if (detail.code === "peek_rate_limited" || detail.message === "peek_rate_limited") {
        return "peek_rate_limited";
      }
      if (detail.code === "insufficient_tokens_for_peek") {
        return "insufficient_tokens_for_peek";
      }
      // Prefer machine code so thError can map TMN / API codes
      if (detail.code && typeof detail.code === "string") return detail.code;
      if (detail.message && typeof detail.message === "string") return detail.message;
      return detail.msg || detail.reason || "request_failed";
    }
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
          return "ค่าคะแนน/เหรียญ/XP ไม่ถูกต้องหรือเกินกำหนด";
        }
        return loc ? loc + ": " + msg : msg;
      });
      return parts.filter(Boolean).join(" · ") || "ข้อมูลไม่ถูกต้อง";
    }
    return String(detail);
  }

  async function api(path, options = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    if (sessionToken) headers["X-Session-Token"] = sessionToken;
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
      if (res.status === 401 && /session_replaced/i.test(String(detail))) {
        await handleSessionReplaced();
      }
      const err = new Error(detail);
      err.status = res.status;
      err.data = data;
      if (raw && typeof raw === "object" && raw.gate) err.gate = raw.gate;
      throw err;
    }
    return data;
  }

  function showApp() {
    loginView.classList.add("hidden");
    userView.classList.remove("hidden");
    $("logout-btn").classList.remove("hidden");
    $("nav-balance").classList.remove("hidden");
    restorePeekCooldown();
    updateFarmAvailability();
    refreshGateAndQueueUi().catch(() => {});
    loadTopupHistory().catch(() => {});
    loadFarmHistory().catch(() => {});
  }

  function showLogin() {
    stopBalancePoll();
    stopQueuePoll();
    forceCloseModal();
    forceCloseRunStatusPopup();
    loginView.classList.remove("hidden");
    userView.classList.add("hidden");
    $("logout-btn").classList.add("hidden");
    $("nav-balance").classList.add("hidden");
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

  function setRunStatusSubtitle(done, ok) {
    const sub = $("run-status-subtitle");
    if (!sub) return;
    sub.classList.remove("is-done", "is-fail");
    if (!done) {
      sub.textContent = "กำลังฟาร์ม… ห้ามปิดจนกว่าจะเสร็จ";
      return;
    }
    if (ok) {
      sub.textContent = "สำเร็จแล้ว — กำลังเปิดสรุปผล";
      sub.classList.add("is-done");
    } else {
      sub.textContent = "ไม่สำเร็จ — กด × เพื่อปิด";
      sub.classList.add("is-fail");
    }
  }

  function clearRunStatusAutoClose() {
    if (runStatusAutoCloseTimer) {
      clearTimeout(runStatusAutoCloseTimer);
      runStatusAutoCloseTimer = null;
    }
  }

  function setRunStatusClosable(done) {
    runStatusClosable = !!done;
    const btn = $("run-status-close");
    if (btn) btn.disabled = !runStatusClosable;
  }

  function openRunStatusPopup(running) {
    const root = $("run-status-root");
    if (!root) return;
    clearRunStatusAutoClose();
    animateOpen(root);
    setRunStatusClosable(!running);
    if (running) {
      pendingAfterRunStatus = null;
      setRunStatusSubtitle(false);
    }
  }

  function closeRunStatusPopup() {
    if (!runStatusClosable) return;
    clearRunStatusAutoClose();
    const root = $("run-status-root");
    if (!root) return;
    const cb = pendingAfterRunStatus;
    pendingAfterRunStatus = null;
    animateClose(root, () => {
      if (typeof cb === "function") cb();
    });
  }

  function forceCloseRunStatusPopup() {
    clearRunStatusAutoClose();
    runStatusClosable = true;
    pendingAfterRunStatus = null;
    const root = $("run-status-root");
    animateClose(
      root,
      () => {
        const btn = $("run-status-close");
        if (btn) btn.disabled = true;
        runStatusClosable = false;
        setRunStatusSubtitle(false);
      },
      { instant: true }
    );
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

  function finalizePipelineSuccess() {
    if (!pipelineState) pipelineState = freshPipeline();
    for (const s of PIPELINE_STEPS) {
      pipelineState.kinds[s.id] = "ok";
    }
    pipelineState.activeIdx = PIPELINE_STEPS.length - 1;
    pipelineState.extras = [];
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

  function stepLabel(step, kind) {
    if (step.id === "done" && kind === "ok") return "สำเร็จแล้ว";
    if (step.id === "done" && kind === "pending") return "กำลังสรุปผล…";
    if (kind === "pending") return "กำลัง" + step.label + "…";
    if (kind === "ok") {
      if (step.id === "login") return "เข้าสู่ระบบเกมแล้ว";
      if (step.id === "clear") return "เคลียร์รางวัลค้างแล้ว";
      if (step.id === "match") return "จับคู่สำเร็จ";
      if (step.id === "run") return "จบการวิ่งแล้ว";
      if (step.id === "claim") return "รับรางวัลเรียบร้อย";
      return step.label + "แล้ว";
    }
    if (kind === "err") return step.label + "ไม่สำเร็จ";
    return step.label;
  }

  function renderPipeline() {
    const root = $("run-status-root");
    const hero = $("run-status-hero");
    const labelEl = $("run-status-hero-label");
    const hintEl = $("run-status-hero-hint");
    const dotsEl = $("run-status-dots");
    const list = $("farm-log");
    if (root) {
      root.classList.remove("hidden");
      root.setAttribute("aria-hidden", "false");
    }
    if (!pipelineState) return;

    let focusIdx = pipelineState.activeIdx || 0;
    let focusKind = pipelineState.kinds[PIPELINE_STEPS[focusIdx]?.id] || "pending";
    const errIdx = PIPELINE_STEPS.findIndex((s) => pipelineState.kinds[s.id] === "err");
    if (errIdx >= 0) {
      focusIdx = errIdx;
      focusKind = "err";
    } else if (PIPELINE_STEPS.every((s) => pipelineState.kinds[s.id] === "ok")) {
      focusIdx = PIPELINE_STEPS.length - 1;
      focusKind = "ok";
    } else {
      const pendingIdx = PIPELINE_STEPS.findIndex(
        (s) => pipelineState.kinds[s.id] === "pending"
      );
      if (pendingIdx >= 0) {
        focusIdx = pendingIdx;
        focusKind = "pending";
      }
    }

    const step = PIPELINE_STEPS[focusIdx] || PIPELINE_STEPS[0];
    if (hero) hero.dataset.state = focusKind;
    if (labelEl) labelEl.textContent = stepLabel(step, focusKind);
    if (hintEl) {
      if (focusKind === "pending") {
        hintEl.textContent = "กรุณารอสักครู่ อย่าปิดหน้านี้";
      } else if (focusKind === "ok") {
        hintEl.textContent = "กำลังเปิดสรุปผลการฟาร์ม…";
      } else {
        hintEl.textContent = "อ่านรายละเอียดด้านล่างแล้วกด × เพื่อปิด";
      }
    }

    if (dotsEl) {
      dotsEl.replaceChildren();
      PIPELINE_STEPS.forEach((s, i) => {
        const kind = pipelineState.kinds[s.id] || "idle";
        const dot = document.createElement("span");
        dot.className = "run-status-dot";
        if (kind === "ok") dot.classList.add("is-ok");
        else if (kind === "pending") dot.classList.add("is-pending");
        else if (kind === "err") dot.classList.add("is-err");
        if (i === focusIdx && kind !== "idle") {
          /* already classed */
        }
        dotsEl.appendChild(dot);
      });
    }

    if (list) {
      list.replaceChildren();
      const extras = pipelineState.extras || [];
      if (!extras.length) {
        list.classList.add("hidden");
      } else {
        list.classList.remove("hidden");
        for (const extra of extras) {
          const li = document.createElement("li");
          li.textContent = extra.text;
          li.classList.add(extra.kind || "ok");
          list.appendChild(li);
        }
      }
    }
  }

  function clearStageTimer() {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }
  }

  function startLiveStages() {
    clearStageTimer();
    clearRunStatusAutoClose();
    pipelineState = freshPipeline();
    openRunStatusPopup(true);
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

  function scheduleSuccessHandoff() {
    clearRunStatusAutoClose();
    setRunStatusClosable(true);
    setRunStatusSubtitle(true, true);
    const delay = prefersReducedMotion() ? 40 : 520;
    runStatusAutoCloseTimer = setTimeout(() => {
      runStatusAutoCloseTimer = null;
      if (!runStatusClosable) return;
      const root = $("run-status-root");
      if (!root || root.classList.contains("hidden")) {
        const cb = pendingAfterRunStatus;
        pendingAfterRunStatus = null;
        if (typeof cb === "function") cb();
        return;
      }
      closeRunStatusPopup();
    }, delay);
  }

  function buildFinalPipeline(rawLogs, result, ok) {
    clearStageTimer();
    pipelineState = freshPipeline();
    if (ok) {
      applyLogsToPipeline(rawLogs);
      finalizePipelineSuccess();
      scheduleSuccessHandoff();
    } else {
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
      } else {
        renderPipeline();
      }
      setRunStatusClosable(true);
      setRunStatusSubtitle(true, false);
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
    if (!mail?.dataset.peekSyncBound) {
      const syncPeek = () => updateFarmAvailability();
      mail?.addEventListener("input", syncPeek);
      mail?.addEventListener("change", syncPeek);
      secret?.addEventListener("input", syncPeek);
      secret?.addEventListener("change", syncPeek);
      if (mail) mail.dataset.peekSyncBound = "1";
      if (secret) secret.dataset.peekSyncBound = "1";
    }
    setTimeout(() => {
      if (mail && document.activeElement !== mail) mail.value = "";
      if (secret && document.activeElement !== secret) secret.value = "";
      if (mail) mail.setAttribute("readonly", "readonly");
      if (secret) secret.setAttribute("readonly", "readonly");
      updateFarmAvailability();
    }, 300);
  }

  async function runFarm() {
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    const score = parseFarmNum($("farm-score").value);
    const coin = parseFarmNum($("farm-coin").value);
    const exp = parseFarmNum($("farm-exp").value);
    if (score > INT32_MAX || coin > INT32_MAX || exp > INT32_MAX) {
      showErrorModal(ERR_TH.value_capped, "ตัวเลขเกินกำหนด");
      return;
    }

    const btn = $("farm-btn");
    const tokensBefore = tokenBalance();
    farmRunning = true;
    btn.disabled = true;
    setStatus($("farm-status"), "กำลังฟาร์ม… อาจใช้เวลาสักครู่", "muted");
    startLiveStages();

    try {
      await ensureApiReady();
      const data = await api("/api/farm/run", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
          score,
          coin,
          exp,
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

      if (data.ok) {
        setStatus($("farm-status"), "ฟาร์มสำเร็จ · หัก 1 โทเค็น", "ok");
        const summary = result?.reward_summary || {};
        const reward = result?.reward || {};
        pendingAfterRunStatus = () =>
          showResultModal({
            account:
              (summary.nickname || result?.account?.nickname || "—") +
              " · level " +
              (summary.level ?? reward.level ?? "—"),
            coinDelta: formatNumTh(summary.coin_delta ?? reward.coin?.delta ?? 0),
            coinTotal: formatNumTh(summary.coin_total ?? reward.coin?.total ?? "—"),
            xpDelta: formatNumTh(summary.exp_delta ?? reward.exp?.delta ?? 0),
            xpTotal: formatNumTh(summary.exp_total ?? reward.exp?.total ?? "—"),
            tokensBefore: formatNumTh(data.tokens_before ?? tokensBefore),
            tokensAfter: formatNumTh(
              data.tokens_after ?? data.token_balance ?? tokenBalance()
            ),
          });
        buildFinalPipeline(data.logs || data.steps || [], result, true);
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
        loadFarmHistory().catch(() => {});
      } else {
        buildFinalPipeline(data.logs || data.steps || [], result, false);
        let msg = farmErrorMessage(result, "ฟาร์มไม่สำเร็จ");
        if (/corrupt_pending/i.test(String(result?.error || data.error || ""))) {
          msg = ERR_TH.corrupt_pending;
        }
        msg += data.refunded ? " · คืนโทเค็นแล้ว" : " · โทเค็นถูกหักแล้ว";
        setStatus($("farm-status"), msg, "err");
        loadFarmHistory().catch(() => {});
      }
    } catch (e) {
      clearStageTimer();
      if (/account_banned/i.test(String(e.message || ""))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.account_banned, "บัญชีถูกระงับ");
        setStatus($("farm-status"), ERR_TH.account_banned, "err");
      } else if (/maintenance/i.test(String(e.message || ""))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.maintenance, "ปิดปรับปรุง");
        setStatus($("farm-status"), ERR_TH.maintenance, "err");
      } else if (e.status === 400 && /value_capped/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.value_capped, "ตัวเลขเกินกำหนด");
        setStatus($("farm-status"), ERR_TH.value_capped, "err");
      } else if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        const gate = e.gate || e.data?.detail?.gate;
        if (gate) renderQueueModal(gate);
        else renderQueueModal({ farm_busy: true, queue_length: 0, me: {} });
        startQueuePoll();
        setStatus($("farm-status"), "ระบบไม่ว่าง — เข้าคิวหรือรอคิว", "muted");
      } else {
        const msg = thError(e.message) || "ฟาร์มไม่สำเร็จ";
        setStatus($("farm-status"), msg, "err");
        buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: e.message }, false);

        if (e.status === 402 || /insufficient_tokens/i.test(String(e.message))) {
          forceCloseRunStatusPopup();
          profile.token_balance = 0;
          paintProfile();
          showEmptyCoinsModal();
        } else if (typeof e.data?.token_balance === "number") {
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
    initBgFloaters();

    const rememberEl = $("remember-me");
    if (rememberEl) {
      const pref = localStorage.getItem(REMEMBER_KEY);
      rememberEl.checked = pref !== "0";
    }

    sessionToken = loadStoredSessionToken();
    setupDevPlayAutofillGuards();
    setupFarmNumberInputs();
    setupXpCalculator();
    loadTopupPackages();
    pingApiHealth(2).catch(() => {});

    // Re-check balance when user returns from Telegram
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || !accessToken) return;
      if (modalMode === "empty") {
        try {
          await refreshMe();
        } catch (_) {}
      }
      if (modalMode === "queue" || lastGate?.me?.status) {
        refreshGateAndQueueUi().catch(() => {});
      }
    });

    const { data } = await sb.auth.getSession();
    if (!data?.session) {
      showLogin();
      return;
    }
    accessToken = data.session.access_token;
    try {
      await refreshMe();
      loadTopupHistory().catch(() => {});
      loadFarmHistory().catch(() => {});
    } catch (e) {
      if (/session_replaced|account_banned/i.test(String(e.message || ""))) return;
      await sb.auth.signOut();
      accessToken = null;
      clearSessionToken();
      showLogin();
      setStatus($("login-status"), "", "muted");
      showErrorModal(
        thError(e.message) || "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
        "เซสชันหมดอายุ"
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
      persistSessionToken(data.session_token || null);
      profile = data.profile;
      paintProfile();
      showApp();
      setStatus($("login-status"), "", "muted");
      setupDevPlayAutofillGuards();
    } catch (e) {
      const msg = thError(e.message) || "เข้าสู่ระบบไม่สำเร็จ";
      setStatus($("login-status"), "", "muted");
      showErrorModal(msg, "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      $("login-btn").disabled = false;
    }
  });

  function setAuthMode(mode) {
    const isSignup = mode === "signup";
    $("login-mode")?.classList.toggle("hidden", isSignup);
    $("signup-mode")?.classList.toggle("hidden", !isSignup);
    $("tab-login")?.classList.toggle("is-active", !isSignup);
    $("tab-signup")?.classList.toggle("is-active", isSignup);
    $("tab-login")?.setAttribute("aria-selected", String(!isSignup));
    $("tab-signup")?.setAttribute("aria-selected", String(isSignup));
    setStatus($("login-status"), "", "muted");
    setStatus($("signup-status"), "", "muted");
  }

  $("tab-login")?.addEventListener("click", () => setAuthMode("login"));
  $("tab-signup")?.addEventListener("click", () => setAuthMode("signup"));

  $("signup-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const remember = !!$("signup-remember")?.checked;
    setRememberPref(remember);
    if ($("remember-me")) $("remember-me").checked = remember;

    const username = ($("signup-user")?.value || "").trim();
    const password = $("signup-pass")?.value || "";
    const confirmPassword = $("signup-pass2")?.value || "";

    if (password !== confirmPassword) {
      setStatus($("signup-status"), "", "muted");
      showErrorModal(ERR_TH.password_mismatch, "ยืนยันรหัสผ่านไม่ตรง");
      return;
    }
    if (username.includes("@")) {
      setStatus($("signup-status"), "", "muted");
      showErrorModal(ERR_TH.invalid_username, "ชื่อผู้ใช้ไม่ถูกต้อง");
      return;
    }
    if (password.length < 6) {
      setStatus($("signup-status"), "", "muted");
      showErrorModal("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", "รหัสผ่านสั้นเกินไป");
      return;
    }

    setStatus($("signup-status"), "กำลังสมัครสมาชิก…", "muted");
    $("signup-btn").disabled = true;
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: {
          username,
          password,
          confirm_password: confirmPassword,
        },
      });
      if (!data.access_token || !data.refresh_token) {
        throw new Error("register_session_failed");
      }
      const { error } = await sb.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (error) throw error;
      accessToken = data.access_token;
      persistSessionToken(data.session_token || null);
      profile = data.profile;
      paintProfile();
      showApp();
      setStatus($("signup-status"), "", "muted");
      setupDevPlayAutofillGuards();
    } catch (e) {
      const raw = String(e.message || "");
      let title = "สมัครสมาชิกไม่สำเร็จ";
      if (raw.includes("username_taken")) title = "ชื่อผู้ใช้ซ้ำ";
      else if (raw.includes("signup_rate_limited")) title = "สมัครถี่เกินไป";
      else if (raw.includes("password_mismatch")) title = "ยืนยันรหัสผ่านไม่ตรง";
      else if (raw.includes("invalid_username")) title = "ชื่อผู้ใช้ไม่ถูกต้อง";
      else if (raw.includes("service_role_not_configured") || raw.includes("auth_not_configured")) {
        title = "ระบบยังไม่พร้อม";
      } else if (raw.includes("register_session_failed")) {
        title = "สมัครแล้ว แต่เข้าสู่ระบบไม่ได้";
      }
      const msg = thError(e.message) || "สมัครสมาชิกไม่สำเร็จ";
      setStatus($("signup-status"), "", "muted");
      showErrorModal(msg, title);
    } finally {
      $("signup-btn").disabled = false;
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    accessToken = null;
    profile = null;
    clearSessionToken();
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
    emptyModalDismissed = false;
    showLogin();
  });

  $("topup-toggle")?.addEventListener("click", () => {
    if (vaultOpen) closeVaultModal();
    else openVaultModal();
  });

  document.querySelectorAll("[data-vault-close]").forEach((el) => {
    el.addEventListener("click", () => closeVaultModal());
  });

  $("wallet-tutorial-open")?.addEventListener("click", () => {
    openWalletTutorial();
  });

  document.querySelectorAll("[data-tutorial-close]").forEach((el) => {
    el.addEventListener("click", () => closeWalletTutorial());
  });

  $("wallet-tutorial-prev")?.addEventListener("click", () => {
    if (walletTutorialStep <= 0) return;
    walletTutorialStep -= 1;
    paintWalletTutorial();
  });

  $("wallet-tutorial-next")?.addEventListener("click", () => {
    if (walletTutorialStep >= WALLET_TUTORIAL_STEPS.length - 1) {
      closeWalletTutorial();
      return;
    }
    walletTutorialStep += 1;
    paintWalletTutorial();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("wallet-tutorial")?.classList.contains("hidden")) {
      closeWalletTutorial();
      return;
    }
    if (vaultOpen) closeVaultModal();
  });

  $("topup-copy-price")?.addEventListener("click", () => {
    copyTopupPrice();
  });

  $("topup-verify-btn")?.addEventListener("click", async () => {
    if (topupBusy || farmRunning || peekRunning) return;
    const voucher = ($("topup-voucher")?.value || "").trim();
    if (!voucher) {
      showErrorModal("วางลิงก์หรือโค้ดซอง TrueMoney ก่อน", "ข้อมูลไม่ครบ");
      return;
    }
    if (!accessToken) {
      showErrorModal("กรุณาเข้าสู่ระบบก่อน", "ต้องเข้าสู่ระบบ");
      return;
    }
    const btn = $("topup-verify-btn");
    if (btn) btn.disabled = true;
    setStatus($("topup-status"), "กำลังตรวจซอง…", "muted");
    try {
      await ensureApiReady();
      const data = await api("/api/topup/verify", {
        method: "POST",
        body: { voucher, package_tokens: selectedTopupTokens },
      });
      setStatus(
        $("topup-status"),
        "ซองผ่าน · ยอด " +
          formatNumTh(data.amount_baht) +
          "฿ ตรงแพ็ก " +
          data.package_tokens +
          "T",
        "ok"
      );
    } catch (e) {
      if (/session_replaced/i.test(String(e.message || ""))) return;
      const msg = thError(e.message) || "ตรวจซองไม่สำเร็จ";
      setStatus($("topup-status"), msg, "err");
      showErrorModal(msg, "ตรวจซองไม่ผ่าน");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("topup-btn")?.addEventListener("click", async () => {
    if (topupBusy || farmRunning || peekRunning) return;
    const voucher = ($("topup-voucher")?.value || "").trim();
    if (!voucher) {
      showErrorModal("วางลิงก์หรือโค้ดซอง TrueMoney ก่อน", "ข้อมูลไม่ครบ");
      return;
    }
    if (!accessToken) {
      showErrorModal("กรุณาเข้าสู่ระบบก่อนเติมโทเค็น", "ต้องเข้าสู่ระบบ");
      return;
    }

    topupBusy = true;
    const btn = $("topup-btn");
    if (btn) btn.disabled = true;
    setStatus($("topup-status"), "กำลังตรวจสอบและรับซอง…", "muted");
    try {
      await ensureApiReady();
      const data = await api("/api/topup/redeem", {
        method: "POST",
        body: {
          voucher,
          package_tokens: selectedTopupTokens,
        },
      });
      if (typeof data.token_balance === "number") {
        profile = profile || {};
        profile.token_balance = data.token_balance;
        paintProfile();
      }
      try {
        await refreshMe();
      } catch (_) {}
      if ($("topup-voucher")) $("topup-voucher").value = "";
      if (modalMode === "empty") forceCloseModal();
      flashTopupDoor();
      setStatus(
        $("topup-status"),
        "เติมสำเร็จ +" + data.tokens_credited + " token",
        "ok"
      );
      showTopupSuccessModal(data);
      loadTopupHistory().catch(() => {});
      // keep vault open briefly so user sees success, then close if they have tokens
      openVaultModal();
      setTimeout(() => {
        if (hasTokens()) closeVaultModal();
      }, 1800);
    } catch (e) {
      if (/session_replaced/i.test(String(e.message || ""))) return;
      const msg = thError(e.message) || "เติมโทเค็นไม่สำเร็จ";
      setStatus($("topup-status"), msg, "err");
      showErrorModal(msg, "เติมไม่สำเร็จ");
    } finally {
      topupBusy = false;
      if (btn) btn.disabled = false;
    }
  });

  $("peek-btn")?.addEventListener("click", async () => {
    if (peekRunning || farmRunning) return;
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }
    if (peekCooldownRemaining() > 0) {
      showErrorModal(ERR_TH.peek_rate_limited, "รออีกสักครู่");
      return;
    }
    const dpEmail = ($("dp-acct-mail").value || "").trim();
    const dpPass = $("dp-acct-secret").value || "";
    if (!dpEmail || !dpPass) {
      showErrorModal(
        "กรอกอีเมลและรหัสผ่าน DevPlay ของเกมให้ครบก่อนดูสถานะ",
        "ข้อมูลไม่ครบ"
      );
      return;
    }

    peekRunning = true;
    updateFarmAvailability();
    setStatus($("farm-status"), "กำลังดูสถานะบัญชีเกม…", "muted");
    try {
      await ensureApiReady();
      const data = await api("/api/farm/peek", {
        method: "POST",
        body: { email: dpEmail, password: dpPass },
      });
      const retry = Number(data.retry_after ?? PEEK_COOLDOWN_SEC);
      startPeekCooldown(retry);
      showPeekResultModal(data);
      setStatus($("farm-status"), "ดูสถานะสำเร็จ · ไม่หักโทเค็น", "ok");
    } catch (e) {
      const raw = String(e.message || "");
      const detail = e.data?.detail;
      if (e.status === 429 || /peek_rate_limited/i.test(raw)) {
        const retry =
          (detail && typeof detail === "object" && Number(detail.retry_after)) ||
          PEEK_COOLDOWN_SEC;
        startPeekCooldown(retry);
        showErrorModal(ERR_TH.peek_rate_limited, "รออีกสักครู่");
      } else if (e.status === 402 || /insufficient_tokens_for_peek/i.test(raw)) {
        showErrorModal(ERR_TH.insufficient_tokens_for_peek, "ต้องมีโทเค็น");
      } else if (e.status === 409 || /farm_busy/i.test(raw)) {
        showErrorModal(
          "ระบบกำลังฟาร์มหรือไม่ว่าง — ลองใหม่เมื่อว่าง (ไม่ต้องเข้าคิวเพื่อดูสถานะ)",
          "ระบบไม่ว่าง"
        );
      } else if (/login_failed/i.test(raw)) {
        showErrorModal(ERR_TH.login_failed, "เข้าสู่ระบบเกมไม่สำเร็จ");
      } else {
        showErrorModal(thError(e.message) || ERR_TH.peek_failed, "ดูสถานะไม่สำเร็จ");
      }
      setStatus($("farm-status"), thError(e.message) || "ดูสถานะไม่สำเร็จ", "err");
    } finally {
      peekRunning = false;
      updateFarmAvailability();
    }
  });

  $("farm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (farmRunning || peekRunning) return;

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

  $("run-status-close")?.addEventListener("click", () => {
    closeRunStatusPopup();
  });

  $("run-status-root")
    ?.querySelector(".run-status-backdrop")
    ?.addEventListener("click", () => {
      if (runStatusClosable) closeRunStatusPopup();
    });

  $("modal-close")?.addEventListener("click", () => {
    if (!modalRoot.classList.contains("locked")) closeModal();
  });

  modalRoot
    ?.querySelector(".modal-backdrop")
    ?.addEventListener("click", () => {
      if (!modalRoot.classList.contains("locked")) closeModal();
    });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const runRoot = $("run-status-root");
    if (runRoot && !runRoot.classList.contains("hidden")) {
      if (runStatusClosable) closeRunStatusPopup();
      else ev.preventDefault();
      return;
    }
    if (modalRoot && !modalRoot.classList.contains("hidden") && !modalRoot.classList.contains("locked")) {
      closeModal();
    }
  });

  bootstrap();
})();
