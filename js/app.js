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
  const SAFE_COIN_MAX = 449000;
  const SAFE_EXP_MAX = 52000;
  const DEFAULT_FARM_SCORE = 800000;
  let farmCoinMax = SAFE_COIN_MAX;
  let farmExpMax = SAFE_EXP_MAX;

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

  function farmFieldCap(input) {
    if (!input) return INT32_MAX;
    const cap = Number(input.dataset.farmCap);
    return Number.isFinite(cap) && cap > 0 ? cap : INT32_MAX;
  }

  function syncFarmNumField(input, opts = {}) {
    const hint = $(input.id + "-hint");
    let digits = digitsOnly(input.value);
    const cap = farmFieldCap(input);
    if (!digits) {
      if (!opts.keepEmpty) {
        input.value = "0";
        if (hint) hint.textContent = "";
      } else {
        input.value = "";
        if (hint) hint.textContent = "";
      }
      return 0;
    }
    if (digits === "0") {
      input.value = "0";
      if (hint) hint.textContent = "";
      return 0;
    }
    digits = digits.replace(/^0+(?=\d)/, "");
    let n = Number(digits);
    if (!Number.isFinite(n) || n > cap) {
      if (n > cap && cap < INT32_MAX) {
        n = cap;
        digits = String(cap);
        input.value = formatCommas(digits);
        if (hint) hint.textContent = thaiMagnitude(n);
        if (!opts.silent) {
          showErrorModal(
            "ใส่ได้สูงสุด " + formatNumTh(cap) + " ต่อช่อง",
            "ตัวเลขเกินกำหนด"
          );
        }
        return n;
      }
      input.value = "0";
      if (hint) hint.textContent = "";
      if (!opts.silent) {
        showErrorModal(
          "ใส่ได้สูงสุด " + formatNumTh(cap) + " ต่อช่อง",
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
  let progressPollTimer = null;
  let statusContext = null;
  let heartServiceStatus = null;
  let runStatusAutoCloseTimer = null;
  let balancePollTimer = null;
  let queuePollTimer = null;
  let modalMode = null; // "empty" | "confirm" | "error" | "queue" | "result" | "peek" | null
  let emptyModalDismissed = false; // user closed empty modal; don't auto-reopen
  let farmRunning = false;
  let peekRunning = false;
  let devplayConnecting = false;
  let devplaySession = null; // { id, nickname, tickets, expiresAt }
  let ticketCount = 1;
  let ticketMax = 1;
  let farmTab = "partyrun";
  let powderTreasures = [];
  let powderTreasureName = "Revival Boots";
  let powderEstimate = null;
  let powderEstimateLoading = false;
  // Rounds is the single source of truth; the powder field is derived from it.
  // null means "untouched" — a fresh estimate then fills in the affordable max.
  let powderRounds = null;
  let giftdrawCount = 1;
  let giftdrawMax = 1;
  let giftdrawEstimate = null;
  let giftdrawEstimateLoading = false;
  let heartTarget = 100;
  let heartMax = 300;
  let heartEstimate = null;
  let heartEstimateLoading = false;
  let upgradeTreasures = [];
  let upgradeSelected = new Set();
  let upgradeTargetLevel = 9;
  let upgradeEstimate = null;
  let upgradeEstimateLoading = false;
  let upgradeRngAccepted = false;
  let upgradeCoin = 0;
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
  // Run held back by farm_busy, replayed automatically once our turn comes up.
  let queuedRun = null;
  let queueResumeAttempts = 0;
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
    value_capped: "เหรียญสูงสุด 449,000 · XP สูงสุด 52,000",
    devplay_session_expired: "เชื่อม DevPlay หมดอายุ — กดเชื่อมต่อใหม่",
    not_enough_tickets: "ตั๋ว Party Run ไม่พอ — ลดจำนวนตั๋วหรือรอรีเซ็ต",
    connect_failed: "เชื่อม DevPlay ไม่สำเร็จ — ตรวจอีเมล/รหัสผ่าน",
    owner_not_lv8: "ต้องมีเจ้าของสมบัติ Lv.8 ก่อน",
    insufficient_coin: "เหรียญไม่พอแม้ 1 รอบ",
    powder_session_missing: "เชื่อม DevPlay ใหม่ (ไม่มี session ผง)",
    no_gift_boxes: "ไม่มีกล่องขวัญในไอดีนี้ — ต้องมี Gift Point ครบ 100 ต่อ 1 กล่อง",
    heart_disabled: "ฟาร์มหัวใจปิดใช้งานอยู่ — รอแอดมินเปิด",
    heart_proxy_not_configured: "ฟาร์มหัวใจยังไม่พร้อม (ผู้ดูแลยังไม่ได้ตั้งค่า proxy)",
    heart_timeout: "ฟาร์มหัวใจใช้เวลานานเกินกำหนด — ลองลดจำนวนหัวใจแล้วรันใหม่",
    no_hearts_collected: "เก็บหัวใจไม่ได้เลย — ลองใหม่อีกครั้ง",
    heart_error: "ฟาร์มหัวใจไม่สำเร็จ ลองใหม่อีกครั้ง",
    giftdraw_failed: "เปิดกล่องขวัญไม่สำเร็จ ลองใหม่อีกครั้ง",
    treasure_not_found: "ไม่พบสมบัติที่เลือก",
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
    claim_rejected:
      "เซิร์ฟเวอร์ปฏิเสธรางวัลรอบนี้ — ลองลดค่า Coin/EXP แล้วรันใหม่",
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
            if (Number.isFinite(data.farm_coin_max)) farmCoinMax = data.farm_coin_max;
            if (Number.isFinite(data.farm_exp_max)) farmExpMax = data.farm_exp_max;
            const coinEl = $("farm-coin");
            const expEl = $("farm-exp");
            if (coinEl) {
              coinEl.dataset.farmCap = String(farmCoinMax);
              // Keep default at safe max when still empty / 0
              if (!parseFarmNum(coinEl.value)) {
                coinEl.value = formatCommas(String(farmCoinMax));
                syncFarmNumField(coinEl, { silent: true });
              }
            }
            if (expEl) {
              expEl.dataset.farmCap = String(farmExpMax);
              if (!parseFarmNum(expEl.value)) {
                expEl.value = formatCommas(String(farmExpMax));
                syncFarmNumField(expEl, { silent: true });
              }
            }
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
    $("modal-body")?.classList.remove("result-stagger");
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
    ];
    if (summary.roundsCompleted > 1) {
      rows.push([
        "รอบ",
        `${escapeHtml(summary.roundsCompleted)} / ${escapeHtml(summary.ticketCount || summary.roundsCompleted)} สำเร็จ`,
      ]);
    }
    rows.push(
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
      ]
    );
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
    $("modal-body")?.classList.add("result-stagger");
    spawnPixelConfetti();
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function showPowderResultModal(summary) {
    const rows = [
      ["บัญชีเกม", escapeHtml(summary.account || "—")],
      ["สมบัติ", escapeHtml(summary.treasure || "—")],
      [
        "ผง",
        `<span class="result-delta">+${escapeHtml(summary.powderGained)}</span> → ยอดรวม ${escapeHtml(summary.powderAfter)}`,
      ],
      ["เหรียญเหลือ", escapeHtml(summary.coinAfter)],
      ["รอบ", escapeHtml(summary.rounds)],
      [
        "โทเค็นเว็บ",
        `${escapeHtml(summary.tokensBefore)} → ${escapeHtml(summary.tokensAfter)} <span class="result-delta">(หัก 1)</span>`,
      ],
    ];
    if (summary.short) {
      rows.push([
        "หมายเหตุ",
        "รันได้ " +
          escapeHtml(summary.rounds) +
          " จาก " +
          escapeHtml(formatNumTh(summary.roundsAsked)) +
          " รอบที่ขอ (เหรียญหมดหรือเจอข้อผิดพลาดกลางทาง)",
      ]);
    } else if (summary.capped) {
      rows.push(["หมายเหตุ", "จำนวนรอบสูงสุดถูกจำกัดด้วยเหรียญในไอดี"]);
    }
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
      title: "สรุปผลฟาร์มผง",
      bodyHtml: html,
      icon: "assets/crc_cookie_stone_box.png",
      locked: false,
    });
    $("modal-body")?.classList.add("result-stagger");
    spawnPixelConfetti();
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  // Currency deltas come back keyed (coin/life/key/gem); item rewards arrive as
  // "item:<name>" so the server never has to guess at display text.
  const GIFTDRAW_LABEL = {
    coin: "💰 เหรียญ",
    life: "❤️ หัวใจ",
    key: "🔑 กุญแจ",
    gem: "💎 คริสตัล",
  };

  function giftDrawRewardRows(totals) {
    const entries = Object.entries(totals || {});
    if (!entries.length) return [];
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([key, qty]) => {
        const label = key.startsWith("item:")
          ? "🎁 " + key.slice(5)
          : GIFTDRAW_LABEL[key] || key;
        return [
          escapeHtml(label),
          `<span class="result-delta">+${escapeHtml(formatNumTh(qty))}</span>`,
        ];
      });
  }

  function showGiftDrawResultModal(summary) {
    const rewardRows = giftDrawRewardRows(summary.totals);
    const rows = [
      ["บัญชีเกม", escapeHtml(summary.account || "—")],
      [
        "เปิดกล่อง",
        `<span class="result-delta">${escapeHtml(summary.drawsOk)}</span> / ${escapeHtml(summary.requested)} กล่อง`,
      ],
      ["กล่องคงเหลือ", escapeHtml(summary.boxesAfter)],
      ...rewardRows,
      [
        "โทเค็นเว็บ",
        `${escapeHtml(summary.tokensBefore)} → ${escapeHtml(summary.tokensAfter)} <span class="result-delta">(หัก 1)</span>`,
      ],
    ];
    if (!rewardRows.length) {
      rows.splice(3, 0, ["ของที่ได้", "ไม่มียอดเปลี่ยนแปลงที่ตรวจจับได้"]);
    }
    const html =
      '<table class="result-table"><tbody>' +
      rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">ไม่ได้ใช้เพชรเลย · ถ้าในเกมยังไม่เห็นของ ให้ปิดเกมแล้วเข้าใหม่</p>';

    clearModalActions();
    openModal({
      mode: "result",
      title: "สรุปผลเปิดกล่องขวัญ",
      bodyHtml: html,
      icon: "assets/icon_giftpoint.png",
      locked: false,
    });
    $("modal-body")?.classList.add("result-stagger");
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

  const JOB_KIND_TH = {
    partyrun: "Party Run",
    powder: "ฟาร์มผง",
    giftdraw: "เปิดกล่องขวัญ",
    heart: "ฟาร์มหัวใจ",
    upgrade: "ตีบวกสมบัติ",
  };

  // Rough wait: everyone ahead of you gets up to one full turn. It is an upper
  // bound, not a promise — runs usually finish well before the turn expires.
  function queueWaitText(gate) {
    const g = gate || {};
    const ahead = Number(g.me?.position);
    const turn = Number(g.turn_seconds) || 120;
    if (!Number.isFinite(ahead) || ahead <= 0) return "";
    const sec = ahead * turn;
    if (sec < 90) return "ไม่เกิน " + sec + " วินาที";
    return "ไม่เกิน " + Math.ceil(sec / 60) + " นาที";
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
      bodyHtml += queuedRun
        ? '<p class="queue-note">ถึงคิวแล้ว — กำลังเริ่มให้อัตโนมัติ…</p>'
        : '<p class="queue-note warn">ต้องกดเริ่มฟาร์มภายใน 2 นาที ไม่งั้นคิวจะข้ามไปคนถัดไป</p>';
    } else if (me.status === "waiting") {
      bodyHtml +=
        '<div class="queue-stat"><span>คิวของคุณ</span><strong>อันดับ ' +
        escapeHtml(me.position ?? "—") +
        "</strong></div>";
      bodyHtml +=
        '<div class="queue-stat"><span>ในคิวทั้งหมด</span><strong>' +
        escapeHtml(g.queue_length ?? 0) +
        "</strong></div>";
      const wait = queueWaitText(g);
      if (wait) {
        bodyHtml +=
          '<div class="queue-stat"><span>รออีกประมาณ</span><strong>' +
          escapeHtml(wait) +
          "</strong></div>";
      }
      if (g.job_kind) {
        bodyHtml +=
          '<div class="queue-stat"><span>ตอนนี้กำลังรัน</span><strong>' +
          escapeHtml(JOB_KIND_TH[g.job_kind] || g.job_kind) +
          "</strong></div>";
      }
      bodyHtml += queuedRun
        ? '<p class="queue-note">จองคิวไว้แล้ว — ถึงคิวเมื่อไหร่ระบบจะเริ่มให้อัตโนมัติ</p>'
        : '<p class="queue-note">รอคิวอยู่ — ปิดหน้าต่างไม่ได้ จนกว่าจะถึงคิวของคุณ</p>';
    } else if (g.farm_busy) {
      bodyHtml +=
        '<div class="queue-stat"><span>สถานะ</span><strong>มีคนกำลังฟาร์ม' +
        (g.job_kind ? " (" + escapeHtml(JOB_KIND_TH[g.job_kind] || g.job_kind) + ")" : "") +
        "</strong></div>";
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
        makeBtn("เข้าคิว", "btn-candy", () => {
          joinQueue().catch(() => {});
        })
      );
    } else if (me.status === "active" || g.is_my_turn) {
      if (queuedRun) {
        // The run was already confirmed before we hit farm_busy, and the turn
        // only lasts two minutes — waiting for a second click loses the slot.
        resumeQueuedRun();
        return;
      }
      modalActions.appendChild(
        makeBtn("เริ่มฟาร์มเลย", "btn-run", () => {
          forceCloseModal();
          stopQueuePoll();
          $("farm-btn")?.focus();
          setStatus($("farm-status"), "ถึงคิวแล้ว — กดเริ่มฟาร์มได้เลย", "ok");
        })
      );
    }
    if (queuedRun && (me.status === "waiting" || (!me.status && g.farm_busy))) {
      modalActions.appendChild(
        makeBtn("ยกเลิกคิว", "btn-ghost", () => {
          clearQueuedRun();
          stopQueuePoll();
          forceCloseModal();
          setStatus($("farm-status"), "ยกเลิกคิวแล้ว — ยังไม่หักโทเค็น", "muted");
        })
      );
    }
  }

  async function joinQueue() {
    try {
      const data = await api("/api/farm/queue/join", { method: "POST", body: {} });
      renderQueueModal(data);
      startQueuePoll();
      return data;
    } catch (e) {
      clearQueuedRun();
      showErrorModal(thError(e.message) || "เข้าคิวไม่สำเร็จ", "คิว");
      throw e;
    }
  }

  /** Hit farm_busy: hold the run, take a queue slot, and resume when it is ours. */
  async function enterQueueFor(gate, runFn) {
    // A resumed run can lose the race for the lock again. Retry a couple of
    // times, then hand control back so we cannot ping-pong forever.
    if (queueResumeAttempts >= 3) {
      queuedRun = null;
      queueResumeAttempts = 0;
      renderQueueModal(gate || { farm_busy: true, queue_length: 0, me: {} });
      startQueuePoll();
      return;
    }
    queuedRun = runFn || null;
    renderQueueModal(gate || { farm_busy: true, queue_length: 0, me: {} });
    startQueuePoll();
    if (!gate?.me?.status) {
      await joinQueue().catch(() => {});
    }
  }

  function resumeQueuedRun() {
    const run = queuedRun;
    if (!run || farmRunning) return;
    queuedRun = null;
    queueResumeAttempts += 1;
    stopQueuePoll();
    forceCloseModal();
    setStatus($("farm-status"), "ถึงคิวแล้ว — กำลังเริ่มให้อัตโนมัติ", "ok");
    run();
  }

  function clearQueuedRun() {
    queuedRun = null;
    queueResumeAttempts = 0;
  }

  async function refreshGateAndQueueUi() {
    if (!accessToken) return null;
    try {
      const data = await api("/api/farm/gate");
      lastGate = data;
      if (data.is_my_turn || data.me?.status === "waiting" || data.me?.status === "active") {
        renderQueueModal(data);
        startQueuePoll();
      } else if (queuedRun && data.can_run && !data.farm_busy) {
        // Everyone ahead finished and the queue emptied out before our row was
        // promoted — the slot is free, so take it rather than sit in the modal.
        resumeQueuedRun();
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

  function showConfirmModal(ticketN) {
    const n = Math.max(1, Number(ticketN) || 1);
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยัน Party Run?",
        body:
          "หัก 1 โทเค็น · รัน " +
          n +
          " ตั๋วต่อเนื่อง\nคืนโทเค็นเฉพาะเมื่อไม่สำเร็จเลยสักรอบ",
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

  function showPowderConfirmModal(rounds) {
    // Same summary the desktop script prints before it spends anything: how
    // many rounds, what it costs, what comes back. A null count means the API
    // cannot honour one, so say plainly that every coin is going.
    const coins = Number(powderEstimate?.coin_available || 0);
    let body;
    if (rounds == null) {
      body =
        "หัก 1 โทเค็น\n" +
        "⚠ เซิร์ฟเวอร์ยังไม่รองรับการเลือกจำนวนรอบ\n" +
        "จะใช้เหรียญทั้งหมดที่มี (" +
        formatNumTh(coins) +
        ") จนกว่าจะหมดหรือครบ " +
        formatNumTh(powderEstimate?.target_powder || 0) +
        " ผง\nคืนโทเค็นเฉพาะเมื่อไม่ได้ผงเลยสักรอบ";
    } else {
      const r = Math.max(1, Number(rounds) || 1);
      const cost = r * powderPricePerRound();
      body =
        "รัน " +
        formatNumTh(r) +
        " รอบ · หัก 1 โทเค็น\n" +
        "เสียเหรียญ " +
        formatNumTh(cost) +
        " (เหลือ " +
        formatNumTh(Math.max(0, coins - cost)) +
        ")\n" +
        "ได้ผง +" +
        formatNumTh(r * powderYield()) +
        "\nคืนโทเค็นเฉพาะเมื่อไม่ได้ผงเลยสักรอบ";
    }
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันฟาร์มผง?",
        body,
        icon: "assets/crc_cookie_stone_box.png",
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

  function showGiftDrawConfirmModal(count) {
    const n = formatNumTh(count || 1);
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันเปิดกล่องขวัญ?",
        body:
          "หัก 1 โทเค็น · เปิด " +
          n +
          " กล่อง (ไม่ใช้เพชร)\nคืนโทเค็นเฉพาะเมื่อเปิดไม่สำเร็จเลยสักกล่อง",
        icon: "assets/icon_giftpoint.png",
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

  function showHeartConfirmModal(target) {
    const n = formatNumTh(target || 1);
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันฟาร์มหัวใจ?",
        body:
          "หัก 1 โทเค็น · ขอ " +
          n +
          " หัวใจ\nระบบจะสร้างเพื่อน guest ชั่วคราวแล้วลบทิ้งให้เอง (เพื่อนจริงไม่ถูกแตะ)\nอาจใช้เวลาหลายนาที — คืนโทเค็นเฉพาะเมื่อไม่ได้หัวใจเลย",
        icon: "assets/pet81_jelly.png",
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

  function isDevPlayConnected() {
    if (!devplaySession?.id) return false;
    if (devplaySession.expiresAt && Date.now() > devplaySession.expiresAt) {
      devplaySession = null;
      return false;
    }
    return true;
  }

  function paintDevPlayConnectStatus(text, kind) {
    const el = $("devplay-connect-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("is-ok", "is-err", "muted");
    if (kind === "ok") el.classList.add("is-ok");
    else if (kind === "err") el.classList.add("is-err");
    else el.classList.add("muted");
  }

  function clampTicketCount(raw) {
    const max = Math.max(1, ticketMax || 1);
    const n = Math.floor(Number(String(raw).replace(/[^\d]/g, "")));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, max);
  }

  function paintTicketStepper() {
    const input = $("ticket-count");
    const hint = $("ticket-max-hint");
    const minus = $("ticket-minus");
    const plus = $("ticket-plus");
    const max = Math.max(1, ticketMax || 1);
    ticketCount = clampTicketCount(ticketCount);
    const editing = input && document.activeElement === input;
    if (input && !editing) input.value = String(ticketCount);
    if (hint) {
      if (!isDevPlayConnected()) {
        hint.textContent = "เชื่อม DevPlay เพื่อเริ่มเลือกจำนวนตั๋ว";
      } else if (devplaySession?.ticketsLoading) {
        hint.textContent = "กำลังนับตั๋วในพื้นหลัง… เลือกรันไปก่อนได้";
      } else if (devplaySession?.tickets == null) {
        hint.textContent =
          "ยังไม่ทราบยอดตั๋ว — เลือกจำนวนได้ (สูงสุด " +
          formatNumTh(max) +
          ") · ใช้ 1 โทเค็นเว็บ";
      } else if (Number(devplaySession.tickets) <= 0) {
        hint.textContent = "ไม่มีตั๋ว Party Run ในไอดีนี้";
      } else {
        hint.textContent =
          "เหลือ " +
          formatNumTh(devplaySession.tickets) +
          " ใบ · พิมพ์ได้ 1–" +
          formatNumTh(max) +
          " · ใช้ 1 โทเค็นเว็บ";
      }
    }
    const canStep = isDevPlayConnected() && !farmRunning && !devplayConnecting;
    if (input) input.disabled = !canStep;
    if (minus) minus.disabled = !canStep || ticketCount <= 1;
    if (plus) plus.disabled = !canStep || ticketCount >= max;
  }

  function commitTicketCountFromInput() {
    const input = $("ticket-count");
    if (!input) return;
    ticketCount = clampTicketCount(input.value);
    paintTicketStepper();
    updateFarmAvailability();
  }

  function resetDevPlaySession() {
    devplaySession = null;
    ticketMax = 99;
    ticketCount = 1;
    const reconnect = $("devplay-reconnect-btn");
    if (reconnect) {
      reconnect.hidden = true;
      reconnect.classList.add("hidden");
    }
    paintDevPlayConnectStatus("ยังไม่ได้เชื่อมบัญชีเกม", "muted");
    const card = $("devplay-profile-card");
    if (card) {
      card.classList.add("hidden");
      card.classList.remove("is-connected");
    }
    paintTicketStepper();
  }

  function paintDevPlaySessionLine() {
    const card = $("devplay-profile-card");
    if (!devplaySession) {
      if (card) card.classList.add("hidden");
      return;
    }
    const nick = devplaySession.nickname || "player";
    const coin = devplaySession.coin == null ? "—" : formatNumTh(devplaySession.coin);
    const exp = devplaySession.exp == null ? "—" : formatNumTh(devplaySession.exp);
    const powder =
      devplaySession.powder == null ? "—" : formatNumTh(devplaySession.powder);
    const lvl = devplaySession.level == null ? "—" : String(devplaySession.level);
    let ticketsLabel = "—";
    if (devplaySession.ticketsLoading) ticketsLabel = "กำลังนับ…";
    else if (devplaySession.tickets != null)
      ticketsLabel = formatNumTh(devplaySession.tickets) + " ใบ";

    if (card) {
      card.classList.remove("hidden");
      card.classList.add("is-connected");
    }
    const nameEl = $("profile-name");
    const subEl = $("profile-sub");
    if (nameEl) nameEl.textContent = nick;
    if (subEl) subEl.textContent = "เชื่อม DevPlay แล้ว · พร้อมฟาร์ม";
    const lv = $("profile-lv");
    const coinEl = $("profile-coin");
    const powderEl = $("profile-powder");
    const xpEl = $("profile-xp");
    const ticketsEl = $("profile-tickets");
    if (lv) lv.textContent = "Lv " + lvl;
    if (coinEl) coinEl.textContent = coin;
    if (powderEl) powderEl.textContent = powder;
    if (xpEl) xpEl.textContent = exp;
    if (ticketsEl) ticketsEl.textContent = ticketsLabel;
    paintDevPlayConnectStatus("", "ok");
  }

  async function loadHeartServiceStatus() {
    try {
      await ensureApiReady();
      heartServiceStatus = await api("/api/farm/heart/status");
    } catch (_) {
      heartServiceStatus = { ready: false, enabled: false, proxy_configured: false };
    }
    paintHeartServiceBanner();
  }

  function paintHeartServiceBanner() {
    const banner = $("heart-service-banner");
    if (!banner) return;
    const st = heartServiceStatus || {};
    if (st.ready) {
      banner.classList.add("hidden");
      banner.textContent = "";
      return;
    }
    banner.classList.remove("hidden");
    if (!st.enabled) {
      banner.textContent = "ฟาร์มหัวใจกำลังปิดปรับปรุง — รอแอดมินเปิดใช้งาน";
    } else if (!st.proxy_configured) {
      banner.textContent = "ฟาร์มหัวใจยังไม่พร้อม — รอตั้งค่า proxy บนเซิร์ฟเวอร์";
    } else {
      banner.textContent = "ฟาร์มหัวใจยังไม่พร้อมใช้งาน";
    }
  }

  function applyDevPlayConnect(data) {
    const ttlMs = (Number(data.expires_in) || 900) * 1000;
    const ticketsKnown =
      data.party_run_tickets != null && Number.isFinite(Number(data.party_run_tickets));
    const ticketsN = ticketsKnown ? Math.max(0, Number(data.party_run_tickets)) : null;
    devplaySession = {
      id: data.devplay_session_id,
      nickname: data.nickname || "player",
      tickets: ticketsN,
      ticketsLoading: !ticketsKnown,
      coin: data.coin,
      exp: data.exp,
      level: data.level,
      powder: data.powder,
      expiresAt: Date.now() + ttlMs,
    };
    ticketMax = ticketsKnown ? Math.max(1, ticketsN || 1) : 99;
    ticketCount = ticketsKnown
      ? Math.min(Math.max(1, ticketsN || 1), ticketMax)
      : Math.min(5, ticketMax);
    paintDevPlaySessionLine();
    const reconnect = $("devplay-reconnect-btn");
    if (reconnect) {
      reconnect.hidden = false;
      reconnect.classList.remove("hidden");
    }
    paintTicketStepper();
    if (!ticketsKnown && data.devplay_session_id) {
      refreshDevPlayTickets(data.devplay_session_id);
    }
    if (farmTab === "powder") {
      refreshPowderEstimate().catch(() => {});
    }
    if (farmTab === "giftdraw") {
      refreshGiftDrawEstimate().catch(() => {});
    }
    if (farmTab === "upgrade") {
      loadUpgradeTreasures(true).catch(() => {});
    }
    if (farmTab === "heart") {
      // Heart's check logs into the game, so it stays an explicit button press
      // rather than firing on every tab switch.
      paintHeartStepper();
    }
  }

  async function refreshDevPlayTickets(sessionId) {
    const sid = sessionId || devplaySession?.id;
    if (!sid || !devplaySession) return;
    try {
      const data = await api("/api/farm/devplay/tickets", {
        method: "POST",
        body: { devplay_session_id: sid },
      });
      if (!devplaySession || devplaySession.id !== sid) return;
      const ticketsKnown =
        data.party_run_tickets != null && Number.isFinite(Number(data.party_run_tickets));
      if (!ticketsKnown) {
        devplaySession.ticketsLoading = false;
        paintDevPlaySessionLine();
        paintTicketStepper();
        return;
      }
      const ticketsN = Math.max(0, Number(data.party_run_tickets));
      devplaySession.tickets = ticketsN;
      devplaySession.ticketsLoading = false;
      ticketMax = Math.max(1, ticketsN || 1);
      ticketCount = Math.min(Math.max(1, ticketCount), ticketMax);
      paintDevPlaySessionLine();
      paintTicketStepper();
      updateFarmAvailability();
      setStatus(
        $("farm-status"),
        "ตั๋ว Party Run " + formatNumTh(ticketsN) + " ใบ",
        "ok"
      );
    } catch (_) {
      if (devplaySession && devplaySession.id === sid) {
        devplaySession.ticketsLoading = false;
        paintDevPlaySessionLine();
        paintTicketStepper();
      }
    }
  }

  async function connectDevPlay() {
    if (devplayConnecting || farmRunning) return;
    if (!hasDevPlayCreds()) {
      showErrorModal("กรอกอีเมลและรหัสผ่าน DevPlay ให้ครบ", "ข้อมูลไม่ครบ");
      return;
    }
    devplayConnecting = true;
    paintDevPlayConnectStatus("กำลังเชื่อมต่อ…", "muted");
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const data = await api("/api/farm/devplay/connect", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
        },
      });
      applyDevPlayConnect(data);
      setStatus(
        $("farm-status"),
        farmTab === "powder"
          ? "เชื่อม DevPlay แล้ว · พร้อมฟาร์มผง"
          : "เชื่อม DevPlay แล้ว · พร้อม Party Run",
        "ok"
      );
    } catch (e) {
      resetDevPlaySession();
      paintDevPlayConnectStatus(
        thError(e.message) || ERR_TH.connect_failed,
        "err"
      );
      if (String(e.message || "").includes("login_failed")) {
        showErrorModal(ERR_TH.login_failed, "เชื่อมไม่สำเร็จ");
      } else {
        showErrorModal(thError(e.message) || ERR_TH.connect_failed, "เชื่อมไม่สำเร็จ");
      }
    } finally {
      devplayConnecting = false;
      updateFarmAvailability();
    }
  }

  function switchFarmTab(tab) {
    farmTab = ["powder", "giftdraw", "heart", "upgrade"].includes(tab) ? tab : "partyrun";
    ["partyrun", "heart", "powder", "giftdraw", "upgrade"].forEach((t) => {
      const btn = $("farm-tab-" + t);
      const panel = $("farm-panel-" + t);
      const active = t === farmTab;
      if (btn) {
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (panel) {
        panel.classList.toggle("hidden", !active);
        panel.hidden = !active;
        panel.classList.toggle("is-entering", active);
      }
    });
    const partyBtn = $("farm-btn");
    const powderBtn = $("powder-btn");
    const giftdrawBtn = $("giftdraw-btn");
    const heartBtn = $("heart-btn");
    const upgradeBtn = $("upgrade-btn");
    const ticketStepper = $("farm-panel-partyrun")?.querySelector(".ticket-stepper");
    if (partyBtn) {
      partyBtn.hidden = farmTab !== "partyrun";
      partyBtn.classList.toggle("hidden", farmTab !== "partyrun");
    }
    if (powderBtn) {
      powderBtn.hidden = farmTab !== "powder";
      powderBtn.classList.toggle("hidden", farmTab !== "powder");
    }
    if (giftdrawBtn) {
      giftdrawBtn.hidden = farmTab !== "giftdraw";
      giftdrawBtn.classList.toggle("hidden", farmTab !== "giftdraw");
    }
    if (heartBtn) {
      heartBtn.hidden = farmTab !== "heart";
      heartBtn.classList.toggle("hidden", farmTab !== "heart");
    }
    if (upgradeBtn) {
      upgradeBtn.hidden = farmTab !== "upgrade";
      upgradeBtn.classList.toggle("hidden", farmTab !== "upgrade");
    }
    if (ticketStepper) ticketStepper.hidden = farmTab !== "partyrun";
    updateFarmAvailability();
    if (farmTab === "powder") {
      loadPowderTreasures().catch(() => {});
      refreshPowderEstimate().catch(() => {});
    }
    if (farmTab === "giftdraw") {
      refreshGiftDrawEstimate().catch(() => {});
    }
    if (farmTab === "upgrade") {
      loadUpgradeTreasures(false).catch(() => {});
    }
  }

  async function loadPowderTreasures() {
    if (powderTreasures.length) {
      paintPowderTreasureSelect();
      return;
    }
    try {
      await ensureApiReady();
      const data = await api("/api/farm/powder/treasures");
      powderTreasures = Array.isArray(data.treasures) ? data.treasures : [];
      if (data.default) powderTreasureName = data.default;
      paintPowderTreasureSelect();
    } catch (_) {
      paintPowderTreasureSelect();
    }
  }

  function getPowderTreasureFilter() {
    return ($("powder-treasure-search")?.value || "").trim().toLowerCase();
  }

  function paintPowderTreasureSelect() {
    const sel = $("powder-treasure-select");
    if (!sel) return;
    const q = getPowderTreasureFilter();
    const list = powderTreasures.length
      ? powderTreasures.filter(
          (t) => !q || (t.name || "").toLowerCase().includes(q)
        )
      : [{ name: powderTreasureName, price: 8900, powder_yield_lv1: 160 }];
    const prev = sel.value || powderTreasureName;
    sel.innerHTML = "";
    list.slice(0, 200).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent =
        t.name + " · " + formatNumTh(t.price) + " · +" + t.powder_yield_lv1;
      sel.appendChild(opt);
    });
    if (list.some((t) => t.name === prev)) {
      sel.value = prev;
      powderTreasureName = prev;
    } else if (list.length) {
      sel.value = list[0].name;
      powderTreasureName = list[0].name;
    }
    paintPowderEstimateStatic();
  }

  function paintPowderEstimateStatic() {
    const t = powderTreasures.find((x) => x.name === powderTreasureName);
    const priceEl = $("powder-stat-price");
    const yieldEl = $("powder-stat-yield");
    if (priceEl) priceEl.textContent = t ? formatNumTh(t.price) : "—";
    if (yieldEl) yieldEl.textContent = t ? formatNumTh(t.powder_yield_lv1) : "—";
  }

  function powderMaxRounds() {
    return Math.max(1, Number(powderEstimate?.max_rounds ?? powderEstimate?.rounds_planned) || 1);
  }

  function powderYield() {
    return Math.max(
      1,
      Number(
        powderEstimate?.powder_yield_lv1 ??
          powderTreasures.find((x) => x.name === powderTreasureName)?.powder_yield_lv1
      ) || 1
    );
  }

  function powderPricePerRound() {
    return Math.max(
      0,
      Number(
        powderEstimate?.coin_per_round ??
          powderEstimate?.price ??
          powderTreasures.find((x) => x.name === powderTreasureName)?.price
      ) || 0
    );
  }

  function clampPowderRounds(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), powderMaxRounds());
  }

  // `max_rounds` only exists on an API build that also honours the `rounds`
  // field. An older API silently ignores it and spends every coin instead, so
  // offering the control there would be lying about what the run will do.
  function powderRoundsSupported() {
    return !!powderEstimate && powderEstimate.max_rounds != null;
  }

  function paintPowderStepper() {
    const roundsEl = $("powder-rounds");
    const targetEl = $("powder-target-input");
    const minus = $("powder-minus");
    const plus = $("powder-plus");
    const costEl = $("powder-cost-line");
    const max = powderMaxRounds();
    const connected = isDevPlayConnected();
    const supported = powderRoundsSupported();
    const ready = connected && !!powderEstimate && powderEstimate.can_run && supported;

    if (ready && powderRounds == null) powderRounds = max;
    const rounds = ready ? clampPowderRounds(powderRounds ?? max) : 1;
    powderRounds = ready ? rounds : powderRounds;

    // Don't fight the field the user is typing in.
    if (roundsEl && document.activeElement !== roundsEl) {
      roundsEl.value = ready ? String(rounds) : "";
    }
    if (targetEl && document.activeElement !== targetEl) {
      targetEl.value = ready ? String(rounds * powderYield()) : "";
    }

    if (costEl) {
      if (!connected) {
        costEl.textContent = "เชื่อม DevPlay เพื่อเลือกจำนวนรอบ";
      } else if (powderEstimateLoading) {
        costEl.textContent = "กำลังคำนวณ…";
      } else if (!powderEstimate) {
        costEl.textContent = "ยังไม่ทราบยอดเหรียญ";
      } else if (!powderEstimate.can_run) {
        costEl.textContent = "เหรียญไม่พอแม้แต่รอบเดียว";
      } else if (!supported) {
        costEl.textContent =
          "⚠ เซิร์ฟเวอร์ยังไม่รองรับการเลือกจำนวนรอบ — รันแล้วจะใช้เหรียญทั้งหมดที่มี";
      } else {
        const cost = rounds * powderPricePerRound();
        const left = Math.max(0, Number(powderEstimate.coin_available || 0) - cost);
        costEl.textContent =
          "ใช้เหรียญ " +
          formatNumTh(cost) +
          " · ได้ผง " +
          formatNumTh(rounds * powderYield()) +
          " · เหลือ " +
          formatNumTh(left) +
          " (สูงสุด " +
          formatNumTh(max) +
          " รอบ)";
      }
    }

    const canEdit = ready && !farmRunning && !devplayConnecting;
    if (roundsEl) roundsEl.disabled = !canEdit;
    if (targetEl) targetEl.disabled = !canEdit;
    if (minus) minus.disabled = !canEdit || rounds <= 1;
    if (plus) plus.disabled = !canEdit || rounds >= max;
  }

  function commitPowderRoundsFromInput() {
    const el = $("powder-rounds");
    if (!el) return;
    powderRounds = clampPowderRounds(el.value);
    paintPowderStepper();
    updateFarmAvailability();
  }

  function commitPowderTargetFromInput() {
    const el = $("powder-target-input");
    if (!el) return;
    const wanted = Math.floor(Number(String(el.value || "").replace(/[^\d]/g, "")) || 0);
    // Round up: asking for 1,700 powder at 160/round means 11 rounds, not 10.
    powderRounds = clampPowderRounds(Math.ceil(wanted / powderYield()) || 1);
    paintPowderStepper();
    updateFarmAvailability();
  }

  function paintPowderEstimateFromApi(est) {
    powderEstimate = est;
    const targetEl = $("powder-estimate-target");
    const roundsEl = $("powder-stat-rounds");
    const coinEl = $("powder-stat-coin");
    const noteEl = $("powder-estimate-note");
    paintPowderEstimateStatic();
    if (!est) {
      if (targetEl) targetEl.textContent = "เชื่อม DevPlay เพื่อดูเป้าหมาย";
      if (roundsEl) roundsEl.textContent = "—";
      if (coinEl) coinEl.textContent = "—";
      if (noteEl) noteEl.textContent = "";
      paintPowderStepper();
      return;
    }
    const target = est.target_powder || 0;
    if (targetEl) {
      targetEl.textContent = est.capped
        ? "สูงสุดจากเหรียญที่มี ≈ " + formatNumTh(target) + " ผง"
        : "เป้าหมาย " + formatNumTh(target) + " ผง";
    }
    if (roundsEl) {
      roundsEl.textContent = formatNumTh(est.rounds_planned || est.rounds || 0);
    }
    const price = est.price || powderTreasures.find((x) => x.name === powderTreasureName)?.price || 0;
    const rounds = est.rounds_planned || 0;
    const coinUse = est.coin_needed != null ? est.coin_needed : rounds * price;
    if (coinEl) coinEl.textContent = formatNumTh(coinUse || "—");
    if (noteEl) {
      const parts = [];
      if (rounds >= 100) parts.push("อาจใช้เวลาหลายนาที");
      if (!est.can_run) parts.push("เหรียญไม่พอแม้ 1 รอบ");
      noteEl.textContent = parts.join(" · ");
    }
    if (est.coin != null && devplaySession) devplaySession.coin = est.coin;
    if (est.powder != null && devplaySession) devplaySession.powder = est.powder;
    paintDevPlaySessionLine();
    paintPowderStepper();
  }

  async function refreshPowderEstimate() {
    if (farmTab !== "powder" || !isDevPlayConnected()) {
      paintPowderEstimateFromApi(null);
      return;
    }
    powderEstimateLoading = true;
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const data = await api("/api/farm/powder/estimate", {
        method: "POST",
        body: {
          devplay_session_id: devplaySession.id,
          treasure_name: powderTreasureName,
        },
      });
      paintPowderEstimateFromApi(data);
    } catch (e) {
      paintPowderEstimateFromApi(null);
      const msg = thError(e.message);
      if (msg) setStatus($("farm-status"), msg, "err");
    } finally {
      powderEstimateLoading = false;
      updateFarmAvailability();
    }
  }

  /* ---------- Gift Draw ---------- */
  function clampGiftDrawCount(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), Math.max(1, giftdrawMax || 1));
  }

  function paintGiftDrawStepper() {
    const input = $("giftdraw-count");
    const hint = $("giftdraw-max-hint");
    const minus = $("giftdraw-minus");
    const plus = $("giftdraw-plus");
    const max = Math.max(1, giftdrawMax || 1);
    giftdrawCount = clampGiftDrawCount(giftdrawCount);
    const editing = input && document.activeElement === input;
    if (input && !editing) input.value = String(giftdrawCount);
    if (hint) {
      if (!isDevPlayConnected()) {
        hint.textContent = "เชื่อม DevPlay เพื่อดูกล่องที่มี";
      } else if (giftdrawEstimateLoading) {
        hint.textContent = "กำลังนับกล่องขวัญ…";
      } else if (!giftdrawEstimate) {
        hint.textContent = "ยังไม่ทราบจำนวนกล่อง";
      } else if (Number(giftdrawEstimate.available_boxes) <= 0) {
        hint.textContent = "ไม่มีกล่องขวัญในไอดีนี้ (ต้องมี Gift Point ครบ 100)";
      } else {
        hint.textContent =
          "มี " +
          formatNumTh(giftdrawEstimate.available_boxes) +
          " กล่อง · พิมพ์ได้ 1–" +
          formatNumTh(max) +
          " · ใช้ 1 โทเค็นเว็บ";
      }
    }
    const canStep =
      isDevPlayConnected() &&
      !farmRunning &&
      !devplayConnecting &&
      Number(giftdrawEstimate?.available_boxes || 0) > 0;
    if (input) input.disabled = !canStep;
    if (minus) minus.disabled = !canStep || giftdrawCount <= 1;
    if (plus) plus.disabled = !canStep || giftdrawCount >= max;
  }

  function commitGiftDrawCountFromInput() {
    const input = $("giftdraw-count");
    if (!input) return;
    giftdrawCount = clampGiftDrawCount(input.value);
    input.value = String(giftdrawCount);
    paintGiftDrawStepper();
    updateFarmAvailability();
  }

  function paintGiftDrawEstimate(est) {
    giftdrawEstimate = est;
    const boxesEl = $("giftdraw-stat-boxes");
    const maxEl = $("giftdraw-stat-max");
    const noteEl = $("giftdraw-estimate-note");
    const targetEl = $("giftdraw-estimate-target");

    if (!est) {
      giftdrawMax = 1;
      if (boxesEl) boxesEl.textContent = "—";
      if (maxEl) maxEl.textContent = "—";
      if (noteEl) noteEl.textContent = "";
      if (targetEl) {
        targetEl.textContent = "เปิดกล่องขวัญด้วย Gift Point — ไม่ใช้เพชร";
      }
      paintGiftDrawStepper();
      return;
    }

    const boxes = Math.max(0, Number(est.available_boxes) || 0);
    const perJob = Math.max(1, Number(est.max_per_job) || 1);
    giftdrawMax = Math.max(1, Math.min(boxes || 1, perJob));
    giftdrawCount = clampGiftDrawCount(giftdrawCount);

    if (boxesEl) boxesEl.textContent = formatNumTh(boxes);
    if (maxEl) maxEl.textContent = formatNumTh(Math.min(boxes || 0, perJob));
    if (targetEl) {
      targetEl.textContent = boxes
        ? "เปิดได้ " + formatNumTh(boxes) + " กล่อง — 1 โทเค็นเว็บต่อ 1 รอบ (เปิดหลายกล่องได้)"
        : "ไม่มีกล่องขวัญ — สะสม Gift Point ให้ครบ 100 ต่อ 1 กล่อง";
    }
    if (noteEl) {
      noteEl.textContent = boxes > perJob
        ? "เปิดได้สูงสุด " + formatNumTh(perJob) + " กล่องต่อรอบ — ที่เหลือรันรอบถัดไป"
        : "";
    }
    paintGiftDrawStepper();
  }

  async function refreshGiftDrawEstimate() {
    if (farmTab !== "giftdraw" || !isDevPlayConnected()) {
      paintGiftDrawEstimate(null);
      return;
    }
    giftdrawEstimateLoading = true;
    paintGiftDrawStepper();
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const data = await api("/api/farm/giftdraw/estimate", {
        method: "POST",
        body: { devplay_session_id: devplaySession.id },
      });
      paintGiftDrawEstimate(data);
    } catch (e) {
      paintGiftDrawEstimate(null);
      const msg = thError(e.message);
      if (msg) setStatus($("farm-status"), msg, "err");
    } finally {
      giftdrawEstimateLoading = false;
      paintGiftDrawStepper();
      updateFarmAvailability();
    }
  }

  /* ---------- Treasure upgrade ---------- */
  const TREASURE_IMAGE_CDN = "https://link.clashofdragons.com/images/treasures";

  function upgradeImageSrc(t) {
    const name = (t?.name || "").trim();
    if (!name) return "";
    return TREASURE_IMAGE_CDN + "/" + encodeURIComponent(name) + ".png";
  }

  function getSelectedUpgradeItems() {
    return upgradeTreasures.filter((t) => upgradeSelected.has(t.uuid) && t.can_upgrade);
  }

  function paintUpgradeEstimate() {
    const selected = getSelectedUpgradeItems();
    const selEl = $("upgrade-stat-selected");
    const tokEl = $("upgrade-stat-tokens");
    const worstEl = $("upgrade-stat-worst");
    const coinEl = $("upgrade-stat-coin");
    const targetEl = $("upgrade-estimate-target");
    const noteEl = $("upgrade-estimate-note");
    if (coinEl) coinEl.textContent = formatNumTh(upgradeCoin);
    if (selEl) selEl.textContent = formatNumTh(selected.length) + " ชิ้น";
    if (tokEl) tokEl.textContent = formatNumTh(selected.length);
    if (!selected.length) {
      if (targetEl) targetEl.textContent = "เลือกสมบัติเพื่อดูประมาณการ";
      if (worstEl) worstEl.textContent = "—";
      if (noteEl) noteEl.textContent = "";
      return;
    }
    let worst = 0;
    selected.forEach((t) => {
      const est = (upgradeEstimate?.estimates || []).find((x) => x.uuid === t.uuid);
      worst += Number(est?.worst_case_coin || 0);
    });
    if (worstEl) worstEl.textContent = formatNumTh(worst) + " coin";
    if (targetEl) {
      targetEl.textContent =
        "เป้าหมาย +"+ upgradeTargetLevel + " · 1 โทเค็น/ชิ้น · อาจแห้วได้";
    }
    if (noteEl) {
      noteEl.textContent =
        worst > upgradeCoin
          ? "coin อาจไม่พอถึงเป้า — ระบบจะหยุดและรายงาน partial"
          : "ค่าใช้จ่ายจริงขึ้นกับ RNG — worst case คือแห้วทุกครั้ง";
    }
  }

  function paintUpgradeGrid() {
    const grid = $("upgrade-grid");
    const hint = $("upgrade-grid-hint");
    if (!grid) return;
    grid.innerHTML = "";
    if (!isDevPlayConnected()) {
      if (hint) hint.textContent = "เชื่อม DevPlay เพื่อดูสมบัติในตัว";
      return;
    }
    if (!upgradeTreasures.length) {
      if (hint) hint.textContent = "ไม่พบสมบัติในคลัง (หรือยังไม่ได้โหลด)";
      return;
    }
    if (hint) hint.textContent = "เลือกได้หลายชิ้น — รันทีละชิ้น (หักโทเค็นต่อชิ้น)";
    upgradeTreasures.forEach((t) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "upgrade-card grade-" +
        escapeHtml((t.grade || "S").toUpperCase()) +
        (upgradeSelected.has(t.uuid) ? " is-selected" : "") +
        (t.can_upgrade ? "" : " is-maxed");
      card.disabled = !t.can_upgrade || farmRunning || devplayConnecting;
      card.dataset.uuid = t.uuid;
      const check = document.createElement("span");
      check.className = "upgrade-card-check";
      check.textContent = upgradeSelected.has(t.uuid) ? "✓" : "";
      const imgWrap = document.createElement("div");
      imgWrap.className = "upgrade-card-img-wrap";
      const src = t.image_url || upgradeImageSrc(t);
      if (src) {
        const img = document.createElement("img");
        img.className = "upgrade-card-img";
        img.alt = "";
        img.loading = "lazy";
        img.src = src;
        img.onerror = () => {
          img.remove();
          const fb = document.createElement("div");
          fb.className = "upgrade-card-fallback grade-" + (t.grade || "S").toUpperCase();
          fb.textContent = (t.grade || "S").toUpperCase();
          imgWrap.appendChild(fb);
        };
        imgWrap.appendChild(img);
      } else {
        const fb = document.createElement("div");
        fb.className = "upgrade-card-fallback grade-" + (t.grade || "S").toUpperCase();
        fb.textContent = (t.grade || "S").toUpperCase();
        imgWrap.appendChild(fb);
      }
      const name = document.createElement("div");
      name.className = "upgrade-card-name";
      name.textContent = t.name || "Treasure";
      const meta = document.createElement("div");
      meta.className = "upgrade-card-meta";
      meta.textContent = (t.grade || "S") + " · +" + (t.tag ?? t.level ?? 0);
      card.append(check, imgWrap, name, meta);
      card.addEventListener("click", () => {
        if (!t.can_upgrade) return;
        if (upgradeSelected.has(t.uuid)) upgradeSelected.delete(t.uuid);
        else upgradeSelected.add(t.uuid);
        paintUpgradeGrid();
        refreshUpgradeEstimate().catch(() => {});
        updateFarmAvailability();
      });
      grid.appendChild(card);
    });
    paintUpgradeEstimate();
  }

  async function loadUpgradeTreasures(force) {
    if (!isDevPlayConnected()) {
      upgradeTreasures = [];
      upgradeSelected.clear();
      paintUpgradeGrid();
      return;
    }
    if (upgradeTreasures.length && !force) {
      paintUpgradeGrid();
      return;
    }
    try {
      await ensureApiReady();
      const data = await api(
        "/api/farm/upgrade/treasures?devplay_session_id=" +
          encodeURIComponent(devplaySession.id)
      );
      upgradeTreasures = Array.isArray(data.treasures) ? data.treasures : [];
      upgradeCoin = Number(data.coin || 0);
      const valid = new Set(upgradeTreasures.map((t) => t.uuid));
      upgradeSelected.forEach((id) => {
        if (!valid.has(id)) upgradeSelected.delete(id);
      });
      paintUpgradeGrid();
      await refreshUpgradeEstimate();
    } catch (e) {
      upgradeTreasures = [];
      paintUpgradeGrid();
      const msg = thError(e.message);
      if (msg) setStatus($("farm-status"), msg, "err");
    }
  }

  async function refreshUpgradeEstimate() {
    const selected = getSelectedUpgradeItems();
    if (!selected.length || !isDevPlayConnected()) {
      upgradeEstimate = null;
      paintUpgradeEstimate();
      return;
    }
    upgradeEstimateLoading = true;
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const items = selected.map((t) => ({
        uuid: t.uuid,
        group_seq: t.group_seq,
        grade: t.grade || "S",
        target_level: upgradeTargetLevel,
      }));
      upgradeEstimate = await api("/api/farm/upgrade/estimate", {
        method: "POST",
        body: {
          devplay_session_id: devplaySession.id,
          items,
        },
      });
      if (upgradeEstimate?.coin != null) upgradeCoin = Number(upgradeEstimate.coin);
    } catch (_) {
      upgradeEstimate = null;
    } finally {
      upgradeEstimateLoading = false;
      paintUpgradeEstimate();
      updateFarmAvailability();
    }
  }

  function showUpgradeConfirmModal(items) {
    const n = items.length;
    const worst =
      upgradeEstimate?.total_worst_case_coin != null
        ? formatNumTh(upgradeEstimate.total_worst_case_coin)
        : "—";
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันตีบวกสมบัติ?",
        body:
          "ตีบวก " +
          formatNumTh(n) +
          " ชิ้น → เป้า +" +
          upgradeTargetLevel +
          "\nหัก " +
          formatNumTh(n) +
          " โทเค็น (ชิ้นละ 1)\n" +
          "coin สูงสุด (worst): " +
          worst +
          "\n⚠ แห้วได้ — coin หายแม้ไม่ติดระดับ",
        icon: "assets/tr_ga170.png",
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

  /* ---------- Heart farm ---------- */
  function clampHeartTarget(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), Math.max(1, heartMax || 1));
  }

  function paintHeartStepper() {
    const input = $("heart-target");
    const hint = $("heart-max-hint");
    const minus = $("heart-minus");
    const plus = $("heart-plus");
    const max = Math.max(1, heartMax || 1);
    heartTarget = clampHeartTarget(heartTarget);
    const editing = input && document.activeElement === input;
    if (input && !editing) input.value = String(heartTarget);
    if (hint) {
      if (!hasDevPlayCreds()) {
        hint.textContent = "กรอกอีเมล/รหัสผ่านบัญชีเกมก่อน";
      } else if (heartEstimateLoading) {
        hint.textContent = "กำลังตรวจสอบช่องว่างเพื่อน…";
      } else if (!heartEstimate) {
        hint.textContent = "กดตรวจสอบช่องว่างเพื่อนก่อน (ไม่หักโทเค็น)";
      } else if (Number(heartEstimate.room) <= 0) {
        hint.textContent = "เพื่อนเต็ม 300 แล้ว — ต้องลบเพื่อนจริงออกก่อน";
      } else {
        hint.textContent =
          "ว่าง " +
          formatNumTh(heartEstimate.room) +
          " ช่อง · พิมพ์ได้ 1–" +
          formatNumTh(max) +
          " · ใช้ 1 โทเค็นเว็บ";
      }
    }
    const canStep =
      !farmRunning && !devplayConnecting && Number(heartEstimate?.room || 0) > 0;
    if (input) input.disabled = !canStep;
    if (minus) minus.disabled = !canStep || heartTarget <= 1;
    if (plus) plus.disabled = !canStep || heartTarget >= max;
  }

  function commitHeartTargetFromInput() {
    const input = $("heart-target");
    if (!input) return;
    heartTarget = clampHeartTarget(input.value);
    input.value = String(heartTarget);
    paintHeartStepper();
    updateFarmAvailability();
  }

  function paintHeartEstimate(est) {
    heartEstimate = est;
    const friendsEl = $("heart-stat-friends");
    const roomEl = $("heart-stat-room");
    const maxEl = $("heart-stat-max");
    const capEl = $("heart-stat-cap");
    const noteEl = $("heart-estimate-note");

    if (!est) {
      heartMax = 300;
      if (friendsEl) friendsEl.textContent = "—";
      if (roomEl) roomEl.textContent = "—";
      if (maxEl) maxEl.textContent = "—";
      if (noteEl) noteEl.textContent = "";
      paintHeartStepper();
      return;
    }

    const room = Math.max(0, Number(est.room) || 0);
    heartMax = Math.max(1, Number(est.max_target) || room || 1);
    heartTarget = clampHeartTarget(heartTarget);

    if (friendsEl) friendsEl.textContent = formatNumTh(est.friends ?? "—");
    if (roomEl) roomEl.textContent = formatNumTh(room);
    if (maxEl) maxEl.textContent = formatNumTh(heartMax);
    if (capEl) capEl.textContent = formatNumTh(est.friend_cap ?? 300);
    if (noteEl) {
      noteEl.textContent = room
        ? "ยิ่งขอเยอะยิ่งใช้เวลานาน — เริ่มจากน้อย ๆ ก่อนได้"
        : "ไม่มีช่องว่างให้เพิ่มเพื่อน guest";
    }
    paintHeartStepper();
  }

  async function refreshHeartEstimate() {
    if (farmTab !== "heart") return;
    if (!hasDevPlayCreds()) {
      showErrorModal("กรอกอีเมลและรหัสผ่านบัญชีเกมให้ครบ", "ข้อมูลไม่ครบ");
      return;
    }
    heartEstimateLoading = true;
    paintHeartStepper();
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const data = await api("/api/farm/heart/estimate", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
        },
      });
      paintHeartEstimate(data);
      setStatus(
        $("farm-status"),
        "ว่าง " + formatNumTh(data.room) + " ช่อง · พร้อมฟาร์มหัวใจ",
        "ok"
      );
    } catch (e) {
      paintHeartEstimate(null);
      const msg = thError(e.message) || "ตรวจสอบไม่สำเร็จ";
      setStatus($("farm-status"), msg, "err");
      if (/heart_disabled|heart_proxy_not_configured/i.test(String(e.message))) {
        showErrorModal(msg, "ยังใช้ไม่ได้");
      }
    } finally {
      heartEstimateLoading = false;
      paintHeartStepper();
      updateFarmAvailability();
    }
  }

  function updateFarmAvailability() {
    const btn = $("farm-btn");
    const powderBtn = $("powder-btn");
    const giftdrawBtn = $("giftdraw-btn");
    const connectBtn = $("devplay-connect-btn");
    const sub = $("farm-btn-sub");
    const powderSub = $("powder-btn-sub");
    const giftdrawSub = $("giftdraw-btn-sub");
    const heartBtn = $("heart-btn");
    const heartCheckBtn = $("heart-check-btn");
    const heartSub = $("heart-btn-sub");
    const upgradeBtn = $("upgrade-btn");
    const upgradeSub = $("upgrade-btn-sub");
    const upgradeRng = $("upgrade-rng-accept");
    const upgradeTarget = $("upgrade-target-level");
    const upgradeReload = $("upgrade-reload-btn");
    const empty = !hasTokens();
    const credsReady = hasDevPlayCreds();
    const connected = isDevPlayConnected();
    const busy = farmRunning || devplayConnecting;
    const isPowder = farmTab === "powder";
    const isGiftDraw = farmTab === "giftdraw";
    const isHeart = farmTab === "heart";

    if (connectBtn) {
      connectBtn.disabled = busy || !credsReady || connected;
      connectBtn.hidden = connected;
      connectBtn.classList.toggle("hidden", connected);
    }
    const noTickets =
      farmTab === "partyrun" &&
      connected &&
      devplaySession?.tickets != null &&
      Number(devplaySession.tickets) <= 0;

    if (heartCheckBtn) {
      heartCheckBtn.disabled = !credsReady || busy || heartEstimateLoading;
    }

    if (isHeart) {
      const noRoom = Number(heartEstimate?.room || 0) <= 0;
      const heartOffline = heartServiceStatus && !heartServiceStatus.ready;
      if (heartBtn && !farmRunning) {
        heartBtn.disabled =
          empty || !credsReady || busy || heartEstimateLoading || noRoom || heartOffline;
      }
      if (btn && !farmRunning) btn.disabled = true;
      if (powderBtn && !farmRunning) powderBtn.disabled = true;
      if (giftdrawBtn && !farmRunning) giftdrawBtn.disabled = true;
      if (upgradeBtn && !farmRunning) upgradeBtn.disabled = true;
      if (heartSub) {
        if (heartOffline) heartSub.textContent = "ฟาร์มหัวใจยังไม่เปิด";
        else if (!credsReady) heartSub.textContent = "กรอกบัญชีเกมก่อน";
        else if (heartEstimateLoading) heartSub.textContent = "กำลังตรวจสอบ…";
        else if (!heartEstimate) heartSub.textContent = "กดตรวจสอบช่องว่างก่อน";
        else if (noRoom) heartSub.textContent = "เพื่อนเต็ม 300 แล้ว";
        else {
          heartSub.textContent =
            "ขอ " + formatNumTh(heartTarget) + " หัวใจ · หัก 1 โทเค็น";
        }
      }
      paintHeartStepper();
    } else if (isGiftDraw) {
      const noBoxes = Number(giftdrawEstimate?.available_boxes || 0) <= 0;
      if (giftdrawBtn && !farmRunning) {
        giftdrawBtn.disabled =
          empty || !connected || busy || giftdrawEstimateLoading || noBoxes;
      }
      if (btn && !farmRunning) btn.disabled = true;
      if (powderBtn && !farmRunning) powderBtn.disabled = true;
      if (heartBtn && !farmRunning) heartBtn.disabled = true;
      if (upgradeBtn && !farmRunning) upgradeBtn.disabled = true;
      if (giftdrawSub) {
        if (!connected) giftdrawSub.textContent = "เชื่อม DevPlay ก่อน";
        else if (giftdrawEstimateLoading) giftdrawSub.textContent = "กำลังนับกล่อง…";
        else if (noBoxes) giftdrawSub.textContent = "ไม่มีกล่องขวัญ";
        else {
          giftdrawSub.textContent =
            "เปิด " + formatNumTh(giftdrawCount) + " กล่อง · หัก 1 โทเค็น";
        }
      }
    } else if (farmTab === "upgrade") {
      const selected = getSelectedUpgradeItems();
      const needTokens = selected.length;
      const blocked =
        !connected ||
        upgradeEstimateLoading ||
        !selected.length ||
        !upgradeRngAccepted ||
        needTokens > Number(tokenBalance());
      if (upgradeBtn && !farmRunning) {
        upgradeBtn.disabled = empty || busy || blocked;
      }
      if (btn && !farmRunning) btn.disabled = true;
      if (powderBtn && !farmRunning) powderBtn.disabled = true;
      if (giftdrawBtn && !farmRunning) giftdrawBtn.disabled = true;
      if (heartBtn && !farmRunning) heartBtn.disabled = true;
      const canPick = connected && !farmRunning && !devplayConnecting;
      if (upgradeRng) upgradeRng.disabled = !canPick;
      if (upgradeTarget) upgradeTarget.disabled = !canPick;
      if (upgradeReload) upgradeReload.disabled = !canPick;
      if (upgradeSub) {
        if (!connected) upgradeSub.textContent = "เชื่อม DevPlay ก่อน";
        else if (!selected.length) upgradeSub.textContent = "เลือกสมบัติก่อน";
        else if (!upgradeRngAccepted) upgradeSub.textContent = "ยอมรับความเสี่ยง RNG ก่อน";
        else if (needTokens > Number(tokenBalance())) {
          upgradeSub.textContent = "โทเค็นไม่พอ (" + formatNumTh(needTokens) + " ชิ้น)";
        } else if (upgradeEstimateLoading) upgradeSub.textContent = "กำลังคำนวณ…";
        else {
          upgradeSub.textContent =
            formatNumTh(needTokens) + " ชิ้น · หัก " + formatNumTh(needTokens) + " โทเค็น";
        }
      }
      paintUpgradeEstimate();
    } else if (isPowder) {
      const powderBlocked =
        !connected || powderEstimateLoading || !powderEstimate?.can_run;
      if (powderBtn && !farmRunning) {
        powderBtn.disabled = empty || !connected || busy || powderBlocked;
      }
      if (btn && !farmRunning) btn.disabled = true;
      if (powderSub) {
        if (!connected) powderSub.textContent = "เชื่อม DevPlay ก่อน";
        else if (powderEstimateLoading) powderSub.textContent = "กำลังคำนวณ…";
        else if (!powderEstimate?.can_run) powderSub.textContent = "เหรียญไม่พอ";
        else if (powderEstimate?.capped) {
          powderSub.textContent =
            "เป้า " + formatNumTh(powderEstimate.target_powder) + " ผง (จำกัดเหรียญ)";
        } else powderSub.textContent = "เป้า 100,000 ผง · หัก 1 โทเค็น";
      }
      if (giftdrawBtn && !farmRunning) giftdrawBtn.disabled = true;
      if (heartBtn && !farmRunning) heartBtn.disabled = true;
      if (upgradeBtn && !farmRunning) upgradeBtn.disabled = true;
      paintPowderStepper();
      const search = $("powder-treasure-search");
      const sel = $("powder-treasure-select");
      const canPick = connected && !farmRunning && !devplayConnecting;
      if (search) search.disabled = !canPick;
      if (sel) sel.disabled = !canPick;
    } else {
      if (powderBtn && !farmRunning) powderBtn.disabled = true;
      if (giftdrawBtn && !farmRunning) giftdrawBtn.disabled = true;
      if (heartBtn && !farmRunning) heartBtn.disabled = true;
      if (upgradeBtn && !farmRunning) upgradeBtn.disabled = true;
      if (btn && !farmRunning) {
        btn.disabled = empty || !connected || busy || noTickets;
      }
      if (sub) {
        if (!connected) sub.textContent = "เชื่อม DevPlay ก่อน";
        else if (noTickets) sub.textContent = "ไม่มีตั๋ว Party Run";
        else sub.textContent = "รัน " + ticketCount + " ตั๋ว · หัก 1 โทเค็น";
      }
    }

    setFarmInputsLocked(empty || !connected || busy);
    paintTicketStepper();
    if (isGiftDraw) paintGiftDrawStepper();
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

  let farmHistoryItems = [];

  function farmHistoryListHtml(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return '<ul class="farm-history-list"><li class="muted">ยังไม่มีประวัติ</li></ul>';
    }
    const rows = list
      .slice(0, 12)
      .map((row) => {
        const st = row.status || "—";
        const stLabel =
          st === "succeeded"
            ? "สำเร็จ"
            : st === "failed"
              ? "ล้มเหลว"
              : st === "running"
                ? "กำลังรัน"
                : st;
        const stClass =
          st === "succeeded" ? "hist-ok" : st === "failed" ? "hist-warn" : "";
        const res = row.result || {};
        const summary = res.mode === "powder"
          ? "ผง +" +
            escapeHtml(formatNumTh(res.powder_gained || 0)) +
            " · " +
            escapeHtml(res.treasure || "Powder") +
            " · " +
            escapeHtml(formatNumTh(res.rounds || 0)) +
            " รอบ"
          : res.mode === "giftdraw"
          ? "กล่องขวัญ " +
            escapeHtml(formatNumTh(res.draws_ok || 0)) +
            "/" +
            escapeHtml(formatNumTh(res.requested || 0)) +
            " กล่อง"
          : res.mode === "heart"
          ? "หัวใจ +" +
            escapeHtml(formatNumTh(res.hearts || 0)) +
            " / ขอ " +
            escapeHtml(formatNumTh(res.target || 0))
          : "S " +
            escapeHtml(formatNumTh(row.score)) +
            " · C " +
            escapeHtml(formatNumTh(row.coin)) +
            " · XP " +
            escapeHtml(formatNumTh(row.exp));
        return (
          "<li>" +
          "<span>" +
          summary +
          "</span>" +
          '<span class="' +
          stClass +
          '">' +
          escapeHtml(stLabel) +
          "</span>" +
          '<span class="hist-meta">' +
          escapeHtml(formatTopupDay(row.created_at)) +
          (row.error ? " · " + escapeHtml(String(row.error).slice(0, 60)) : "") +
          "</span>" +
          "</li>"
        );
      })
      .join("");
    return '<ul class="farm-history-list">' + rows + "</ul>";
  }

  function renderFarmHistory(items) {
    farmHistoryItems = Array.isArray(items) ? items : [];
    const countEl = $("farm-history-count");
    if (countEl) {
      if (farmHistoryItems.length) {
        countEl.hidden = false;
        countEl.textContent = String(Math.min(farmHistoryItems.length, 99));
      } else {
        countEl.hidden = true;
        countEl.textContent = "";
      }
    }
  }

  function showFarmHistoryModal() {
    clearModalActions();
    openModal({
      mode: "farm-history",
      title: "ประวัติฟาร์มล่าสุด",
      bodyHtml: farmHistoryListHtml(farmHistoryItems),
      icon: "assets/tr_event_116.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ปิด", "btn-candy", () => forceCloseModal())
    );
  }

  async function loadFarmHistory() {
    if (!accessToken) {
      renderFarmHistory([]);
      return;
    }
    try {
      const data = await api("/api/farm/history");
      renderFarmHistory(data.items || []);
    } catch (_) {
      renderFarmHistory([]);
    }
  }

  function fallbackTopupPackages() {
    return [
      { tokens: 1, price_baht: 50, save_baht: 0, promo: false },
      { tokens: 2, price_baht: 100, save_baht: 0, promo: false },
      { tokens: 3, price_baht: 135, save_baht: 15, promo: true },
      { tokens: 4, price_baht: 170, save_baht: 30, promo: true },
      { tokens: 5, price_baht: 200, save_baht: 50, promo: true },
      { tokens: 6, price_baht: 225, save_baht: 75, promo: true },
      { tokens: 7, price_baht: 245, save_baht: 105, promo: true },
      { tokens: 8, price_baht: 260, save_baht: 140, promo: true },
      { tokens: 9, price_baht: 280, save_baht: 170, promo: true },
      { tokens: 10, price_baht: 300, save_baht: 200, promo: true },
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
      if (data && typeof data === "object") {
        delete data.trace;
      }
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
    $("logout-btn")?.classList.remove("hidden");
    $("nav-balance")?.classList.remove("hidden");
    $("pos-nav")?.classList.remove("hidden");
    $("topbar-user")?.classList.remove("hidden");
    $("topup-toggle")?.classList.remove("hidden");
    $("pos-token-strip")?.classList.remove("hidden");
    restorePeekCooldown();
    updateFarmAvailability();
    refreshGateAndQueueUi().catch(() => {});
    loadTopupHistory().catch(() => {});
    loadFarmHistory().catch(() => {});
    loadHeartServiceStatus().catch(() => {});
  }

  function showLogin() {
    stopBalancePoll();
    stopQueuePoll();
    clearQueuedRun();
    forceCloseModal();
    forceCloseRunStatusPopup();
    loginView.classList.remove("hidden");
    userView.classList.add("hidden");
    $("logout-btn")?.classList.add("hidden");
    $("nav-balance")?.classList.add("hidden");
    $("pos-nav")?.classList.add("hidden");
    $("topbar-user")?.classList.add("hidden");
    $("topup-toggle")?.classList.add("hidden");
    $("pos-token-strip")?.classList.add("hidden");
  }

  function paintProfile() {
    const bal = tokenBalance();
    const tokenEl = $("token-balance");
    const navBal = $("nav-balance-num");
    const who = $("who-user");
    if (tokenEl) tokenEl.textContent = String(bal);
    if (navBal) navBal.textContent = String(bal);
    if (who) who.textContent = profile?.username || profile?.display_name || "—";
    updateFarmAvailability();
  }

  async function refreshMe() {
    const data = await api("/api/me");
    profile = data.profile;
    paintProfile();
    showApp();
  }

  /* ---------- Mode-aware farm status pipeline ---------- */
  const MODE_STATUS = {
    partyrun: {
      title: "สถานะการวิ่ง",
      runningSub: "กำลังวิ่ง… ห้ามปิดจนกว่าจะเสร็จ",
      heroIcon: "assets/cookie_run.gif",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "clear", label: "เคลียร์รางวัลค้าง" },
        { id: "match", label: "จับคู่" },
        { id: "run", label: "วิ่งฟาร์ม" },
        { id: "claim", label: "รับรางวัล" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "กำลังวิ่งรอบ " + formatNumTh(current) + "/" + formatNumTh(total);
        return "กำลังวิ่งฟาร์ม…";
      },
    },
    giftdraw: {
      title: "สถานะการเปิดกล่อง",
      runningSub: "กำลังเปิดกล่องขวัญ… ห้ามปิดจนกว่าจะเสร็จ",
      heroIcon: "assets/icon_giftpoint.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "open", label: "เปิดกล่องขวัญ" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "กำลังเปิด " + formatNumTh(current) + "/" + formatNumTh(total) + " กล่อง";
        return "กำลังเปิดกล่องขวัญ…";
      },
    },
    heart: {
      title: "สถานะฟาร์มหัวใจ",
      runningSub: "กำลังฟาร์มหัวใจ… ห้ามปิดจนกว่าจะเสร็จ",
      heroIcon: "assets/pet81_jelly.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "guests", label: "สร้างเพื่อน guest" },
        { id: "send", label: "ส่งหัวใจ" },
        { id: "claim", label: "รับหัวใจ" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "ได้หัวใจแล้ว " + formatNumTh(current) + "/" + formatNumTh(total);
        return "กำลังฟาร์มหัวใจ…";
      },
    },
    powder: {
      title: "สถานะฟาร์มผง",
      runningSub: "กำลังฟาร์มผง… ห้ามปิดจนกว่าจะเสร็จ",
      heroIcon: "assets/crc_cookie_stone_box.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "buy", label: "ซื้อสมบัติ" },
        { id: "extract", label: "ย่อยเป็นผง" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "รอบที่ " + formatNumTh(current) + "/" + formatNumTh(total);
        return "กำลังฟาร์มผง…";
      },
    },
    upgrade: {
      title: "สถานะตีบวกสมบัติ",
      runningSub: "กำลังตีบวก… ห้ามปิดจนกว่าจะเสร็จ",
      heroIcon: "assets/tr_ga170.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "upgrade", label: "ตีบวกสมบัติ" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "ชิ้นที่ " + formatNumTh(current) + "/" + formatNumTh(total);
        return "กำลังตีบวกสมบัติ…";
      },
    },
  };

  let pipelineState = null;

  function modeConfig(mode) {
    return MODE_STATUS[mode] || MODE_STATUS.partyrun;
  }

  function pipelineStepsFor(mode) {
    return modeConfig(mode).steps;
  }

  function truncateLogLine(text, maxLen) {
    const s = String(text || "").trim();
    if (!s) return "";
    const limit = maxLen || 200;
    if (s.length <= limit) return s;
    return s.slice(0, limit - 1) + "…";
  }

  function sanitizeDisplayError(raw, fallback) {
    if (!raw && fallback) return thError(fallback);
    if (typeof raw === "object" && raw !== null) {
      const code = raw.error || raw.detail || raw.message || "";
      return thError(String(code || fallback || ""));
    }
    return thError(String(raw || fallback || ""));
  }

  function parseProgressFromLogs(rawLogs, mode, targetHint) {
    const lines = (Array.isArray(rawLogs) ? rawLogs : [])
      .map((l) => String(l || "").trim())
      .filter(Boolean);
    const out = {
      current: 0,
      total: Number(targetHint) || 0,
      phase: "start",
      lines: [],
      stepIdx: 0,
    };

    for (const s of lines) {
      const friendly = formatLogLine(s, mode);
      if (friendly) out.lines.push(friendly);

      if (mode === "partyrun") {
        const m = s.match(/\[round\s+(\d+)\/(\d+)\]/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "run";
          out.stepIdx = 3;
        }
        if (/LOGIN OK|login ok/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 1);
        if (/clearing pending|cleared pending/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 2);
        if (/matchmaking|ingame_id/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 2);
        if (/playing \+|submitted run_end/i.test(s)) {
          out.phase = "run";
          out.stepIdx = 3;
        }
        if (/claiming reward|REWARD CLAIMED/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 4);
      } else if (mode === "giftdraw") {
        const m = s.match(/giftdraw\s+\[(\d+)\/(\d+)\]/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "open";
          out.stepIdx = 1;
        }
        if (/login|initMember/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 0);
      } else if (mode === "heart") {
        let m = s.match(/TOTAL\s+(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "claim";
          out.stepIdx = 3;
        }
        m = s.match(/SESSION\s+\d+\s+done:\s+collected\s+(\d+)\/(\d+)/i);
        if (m) {
          out.phase = "send";
          out.stepIdx = 2;
        }
        if (/guest|friend|SendLife|AcceptLife/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 1);
        if (/heart:\s*target=/i.test(s)) out.stepIdx = 0;
      } else if (mode === "powder") {
        const m = s.match(/\[(\d+)\]\s+\+\d+\s+powder\s+gained=(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[3]);
          out.phase = "extract";
          out.stepIdx = 2;
        }
        if (/powder:\s*loading/i.test(s)) out.stepIdx = 0;
        if (/ซื้อ|buy/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 1);
      } else if (mode === "upgrade") {
        const m = s.match(/upgrade\s+\[(\d+)\]/i);
        if (m) {
          out.current = Number(m[1]);
          out.phase = "upgrade";
          out.stepIdx = 1;
        }
        if (/upgrade:\s*refresh|initMember/i.test(s)) out.stepIdx = 0;
        if (/SUCCESS|FAIL|coin ไม่พอ/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 1);
      }
    }

    if (!out.total && targetHint) out.total = Number(targetHint) || 0;
    return out;
  }

  function formatLogLine(raw, mode) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/traceback|RpcError|Exception|at 0x/i.test(s)) return "";
    if (mode === "partyrun" && /\[round\s+(\d+)\/(\d+)\]/i.test(s)) {
      const m = s.match(/\[round\s+(\d+)\/(\d+)\]/i);
      return "รอบ " + m[1] + "/" + m[2] + " — " + truncateLogLine(s.replace(/\[round\s+\d+\/\d+\]\s*/i, ""), 120);
    }
    if (mode === "giftdraw" && /giftdraw\s+\[(\d+)\/(\d+)\]/i.test(s)) {
      const m = s.match(/giftdraw\s+\[(\d+)\/(\d+)\]:\s*(.+)/i);
      if (m) return "กล่อง " + m[1] + "/" + m[2] + " — " + truncateLogLine(m[3], 100);
    }
    if (mode === "heart") {
      if (/TOTAL\s+(\d+)\/(\d+)/i.test(s)) {
        const m = s.match(/TOTAL\s+(\d+)\/(\d+)/i);
        return "รวมได้หัวใจ " + formatNumTh(m[1]) + "/" + formatNumTh(m[2]);
      }
      if (/SESSION\s+\d+\s+done/i.test(s)) return truncateLogLine(s, 160);
    }
    if (mode === "powder" && /\[(\d+)\]\s+\+\d+\s+powder/i.test(s)) {
      const m = s.match(/\[(\d+)\]\s+\+(\d+)\s+powder\s+gained=(\d+)\/(\d+)/i);
      if (m) return "รอบ " + m[1] + " +" + formatNumTh(m[2]) + " ผง (" + formatNumTh(m[3]) + "/" + formatNumTh(m[4]) + ")";
    }
    if (mode === "upgrade" && /upgrade\s+\[/i.test(s)) {
      if (/SUCCESS/i.test(s)) return truncateLogLine(s.replace(/upgrade\s+\[\d+\]\s*/i, "✅ "), 140);
      if (/FAIL/i.test(s)) return truncateLogLine(s.replace(/upgrade\s+\[\d+\]\s*/i, "❌ "), 140);
      if (/coin ไม่พอ/i.test(s)) return truncateLogLine(s, 140);
      return truncateLogLine(s, 140);
    }
    if (s.length > 160 || /[{}\[\]]/.test(s)) return "";
    return truncateLogLine(s, 160);
  }

  function formatNumTh(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? "");
    return String(Math.trunc(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function setRunStatusSubtitle(done, ok) {
    const sub = $("run-status-subtitle");
    if (!sub) return;
    const cfg = modeConfig(statusContext?.mode || "partyrun");
    sub.classList.remove("is-done", "is-fail");
    if (!done) {
      sub.textContent = cfg.runningSub;
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

  function setRunStatusTitle(mode) {
    const title = $("run-status-title");
    const icon = $("run-status-hero-icon");
    const cfg = modeConfig(mode);
    if (title) title.textContent = cfg.title;
    if (icon) icon.src = cfg.heroIcon;
  }

  function updateProgressBar(current, total) {
    const wrap = $("run-status-progress");
    const fill = $("run-status-progress-fill");
    const text = $("run-status-progress-text");
    if (!wrap || !fill) return;
    const t = Number(total) || 0;
    const c = Number(current) || 0;
    if (t > 0) {
      wrap.classList.remove("hidden");
      const pct = Math.max(4, Math.min(100, Math.round((c / t) * 100)));
      fill.style.width = pct + "%";
      if (text) text.textContent = formatNumTh(c) + " / " + formatNumTh(t);
    } else {
      wrap.classList.add("hidden");
      fill.style.width = "0%";
      if (text) text.textContent = "";
    }
  }

  function renderLogList(lines, extras) {
    const list = $("farm-log");
    if (!list) return;
    list.replaceChildren();
    const all = [];
    if (Array.isArray(lines)) {
      for (const ln of lines) {
        const t = typeof ln === "string" ? ln : ln?.text;
        if (t) all.push({ text: t, kind: ln?.kind || "ok" });
      }
    }
    if (Array.isArray(extras)) {
      for (const ex of extras) {
        if (ex?.text) all.push(ex);
      }
    }
    if (!all.length) {
      list.classList.add("hidden");
      return;
    }
    list.classList.remove("hidden");
    for (const extra of all.slice(-12)) {
      const li = document.createElement("li");
      li.textContent = truncateLogLine(extra.text, 200);
      li.classList.add(extra.kind || "ok");
      list.appendChild(li);
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

  function freshPipeline(mode) {
    const steps = pipelineStepsFor(mode);
    const kinds = {};
    for (const s of steps) kinds[s.id] = "idle";
    return { mode, steps, activeIdx: 0, kinds, extras: [], logLines: [], progress: { current: 0, total: 0 } };
  }

  function setPipelineActive(idx) {
    if (!pipelineState) pipelineState = freshPipeline(statusContext?.mode || "partyrun");
    const steps = pipelineState.steps || pipelineStepsFor(pipelineState.mode);
    const max = steps.length - 1;
    const next = Math.max(0, Math.min(idx, max));
    for (let i = 0; i < steps.length; i++) {
      const id = steps[i].id;
      if (i < next) pipelineState.kinds[id] = "ok";
      else if (i === next) pipelineState.kinds[id] = "pending";
      else if (pipelineState.kinds[id] === "pending") pipelineState.kinds[id] = "idle";
    }
    pipelineState.activeIdx = next;
    renderPipeline();
  }

  function markPipelineError(stepId, message) {
    if (!pipelineState) pipelineState = freshPipeline(statusContext?.mode || "partyrun");
    const steps = pipelineState.steps || pipelineStepsFor(pipelineState.mode);
    let hit = false;
    for (const s of steps) {
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
      pipelineState.extras = [{ text: sanitizeDisplayError(message), kind: "err" }];
    }
    renderPipeline();
  }

  function finalizePipelineSuccess() {
    if (!pipelineState) pipelineState = freshPipeline(statusContext?.mode || "partyrun");
    const steps = pipelineState.steps || pipelineStepsFor(pipelineState.mode);
    for (const s of steps) pipelineState.kinds[s.id] = "ok";
    pipelineState.activeIdx = steps.length - 1;
    renderPipeline();
  }

  function applyLogsToPipeline(rawLogs, mode) {
    if (!pipelineState) pipelineState = freshPipeline(mode || statusContext?.mode || "partyrun");
    const m = mode || pipelineState.mode || statusContext?.mode || "partyrun";
    const parsed = parseProgressFromLogs(rawLogs, m, statusContext?.target);
    pipelineState.progress = { current: parsed.current, total: parsed.total };
    pipelineState.logLines = parsed.lines;
    if (parsed.stepIdx > 0) setPipelineActive(parsed.stepIdx);

    if (m === "partyrun") {
      const lines = Array.isArray(rawLogs) ? rawLogs : [];
      let hardErr = null;
      for (const line of lines) {
        const s = String(line || "");
        if (/LOGIN FAILED/i.test(s)) {
          hardErr = { id: "login", msg: ERR_TH.login_failed };
          break;
        }
        if (/BLOCKED|CORRUPT|corrupt_pending/i.test(s)) {
          hardErr = { id: "clear", msg: ERR_TH.corrupt_pending };
          break;
        }
        if (/matchmaking failed|MATCHMAKING ERROR/i.test(s)) {
          hardErr = { id: "match", msg: ERR_TH.matchmaking_failed };
          break;
        }
        if (/claim rejected permanently|claim_rejected/i.test(s)) {
          hardErr = { id: "claim", msg: ERR_TH.claim_rejected };
          break;
        }
        if (/claim_timeout|could not claim/i.test(s)) {
          hardErr = { id: "claim", msg: ERR_TH.claim_timeout };
          break;
        }
      }
      if (hardErr) markPipelineError(hardErr.id, hardErr.msg);
    }
    renderPipeline();
  }

  function stepLabel(step, kind, mode) {
    if (step.id === "done" && kind === "ok") return "สำเร็จแล้ว";
    if (step.id === "done" && kind === "pending") return "กำลังสรุปผล…";
    if (kind === "pending") return "กำลัง" + step.label + "…";
    if (kind === "ok") return step.label + "แล้ว";
    if (kind === "err") return step.label + "ไม่สำเร็จ";
    return step.label;
  }

  function heroLabelForState(mode, focusKind, step, progress) {
    const cfg = modeConfig(mode);
    const cur = progress?.current || 0;
    const tot = progress?.total || statusContext?.target || 0;
    if (focusKind === "ok") return "สำเร็จแล้ว";
    if (focusKind === "err") return stepLabel(step, "err", mode);
    if (cur > 0 || tot > 0) return cfg.progressText(cur, tot);
    return stepLabel(step, focusKind, mode);
  }

  function renderPipeline() {
    const root = $("run-status-root");
    const hero = $("run-status-hero");
    const labelEl = $("run-status-hero-label");
    const hintEl = $("run-status-hero-hint");
    const dotsEl = $("run-status-dots");
    if (root) {
      root.classList.remove("hidden");
      root.setAttribute("aria-hidden", "false");
    }
    if (!pipelineState) return;

    const mode = pipelineState.mode || statusContext?.mode || "partyrun";
    const steps = pipelineState.steps || pipelineStepsFor(mode);
    let focusIdx = pipelineState.activeIdx || 0;
    let focusKind = pipelineState.kinds[steps[focusIdx]?.id] || "pending";
    const errIdx = steps.findIndex((s) => pipelineState.kinds[s.id] === "err");
    if (errIdx >= 0) {
      focusIdx = errIdx;
      focusKind = "err";
    } else if (steps.every((s) => pipelineState.kinds[s.id] === "ok")) {
      focusIdx = steps.length - 1;
      focusKind = "ok";
    } else {
      const pendingIdx = steps.findIndex((s) => pipelineState.kinds[s.id] === "pending");
      if (pendingIdx >= 0) {
        focusIdx = pendingIdx;
        focusKind = "pending";
      }
    }

    const step = steps[focusIdx] || steps[0];
    const prog = pipelineState.progress || { current: 0, total: statusContext?.target || 0 };
    if (hero) hero.dataset.state = focusKind;
    if (labelEl) labelEl.textContent = heroLabelForState(mode, focusKind, step, prog);
    updateProgressBar(prog.current, prog.total || statusContext?.target);
    if (hintEl) {
      if (focusKind === "pending") hintEl.textContent = "กรุณารอสักครู่ อย่าปิดหน้านี้";
      else if (focusKind === "ok") hintEl.textContent = "กำลังเปิดสรุปผลการฟาร์ม…";
      else hintEl.textContent = "อ่านรายละเอียดด้านล่างแล้วกด × เพื่อปิด";
    }

    if (dotsEl) {
      dotsEl.replaceChildren();
      steps.forEach((s, i) => {
        const kind = pipelineState.kinds[s.id] || "idle";
        const dot = document.createElement("span");
        dot.className = "run-status-dot";
        if (kind === "ok") dot.classList.add("is-ok");
        else if (kind === "pending") dot.classList.add("is-pending");
        else if (kind === "err") dot.classList.add("is-err");
        dotsEl.appendChild(dot);
      });
    }

    renderLogList(pipelineState.logLines, pipelineState.extras);
  }

  function stopProgressPoll() {
    if (progressPollTimer) {
      clearInterval(progressPollTimer);
      progressPollTimer = null;
    }
  }

  async function pollActiveJobProgress() {
    if (!accessToken || !farmRunning) return;
    try {
      const data = await api("/api/farm/active-job");
      if (!data?.active || !pipelineState) return;
      const mode = statusContext?.mode || pipelineState.mode || "partyrun";
      const parsed = parseProgressFromLogs(data.logs || [], mode, statusContext?.target);
      if (data.progress) {
        parsed.current = Number(data.progress.current) || parsed.current;
        parsed.total = Number(data.progress.total) || parsed.total;
        if (data.progress.phase) parsed.phase = data.progress.phase;
      }
      pipelineState.progress = { current: parsed.current, total: parsed.total || statusContext?.target };
      pipelineState.logLines = parsed.lines;
      if (parsed.stepIdx > 0) {
        const steps = pipelineState.steps || pipelineStepsFor(mode);
        const idx = Math.min(parsed.stepIdx, steps.length - 2);
        if (idx > pipelineState.activeIdx) pipelineState.activeIdx = idx;
        for (let i = 0; i < steps.length; i++) {
          const id = steps[i].id;
          if (i < idx) pipelineState.kinds[id] = "ok";
          else if (i === idx) pipelineState.kinds[id] = "pending";
          else if (pipelineState.kinds[id] === "pending") pipelineState.kinds[id] = "idle";
        }
      }
      renderPipeline();
    } catch (_) {}
  }

  function startProgressPoll() {
    stopProgressPoll();
    progressPollTimer = setInterval(() => {
      pollActiveJobProgress().catch(() => {});
    }, 2000);
    pollActiveJobProgress().catch(() => {});
  }

  function clearStageTimer() {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }
    stopProgressPoll();
  }

  function startLiveStages(ctx) {
    statusContext = ctx || { mode: "partyrun", target: 0 };
    const mode = statusContext.mode || "partyrun";
    clearStageTimer();
    clearRunStatusAutoClose();
    setRunStatusTitle(mode);
    pipelineState = freshPipeline(mode);
    openRunStatusPopup(true);
    setPipelineActive(0);
    const steps = pipelineStepsFor(mode);
    let tick = 0;
    stageTimer = setInterval(() => {
      tick += 1;
      const softIdx = Math.min(tick, Math.max(1, steps.length - 2));
      if (
        pipelineState &&
        pipelineState.kinds.done !== "ok" &&
        !steps.some((s) => pipelineState.kinds[s.id] === "err") &&
        !(pipelineState.progress?.current > 0)
      ) {
        if (softIdx > pipelineState.activeIdx) setPipelineActive(softIdx);
      }
      if (tick >= steps.length + 2) clearInterval(stageTimer);
    }, 4500);
    startProgressPoll();
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

  function buildFinalPipeline(rawLogs, result, ok, mode) {
    clearStageTimer();
    const m = mode || statusContext?.mode || "partyrun";
    pipelineState = freshPipeline(m);
    applyLogsToPipeline(rawLogs, m);
    if (ok) {
      finalizePipelineSuccess();
      scheduleSuccessHandoff();
    } else {
      const errCode = String(result?.error || result?.detail || "");
      const steps = pipelineStepsFor(m);
      let failId = steps[steps.length - 1]?.id || "done";
      if (m === "partyrun") {
        if (/login/i.test(errCode)) failId = "login";
        else if (/corrupt/i.test(errCode)) failId = "clear";
        else if (/matchmaking/i.test(errCode)) failId = "match";
        else if (/claim/i.test(errCode)) failId = "claim";
        else if (/ingame|farm/i.test(errCode)) failId = "run";
      } else if (m === "giftdraw") {
        if (/login/i.test(errCode)) failId = "login";
        else failId = "open";
      } else if (m === "heart") {
        if (/login/i.test(errCode)) failId = "login";
        else if (/guest|friend/i.test(errCode)) failId = "guests";
        else failId = "claim";
      } else if (m === "powder") {
        if (/login/i.test(errCode)) failId = "login";
        else failId = "extract";
      } else if (m === "upgrade") {
        if (/login|session/i.test(errCode)) failId = "login";
        else failId = "upgrade";
      }
      const alreadyErr = steps.some((s) => pipelineState.kinds[s.id] === "err");
      const errMsg = farmErrorMessage(result, "การฟาร์มไม่สำเร็จ ลองใหม่อีกครั้ง");
      if (!alreadyErr) {
        markPipelineError(failId, errMsg);
      } else if (!(pipelineState.extras || []).length) {
        pipelineState.extras = [{ text: errMsg, kind: "err" }];
        renderPipeline();
      } else {
        renderPipeline();
      }
      setRunStatusClosable(true);
      setRunStatusSubtitle(true, false);
    }
  }

  function farmErrorMessage(result, fallback) {
    const err = result?.error || result?.detail || result?.message || fallback || "";
    return sanitizeDisplayError(err, fallback);
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
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }

    const score = parseFarmNum($("farm-score").value);
    const coin = parseFarmNum($("farm-coin").value);
    const exp = parseFarmNum($("farm-exp").value);
    if (coin > farmCoinMax || exp > farmExpMax) {
      showErrorModal(ERR_TH.value_capped, "ตัวเลขเกินกำหนด");
      return;
    }

    const tickets = ticketCount;
    const btn = $("farm-btn");
    const tokensBefore = tokenBalance();
    farmRunning = true;
    btn.disabled = true;
    setStatus(
      $("farm-status"),
      "กำลัง Party Run " + tickets + " ตั๋ว… อาจใช้เวลาสักครู่",
      "muted"
    );
    startLiveStages({ mode: "partyrun", target: tickets });

    try {
      await ensureApiReady();
      const data = await api("/api/farm/run", {
        method: "POST",
        body: {
          devplay_session_id: devplaySession.id,
          ticket_count: tickets,
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
      const roundsCompleted = Number(data.rounds_completed || result?.rounds_completed || 0);
      const ticketsLeft =
        data.party_run_tickets ?? result?.party_run_tickets ?? null;
      if (devplaySession && ticketsLeft != null && Number.isFinite(Number(ticketsLeft))) {
        devplaySession.tickets = Number(ticketsLeft);
        ticketMax = Math.max(1, Number(ticketsLeft));
        ticketCount = Math.min(ticketCount, ticketMax);
        paintTicketStepper();
      }

      if (data.ok) {
        setStatus(
          $("farm-status"),
          "Party Run สำเร็จ " + roundsCompleted + "/" + tickets + " · หัก 1 โทเค็น",
          "ok"
        );
        const summary = result?.reward_summary || {};
        const reward = result?.reward || {};
        pendingAfterRunStatus = () =>
          showResultModal({
            account:
              (summary.nickname || result?.account?.nickname || devplaySession?.nickname || "—") +
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
            roundsCompleted,
            ticketCount: tickets,
          });
        buildFinalPipeline(data.logs || data.steps || [], result, true, "partyrun");
        clearQueuedRun();
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
        loadFarmHistory().catch(() => {});
      } else {
        buildFinalPipeline(data.logs || data.steps || [], result, false, "partyrun");
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
      } else if (e.status === 401 || /devplay_session_expired/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        resetDevPlaySession();
        showErrorModal(ERR_TH.devplay_session_expired, "เชื่อมใหม่");
        setStatus($("farm-status"), ERR_TH.devplay_session_expired, "err");
      } else if (/not_enough_tickets/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.not_enough_tickets, "ตั๋วไม่พอ");
        setStatus($("farm-status"), ERR_TH.not_enough_tickets, "err");
      } else if (e.status === 400 && /value_capped/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.value_capped, "ตัวเลขเกินกำหนด");
        setStatus($("farm-status"), ERR_TH.value_capped, "err");
      } else if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        await enterQueueFor(e.gate || e.data?.detail?.gate, runFarm);
        setStatus($("farm-status"), "ระบบไม่ว่าง — จองคิวให้แล้ว รอสักครู่", "muted");
      } else {
        const msg = thError(e.message) || "ฟาร์มไม่สำเร็จ";
        setStatus($("farm-status"), msg, "err");
        buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: e.message }, false, statusContext?.mode || "partyrun");

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

  async function runPowder() {
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    if (!powderEstimate?.can_run) {
      showErrorModal(ERR_TH.insufficient_coin, "เหรียญไม่พอ");
      return;
    }

    const btn = $("powder-btn");
    const tokensBefore = tokenBalance();
    // null when the API cannot honour a round count — then this is the old
    // spend-everything run and the status line must not promise otherwise.
    const rounds = powderRoundsSupported()
      ? clampPowderRounds(powderRounds ?? powderMaxRounds())
      : null;
    farmRunning = true;
    if (btn) btn.disabled = true;
    setStatus(
      $("farm-status"),
      rounds == null
        ? "กำลังฟาร์มผง (ใช้เหรียญทั้งหมดที่มี) … อาจใช้เวลาหลายนาที"
        : "กำลังฟาร์มผง " +
            formatNumTh(rounds) +
            " รอบ (≈" +
            formatNumTh(rounds * powderYield()) +
            " ผง) …",
      "muted"
    );
    startLiveStages({ mode: "powder", target: rounds || 0 });

    try {
      await ensureApiReady();
      const body = {
        devplay_session_id: devplaySession.id,
        treasure_name: powderTreasureName,
      };
      if (rounds != null) body.rounds = rounds;
      const data = await api("/api/farm/powder/run", { method: "POST", body });
      clearStageTimer();
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        paintProfile();
      } else {
        await refreshMe().catch(() => {});
      }

      const result = data.result || data;
      if (devplaySession) {
        if (result.coin_after != null) devplaySession.coin = result.coin_after;
        if (result.powder_after != null) devplaySession.powder = result.powder_after;
        paintDevPlaySessionLine();
      }

      const powderGained = Number(data.powder_gained || result.powder_gained || 0);
      const roundsCompleted = Number(data.rounds_completed || result.rounds || 0);

      if (data.ok) {
        setStatus(
          $("farm-status"),
          "ฟาร์มผงสำเร็จ +" + formatNumTh(powderGained) + " · หัก 1 โทเค็น",
          "ok"
        );
        pendingAfterRunStatus = () =>
          showPowderResultModal({
            account: devplaySession?.nickname || "—",
            treasure: result.treasure || powderTreasureName,
            powderGained: formatNumTh(powderGained),
            powderAfter: formatNumTh(result.powder_after ?? "—"),
            coinAfter: formatNumTh(result.coin_after ?? devplaySession?.coin ?? "—"),
            rounds: formatNumTh(roundsCompleted),
            roundsAsked: rounds,
            short: rounds != null && roundsCompleted < rounds,
            capped: !!result.capped,
            tokensBefore: formatNumTh(data.tokens_before ?? tokensBefore),
            tokensAfter: formatNumTh(
              data.tokens_after ?? data.token_balance ?? tokenBalance()
            ),
          });
        buildFinalPipeline(data.logs || data.steps || [], result, true, "powder");
        clearQueuedRun();
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
        refreshPowderEstimate().catch(() => {});
        loadFarmHistory().catch(() => {});
      } else {
        buildFinalPipeline(data.logs || data.steps || [], result, false, "powder");
        let msg = farmErrorMessage(result, "ฟาร์มผงไม่สำเร็จ");
        if (/owner_not_lv8/i.test(String(result?.error || data.error || ""))) {
          msg = ERR_TH.owner_not_lv8;
        } else if (/insufficient_coin/i.test(String(result?.error || data.error || ""))) {
          msg = ERR_TH.insufficient_coin;
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
      } else if (e.status === 401 || /devplay_session_expired/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        resetDevPlaySession();
        showErrorModal(ERR_TH.devplay_session_expired, "เชื่อมใหม่");
        setStatus($("farm-status"), ERR_TH.devplay_session_expired, "err");
      } else if (/owner_not_lv8/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.owner_not_lv8, "ต้องมี Lv.8");
        setStatus($("farm-status"), ERR_TH.owner_not_lv8, "err");
      } else if (/insufficient_coin|powder_session_missing/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        showErrorModal(thError(e.message), "รันไม่ได้");
        setStatus($("farm-status"), thError(e.message), "err");
      } else if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        await enterQueueFor(e.gate || e.data?.detail?.gate, runPowder);
        setStatus($("farm-status"), "ระบบไม่ว่าง — จองคิวให้แล้ว รอสักครู่", "muted");
      } else {
        const msg = thError(e.message) || "ฟาร์มผงไม่สำเร็จ";
        setStatus($("farm-status"), msg, "err");
        buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: e.message }, false, statusContext?.mode || "partyrun");

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

  async function runGiftDraw() {
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    if (Number(giftdrawEstimate?.available_boxes || 0) <= 0) {
      showErrorModal(ERR_TH.no_gift_boxes, "ไม่มีกล่องขวัญ");
      return;
    }

    const btn = $("giftdraw-btn");
    const tokensBefore = tokenBalance();
    const count = clampGiftDrawCount(giftdrawCount);
    farmRunning = true;
    if (btn) btn.disabled = true;
    setStatus(
      $("farm-status"),
      "กำลังเปิดกล่องขวัญ " + formatNumTh(count) + " กล่อง…",
      "muted"
    );
    startLiveStages({ mode: "giftdraw", target: count });

    try {
      await ensureApiReady();
      const data = await api("/api/farm/giftdraw/run", {
        method: "POST",
        body: { devplay_session_id: devplaySession.id, count },
      });
      clearStageTimer();
      if (typeof data.token_balance === "number") {
        profile.token_balance = data.token_balance;
        paintProfile();
      } else {
        await refreshMe().catch(() => {});
      }

      const result = data.result || data;
      const drawsOk = Number(data.draws_ok || result.draws_ok || 0);
      const totals = data.totals || result.totals || {};
      const boxesAfter = data.available_boxes ?? result.available_boxes;

      if (data.ok) {
        setStatus(
          $("farm-status"),
          "เปิดกล่องสำเร็จ " + formatNumTh(drawsOk) + " กล่อง · หัก 1 โทเค็น",
          "ok"
        );
        pendingAfterRunStatus = () =>
          showGiftDrawResultModal({
            account: devplaySession?.nickname || "—",
            drawsOk: formatNumTh(drawsOk),
            requested: formatNumTh(data.requested || result.requested || count),
            boxesAfter: formatNumTh(boxesAfter ?? "—"),
            totals,
            tokensBefore: formatNumTh(data.tokens_before ?? tokensBefore),
            tokensAfter: formatNumTh(
              data.tokens_after ?? data.token_balance ?? tokenBalance()
            ),
          });
        buildFinalPipeline(data.logs || data.steps || [], result, true, "giftdraw");
        clearQueuedRun();
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
        refreshGiftDrawEstimate().catch(() => {});
        loadFarmHistory().catch(() => {});
      } else {
        buildFinalPipeline(data.logs || data.steps || [], result, false, "giftdraw");
        let msg = farmErrorMessage(result, "เปิดกล่องขวัญไม่สำเร็จ");
        if (/no_gift_boxes/i.test(String(result?.error || data.error || ""))) {
          msg = ERR_TH.no_gift_boxes;
        }
        msg += data.refunded ? " · คืนโทเค็นแล้ว" : " · โทเค็นถูกหักแล้ว";
        setStatus($("farm-status"), msg, "err");
        refreshGiftDrawEstimate().catch(() => {});
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
      } else if (e.status === 401 || /devplay_session_expired/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        resetDevPlaySession();
        showErrorModal(ERR_TH.devplay_session_expired, "เชื่อมใหม่");
        setStatus($("farm-status"), ERR_TH.devplay_session_expired, "err");
      } else if (/powder_session_missing|no_gift_boxes/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        showErrorModal(thError(e.message), "รันไม่ได้");
        setStatus($("farm-status"), thError(e.message), "err");
      } else if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        await enterQueueFor(e.gate || e.data?.detail?.gate, runGiftDraw);
        setStatus($("farm-status"), "ระบบไม่ว่าง — จองคิวให้แล้ว รอสักครู่", "muted");
      } else {
        const msg = thError(e.message) || "เปิดกล่องขวัญไม่สำเร็จ";
        setStatus($("farm-status"), msg, "err");
        buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: e.message }, false, statusContext?.mode || "partyrun");

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

  function showHeartResultModal(summary) {
    const rows = [
      ["บัญชีเกม", escapeHtml(summary.account || "—")],
      [
        "หัวใจที่ได้",
        `<span class="result-delta">+${escapeHtml(summary.hearts)}</span> / ขอไว้ ${escapeHtml(summary.target)}`,
      ],
      [
        "โทเค็นเว็บ",
        `${escapeHtml(summary.tokensBefore)} → ${escapeHtml(summary.tokensAfter)} <span class="result-delta">(หัก 1)</span>`,
      ],
    ];
    if (summary.partial) {
      rows.push(["หมายเหตุ", "ได้ไม่ครบตามที่ขอ — รันซ้ำเพื่อเก็บส่วนที่เหลือได้"]);
    }
    const html =
      '<table class="result-table"><tbody>' +
      rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">เพื่อน guest ถูกลบทิ้งหมดแล้ว · เพื่อนจริงไม่ถูกแตะต้อง</p>';

    clearModalActions();
    openModal({
      mode: "result",
      title: "สรุปผลฟาร์มหัวใจ",
      bodyHtml: html,
      icon: "assets/pet81_jelly.png",
      locked: false,
    });
    $("modal-body")?.classList.add("result-stagger");
    spawnPixelConfetti();
    modalActions.appendChild(makeBtn("ตกลง", "btn-candy", () => forceCloseModal()));
  }

  async function runUpgrade() {
    const items = getSelectedUpgradeItems();
    if (!items.length) {
      showErrorModal("เลือกสมบัติที่จะตีบวกก่อน", "ยังไม่ได้เลือก");
      return;
    }
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    if (!upgradeRngAccepted) {
      showErrorModal("ต้องยอมรับความเสี่ยง RNG ก่อนเริ่ม", "ยังไม่ยืนยัน");
      return;
    }
    if (items.length > tokenBalance()) {
      showEmptyCoinsModal();
      return;
    }

    const btn = $("upgrade-btn");
    const tokensBefore = tokenBalance();
    farmRunning = true;
    if (btn) btn.disabled = true;
    setStatus(
      $("farm-status"),
      "กำลังตีบวก " + formatNumTh(items.length) + " ชิ้น…",
      "muted"
    );
    startLiveStages({ mode: "upgrade", target: items.length });

    const allLogs = [];
    let lastResult = null;
    let anyOk = false;
    let completed = 0;

    try {
      await ensureApiReady();
      for (let i = 0; i < items.length; i++) {
        if (!hasTokens()) break;
        const item = items[i];
        setStatus(
          $("farm-status"),
          "ชิ้นที่ " + (i + 1) + "/" + items.length + ": " + (item.name || "สมบัติ") + "…",
          "muted"
        );
        const data = await api("/api/farm/upgrade/run", {
          method: "POST",
          body: {
            devplay_session_id: devplaySession.id,
            uuid: item.uuid,
            group_seq: item.group_seq,
            grade: item.grade || "S",
            target_level: upgradeTargetLevel,
            name: item.name || "",
          },
        });
        if (typeof data.token_balance === "number") {
          profile.token_balance = data.token_balance;
          paintProfile();
        }
        const result = data.result || data;
        lastResult = result;
        allLogs.push(...(data.logs || []));
        completed += 1;
        if (data.ok) anyOk = true;
        upgradeSelected.delete(item.uuid);
        if (!data.ok && !result?.partial) {
          break;
        }
      }

      clearStageTimer();
      await refreshMe().catch(() => {});

      if (anyOk) {
        setStatus(
          $("farm-status"),
          "ตีบวกเสร็จ " + formatNumTh(completed) + "/" + formatNumTh(items.length) + " ชิ้น",
          "ok"
        );
        buildFinalPipeline(allLogs, lastResult || {}, true, "upgrade");
        clearQueuedRun();
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
        loadUpgradeTreasures(true).catch(() => {});
        loadFarmHistory().catch(() => {});
      } else {
        buildFinalPipeline(allLogs, lastResult || {}, false, "upgrade");
        const msg =
          farmErrorMessage(lastResult, "ตีบวกไม่สำเร็จ") +
          (lastResult?.partial ? " · ได้บางส่วน (partial)" : "");
        setStatus($("farm-status"), msg, "err");
        loadUpgradeTreasures(true).catch(() => {});
        loadFarmHistory().catch(() => {});
      }
    } catch (e) {
      clearStageTimer();
      if (/account_banned/i.test(String(e.message || ""))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.account_banned, "บัญชีถูกระงับ");
      } else if (/maintenance/i.test(String(e.message || ""))) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.maintenance, "ปิดปรับปรุง");
      } else if (e.status === 401 || /devplay_session_expired/i.test(String(e.message))) {
        forceCloseRunStatusPopup();
        resetDevPlaySession();
        showErrorModal(ERR_TH.devplay_session_expired, "เชื่อมใหม่");
      } else if (e.status === 409) {
        buildFinalPipeline(allLogs, lastResult || {}, anyOk, "upgrade");
        await enterQueueFor(e.gate || e.data?.detail?.gate, runUpgrade);
      } else {
        buildFinalPipeline(
          allLogs.length ? allLogs : e.data?.logs || [],
          e.data?.result || { error: e.message },
          anyOk,
          "upgrade"
        );
        setStatus($("farm-status"), thError(e.message) || "ตีบวกไม่สำเร็จ", "err");
      }
    } finally {
      farmRunning = false;
      updateFarmAvailability();
      paintUpgradeGrid();
    }
  }

  async function runHeart() {
    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }
    if (!hasDevPlayCreds()) {
      showErrorModal("กรอกอีเมลและรหัสผ่านบัญชีเกมให้ครบ", "ข้อมูลไม่ครบ");
      return;
    }

    const btn = $("heart-btn");
    const tokensBefore = tokenBalance();
    const target = clampHeartTarget(heartTarget);
    farmRunning = true;
    if (btn) btn.disabled = true;
    setStatus(
      $("farm-status"),
      "กำลังฟาร์มหัวใจ " + formatNumTh(target) + " ดวง… อาจใช้เวลาหลายนาที",
      "muted"
    );
    startLiveStages({ mode: "heart", target: target });

    try {
      await ensureApiReady();
      const data = await api("/api/farm/heart/run", {
        method: "POST",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
          target_hearts: target,
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
      const hearts = Number(data.hearts || result.hearts || 0);

      if (data.ok) {
        setStatus(
          $("farm-status"),
          "ฟาร์มหัวใจสำเร็จ +" + formatNumTh(hearts) + " · หัก 1 โทเค็น",
          "ok"
        );
        pendingAfterRunStatus = () =>
          showHeartResultModal({
            account: devplaySession?.nickname || $("dp-acct-mail").value.trim() || "—",
            hearts: formatNumTh(hearts),
            target: formatNumTh(target),
            partial: hearts < target || !!data.partial,
            tokensBefore: formatNumTh(data.tokens_before ?? tokensBefore),
            tokensAfter: formatNumTh(
              data.tokens_after ?? data.token_balance ?? tokenBalance()
            ),
          });
        buildFinalPipeline(data.logs || data.steps || [], result, true, "heart");
        clearQueuedRun();
        stopQueuePoll();
        refreshGateAndQueueUi().catch(() => {});
        loadFarmHistory().catch(() => {});
      } else {
        buildFinalPipeline(data.logs || data.steps || [], result, false, "heart");
        let msg = farmErrorMessage(result, "ฟาร์มหัวใจไม่สำเร็จ");
        const code = String(result?.error || data.error || "");
        if (/heart_timeout/i.test(code)) msg = ERR_TH.heart_timeout;
        else if (/no_hearts_collected/i.test(code)) msg = ERR_TH.no_hearts_collected;
        msg += data.refunded ? " · คืนโทเค็นแล้ว" : " · โทเค็นถูกหักแล้ว";
        setStatus($("farm-status"), msg, "err");
        loadFarmHistory().catch(() => {});
      }
    } catch (e) {
      clearStageTimer();
      const raw = String(e.message || "");
      if (/account_banned/i.test(raw)) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.account_banned, "บัญชีถูกระงับ");
        setStatus($("farm-status"), ERR_TH.account_banned, "err");
      } else if (/maintenance/i.test(raw)) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.maintenance, "ปิดปรับปรุง");
        setStatus($("farm-status"), ERR_TH.maintenance, "err");
      } else if (/heart_disabled|heart_proxy_not_configured/i.test(raw)) {
        forceCloseRunStatusPopup();
        showErrorModal(thError(raw), "ยังใช้ไม่ได้");
        setStatus($("farm-status"), thError(raw), "err");
      } else if (e.status === 401 || /login_failed/i.test(raw)) {
        forceCloseRunStatusPopup();
        showErrorModal(ERR_TH.login_failed, "เข้าสู่ระบบเกมไม่สำเร็จ");
        setStatus($("farm-status"), ERR_TH.login_failed, "err");
      } else if (e.status === 409 || /farm_busy/i.test(raw)) {
        forceCloseRunStatusPopup();
        await enterQueueFor(e.gate || e.data?.detail?.gate, runHeart);
        setStatus($("farm-status"), "ระบบไม่ว่าง — จองคิวให้แล้ว รอสักครู่", "muted");
      } else {
        const msg = thError(raw) || "ฟาร์มหัวใจไม่สำเร็จ";
        setStatus($("farm-status"), msg, "err");
        buildFinalPipeline(e.data?.logs || [], e.data?.result || { error: raw }, false, "heart");

        if (e.status === 402 || /insufficient_tokens/i.test(raw)) {
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
    paintTicketStepper();
    switchFarmTab("partyrun");
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

  $("devplay-connect-btn")?.addEventListener("click", () => {
    connectDevPlay();
  });

  $("devplay-reconnect-btn")?.addEventListener("click", () => {
    resetDevPlaySession();
    connectDevPlay();
  });

  $("farm-history-open")?.addEventListener("click", () => {
    showFarmHistoryModal();
  });

  $("ticket-minus")?.addEventListener("click", () => {
    if (ticketCount > 1) {
      ticketCount -= 1;
      paintTicketStepper();
      updateFarmAvailability();
    }
  });

  $("ticket-plus")?.addEventListener("click", () => {
    if (ticketCount < ticketMax) {
      ticketCount += 1;
      paintTicketStepper();
      updateFarmAvailability();
    }
  });

  $("ticket-count")?.addEventListener("input", (ev) => {
    const el = ev.target;
    const cleaned = String(el.value || "").replace(/[^\d]/g, "");
    if (el.value !== cleaned) el.value = cleaned;
  });

  $("ticket-count")?.addEventListener("change", () => {
    commitTicketCountFromInput();
  });

  $("ticket-count")?.addEventListener("blur", () => {
    commitTicketCountFromInput();
  });

  $("ticket-count")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitTicketCountFromInput();
      ev.target.blur();
    }
  });

  $("giftdraw-minus")?.addEventListener("click", () => {
    if (giftdrawCount > 1) {
      giftdrawCount -= 1;
      paintGiftDrawStepper();
      updateFarmAvailability();
    }
  });

  $("giftdraw-plus")?.addEventListener("click", () => {
    if (giftdrawCount < giftdrawMax) {
      giftdrawCount += 1;
      paintGiftDrawStepper();
      updateFarmAvailability();
    }
  });

  $("giftdraw-count")?.addEventListener("input", (ev) => {
    const el = ev.target;
    const cleaned = String(el.value || "").replace(/[^\d]/g, "");
    if (el.value !== cleaned) el.value = cleaned;
  });

  $("giftdraw-count")?.addEventListener("change", () => {
    commitGiftDrawCountFromInput();
  });

  $("giftdraw-count")?.addEventListener("blur", () => {
    commitGiftDrawCountFromInput();
  });

  $("giftdraw-count")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitGiftDrawCountFromInput();
      ev.target.blur();
    }
  });

  $("heart-minus")?.addEventListener("click", () => {
    if (heartTarget > 1) {
      heartTarget -= 1;
      paintHeartStepper();
      updateFarmAvailability();
    }
  });

  $("heart-plus")?.addEventListener("click", () => {
    if (heartTarget < heartMax) {
      heartTarget += 1;
      paintHeartStepper();
      updateFarmAvailability();
    }
  });

  $("heart-target")?.addEventListener("input", (ev) => {
    const el = ev.target;
    const cleaned = String(el.value || "").replace(/[^\d]/g, "");
    if (el.value !== cleaned) el.value = cleaned;
  });

  $("heart-target")?.addEventListener("change", () => commitHeartTargetFromInput());
  $("heart-target")?.addEventListener("blur", () => commitHeartTargetFromInput());

  $("heart-target")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitHeartTargetFromInput();
      ev.target.blur();
    }
  });

  $("heart-check-btn")?.addEventListener("click", () => {
    refreshHeartEstimate().catch(() => {});
  });

  $("pos-nav-topup")?.addEventListener("click", () => openVaultModal());
  $("pos-nav-history")?.addEventListener("click", () => showFarmHistoryModal());
  $("pos-nav-farm")?.addEventListener("click", () => {
    document.getElementById("run")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("farm-tab-heart")?.addEventListener("click", () => switchFarmTab("heart"));
  $("farm-tab-partyrun")?.addEventListener("click", () => switchFarmTab("partyrun"));
  $("farm-tab-powder")?.addEventListener("click", () => switchFarmTab("powder"));
  $("farm-tab-giftdraw")?.addEventListener("click", () => switchFarmTab("giftdraw"));
  $("farm-tab-upgrade")?.addEventListener("click", () => switchFarmTab("upgrade"));

  $("upgrade-rng-accept")?.addEventListener("change", (ev) => {
    upgradeRngAccepted = !!ev.target.checked;
    updateFarmAvailability();
  });

  $("upgrade-target-level")?.addEventListener("change", (ev) => {
    upgradeTargetLevel = Number(ev.target.value) || 9;
    refreshUpgradeEstimate().catch(() => {});
  });

  $("upgrade-reload-btn")?.addEventListener("click", () => {
    loadUpgradeTreasures(true).catch(() => {});
  });

  $("powder-treasure-select")?.addEventListener("change", (ev) => {
    powderTreasureName = ev.target.value || powderTreasureName;
    // Different treasure, different price and yield — the old round count no
    // longer means the same thing, so fall back to the new affordable max.
    powderRounds = null;
    paintPowderEstimateStatic();
    refreshPowderEstimate().catch(() => {});
  });

  $("powder-minus")?.addEventListener("click", () => {
    powderRounds = clampPowderRounds((powderRounds ?? powderMaxRounds()) - 1);
    paintPowderStepper();
    updateFarmAvailability();
  });

  $("powder-plus")?.addEventListener("click", () => {
    powderRounds = clampPowderRounds((powderRounds ?? powderMaxRounds()) + 1);
    paintPowderStepper();
    updateFarmAvailability();
  });

  ["powder-rounds", "powder-target-input"].forEach((id) => {
    $(id)?.addEventListener("input", (ev) => {
      const el = ev.target;
      const cleaned = String(el.value || "").replace(/[^\d]/g, "");
      if (el.value !== cleaned) el.value = cleaned;
    });
  });

  const commitPowderField = (id) =>
    id === "powder-rounds" ? commitPowderRoundsFromInput() : commitPowderTargetFromInput();

  ["powder-rounds", "powder-target-input"].forEach((id) => {
    $(id)?.addEventListener("change", () => commitPowderField(id));
    $(id)?.addEventListener("blur", () => commitPowderField(id));
    $(id)?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitPowderField(id);
        ev.target.blur();
      }
    });
  });

  $("powder-treasure-search")?.addEventListener("input", () => {
    paintPowderTreasureSelect();
  });

  $("farm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (farmRunning || devplayConnecting) return;

    if (!hasTokens()) {
      showEmptyCoinsModal();
      return;
    }

    if (farmTab === "heart") {
      commitHeartTargetFromInput();
      if (!hasDevPlayCreds()) {
        showErrorModal("กรอกอีเมลและรหัสผ่านบัญชีเกมให้ครบ", "ข้อมูลไม่ครบ");
        return;
      }
      if (Number(heartEstimate?.room || 0) <= 0) {
        showErrorModal(
          heartEstimate
            ? "เพื่อนเต็ม 300 แล้ว — ต้องลบเพื่อนจริงออกก่อน"
            : "กดตรวจสอบช่องว่างเพื่อนก่อน",
          "รันไม่ได้"
        );
        return;
      }
      const confirmed = await showHeartConfirmModal(heartTarget);
      if (!confirmed) {
        setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasTokens()) {
        showEmptyCoinsModal();
        return;
      }
      await runHeart();
      return;
    }

    if (farmTab === "upgrade") {
      if (!isDevPlayConnected()) {
        showErrorModal("เชื่อม DevPlay ก่อนตีบวกสมบัติ", "ยังไม่ได้เชื่อม");
        return;
      }
      const upgradeItems = getSelectedUpgradeItems();
      if (!upgradeItems.length) {
        showErrorModal("เลือกสมบัติที่จะตีบวกก่อน", "ยังไม่ได้เลือก");
        return;
      }
      if (!upgradeRngAccepted) {
        showErrorModal("ต้องยอมรับความเสี่ยง RNG ก่อนเริ่ม", "ยังไม่ยืนยัน");
        return;
      }
      if (upgradeItems.length > tokenBalance()) {
        showEmptyCoinsModal();
        return;
      }
      const upgradeConfirmed = await showUpgradeConfirmModal(upgradeItems);
      if (!upgradeConfirmed) {
        setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasTokens() || upgradeItems.length > tokenBalance()) {
        showEmptyCoinsModal();
        return;
      }
      await runUpgrade();
      return;
    }

    if (!isDevPlayConnected()) {
      const need = {
        powder: "เชื่อม DevPlay ก่อนเริ่มฟาร์มผง",
        giftdraw: "เชื่อม DevPlay ก่อนเปิดกล่องขวัญ",
      };
      showErrorModal(
        need[farmTab] || "เชื่อม DevPlay ก่อนเริ่ม Party Run",
        "ยังไม่ได้เชื่อม"
      );
      return;
    }

    if (farmTab === "giftdraw") {
      commitGiftDrawCountFromInput();
      if (Number(giftdrawEstimate?.available_boxes || 0) <= 0) {
        showErrorModal(ERR_TH.no_gift_boxes, "ไม่มีกล่องขวัญ");
        return;
      }
      const confirmed = await showGiftDrawConfirmModal(giftdrawCount);
      if (!confirmed) {
        setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasTokens()) {
        showEmptyCoinsModal();
        return;
      }
      await runGiftDraw();
      return;
    }

    if (farmTab === "powder") {
      if (!powderEstimate?.can_run) {
        showErrorModal(ERR_TH.insufficient_coin, "เหรียญไม่พอ");
        return;
      }
      let askRounds = null;
      if (powderRoundsSupported()) {
        commitPowderRoundsFromInput();
        askRounds = clampPowderRounds(powderRounds ?? powderMaxRounds());
      }
      const confirmed = await showPowderConfirmModal(askRounds);
      if (!confirmed) {
        setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasTokens()) {
        showEmptyCoinsModal();
        return;
      }
      await runPowder();
      return;
    }

    commitTicketCountFromInput();

    const confirmed = await showConfirmModal(ticketCount);
    if (!confirmed) {
      setStatus($("farm-status"), "ยกเลิกแล้ว — ยังไม่หักโทเค็น", "muted");
      return;
    }

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
