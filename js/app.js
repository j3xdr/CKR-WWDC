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
  const GLOBAL_PROXY_KEY = "ckr_global_proxy_url";
  const HEART_PROXY_KEY = GLOBAL_PROXY_KEY; // compat alias
  const FARM_SIDEBAR_KEY = "ckr_farm_sidebar_open";
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


  const FOCUSABLE_SEL =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let activeFocusTrap = null;

  function getFocusable(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SEL)).filter((el) => {
      if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    });
  }

  function trapFocus(container) {
    releaseFocusTrap();
    if (!container) return;
    const previouslyFocused = document.activeElement;
    const onKeyDown = (ev) => {
      if (ev.key !== "Tab") return;
      const nodes = getFocusable(container);
      if (!nodes.length) {
        ev.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (ev.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          ev.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !container.contains(document.activeElement)) {
        ev.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    activeFocusTrap = { container, onKeyDown, previouslyFocused };
    const nodes = getFocusable(container);
    (nodes[0] || container).focus?.();
  }

  function releaseFocusTrap() {
    if (!activeFocusTrap) return;
    const { container, onKeyDown, previouslyFocused } = activeFocusTrap;
    container?.removeEventListener("keydown", onKeyDown);
    activeFocusTrap = null;
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      try {
        previouslyFocused.focus();
      } catch (_) {}
    }
  }

  function setBtnLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("is-loading", !!loading);
    if (loading) {
      if (!btn.querySelector(".btn-spinner")) {
        const sp = document.createElement("span");
        sp.className = "btn-spinner";
        sp.setAttribute("aria-hidden", "true");
        btn.appendChild(sp);
      }
      btn.setAttribute("aria-busy", "true");
    } else {
      btn.removeAttribute("aria-busy");
      btn.querySelector(".btn-spinner")?.remove();
    }
  }

  function renderSkeletonCards(grid, count = 6) {
    if (!grid) return;
    grid.innerHTML = "";
    grid.classList.add("card-stagger");
    for (let i = 0; i < count; i++) {
      const sk = document.createElement("div");
      sk.className = "skeleton-card";
      sk.setAttribute("aria-hidden", "true");
      grid.appendChild(sk);
    }
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
  let activityPollTimer = null;
  let modalMode = null; // "empty" | "confirm" | "error" | "queue" | "result" | "peek" | null
  let emptyModalDismissed = false; // user closed empty modal; don't auto-reopen
  let farmRunning = false;
  let peekRunning = false;
  const FARM_TAB_META = {
    devplay: {
      title: "เชื่อมต่อ DevPlay",
      hint: "ล็อกอินเกมก่อนใช้ฟีเจอร์อื่น",
      icon: "notice_b20.png",
    },
    partyrun: {
      title: "Party Run",
      hint: "เลือกจำนวนตั๋วแล้วกดรัน",
      icon: "pirate_cookie_run.gif",
    },
    heart: {
      title: "ฟาร์มหัวใจ",
      hint: "ใส่ proxy และจำนวนหัวใจแล้วกดรัน",
      icon: "bbc_stat_iconHeart.png",
    },
    powder: {
      title: "ฟาร์มผง",
      hint: "เลือกสมบัติและจำนวนรอบ",
      icon: "cookie_run.gif",
    },
    giftdraw: {
      title: "Gift Draw",
      hint: "เปิดกล่องของขวัญ",
      icon: "icon_giftpoint.png",
    },
    upgrade: {
      title: "ตีบวกสมบัติ",
      hint: "เลือกสมบัติในคลัง",
      icon: "tr_ga170.png",
    },
    cookie: {
      title: "ปลดล็อกคุกกี้",
      hint: "เลือกคุกกี้ · รันทีละตัว",
      icon: "cookie_run.gif",
    },
    reroll: {
      title: "รีโรล",
      hint: "สุ่มของจากตั๋วในไอดีใหม่",
      icon: "gem.png",
    },
    quest: {
      title: "เควส",
      hint: "โหลดแล้วเลือกรับรางวัลที่ทำครบ",
      icon: "icon_giftpoint.png",
    },
    account: {
      title: "ข้อมูลไอดี",
      hint: "ดูคุกกี้ สัตว์เลี้ยง สมบัติ และทรัพยากร",
      icon: "notice_b20.png",
    },
    dstool: {
      title: "ทดสอบคำสั่งเกม",
      hint: "สำหรับผู้ใช้ขั้นสูง — เลือกคำสั่งที่อนุญาตเท่านั้น",
      icon: "score.png",
    },
  };
  let devplayConnecting = false;
  let devplaySession = null; // { id, nickname, tickets, expiresAt }
  let ticketCount = 1;
  let ticketMax = 1;
  let farmTab = "devplay";
  let powderTreasures = [];
  let powderTreasureName = "Revival Boots";
  let powderPickerFilter = "";
  let powderEstimate = null;
  let powderEstimateLoading = false;
  // Rounds is the single source of truth; the powder field is derived from it.
  // null means "untouched" — a fresh estimate then fills in the affordable max.
  let powderRounds = 10;
  let lastRerollResults = [];
  let giftdrawCount = 1;
  let giftdrawMax = 1;
  let giftdrawEstimate = null;
  let giftdrawEstimateLoading = false;
  let heartTarget = 100;
  const HEART_MAX = 100_000;
  let heartMax = HEART_MAX;
  let upgradeTreasures = [];
  let upgradeGridExpanded = false;
  let upgradeSelected = new Set();
  let upgradeTargetLevel = 9;
  let upgradeEstimate = null;
  let upgradeEstimateLoading = false;
  let upgradeRngAccepted = false;
  let upgradeCoin = 0;
  let upgradeRunMode = "sequential";
  let cookieItems = [];
  let cookieSelected = new Set();
  let cookieCoin = 0;
  let cookieEstimate = null;
  let cookieEstimateLoading = false;
  let cookieListLoading = false;
  let upgradeListLoading = false;
  let powderPickerLoading = false;
  let rerollMode = "guest";
  let rerollCount = 1;
  const REROLL_MAX = 50;
  let questList = [];
  let questSelected = new Set();
  let questLoading = false;
  let accountProfile = null;
  let accountLoading = false;
  let dsAllowlist = [];
  let dsAllowlistLoaded = false;
  let dsCalling = false;
  let peekCooldownUntil = 0;
  let peekCooldownTimer = null;
  let selectedTopupTokens = 7;
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
        "เมื่อสร้างสำเร็จ กด 「แชร์ลิงก์」 หรือคัดลอกลิงก์ แล้วนำไปวางในช่องต่ออายุ",
    },
  ];
  let lastGate = null;
  // Run held back by farm_busy, replayed automatically once our turn comes up.
  let queuedRun = null;
  let queuedJobKind = null;
  let queueResumeAttempts = 0;
  // Personal browser queue: Job2+ while Job1 runs (same user). Not the server FIFO.
  let pendingFarmJobs = [];
  let pendingStartTimer = null;
  let startingFromPersonalQueue = false;
  const PENDING_FARM_MAX = 3;
  let runStatusClosable = false;
  let pendingAfterRunStatus = null;
  const FARM_JOB_ID_KEY = "ckr_farm_job_id";
  let activeWatchJobId = null;
  let watchJobTimer = null;
  let dockPhase = null; // "queued" | "running" | "done" | "error" | null
  let dockOk = null;
  let dockExpanded = false;
  let dockJobStartedAt = null;
  let dockElapsedTimer = null;
  let dockHistoryTab = "all"; // "all" | "active"
  let farmActivityData = null;
  let farmDockFlash = { text: "", kind: "muted" };
  let apiReady = false;
  const PEEK_COOLDOWN_SEC = 180;
  const PEEK_CD_KEY = "ckr_peek_cd_until";

  const ERR_TH = {
    insufficient_tokens: "หมดอายุเช่าแล้ว — กรุณาเติมวันใช้งาน",
    rental_required: "ต้องเช่าใช้งานก่อน — กด ต่ออายุ เพื่อซื้อแพ็กวัน",
    rental_expired: "วันเช่าหมดอายุแล้ว — ต่ออายุในเมนู ต่ออายุ",
    insufficient_tokens_for_peek:
      "ต้องมีสิทธิ์เช่าถึงจะดูสถานะบัญชีเกมได้ (ไม่หักเพิ่ม)",
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
    topup_credit_failed: "รับซองแล้วแต่ต่ออายุเช่าไม่สำเร็จ — ติดต่อแอดมิน",
    session_replaced: "มีการเข้าสู่ระบบจากที่อื่น — กรุณาเข้าสู่ระบบใหม่",
    account_banned: "บัญชีถูกระงับ กรุณาติดต่อแอดมิน",
    game_account_banned: "บัญชีเกมถูกระงับ/แบน — เข้าเกมด้วยบัญชีนี้ไม่ได้",
    game_access_denied: "เซิร์ฟเวอร์เกมปฏิเสธการเข้าถึงบัญชีนี้",
    devplay_wrong_password: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    devplay_not_found: "ไม่พบบัญชีนี้ในระบบ DevPlay",
    devplay_rate_limited: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
    devplay_account_locked: "บัญชี DevPlay ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง",
    maintenance: "ระบบปิดปรับปรุงชั่วคราว ลองใหม่ภายหลัง",
    value_capped: "เหรียญสูงสุด 449,000 · XP สูงสุด 52,000",
    devplay_session_expired: "เชื่อม DevPlay หมดอายุ — กดเชื่อมต่อใหม่",
    not_enough_tickets: "ตั๋ว Party Run ไม่พอ — ลดจำนวนตั๋วหรือรอรีเซ็ต",
    connect_failed: "เชื่อม DevPlay ไม่สำเร็จ",
    owner_not_lv8: "ต้องมีเจ้าของสมบัติ Lv.8 ก่อน",
    insufficient_coin: "เหรียญไม่พอแม้ 1 รอบ",
    already_owned: "มีคุกกี้นี้ในไอดีแล้ว — ซื้อไม่ได้",
    cookie_selection_empty: "เลือกคุกกี้ที่ปลดล็อกได้ก่อน",
    cookie_list_failed: "โหลดรายการคุกกี้ไม่สำเร็จ",
    cookie_estimate_failed: "คำนวณราคาคุกกี้ไม่สำเร็จ",
    cookie_catalog_missing: "แคตตาล็อกคุกกี้ยังไม่พร้อมบนเซิร์ฟเวอร์",
    powder_session_missing: "เชื่อม DevPlay ใหม่ (ไม่มี session ผง)",
    no_gift_boxes: "ไม่มีกล่องขวัญในไอดีนี้ — ต้องมี Gift Point ครบ 100 ต่อ 1 กล่อง",
    heart_disabled: "ฟาร์มหัวใจปิดใช้งานอยู่ — รอแอดมินเปิด",
    heart_proxy_not_configured: "ยังไม่มี proxy — ตั้ง proxy หลัง login DevPlay ก่อนรัน",
    proxy_url_required: "ต้องใส่ Proxy URL ก่อนใช้งาน",
    proxy_url_invalid: "รูปแบบ proxy ไม่ถูกต้อง — ต้องขึ้นต้นด้วย http:// หรือ https://",
    heart_timeout: "ฟาร์มหัวใจใช้เวลานานเกินกำหนด — ลองลดจำนวนหัวใจแล้วรันใหม่",
    no_hearts_collected: "เก็บหัวใจไม่ได้เลย — ลองใหม่อีกครั้ง",
    heart_error: "ฟาร์มหัวใจไม่สำเร็จ ลองใหม่อีกครั้ง",
    giftdraw_failed: "เปิดกล่องขวัญไม่สำเร็จ ลองใหม่อีกครั้ง",
    treasure_not_found: "ไม่พบสมบัติที่เลือก",
    farm_busy: "ระบบกำลังยุ่งอยู่ ลองใหม่อีกสักครู่",
    farm_error: "การฟาร์มล้มเหลว ลองใหม่อีกครั้ง",
    job_tracking_unavailable: "ไม่สามารถติดตามงานบนเซิร์ฟเวอร์ได้ — ลองใหม่",
    consume_failed: "ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง",
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
    ds_path_not_allowed: "คำสั่งนี้ไม่ได้รับอนุญาต",
    reroll_too_many_accounts: "ใส่บัญชีได้สูงสุด 50 รายการต่อครั้ง",
    reroll_accounts_required: "ใส่รายการบัญชี (อีเมลและรหัส) ก่อนรีโรล",
    quest_not_claimable: "เควสนี้ยังรับรางวัลไม่ได้",
    worker_unavailable: "เซิร์ฟเวอร์ประมวลผลไม่พร้อม กำลังลองใหม่",
    already_running: "มีงานกำลังรันอยู่แล้ว — รอให้เสร็จหรือดูที่แถบสถานะ",
    rate_limited: "เรียกถี่เกินไป รอสักครู่แล้วลองใหม่",
    account_info_failed: "โหลดข้อมูลไอดีไม่สำเร็จ ลองใหม่",
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

  function setFarmStatus(text, kind) {
    farmDockFlash = { text: text || "", kind: kind || "muted" };
    if (accessToken && userView && !userView.classList.contains("hidden")) {
      showFarmDock();
    }
    renderFarmDock();
  }


  const TOAST_MAX = 3;
  const TOAST_MS = 4000;
  let toastTimers = new WeakMap();

  function showToast(message, kind = "muted", opts = {}) {
    const root = $("toast-root");
    if (!root || !message) return;
    while (root.children.length >= TOAST_MAX) {
      root.firstElementChild?.remove();
    }
    const el = document.createElement("div");
    el.className = "toast " + (kind || "muted");
    el.setAttribute("role", "status");
    const msg = document.createElement("div");
    msg.className = "toast-msg";
    msg.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "ปิด");
    close.textContent = "×";
    el.append(msg, close);

    const dismiss = () => {
      if (!el.isConnected) return;
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 200);
    };
    close.addEventListener("click", dismiss);

    let timer = setTimeout(dismiss, opts.duration ?? TOAST_MS);
    el.addEventListener("mouseenter", () => {
      clearTimeout(timer);
    });
    el.addEventListener("mouseleave", () => {
      timer = setTimeout(dismiss, opts.duration ?? TOAST_MS);
    });
    root.appendChild(el);
    return el;
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
    const label = text || "";
    const el = $("api-status-menu");
    if (!el) return;
    el.className = "api-chip toolbar-chip is-" + (state || "waking") + " farm-sidebar-api";
    const textEl = el.querySelector(".api-chip-label");
    if (textEl) textEl.textContent = label;
    else el.textContent = label;
    el.title = label || "สถานะเซิร์ฟเวอร์";
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

  function isRentalPermanent(p) {
    if (!p) return false;
    return !!(p.rental_is_permanent ?? p.is_permanent);
  }

  function hasFarmAccess() {
    if (!profile) return false;
    if (isRentalPermanent(profile)) return true;
    if (profile.farm_access === true) return true;
    if (profile.farm_access === false) return false;
    const exp = profile.rental_expires_at ? Date.parse(profile.rental_expires_at) : NaN;
    return Number.isFinite(exp) && exp > Date.now();
  }

  function rentalStatusLabel() {
    if (!profile) return "—";
    if (isRentalPermanent(profile)) return "ถาวร";
    const expRaw = profile.rental_expires_at;
    if (!expRaw) return "หมดอายุ";
    const exp = Date.parse(expRaw);
    if (!Number.isFinite(exp) || exp <= Date.now()) return "หมดอายุ";
    return new Date(exp).toLocaleString("th-TH", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function sidebarRentalMeta() {
    if (!profile) return { text: "—", kind: "" };
    if (isRentalPermanent(profile)) return { text: "สิทธิ์ถาวร · ใช้งานได้ไม่จำกัด", kind: "is-permanent" };
    if (hasFarmAccess()) {
      const daysLeft = rentalDaysRemaining();
      const parts = ["เช่าถึง " + rentalStatusLabel()];
      if (daysLeft != null) parts.unshift("เหลือ ~" + formatNumTh(daysLeft) + " วัน");
      return { text: parts.join(" · "), kind: "is-active" };
    }
    return { text: "หมดอายุแล้ว · กดต่ออายุด้านบน", kind: "is-expired" };
  }

  function formatRentalExpiry(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleString("th-TH", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "—";
    }
  }

  function applyProfileRental(data) {
    if (!profile || !data) return;
    if (data.rental_expires_at !== undefined) profile.rental_expires_at = data.rental_expires_at;
    if (data.rental_is_permanent !== undefined) profile.rental_is_permanent = data.rental_is_permanent;
    if (data.is_permanent !== undefined) profile.is_permanent = data.is_permanent;
    if (data.farm_access !== undefined) profile.farm_access = data.farm_access;
    paintProfile();
  }

  function handleRentalDenied(e) {
    forceCloseRunStatusPopup();
    if (profile) {
      if (e?.data?.rental_expires_at !== undefined) {
        profile.rental_expires_at = e.data.rental_expires_at;
      }
      if (e?.data?.farm_access !== undefined) profile.farm_access = e.data.farm_access;
      else profile.farm_access = false;
    }
    paintProfile();
    showEmptyCoinsModal();
  }

  function isRentalDeniedError(e) {
    return (
      e?.status === 402 ||
      /insufficient_tokens|rental_required|rental_expired/i.test(String(e?.message || ""))
    );
  }

  function tokenBalance() {
    return Number(profile?.token_balance ?? 0);
  }

  function hasTokens() {
    return hasFarmAccess();
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
    const sheet = modalRoot.querySelector(".modal-card") || modalRoot;
    trapFocus(sheet);
  }

  function closeModal() {
    if (modalMode === "queue") return;
    if (modalMode === "proxy" && modalRoot.classList.contains("locked")) return;
    if (modalMode === "empty") emptyModalDismissed = true;
    modalMode = null;
    clearModalActions();
    clearPixelConfetti();
    releaseFocusTrap();
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
    releaseFocusTrap();
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
      title: "หมดอายุเช่าแล้ว",
      body: "ต่ออายุได้ทันที — เลือกแพ็ก 1/3/7 วัน แล้ววางลิงก์ซอง TrueMoney",
      icon: "assets/reward_icon_partyrun_ticket.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ไปต่ออายุเช่า", "btn-candy", () => {
        closeModal();
        openVaultModal({ focusVoucher: true });
      })
    );
    modalActions.appendChild(
      makeBtn("ตรวจสอบสิทธิ์อีกครั้ง", "btn-run btn-wide", async () => {
        try {
          await refreshMe();
          if (hasFarmAccess()) {
            forceCloseModal();
            setFarmStatus( "ต่ออายุแล้ว พร้อมวิ่งฟาร์ม", "ok");
          } else {
            setFarmStatus(
              "ยังไม่มีสิทธิ์เช่า — กด ต่ออายุ เพื่อซื้อแพ็กวัน",
              "err"
            );
          }
        } catch (_) {
          setFarmStatus( "ตรวจยอดไม่สำเร็จ ลองใหม่", "err");
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

  function showDevPlayRequiredModal() {
    clearModalActions();
    openModal({
      mode: "devplay-required",
      title: "เชื่อม DevPlay ก่อน",
      body: "เชื่อม DevPlay ก่อนใช้งานฟีเจอร์นี้",
      icon: "assets/notice_b20.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ไปเชื่อม DevPlay", "btn-candy", () => {
        forceCloseModal();
        switchFarmTab("devplay", { silent: true });
        document.getElementById("run")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => $("dp-acct-mail")?.focus(), 280);
      })
    );
    modalActions.appendChild(
      makeBtn("ปิด", "btn-ghost", () => forceCloseModal())
    );
  }

  function showPartyRunMaintenanceModal() {
    clearModalActions();
    openModal({
      mode: "partyrun-maintenance",
      title: "Party Run",
      bodyHtml:
        '<p><strong>เสี่ยงแบน · กำลังแก้ไข</strong></p><p class="muted">ใช้หรือไม่ใช้แล้วแต่คุณ</p>',
      icon: "assets/pirate_cookie_run.gif",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("รับทราบ", "btn-candy", () => forceCloseModal())
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
      icon: "assets/reward_icon_partyrun_ticket.png",
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

  function jobKindToMode(kind) {
    const map = {
      partyrun: "partyrun",
      heart: "heart",
      powder: "powder",
      giftdraw: "giftdraw",
      upgrade: "upgrade",
      cookie_unlock: "cookie_unlock",
      cookie: "cookie_unlock",
      reroll: "reroll",
      quest_claim: "quest_claim",
      quest: "quest_claim",
    };
    return map[kind] || kind || "partyrun";
  }

  function modeToJobKind(mode) {
    if (mode === "cookie_unlock" || mode === "cookie") return "cookie_unlock";
    if (mode === "quest" || mode === "quest_claim") return "quest_claim";
    if (mode === "reroll") return "reroll";
    return mode || "partyrun";
  }

  const JOB_KIND_TH = {
    partyrun: "Party Run",
    powder: "ฟาร์มผง",
    giftdraw: "เปิดกล่องขวัญ",
    heart: "ฟาร์มหัวใจ",
    upgrade: "ตีบวกสมบัติ",
    cookie_unlock: "ปลดล็อกคุกกี้",
    reroll: "รีโรล",
    quest_claim: "รับรางวัลเควส",
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
          setFarmStatus( "ถึงคิวแล้ว — กดเริ่มฟาร์มได้เลย", "ok");
        })
      );
    }
    if (queuedRun && (me.status === "waiting" || (!me.status && g.farm_busy))) {
      modalActions.appendChild(
        makeBtn("ยกเลิกคิว", "btn-ghost", () => {
          clearQueuedRun();
          stopQueuePoll();
          forceCloseModal();
          setFarmStatus( "ยกเลิกคิวแล้ว", "muted");
        })
      );
    }
  }

  async function joinQueue(jobKind) {
    try {
      const kind = jobKind || queuedJobKind || currentJobKind();
      const data = await api("/api/farm/queue/join", {
        method: "POST",
        body: { job_kind: kind },
      });
      showFarmDockQueue(data);
      startQueuePoll();
      return data;
    } catch (e) {
      clearQueuedRun();
      showErrorModal(thError(e.message) || "เข้าคิวไม่สำเร็จ", "คิว");
      throw e;
    }
  }

  function currentJobKind() {
    const map = {
      partyrun: "partyrun",
      powder: "powder",
      heart: "heart",
      giftdraw: "giftdraw",
      upgrade: "upgrade",
      cookie: "cookie_unlock",
      reroll: "reroll",
      quest: "quest_claim",
    };
    return map[farmTab] || null;
  }

  function isFarmExecutorBusy() {
    return !!(farmRunning || activeWatchJobId);
  }

  function activeFarmMode() {
    return statusContext?.mode || pipelineState?.mode || null;
  }

  function isModeActivelyRunning(mode) {
    return isFarmExecutorBusy() && activeFarmMode() === mode;
  }

  function pendingJobsCount() {
    return pendingFarmJobs.length;
  }

  function clearPendingFarmJobs() {
    pendingFarmJobs = [];
    if (pendingStartTimer) {
      clearTimeout(pendingStartTimer);
      pendingStartTimer = null;
    }
  }

  function enqueueFarmJob({ mode, label, target, runFn }) {
    if (pendingFarmJobs.length >= PENDING_FARM_MAX) {
      showErrorModal(
        "คิวเต็มแล้ว (สูงสุด " +
          PENDING_FARM_MAX +
          " งาน) — รอให้งานปัจจุบันหรือในคิวเสร็จก่อน",
        "คิวเต็ม"
      );
      return false;
    }
    const id =
      "pq_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    pendingFarmJobs.push({
      id,
      mode: mode || "partyrun",
      label: label || mode || "งานฟาร์ม",
      target: Number(target) || 0,
      runFn,
    });
    expandFarmDock();
    renderFarmDock();
    updateFarmAvailability();
    setFarmStatus(
      "เข้าคิวแล้ว (#" + pendingFarmJobs.length + ") — " + (label || mode),
      "ok"
    );
    return true;
  }

  function cancelPendingFarmJob(id) {
    const before = pendingFarmJobs.length;
    pendingFarmJobs = pendingFarmJobs.filter((j) => j.id !== id);
    if (pendingFarmJobs.length === before) return;
    renderFarmDock();
    updateFarmAvailability();
    setFarmStatus("ยกเลิกงานในคิวแล้ว", "muted");
  }

  function dequeueAndStartNext() {
    if (startingFromPersonalQueue) return;
    if (isFarmExecutorBusy()) return;
    if (queuedRun) return;
    if (!pendingFarmJobs.length) return;
    if (pendingStartTimer) return;
    pendingStartTimer = setTimeout(() => {
      pendingStartTimer = null;
      if (isFarmExecutorBusy() || queuedRun) return;
      const next = pendingFarmJobs.shift();
      if (!next || typeof next.runFn !== "function") {
        renderFarmDock();
        updateFarmAvailability();
        return;
      }
      renderFarmDock();
      updateFarmAvailability();
      setFarmStatus("ถึงคิวแล้ว — เริ่ม " + (next.label || next.mode), "ok");
      startingFromPersonalQueue = true;
      Promise.resolve()
        .then(() => next.runFn())
        .catch(() => {})
        .finally(() => {
          startingFromPersonalQueue = false;
          if (!isFarmExecutorBusy() && !queuedRun && pendingFarmJobs.length) {
            dequeueAndStartNext();
          }
        });
    }, 320);
  }

  /** If a farm job is already running, enqueue instead of submitting now. */
  function queueIfBusy(mode, target, label, runFn) {
    if (startingFromPersonalQueue) return false;
    if (!isFarmExecutorBusy()) return false;
    enqueueFarmJob({ mode, target, label, runFn });
    return true;
  }

  /** Hit farm_busy: hold the run, take a queue slot, and resume when it is ours. */
  async function enterQueueFor(gate, runFn, jobKind) {
    queuedJobKind = jobKind || currentJobKind();
    if (queueResumeAttempts >= 3) {
      queuedRun = null;
      queueResumeAttempts = 0;
      showFarmDockQueue(gate || { farm_busy: true, queue_length: 0, me: {} });
      startQueuePoll();
      return;
    }
    queuedRun = runFn || null;
    showFarmDockQueue(gate || { farm_busy: true, queue_length: 0, me: {} });
    startQueuePoll();
    if (!gate?.me?.status) {
      await joinQueue().catch(() => {});
    }
  }

  function resumeQueuedRun() {
    const run = queuedRun;
    if (!run || isFarmExecutorBusy()) return;
    queuedRun = null;
    queueResumeAttempts += 1;
    stopQueuePoll();
    dockPhase = "running";
    setFarmStatus( "ถึงคิวแล้ว — กำลังเริ่มให้อัตโนมัติ", "ok");
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
        showFarmDockQueue(data);
        startQueuePoll();
      } else if (queuedRun && data.can_run && !data.farm_busy) {
        resumeQueuedRun();
      } else if (dockPhase === "queued" && !data.farm_busy && !data.me?.status) {
        resetFarmDockIdle();
        stopQueuePoll();
      } else if (dockPhase === "queued" || queuedRun) {
        showFarmDockQueue(data);
      }
      if (Array.isArray(data.queue_items)) {
        renderFarmDockQueue(data.queue_items);
      }
      return data;
    } catch (e) {
      if (/network|Failed to fetch|network_error/i.test(String(e.message))) {
        showFarmDockQueue(lastGate || { farm_busy: true, queue_length: 0 }, { waking: true });
        startQueuePoll();
      }
      return null;
    }
  }

  function startActivityPoll() {
    stopActivityPoll();
    activityPollTimer = setInterval(() => {
      refreshFarmActivity().catch(() => {});
    }, 3500);
    refreshFarmActivity().catch(() => {});
  }

  function stopActivityPoll() {
    if (activityPollTimer) {
      clearInterval(activityPollTimer);
      activityPollTimer = null;
    }
  }

  function paintFarmActivity(data) {
    farmActivityData = data || null;
    if (accessToken && userView && !userView.classList.contains("hidden") && !dockPhase) {
      showFarmDock();
    }
    renderFarmDock();
  }

  async function refreshFarmActivity() {
    if (!accessToken) return null;
    try {
      const data = await api("/api/farm/activity");
      paintFarmActivity(data);
      return data;
    } catch (_) {
      return null;
    }
  }

  function paintFarmDockSystem(data) {
    farmActivityData = data || farmActivityData;
    // System board removed from FAB popup — history list covers this.
  }

  function systemBarCopy() {
    const d = farmActivityData || {};
    if (d.current?.job_kind) {
      const label = JOB_KIND_TH[d.current.job_kind] || d.current.job_kind;
      return { title: "สถานะระบบ", sub: "กำลังรัน: " + label };
    }
    if (d.farm_busy) {
      return { title: "สถานะระบบ", sub: "กำลังรันงานอื่น…" };
    }
    return { title: "สถานะระบบ", sub: "ว่าง — พร้อมรับงาน" };
  }

  function resetFarmDockIdle() {
    if (farmRunning || activeWatchJobId || dockPhase === "running" || dockPhase === "queued") {
      return;
    }
    dockPhase = null;
    dockOk = null;
    dockJobStartedAt = null;
    stopDockElapsedTimer();
    showFarmDock();
    collapseFarmDock();
    renderFarmDock();
  }

  function showConfirmModal(ticketN) {
    const n = Math.max(1, Number(ticketN) || 1);
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยัน Party Run?",
        body: "รัน " + n + " ตั๋วต่อเนื่อง",
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
        "⚠ เซิร์ฟเวอร์ยังไม่รองรับการเลือกจำนวนรอบ\n" +
        "จะใช้เหรียญทั้งหมดที่มี (" +
        formatNumTh(coins) +
        ") จนกว่าจะหมดหรือครบ " +
        formatNumTh(powderEstimate?.target_powder || 0) +
        " ผง";
    } else {
      const r = Math.max(1, Number(rounds) || 1);
      const cost = r * powderPricePerRound();
      body =
        "รัน " +
        formatNumTh(r) +
        " รอบ\n" +
        "เสียเหรียญ " +
        formatNumTh(cost) +
        " (เหลือ " +
        formatNumTh(Math.max(0, coins - cost)) +
        ")\n" +
        "ได้ผง +" +
        formatNumTh(r * powderYield());
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
          "เปิด " +
          n +
          " กล่อง (ไม่ใช้เพชร)",
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
          "ขอ " +
          n +
          " หัวใจ\n" +
          "ใช้ rotating proxy ของคุณสำหรับสร้าง guest\n" +
          "ระบบจะสร้างเพื่อน guest ชั่วคราวแล้วลบทิ้งให้เอง (เพื่อนจริงไม่ถูกแตะ)\nอาจใช้เวลาหลายนาที",
        icon: "assets/bbc_stat_iconHeart.png",
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
        if (hasFarmAccess()) {
          forceCloseModal();
          setFarmStatus( "ต่ออายุแล้ว พร้อมวิ่งฟาร์ม", "ok");
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
    el.classList.remove("is-ok", "is-err", "muted", "hidden");
    if (text) {
      el.removeAttribute("hidden");
      el.hidden = false;
    } else {
      el.setAttribute("hidden", "");
      el.hidden = true;
      el.classList.add("hidden");
    }
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
          ") · ต้องมีวันเช่าคงเหลือ";
      } else if (Number(devplaySession.tickets) <= 0) {
        hint.textContent = "ไม่มีตั๋ว Party Run ในไอดีนี้";
      } else {
        hint.textContent =
          "เหลือ " +
          formatNumTh(devplaySession.tickets) +
          " ใบ · พิมพ์ได้ 1–" +
          formatNumTh(max);
      }
    }
    const canStep = isDevPlayConnected() && !isModeActivelyRunning("partyrun") && !devplayConnecting;
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

  function clearDevPlayCreds() {
    const mail = $("dp-acct-mail");
    const secret = $("dp-acct-secret");
    if (mail) {
      mail.value = "";
      mail.setAttribute("readonly", "readonly");
    }
    if (secret) {
      secret.value = "";
      secret.setAttribute("readonly", "readonly");
    }
  }

  function logoutDevPlay() {
    if (farmRunning || devplayConnecting) {
      showErrorModal("รอฟาร์มจบก่อนสลับไอดี", "กำลังรันอยู่");
      return;
    }
    devplaySession = null;
    ticketMax = 99;
    ticketCount = 1;
    upgradeTreasures = [];
    upgradeSelected.clear();
    upgradeGridExpanded = false;
    upgradeEstimate = null;
    upgradeCoin = 0;
    cookieItems = [];
    cookieSelected.clear();
    cookieEstimate = null;
    cookieCoin = 0;
    powderEstimate = null;
    clearDevPlayCreds();
    switchFarmTab("devplay", { silent: true });
    paintDevPlayConnectStatus("ออกจาก DevPlay แล้ว — เข้าด้วยบัญชีอื่นได้", "muted");
    paintDevPlayHub();
    paintUpgradeGrid();
    paintTicketStepper();
    updateFarmAvailability();
    setFarmStatus( "ออกจาก DevPlay แล้ว — พร้อมสลับไอดี", "muted");
    showToast("ออกจาก DevPlay แล้ว — พร้อมสลับไอดี", "muted");
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
    paintDevPlayHub();
    paintTicketStepper();
  }

  function paintFarmNavLock() {
    const connected = isDevPlayConnected();
    ["partyrun", "heart", "powder", "giftdraw", "upgrade", "cookie", "reroll", "quest", "account", "dstool"].forEach((t) => {
      const btn = $("farm-tab-" + t);
      if (!btn) return;
      btn.classList.toggle("is-locked", !connected);
      btn.setAttribute("aria-disabled", connected ? "false" : "true");
    });
  }

  function paintDevPlayHub() {
    const connected = isDevPlayConnected();
    const loginCard = $("devplay-login-card");
    const accountCard = $("devplay-account-card");
    const hub = document.querySelector("#farm-panel-devplay .devplay-hub");
    loginCard?.classList.toggle("hidden", connected);
    accountCard?.classList.toggle("hidden", !connected);
    hub?.classList.toggle("is-connected", connected);
    paintFarmNavLock();
    syncOvenDevPlayLayout();

    if (!devplaySession) return;

    const nick = devplaySession.nickname || "player";
    const lvl = devplaySession.level == null ? "—" : "Lv " + devplaySession.level;
    const coin = devplaySession.coin == null ? "—" : formatNumTh(devplaySession.coin);
    const exp = devplaySession.exp == null ? "—" : formatNumTh(devplaySession.exp);
    const powder =
      devplaySession.powder == null ? "—" : formatNumTh(devplaySession.powder);
    const gem = devplaySession.gem == null ? "—" : formatNumTh(devplaySession.gem);
    const life = devplaySession.life == null ? "—" : formatNumTh(devplaySession.life);
    const boxes =
      devplaySession.giftBoxes == null ? "—" : formatNumTh(devplaySession.giftBoxes);
    let ticketsLabel = "—";
    if (devplaySession.ticketsLoading) ticketsLabel = "กำลังนับ…";
    else if (devplaySession.tickets != null)
      ticketsLabel = formatNumTh(devplaySession.tickets);

    if ($("devplay-account-name")) $("devplay-account-name").textContent = nick;
    if ($("devplay-account-sub"))
      $("devplay-account-sub").textContent = "เชื่อม DevPlay แล้ว · พร้อมใช้งาน";
    if ($("devplay-stat-level")) $("devplay-stat-level").textContent = lvl;
    if ($("devplay-stat-coin")) $("devplay-stat-coin").textContent = coin;
    if ($("devplay-stat-xp")) $("devplay-stat-xp").textContent = exp;
    if ($("devplay-stat-powder")) $("devplay-stat-powder").textContent = powder;
    if ($("devplay-stat-gem")) $("devplay-stat-gem").textContent = gem;
    if ($("devplay-stat-life")) $("devplay-stat-life").textContent = life;
    if ($("devplay-stat-boxes")) $("devplay-stat-boxes").textContent = boxes;
    if ($("devplay-stat-tickets")) $("devplay-stat-tickets").textContent = ticketsLabel;

    const reconnect = $("devplay-reconnect-btn");
    if (reconnect) {
      reconnect.hidden = !connected;
      reconnect.classList.toggle("hidden", !connected);
    }
    paintDevPlayConnectStatus("", "ok");
  }

  function paintDevPlaySessionLine() {
    paintDevPlayHub();
  }


  function getSavedProxyDraft() {
    try {
      return String(localStorage.getItem(GLOBAL_PROXY_KEY) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function saveProxyDraft(value) {
    const v = String(value || "").trim();
    try {
      if (v) localStorage.setItem(GLOBAL_PROXY_KEY, v);
      else localStorage.removeItem(GLOBAL_PROXY_KEY);
    } catch (_) {}
  }

  function getSessionProxy() {
    return String((devplaySession && devplaySession.proxyUrl) || "").trim();
  }

  function hasUsableProxy() {
    return !!(getSessionProxy() || getSavedProxyDraft());
  }

  function isValidProxyUrl(v) {
    const s = String(v || "").trim().toLowerCase();
    return s.startsWith("http://") || s.startsWith("https://");
  }

  async function saveProxyToServer(proxyUrl, { required = true } = {}) {
    if (!devplaySession?.id) {
      throw new Error("devplay_session_expired");
    }
    const v = String(proxyUrl || "").trim();
    if (!isValidProxyUrl(v)) {
      const err = new Error("proxy_url_invalid");
      err.code = "proxy_url_invalid";
      throw err;
    }
    await ensureApiReady();
    await api("/api/farm/devplay/proxy", {
      method: "POST",
      body: {
        devplay_session_id: devplaySession.id,
        proxy_url: v,
      },
    });
    saveProxyDraft(v);
    if (devplaySession) {
      devplaySession.proxyUrl = v;
      devplaySession.proxyConfigured = true;
    }
    paintHeartProxyHint();
    paintDevPlayHub();
    updateFarmAvailability();
    return v;
  }

  function promptProxyModal({ locked = true, title } = {}) {
    return new Promise((resolve) => {
      clearModalActions();
      const draft = getSessionProxy() || getSavedProxyDraft();
      openModal({
        mode: "proxy",
        title: title || "ตั้งค่า Proxy",
        locked: !!locked,
        icon: "assets/gem.png",
        bodyHtml:
          '<p class="muted" style="margin:0 0 10px;">ใส่ rotating proxy ของคุณ (บังคับ) — ใช้กับทุกฟังก์ชันที่ต้องยิงเกม เพื่อไม่ให้โหลดตกที่เซิร์ฟเวอร์</p>' +
          '<label class="field" for="modal-proxy-url"><span>PROXY URL</span>' +
          '<input id="modal-proxy-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" ' +
          'placeholder="http://user:pass@host:port/" value="' +
          String(draft).replace(/"/g, "&quot;") +
          '" /></label>' +
          '<p class="muted" id="modal-proxy-err" style="color:#ff8a80;min-height:18px;margin-top:6px;"></p>',
      });
      const input = $("modal-proxy-url");
      const errEl = $("modal-proxy-err");
      const saveBtn = makeBtn("บันทึก Proxy", "btn-candy", async () => {
        const v = String(input?.value || "").trim();
        if (!isValidProxyUrl(v)) {
          if (errEl) errEl.textContent = "รูปแบบไม่ถูกต้อง — ต้องขึ้นต้นด้วย http:// หรือ https://";
          return;
        }
        try {
          setBtnLoading(saveBtn, true);
          await saveProxyToServer(v);
          forceCloseModal();
          showToast("บันทึก proxy แล้ว", "ok");
          resolve(v);
        } catch (e) {
          if (errEl) {
            errEl.textContent =
              thError(e.code || e.message) || e.message || "บันทึก proxy ไม่สำเร็จ";
          }
        } finally {
          setBtnLoading(saveBtn, false);
        }
      });
      modalActions.appendChild(saveBtn);
      if (!locked) {
        modalActions.appendChild(
          makeBtn("ยกเลิก", "btn-ghost", () => {
            forceCloseModal();
            resolve(null);
          })
        );
      }
      setTimeout(() => input?.focus?.(), 50);
    });
  }

  // Compat aliases used by older heart UI code paths
  function getHeartProxy() {
    return getSessionProxy() || getSavedProxyDraft();
  }
  function saveHeartProxy(value) {
    saveProxyDraft(value);
  }
  function loadHeartProxyIntoInput() {}
  function hasUsableHeartProxy() {
    return hasUsableProxy();
  }

  function isHeartServiceEnabled() {
    if (!heartServiceStatus) return true;
    return !!heartServiceStatus.enabled || !!heartServiceStatus.ready;
  }

  function setFarmSidebarOpen(open) {
    const sidebar = $("farm-sidebar");
    const scrim = $("farm-sidebar-scrim");
    const userView = $("user-view");
    const compact = isCompactNav();
    const wasOpen = document.body.classList.contains("farm-sidebar-open");
    const isOpen = compact ? !!open : true;
    if (sidebar) {
      sidebar.dataset.open = isOpen ? "true" : "false";
      sidebar.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }
    if (userView) userView.classList.toggle("farm-sidebar-collapsed", compact && !isOpen);
    document.body.classList.toggle("farm-sidebar-compact", compact);
    document.body.classList.toggle("farm-sidebar-open", isOpen);
    if (scrim) {
      const useScrim = isOpen && compact;
      scrim.hidden = !useScrim;
      scrim.classList.toggle("is-on", useScrim);
    }
    const toggle = $("topbar-menu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (!isOpen && compact) unlockBodyScroll("menu-open");
    if (compact) {
      try {
        localStorage.setItem(FARM_SIDEBAR_KEY, isOpen ? "1" : "0");
      } catch (_) {}
      if (isOpen && !wasOpen) {
        const firstLink =
          sidebar?.querySelector(".farm-nav-item, .farm-sidebar-link, a, button");
        setTimeout(() => firstLink?.focus?.(), 40);
      } else if (!isOpen && wasOpen) {
        toggle?.focus?.();
      }
    }
  }

  function initFarmSidebar() {
    let open = false;
    if (!isCompactNav()) {
      open = true;
    } else {
      try {
        const saved = localStorage.getItem(FARM_SIDEBAR_KEY);
        if (saved === "1") open = true;
      } catch (_) {}
    }
    setFarmSidebarOpen(open);
    $("farm-sidebar-scrim")?.addEventListener("click", () => setFarmSidebarOpen(false));
    window.addEventListener("resize", () => {
      if (!isCompactNav()) setFarmSidebarOpen(true);
    });

    const sidebar = $("farm-sidebar");
    if (sidebar) {
      let touchStartX = 0;
      let touchStartY = 0;
      let tracking = false;
      sidebar.addEventListener(
        "touchstart",
        (ev) => {
          if (!isCompactNav() || !document.body.classList.contains("farm-sidebar-open")) return;
          const t = ev.changedTouches[0];
          touchStartX = t.clientX;
          touchStartY = t.clientY;
          tracking = true;
        },
        { passive: true }
      );
      sidebar.addEventListener(
        "touchmove",
        (ev) => {
          if (!tracking) return;
          const t = ev.changedTouches[0];
          const dx = t.clientX - touchStartX;
          const dy = t.clientY - touchStartY;
          if (Math.abs(dy) > Math.abs(dx)) {
            tracking = false;
            return;
          }
          if (dx > 72) {
            tracking = false;
            setFarmSidebarOpen(false);
          }
        },
        { passive: true }
      );
      sidebar.addEventListener(
        "touchend",
        () => {
          tracking = false;
        },
        { passive: true }
      );
    }
  }

  function paintHeartProxyHint() {
    const hint = $("heart-proxy-hint");
    if (!hint) return;
    const hasUser = hasUsableProxy();
    hint.classList.toggle("is-warn", !hasUser);
    if (hasUser) {
      hint.textContent =
        "ใช้ proxy ที่ตั้งหลัง login — เฉพาะตอนสร้าง guest · บัญชีหลักไม่ผ่าน proxy";
    } else {
      hint.textContent =
        "ยังไม่ได้ตั้ง proxy — หลัง login DevPlay ต้องใส่ rotating proxy ก่อนรันฟังก์ชันใดๆ";
    }
    const btn = $("devplay-proxy-btn");
    if (btn) {
      const connected = isDevPlayConnected();
      btn.hidden = !connected;
      btn.classList.toggle("hidden", !connected);
      btn.textContent = hasUser ? "แก้ Proxy" : "ตั้ง Proxy";
    }
  }

  async function loadHeartServiceStatus() {
    try {
      await ensureApiReady();
      heartServiceStatus = await api("/api/farm/heart/status");
    } catch (_) {
      heartServiceStatus = { ready: false, enabled: false, proxy_configured: false };
    }
    paintHeartServiceBanner();
    paintHeartProxyHint();
  }

  function paintHeartServiceBanner() {
    const banner = $("heart-service-banner");
    if (!banner) return;
    const st = heartServiceStatus || {};
    if (st.enabled || st.ready) {
      banner.classList.add("hidden");
      banner.textContent = "";
      return;
    }
    banner.classList.remove("hidden");
    if (st.enabled === false) {
      banner.textContent = "ฟาร์มหัวใจกำลังปิดปรับปรุง — รอแอดมินเปิดใช้งาน";
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
      powderReady: data.powder_ready !== false,
      proxyConfigured: !!data.proxy_configured,
      proxyUrl: data.proxy_configured ? getSavedProxyDraft() : "",
      tickets: ticketsN,
      ticketsLoading: !ticketsKnown,
      coin: data.coin,
      exp: data.exp,
      level: data.level,
      powder: data.powder,
      gem: data.gem,
      life: data.life,
      giftBoxes: data.gift_boxes,
      key: data.key,
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
    paintHeartProxyHint();
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
      setFarmStatus(
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
    const connectBtn = $("devplay-connect-btn");
    devplayConnecting = true;
    setBtnLoading(connectBtn, true);
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
      switchFarmTab("devplay", { silent: true });
      if (!devplaySession.proxyConfigured) {
        await promptProxyModal({ locked: true, title: "ใส่ Proxy ก่อนใช้งาน" });
      }
      const powderHint =
        data.powder_ready === false
          ? " · ผง / Gift Draw / ตีบวก อาจต้องเชื่อมใหม่อีกครั้ง"
          : "";
      const okMsg =
        farmTab === "powder"
          ? "เชื่อม DevPlay แล้ว · พร้อมฟาร์มผง" + powderHint
          : "เชื่อม DevPlay แล้ว · พร้อม Party Run" + powderHint;
      setFarmStatus(okMsg, data.powder_ready === false ? "muted" : "ok");
      showToast(okMsg, data.powder_ready === false ? "muted" : "ok");
    } catch (e) {
      resetDevPlaySession();
      const reason =
        e.userMessage ||
        thError(e.code || e.message) ||
        ERR_TH.connect_failed;
      const codeHint =
        e.gameCode != null
          ? "\n(รหัสระบบ: " + e.gameCode + ")"
          : e.code && e.code !== e.message
            ? "\n(" + e.code + ")"
            : "";
      paintDevPlayConnectStatus(reason, "err");
      showErrorModal(
        "เชื่อมไม่สำเร็จ เนื่องจาก\n" + reason + codeHint,
        "เชื่อม DevPlay ไม่สำเร็จ"
      );
    } finally {
      devplayConnecting = false;
      setBtnLoading(connectBtn, false);
      updateFarmAvailability();
    }
  }

  function syncOvenDevPlayLayout() {
    const run = $("run");
    if (!run) return;
    const compactLogin = farmTab === "devplay" && !isDevPlayConnected();
    run.classList.toggle("oven-panel--devplay-login", compactLogin);
  }

  function switchFarmTab(tab, opts = {}) {
    const tabs = [
      "devplay",
      "partyrun",
      "heart",
      "powder",
      "giftdraw",
      "upgrade",
      "cookie",
      "reroll",
      "quest",
      "account",
      "dstool",
    ];
    let next = tabs.includes(tab) ? tab : "devplay";
    if (next !== "devplay" && !isDevPlayConnected()) {
      if (!opts.silent) showDevPlayRequiredModal();
      next = "devplay";
    }
    farmTab = next;
    tabs.forEach((t) => {
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
    const meta = FARM_TAB_META[farmTab];
    if (meta) {
      const titleEl = $("farm-panel-title");
      const hintEl = $("farm-panel-hint");
      const iconEl = document.querySelector(".oven-title-icon");
      if (titleEl) titleEl.textContent = meta.title;
      if (hintEl) hintEl.textContent = meta.hint;
      if (iconEl && meta.icon) iconEl.src = "assets/" + meta.icon;
    }
    const partyBtn = $("farm-btn");
    const powderBtn = $("powder-btn");
    const giftdrawBtn = $("giftdraw-btn");
    const heartBtn = $("heart-btn");
    const upgradeBtn = $("upgrade-btn");
    const cookieBtn = $("cookie-btn");
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
    if (cookieBtn) {
      cookieBtn.hidden = farmTab !== "cookie";
      cookieBtn.classList.toggle("hidden", farmTab !== "cookie");
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
    if (farmTab === "cookie") {
      loadCookieList(false).catch(() => {});
    }
    if (farmTab === "reroll") {
      paintRerollMode();
    }
    if (farmTab === "dstool") {
      loadDsAllowlist(false).catch(() => {});
    }
    if (farmTab === "devplay") {
      paintDevPlayHub();
    }
    syncOvenDevPlayLayout();
  }

  async function loadPowderTreasures() {
    const hadList = powderTreasures.length > 0;
    if (!hadList) {
      try {
        await ensureApiReady();
        const data = await api("/api/farm/powder/treasures");
        powderTreasures = Array.isArray(data.treasures) ? data.treasures : [];
        if (data.default) powderTreasureName = data.default;
      } catch (_) {
        powderTreasures = [];
      }
    }
    if (!powderTreasures.some((t) => t.name === powderTreasureName)) {
      const fallback =
        powderTreasures.find((t) => t.name === "Revival Boots") || powderTreasures[0];
      if (fallback) powderTreasureName = fallback.name;
    }
    paintPowderSelectedTreasure();
    paintPowderEstimateStatic();
  }

  const TREASURE_IMAGE_CDN = "https://link.clashofdragons.com/images/treasures";
  const GRADE_FRAME_CDN = "https://link.clashofdragons.com/images/grade_frames";

  function gradeFrameSrc(grade) {
    const g = String(grade || "C").toUpperCase();
    const key = ["C", "B", "A", "S"].includes(g) ? g : "C";
    return GRADE_FRAME_CDN + "/" + key + ".png";
  }

  function treasureImageSrc(t) {
    if (t && typeof t === "object") {
      const url = String(t.image_url || "").trim();
      if (url) return url;
    }
    const name = (typeof t === "string" ? t : t?.name || "").trim();
    if (!name) return "";
    return TREASURE_IMAGE_CDN + "/" + encodeURIComponent(name) + ".png";
  }

  function setTreasureImg(img, src) {
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.src = src;
  }

  function appendTreasureImage(wrap, t) {
    if (!wrap) return;
    wrap.innerHTML = "";
    const grade = (t?.grade || "C").toUpperCase();
    const useFrame =
      wrap.classList.contains("powder-treasure-img-wrap") ||
      wrap.classList.contains("powder-pick-card-img-wrap") ||
      wrap.classList.contains("upgrade-card-img-wrap");

    if (useFrame) {
      const frame = document.createElement("div");
      frame.className = "treasure-frame grade-" + grade;
      const frameBg = document.createElement("img");
      frameBg.className = "treasure-frame-bg";
      frameBg.alt = "";
      frameBg.width = 96;
      frameBg.height = 96;
      frameBg.referrerPolicy = "no-referrer";
      frameBg.src = gradeFrameSrc(grade);
      const inner = document.createElement("div");
      inner.className = "treasure-frame-inner";
      const src = treasureImageSrc(t);
      if (src) {
        const img = document.createElement("img");
        img.className = "treasure-frame-icon";
        img.alt = "";
        img.width = 64;
        img.height = 64;
        img.loading = "lazy";
        img.onerror = () => {
          img.remove();
          const fb = document.createElement("span");
          fb.className = "treasure-frame-fallback";
          fb.textContent = grade;
          inner.appendChild(fb);
        };
        setTreasureImg(img, src);
        inner.appendChild(img);
      } else {
        const fb = document.createElement("span");
        fb.className = "treasure-frame-fallback";
        fb.textContent = grade;
        inner.appendChild(fb);
      }
      frame.append(frameBg, inner);
      wrap.appendChild(frame);
      return;
    }

    const src = treasureImageSrc(t);
    if (src) {
      const img = document.createElement("img");
      img.className = wrap.classList.contains("powder-treasure-img-wrap")
        ? "powder-treasure-img"
        : "powder-pick-card-img";
      img.alt = "";
      img.width = 72;
      img.height = 72;
      img.loading = "lazy";
      img.onerror = () => {
        img.remove();
        const fb = document.createElement("div");
        fb.className =
          (wrap.classList.contains("powder-treasure-img-wrap")
            ? "powder-treasure-fallback"
            : "upgrade-card-fallback") +
          " grade-" +
          grade;
        fb.textContent = grade;
        wrap.appendChild(fb);
      };
      setTreasureImg(img, src);
      wrap.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className =
        (wrap.classList.contains("powder-treasure-img-wrap")
          ? "powder-treasure-fallback"
          : "upgrade-card-fallback") +
        " grade-" +
        grade;
      fb.textContent = grade;
      wrap.appendChild(fb);
    }
  }

  function getPowderTreasure() {
    return (
      powderTreasures.find((x) => x.name === powderTreasureName) || {
        name: powderTreasureName,
        grade: "C",
      }
    );
  }

  function paintPowderSelectedTreasure() {
    const t = getPowderTreasure();
    const nameEl = $("powder-treasure-name");
    const metaEl = $("powder-treasure-meta");
    const wrap = $("powder-treasure-img-wrap");
    if (nameEl) nameEl.textContent = t.name || powderTreasureName;
    if (metaEl) {
      metaEl.textContent =
        t.price != null && t.powder_yield_lv1 != null
          ? formatNumTh(t.price) + " · +" + formatNumTh(t.powder_yield_lv1) + " ผง/รอบ"
          : "—";
    }
    appendTreasureImage(wrap, t);
  }

  function selectPowderTreasure(name) {
    if (!name || name === powderTreasureName) return;
    powderTreasureName = name;
    powderRounds = null;
    paintPowderSelectedTreasure();
    paintPowderEstimateStatic();
    refreshPowderEstimate().catch(() => {});
    updateFarmAvailability();
  }

  function paintPowderPickerGrid() {
    const grid = $("powder-picker-grid");
    if (!grid) return;
    grid.innerHTML = "";
    grid.classList.remove("card-stagger");
    if (powderPickerLoading) {
      renderSkeletonCards(grid, 6);
      return;
    }
    const q = powderPickerFilter.trim().toLowerCase();
    const list = (powderTreasures.length ? powderTreasures : [getPowderTreasure()]).filter(
      (t) => !q || (t.name || "").toLowerCase().includes(q)
    );
    if (!list.length) {
      grid.innerHTML = '<p class="muted powder-picker-empty">ไม่พบสมบัติ</p>';
      return;
    }
    grid.classList.add("card-stagger");
    list.slice(0, 300).forEach((t) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "powder-pick-card grade-" +
        (t.grade || "C").toUpperCase() +
        (t.name === powderTreasureName ? " is-selected" : "");
      const imgWrap = document.createElement("div");
      imgWrap.className = "powder-pick-card-img-wrap";
      appendTreasureImage(imgWrap, t);
      const name = document.createElement("div");
      name.className = "powder-pick-card-name";
      name.textContent = t.name || "Treasure";
      const meta = document.createElement("div");
      meta.className = "powder-pick-card-meta";
      meta.textContent =
        formatNumTh(t.price || 0) + " · +" + formatNumTh(t.powder_yield_lv1 || 0);
      card.append(imgWrap, name, meta);
      card.addEventListener("click", () => {
        selectPowderTreasure(t.name);
        forceCloseModal();
      });
      grid.appendChild(card);
    });
  }

  function showPowderTreasurePickerModal() {
    powderPickerFilter = "";
    clearModalActions();
    openModal({
      mode: "pick",
      title: "เลือกสมบัติฟาร์มผง",
      bodyHtml:
        '<div class="powder-picker-modal">' +
        '<input type="search" id="powder-picker-search" class="powder-picker-search" placeholder="ค้นหาชื่อสมบัติ…" autocomplete="off" />' +
        '<div class="powder-picker-grid" id="powder-picker-grid" aria-live="polite"></div>' +
        "</div>",
      icon: "assets/crc_cookie_stone_box.png",
      locked: false,
    });
    if (!powderTreasures.length) {
      powderPickerLoading = true;
      paintPowderPickerGrid();
      loadPowderTreasures()
        .then(() => {
          powderPickerLoading = false;
          paintPowderPickerGrid();
        })
        .catch(() => {
          powderPickerLoading = false;
          paintPowderPickerGrid();
        });
    } else {
      paintPowderPickerGrid();
    }
    const search = $("powder-picker-search");
    if (search) {
      search.value = "";
      search.addEventListener("input", () => {
        powderPickerFilter = search.value || "";
        paintPowderPickerGrid();
      });
      requestAnimationFrame(() => search.focus());
    }
    modalActions.appendChild(makeBtn("ปิด", "btn-ghost", () => forceCloseModal()));
  }

  function paintPowderEstimateStatic() {
    const t = powderTreasures.find((x) => x.name === powderTreasureName);
    const priceEl = $("powder-stat-price");
    const yieldEl = $("powder-stat-yield");
    if (priceEl) priceEl.textContent = t ? formatNumTh(t.price) : "—";
    if (yieldEl) yieldEl.textContent = t ? formatNumTh(t.powder_yield_lv1) : "—";
  }

  function powderMaxRounds() {
    const fromEst = Number(powderEstimate?.max_rounds);
    if (Number.isFinite(fromEst) && fromEst > 0) return Math.min(9999, fromEst);
    const price = Math.max(1, Number($("powder-price")?.value) || 5000);
    const coin = Number(devplaySession?.coin || 0);
    if (coin > 0) return Math.min(9999, Math.max(1, Math.floor(coin / price)));
    return 9999;
  }

  function powderYield() {
    return Math.max(1, Number(powderEstimate?.powder_yield_lv1 ?? $("powder-qty")?.value) || 15);
  }

  function powderPricePerRound() {
    return Math.max(0, Number(powderEstimate?.price ?? $("powder-price")?.value) || 5000);
  }

  function clampPowderRounds(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), powderMaxRounds());
  }

  function powderRoundsSupported() {
    return true;
  }

  function paintPowderStepper() {
    const roundsEl = $("powder-rounds");
    const minus = $("powder-minus");
    const plus = $("powder-plus");
    const connected = isDevPlayConnected();
    const rounds = clampPowderRounds(powderRounds ?? (Number(roundsEl?.value) || 10));
    powderRounds = rounds;
    if (roundsEl && document.activeElement !== roundsEl) roundsEl.value = String(rounds);
    const busy = isModeActivelyRunning("powder") || !!devplayConnecting;
    if (minus) minus.disabled = !connected || busy || rounds <= 1;
    if (plus) plus.disabled = !connected || busy || rounds >= powderMaxRounds();
    if (roundsEl) roundsEl.disabled = !connected || busy;
    paintPowderExamEstimate();
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


  function paintPowderExamEstimate() {
    const rounds = Math.max(1, Math.min(9999, Number($("powder-rounds")?.value) || powderRounds || 10));
    powderRounds = rounds;
    const price = Math.max(0, Number($("powder-price")?.value) || 5000);
    const yieldP = Math.max(1, Number($("powder-qty")?.value) || 15);
    const coin = Number(devplaySession?.coin || 0);
    const cost = rounds * price;
    const can = !!devplaySession && coin >= price;
    powderEstimate = {
      can_run: can,
      max_rounds: price > 0 ? Math.max(1, Math.floor(coin / price)) : 1,
      coin_available: coin,
      price,
      powder_yield_lv1: yieldP,
      target_powder: rounds * yieldP,
      capped: false,
    };
    const setTxt = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    setTxt("powder-stat-price", formatNumTh(price));
    setTxt("powder-stat-yield", formatNumTh(yieldP));
    setTxt("powder-stat-rounds", formatNumTh(rounds));
    setTxt("powder-stat-coin", formatNumTh(cost));
    const line = $("powder-cost-line");
    if (line) {
      if (!devplaySession) line.textContent = "เชื่อม DevPlay เพื่อดูประมาณการ";
      else if (!can) line.textContent = "เหรียญไม่พอ (มี " + formatNumTh(coin) + ")";
      else
        line.textContent =
          "จะใช้ " +
          formatNumTh(cost) +
          " เหรียญ · เหลือประมาณ " +
          formatNumTh(Math.max(0, coin - cost)) +
          " · ได้ประมาณ " +
          formatNumTh(rounds * yieldP) +
          " ผง";
    }
    const note = $("powder-estimate-note");
    if (note) {
      note.textContent = $("powder-do-break")?.checked
        ? "โหมด: ซื้อแล้วย่อยทันที (break after buying)"
        : "โหมด: ซื้ออย่างเดียว ไม่ย่อย";
    }
    const nameEl = $("powder-stuff-name");
    if (nameEl) {
      const seq = Number($("powder-stuff-seq")?.value) || 811;
      nameEl.textContent =
        seq === 811 ? "→ Normal Treasure Box (811)" : "→ stuffSeq " + seq;
    }
    updateFarmAvailability();
  }

  async function refreshPowderEstimate() {
    powderEstimateLoading = false;
    paintPowderExamEstimate();
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
          " · ต้องมีวันเช่าคงเหลือ";
      }
    }
    const canStep =
      isDevPlayConnected() &&
      !isModeActivelyRunning("giftdraw") &&
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
    if (devplaySession) devplaySession.giftBoxes = boxes;
    const perJob = Math.max(1, Number(est.max_per_job) || 1);
    giftdrawMax = Math.max(1, Math.min(boxes || 1, perJob));
    giftdrawCount = clampGiftDrawCount(giftdrawCount);

    if (boxesEl) boxesEl.textContent = formatNumTh(boxes);
    if (maxEl) maxEl.textContent = formatNumTh(Math.min(boxes || 0, perJob));
    if (targetEl) {
      targetEl.textContent = boxes
        ? "เปิดได้ " + formatNumTh(boxes) + " กล่อง (เปิดหลายกล่องได้ในครั้งเดียว)"
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
      if (msg) setFarmStatus( msg, "err");
    } finally {
      giftdrawEstimateLoading = false;
      paintGiftDrawStepper();
      updateFarmAvailability();
    }
  }

  /* ---------- Treasure upgrade ---------- */

  function upgradeImageSrc(t) {
    return treasureImageSrc(t);
  }

  function setUpgradeRunMode(mode) {
    const next = mode === "fast" ? "fast" : "sequential";
    upgradeRunMode = next;
    const row = $("upgrade-mode-row");
    const banner = $("upgrade-fast-banner");
    row?.querySelectorAll(".upgrade-mode-btn").forEach((btn) => {
      const active = btn.dataset.mode === next;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (banner) {
      banner.classList.toggle("hidden", next !== "fast");
      banner.hidden = next !== "fast";
    }
    paintUpgradeEstimate();
  }

  function setUpgradeRunContext(itemIndex, itemName, itemTotal, itemsCompleted) {
    if (!statusContext) statusContext = { mode: "upgrade", target: itemTotal || 0 };
    statusContext.itemIndex = itemIndex || 0;
    statusContext.itemName = itemName || "";
    statusContext.itemTotal = itemTotal || statusContext.target || 0;
    statusContext.itemsCompleted = itemsCompleted ?? Math.max(0, (itemIndex || 0) - 1);
    statusContext.target = itemTotal || statusContext.target || 0;
    if (pipelineState) {
      pipelineState.progress = {
        current: statusContext.itemsCompleted,
        total: statusContext.itemTotal,
      };
      renderPipeline();
    }
  }

  function mergeUpgradeLogsIntoPipeline(logs) {
    if (!logs?.length) return;
    applyLogsToPipeline(logs, "upgrade");
  }

  function setUpgradeTargetLevel(level) {
    const n = Math.min(9, Math.max(1, Number(level) || 9));
    if (n === upgradeTargetLevel) {
      paintUpgradeTargetLevel();
      return;
    }
    upgradeTargetLevel = n;
    paintUpgradeTargetLevel();
    refreshUpgradeEstimate().catch(() => {});
    updateFarmAvailability();
  }

  function paintUpgradeTargetLevel() {
    const row = $("upgrade-target-levels");
    if (!row) return;
    const connected = isDevPlayConnected();
    const canPick = connected && !isModeActivelyRunning("upgrade") && !devplayConnecting;
    const valueEl = $("upgrade-level-value");
    if (valueEl) {
      valueEl.textContent = "+" + upgradeTargetLevel;
      valueEl.title = upgradeTargetLevel === 9 ? "สูงสุด" : "";
    }
    row.querySelectorAll(".upgrade-level-seg").forEach((btn) => {
      const lv = Number(btn.dataset.level) || 0;
      btn.classList.toggle("is-active", lv === upgradeTargetLevel);
      btn.disabled = !canPick;
      btn.setAttribute("aria-pressed", lv === upgradeTargetLevel ? "true" : "false");
    });
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
      const modeLabel = upgradeRunMode === "fast" ? " · โหมด Fast" : " · เรียงทีละชิ้น";
      targetEl.textContent =
        "เป้าหมาย +" + upgradeTargetLevel + modeLabel;
    }
    if (noteEl) {
      const modeNote =
        upgradeRunMode === "fast"
          ? "โหมด Fast ตีบวกพร้อมกัน — เสี่ยง ID ถูกระงับ"
          : "เรียงทีละชิ้น — ชิ้นก่อนหน้าเสร็จก่อนเริ่มชิ้นถัดไป";
      noteEl.textContent =
        (worst > upgradeCoin
          ? "coin อาจไม่พอถึงเป้า — ระบบจะหยุดและรายงาน partial"
          : "ค่าใช้จ่ายจริงขึ้นกับ RNG — worst case คือแห้วทุกครั้ง") +
        " · " +
        modeNote;
    }
  }

  function upgradeCollapsedSlotCount() {
    const grid = $("upgrade-grid");
    const w = grid?.clientWidth || 360;
    const cardW = 132;
    const gap = 14;
    return Math.max(3, Math.min(8, Math.floor((w + gap) / (cardW + gap))));
  }

  function upgradeGridDisplayList(collapsed) {
    if (!collapsed || upgradeTreasures.length <= upgradeCollapsedSlotCount()) {
      return { items: upgradeTreasures, overflow: 0 };
    }
    const slots = upgradeCollapsedSlotCount();
    const showCount = Math.max(1, slots - 1);
    const selected = upgradeTreasures.filter((t) => upgradeSelected.has(t.uuid));
    const unselected = upgradeTreasures.filter((t) => !upgradeSelected.has(t.uuid));
    const ordered = [...selected, ...unselected];
    return {
      items: ordered.slice(0, showCount),
      overflow: Math.max(0, upgradeTreasures.length - showCount),
    };
  }

  function createUpgradeCard(t) {
    const card = document.createElement("button");
    card.type = "button";
    card.className =
      "upgrade-card grade-" +
      escapeHtml((t.grade || "S").toUpperCase()) +
      (upgradeSelected.has(t.uuid) ? " is-selected" : "") +
      (t.can_upgrade ? "" : " is-maxed");
    card.disabled = !t.can_upgrade || isModeActivelyRunning("upgrade") || devplayConnecting;
    card.dataset.uuid = t.uuid;
    const check = document.createElement("span");
    check.className = "upgrade-card-check";
    check.textContent = upgradeSelected.has(t.uuid) ? "✓" : "";
    const imgWrap = document.createElement("div");
    imgWrap.className = "upgrade-card-img-wrap";
    appendTreasureImage(imgWrap, t);
    const name = document.createElement("div");
    name.className = "upgrade-card-name";
    name.textContent = t.name || "Treasure";
    const meta = document.createElement("div");
    meta.className = "upgrade-card-meta";
    const level = t.enhancement ?? t.tag;
    meta.textContent =
      (t.grade || "S") +
      " · ปัจจุบัน +" +
      (level != null ? level : "—");
    card.append(check, imgWrap, name, meta);
    card.addEventListener("click", () => {
      if (!t.can_upgrade) return;
      if (upgradeSelected.has(t.uuid)) upgradeSelected.delete(t.uuid);
      else upgradeSelected.add(t.uuid);
      paintUpgradeGrid();
      refreshUpgradeEstimate().catch(() => {});
      updateFarmAvailability();
    });
    return card;
  }

  function createUpgradeOverflowCard(hiddenCount) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "upgrade-card upgrade-card-overflow grade-S";
    card.disabled = isModeActivelyRunning("upgrade") || devplayConnecting;
    const imgWrap = document.createElement("div");
    imgWrap.className = "upgrade-card-img-wrap";
    appendTreasureImage(imgWrap, { grade: "S", name: "" });
    const inner = imgWrap.querySelector(".treasure-frame-inner");
    if (inner) {
      inner.innerHTML = "";
      const count = document.createElement("span");
      count.className = "upgrade-overflow-count";
      count.textContent = "+" + formatNumTh(hiddenCount);
      inner.appendChild(count);
    }
    const name = document.createElement("div");
    name.className = "upgrade-card-name";
    name.textContent = "สมบัติเพิ่มเติม";
    const meta = document.createElement("div");
    meta.className = "upgrade-card-meta";
    meta.textContent = "กดเพื่อดูทั้งหมด";
    card.append(imgWrap, name, meta);
    card.addEventListener("click", () => {
      upgradeGridExpanded = true;
      paintUpgradeGrid();
    });
    return card;
  }

  function paintUpgradeGridToggle(hasOverflow, total) {
    const btn = $("upgrade-grid-toggle");
    if (!btn) return;
    if (!hasOverflow && upgradeGridExpanded) {
      btn.classList.remove("hidden");
      btn.textContent = "แสดงแถวเดียว";
      btn.setAttribute("aria-expanded", "true");
      return;
    }
    if (!hasOverflow) {
      btn.classList.add("hidden");
      return;
    }
    btn.classList.remove("hidden");
    if (upgradeGridExpanded) {
      btn.textContent = "แสดงแถวเดียว";
      btn.setAttribute("aria-expanded", "true");
    } else {
      btn.textContent = "ดูสมบัติทั้งหมด (" + formatNumTh(total) + ")";
      btn.setAttribute("aria-expanded", "false");
    }
  }

  function paintUpgradeGrid() {
    const grid = $("upgrade-grid");
    const hint = $("upgrade-grid-hint");
    if (!grid) return;
    grid.innerHTML = "";
    grid.classList.remove("is-collapsed", "is-expanded", "card-stagger");
    if (upgradeListLoading) {
      if (hint) hint.textContent = "กำลังโหลดสมบัติ…";
      renderSkeletonCards(grid, 6);
      paintUpgradeGridToggle(false, 0);
      return;
    }
    if (!isDevPlayConnected()) {
      if (hint) hint.textContent = "เชื่อม DevPlay เพื่อดูสมบัติในตัว";
      paintUpgradeGridToggle(false, 0);
      return;
    }
    if (!upgradeTreasures.length) {
      if (hint) hint.textContent = "ไม่พบสมบัติในคลัง (หรือยังไม่ได้โหลด)";
      paintUpgradeGridToggle(false, 0);
      return;
    }

    const collapsed = !upgradeGridExpanded && upgradeTreasures.length > upgradeCollapsedSlotCount();
    const { items, overflow } = upgradeGridDisplayList(collapsed);

    if (collapsed) {
      grid.classList.add("is-collapsed");
      if (hint) {
        hint.textContent =
          "แสดง " +
          formatNumTh(items.length) +
          " ชิ้น · เหลืออีก " +
          formatNumTh(overflow) +
          " ชิ้น — กดดูทั้งหมดเพื่อเลือกเพิ่ม";
      }
    } else if (upgradeGridExpanded && upgradeTreasures.length > upgradeCollapsedSlotCount()) {
      grid.classList.add("is-expanded");
      if (hint) hint.textContent = "เลือกได้หลายชิ้น — รันทีละชิ้น";
    } else {
      if (hint) hint.textContent = "เลือกได้หลายชิ้น — รันทีละชิ้น";
    }

    grid.classList.add("card-stagger");
    items.forEach((t) => grid.appendChild(createUpgradeCard(t)));
    if (collapsed && overflow > 0) {
      grid.appendChild(createUpgradeOverflowCard(overflow));
    }

    paintUpgradeGridToggle(
      upgradeTreasures.length > upgradeCollapsedSlotCount(),
      upgradeTreasures.length
    );
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
    if (force) upgradeGridExpanded = false;
    upgradeListLoading = true;
    paintUpgradeGrid();
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
      upgradeListLoading = false;
      paintUpgradeGrid();
      await refreshUpgradeEstimate();
    } catch (e) {
      upgradeTreasures = [];
      upgradeListLoading = false;
      paintUpgradeGrid();
      const msg = thError(e.message);
      if (msg) setFarmStatus( msg, "err");
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

  function showUpgradeFastConfirmModal(items) {
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันโหมด Fast?",
        body:
          "ตีบวก " +
          formatNumTh(items.length) +
          " ชิ้นพร้อมกัน → เป้า +" +
          upgradeTargetLevel +
          "\n\n" +
          "⚠️ โหมด Fast ยิง API เกมพร้อมกันหลายชิ้น\n" +
          "อาจทำให้ DevPlay ID ถูกระงับชั่วคราวหรือถาวร\n" +
          "คุณยอมรับความเสี่ยงนี้หรือไม่?",
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
        makeBtn("ยืนยัน Fast", "btn-candy", () => {
          forceCloseModal();
          resolve(true);
        })
      );
    });
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
          (upgradeRunMode === "fast" ? "โหมด: Fast (พร้อมกัน)\n" : "โหมด: เรียงทีละชิ้น\n") +
          "ตีบวก " +
          formatNumTh(n) +
          " ชิ้น → เป้า +" +
          upgradeTargetLevel +
          "\ncoin สูงสุด (worst): " +
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

  /* ---------- Cookie unlock ---------- */
  const COOKIE_IMAGE_CDN = "https://link.clashofdragons.com/images/cookies";

  function cookieImageSrc(item) {
    if (item && typeof item === "object") {
      const url = String(item.image_url || "").trim();
      if (url) return url;
      const name = String(item.cookie_name || "").trim();
      if (name) return COOKIE_IMAGE_CDN + "/" + encodeURIComponent(name) + ".png";
    }
    const name = String(item || "").trim();
    if (!name) return "";
    return COOKIE_IMAGE_CDN + "/" + encodeURIComponent(name) + ".png";
  }

  function getSelectedCookieItems() {
    return cookieItems.filter((c) => cookieSelected.has(String(c.seq)) && c.can_buy);
  }

  function paintCookieEstimate() {
    const selected = getSelectedCookieItems();
    const selEl = $("cookie-stat-selected");
    const tokEl = $("cookie-stat-tokens");
    const costEl = $("cookie-stat-cost");
    const coinEl = $("cookie-stat-coin");
    const targetEl = $("cookie-estimate-target");
    const noteEl = $("cookie-estimate-note");
    if (coinEl) coinEl.textContent = formatNumTh(cookieCoin);
    if (selEl) selEl.textContent = formatNumTh(selected.length) + " ตัว";
    if (tokEl) tokEl.textContent = formatNumTh(selected.length);
    let cost = 0;
    selected.forEach((c) => {
      cost += Number(c.coin_cost || c.total_cost || 0);
    });
    if (costEl) costEl.textContent = selected.length ? formatNumTh(cost) + " coin" : "—";
    if (!selected.length) {
      if (targetEl) targetEl.textContent = "เลือกคุกกี้เพื่อดูประมาณการ";
      if (noteEl) noteEl.textContent = "";
      return;
    }
    if (targetEl) {
      targetEl.textContent =
        "ปลดล็อก " +
        formatNumTh(selected.length) +
        " ตัว · เรียงทีละตัว";
    }
    if (noteEl) {
      const expensive = selected.some((c) => Number(c.coin_cost || 0) >= 100000);
      let msg =
        cost > cookieCoin
          ? "เหรียญในไอดีไม่พอกับรายการที่เลือก"
          : "ระบบจะเช็ค ownership + เหรียญอีกครั้งก่อนซื้อแต่ละตัว";
      if (expensive) msg += " · มีตัวราคาสูง (เช่น Sea Fairy)";
      noteEl.textContent = msg;
    }
  }

  function paintCookieGrid() {
    const grid = $("cookie-grid");
    const hint = $("cookie-grid-hint");
    if (!grid) return;
    grid.innerHTML = "";
    grid.classList.remove("card-stagger");
    if (cookieListLoading && !cookieItems.length) {
      if (hint) hint.textContent = "กำลังโหลดรายการคุกกี้…";
      renderSkeletonCards(grid, 6);
      return;
    }
    if (!cookieItems.length) {
      if (hint) {
        hint.textContent = isDevPlayConnected()
          ? "กดโหลดใหม่เพื่อดึงรายการ"
          : "เชื่อม DevPlay เพื่อดูรายการคุกกี้";
      }
      return;
    }
    if (hint) {
      const buyable = cookieItems.filter((c) => c.can_buy).length;
      const owned = cookieItems.filter((c) => c.owned).length;
      hint.textContent =
        "ซื้อได้ " +
        formatNumTh(buyable) +
        " · มีแล้ว " +
        formatNumTh(owned) +
        " · เหรียญในไอดี " +
        formatNumTh(cookieCoin);
    }
    grid.classList.add("card-stagger");
    cookieItems.forEach((c) => {
      const seq = String(c.seq);
      const canBuy = !!c.can_buy;
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "upgrade-card cookie-card" +
        (cookieSelected.has(seq) ? " is-selected" : "") +
        (c.owned ? " is-owned is-maxed" : "") +
        (!c.owned && !canBuy ? " is-broke is-maxed" : "");
      card.disabled = !canBuy || isModeActivelyRunning("cookie_unlock") || devplayConnecting;
      card.dataset.seq = seq;

      if (c.owned || !canBuy) {
        const badge = document.createElement("span");
        badge.className = "cookie-card-badge";
        badge.textContent = c.owned ? "มีแล้ว" : "เหรียญไม่พอ";
        card.appendChild(badge);
      }

      const check = document.createElement("span");
      check.className = "upgrade-card-check";
      check.textContent = cookieSelected.has(seq) ? "✓" : "";

      const imgWrap = document.createElement("div");
      imgWrap.className = "upgrade-card-img-wrap";
      const img = document.createElement("img");
      img.className = "cookie-card-img";
      img.alt = c.cookie_name || "";
      img.width = 72;
      img.height = 72;
      img.loading = "lazy";
      img.src = cookieImageSrc(c);
      img.onerror = () => {
        img.style.display = "none";
      };
      imgWrap.appendChild(img);

      const name = document.createElement("div");
      name.className = "upgrade-card-name";
      name.textContent = c.cookie_name || c.artifact_name || seq;

      const meta = document.createElement("div");
      meta.className = "upgrade-card-meta";
      meta.textContent = formatNumTh(c.coin_cost || c.total_cost || 0) + " coin";

      card.append(check, imgWrap, name, meta);
      card.addEventListener("click", () => {
        if (!canBuy) return;
        if (cookieSelected.has(seq)) cookieSelected.delete(seq);
        else cookieSelected.add(seq);
        paintCookieGrid();
        paintCookieEstimate();
        updateFarmAvailability();
      });
      grid.appendChild(card);
    });
  }

  async function loadCookieList(force) {
    if (!isDevPlayConnected()) {
      cookieItems = [];
      cookieSelected.clear();
      cookieCoin = 0;
      paintCookieGrid();
      paintCookieEstimate();
      return;
    }
    if (cookieListLoading) return;
    if (cookieItems.length && !force) {
      paintCookieGrid();
      paintCookieEstimate();
      updateFarmAvailability();
      return;
    }
    cookieListLoading = true;
    paintCookieGrid();
    try {
      await ensureApiReady();
      const data = await api(
        "/api/farm/cookie-unlock/list?devplay_session_id=" +
          encodeURIComponent(devplaySession.id)
      );
      cookieItems = Array.isArray(data.items) ? data.items : [];
      cookieCoin = Number(data.coin || 0);
      if (typeof data.coin === "number" && devplaySession) {
        devplaySession.coin = data.coin;
        paintDevPlayHub();
      }
      const valid = new Set(cookieItems.filter((c) => c.can_buy).map((c) => String(c.seq)));
      [...cookieSelected].forEach((seq) => {
        if (!valid.has(seq)) cookieSelected.delete(seq);
      });
      paintCookieGrid();
      paintCookieEstimate();
      updateFarmAvailability();
    } catch (err) {
      cookieItems = [];
      paintCookieGrid();
      setFarmStatus( sanitizeDisplayError(err, "cookie_list_failed"), "warn");
    } finally {
      cookieListLoading = false;
    }
  }

  function selectBuyableCookies() {
    cookieSelected.clear();
    cookieItems.forEach((c) => {
      if (c.can_buy) cookieSelected.add(String(c.seq));
    });
    paintCookieGrid();
    paintCookieEstimate();
    updateFarmAvailability();
  }

  function showCookieConfirmModal(items) {
    const n = items.length;
    let cost = 0;
    const names = items.map((c) => c.cookie_name || c.seq).join(", ");
    items.forEach((c) => {
      cost += Number(c.coin_cost || c.total_cost || 0);
    });
    const expensive = items.some((c) => Number(c.coin_cost || 0) >= 100000);
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันปลดล็อกคุกกี้?",
        body:
          "ปลดล็อก " +
          formatNumTh(n) +
          " ตัว (เรียงทีละตัว)\n" +
          names +
          "\ncoin ที่ใช้ประมาณ: " +
          formatNumTh(cost) +
          "\ncoin ในไอดี: " +
          formatNumTh(cookieCoin) +
          (expensive ? "\n⚠ มีตัวราคาสูง — ตรวจยอดเหรียญให้ดี" : ""),
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

  async function runCookieUnlock() {
    const items = getSelectedCookieItems();
    if (!items.length) {
      showErrorModal("เลือกคุกกี้ที่ปลดล็อกได้ก่อน", "ยังไม่ได้เลือก");
      return;
    }
    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }

    setFarmStatus(
      "กำลังปลดล็อกคุกกี้ " + formatNumTh(items.length) + " ตัว…",
      "muted"
    );

    if (
      queueIfBusy(
        "cookie_unlock",
        items.length,
        "ปลดล็อกคุกกี้ · " + formatNumTh(items.length) + " ตัว",
        () => runCookieUnlock()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/cookie-unlock/run-batch",
        body: {
          devplay_session_id: devplaySession.id,
          seqs: items.map((c) => String(c.seq)),
        },
        mode: "cookie_unlock",
        target: items.length,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const done = Number(result?.items_done || data.items_done || 0);
            const skipped = Number(result?.items_skipped || data.items_skipped || 0);
            const failed = Number(result?.items_failed || data.items_failed || 0);
            items.forEach((c) => cookieSelected.delete(String(c.seq)));
            const msg =
              "ปลดล็อกสำเร็จ " +
              formatNumTh(done) +
              "/" +
              formatNumTh(items.length) +
              (skipped ? " · ข้าม " + formatNumTh(skipped) : "") +
              (failed ? " · ล้มเหลว " + formatNumTh(failed) : "");
            setFarmStatus( msg, "ok");
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            loadCookieList(true).catch(() => {});
            loadFarmHistory().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            setFarmStatus(
              farmErrorMessage(result, "ปลดล็อกคุกกี้ไม่สำเร็จ"),
              "warn"
            );
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (err) {
      handleFarmRunException(err, "cookie_unlock");
    }
  }

  /* ---------- Reroll / Quest / Account / DS ---------- */
  function clampRerollCount(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), REROLL_MAX);
  }

  function paintRerollMode() {
    const guest = rerollMode === "guest";
    $("reroll-mode-guest")?.classList.toggle("is-active", guest);
    $("reroll-mode-accounts")?.classList.toggle("is-active", !guest);
    const guestSec = $("reroll-guest-section");
    const acctSec = $("reroll-accounts-section");
    if (guestSec) {
      guestSec.classList.toggle("hidden", !guest);
      guestSec.hidden = !guest;
    }
    if (acctSec) {
      acctSec.classList.toggle("hidden", guest);
      acctSec.hidden = guest;
    }
    paintRerollStepper();
    updateFarmAvailability();
  }

  function paintRerollStepper() {
    const input = $("reroll-count");
    if (input) input.value = String(rerollCount);
    const minus = $("reroll-minus");
    const plus = $("reroll-plus");
    const running = isModeActivelyRunning("reroll");
    if (minus) minus.disabled = running || rerollCount <= 1;
    if (plus) plus.disabled = running || rerollCount >= REROLL_MAX;
  }

  function parseRerollAccountsText(raw) {
    const lines = String(raw || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const accounts = [];
    for (const line of lines) {
      let email = "";
      let password = "";
      if (line.includes("\t")) {
        const parts = line.split("\t");
        email = (parts[0] || "").trim();
        password = (parts.slice(1).join("\t") || "").trim();
      } else if (line.includes(":")) {
        const idx = line.indexOf(":");
        email = line.slice(0, idx).trim();
        password = line.slice(idx + 1).trim();
      } else {
        const parts = line.split(/\s+/);
        email = (parts[0] || "").trim();
        password = parts.slice(1).join(" ").trim();
      }
      if (email && password) accounts.push({ email, password });
    }
    return accounts;
  }


  function downloadRerollResults(results) {
    const lines = (results || [])
      .filter((r) => r && (r.guest_secret || r.email || r.mid))
      .map((r) => {
        if (r.email) return [r.email, "", r.nickname || "", r.mid || ""].join("\t");
        return [
          r.mid || "",
          r.guest_secret || "",
          r.device_id || "",
          r.nickname || "",
          (r.draws || []).map((d) => d.name || d.itemId).filter(Boolean).join(","),
        ].join("\t");
      });
    const header = "mid_or_email\tguest_secret_or_blank\tdevice_id\tnickname\tdraws\n";
    const blob = new Blob([header + lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reroll_accounts.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function registerRerollGuest(row) {
    if (!row?.mid || !row?.guest_secret) {
      showErrorModal("ไม่มี guest_secret สำหรับไอดีนี้", "แปลงอีเมลไม่ได้");
      return;
    }
    clearModalActions();
    openModal({
      mode: "reroll-register",
      title: "แปลง guest เป็นอีเมล",
      icon: "assets/gem.png",
      bodyHtml:
        '<p class="muted">mid: <code>' +
        String(row.mid) +
        "</code></p>" +
        '<label class="field"><span>EMAIL</span><input id="reroll-reg-email" type="email" autocomplete="off" /></label>' +
        '<label class="field"><span>PASSWORD</span><input id="reroll-reg-pass" type="password" autocomplete="new-password" /></label>',
    });
    modalActions.appendChild(
      makeBtn("แปลง", "btn-candy", async () => {
        const email = String($("reroll-reg-email")?.value || "").trim();
        const password = String($("reroll-reg-pass")?.value || "");
        if (!email || password.length < 6) {
          showErrorModal("กรอกอีเมลและรหัสผ่าน (อย่างน้อย 6 ตัว)", "ข้อมูลไม่ครบ");
          return;
        }
        try {
          await ensureApiReady();
          const data = await api("/api/farm/reroll/register", {
            method: "POST",
            body: {
              mid: row.mid,
              email,
              password,
              guest_secret: row.guest_secret,
              device_id: row.device_id,
              game_access_token: row.game_access_token,
              oven_access_token: row.oven_access_token,
              devplay_session_id: devplaySession?.id,
              proxy_url: getHeartProxy() || undefined,
          devplay_session_id: devplaySession?.id,
            },
          });
          forceCloseModal();
          if (data.ok) {
            showToast("แปลงอีเมลสำเร็จ: " + email, "ok");
            row.email = email;
            paintRerollResults(lastRerollResults);
          } else {
            showErrorModal("แปลงอีเมลไม่สำเร็จ", "ล้มเหลว");
          }
        } catch (e) {
          showErrorModal(thError(e.code || e.message) || String(e.message || e), "แปลงอีเมลไม่สำเร็จ");
        }
      })
    );
    modalActions.appendChild(makeBtn("ยกเลิก", "btn-ghost", () => forceCloseModal()));
  }

  function paintRerollResults(results) {
    const root = $("reroll-results");
    if (!root) return;
    const rows = Array.isArray(results) ? results : [];
    if (!rows.length) {
      root.innerHTML = "";
      root.hidden = true;
      root.classList.add("hidden");
      return;
    }
    root.hidden = false;
    root.classList.remove("hidden");
    const head =
      '<div class="reroll-results-head"><strong>ผลรีโรล ' +
      rows.length +
      ' ไอดี</strong> <button type="button" class="btn btn-ghost btn-sm" id="reroll-download-btn">ดาวน์โหลด</button></div>';
    const cards = rows
      .map((r, idx) => {
        const draws = (r.draws || [])
          .map((d) => d.name || d.itemId || "?")
          .slice(0, 8)
          .join(", ");
        const secret = r.guest_secret
          ? '<div class="reroll-secret"><code>' +
            String(r.guest_secret) +
            '</code> <button type="button" class="btn btn-ghost btn-sm" data-copy="' +
            String(r.guest_secret).replace(/"/g, "&quot;") +
            '">คัดลอก</button></div>'
          : "";
        const regBtn = r.guest_secret
          ? '<button type="button" class="btn btn-ghost btn-sm" data-reg-idx="' +
            idx +
            '">แปลงเป็นอีเมล</button>'
          : "";
        return (
          '<article class="reroll-result-card">' +
          "<div><strong>" +
          (r.nickname || r.email || r.mid || "—") +
          "</strong> <span class=\"muted\">" +
          (r.mid || "") +
          "</span></div>" +
          (r.device_id ? '<div class="muted">device: ' + r.device_id + "</div>" : "") +
          secret +
          '<div class="muted">draws: ' +
          (draws || "—") +
          "</div>" +
          regBtn +
          "</article>"
        );
      })
      .join("");
    root.innerHTML = head + '<div class="reroll-results-list">' + cards + "</div>";
    $("reroll-download-btn")?.addEventListener("click", () => downloadRerollResults(rows));
    root.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute("data-copy") || "");
          showToast("คัดลอกแล้ว", "ok");
        } catch (_) {}
      });
    });
    root.querySelectorAll("[data-reg-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-reg-idx"));
        registerRerollGuest(rows[i]);
      });
    });
  }

  async function runReroll() {
    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }

    let body;
    let target = 1;
    let label = "รีโรล";
    if (rerollMode === "accounts") {
      const accounts = parseRerollAccountsText($("reroll-accounts")?.value || "");
      if (!accounts.length) {
        showErrorModal(ERR_TH.reroll_accounts_required, "ยังไม่มีบัญชี");
        return;
      }
      if (accounts.length > REROLL_MAX) {
        showErrorModal(ERR_TH.reroll_too_many_accounts, "บัญชีเกินกำหนด");
        return;
      }
      body = { mode: "accounts", accounts, draw_count: 8, count: accounts.length };
      target = accounts.length;
      label = "รีโรล · " + formatNumTh(accounts.length) + " บัญชี";
    } else {
      rerollCount = clampRerollCount($("reroll-count")?.value || rerollCount);
      paintRerollStepper();
      body = {
        mode: "guest",
        count: rerollCount,
        draw_count: 8,
        devplay_session_id: devplaySession.id,
        proxy_url: getHeartProxy() || undefined,
      };
      target = rerollCount;
      label = "รีโรล · " + formatNumTh(rerollCount) + " ไอดี";
    }
    if (!hasUsableProxy()) {
      await promptProxyModal({ locked: true, title: "ใส่ Proxy ก่อนรีโรล" });
      if (!hasUsableProxy()) return;
    }
    if (rerollMode === "accounts") {
      body.proxy_url = getHeartProxy() || undefined;
      body.devplay_session_id = devplaySession.id;
    }

    setFarmStatus("กำลังรีโรล…", "muted");
    if (queueIfBusy("reroll", target, label, () => runReroll())) return;

    try {
      await submitFarmJob({
        url: "/api/farm/reroll/run",
        body,
        mode: "reroll",
        target,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            lastRerollResults = Array.isArray(result?.results) ? result.results : [];
            paintRerollResults(lastRerollResults);
            const n =
              result?.results?.length ||
              result?.accounts?.length ||
              result?.count ||
              target;
            setFarmStatus("รีโรลสำเร็จ " + formatNumTh(n) + " บัญชี", "ok");
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            loadFarmHistory().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            setFarmStatus(farmErrorMessage(result, "รีโรลไม่สำเร็จ"), "warn");
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (err) {
      handleFarmRunException(err, "reroll");
    }
  }

  function paintQuestList() {
    const root = $("quest-list");
    if (!root) return;
    root.innerHTML = "";
    if (!questList.length) {
      root.innerHTML = '<p class="muted account-item-empty">ยังไม่มีรายการ — กดโหลดรายการเควส</p>';
      return;
    }
    questList.forEach((q) => {
      const seq = String(q.seq);
      const claimable = !!q.claimable;
      const label = document.createElement("label");
      label.className = "quest-item" + (claimable ? "" : " is-disabled");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = seq;
      cb.disabled = !claimable || isModeActivelyRunning("quest_claim");
      cb.checked = questSelected.has(seq) && claimable;
      cb.addEventListener("change", () => {
        if (cb.checked) questSelected.add(seq);
        else questSelected.delete(seq);
        updateFarmAvailability();
      });
      const body = document.createElement("div");
      body.className = "quest-item-body";
      const title = document.createElement("span");
      title.className = "quest-item-title";
      title.textContent = "เควส #" + seq + (q.questType ? " · " + q.questType : "");
      const meta = document.createElement("span");
      meta.className = "quest-item-meta";
      const count = Number(q.count) || 0;
      const total = Number(q.totalCount) || 0;
      let status = "ยังไม่ครบ";
      if (q.rewarded) status = "รับแล้ว";
      else if (claimable) status = "รับได้";
      meta.textContent = count + "/" + total + " · " + status;
      const bar = document.createElement("div");
      bar.className = "quest-item-bar";
      const fill = document.createElement("span");
      const pct = total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(bar);
      label.appendChild(cb);
      label.appendChild(body);
      root.appendChild(label);
    });
  }

  async function loadQuestList() {
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    questLoading = true;
    updateFarmAvailability();
    try {
      const data = await api(
        "/api/farm/quest/list?devplay_session_id=" + encodeURIComponent(devplaySession.id)
      );
      questList = Array.isArray(data.quests) ? data.quests : [];
      questSelected = new Set(
        [...questSelected].filter((s) => questList.some((q) => String(q.seq) === s && q.claimable))
      );
      paintQuestList();
      setFarmStatus(
        "โหลดเควส " + formatNumTh(questList.length) + " รายการ",
        "ok"
      );
    } catch (e) {
      showErrorModal(thError(e.message || e.data?.detail) || "โหลดเควสไม่สำเร็จ", "เควส");
    } finally {
      questLoading = false;
      updateFarmAvailability();
    }
  }

  async function runQuestClaim() {
    const seqs = [...questSelected]
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
    if (!seqs.length) {
      showErrorModal("เลือกเควสที่รับรางวัลได้ก่อน", "ยังไม่ได้เลือก");
      return;
    }
    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }

    setFarmStatus("กำลังรับรางวัลเควส…", "muted");
    if (
      queueIfBusy(
        "quest_claim",
        seqs.length,
        "รับเควส · " + formatNumTh(seqs.length) + " รายการ",
        () => runQuestClaim()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/quest/claim",
        body: {
          devplay_session_id: devplaySession.id,
          seqs,
        },
        mode: "quest_claim",
        target: seqs.length,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const okN = (result?.results || []).filter((r) => r.ok).length;
            setFarmStatus(
              "รับรางวัลเควสสำเร็จ " + formatNumTh(okN || seqs.length) + " รายการ",
              "ok"
            );
            questSelected.clear();
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            loadFarmHistory().catch(() => {});
            loadQuestList().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            setFarmStatus(farmErrorMessage(result, "รับรางวัลเควสไม่สำเร็จ"), "warn");
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (err) {
      handleFarmRunException(err, "quest_claim");
    }
  }

  function paintAccountItems(elId, items) {
    const root = $(elId);
    if (!root) return;
    root.innerHTML = "";
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      root.innerHTML = '<p class="account-item-empty muted">ไม่มีรายการ</p>';
      return;
    }
    list.slice(0, 80).forEach((it) => {
      const card = document.createElement("div");
      card.className = "account-item-card";
      const img = document.createElement("img");
      img.src = it.imageUrl || "assets/score.png";
      img.alt = "";
      img.width = 40;
      img.height = 40;
      img.loading = "lazy";
      img.onerror = () => {
        img.onerror = null;
        img.src = "assets/score.png";
      };
      const name = document.createElement("span");
      name.className = "account-item-name";
      name.textContent = it.name || it.seq || "—";
      card.appendChild(img);
      card.appendChild(name);
      if (it.qty != null && Number(it.qty) > 1) {
        const qty = document.createElement("span");
        qty.className = "account-item-qty";
        qty.textContent = "×" + formatNumTh(it.qty);
        card.appendChild(qty);
      } else if (it.tag != null && Number(it.tag) > 0) {
        const qty = document.createElement("span");
        qty.className = "account-item-qty";
        qty.textContent = "+" + formatNumTh(it.tag);
        card.appendChild(qty);
      }
      root.appendChild(card);
    });
  }

  function paintAccountSummary(data) {
    const s = data?.summary || {};
    const set = (id, val) => {
      const el = $(id);
      if (el) el.textContent = val == null || val === "" ? "—" : formatNumTh(val);
    };
    set("account-stat-level", s.lv);
    set("account-stat-coin", s.coin);
    set("account-stat-gem", s.gem);
    set("account-stat-life", s.lifeCount);
    set("account-stat-tickets", s.partyRunTicketCount);
    set("account-stat-keys", s.keyCount);
    set("account-stat-trophy", s.trophyCount);
    set("account-stat-exp", s.exp);
    paintAccountItems("account-cookies", data?.cookies);
    paintAccountItems("account-pets", data?.pets);
    paintAccountItems("account-treasures", data?.treasures);
  }

  async function loadAccountInfo() {
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    accountLoading = true;
    updateFarmAvailability();
    try {
      const data = await api(
        "/api/farm/account/info?devplay_session_id=" + encodeURIComponent(devplaySession.id)
      );
      accountProfile = data;
      paintAccountSummary(data);
      setFarmStatus("โหลดข้อมูลไอดีแล้ว", "ok");
    } catch (e) {
      const msg =
        thError(e.message || e.data?.detail) || ERR_TH.account_info_failed;
      showErrorModal(msg, "ข้อมูลไอดี");
    } finally {
      accountLoading = false;
      updateFarmAvailability();
    }
  }

  async function loadDsAllowlist(force) {
    if (dsAllowlistLoaded && !force) {
      paintDsPathSelect();
      return;
    }
    try {
      const data = await api("/api/farm/ds/allowlist");
      dsAllowlist = Array.isArray(data.paths) ? data.paths : [];
      dsAllowlistLoaded = true;
      paintDsPathSelect();
    } catch (_) {
      dsAllowlist = [];
      paintDsPathSelect();
    }
  }

  function paintDsPathSelect() {
    const sel = $("ds-path-select");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = "";
    if (!dsAllowlist.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "ยังไม่มีคำสั่งในรายการอนุญาต";
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "เลือกคำสั่ง…";
    sel.appendChild(placeholder);
    dsAllowlist.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });
    if (prev && dsAllowlist.includes(prev)) sel.value = prev;
    sel.disabled = !isDevPlayConnected() || dsCalling;
    updateFarmAvailability();
  }

  async function runDsCall() {
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    const path = String($("ds-path-select")?.value || "").trim();
    if (!path) {
      showErrorModal("เลือกคำสั่งก่อนส่ง", "ยังไม่ได้เลือก");
      return;
    }
    let bodyObj = {};
    const raw = String($("ds-body")?.value || "").trim() || "{}";
    try {
      bodyObj = JSON.parse(raw);
      if (!bodyObj || typeof bodyObj !== "object" || Array.isArray(bodyObj)) {
        throw new Error("body must be object");
      }
    } catch (_) {
      showErrorModal("JSON body ไม่ถูกต้อง", "รูปแบบผิด");
      return;
    }
    dsCalling = true;
    updateFarmAvailability();
    const out = $("ds-result");
    if (out) out.textContent = "กำลังส่ง…";
    try {
      const data = await api("/api/farm/ds/call", {
        method: "POST",
        body: JSON.stringify({
          devplay_session_id: devplaySession.id,
          path,
          body: bodyObj,
        }),
      });
      if (out) out.textContent = JSON.stringify(data, null, 2);
      setFarmStatus(data?.ok ? "ส่งคำสั่งสำเร็จ" : "คำสั่งตอบกลับพร้อมข้อผิดพลาด", data?.ok ? "ok" : "warn");
    } catch (e) {
      const msg = thError(e.message || e.data?.detail) || "ส่งคำสั่งไม่สำเร็จ";
      if (out) out.textContent = msg;
      showErrorModal(msg, "ทดสอบเกม");
    } finally {
      dsCalling = false;
      updateFarmAvailability();
    }
  }

  /* ---------- Heart farm ---------- */
  function clampHeartTarget(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), HEART_MAX);
  }

  function paintHeartStepper() {
    const input = $("heart-target");
    const hint = $("heart-max-hint");
    const minus = $("heart-minus");
    const plus = $("heart-plus");
    heartTarget = clampHeartTarget(heartTarget);
    const editing = input && document.activeElement === input;
    if (input && !editing) input.value = String(heartTarget);
    if (hint) {
      if (!hasDevPlayCreds()) {
        hint.textContent = "กรอกอีเมล/รหัสผ่านบัญชีเกมก่อน";
      } else if (!hasUsableHeartProxy()) {
        hint.textContent = "ใส่ rotating proxy ก่อนรัน";
      } else {
        hint.textContent =
          "ใส่ได้ 1–" + formatNumTh(HEART_MAX);
      }
    }
    const canStep = !isModeActivelyRunning("heart") && !devplayConnecting && hasDevPlayCreds() && hasUsableHeartProxy();
    if (input) input.disabled = !canStep;
    if (minus) minus.disabled = !canStep || heartTarget <= 1;
    if (plus) plus.disabled = !canStep || heartTarget >= HEART_MAX;
  }

  function commitHeartTargetFromInput() {
    const input = $("heart-target");
    if (!input) return;
    heartTarget = clampHeartTarget(input.value);
    input.value = String(heartTarget);
    paintHeartStepper();
    updateFarmAvailability();
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
    const heartSub = $("heart-btn-sub");
    const upgradeBtn = $("upgrade-btn");
    const upgradeSub = $("upgrade-btn-sub");
    const upgradeRng = $("upgrade-rng-accept");
    const upgradeReload = $("upgrade-reload-btn");
    const cookieBtn = $("cookie-btn");
    const cookieSub = $("cookie-btn-sub");
    const cookieReload = $("cookie-reload-btn");
    const cookieSelectAll = $("cookie-select-all-btn");
    const rerollBtn = $("reroll-btn");
    const rerollSub = $("reroll-btn-sub");
    const questReload = $("quest-reload-btn");
    const questClaimBtn = $("quest-claim-btn");
    const questClaimSub = $("quest-claim-btn-sub");
    const accountReload = $("account-reload-btn");
    const dsCallBtn = $("ds-call-btn");
    const dsCallSub = $("ds-call-btn-sub");
    const dsPathSelect = $("ds-path-select");
    const empty = !hasFarmAccess();
    const credsReady = hasDevPlayCreds();
    const connected = isDevPlayConnected();
    const connecting = devplayConnecting;
    const partyRunning = isModeActivelyRunning("partyrun");
    const powderRunning = isModeActivelyRunning("powder");
    const giftdrawRunning = isModeActivelyRunning("giftdraw");
    const heartRunning = isModeActivelyRunning("heart");
    const upgradeRunning = isModeActivelyRunning("upgrade");
    const cookieRunning = isModeActivelyRunning("cookie_unlock");
    const rerollRunning = isModeActivelyRunning("reroll");
    const questRunning = isModeActivelyRunning("quest_claim");
    const isPowder = farmTab === "powder";
    const isGiftDraw = farmTab === "giftdraw";
    const isHeart = farmTab === "heart";
    const isCookie = farmTab === "cookie";
    const disableOtherRun = () => {
      if (btn) btn.disabled = true;
      if (powderBtn) powderBtn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
      if (rerollBtn && farmTab !== "reroll") rerollBtn.disabled = true;
      if (questClaimBtn && farmTab !== "quest") questClaimBtn.disabled = true;
      if (dsCallBtn && farmTab !== "dstool") dsCallBtn.disabled = true;
    };

    if (connectBtn) {
      connectBtn.disabled = connecting || !credsReady || connected;
    }
    const noTickets =
      farmTab === "partyrun" &&
      connected &&
      devplaySession?.tickets != null &&
      Number(devplaySession.tickets) <= 0;

    const applyRunBtn = (el, subEl, running, baseDisabled, idleSubText) => {
      if (!el) return;
      setBtnLoading(el, !!running);
      if (running) {
        el.disabled = true;
        if (subEl) subEl.textContent = "กำลังรัน…";
        return;
      }
      el.disabled = baseDisabled;
      if (subEl && idleSubText != null) subEl.textContent = idleSubText;
    };

    if (isHeart) {
      const heartOffline = heartServiceStatus && !isHeartServiceEnabled();
      const needProxy = !hasUsableHeartProxy();
      let heartIdleSub = "ขอ " + formatNumTh(heartTarget) + " หัวใจ";
      if (heartOffline) heartIdleSub = "ฟาร์มหัวใจยังไม่เปิด";
      else if (!credsReady) heartIdleSub = "กรอกบัญชีเกมก่อน";
      else if (needProxy) heartIdleSub = "ใส่ proxy ของคุณก่อน";
      applyRunBtn(
        heartBtn,
        heartSub,
        heartRunning,
        empty || !credsReady || connecting || heartOffline || needProxy,
        heartIdleSub
      );
      if (btn) btn.disabled = true;
      if (powderBtn) powderBtn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
      paintHeartProxyHint();
      paintHeartStepper();
    } else if (isGiftDraw) {
      const noBoxes = Number(giftdrawEstimate?.available_boxes || 0) <= 0;
      let gdSub = "เปิด " + formatNumTh(giftdrawCount) + " กล่อง";
      if (!connected) gdSub = "เชื่อม DevPlay ก่อน";
      else if (giftdrawEstimateLoading) gdSub = "กำลังนับกล่อง…";
      else if (noBoxes) gdSub = "ไม่มีกล่องขวัญ";
      applyRunBtn(
        giftdrawBtn,
        giftdrawSub,
        giftdrawRunning,
        empty || !connected || connecting || giftdrawEstimateLoading || noBoxes,
        gdSub
      );
      if (btn) btn.disabled = true;
      if (powderBtn) powderBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
    } else if (farmTab === "upgrade") {
      const selected = getSelectedUpgradeItems();
      const needTokens = selected.length;
      const blocked =
        !connected ||
        upgradeEstimateLoading ||
        !selected.length ||
        !upgradeRngAccepted;
      let upSub = formatNumTh(needTokens) + " ชิ้น · รันทีละชิ้น";
      if (!connected) upSub = "เชื่อม DevPlay ก่อน";
      else if (!selected.length) upSub = "เลือกสมบัติก่อน";
      else if (!upgradeRngAccepted) upSub = "ยอมรับความเสี่ยง RNG ก่อน";
      else if (upgradeEstimateLoading) upSub = "กำลังคำนวณ…";
      applyRunBtn(
        upgradeBtn,
        upgradeSub,
        upgradeRunning,
        empty || connecting || blocked,
        upSub
      );
      if (btn) btn.disabled = true;
      if (powderBtn) powderBtn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
      // Allow picking next upgrade job while another mode runs.
      const canPick = connected && !connecting && !upgradeRunning;
      if (upgradeRng) upgradeRng.disabled = !canPick;
      paintUpgradeTargetLevel();
      if (upgradeReload) upgradeReload.disabled = !canPick;
      document.querySelectorAll("#upgrade-mode-row .upgrade-mode-btn").forEach((b) => {
        b.disabled = !canPick;
      });
      paintUpgradeEstimate();
    } else if (isCookie) {
      const selected = getSelectedCookieItems();
      const needTokens = selected.length;
      const cost = selected.reduce((s, c) => s + Number(c.coin_cost || 0), 0);
      const blocked =
        !connected ||
        cookieListLoading ||
        !selected.length ||
        cost > cookieCoin;
      let ckSub = formatNumTh(needTokens) + " ตัว · รันทีละตัว";
      if (!connected) ckSub = "เชื่อม DevPlay ก่อน";
      else if (cookieListLoading) ckSub = "กำลังโหลด…";
      else if (!selected.length) ckSub = "เลือกคุกกี้ก่อน";
      else if (cost > cookieCoin) ckSub = "เหรียญในไอดีไม่พอ";
      applyRunBtn(
        cookieBtn,
        cookieSub,
        cookieRunning,
        empty || connecting || blocked,
        ckSub
      );
      if (btn) btn.disabled = true;
      if (powderBtn) powderBtn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      const canPick = connected && !connecting && !cookieRunning;
      if (cookieReload) cookieReload.disabled = !canPick;
      if (cookieSelectAll) {
        cookieSelectAll.disabled = !canPick || !cookieItems.some((c) => c.can_buy);
      }
      paintCookieEstimate();
    } else if (isPowder) {
      const powderBlocked =
        !connected || powderEstimateLoading || !powderEstimate?.can_run;
      let pwSub = "เป้า 100,000 ผง";
      if (!connected) pwSub = "เชื่อม DevPlay ก่อน";
      else if (powderEstimateLoading) pwSub = "กำลังคำนวณ…";
      else if (!powderEstimate?.can_run) pwSub = "เหรียญไม่พอ";
      else if (powderEstimate?.capped) {
        pwSub =
          "เป้า " + formatNumTh(powderEstimate.target_powder) + " ผง (จำกัดเหรียญ)";
      }
      applyRunBtn(
        powderBtn,
        powderSub,
        powderRunning,
        empty || !connected || connecting || powderBlocked,
        pwSub
      );
      if (btn) btn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
      paintPowderStepper();
      paintPowderExamEstimate();
      const pickBtn = $("powder-pick-btn");
      if (pickBtn) pickBtn.disabled = connecting || powderRunning;
    } else if (farmTab === "partyrun") {
      let prSub = "รัน " + ticketCount + " ตั๋ว";
      if (!connected) prSub = "เชื่อม DevPlay ก่อน";
      else if (noTickets) prSub = "ไม่มีตั๋ว Party Run";
      applyRunBtn(
        btn,
        sub,
        partyRunning,
        empty || !connected || connecting || noTickets,
        prSub
      );
      if (powderBtn) powderBtn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
    } else if (farmTab === "reroll") {
      let rrSub =
        rerollMode === "guest"
          ? "รีโรล " + formatNumTh(rerollCount) + " ไอดี"
          : "รีโรลจากรายการบัญชี";
      if (!connected) rrSub = "เชื่อม DevPlay ก่อน";
      applyRunBtn(
        rerollBtn,
        rerollSub,
        rerollRunning,
        empty || !connected || connecting,
        rrSub
      );
      disableOtherRun();
      paintRerollStepper();
      document.querySelectorAll("#reroll-mode-row .upgrade-mode-btn").forEach((b) => {
        b.disabled = !connected || connecting || rerollRunning;
      });
      const acctTa = $("reroll-accounts");
      if (acctTa) acctTa.disabled = !connected || connecting || rerollRunning;
      const countInput = $("reroll-count");
      if (countInput) countInput.disabled = !connected || connecting || rerollRunning;
    } else if (farmTab === "quest") {
      const selectedN = questSelected.size;
      let qSub = selectedN ? "รับ " + formatNumTh(selectedN) + " เควส" : "เลือกเควสที่รับได้";
      if (!connected) qSub = "เชื่อม DevPlay ก่อน";
      else if (questLoading) qSub = "กำลังโหลด…";
      applyRunBtn(
        questClaimBtn,
        questClaimSub,
        questRunning,
        empty || !connected || connecting || questLoading || !selectedN,
        qSub
      );
      disableOtherRun();
      if (questReload) questReload.disabled = !connected || connecting || questLoading || questRunning;
    } else if (farmTab === "account") {
      disableOtherRun();
      if (accountReload) {
        accountReload.disabled = !connected || connecting || accountLoading;
        accountReload.textContent = accountLoading ? "กำลังโหลด…" : "โหลดข้อมูลไอดี";
      }
    } else if (farmTab === "dstool") {
      const path = String(dsPathSelect?.value || "").trim();
      let dsSub = path ? "พร้อมส่ง" : "เลือกคำสั่งก่อน";
      if (!connected) dsSub = "เชื่อม DevPlay ก่อน";
      else if (dsCalling) dsSub = "กำลังส่ง…";
      applyRunBtn(
        dsCallBtn,
        dsCallSub,
        dsCalling,
        !connected || connecting || dsCalling || !path,
        dsSub
      );
      disableOtherRun();
      if (dsPathSelect) dsPathSelect.disabled = !connected || connecting || dsCalling;
    } else {
      // devplay / other tabs — keep run CTAs inert
      disableOtherRun();
    }

    // Lock partyrun score/coin/exp only while partyrun itself is running (or connecting).
    setFarmInputsLocked(empty || !connected || connecting || partyRunning);
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
      !document.body.classList.contains("tutorial-open") &&
      !document.body.classList.contains("menu-open")
    ) {
      document.documentElement.style.removeProperty("--scrollbar-compensation");
    }
  }

  function setTopupExpanded(expanded) {
    const val = expanded ? "true" : "false";
    $("menu-nav-topup")?.setAttribute("aria-expanded", val);
  }

  let topbarMenuOpen = false;

  function isCompactNav() {
    return window.matchMedia("(max-width: 860px)").matches;
  }

  function closeNavDrawer() {
    if (isCompactNav()) setFarmSidebarOpen(false);
    topbarMenuOpen = false;
    const toggle = $("topbar-menu-toggle");
    toggle?.setAttribute("aria-expanded", "false");
    unlockBodyScroll("menu-open");
  }

  function openTopbarMenu() {
    setFarmSidebarOpen(true);
    topbarMenuOpen = true;
    $("topbar-menu-toggle")?.setAttribute("aria-expanded", "true");
    if (isCompactNav()) lockBodyScroll("menu-open");
  }

  function closeTopbarMenu() {
    closeNavDrawer();
  }

  function openVaultModal(opts = {}) {
    const root = $("vault-modal");
    if (!root) return;
    closeTopbarMenu();
    vaultOpen = true;
    animateOpen(root);
    lockBodyScroll("vault-open");
    setTopupExpanded(true);
    paintPassStatus();
    syncVaultDoorCopy();
    const sheet = root.querySelector(".vault-modal-sheet") || root;
    trapFocus(sheet);
    if (opts.focusVoucher) {
      const voucher = $("topup-voucher");
      if (voucher) setTimeout(() => voucher.focus(), 220);
    }
  }

  function closeVaultModal() {
    const root = $("vault-modal");
    if (!root) return;
    vaultOpen = false;
    unlockBodyScroll("vault-open");
    setTopupExpanded(false);
    syncVaultDoorCopy();
    releaseFocusTrap();
    animateClose(root);
  }

  function rentalDaysRemaining() {
    if (!profile || isRentalPermanent(profile)) return null;
    const exp = profile.rental_expires_at ? Date.parse(profile.rental_expires_at) : NaN;
    if (!Number.isFinite(exp) || exp <= Date.now()) return 0;
    return Math.max(1, Math.ceil((exp - Date.now()) / 86400000));
  }

  function paintPassStatus() {
    const label = $("pass-status-label");
    const detail = $("pass-status-detail");
    const root = $("pass-status");
    if (!label) return;
    if (!profile) {
      label.textContent = "—";
      if (detail) detail.textContent = "";
      root?.classList.remove("is-active", "is-expired");
      return;
    }
    if (isRentalPermanent(profile)) {
      label.textContent = "สิทธิ์ถาวร";
      if (detail) detail.textContent = "ใช้งานได้ไม่จำกัด";
      root?.classList.add("is-active");
      root?.classList.remove("is-expired");
      return;
    }
    const daysLeft = rentalDaysRemaining();
    if (hasFarmAccess()) {
      label.textContent = "ใช้งานได้";
      const parts = [];
      if (daysLeft != null) parts.push("เหลือประมาณ " + formatNumTh(daysLeft) + " วัน");
      parts.push("หมด " + rentalStatusLabel());
      if (detail) detail.textContent = parts.join(" · ");
      root?.classList.add("is-active");
      root?.classList.remove("is-expired");
    } else {
      label.textContent = "หมดอายุแล้ว";
      if (detail) detail.textContent = "เลือกแพ็กด้านล่างเพื่อต่ออายุ";
      root?.classList.add("is-expired");
      root?.classList.remove("is-active");
    }
  }

  function syncVaultDoorCopy() {
    paintPassStatus();
  }

  function syncTopupPanel(opts = {}) {
    if (opts.forceOpen) {
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
    const sheet = root.querySelector(".wallet-tutorial-sheet") || root;
    trapFocus(sheet);
  }

  function closeWalletTutorial() {
    const root = $("wallet-tutorial");
    if (!root) return;
    unlockBodyScroll("tutorial-open");
    releaseFocusTrap();
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
      el.textContent = hasFarmAccess()
        ? "ใช้ได้ทุก 3 นาที"
        : "ต้องมีสิทธิ์เช่าถึงจะดูสถานะได้";
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
      '<p class="queue-note" style="margin-top:12px">กรอกคะแนน/เหรียญ/XP แล้วกดฟาร์มได้ตามปกติ</p>';

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

  function parseFarmJobResult(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  function farmHistoryRowSummary(row) {
    const res = parseFarmJobResult(row.result);
    const mode = res.mode || row.job_kind || "";
    if (mode === "powder") {
      return (
        "ผง +" +
        escapeHtml(formatNumTh(res.powder_gained || 0)) +
        " · " +
        escapeHtml(res.treasure || "Powder") +
        " · " +
        escapeHtml(formatNumTh(res.rounds || 0)) +
        " รอบ"
      );
    }
    if (mode === "giftdraw") {
      return (
        "กล่องขวัญ " +
        escapeHtml(formatNumTh(res.draws_ok || 0)) +
        "/" +
        escapeHtml(formatNumTh(res.requested || 0)) +
        " กล่อง"
      );
    }
    if (mode === "heart") {
      return (
        "หัวใจ +" +
        escapeHtml(formatNumTh(res.hearts || 0)) +
        " / ขอ " +
        escapeHtml(formatNumTh(res.target || 0))
      );
    }
    if (mode === "upgrade") {
      return "ตีบวกสมบัติ · " + escapeHtml(formatNumTh(res.items || res.count || 0)) + " ชิ้น";
    }
    if (mode === "cookie") {
      return "ซื้อคุกกี้ · " + escapeHtml(formatNumTh(res.items || res.count || 0)) + " ตัว";
    }
    if (mode === "reroll") {
      const n = res.accounts?.length || res.count || res.results?.length || row.ticket_count || 0;
      return "รีโรล · " + escapeHtml(formatNumTh(n)) + " บัญชี";
    }
    if (mode === "quest_claim" || mode === "quest") {
      return (
        "รับเควส · " +
        escapeHtml(formatNumTh(res.claimed || res.results?.filter?.((r) => r.ok)?.length || 0)) +
        " รายการ"
      );
    }
    if (mode === "partyrun" || row.ticket_count) {
      return (
        "Party Run · " +
        escapeHtml(formatNumTh(row.ticket_count || res.tickets || 0)) +
        " ตั๋ว · S " +
        escapeHtml(formatNumTh(row.score)) +
        " · C " +
        escapeHtml(formatNumTh(row.coin))
      );
    }
    return (
      "S " +
      escapeHtml(formatNumTh(row.score)) +
      " · C " +
      escapeHtml(formatNumTh(row.coin)) +
      " · XP " +
      escapeHtml(formatNumTh(row.exp))
    );
  }

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
        const summary = farmHistoryRowSummary(row);
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
  }

  async function showFarmHistoryModal() {
    clearModalActions();
    openModal({
      mode: "farm-history",
      title: "ประวัติฟาร์มล่าสุด",
      bodyHtml: '<p class="muted">กำลังโหลดประวัติ…</p>',
      icon: "assets/tr_event_116.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ปิด", "btn-candy", () => forceCloseModal())
    );

    if (!accessToken) {
      modalBody.innerHTML = '<p class="muted">เข้าสู่ระบบเว็บก่อนดูประวัติ</p>';
      return;
    }

    try {
      const data = await api("/api/farm/history");
      renderFarmHistory(data.items || []);
      modalBody.innerHTML = farmHistoryListHtml(farmHistoryItems);
    } catch (e) {
      modalBody.innerHTML =
        '<p class="status err">' +
        escapeHtml(thError(e.message) || "โหลดประวัติไม่สำเร็จ") +
        "</p>";
    }
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

  function isStaleTopupPackages(list) {
    if (!Array.isArray(list) || !list.length) return true;
    const daySet = list.map((p) => packageDays(p)).sort((a, b) => a - b);
    if (daySet.join(",") === "1,7,30") return true;
    const oneDay = list.find((p) => packageDays(p) === 1);
    return !!(oneDay && Number(oneDay.price_baht) === 50);
  }

  function fallbackTopupPackages() {
    return [
      { days: 1, package_days: 1, price_baht: 200, per_day_baht: 200 },
      {
        days: 3,
        package_days: 3,
        price_baht: 500,
        per_day_baht: 167,
        save_baht: 100,
        promo: true,
      },
      {
        days: 7,
        package_days: 7,
        price_baht: 990,
        per_day_baht: 141,
        save_baht: 410,
        promo: true,
      },
    ];
  }

  function enrichTopupPackage(pkg) {
    const days = packageDays(pkg);
    const price = Number(pkg.price_baht) || 0;
    const baseline = 200;
    const save =
      pkg.save_baht != null
        ? Number(pkg.save_baht)
        : Math.max(0, baseline * days - price);
    const perDay =
      pkg.per_day_baht != null
        ? Number(pkg.per_day_baht)
        : days
          ? Math.round(price / days)
          : 0;
    return {
      ...pkg,
      days,
      package_days: days,
      tokens: days,
      price_baht: price,
      per_day_baht: perDay,
      save_baht: save,
      promo: !!(save > 0 || pkg.promo),
    };
  }

  function packageDays(pkg) {
    return Number(pkg?.days ?? pkg?.package_days ?? pkg?.tokens ?? 0);
  }

  function getTopupPackage(days) {
    const list = topupPackages.length ? topupPackages : fallbackTopupPackages();
    const d = Number(days);
    return list.find((p) => packageDays(p) === d) || list[0] || null;
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
      formatNumTh(pkg.price_baht) + "฿ · " + packageDays(pkg) + " วัน";
    if (pkg.save_baht > 0) {
      text += " · คุ้ม " + formatNumTh(pkg.save_baht) + "฿";
    }
    el.textContent = text;
    if (stepAmt) stepAmt.textContent = formatNumTh(pkg.price_baht) + "฿";
  }

  function flashTopupDoor() {
    const door = $("menu-nav-topup");
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
      showToast("คัดลอกราคา " + text + "฿ แล้ว", "ok");
    } catch (_) {
      setStatus($("topup-status"), "คัดลอกไม่สำเร็จ — จำราคา " + text + "฿", "err");
      showToast("คัดลอกไม่สำเร็จ — จำราคา " + text + "฿", "err");
    }
  }

  function renderTopupPackages() {
    const root = $("topup-packages");
    if (!root) return;
    root.innerHTML = "";
    const list = (topupPackages.length ? topupPackages : fallbackTopupPackages()).map(
      enrichTopupPackage
    );
    list.forEach((pkg) => {
      const days = packageDays(pkg);
      const selected = days === selectedTopupTokens;
      const featured = days === 7;
      const perDay = Number(pkg.per_day_baht) || 0;
      const save = Number(pkg.save_baht) || 0;
      const savePct =
        save > 0 && days > 0 ? Math.round((save / (200 * days)) * 100) : 0;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "pass-card" +
        (selected ? " is-selected" : "") +
        (featured ? " is-featured" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      let html = "";
      if (featured) {
        html += '<span class="pass-card-badge">คุ้ม</span>';
      }
      html +=
        '<span class="pass-card-days">' +
        escapeHtml(days) +
        "</span>" +
        '<span class="pass-card-unit">' +
        (days === 7 ? "วัน · 1 สัปดาห์" : "วัน") +
        "</span>" +
        '<span class="pass-card-price">' +
        escapeHtml(formatNumTh(pkg.price_baht)) +
        "฿</span>";
      if (perDay > 0) {
        html +=
          '<span class="pass-card-perday">~' +
          escapeHtml(formatNumTh(perDay)) +
          " ฿/วัน</span>";
      }
      if (save > 0) {
        html +=
          '<span class="pass-card-save">ประหยัด ' +
          escapeHtml(formatNumTh(save)) +
          " ฿" +
          (savePct >= 5 ? " (~" + savePct + "%)" : "") +
          "</span>";
      }
      btn.innerHTML = html;
      btn.addEventListener("click", () => {
        selectedTopupTokens = days;
        renderTopupPackages();
      });
      root.appendChild(btn);
    });
    paintTopupSelected();
  }

  async function loadTopupPackages() {
    try {
      const data = await api("/api/topup/packages");
      topupPackages = (Array.isArray(data.packages) ? data.packages : []).map((p) =>
        enrichTopupPackage({
          ...p,
          days: p.days ?? p.package_days,
        })
      );
      if (isStaleTopupPackages(topupPackages)) {
        topupPackages = fallbackTopupPackages();
      }
    } catch (_) {
      topupPackages = fallbackTopupPackages();
    }
    if (!topupPackages.some((p) => packageDays(p) === selectedTopupTokens)) {
      selectedTopupTokens = topupPackages.some((p) => packageDays(p) === 7)
        ? 7
        : packageDays(topupPackages[0]) || 1;
    }
    renderTopupPackages();
  }

  function showTopupSuccessModal(data) {
    const days = data.days_credited ?? data.package_days ?? data.package_tokens ?? "—";
    const rows = [
      ["แพ็ก", escapeHtml(days) + " วัน"],
      ["ยอดที่รับ", escapeHtml(formatNumTh(data.amount_baht)) + "฿"],
      ["เช่าถึง", escapeHtml(formatRentalExpiry(data.rental_expires_at))],
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
      title: "ต่ออายุเช่าสำเร็จ",
      bodyHtml: html,
      icon: "assets/reward_icon_partyrun_ticket.png",
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
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        if (raw.gate) err.gate = raw.gate;
        if (typeof raw.message === "string" && raw.message.trim()) {
          err.userMessage = raw.message.trim();
        }
        if (typeof raw.code === "string" && raw.code.trim()) {
          err.code = raw.code.trim();
        }
        if (raw.game_code != null) err.gameCode = raw.game_code;
      }
      throw err;
    }
    return data;
  }

  function showApp() {
    loginView.classList.add("hidden");
    userView.classList.remove("hidden");
    $("logout-btn-menu")?.classList.remove("hidden");
    $("topbar-actions-compact")?.classList.remove("hidden");
    $("topbar-menu-user")?.classList.remove("hidden");
    restorePeekCooldown();
    paintDevPlayHub();
    updateFarmAvailability();
    refreshGateAndQueueUi().catch(() => {});
    refreshFarmActivity().catch(() => {});
    startActivityPoll();
    showFarmDock();
    renderFarmDock();
    loadFarmHistory().catch(() => {});
    loadHeartServiceStatus().catch(() => {});
    resumeFarmSession().catch(() => {});
  }

  function showLogin() {
    stopBalancePoll();
    stopQueuePoll();
    stopActivityPoll();
    stopWatchJobPoll();
    clearQueuedRun();
    forceCloseModal();
    forceCloseRunStatusPopup();
    hideFarmDock();
    farmActivityData = null;
    farmDockFlash = { text: "", kind: "muted" };
    closeTopbarMenu();
    loginView.classList.remove("hidden");
    userView.classList.add("hidden");
    $("logout-btn-menu")?.classList.add("hidden");
    $("topbar-actions-compact")?.classList.add("hidden");
    $("topbar-menu-user")?.classList.add("hidden");
  }

  function paintProfile() {
    const menuWho = $("menu-who-user");
    const menuRental = $("menu-rental-label");
    const whoName = profile?.username || profile?.display_name || "—";
    if (menuWho) menuWho.textContent = whoName;
    const rental = sidebarRentalMeta();
    if (menuRental) {
      menuRental.textContent = rental.text;
      menuRental.className = "account-card-rental" + (rental.kind ? " " + rental.kind : "");
    }
    paintPassStatus();
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
      runningSub: "กำลังวิ่ง… ใช้งานหน้าอื่นได้ระหว่างรอ",
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
      runningSub: "กำลังเปิดกล่องขวัญ… ใช้งานหน้าอื่นได้ระหว่างรอ",
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
      runningSub: "กำลังฟาร์มหัวใจ… ใช้งานหน้าอื่นได้ระหว่างรอ",
      heroIcon: "assets/bbc_stat_iconHeart.png",
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
      runningSub: "กำลังฟาร์มผง… ใช้งานหน้าอื่นได้ระหว่างรอ",
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
      runningSub: "กำลังตีบวก… ใช้งานหน้าอื่นได้ระหว่างรอ",
      heroIcon: "assets/tr_ga170.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "upgrade", label: "ตีบวกสมบัติ" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "เสร็จแล้ว " + formatNumTh(current) + "/" + formatNumTh(total) + " ชิ้น";
        return "กำลังตีบวกสมบัติ…";
      },
    },
    cookie_unlock: {
      title: "สถานะปลดล็อกคุกกี้",
      runningSub: "กำลังปลดล็อก… ใช้งานหน้าอื่นได้ระหว่างรอ",
      heroIcon: "assets/crc_cookie_stone_box.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "unlock", label: "ปลดล็อกคุกกี้" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "เสร็จแล้ว " + formatNumTh(current) + "/" + formatNumTh(total) + " ตัว";
        return "กำลังปลดล็อกคุกกี้…";
      },
    },
    reroll: {
      title: "สถานะรีโรล",
      runningSub: "กำลังรีโรล… ใช้งานหน้าอื่นได้ระหว่างรอ",
      heroIcon: "assets/gem.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "draw", label: "สุ่มของ" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "บัญชี " + formatNumTh(current) + "/" + formatNumTh(total);
        return "กำลังรีโรล…";
      },
    },
    quest_claim: {
      title: "สถานะรับรางวัลเควส",
      runningSub: "กำลังรับรางวัลเควส…",
      heroIcon: "assets/icon_giftpoint.png",
      steps: [
        { id: "login", label: "เข้าสู่ระบบเกม" },
        { id: "claim", label: "รับรางวัล" },
        { id: "done", label: "สรุปผล" },
      ],
      progressText(current, total) {
        if (total > 0) return "รับแล้ว " + formatNumTh(current) + "/" + formatNumTh(total);
        return "กำลังรับรางวัลเควส…";
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
      if (friendly) {
        if (typeof friendly === "string") out.lines.push({ text: friendly, kind: "ok" });
        else out.lines.push(friendly);
      }

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
        let line = s;
        let m = s.match(/^\[(\d+)\/(\d+)\]\s+(.+?)\s+—\s+(.+)$/);
        if (m) {
          out.total = Number(m[2]);
          out.phase = "items";
          out.stepIdx = 1;
          if (statusContext) {
            statusContext.itemIndex = Number(m[1]);
            statusContext.itemTotal = Number(m[2]);
            statusContext.itemName = m[3].trim();
          }
          line = m[4];
        }
        m = line.match(/upgrade batch:\s*item\s+(\d+)\/(\d+)\s+—\s+(.+)/i);
        if (m) {
          out.current = Math.max(0, Number(m[1]) - 1);
          out.total = Number(m[2]);
          out.phase = "items";
          out.stepIdx = 1;
          if (statusContext) {
            statusContext.itemIndex = Number(m[1]);
            statusContext.itemTotal = Number(m[2]);
            statusContext.itemName = m[3].trim();
            statusContext.itemsCompleted = Math.max(0, Number(m[1]) - 1);
          }
        }
        if (/upgrade:\s*done\s+/i.test(line)) {
          out.stepIdx = Math.max(out.stepIdx, 1);
          const doneCount = lines.filter((l) => /upgrade:\s*done\s+/i.test(String(l))).length;
          if (doneCount > 0) {
            out.current = doneCount;
            out.phase = "items";
            if (statusContext) statusContext.itemsCompleted = doneCount;
          }
        }
        if (/upgrade:\s*refresh|initMember/i.test(line)) out.stepIdx = Math.max(out.stepIdx, 0);
      } else if (mode === "cookie_unlock") {
        let m = s.match(/cookie-unlock batch:\s*item\s+(\d+)\/(\d+)\s+—\s+(.+)/i);
        if (m) {
          out.current = Math.max(0, Number(m[1]) - 1);
          out.total = Number(m[2]);
          out.phase = "items";
          out.stepIdx = 1;
          if (statusContext) {
            statusContext.itemIndex = Number(m[1]);
            statusContext.itemTotal = Number(m[2]);
            statusContext.itemName = m[3].trim();
            statusContext.itemsCompleted = Math.max(0, Number(m[1]) - 1);
          }
        }
        if (/cookie-unlock:\s*done\s+/i.test(s)) {
          out.stepIdx = Math.max(out.stepIdx, 1);
          const doneCount = lines.filter((l) => /cookie-unlock:\s*done\s+/i.test(String(l))).length;
          if (doneCount > 0) {
            out.current = doneCount;
            out.phase = "items";
            if (statusContext) statusContext.itemsCompleted = doneCount;
          }
        }
        if (/cookie-unlock:\s*refresh|initMember|prepare/i.test(s)) {
          out.stepIdx = Math.max(out.stepIdx, 0);
        }
      } else if (mode === "reroll") {
        let m = s.match(/reroll(?:\s+guest)?\s*\[(\d+)\/(\d+)\]/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "draw";
          out.stepIdx = 1;
        }
        if (/create_guest|login|reroll:/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 0);
      } else if (mode === "quest_claim") {
        let m = s.match(/quest:\s*claimed\s+(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "claim";
          out.stepIdx = 1;
        }
        if (/quest:\s*logging in/i.test(s)) out.stepIdx = 0;
      }
    }

    if (!out.total && targetHint) out.total = Number(targetHint) || 0;
    return out;
  }

  function formatLogLine(raw, mode) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/traceback|RpcError|Exception|at 0x/i.test(s)) return "";
    const translated = translateLog(s);
    if (translated && translated !== s) return truncateLogLine(translated, 160);
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
    if (mode === "upgrade") {
      let line = s;
      let prefix = "";
      let pm = s.match(/^\[(\d+)\/(\d+)\]\s+(.+?)\s+—\s+(.+)$/);
      if (pm) {
        prefix = "[" + pm[1] + "/" + pm[2] + "] " + truncateLogLine(pm[3], 40) + " — ";
        line = pm[4];
      }
      let m = line.match(/upgrade batch:\s*item\s+(\d+)\/(\d+)\s+—\s+(.+)/i);
      if (m) {
        const txt = "📦 ชิ้นที่ " + m[1] + "/" + m[2] + ": " + truncateLogLine(m[3], 80);
        return { text: prefix ? prefix + txt : txt, kind: "item" };
      }
      m = line.match(/upgrade batch:\s*FAST/i);
      if (m) return { text: "⚡ โหมด Fast — ตีบวกพร้อมกัน (เสี่ยง ID ถูกระงับ)", kind: "warn" };
      m = line.match(/upgrade\s+\[(\d+)\]\s+(.+?)\s+SUCCESS\s+→\s+\+(\d+)/i);
      if (m) {
        return { text: prefix + "ครั้งที่ " + m[1] + ": ✅ ติด → +" + m[3], kind: "ok" };
      }
      m = line.match(/upgrade\s+\[(\d+)\]\s+(.+?)\s+FAIL\s+stay\s+\+(\d+)/i);
      if (m) {
        return {
          text: prefix + "ครั้งที่ " + m[1] + ": ❌ แห้ว (คงที่ +" + m[3] + ")",
          kind: "err",
        };
      }
      m = line.match(/upgrade\s+\[(\d+)\]\s+(.+?)\s+\+(\d+)→\+(\d+)/i);
      if (m) {
        return { text: prefix + "ครั้งที่ " + m[1] + ": +" + m[3] + "→+" + m[4] + " …", kind: "warn" };
      }
      m = line.match(/upgrade:\s*done\s+(.+?)\s+\+(\d+)→\+(\d+)/i);
      if (m) {
        return {
          text: prefix + "สรุป " + truncateLogLine(m[1], 50) + ": +" + m[2] + "→+" + m[3],
          kind: "ok",
        };
      }
      if (/coin ไม่พอ/i.test(line)) return { text: prefix + truncateLogLine(line, 140), kind: "err" };
      if (/upgrade batch:\s*หยุด/i.test(line)) {
        return { text: prefix + truncateLogLine(line, 140), kind: "warn" };
      }
      if (/upgrade\s+\[/i.test(line)) return { text: prefix + truncateLogLine(line, 140), kind: "warn" };
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
    if (done) {
      dockOk = ok !== false;
      dockPhase = ok !== false ? "done" : "error";
    }
    renderFarmDock();
  }

  function setRunStatusTitle(mode) {
    if (statusContext) statusContext.mode = mode;
    renderFarmDock({ mode });
  }

  function dockPhaseLabel(phase) {
    if (phase === "queued") return "รอคิว";
    if (phase === "running") return "กำลังดำเนินการ";
    if (phase === "done") return "สำเร็จ";
    if (phase === "error") return "ล้มเหลว";
    if (phase === "idle") return "พร้อม";
    return "—";
  }

  function progressUnit(mode) {
    if (mode === "giftdraw") return "กล่อง";
    if (mode === "heart") return "ดวง";
    if (mode === "upgrade") return "ชิ้น";
    if (mode === "cookie_unlock") return "ตัว";
    if (mode === "powder") return "รอบ";
    if (mode === "reroll") return "บัญชี";
    if (mode === "quest_claim") return "เควส";
    return "รอบ";
  }

  function jobTitleForMode(mode) {
    if (mode === "giftdraw") return "เปิดกล่องขวัญ";
    if (mode === "partyrun") return "Party Run";
    if (mode === "heart") return "ปั๊มใจ";
    if (mode === "powder") return "ฟาร์มผง";
    if (mode === "upgrade") return "ตีบวกสมบัติ";
    if (mode === "cookie_unlock") return "ปลดล็อกคุกกี้";
    if (mode === "reroll") return "รีโรล";
    if (mode === "quest_claim") return "รับรางวัลเควส";
    return "ฟาร์ม";
  }

  function formatDockElapsed(sec) {
    const n = Math.max(0, Math.floor(Number(sec) || 0));
    if (n < 60) return n + " วิ";
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + " นาที " + s + " วิ";
  }

  function formatDockStartedAt(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "";
      const day = d.getDate();
      const months = [
        "ม.ค.",
        "ก.พ.",
        "มี.ค.",
        "เม.ย.",
        "พ.ค.",
        "มิ.ย.",
        "ก.ค.",
        "ส.ค.",
        "ก.ย.",
        "ต.ค.",
        "พ.ย.",
        "ธ.ค.",
      ];
      const month = months[d.getMonth()] || "";
      const year = d.getFullYear() + 543;
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return day + " " + month + " " + year + " · " + hh + ":" + mm;
    } catch (_) {
      return "";
    }
  }

  function stopDockElapsedTimer() {
    if (dockElapsedTimer) {
      clearInterval(dockElapsedTimer);
      dockElapsedTimer = null;
    }
  }

  function startDockElapsedTimer() {
    stopDockElapsedTimer();
    dockElapsedTimer = setInterval(() => {
      if (dockPhase !== "running" && dockPhase !== "queued") {
        stopDockElapsedTimer();
        return;
      }
      renderFarmDock();
    }, 1000);
  }

  function dockModeIcon(mode) {
    const cfg = modeConfig(mode);
    const hero = cfg.heroIcon || "assets/cookie_run.gif";
    return hero.replace(/^assets\//, "") || "cookie_run.gif";
  }

  function buildDockSnapshot(opts = {}) {
    const mode = opts.mode || pipelineState?.mode || statusContext?.mode || "partyrun";
    const cfg = modeConfig(mode);
    const phase = opts.phase || dockPhase || "idle";
    const ok = opts.ok !== undefined ? opts.ok : dockOk;

    const prog = pipelineState?.progress || {};
    let cur = Number(prog.current) || 0;
    let tot =
      Number(prog.total) ||
      Number(opts.target) ||
      Number(statusContext?.target) ||
      0;

    if (phase === "done" && ok !== false && tot > 0 && cur < tot) cur = tot;

    const pct =
      tot > 0
        ? Math.min(100, Math.round((cur / tot) * 100))
        : phase === "done" && ok !== false
          ? 100
          : 0;
    const unit = progressUnit(mode);
    const elapsedSec =
      dockJobStartedAt &&
      (phase === "running" || phase === "done" || phase === "error" || phase === "queued")
        ? Math.max(0, Math.floor((Date.now() - dockJobStartedAt) / 1000))
        : 0;
    const startedAtFormatted = formatDockStartedAt(dockJobStartedAt);
    const progressLabel = cfg.progressText(cur, tot);
    const jobTitle = jobTitleForMode(mode);
    const statusBadge = dockPhaseLabel(phase === "idle" ? "idle" : phase);
    const queue = Array.isArray(lastGate?.queue_items) ? lastGate.queue_items : [];

    let jobDetail = progressLabel;
    if (devplaySession?.nickname) {
      jobDetail = (jobDetail || jobTitle) + " · " + devplaySession.nickname;
    }
    if (phase === "error" && opts.errorMsg) jobDetail = opts.errorMsg;

    let statusLineText = statusBadge;
    if (phase === "running" && elapsedSec > 0) {
      statusLineText = "กำลังดำเนินการ · " + formatDockElapsed(elapsedSec);
    } else if (phase === "done" && ok !== false) {
      statusLineText = "สำเร็จแล้ว" + (elapsedSec > 0 ? " · " + formatDockElapsed(elapsedSec) : "");
    } else if (phase === "error") {
      statusLineText = "ล้มเหลว" + (elapsedSec > 0 ? " · " + formatDockElapsed(elapsedSec) : "");
    } else if (phase === "queued") {
      statusLineText = "รอคิว";
    }

    let timeLine = startedAtFormatted || "";
    if (startedAtFormatted && elapsedSec > 0 && phase === "running") {
      timeLine = startedAtFormatted + " · " + formatDockElapsed(elapsedSec);
    } else if (!startedAtFormatted && elapsedSec > 0) {
      timeLine = formatDockElapsed(elapsedSec);
    }

    const fractionText =
      tot > 0
        ? formatNumTh(cur) + " / " + formatNumTh(tot) + " " + unit
        : phase === "running"
          ? "กำลังเริ่ม…"
          : "—";

    let panelSub = "งานที่กำลังรันและประวัติล่าสุด";
    if (phase === "running") panelSub = cfg.runningSub || "กำลังฟาร์ม…";
    else if (phase === "queued") panelSub = "รอคิว — ถึงคิวแล้วจะเริ่มอัตโนมัติ";
    else if (phase === "done") panelSub = ok !== false ? "สำเร็จแล้ว" : "ไม่สำเร็จ";
    else if (phase === "error") panelSub = opts.errorMsg || "การฟาร์มล้มเหลว";
    else if (farmDockFlash.text) panelSub = farmDockFlash.text;

    return {
      phase,
      mode,
      ok,
      panelSub,
      progress: { current: cur, total: tot, pct },
      queue,
      jobTitle,
      jobDetail,
      timeLine,
      statusBadge,
      statusLineText,
      fractionText,
      unit,
      progressLabel,
      elapsedSec,
      showLive:
        phase === "running" ||
        phase === "done" ||
        phase === "error" ||
        phase === "queued",
    };
  }

  function historyRowToCard(row) {
    const kind = row.job_kind || "partyrun";
    const mode = jobKindToMode(kind);
    const st = row.status || "";
    const phase =
      st === "succeeded"
        ? "done"
        : st === "failed"
          ? "error"
          : st === "running"
            ? "running"
            : "idle";
    const badge =
      phase === "done"
        ? "สำเร็จ"
        : phase === "error"
          ? "ล้มเหลว"
          : phase === "running"
            ? "กำลังดำเนินการ"
            : "—";
    let detail = "";
    try {
      detail = farmHistoryRowSummary(row);
      const tmp = document.createElement("div");
      tmp.innerHTML = detail;
      detail = tmp.textContent || detail;
    } catch (_) {
      detail = JOB_KIND_TH[kind] || kind;
    }
    const when =
      formatDockStartedAt(row.finished_at || row.created_at) ||
      formatTopupDay(row.created_at) ||
      "";
    let elapsed = "";
    if (row.started_at && row.finished_at) {
      const ms = new Date(row.finished_at) - new Date(row.started_at);
      if (Number.isFinite(ms) && ms > 0) elapsed = "ใช้เวลา " + formatDockElapsed(ms / 1000);
    }
    return {
      mode,
      phase,
      title: jobTitleForMode(mode),
      badge,
      detail,
      timeLine: [when, elapsed].filter(Boolean).join(" · "),
      live: false,
      progress: null,
    };
  }

  function buildLiveCard(snap) {
    if (!snap.showLive) return null;
    return {
      mode: snap.mode,
      phase: snap.phase,
      title: snap.jobTitle,
      badge: snap.statusBadge,
      detail: snap.jobDetail,
      timeLine: snap.timeLine,
      live: true,
      statusLineText: snap.statusLineText,
      progress: {
        pct: snap.progress.pct,
        fraction: snap.fractionText,
        show: snap.progress.total > 0 || snap.phase === "running",
      },
    };
  }

  function pendingJobsToCards() {
    return pendingFarmJobs.map((j, i) => ({
      mode: j.mode,
      phase: "queued",
      title: typeof jobTitleForMode === "function" ? jobTitleForMode(j.mode) : j.mode,
      badge: "รอคิว",
      detail: j.label || ("คิว #" + (i + 1)),
      timeLine: "คิวส่วนตัว #" + (i + 1),
      live: false,
      pendingId: j.id,
      cancelable: true,
    }));
  }

  function renderTxCard(card) {
    const article = document.createElement("article");
    article.className = "farm-dock-tx";
    article.dataset.phase = card.phase || "idle";
    if (card.pendingId) article.dataset.pendingId = card.pendingId;
    const iconFile = dockModeIcon(card.mode);
    const dotClass =
      card.phase === "done"
        ? "is-ok"
        : card.phase === "error"
          ? "is-err"
          : card.phase === "running" || card.phase === "queued"
            ? "is-running"
            : "";
    let progressHtml = "";
    if (card.live && card.progress?.show !== false) {
      progressHtml =
        '<div class="farm-dock-tx-progress">' +
        '<div class="farm-dock-tx-progress-head">' +
        '<span class="farm-dock-tx-status-line">' +
        '<span class="farm-dock-tx-status-dot" aria-hidden="true"></span>' +
        "<span>" +
        escapeHtml(card.statusLineText || card.badge) +
        "</span></span>" +
        '<span class="farm-dock-tx-pct">' +
        escapeHtml(String(card.progress?.pct || 0)) +
        "%</span></div>" +
        '<div class="farm-dock-tx-track" aria-hidden="true">' +
        '<span class="farm-dock-tx-fill" style="width:' +
        Math.max(card.progress?.pct > 0 ? 3 : 0, card.progress?.pct || 0) +
        '%"></span></div>' +
        '<div class="farm-dock-tx-foot">' +
        escapeHtml(card.progress?.fraction || "—") +
        "</div></div>";
    }
    const cancelHtml = card.cancelable
      ? '<button type="button" class="farm-dock-tx-cancel" data-cancel-pending="' +
        escapeHtml(card.pendingId || "") +
        '" aria-label="ยกเลิกคิว">×</button>'
      : "";
    article.innerHTML =
      '<div class="farm-dock-tx-top">' +
      '<div class="farm-dock-tx-icon" aria-hidden="true">' +
      '<img src="assets/' +
      escapeHtml(iconFile) +
      '" alt="" width="26" height="26" decoding="async" />' +
      (dotClass ? '<span class="farm-dock-tx-icon-dot ' + dotClass + '"></span>' : "") +
      "</div>" +
      '<div class="farm-dock-tx-main">' +
      '<div class="farm-dock-tx-title-row">' +
      '<h3 class="farm-dock-tx-title">' +
      escapeHtml(card.title) +
      "</h3>" +
      '<span class="farm-dock-tx-badge" data-phase="' +
      escapeHtml(card.phase) +
      '">' +
      escapeHtml(card.badge) +
      "</span>" +
      cancelHtml +
      "</div>" +
      '<p class="farm-dock-tx-detail">' +
      escapeHtml(card.detail || "—") +
      "</p>" +
      (card.timeLine
        ? '<p class="farm-dock-tx-time">' + escapeHtml(card.timeLine) + "</p>"
        : "") +
      "</div></div>" +
      progressHtml;
    return article;
  }

  function renderFarmDock(opts = {}) {
    const snap = buildDockSnapshot(opts);
    showFarmDock();

    const panelSubEl = $("farm-dock-panel-sub");
    if (panelSubEl) panelSubEl.textContent = snap.panelSub;

    const flashSection = $("farm-dock-flash-section");
    const flashEl = $("farm-dock-flash");
    if (flashEl) {
      const flashText = farmDockFlash.text || "";
      const showFlash =
        !!flashText && (snap.phase === "idle" || snap.phase === "done" || snap.phase === "error");
      if (showFlash) {
        flashSection?.classList.remove("hidden");
        flashEl.textContent = flashText;
        flashEl.className = "farm-dock-flash " + (farmDockFlash.kind || "muted");
      } else {
        flashSection?.classList.add("hidden");
        flashEl.textContent = "";
      }
    }

    const liveCard = buildLiveCard(snap);
    const pendingCards = pendingJobsToCards();
    const historyCards = (Array.isArray(farmHistoryItems) ? farmHistoryItems : [])
      .filter((r) => r && r.status !== "running" && r.status !== "queued")
      .slice(0, 20)
      .map(historyRowToCard);

    const activeCount = (liveCard ? 1 : 0) + pendingCards.length;
    const allCount = activeCount + historyCards.length;
    const allCountEl = $("farm-dock-tab-all-count");
    const activeCountEl = $("farm-dock-tab-active-count");
    if (allCountEl) allCountEl.textContent = "(" + allCount + ")";
    if (activeCountEl) activeCountEl.textContent = "(" + activeCount + ")";

    document.querySelectorAll(".farm-dock-tab").forEach((btn) => {
      const tab = btn.getAttribute("data-dock-tab");
      const on = tab === dockHistoryTab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    const list = $("farm-dock-list");
    if (list) {
      list.replaceChildren();
      const showLive = dockHistoryTab === "all" || dockHistoryTab === "active";
      const showHistory = dockHistoryTab === "all";
      let painted = 0;
      if (showLive && liveCard) {
        list.appendChild(renderTxCard(liveCard));
        painted += 1;
      }
      if (showLive) {
        for (const card of pendingCards) {
          list.appendChild(renderTxCard(card));
          painted += 1;
        }
      }
      if (showHistory) {
        for (const card of historyCards) {
          list.appendChild(renderTxCard(card));
          painted += 1;
        }
      }
      if (!painted) {
        const empty = document.createElement("p");
        empty.className = "farm-dock-empty";
        empty.textContent =
          dockHistoryTab === "active"
            ? "ไม่มีงานที่กำลังดำเนินการ"
            : "ยังไม่มีประวัติการฟาร์ม";
        list.appendChild(empty);
      }
    }

    const queueSection = $("farm-dock-queue-section");
    const queueList = $("farm-dock-queue");
    const showQueue = snap.phase === "queued" && snap.queue.length > 0;
    if (queueList) {
      queueList.replaceChildren();
      if (showQueue) {
        queueSection?.classList.remove("hidden");
        for (const row of snap.queue) {
          const li = document.createElement("li");
          li.className = "farm-dock-queue-item";
          if (row.is_me) li.classList.add("is-me");
          if (row.status === "running") li.classList.add("is-running");
          const kind = row.job_kind ? JOB_KIND_TH[row.job_kind] || row.job_kind : "รอเริ่ม";
          const badge =
            row.status === "running" ? "กำลังรัน" : row.is_me ? "คิวของคุณ" : "รอคิว";
          li.innerHTML =
            '<span class="farm-dock-queue-pos">#' +
            escapeHtml(row.position ?? "—") +
            '</span><span class="farm-dock-queue-kind">' +
            escapeHtml(kind) +
            '</span><span class="farm-dock-queue-badge">' +
            escapeHtml(badge) +
            "</span>";
          queueList.appendChild(li);
        }
      } else {
        queueSection?.classList.add("hidden");
      }
    }

    const fab = $("farm-dock-fab");
    const fabIcon = $("farm-dock-fab-icon");
    const fabDot = $("farm-dock-fab-dot");
    const fabProg = $("farm-dock-fab-progress");
    if (fabIcon) {
      fabIcon.innerHTML =
        '<img src="assets/' +
        escapeHtml(dockModeIcon(snap.mode)) +
        '" alt="" width="28" height="28" decoding="async" />';
    }
    if (fabProg) fabProg.style.setProperty("--pct", String(snap.progress.pct || 0));
    if (fab) {
      fab.classList.toggle(
        "is-running",
        snap.phase === "running" || snap.phase === "queued" || pendingJobsCount() > 0
      );
      fab.title =
        snap.phase === "running"
          ? snap.fractionText + " — แตะเพื่อดูสถานะ"
          : pendingJobsCount() > 0
            ? "มีงานรอคิว " + pendingJobsCount() + " — แตะเพื่อดู"
            : "เปิดประวัติ / สถานะฟาร์ม";
    }
    if (fabDot) {
      const showDot =
        snap.phase === "running" ||
        snap.phase === "queued" ||
        snap.phase === "done" ||
        snap.phase === "error";
      fabDot.classList.toggle("hidden", !showDot);
      fabDot.classList.remove("is-ok", "is-err", "is-running");
      if (snap.phase === "running" || snap.phase === "queued") fabDot.classList.add("is-running");
      else if (snap.phase === "done" && snap.ok !== false) fabDot.classList.add("is-ok");
      else if (snap.phase === "error" || (snap.phase === "done" && snap.ok === false)) {
        fabDot.classList.add("is-err");
      }
    }
  }

  function updateProgressBar(current, total) {
    if (!pipelineState) return;
    pipelineState.progress = {
      current: Number(current) || 0,
      total: Number(total) || pipelineState.progress?.total || 0,
    };
    renderFarmDock();
  }

  function renderLogList() {
    const list = $("farm-log");
    if (!list) return;
    list.replaceChildren();
    list.classList.add("hidden");
  }

  function clearRunStatusAutoClose() {
    if (runStatusAutoCloseTimer) {
      clearTimeout(runStatusAutoCloseTimer);
      runStatusAutoCloseTimer = null;
    }
  }

  function setRunStatusClosable() {
    runStatusClosable = true;
    const btn = $("run-status-close");
    if (btn) btn.disabled = false;
  }

  function showFarmDock() {
    const root = $("farm-dock-root");
    if (!root) return;
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-farm-dock");
  }

  function hideFarmDock() {
    const root = $("farm-dock-root");
    if (!root) return;
    root.classList.remove("is-expanded");
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    const sheet = $("farm-dock-sheet");
    if (sheet) sheet.classList.add("hidden");
    dockExpanded = false;
    dockPhase = null;
    dockOk = null;
    dockJobStartedAt = null;
    stopDockElapsedTimer();
    clearPendingFarmJobs();
    document.body.classList.remove("has-farm-dock");
    const fab = $("farm-dock-fab");
    if (fab) fab.setAttribute("aria-expanded", "false");
  }

  function expandFarmDock() {
    const root = $("farm-dock-root");
    const sheet = $("farm-dock-sheet");
    if (!root || !sheet) return;
    showFarmDock();
    root.classList.add("is-expanded");
    sheet.classList.remove("hidden");
    dockExpanded = true;
    const fab = $("farm-dock-fab");
    if (fab) fab.setAttribute("aria-expanded", "true");
    trapFocus(sheet);
    loadFarmHistory()
      .then(() => renderFarmDock())
      .catch(() => renderFarmDock());
  }

  function collapseFarmDock() {
    const root = $("farm-dock-root");
    const sheet = $("farm-dock-sheet");
    if (!root || !sheet) return;
    root.classList.remove("is-expanded");
    sheet.classList.add("hidden");
    dockExpanded = false;
    const fab = $("farm-dock-fab");
    if (fab) fab.setAttribute("aria-expanded", "false");
    releaseFocusTrap();
    fab?.focus?.();
  }

  function updateFarmDockBar(opts = {}) {
    renderFarmDock(opts);
  }

  function renderFarmDockQueue(items) {
    if (Array.isArray(items)) {
      if (lastGate) lastGate.queue_items = items;
      else lastGate = { queue_items: items };
    }
    renderFarmDock();
  }

  function showFarmDockQueue(gate, opts = {}) {
    lastGate = gate || lastGate;
    dockPhase = "queued";
    dockOk = null;
    showFarmDock();
    expandFarmDock();
    renderFarmDock({
      mode: jobKindToMode(queuedJobKind || currentJobKind()),
      waking: opts.waking,
    });
  }

  function stopWatchJobPoll() {
    if (watchJobTimer) {
      clearInterval(watchJobTimer);
      watchJobTimer = null;
    }
    stopProgressPoll();
  }

  function persistWatchJobId(id) {
    activeWatchJobId = id || null;
    try {
      if (id) localStorage.setItem(FARM_JOB_ID_KEY, id);
      else localStorage.removeItem(FARM_JOB_ID_KEY);
    } catch (_) {}
  }

  async function fetchJobStatus(jobId) {
    return api("/api/farm/job/" + encodeURIComponent(jobId));
  }

  function applyLiveJobProgress(jobRow, mode, target) {
    const m = mode || jobKindToMode(jobRow?.job_kind) || statusContext?.mode || "partyrun";
    if (!pipelineState) {
      statusContext = statusContext || { mode: m, target: target || 0 };
      if (!statusContext.mode) statusContext.mode = m;
      if (!statusContext.target && target) statusContext.target = target;
      pipelineState = freshPipeline(m);
      if (!dockJobStartedAt) dockJobStartedAt = Date.now();
      if (dockPhase !== "running" && dockPhase !== "done" && dockPhase !== "error") {
        dockPhase = "running";
      }
    }
    const logs = jobRow?.logs || [];
    applyLogsToPipeline(logs, m);
    const parsed = parseProgressFromLogs(logs, m, target);
    if (jobRow?.progress) {
      if (jobRow.progress.current != null) parsed.current = Number(jobRow.progress.current);
      if (jobRow.progress.total != null) parsed.total = Number(jobRow.progress.total);
      if (jobRow.progress.phase) parsed.phase = jobRow.progress.phase;
    }
    if (m === "upgrade" && statusContext?.itemTotal > 0) {
      parsed.total = statusContext.itemTotal;
      const done = statusContext.itemsCompleted;
      parsed.current =
        done != null ? done : Math.max(0, (statusContext.itemIndex || 1) - 1);
    }
    pipelineState.progress = {
      current: parsed.current,
      total: parsed.total || target || statusContext?.target || 0,
    };
    renderPipeline();
  }

  async function watchFarmJob(jobId, mode, target, handlers) {
    persistWatchJobId(jobId);
    dockPhase = "running";
    dockOk = null;
    if (!dockJobStartedAt) dockJobStartedAt = Date.now();
    startDockElapsedTimer();
    showFarmDock();
    renderFarmDock({ mode, target });

    return new Promise((resolve) => {
      let settled = false;
      let pollErrors = 0;
      const finishWatch = async (jobRow) => {
        if (settled) return;
        settled = true;
        stopWatchJobPoll();
        stopDockElapsedTimer();
        persistWatchJobId(null);
        const ok = jobRow?.status === "succeeded";
        const result = jobRow?.result || {};
        const logs = jobRow?.logs || [];
        dockOk = ok;
        dockPhase = ok ? "done" : "error";
        buildFinalPipeline(logs, result, ok, mode);
        renderFarmDock({ mode, target, ok });
        if (ok && typeof handlers?.onSuccess === "function") {
          handlers.onSuccess({ ...jobRow, result, ok: true, logs, ...result });
        } else if (!ok && typeof handlers?.onError === "function") {
          handlers.onError({ ...jobRow, result, ok: false, logs, ...result });
        }
        resolve(jobRow);
      };

      const tick = async () => {
        if (settled || !accessToken) return;
        try {
          pollErrors = 0;
          const gatePromise = api("/api/farm/gate").catch(() => null);
          const activePromise = api("/api/farm/active-job").catch(() => null);
          const [gateData, activeData] = await Promise.all([gatePromise, activePromise]);
          if (gateData) {
            lastGate = gateData;
            if (Array.isArray(gateData.queue_items)) {
              renderFarmDockQueue(gateData.queue_items);
            }
          }
          if (activeData?.active && activeData.job_id === jobId) {
            applyLiveJobProgress(activeData, mode || jobKindToMode(activeData.job_kind), target);
            return;
          }
          const jobRow = await fetchJobStatus(jobId);
          if (jobRow.status === "running" || jobRow.status === "queued") {
            applyLiveJobProgress(jobRow, mode || jobKindToMode(jobRow.job_kind), target);
            return;
          }
          const payload = { ...jobRow, ...(jobRow.result || {}), result: jobRow.result };
          await finishWatch(payload);
        } catch (e) {
          pollErrors += 1;
          if (pollErrors >= 8 && !settled) {
            dockPhase = "error";
            dockOk = false;
            stopDockElapsedTimer();
            const msg = thError(e.message || e.data?.detail || "job_status_unavailable");
            if (pipelineState) {
              pipelineState.extras = [{ text: msg, kind: "err" }];
            }
            renderFarmDock({ mode, target, ok: false, errorMsg: msg });
            if (typeof handlers?.onError === "function") {
              handlers.onError({ ok: false, error: "job_poll_failed", detail: msg });
            }
            settled = true;
            stopWatchJobPoll();
            persistWatchJobId(null);
            resolve(null);
            if (!queuedRun) dequeueAndStartNext();
          }
        }
      };

      stopWatchJobPoll();
      watchJobTimer = setInterval(tick, 1000);
      tick();
    });
  }

  async function submitFarmJob({ url, body, mode, target, handlers }) {
    farmRunning = true;
    updateFarmAvailability();
    dockPhase = "running";
    dockOk = null;
    statusContext = { mode, target };
    expandFarmDock();
    renderFarmDock({ mode, target });
    try {
      await ensureApiReady();
      const data = await api(url, { method: "POST", body });
      if (data.accepted && data.job_id) {
        startLiveStages({ mode, target });
        expandFarmDock();
        return await watchFarmJob(data.job_id, mode, target, handlers);
      }
      if (data.accepted && !data.job_id) {
        const err = new Error("job_tracking_unavailable");
        err.status = 503;
        throw err;
      }
      if (data.ok != null && !data.accepted) {
        const ok = !!data.ok;
        dockPhase = ok ? "done" : "error";
        dockOk = ok;
        startLiveStages({ mode, target });
        buildFinalPipeline(data.logs || [], data.result || data, ok, mode);
        expandFarmDock();
        if (ok && handlers?.onSuccess) handlers.onSuccess(data);
        else if (!ok && handlers?.onError) handlers.onError(data);
        return data;
      }
      return data;
    } catch (e) {
      clearStageTimer();
      if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        expandFarmDock();
        await enterQueueFor(
          e.gate || e.data?.detail?.gate,
          () => submitFarmJob({ url, body, mode, target, handlers }),
          modeToJobKind(mode)
        );
        setFarmStatus( "ระบบไม่ว่าง — จองคิวให้แล้ว รอสักครู่", "muted");
        return null;
      }
      if (/job_tracking_unavailable/i.test(String(e.message))) {
        dockPhase = "error";
        dockOk = false;
        expandFarmDock();
        renderFarmDock({ mode, target, ok: false, errorMsg: "ไม่สามารถติดตามงานบนเซิร์ฟเวอร์ได้ — ลองใหม่" });
      }
      throw e;
    } finally {
      farmRunning = false;
      updateFarmAvailability();
      if (!queuedRun && !activeWatchJobId) {
        dequeueAndStartNext();
      }
    }
  }

  async function resumeFarmSession() {
    if (!accessToken) return;
    try {
      const gate = await api("/api/farm/gate").catch(() => null);
      if (gate) lastGate = gate;
      const active = await api("/api/farm/active-job").catch(() => null);
      let jobId = active?.active ? active.job_id : null;
      if (!jobId) {
        try {
          jobId = localStorage.getItem(FARM_JOB_ID_KEY);
        } catch (_) {}
      }
      if (jobId && (active?.active || jobId)) {
        if (active?.active) {
          const mode = jobKindToMode(active.job_kind);
          const target = Number(active.progress?.total) || statusContext?.target || 0;
          statusContext = { mode, target };
          startLiveStages({ mode, target });
          expandFarmDock();
          farmRunning = true;
          updateFarmAvailability();
          watchFarmJob(jobId, mode, target, {
            onSuccess: () => {
              farmRunning = false;
              updateFarmAvailability();
              refreshMe().catch(() => {});
              loadFarmHistory().catch(() => {});
            },
            onError: () => {
              farmRunning = false;
              updateFarmAvailability();
              loadFarmHistory().catch(() => {});
            },
          }).finally(() => {
            farmRunning = false;
            updateFarmAvailability();
            if (!queuedRun && !activeWatchJobId) {
              dequeueAndStartNext();
            }
          });
          return;
        }
      }
      if (gate?.me?.status === "waiting" || gate?.me?.status === "active") {
        showFarmDockQueue(gate);
        startQueuePoll();
      }
    } catch (_) {}
  }

  function openRunStatusPopup(running) {
    showFarmDock();
    clearRunStatusAutoClose();
    setRunStatusClosable(!running);
    if (running) {
      pendingAfterRunStatus = null;
      setRunStatusSubtitle(false);
      expandFarmDock();
    } else {
      expandFarmDock();
    }
  }

  function closeRunStatusPopup() {
    if (!runStatusClosable) {
      collapseFarmDock();
      return;
    }
    clearRunStatusAutoClose();
    const cb = pendingAfterRunStatus;
    pendingAfterRunStatus = null;
    collapseFarmDock();
    if (typeof cb === "function") cb();
    if (dockPhase === "done" || dockPhase === "error") resetFarmDockIdle();
  }

  function forceCloseRunStatusPopup() {
    clearRunStatusAutoClose();
    runStatusClosable = true;
    pendingAfterRunStatus = null;
    collapseFarmDock();
    setRunStatusSubtitle(false);
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
    const tot =
      Number(pipelineState.progress?.total) ||
      Number(statusContext?.target) ||
      Number(statusContext?.itemTotal) ||
      0;
    if (tot > 0) {
      pipelineState.progress = { current: tot, total: tot };
    }
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
    if (mode === "upgrade" && (statusContext?.itemTotal > 0 || tot > 0)) {
      const itemTot = statusContext?.itemTotal || tot;
      const itemIdx = statusContext?.itemIndex || 0;
      const name = statusContext?.itemName || "";
      const short = name.length > 22 ? name.slice(0, 20) + "…" : name;
      if (itemIdx > 0) {
        return "ชิ้นที่ " + formatNumTh(itemIdx) + "/" + formatNumTh(itemTot) + (short ? " · " + short : "");
      }
      if (itemTot > 1) return "กำลังตีบวก " + formatNumTh(itemTot) + " ชิ้น…";
    }
    if (focusKind === "ok") return "สำเร็จแล้ว";
    if (focusKind === "err") return stepLabel(step, "err", mode);
    if (cur > 0 || tot > 0) return cfg.progressText(cur, tot);
    return stepLabel(step, focusKind, mode);
  }

  function renderPipeline() {
    if (!pipelineState) return;
    showFarmDock();

    const mode = pipelineState.mode || statusContext?.mode || "partyrun";
    const steps = pipelineState.steps || pipelineStepsFor(mode);
    let focusIdx = pipelineState.activeIdx || 0;
    const errIdx = steps.findIndex((s) => pipelineState.kinds[s.id] === "err");
    if (errIdx >= 0) {
      focusIdx = errIdx;
    } else if (steps.every((s) => pipelineState.kinds[s.id] === "ok")) {
      focusIdx = steps.length - 1;
    } else {
      const pendingIdx = steps.findIndex((s) => pipelineState.kinds[s.id] === "pending");
      if (pendingIdx >= 0) focusIdx = pendingIdx;
    }

    if (dockPhase === "running" || dockPhase === "queued") {
      pipelineState.activeIdx = focusIdx;
    }

    renderFarmDock({ mode, target: pipelineState.progress?.total || statusContext?.target });
  }

  function stopProgressPoll() {
    if (progressPollTimer) {
      clearInterval(progressPollTimer);
      progressPollTimer = null;
    }
  }

  async function pollActiveJobProgress() {
    if (!accessToken || (!farmRunning && !activeWatchJobId)) return;
    try {
      const data = await api("/api/farm/active-job");
      if (!data?.active || !pipelineState) return;
      const mode = statusContext?.mode || pipelineState.mode || "partyrun";
      applyLiveJobProgress(data, mode, statusContext?.target);
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
    dockPhase = "running";
    dockOk = null;
    dockJobStartedAt = Date.now();
    startDockElapsedTimer();
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
    // Keep popup open until user closes — no auto-close.
    expandFarmDock();
    loadFarmHistory().catch(() => {});
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
      } else if (m === "reroll") {
        if (/login|guest/i.test(errCode)) failId = "login";
        else failId = "draw";
      } else if (m === "quest_claim") {
        if (/login|session/i.test(errCode)) failId = "login";
        else failId = "claim";
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
      dockPhase = "error";
      dockOk = false;
    }
  }

  const LOG_TH = [
    [/^\[round\s+(\d+)\/(\d+)\]/i, (m) => "รอบที่ " + m[1] + " จาก " + m[2]],
    [/claiming reward/i, () => "กำลังรับรางวัล"],
    [/REWARD CLAIMED/i, () => "รับรางวัลแล้ว"],
    [/matchmaking/i, () => "กำลังจับคู่ห้อง"],
    [/creating guest/i, () => "กำลังสร้างไอดีชั่วคราว"],
    [/create_guest failed/i, () => "สร้างไอดีชั่วคราวไม่สำเร็จ"],
    [/sending life/i, () => "กำลังส่งหัวใจ"],
    [/collected\s+(\d+)\/(\d+)\s+hearts/i, (m) => "เก็บหัวใจได้ " + m[1] + " จาก " + m[2]],
    [/claim:\s*collected\s+(\d+)\/(\d+)/i, (m) => "รับหัวใจได้ " + m[1] + " จาก " + m[2]],
    [/claim:\s*collected\s+(\d+)/i, (m) => "รับหัวใจได้ " + m[1]],
    [/hearts collected/i, () => "เก็บหัวใจแล้ว"],
    [/\bBUY\b.*\bOK\b/i, () => "ซื้อสมบัติสำเร็จ"],
    [/\bBUY\b.*\bERR\b/i, () => "ซื้อสมบัติไม่สำเร็จ"],
    [/\bBREAK\b.*\bOK\b/i, () => "ย่อยสมบัติสำเร็จ"],
    [/\bBREAK\b.*\bERR\b/i, () => "ย่อยสมบัติไม่สำเร็จ"],
    [/\[SKIP BREAK\]/i, () => "ข้ามการย่อย — ไม่พบ uuid"],
    [/reroll guest\s*\[(\d+)\/(\d+)\]/i, (m) => "รีโรลไอดีใหม่ " + m[1] + "/" + m[2]],
    [/reroll\s*\[(\d+)\/(\d+)\]/i, (m) => "รีโรลบัญชี " + m[1] + "/" + m[2]],
    [/quest:\s*claimed\s+(\d+)\/(\d+)/i, (m) => "รับรางวัลเควสแล้ว " + m[1] + "/" + m[2]],
    [/quest:\s*logging in/i, () => "กำลังเข้าสู่ระบบเพื่อรับเควส"],
    [/quest:\s*auto-selected\s+(\d+)/i, (m) => "เลือกเควสที่รับได้ " + m[1] + " รายการ"],
    [/powder:\s*login/i, () => "กำลังเข้าสู่ระบบเพื่อฟาร์มผง"],
    [/cookie_unlock:\s*login/i, () => "กำลังเข้าสู่ระบบเพื่อปลดล็อกคุกกี้"],
    [/heart:\s*login main account/i, () => "กำลังเข้าสู่ระบบบัญชีหลัก"],
    [/heart:\s*no friend slots left/i, () => "ช่องเพื่อนเต็มแล้ว"],
    [/heart:\s*stopped by user/i, () => "หยุดโดยผู้ใช้"],
    [/TOTAL\s+(\d+)\/(\d+)/i, (m) => "รวมได้หัวใจ " + m[1] + "/" + m[2]],
  ];

  function translateLog(line) {
    const s = String(line || "").trim();
    if (!s) return "";
    for (const [re, fn] of LOG_TH) {
      const m = s.match(re);
      if (m) {
        try {
          return fn(m) || s;
        } catch (_) {
          return s;
        }
      }
    }
    return s;
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
      mail?.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        if (!secret?.value.trim()) {
          ev.preventDefault();
          secret?.focus();
        }
      });
      secret?.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        if (farmTab !== "devplay" || isDevPlayConnected() || devplayConnecting || farmRunning) return;
        ev.preventDefault();
        connectDevPlay();
      });
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

  function handleFarmRunException(e, mode) {
    clearStageTimer();
    const raw = String(e.message || "");
    dockPhase = "error";
    dockOk = false;
    farmRunning = false;
    updateFarmAvailability();

    const fatalSession =
      /powder_session_missing|account_banned|maintenance|devplay_session_expired|login_failed/i.test(
        raw
      ) ||
      e.status === 401;

    if (/powder_session_missing/i.test(raw)) {
      clearPendingFarmJobs();
      expandFarmDock();
      renderFarmDock({
        mode,
        ok: false,
        errorMsg: ERR_TH.powder_session_missing || "เชื่อม DevPlay ใหม่",
      });
      showErrorModal(ERR_TH.powder_session_missing || "เชื่อม DevPlay ใหม่", "เชื่อม DevPlay ใหม่");
      setFarmStatus(ERR_TH.powder_session_missing || "เชื่อม DevPlay ใหม่", "err");
      return;
    }

    if (/account_banned/i.test(raw)) {
      clearPendingFarmJobs();
      forceCloseRunStatusPopup();
      showErrorModal(ERR_TH.account_banned, "บัญชีถูกระงับ");
      setFarmStatus( ERR_TH.account_banned, "err");
    } else if (/maintenance/i.test(raw)) {
      clearPendingFarmJobs();
      forceCloseRunStatusPopup();
      showErrorModal(ERR_TH.maintenance, "ปิดปรับปรุง");
      setFarmStatus( ERR_TH.maintenance, "err");
    } else if (e.status === 401 || /devplay_session_expired|login_failed/i.test(raw)) {
      clearPendingFarmJobs();
      forceCloseRunStatusPopup();
      if (mode !== "heart") resetDevPlaySession();
      showErrorModal(
        /login_failed/i.test(raw) ? ERR_TH.login_failed : ERR_TH.devplay_session_expired,
        mode === "heart" ? "เข้าสู่ระบบเกมไม่สำเร็จ" : "เชื่อมใหม่"
      );
      setFarmStatus( thError(raw), "err");
    } else if (/heart_disabled|heart_proxy_not_configured/i.test(raw)) {
      forceCloseRunStatusPopup();
      showErrorModal(thError(raw), "ยังใช้ไม่ได้");
      setFarmStatus( thError(raw), "err");
      if (!fatalSession) dequeueAndStartNext();
    } else if (/not_enough_tickets/i.test(raw)) {
      forceCloseRunStatusPopup();
      showErrorModal(ERR_TH.not_enough_tickets, "ตั๋วไม่พอ");
      setFarmStatus( ERR_TH.not_enough_tickets, "err");
      dequeueAndStartNext();
    } else if (e.status === 400 && /value_capped/i.test(raw)) {
      forceCloseRunStatusPopup();
      showErrorModal(ERR_TH.value_capped, "ตัวเลขเกินกำหนด");
      setFarmStatus( ERR_TH.value_capped, "err");
      dequeueAndStartNext();
    } else {
      const msg = thError(raw) || "การฟาร์มไม่สำเร็จ";
      expandFarmDock();
      renderFarmDock({ mode, ok: false, errorMsg: msg });
      setFarmStatus( msg, "err");
      if (isRentalDeniedError(e)) {
        clearPendingFarmJobs();
        handleRentalDenied(e);
      } else if (typeof e.data?.rental_expires_at === "string") {
        applyProfileRental(e.data);
        dequeueAndStartNext();
      } else {
        dequeueAndStartNext();
      }
    }
  }

  async function runFarm() {
    if (!hasFarmAccess()) {
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
    setFarmStatus(
      "กำลัง Party Run " + tickets + " ตั๋ว… อาจใช้เวลาสักครู่",
      "muted"
    );

    if (
      queueIfBusy(
        "partyrun",
        tickets,
        "Party Run · " + formatNumTh(tickets) + " ตั๋ว",
        () => runFarm()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/run",
        body: {
          devplay_session_id: devplaySession.id,
          ticket_count: tickets,
          score,
          coin,
          exp,
        },
        mode: "partyrun",
        target: tickets,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const roundsCompleted = Number(data.rounds_completed || result?.rounds_completed || 0);
            const ticketsLeft = data.party_run_tickets ?? result?.party_run_tickets ?? null;
            if (devplaySession && ticketsLeft != null && Number.isFinite(Number(ticketsLeft))) {
              devplaySession.tickets = Number(ticketsLeft);
              ticketMax = Math.max(1, Number(ticketsLeft));
              ticketCount = Math.min(ticketCount, ticketMax);
              paintTicketStepper();
            }
            setFarmStatus(
              "Party Run สำเร็จ " + roundsCompleted + "/" + tickets,
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
                roundsCompleted,
                ticketCount: tickets,
              });
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            loadFarmHistory().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            let msg = farmErrorMessage(result, "ฟาร์มไม่สำเร็จ");
            if (/corrupt_pending/i.test(String(result?.error || data.error || ""))) {
              msg = ERR_TH.corrupt_pending;
            }
            setFarmStatus( msg, "err");
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (e) {
      handleFarmRunException(e, "partyrun");
    }
  }

  async function runPowder() {
    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    if (!hasUsableProxy()) {
      await promptProxyModal({ locked: true, title: "ใส่ Proxy ก่อนฟาร์มผง" });
      if (!hasUsableProxy()) return;
    }
    paintPowderExamEstimate();
    if (!powderEstimate?.can_run) {
      showErrorModal(ERR_TH.insufficient_coin, "เหรียญไม่พอ");
      return;
    }

    const rounds = clampPowderRounds(powderRounds ?? Number($("powder-rounds")?.value) ?? 10);
    const stuffSeq = Math.max(1, Number($("powder-stuff-seq")?.value) || 811);
    const price = Math.max(0, Number($("powder-price")?.value) || 5000);
    const powderQty = Math.max(1, Number($("powder-qty")?.value) || 15);
    const doBreak = !!$("powder-do-break")?.checked;
    setFarmStatus(
      "กำลังฟาร์มผง " +
        formatNumTh(rounds) +
        " รอบ (seq " +
        stuffSeq +
        " · ≈" +
        formatNumTh(rounds * powderQty) +
        " ผง) …",
      "muted"
    );

    const body = {
      devplay_session_id: devplaySession.id,
      treasure_name: "Box-" + stuffSeq,
      rounds,
      stuff_seq: stuffSeq,
      price,
      powder_qty: powderQty,
      do_break: doBreak,
    };

    if (
      queueIfBusy(
        "powder",
        rounds || 0,
        rounds == null
          ? "ฟาร์มผง · ใช้เหรียญทั้งหมด"
          : "ฟาร์มผง · " + formatNumTh(rounds) + " รอบ",
        () => runPowder()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/powder/run",
        body,
        mode: "powder",
        target: rounds || 0,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            if (devplaySession) {
              if (result.coin_after != null) devplaySession.coin = result.coin_after;
              if (result.powder_after != null) devplaySession.powder = result.powder_after;
              paintDevPlaySessionLine();
            }
            const powderGained = Number(data.powder_gained || result.powder_gained || result.total_powder || 0);
            const roundsCompleted = Number(data.rounds_completed || result.rounds || result.bought || 0);
            const sum = $("powder-summary");
            if (sum) {
              sum.hidden = false;
              sum.classList.remove("hidden");
              const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
              setTxt("mp-res-bought", formatNumTh(result.bought ?? roundsCompleted));
              setTxt("mp-res-broken", formatNumTh(result.broken ?? "—"));
              setTxt("mp-res-powder", formatNumTh(powderGained));
              setTxt("mp-res-coin", formatNumTh(result.remaining_coin ?? result.coin_after ?? "—"));
            }
            if (result.remaining_coin != null && devplaySession) {
              devplaySession.coin = result.remaining_coin;
              paintDevPlaySessionLine();
            }
            setFarmStatus(
              "ฟาร์มผงสำเร็จ +" + formatNumTh(powderGained),
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
              });
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            refreshPowderEstimate().catch(() => {});
            loadFarmHistory().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            let msg = farmErrorMessage(result, "ฟาร์มผงไม่สำเร็จ");
            if (/owner_not_lv8/i.test(String(result?.error || data.error || ""))) {
              msg = ERR_TH.owner_not_lv8;
            } else if (/insufficient_coin/i.test(String(result?.error || data.error || ""))) {
              msg = ERR_TH.insufficient_coin;
            }
            setFarmStatus( msg, "err");
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (e) {
      handleFarmRunException(e, "powder");
    }
  }

  async function runGiftDraw() {
    if (!hasFarmAccess()) {
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

    const count = clampGiftDrawCount(giftdrawCount);
    setFarmStatus(
      "กำลังเปิดกล่องขวัญ " + formatNumTh(count) + " กล่อง…",
      "muted"
    );

    if (
      queueIfBusy(
        "giftdraw",
        count,
        "Gift Draw · " + formatNumTh(count) + " กล่อง",
        () => runGiftDraw()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/giftdraw/run",
        body: { devplay_session_id: devplaySession.id, count },
        mode: "giftdraw",
        target: count,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const drawsOk = Number(data.draws_ok ?? result.draws_ok ?? 0);
            if (drawsOk <= 0) {
              const msg = farmErrorMessage(result, ERR_TH.giftdraw_failed);
              setFarmStatus( msg, "err");
              refreshGiftDrawEstimate().catch(() => {});
              loadFarmHistory().catch(() => {});
              return;
            }
            const totals = data.totals || result.totals || {};
            const boxesAfter = data.available_boxes ?? result.available_boxes;
            setFarmStatus(
              "เปิดกล่องสำเร็จ " + formatNumTh(drawsOk) + " กล่อง",
              "ok"
            );
            pendingAfterRunStatus = () =>
              showGiftDrawResultModal({
                account: devplaySession?.nickname || "—",
                drawsOk: formatNumTh(drawsOk),
                requested: formatNumTh(data.requested || result.requested || count),
                boxesAfter: formatNumTh(boxesAfter ?? "—"),
                totals,
              });
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            refreshGiftDrawEstimate().catch(() => {});
            loadFarmHistory().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            let msg = farmErrorMessage(result, "เปิดกล่องขวัญไม่สำเร็จ");
            if (/no_gift_boxes/i.test(String(result?.error || data.error || ""))) {
              msg = ERR_TH.no_gift_boxes;
            }
            setFarmStatus( msg, "err");
            refreshGiftDrawEstimate().catch(() => {});
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (e) {
      handleFarmRunException(e, "giftdraw");
    }
  }

  function showHeartResultModal(summary) {
    const rows = [
      ["บัญชีเกม", escapeHtml(summary.account || "—")],
      [
        "หัวใจที่ได้",
        `<span class="result-delta">+${escapeHtml(summary.hearts)}</span> / ขอไว้ ${escapeHtml(summary.target)}`,
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
      icon: "assets/bbc_stat_iconHeart.png",
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
    if (!hasFarmAccess()) {
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

    const mode = upgradeRunMode === "fast" ? "fast" : "sequential";
    setFarmStatus(
      (mode === "fast" ? "Fast · " : "") + "กำลังตีบวก " + formatNumTh(items.length) + " ชิ้น…",
      "muted"
    );
    setUpgradeRunContext(1, items[0]?.name || "", items.length, 0);

    if (
      queueIfBusy(
        "upgrade",
        items.length,
        "ตีบวก · " + formatNumTh(items.length) + " ชิ้น",
        () => runUpgrade()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/upgrade/run-batch",
        body: {
          devplay_session_id: devplaySession.id,
          target_level: upgradeTargetLevel,
          mode: mode,
          items: items.map((t) => ({
            uuid: t.uuid,
            group_seq: t.group_seq,
            grade: t.grade || "S",
            name: t.name || "",
          })),
        },
        mode: "upgrade",
        target: items.length,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const itemsDone = Number(result?.items_done || data.items_done || items.length);
            setUpgradeRunContext(itemsDone, result?.treasure || items[itemsDone - 1]?.name || "", items.length, itemsDone);
            items.forEach((t) => upgradeSelected.delete(t.uuid));
            const anyReached = !!(data.reached_target || result?.reached_target);
            const anyPartial = !!(data.partial || result?.partial);
            if (anyReached) {
              setFarmStatus(
                "ตีบวกสำเร็จ " + formatNumTh(itemsDone) + "/" + formatNumTh(items.length) + " ชิ้น",
                "ok"
              );
            } else if (anyPartial) {
              setFarmStatus(
                "ตีบวกได้บางส่วน " +
                  formatNumTh(itemsDone) +
                  "/" +
                  formatNumTh(items.length) +
                  " ชิ้น · coin หายตามที่ใช้",
                "warn"
              );
            }
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            loadUpgradeTreasures(true).catch(() => {});
            loadFarmHistory().catch(() => {});
            paintUpgradeGrid();
          },
          onError: (data) => {
            const result = data.result || data;
            const msg = farmErrorMessage(result, "ตีบวกไม่สำเร็จ (แห้วหรือ coin ไม่พอ)");
            setFarmStatus( msg, "err");
            loadUpgradeTreasures(true).catch(() => {});
            loadFarmHistory().catch(() => {});
            paintUpgradeGrid();
          },
        },
      });
    } catch (e) {
      handleFarmRunException(e, "upgrade");
      paintUpgradeGrid();
    }
  }

  async function runHeart() {
    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }
    if (!hasDevPlayCreds()) {
      showErrorModal("กรอกอีเมลและรหัสผ่านบัญชีเกมให้ครบ", "ข้อมูลไม่ครบ");
      return;
    }
    if (!hasUsableHeartProxy()) {
      showErrorModal(ERR_TH.heart_proxy_not_configured, "ใส่ proxy ก่อน");
      return;
    }
    saveHeartProxy(getHeartProxy());

    const target = clampHeartTarget(heartTarget);
    setFarmStatus(
      "กำลังฟาร์มหัวใจ " + formatNumTh(target) + " ดวง… อาจใช้เวลาหลายนาที",
      "muted"
    );

    if (
      queueIfBusy(
        "heart",
        target,
        "ฟาร์มหัวใจ · " + formatNumTh(target) + " ดวง",
        () => runHeart()
      )
    ) {
      return;
    }

    try {
      await submitFarmJob({
        url: "/api/farm/heart/run",
        body: {
          email: $("dp-acct-mail").value.trim(),
          password: $("dp-acct-secret").value,
          target_hearts: target,
          proxy_url: getHeartProxy() || undefined,
          devplay_session_id: devplaySession?.id,
        },
        mode: "heart",
        target,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const hearts = Number(data.hearts || result.hearts || 0);
            setFarmStatus(
              "ฟาร์มหัวใจสำเร็จ +" + formatNumTh(hearts),
              "ok"
            );
            pendingAfterRunStatus = () =>
              showHeartResultModal({
                account: devplaySession?.nickname || $("dp-acct-mail").value.trim() || "—",
                hearts: formatNumTh(hearts),
                target: formatNumTh(target),
                partial: hearts < target || !!data.partial,
              });
            clearQueuedRun();
            stopQueuePoll();
            refreshGateAndQueueUi().catch(() => {});
            loadFarmHistory().catch(() => {});
          },
          onError: (data) => {
            const result = data.result || data;
            let msg = farmErrorMessage(result, "ฟาร์มหัวใจไม่สำเร็จ");
            const code = String(result?.error || data.error || "");
            if (/heart_timeout/i.test(code)) msg = ERR_TH.heart_timeout;
            else if (/no_hearts_collected/i.test(code)) msg = ERR_TH.no_hearts_collected;
            setFarmStatus( msg, "err");
            loadFarmHistory().catch(() => {});
          },
        },
      });
    } catch (e) {
      handleFarmRunException(e, "heart");
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
    loadHeartProxyIntoInput();
    paintHeartProxyHint();
    initFarmSidebar();
    paintTicketStepper();
    switchFarmTab("devplay");
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
      if (dockPhase === "queued" || lastGate?.me?.status) {
        refreshGateAndQueueUi().catch(() => {});
      }
      if (activeWatchJobId || dockPhase === "running") {
        resumeFarmSession().catch(() => {});
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
      const pass2 = $("signup-pass2");
      if (pass2) {
        pass2.setAttribute("aria-invalid", "true");
        pass2.focus();
      }
      setStatus($("signup-status"), ERR_TH.password_mismatch, "err");
      return;
    }
    $("signup-pass2")?.removeAttribute("aria-invalid");
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

  async function doLogout() {
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
  }

  $("logout-btn-menu")?.addEventListener("click", () => {
    doLogout().catch(() => {});
  });

  $("topbar-menu-toggle")?.addEventListener("click", () => {
    const sidebar = $("farm-sidebar");
    const isOpen = sidebar?.dataset.open !== "false";
    if (isOpen) closeNavDrawer();
    else openTopbarMenu();
  });

  $("menu-nav-topup")?.addEventListener("click", () => {
    closeNavDrawer();
    openVaultModal();
  });
  $("menu-nav-history")?.addEventListener("click", () => {
    closeNavDrawer();
    showFarmHistoryModal().catch(() => {});
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && $("farm-sidebar")?.dataset.open !== "false" && isCompactNav()) {
      closeNavDrawer();
    }
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
        body: { voucher, package_days: selectedTopupTokens, package_tokens: selectedTopupTokens },
      });
      setStatus(
        $("topup-status"),
        "ซองผ่าน · ยอด " +
          formatNumTh(data.amount_baht) +
          "฿ ตรงแพ็ก " +
          (data.package_days || data.package_tokens) +
          " วัน",
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
      showErrorModal("กรุณาเข้าสู่ระบบก่อนต่ออายุเช่า", "ต้องเข้าสู่ระบบ");
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
          package_days: selectedTopupTokens,
          package_tokens: selectedTopupTokens,
        },
      });
      applyProfileRental(data);
      try {
        await refreshMe();
      } catch (_) {}
      if ($("topup-voucher")) $("topup-voucher").value = "";
      if (modalMode === "empty") forceCloseModal();
      flashTopupDoor();
      const creditedDays = data.days_credited ?? data.package_days ?? data.package_tokens;
      setStatus(
        $("topup-status"),
        "ต่ออายุสำเร็จ +" + creditedDays + " วัน",
        "ok"
      );
      showTopupSuccessModal(data);
        openVaultModal();
      setTimeout(() => {
        if (hasFarmAccess()) closeVaultModal();
      }, 1800);
    } catch (e) {
      if (/session_replaced/i.test(String(e.message || ""))) return;
      const msg = thError(e.message) || "ต่ออายุเช่าไม่สำเร็จ";
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

  $("devplay-logout-btn")?.addEventListener("click", () => {
    logoutDevPlay();
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

  $("devplay-proxy-btn")?.addEventListener("click", () => {
    promptProxyModal({ locked: false, title: "ตั้งค่า Proxy" }).catch(() => {});
  });
  ["powder-stuff-seq", "powder-price", "powder-qty", "powder-do-break"].forEach((id) => {
    $(id)?.addEventListener("input", () => paintPowderExamEstimate());
    $(id)?.addEventListener("change", () => paintPowderExamEstimate());
  });
  $("heart-proxy-url")?.addEventListener("input", (ev) => {
    saveHeartProxy(ev.target.value);
    paintHeartProxyHint();
    updateFarmAvailability();
  });
  $("heart-proxy-url")?.addEventListener("change", (ev) => {
    saveHeartProxy(ev.target.value);
    paintHeartProxyHint();
    updateFarmAvailability();
  });
  $("heart-proxy-url")?.addEventListener("blur", (ev) => {
    const v = String(ev.target.value || "").trim();
    saveHeartProxy(v);
    paintHeartProxyHint();
    if (v) showToast("บันทึก proxy แล้ว", "ok");
  });

  $("devplay-shortcuts")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-shortcut-tab]");
    if (!btn) return;
    onFarmTabClick(btn.dataset.shortcutTab);
  });

  function onFarmTabClick(tab) {
    if (tab !== "devplay" && !isDevPlayConnected()) {
      showDevPlayRequiredModal();
      return;
    }
    switchFarmTab(tab, { silent: tab === "partyrun" });
    if (tab === "partyrun") showPartyRunMaintenanceModal();
    if (window.matchMedia("(max-width: 860px)").matches) {
      setFarmSidebarOpen(false);
    }
  }

  $("farm-tab-devplay")?.addEventListener("click", () => {
    switchFarmTab("devplay");
    if (window.matchMedia("(max-width: 860px)").matches) {
      setFarmSidebarOpen(false);
    }
  });
  $("farm-tab-heart")?.addEventListener("click", () => onFarmTabClick("heart"));
  $("farm-tab-partyrun")?.addEventListener("click", () => onFarmTabClick("partyrun"));
  $("farm-tab-powder")?.addEventListener("click", () => onFarmTabClick("powder"));
  $("farm-tab-giftdraw")?.addEventListener("click", () => onFarmTabClick("giftdraw"));
  $("farm-tab-upgrade")?.addEventListener("click", () => onFarmTabClick("upgrade"));
  $("farm-tab-cookie")?.addEventListener("click", () => onFarmTabClick("cookie"));
  $("farm-tab-reroll")?.addEventListener("click", () => onFarmTabClick("reroll"));
  $("farm-tab-quest")?.addEventListener("click", () => onFarmTabClick("quest"));
  $("farm-tab-account")?.addEventListener("click", () => onFarmTabClick("account"));
  $("farm-tab-dstool")?.addEventListener("click", () => onFarmTabClick("dstool"));
  $("cookie-reload-btn")?.addEventListener("click", () => {
    loadCookieList(true).catch(() => {});
  });
  $("cookie-select-all-btn")?.addEventListener("click", () => {
    selectBuyableCookies();
  });

  $("reroll-mode-row")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-reroll-mode]");
    if (!btn || btn.disabled) return;
    rerollMode = btn.dataset.rerollMode === "accounts" ? "accounts" : "guest";
    paintRerollMode();
  });
  $("reroll-minus")?.addEventListener("click", () => {
    rerollCount = clampRerollCount(rerollCount - 1);
    paintRerollStepper();
    updateFarmAvailability();
  });
  $("reroll-plus")?.addEventListener("click", () => {
    rerollCount = clampRerollCount(rerollCount + 1);
    paintRerollStepper();
    updateFarmAvailability();
  });
  $("reroll-count")?.addEventListener("change", () => {
    rerollCount = clampRerollCount($("reroll-count").value);
    paintRerollStepper();
    updateFarmAvailability();
  });
  $("reroll-btn")?.addEventListener("click", () => {
    runReroll().catch(() => {});
  });
  $("quest-reload-btn")?.addEventListener("click", () => {
    loadQuestList().catch(() => {});
  });
  $("quest-claim-btn")?.addEventListener("click", () => {
    runQuestClaim().catch(() => {});
  });
  $("account-reload-btn")?.addEventListener("click", () => {
    loadAccountInfo().catch(() => {});
  });
  $("ds-path-select")?.addEventListener("change", () => updateFarmAvailability());
  $("ds-call-btn")?.addEventListener("click", () => {
    runDsCall().catch(() => {});
  });

  $("upgrade-rng-accept")?.addEventListener("change", (ev) => {
    upgradeRngAccepted = !!ev.target.checked;
    updateFarmAvailability();
  });

  $("upgrade-target-levels")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".upgrade-level-seg");
    if (!btn || btn.disabled) return;
    setUpgradeTargetLevel(btn.dataset.level);
  });

  $("upgrade-mode-row")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".upgrade-mode-btn");
    if (!btn || btn.disabled) return;
    setUpgradeRunMode(btn.dataset.mode);
  });

  $("upgrade-reload-btn")?.addEventListener("click", () => {
    loadUpgradeTreasures(true).catch(() => {});
  });

  $("upgrade-grid-toggle")?.addEventListener("click", () => {
    upgradeGridExpanded = !upgradeGridExpanded;
    paintUpgradeGrid();
  });

  $("powder-pick-btn")?.addEventListener("click", () => {
    showPowderTreasurePickerModal();
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

  $("farm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (farmRunning || devplayConnecting) return;

    if (farmTab === "devplay" && !isDevPlayConnected()) {
      await connectDevPlay();
      return;
    }

    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }

    if (farmTab === "heart") {
      commitHeartTargetFromInput();
      if (!hasDevPlayCreds()) {
        showErrorModal("กรอกอีเมลและรหัสผ่านบัญชีเกมให้ครบ", "ข้อมูลไม่ครบ");
        return;
      }
      if (!hasUsableHeartProxy()) {
        showErrorModal(ERR_TH.heart_proxy_not_configured, "ใส่ proxy ก่อน");
        return;
      }
      saveHeartProxy(getHeartProxy());
      const confirmed = await showHeartConfirmModal(heartTarget);
      if (!confirmed) {
        setFarmStatus( "ยกเลิกแล้ว", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasFarmAccess()) {
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
      if (upgradeRunMode === "fast") {
        const fastOk = await showUpgradeFastConfirmModal(upgradeItems);
        if (!fastOk) {
          setFarmStatus( "ยกเลิกแล้ว", "muted");
          return;
        }
      }
      const upgradeConfirmed = await showUpgradeConfirmModal(upgradeItems);
      if (!upgradeConfirmed) {
        setFarmStatus( "ยกเลิกแล้ว", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasFarmAccess()) {
        showEmptyCoinsModal();
        return;
      }
      await runUpgrade();
      return;
    }

    if (farmTab === "cookie") {
      if (!isDevPlayConnected()) {
        showErrorModal("เชื่อม DevPlay ก่อนปลดล็อกคุกกี้", "ยังไม่ได้เชื่อม");
        return;
      }
      const cookiePick = getSelectedCookieItems();
      if (!cookiePick.length) {
        showErrorModal("เลือกคุกกี้ที่ปลดล็อกได้ก่อน", "ยังไม่ได้เลือก");
        return;
      }
      const cookieCost = cookiePick.reduce((s, c) => s + Number(c.coin_cost || 0), 0);
      if (cookieCost > cookieCoin) {
        showErrorModal("เหรียญในไอดีไม่พอสำหรับรายการที่เลือก", "เหรียญไม่พอ");
        return;
      }
      const cookieConfirmed = await showCookieConfirmModal(cookiePick);
      if (!cookieConfirmed) {
        setFarmStatus( "ยกเลิกแล้ว", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasFarmAccess()) {
        showEmptyCoinsModal();
        return;
      }
      await runCookieUnlock();
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
        setFarmStatus( "ยกเลิกแล้ว", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasFarmAccess()) {
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
        setFarmStatus( "ยกเลิกแล้ว", "muted");
        return;
      }
      try {
        await refreshMe();
      } catch (_) {}
      if (!hasFarmAccess()) {
        showEmptyCoinsModal();
        return;
      }
      await runPowder();
      return;
    }

    commitTicketCountFromInput();

    const confirmed = await showConfirmModal(ticketCount);
    if (!confirmed) {
      setFarmStatus( "ยกเลิกแล้ว", "muted");
      return;
    }

    try {
      await refreshMe();
    } catch (_) {}

    if (!hasFarmAccess()) {
      showEmptyCoinsModal();
      return;
    }

    await runFarm();
  });

  $("run-status-close")?.addEventListener("click", () => {
    closeRunStatusPopup();
  });

  $("farm-dock-fab")?.addEventListener("click", () => {
    if (dockExpanded) collapseFarmDock();
    else {
      expandFarmDock();
      loadFarmHistory().catch(() => {});
    }
  });

  $("farm-dock-list")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-cancel-pending]");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = btn.getAttribute("data-cancel-pending");
    if (id) cancelPendingFarmJob(id);
  });

  document.querySelectorAll(".farm-dock-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-dock-tab") || "all";
      dockHistoryTab = tab === "active" ? "active" : "all";
      renderFarmDock();
    });
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
    const dockRoot = $("farm-dock-root");
    if (dockRoot && !dockRoot.classList.contains("hidden") && dockExpanded) {
      collapseFarmDock();
      return;
    }
    if (modalRoot && !modalRoot.classList.contains("hidden") && !modalRoot.classList.contains("locked")) {
      closeModal();
    }
  });

  paintPowderSelectedTreasure();
  paintUpgradeTargetLevel();

  bootstrap();
})();
