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
  const AUTO_LOGIN_KEY = "ckr_auto_login_v1";
  const SESSION_KEY = "ckr_session_token";
  const GLOBAL_PROXY_KEY = "ckr_global_proxy_url";
  const HEART_PROXY_KEY = GLOBAL_PROXY_KEY; // compat alias
  const DEVPLAY_VAULT_MAX = 5;
  const DEVPLAY_VAULT_PEPPER = "ckr-devplay-vault-v1";
  let devplayVaultEntries = [];
  const FARM_SIDEBAR_KEY = "ckr_farm_sidebar_open";
  const TELEGRAM_URL = "https://t.me/j3xdr";
  const API = cfg.API_BASE || "";
  const INT32_MAX = 2147483647;
  const SAFE_COIN_MAX = 449000;
  const SAFE_EXP_MAX = 52000;
  const DEFAULT_FARM_SCORE = 800000;
  let farmCoinMax = SAFE_COIN_MAX;
  let farmExpMax = SAFE_EXP_MAX;
  let lastHealth = null;
  let proxyPoolStatus = null;
  let proxyPoolTimer = null;
  let loginApiState = "waking"; // waking | ready | down
  let autoLoginAttempted = false;
  let authBusy = false;

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
    if (activeFocusTrap?.container === container) return;
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
      blurb: "วิ่ง Party Run อัตโนมัติ",
      icon: "pirate_cookie_run.gif",
    },
    heart: {
      title: "ฟาร์มหัวใจ",
      hint: "เลือกจำนวนหัวใจแล้วกดรัน",
      blurb: "ฟาร์มหัวใจผ่านเพื่อน",
      icon: "Heart.png",
    },
    powder: {
      title: "ฟาร์มผง",
      hint: "เลือกสมบัติและจำนวนรอบ",
      blurb: "ย่อยกล่องเป็นผงอัตโนมัติ",
      icon: "magic_powder.png",
    },
    giftdraw: {
      title: "Gift Draw",
      hint: "เปิดกล่องของขวัญ",
      blurb: "เปิดกล่องของขวัญในไอดี",
      icon: "icon_giftpoint.png",
    },
    upgrade: {
      title: "ตีบวกสมบัติ",
      hint: "เลือกสมบัติในคลัง",
      blurb: "ตีบวกสมบัติทีละชุด",
      icon: "Crystal_Pearl_Earring_2B9.png",
    },
    cookie: {
      title: "ปลดล็อกคุกกี้",
      hint: "เลือกคุกกี้ · รันทีละตัว",
      blurb: "ปลดล็อกและอัปเลเวลคุกกี้",
      icon: "pine_monk_cookie.png",
    },
    reroll: {
      title: "รีโรล",
      hint: "สุ่มของจากตั๋วในไอดีใหม่",
      blurb: "รีโรลตั๋วหลายไอดี",
      icon: "gem.png",
    },
    quest: {
      title: "เควส",
      hint: "โหลดแล้วเลือกรับรางวัลที่ทำครบ",
      blurb: "ดูและรับรางวัลเควส",
      icon: "icon_giftpoint.png",
    },
    invite: {
      title: "เชิญเพื่อน 29 คน",
      hint: "เติม Credit → วางลิงก์ → กดเริ่ม (14 Credit/ครั้ง)",
      blurb: "เชิญเพื่อนด้วย Guest Pool 29 คน/ครั้ง",
      icon: "icon_giftpoint.png",
    },
    afterplay_fast: {
      title: "ฟาร์มเงิน/XP",
      hint: "1 รอบ = 1 หัวใจ · ใส่เป้าเหรียญหรือเลเวล",
      blurb: "ฟาร์มเหรียญและ XP แบบ Hardcore จากไอดีที่ล็อกอิน",
      icon: "Cookie0023_head.png",
    },
    unlock_l: {
      title: "ปลดล็อค L",
      hint: "15 Credit/ตัว · ครบ 7 = 100 · ไม่คิดตัวที่มีแล้ว",
      blurb: "ปลด L ทีละด่านหรือครบชุด 7 ตัว",
      icon: "Tiger_Lily_Cookie.png",
    },
    account: {
      title: "ข้อมูลไอดี",
      hint: "ดูคุกกี้ สัตว์เลี้ยง สมบัติ และทรัพยากร",
      blurb: "สรุปทรัพยากรในไอดี",
      icon: "notice_b20.png",
    },
    dstool: {
      title: "ทดสอบคำสั่งเกม",
      hint: "สำหรับผู้ใช้ขั้นสูง — เลือกคำสั่งที่อนุญาตเท่านั้น",
      blurb: "รันคำสั่ง DS ที่อนุญาต",
      icon: "score.png",
    },
  };
  const FARM_DOCK_TABS_DEFAULT = [
    "partyrun",
    "heart",
    "powder",
    "giftdraw",
    "upgrade",
    "cookie",
    "reroll",
    "quest",
    "afterplay_fast",
    "unlock_l",
    "account",
    "dstool",
  ];
  const FARM_DOCK_TAB_SET = new Set(FARM_DOCK_TABS_DEFAULT);
  let FARM_DOCK_TABS = FARM_DOCK_TABS_DEFAULT.slice();
  const DEFAULT_FARM_FEATURE_ORDER = [
    "partyrun",
    "heart",
    "powder",
    "giftdraw",
    "upgrade",
    "cookie",
    "reroll",
    "quest",
    "afterplay_fast",
    "unlock_l",
    "account",
    "dstool",
  ];
  let farmFeatureOrder = DEFAULT_FARM_FEATURE_ORDER.slice();
  const INVITE_TAB = "invite";
  const INVITE_JOB_KEY = "ckr_invite_job_id";
  const INVITE_CHARGE_KEY = "ckr_invite_last_charge";
  let invitePackages = [];
  let inviteSelectedPackageId = null;
  let inviteCustomAmountBaht = null;
  let invitePollTimer = null;
  let inviteBusy = false;
  let invitePoolAvailable = true;
  let inviteRunning = false;
  let inviteActiveJobId = null;
  let inviteLastCharge = 14;
  let inviteLogLines = [];
  let inviteResultShownFor = null;
  const AFTERPLAY_FAST_TAB = "afterplay_fast";
  const UNLOCK_L_TAB = "unlock_l";
  const AFTERPLAY_JOB_KEY = "ckr_afterplay_job_id";
  const UNLOCKL_JOB_KEY = "ckr_unlockl_job_id";
  let afterplayPlan = null;
  let afterplayBusy = false;
  let afterplayRunning = false;
  let afterplayActiveJobId = null;
  let afterplayPollTimer = null;
  let afterplayLogLines = [];
  let afterplayResultShownFor = null;
  let afterplayLastEdit = "level";
  let afterplayPreviewTimer = null;
  let afterplaySnapCache = { at: 0, sid: "", data: null };
  let afterplayCreditPerRun = 0.2;
  const AFTERPLAY_SNAP_TTL_MS = 8000;
  const AFTERPLAY_MODE_KEY = "ckr_afterplay_farm_mode";
  let afterplayFarmMode = "money_xp";
  let afterplayEboxSelected = new Set();
  let afterplayEboxCatalog = [];
  let afterplayEboxCreditPerRun = 0.5;
  let afterplayPricesMeta = {
    eboxEnabled: true,
    eboxMaxRuns: 50,
    money_xp: { allow_customer_box_max: true, lock_box_max: false, box_max: 0, box_pick: "all" },
    episode_box: {
      allow_customer_box_max: true,
      lock_box_max: false,
      box_max: 0,
      box_pick: "all",
      default_runs_per_ep: 5,
    },
  };
  let unlockLCatalog = [];
  let unlockLSelected = new Set();
  let unlockLPrices = { each: 15, bundle: 100 };
  let unlockLBusy = false;
  let unlockLRunning = false;
  let unlockLActiveJobId = null;
  let unlockLPollTimer = null;
  let unlockLLogLines = [];
  let unlockLResultShownFor = null;
  let unlockLSnap = { life: 0, key: 0 };
  let unlockLCatalogCache = { at: 0, sid: "", data: null };
  const DEVPLAY_PORTRAIT_CDN = "https://link.clashofdragons.com/images/cookies";
  const DEVPLAY_AVATAR_FALLBACK = "assets/notice_b20.png";
  let devplayConnecting = false;
  let devplayRefreshing = false;
  let devplaySession = null; // { id, nickname, tickets, expiresAt }
  let devplayConnectionState = "disconnected";
  let ticketCount = 1;
  let ticketMax = 1;
  let farmTab = "devplay";
  let powderPlan = null;
  let powderEstimate = null;
  let powderEstimateLoading = false;
  let powderRounds = 10;
  let powderEditLock = "powder"; // powder | coin
  let powderStuffLabel = "";
  let powderStuffLookupTimer = null;
  let powderRefreshTimer = null;
  const POWDER_YIELD_ESTIMATE = 8;
  const POWDER_BREAK_FALLBACK = 15;
  // Fallback until /api/health or powder/plan loads; admin can raise via app_settings.
  const POWDER_MAX_FALLBACK = 5000;
  let powderMax = POWDER_MAX_FALLBACK;
  const POWDER_ESTIMATE_DISCLAIMER =
    "ผลลัพธ์จริงอาจได้ผงน้อยกว่าหรือมากกว่าที่แสดง เพราะแต่ละกล่องสุ่มสมบัติเกรด B (15 ผง) หรือ C (5 ผง) — ค่าที่แสดงคือค่าเฉลี่ยประมาณ " +
    POWDER_YIELD_ESTIMATE +
    " ผง/กล่อง";
  let lastRerollResults = [];
  let giftdrawCount = 1;
  let giftdrawMax = 1;
  let giftdrawEstimate = null;
  let giftdrawEstimateLoading = false;
  let heartTarget = 100;
  // Fallback until /api/farm/heart/status loads; admin can raise via app_settings.
  const HEART_MAX_FALLBACK = 1000;
  let heartMax = HEART_MAX_FALLBACK;
  let upgradeTreasures = [];
  const UPGRADE_MAX_SELECT = 10;
  let upgradeSelected = new Set();
  let upgradePickerFilter = "";
  let upgradePickerGradeFilter = "all";
  let upgradePickerDraft = new Set();
  let upgradeTargetLevel = 9;
  let upgradeEstimate = null;
  let upgradeEstimateLoading = false;
  let upgradeCoin = 0;
  let upgradeRunMode = "sequential";
  let cookieItems = [];
  let cookieSelected = new Set();
  let cookieCoin = 0;
  let cookieEstimate = null;
  let cookieEstimateLoading = false;
  let cookieListLoading = false;
  let cookieRunMode = "upgrade_full"; // unlock_only | upgrade_full
  let upgradeListLoading = false;
  let rerollMode = "guest";
  let rerollCount = 1;
  const REROLL_MAX = 50;
  let questList = [];
  let questSelected = new Set();
  let questLoading = false;
  let questFilter = "all"; // all | claimable | claimed
  let accountProfile = null;
  let accountLoading = false;
  let dsAllowlist = [];
  let dsAllowlistLoaded = false;
  let dsCalling = false;
  let peekCooldownUntil = 0;
  let peekCooldownTimer = null;
  let selectedTopupPackageId = "full_1d";
  let selectedTopupTokens = 1; // legacy alias of selected full-pack days
  let topupPackages = [];
  let topupFeatureChoices = [];
  let topupBusy = false;
  let featurePickBusy = false;
  let topupExpandedPref = null; // kept for compat; vault is modal now
  let vaultOpen = false;
  const CONSUMER_FEATURES = [
    "partyrun",
    "heart",
    "powder",
    "giftdraw",
    "upgrade",
    "cookie",
  ];
  const FEATURE_LABEL_TH = {
    partyrun: "Party Run",
    heart: "ฟาร์มหัวใจ",
    powder: "ฟาร์มผง",
    giftdraw: "เปิดกล่องขวัญ",
    upgrade: "อัปเกรดสมบัติ",
    cookie: "ปลดล็อกคุกกี้",
  };
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
  let featureLocks = {
    partyrun: false,
    heart: false,
    powder: false,
    giftdraw: false,
    upgrade: false,
    cookie: false,
    reroll: false,
    quest: false,
    account: false,
    dstool: false,
    afterplay_fast: false,
    unlock_l: false,
  };
  let earlyAccessFeatures = new Set();
  const FEATURE_LOCK_SVG =
    '<svg class="farm-nav-lock-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9zm3 4a1.75 1.75 0 0 1 .75 3.33V19a.75.75 0 0 1-1.5 0v-1.67A1.75 1.75 0 0 1 12 14z"/></svg>';
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
  let liveStatusOpen = false;
  let liveStatusLogOpen = false;
  let jobStatusView = "hidden"; // hidden | minimized | expanded
  let jobStatusTab = "live"; // live | history | admin
  let jobStatusAnimTimer = null;
  const FARM_JOB_ID_KEY = "ckr_farm_job_id";
  const FARM_JOB_INTENT_KEY = "ckr_farm_job_intent_v1";
  const FARM_JOB_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
  let activeWatchJobId = null;
  // Single source of truth for the card shown in "ประวัติ / สถานะ".
  // { id, mode, target, finished } — pollers may only touch the job whose id matches.
  let liveJob = null;
  let lastFinishedJobId = null;
  let watchJobTimer = null;
  let activeWatcher = null;
  let dockPhase = null; // "queued" | "running" | "done" | "error" | null
  let dockOk = null;
  let dockExpanded = false;
  let dockJobStartedAt = null;
  let dockJobFinishedAt = null;
  let dockElapsedTimer = null;
  let dockHistoryTab = "all"; // "all" | "active" | "admin"
  let dockLiveLogOpen = false;
  let adminJobLogActive = false;
  let farmActivityData = null;
  let farmDockFlash = { text: "", kind: "muted" };
  let apiReady = false;
  let adminJobsTab = "live"; // "live" | "history"
  let adminJobsFilter = "all"; // "all" | "running" | "queued" | "stuck"
  let adminJobsItems = [];
  let adminJobsOffset = 0;
  let adminJobsPollTimer = null;
  let adminJobsHasMore = false;
  const ADMIN_JOBS_PAGE = 30;
  const PEEK_COOLDOWN_SEC = 180;
  const PEEK_CD_KEY = "ckr_peek_cd_until";

  const ERR_TH = {
    insufficient_tokens: "ระบบยังคิดเป็นเหรียญเก่า — รีเฟรชหน้าแล้วลองใหม่ หรือติดต่อแอดมิน",
    rental_required: "ต้องเช่าใช้งานก่อน — กด ต่ออายุ เพื่อซื้อแพ็กวัน",
    rental_expired: "วันเช่าหมดอายุแล้ว — ต่ออายุในเมนู ต่ออายุ",
    insufficient_tokens_for_peek:
      "ต้องมีสิทธิ์เช่าถึงจะดูสถานะบัญชีเกมได้",
    peek_rate_limited: "ดูสถานะถี่เกินไป รอให้ครบเวลาก่อน",
    refresh_rate_limited: "รีเฟรชถี่เกินไป รอสักครู่แล้วลองใหม่",
    refresh_failed: "อัปเดตสถานะไม่สำเร็จ ลองใหม่",
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
    TMN_BLOCKED: "TrueMoney บล็อกการเชื่อมต่อ — ลองใหม่หรือติดต่อแอดมิน",
    TMN_CLIENT_MISSING: "ระบบเติมเงินยังติดตั้งไม่ครบ — ติดต่อแอดมิน",
    INVALID_JSON_RESPONSE: "เชื่อมต่อ TrueMoney ไม่สำเร็จ — ลองใหม่ภายหลัง",
    AMOUNT_MISMATCH_AFTER_REDEEM: "รับซองแล้วแต่ยอดไม่ตรงแพ็ก — ติดต่อแอดมิน",
    topup_credit_failed: "รับซองแล้วแต่ต่ออายุเช่าไม่สำเร็จ — ติดต่อแอดมิน",
    feature_entitlement_required: "ฟังก์ชันนี้ยังไม่ได้ปลดล็อก — ซื้อแพ็กเต็มหรือแพ็กเสริม 50฿",
    feature_pick_pending: "เลือกฟังก์ชันจากแพ็ก 50฿ ก่อนหน้าให้เสร็จก่อน",
    feature_pick_not_pending: "ไม่มีแพ็กที่รอเลือกฟังก์ชัน",
    invalid_feature: "ฟังก์ชันที่เลือกไม่ถูกต้อง",
    session_replaced: "มีการเข้าสู่ระบบจากที่อื่น — กรุณาเข้าสู่ระบบใหม่",
    invalid_token: "เซสชันเว็บหมดอายุ — ออกแล้วเข้าสู่ระบบใหม่ แล้วค่อยเชื่อม DevPlay",
    missing_bearer_token: "ยังไม่ได้เข้าสู่ระบบเว็บ — กรุณาเข้าสู่ระบบก่อนเชื่อม DevPlay",
    timeout: "เซิร์ฟเวอร์ตอบช้า — ลองใหม่สักครู่",
    account_banned: "บัญชีถูกระงับ กรุณาติดต่อแอดมิน",
    game_account_banned: "บัญชีเกมถูกระงับ/แบน — เข้าเกมด้วยบัญชีนี้ไม่ได้",
    game_access_denied: "เซิร์ฟเวอร์เกมปฏิเสธการเข้าถึงบัญชีนี้",
    devplay_wrong_password: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    devplay_not_found: "ไม่พบบัญชีนี้ในระบบ DevPlay",
    devplay_rate_limited: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
    devplay_account_locked: "บัญชี DevPlay ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง",
    maintenance: "ระบบปิดปรับปรุงชั่วคราว ลองใหม่ภายหลัง",
    feature_locked: "ปิดปรับปรุง ไม่สามารถใช้งานได้",
    value_capped: "เหรียญสูงสุด 449,000 · XP สูงสุด 52,000",
    devplay_session_expired: "เชื่อม DevPlay หมดอายุ — กดเชื่อมต่อใหม่",
    not_enough_tickets: "ตั๋ว Party Run ไม่พอ — ลดจำนวนตั๋วหรือรอรีเซ็ต",
    connect_failed: "เชื่อม DevPlay ไม่สำเร็จ",
    owner_not_lv8: "ต้องมีเจ้าของสมบัติ Lv.8 ก่อน",
    insufficient_coin: "เหรียญไม่พอแม้ 1 รอบ",
    already_owned: "มีคุกกี้นี้ในไอดีแล้ว — ซื้อไม่ได้",
    cookie_selection_empty: "เลือกคุกกี้ที่ปลดล็อกหรืออัปเกรดได้ก่อน",
    cookie_list_failed: "โหลดรายการคุกกี้ไม่สำเร็จ",
    cookie_estimate_failed: "คำนวณราคาคุกกี้ไม่สำเร็จ",
    cookie_catalog_missing: "แคตตาล็อกคุกกี้ยังไม่พร้อมบนเซิร์ฟเวอร์",
    already_maxed: "คุกกี้อัปเกรดเต็มแล้ว",
    powder_session_missing: "เชื่อม DevPlay ใหม่ (ไม่มี session ผง)",
    no_gift_boxes: "ไม่มีกล่องขวัญในไอดีนี้ — ต้องมี Gift Point ครบ 100 ต่อ 1 กล่อง",
    heart_disabled: "ฟาร์มหัวใจปิดใช้งานอยู่ — รอแอดมินเปิด",
    heart_proxy_not_configured: "ระบบ Proxy ร้านยังไม่พร้อม — แจ้งแอดมิน",
    proxy_url_required: "ระบบ Proxy ร้านยังไม่พร้อม — แจ้งแอดมิน",
    proxy_url_invalid: "รูปแบบ proxy ไม่ถูกต้อง",
    heart_timeout: "ฟาร์มหัวใจใช้เวลานานเกินกำหนด — ลองลดจำนวนหัวใจแล้วรันใหม่",
    no_hearts_collected: "เก็บหัวใจไม่ได้เลย — ลองใหม่อีกครั้ง",
    incomplete_hearts: "ฟาร์มหัวใจไม่ครบตามเป้า",
    incomplete_powder: "ฟาร์มผงได้บางส่วน — ไม่ครบตามเป้า",
    powder_failed: "ฟาร์มผงไม่สำเร็จ ลองใหม่อีกครั้ง",
    buy_failed: "ซื้อสมบัติไม่สำเร็จ — เหรียญไม่พอหรือร้านปฏิเสธ",
    guest_creation_failed: "สร้าง guest ไม่สำเร็จ — ตรวจ proxy แล้วลองใหม่",
    heart_error: "ฟาร์มหัวใจไม่สำเร็จ ลองใหม่อีกครั้ง",
    giftdraw_failed: "เปิดกล่องขวัญไม่สำเร็จ ลองใหม่อีกครั้ง",
    treasure_not_found: "ไม่พบสมบัติที่เลือก",
    farm_busy: "ระบบกำลังยุ่งอยู่ — เข้าคิวให้อัตโนมัติแล้ว",
    farm_error: "การฟาร์มล้มเหลว ลองใหม่อีกครั้ง",
    job_tracking_unavailable: "ไม่สามารถติดตามงานบนเซิร์ฟเวอร์ได้ — กดรีเฟรชสถานะหรือลองใหม่",
    job_poll_failed: "ขาดการเชื่อมต่อชั่วคราว — เปิดแถบสถานะแล้วกดรีเฟรช",
    job_status_unavailable: "อ่านสถานะงานไม่ได้ — ลองใหม่",
    already_running: "มีงานกำลังรันอยู่แล้ว — เปิดแถบสถานะเพื่อดูคิว/ยกเลิก",
    worker_unavailable: "worker กำลังรีสตาร์ท — คิวจะเริ่มต่ออัตโนมัติ",
    cancelling: "กำลังยกเลิกงาน… รอสักครู่",
    consume_failed: "ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง",
    login_no_session: "เข้าสู่ระบบไม่สำเร็จ",
    network_error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง",
    Invalid: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    invalid_credentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    username_taken: "ชื่อผู้ใช้นี้ถูกใช้แล้ว ลองชื่ออื่น",
    password_mismatch: "รหัสผ่านกับยืนยันรหัสผ่านไม่ตรงกัน",
    password_unchanged: "รหัสใหม่ต้องต่างจากรหัสเดิม",
    password_changed: "เปลี่ยนรหัสผ่านสำเร็จ — เข้าสู่ระบบด้วยรหัสใหม่ได้เลย",
    api_not_ready: "รอให้เซิร์ฟเวอร์พร้อม (ไฟเขียว) ก่อนเข้าสู่ระบบ",
    invalid_username: "ชื่อผู้ใช้ไม่ถูกต้อง (ห้ามใช้อีเมล)",
    signup_closed: "ขณะนี้ปิดรับสมัครผ่านเว็บ กรุณาติดต่อแอดมินทาง Telegram",
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
    rate_limited: "เรียกถี่เกินไป รอสักครู่แล้วลองใหม่",
    account_info_failed: "โหลดข้อมูลไอดีไม่สำเร็จ ลองใหม่",
  };

  function thError(raw) {
    if (!raw) return "เกิดข้อผิดพลาด";
    const s = String(raw);
    // Prefer longer keys first so "invalid_token" wins over "Invalid".
    const keys = Object.keys(ERR_TH).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (s === k || s.includes(k)) return ERR_TH[k];
    }
    if (/Cannot redeem your voucher by yourself|own voucher/i.test(s)) {
      return ERR_TH.CANNOT_GET_OWN_VOUCHER;
    }
    if (/LOGIN FAILED|wrong email|DevPlay/i.test(s)) {
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
    // Website login typos only — never map session / API codes via /user|password/.
    if (/^invalid_credentials$/i.test(s) || /^Invalid$/i.test(s)) {
      return ERR_TH.invalid_credentials;
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
    const kind = state || "waking";
    loginApiState = kind;
    // In-app sidebar chip only — login page is never gated on this.
    const el = $("api-status-menu");
    if (el) {
      el.className = "api-status-btn is-" + kind;
      const textEl = el.querySelector(".api-chip-label");
      if (textEl) textEl.textContent = label;
      else el.textContent = label;
      el.title = "กดดูสถานะ worker งานหนัก / งานเบา";
    }
  }

  function paintWorkerPools(workers) {
    const detail = $("api-status-detail");
    if (!detail) return;
    const pools = workers && typeof workers === "object" ? workers : {};
    ["heavy", "light"].forEach((role) => {
      const row = detail.querySelector('.api-worker-row[data-role="' + role + '"]');
      const stateEl = $("api-worker-" + role + "-state");
      const pool = pools[role] || {};
      const alive = !!pool.alive;
      if (row) {
        const dot = row.querySelector(".api-worker-dot");
        if (dot) {
          dot.classList.toggle("is-alive", alive);
          dot.classList.toggle("is-down", !alive);
        }
      }
      if (!stateEl) return;
      if (alive) {
        const slots = Number.isFinite(Number(pool.slots)) ? Number(pool.slots) : null;
        const id = pool.id ? String(pool.id) : role;
        stateEl.textContent =
          "พร้อมใช้งาน · " +
          id +
          (slots != null ? " · " + slots + " slot" : "");
      } else {
        stateEl.textContent = pool.detail || "ออฟไลน์ — งานกลุ่มนี้จะค้างในคิว";
      }
    });
  }

  function setApiStatusDetailOpen(open) {
    const btn = $("api-status-menu");
    const detail = $("api-status-detail");
    if (!btn || !detail) return;
    const next = !!open;
    detail.classList.toggle("hidden", !next);
    detail.hidden = !next;
    btn.setAttribute("aria-expanded", next ? "true" : "false");
  }

  function toggleApiStatusDetail() {
    const detail = $("api-status-detail");
    if (!detail) return;
    const open = detail.hidden || detail.classList.contains("hidden");
    setApiStatusDetailOpen(open);
    if (open) {
      refreshFullHealthInBackground();
      paintWorkerPools(lastHealth && lastHealth.workers);
    }
  }

  async function deriveAutoLoginKey() {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey(
      "raw",
      enc.encode("ckr-auto-login|" + (cfg.SUPABASE_URL || "local")),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("ckr-auto-login-salt-v1"),
        iterations: 80000,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function saveAutoLoginCreds(username, password) {
    if (!wantsRemember()) {
      clearAutoLoginCreds();
      return;
    }
    try {
      const key = await deriveAutoLoginKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode(
        JSON.stringify({ username: String(username || "").trim(), password: String(password || "") })
      );
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
      const pack = {
        v: 1,
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(cipher))),
      };
      localStorage.setItem(AUTO_LOGIN_KEY, JSON.stringify(pack));
    } catch (_) {
      clearAutoLoginCreds();
    }
  }

  function clearAutoLoginCreds() {
    try {
      localStorage.removeItem(AUTO_LOGIN_KEY);
    } catch (_) {}
  }

  async function loadAutoLoginCreds() {
    if (!wantsRemember()) return null;
    try {
      const raw = localStorage.getItem(AUTO_LOGIN_KEY);
      if (!raw) return null;
      const pack = JSON.parse(raw);
      if (!pack || pack.v !== 1 || !pack.iv || !pack.data) return null;
      const key = await deriveAutoLoginKey();
      const iv = Uint8Array.from(atob(pack.iv), (c) => c.charCodeAt(0));
      const data = Uint8Array.from(atob(pack.data), (c) => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
      const obj = JSON.parse(new TextDecoder().decode(plain));
      if (!obj?.username || !obj?.password) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  async function tryAutoLogin() {
    if (autoLoginAttempted || authBusy) return;
    if (accessToken || !loginView || loginView.classList.contains("hidden")) return;
    if (!wantsRemember()) return;
    autoLoginAttempted = true;
    const creds = await loadAutoLoginCreds();
    if (!creds) return;
    if ($("login-user")) $("login-user").value = creds.username;
    if ($("login-pass")) $("login-pass").value = creds.password;
    setAuthMode("login");
    setStatus($("login-status"), "กำลังเข้าสู่ระบบอัตโนมัติ…", "muted");
    await performLogin(creds.username, creds.password, true);
  }

  async function performLogin(username, password, fromAuto) {
    if (authBusy) return false;
    authBusy = true;
    const loginBtn = $("login-btn");
    if (loginBtn) loginBtn.disabled = true;
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { username, password },
        timeoutMs: 20000,
      });
      if (!data.access_token || !data.refresh_token) {
        throw new Error("login_no_session");
      }
      const sessionRace = sb.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      const sessionResult = await Promise.race([
        sessionRace,
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 12000)
        ),
      ]);
      if (sessionResult?.error) throw sessionResult.error;
      accessToken = data.access_token;
      persistSessionToken(data.session_token || null);
      profile = data.profile;
      setRememberPref(!!($("remember-me")?.checked || fromAuto));
      if (wantsRemember()) await saveAutoLoginCreds(username, password);
      else clearAutoLoginCreds();
      setStatus($("login-status"), "", "muted");
      setupDevPlayAutofillGuards();
      try {
        await api("/api/me", { timeoutMs: 15000 }).then((me) => {
          applyEarlyAccess(
            me?.early_access_features || me?.profile?.early_access_features
          );
          if (Array.isArray(me?.farm_feature_order)) applyFarmFeatureOrder(me.farm_feature_order);
          if (me?.profile) profile = me.profile;
        });
        await loadDevPlayVault().catch(() => {});
        paintProfile();
        showApp();
      } catch (meErr) {
        // Login already succeeded — enter app with profile from /auth/login.
        paintProfile();
        showApp();
        console.warn("refresh after login failed", meErr);
      }
      paintDevPlayAccountPicker();
      pingApiHealth(1).catch(() => {});
      if (!fromAuto) showToast("เข้าสู่ระบบแล้ว", "ok");
      return true;
    } catch (e) {
      if (fromAuto) clearAutoLoginCreds();
      const msg = thError(e.message || e.code) || "เข้าสู่ระบบไม่สำเร็จ";
      setStatus($("login-status"), "", "muted");
      showErrorModal(msg, fromAuto ? "เข้าอัตโนมัติไม่สำเร็จ" : "เข้าสู่ระบบไม่สำเร็จ");
      return false;
    } finally {
      authBusy = false;
      if (loginBtn) loginBtn.disabled = false;
    }
  }

  async function pingApiHealth(retries) {
    const tries = Math.max(1, Number(retries) || 1);
    paintApiStatus("waking", "กำลังตรวจเซิร์ฟเวอร์…");
    for (let i = 0; i < tries; i++) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      // Login glow uses ultra-light /api/ready (no Supabase). Full /api/health loads after.
      const timer = setTimeout(() => {
        try {
          ctrl?.abort();
        } catch (_) {}
      }, 3500);
      try {
        const res = await fetch(API + "/api/ready", {
          method: "GET",
          signal: ctrl?.signal,
          cache: "no-store",
        });
        clearTimeout(timer);
        if (res.ok) {
          apiReady = true;
          paintApiStatus("ready", "API พร้อม");
          // Enrich UI in background — must not gate the green glow.
          refreshFullHealthInBackground();
          return true;
        }
      } catch (_) {
        clearTimeout(timer);
      }
      if (i < tries - 1) {
        paintApiStatus("waking", "กำลังตรวจเซิร์ฟเวอร์…");
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    apiReady = false;
    paintApiStatus("down", "API ยังไม่พร้อม");
    return false;
  }

  let fullHealthInflight = null;
  function refreshFullHealthInBackground() {
    if (fullHealthInflight) return fullHealthInflight;
    fullHealthInflight = (async () => {
      try {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = setTimeout(() => {
          try {
            ctrl?.abort();
          } catch (_) {}
        }, 8000);
        const res = await fetch(API + "/api/health", {
          method: "GET",
          signal: ctrl?.signal,
          cache: "no-store",
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        if (Number.isFinite(data.farm_coin_max)) farmCoinMax = data.farm_coin_max;
        if (Number.isFinite(data.farm_exp_max)) farmExpMax = data.farm_exp_max;
        if (Number.isFinite(data.powder_max_target)) {
          powderMax = Math.max(1, Math.floor(Number(data.powder_max_target)));
          clampPowderTargetInputs();
        }
        const coinEl = $("farm-coin");
        const expEl = $("farm-exp");
        if (coinEl) {
          coinEl.dataset.farmCap = String(farmCoinMax);
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
        lastHealth = data;
        paintMaintenanceBanner(data);
        paintProxyPool(data.proxy_pool || null);
        paintWorkerPools(data.workers || null);
        if (Number.isFinite(data.workers_alive)) {
          window.__ckrWorkersAlive = Number(data.workers_alive);
        }
        window.__ckrWorkerRecycling = !!data.worker_recycling;
        if (Number.isFinite(data.memory_pct)) {
          window.__ckrMemoryPct = Number(data.memory_pct);
          window.__ckrMemoryUsedMb = Number(data.memory_used_mb);
          window.__ckrMemoryTotalMb = Number(data.memory_total_mb);
        }
        if (isAdminUser()) renderAdminWorkerChip();
        if (accessToken) loadProxyPool().catch(() => {});
      } catch (_) {
        paintMaintenanceBanner(null);
      } finally {
        fullHealthInflight = null;
      }
    })();
    return fullHealthInflight;
  }

  function applyFeatureLocks(locks) {
    if (!locks || typeof locks !== "object") return;
    const next = { ...featureLocks };
    Object.keys(next).forEach((k) => {
      if (k in locks) next[k] = !!locks[k];
    });
    featureLocks = next;
    paintFeatureLocks();
    updateFarmAvailability();
  }

  function normalizeFarmFeatureOrder(raw) {
    const allowed = new Set(DEFAULT_FARM_FEATURE_ORDER);
    const seen = new Set();
    const out = [];
    if (Array.isArray(raw)) {
      raw.forEach((item) => {
        let k = String(item || "").trim();
        if (k === "cookie_unlock") k = "cookie";
        if (!allowed.has(k) || seen.has(k)) return;
        seen.add(k);
        out.push(k);
      });
    }
    DEFAULT_FARM_FEATURE_ORDER.forEach((k) => {
      if (!seen.has(k)) out.push(k);
    });
    return out;
  }

  function applyFarmFeatureOrder(raw) {
    farmFeatureOrder = normalizeFarmFeatureOrder(raw);
    FARM_DOCK_TABS = farmFeatureOrder.filter((t) => FARM_DOCK_TAB_SET.has(t));
    const nav = $("farm-bottom-nav");
    if (nav) {
      farmFeatureOrder.forEach((key) => {
        const btn = $("farm-tab-" + key);
        if (btn) nav.appendChild(btn);
      });
      const pin = $("farm-tab-devplay");
      if (pin) nav.insertBefore(pin, nav.firstChild);
    }
    paintFeatureDock();
  }

  function showFeatureLockedModal(tab) {
    const labels = {
      partyrun: "Party Run",
      heart: "ฟาร์มหัวใจ",
      powder: "ฟาร์มผง",
      giftdraw: "เปิดกล่องขวัญ",
      upgrade: "ตีบวกสมบัติ",
      cookie: "ปลดล็อกคุกกี้",
      reroll: "รีโรล",
      quest: "เควส",
      account: "ข้อมูลไอดี",
      dstool: "ทดสอบเกม",
      afterplay_fast: "ฟาร์มเงิน/XP",
      unlock_l: "ปลดล็อค L",
    };
    const name = labels[tab] || tab || "ฟีเจอร์นี้";
    showErrorModal(
      "ปิดปรับปรุง ไม่สามารถใช้งานได้\n(" + name + ")",
      "ปิดปรับปรุง"
    );
  }

  function paintFeatureLocks() {
    const admin = isAdminUser();
    FARM_DOCK_TABS.forEach((t) => {
      const btn = $("farm-tab-" + t);
      const closed = isFeatureClosed(t);
      const hide = isFeatureLocked(t);
      if (btn) {
        btn.classList.toggle("is-feature-locked", closed && admin);
        btn.classList.toggle("is-feature-hidden", hide);
        btn.hidden = hide;
        btn.title = closed && admin
          ? "ปิดปรับปรุงสำหรับลูกค้า — แอดมินใช้ได้"
          : "";
        const pill = btn.querySelector(".farm-nav-pill");
        if (pill) {
          let badge = pill.querySelector(".farm-nav-maint");
          if (admin && closed) {
            if (!badge) {
              badge = document.createElement("span");
              badge.className = "farm-nav-maint";
              badge.textContent = "ปิด";
              pill.appendChild(badge);
            }
          } else if (badge) {
            badge.remove();
          }
        }
      }
      const side = $("menu-nav-" + t);
      if (side) {
        side.hidden = hide;
        side.classList.toggle("hidden", hide);
        side.classList.toggle("is-feature-hidden", hide);
        side.classList.toggle("is-feature-locked", closed && admin);
        side.title = closed && admin
          ? "ปิดปรับปรุงสำหรับลูกค้า — แอดมินใช้ได้"
          : "";
      }
    });
    paintFeatureDock();
    syncCreditJobLogButtons();
  }

  function devPlayCookiePortraitUrl(name) {
    const n = String(name || "").trim();
    if (!n) return "";
    return DEVPLAY_PORTRAIT_CDN + "/" + encodeURIComponent(n) + ".png";
  }

  function resolveDevPlayAvatarUrl(session) {
    if (!session) return DEVPLAY_AVATAR_FALLBACK;
    // Cookie CDN is the reliable portrait; local assets_web/profiles is not shipped.
    const cookieUrl = devPlayCookiePortraitUrl(session.cookieName);
    if (cookieUrl) return cookieUrl;
    const key = String(session.profileImageKey || "").trim();
    if (key) {
      const file = key.endsWith(".png") ? key : key + ".png";
      return "assets_web/profiles/" + encodeURIComponent(file).replace(/%2F/gi, "/");
    }
    return DEVPLAY_AVATAR_FALLBACK;
  }

  function paintPlayerHeroAvatar() {
    const primary = resolveDevPlayAvatarUrl(devplaySession);
    const cookieFallback = devPlayCookiePortraitUrl(devplaySession?.cookieName);
    ["player-hero-avatar", "player-head-chip-avatar"].forEach((id) => {
      const img = $(id);
      if (!img) return;
      if (img.dataset.src === primary && img.getAttribute("src") === primary) return;
      img.dataset.src = primary;
      img.onerror = () => {
        if (cookieFallback && img.src !== cookieFallback && !String(img.src).includes(cookieFallback)) {
          img.src = cookieFallback;
          return;
        }
        img.onerror = null;
        img.src = DEVPLAY_AVATAR_FALLBACK;
      };
      img.src = primary;
    });
  }

  function paintFeatureDock() {
    const grid = $("feature-dock-grid");
    const empty = $("feature-dock-empty");
    if (!grid) return;
    const connected = isDevPlayConnected();
    const openTabs = connected ? FARM_DOCK_TABS.filter((t) => !isFeatureLocked(t)) : [];
    grid.innerHTML = "";
    if (!openTabs.length) {
      if (empty) {
        empty.classList.toggle("hidden", connected);
        empty.hidden = connected;
      }
      return;
    }
    if (empty) {
      empty.classList.add("hidden");
      empty.hidden = true;
    }
    openTabs.forEach((tab) => {
      const meta = FARM_TAB_META[tab];
      if (!meta) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feature-dock-card";
      btn.dataset.shortcutTab = tab;
      btn.setAttribute("role", "listitem");
      const icon = document.createElement("img");
      icon.className = "feature-dock-card-icon";
      icon.src = "assets/" + meta.icon;
      icon.alt = "";
      icon.width = 40;
      icon.height = 40;
      const title = document.createElement("span");
      title.className = "feature-dock-card-title";
      title.textContent = meta.title;
      const blurb = document.createElement("p");
      blurb.className = "feature-dock-card-blurb";
      blurb.textContent = meta.blurb || meta.hint || "";
      btn.append(icon, title, blurb);
      grid.appendChild(btn);
    });
  }

  function paintMaintenanceBanner(health) {
    applySignupClosed(!!(health && health.signup_closed));
    const el = $("maintenance-banner");
    if (!el) return;
    if (health && Array.isArray(health.farm_feature_order)) applyFarmFeatureOrder(health.farm_feature_order);
    if (health && health.feature_locks) applyFeatureLocks(health.feature_locks);
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

  const SIGNUP_HINT_OPEN = "ตั้งชื่อผู้ใช้และรหัสผ่าน (ยืนยันรหัสผ่านให้ตรงกัน)";
  const SIGNUP_HINT_CLOSED = "ขณะนี้ปิดรับสมัครผ่านเว็บ กรุณาติดต่อแอดมินทาง Telegram เพื่อขอเปิดบัญชี";

  function applySignupClosed(closed) {
    const on = !!closed;
    const form = $("signup-form");
    const closedEl = $("signup-closed");
    const hint = $("signup-hint");
    const tab = $("tab-signup");
    if (form) {
      form.classList.toggle("hidden", on);
      form.hidden = on;
      form.querySelectorAll("input, button").forEach((el) => {
        el.disabled = on;
      });
    }
    if (closedEl) {
      closedEl.classList.toggle("hidden", !on);
      closedEl.hidden = !on;
    }
    if (hint) hint.textContent = on ? SIGNUP_HINT_CLOSED : SIGNUP_HINT_OPEN;
    if (tab) tab.setAttribute("aria-controls", on ? "signup-closed" : "signup-form");
    const tg = $("signup-telegram-btn");
    if (tg) tg.setAttribute("href", TELEGRAM_URL);
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
    earlyAccessFeatures = new Set();
    clearSessionToken();
    showLogin();
    showErrorModal(ERR_TH.session_replaced, "มีการเข้าสู่ระบบจากที่อื่น");
  }

  function isRentalPermanent(p) {
    if (!p) return false;
    return !!(p.rental_is_permanent ?? p.is_permanent);
  }

  function isAdminUser(p) {
    const row = p || profile;
    if (!row) return false;
    if (row.is_admin === true) return true;
    return String(row.role || "").toLowerCase() === "admin";
  }

  function isFeatureClosed(tab) {
    const key = tab === "cookie_unlock" ? "cookie" : tab;
    return !!featureLocks[key];
  }

  function applyEarlyAccess(features) {
    const next = new Set();
    if (Array.isArray(features)) {
      features.forEach((item) => {
        const key = item === "cookie_unlock" ? "cookie" : String(item || "").trim();
        if (key) next.add(key);
      });
    }
    earlyAccessFeatures = next;
    paintFeatureLocks();
    updateFarmAvailability();
  }

  function hasEarlyAccess(tab) {
    const key = tab === "cookie_unlock" ? "cookie" : tab;
    return earlyAccessFeatures.has(key);
  }

  function isFeatureLocked(tab) {
    if (isAdminUser()) return false;
    if (hasEarlyAccess(tab)) return false;
    return isFeatureClosed(tab);
  }

  function normalizeFeatureKey(feature) {
    const key = String(feature || "")
      .trim()
      .toLowerCase();
    const aliases = {
      farm_run: "partyrun",
      heart_run: "heart",
      powder_run: "powder",
      giftdraw_run: "giftdraw",
      cookie_unlock: "cookie",
    };
    return aliases[key] || key;
  }

  function featureEntitlementRow(feature) {
    const key = normalizeFeatureKey(feature);
    const ents = profile?.feature_entitlements;
    if (!ents || typeof ents !== "object") return null;
    return ents[key] || null;
  }

  function hasFeatureAccess(feature) {
    if (!profile) return false;
    if (isAdminUser(profile) || isRentalPermanent(profile)) return true;
    const key = normalizeFeatureKey(feature);
    const row = featureEntitlementRow(key);
    if (row) {
      if (row.active === true || row.permanent === true) return true;
      const exp = row.expires_at ? Date.parse(row.expires_at) : NaN;
      if (Number.isFinite(exp) && exp > Date.now()) return true;
      return false;
    }
    // Legacy profiles: no per-feature map → any active rental covers all.
    const ents = profile.feature_entitlements;
    if (!ents || !Object.keys(ents).length) {
      return hasFarmAccessLegacy();
    }
    // Non-consumer tools: any active consumer entitlement is enough.
    if (!CONSUMER_FEATURES.includes(key)) {
      return hasFarmAccess();
    }
    return false;
  }

  function hasFarmAccessLegacy() {
    if (!profile) return false;
    if (isAdminUser(profile) || isRentalPermanent(profile)) return true;
    const exp = profile.rental_expires_at ? Date.parse(profile.rental_expires_at) : NaN;
    if (Number.isFinite(exp) && exp > Date.now()) return true;
    return profile.farm_access === true;
  }

  function hasFarmAccess() {
    if (!profile) return false;
    if (isAdminUser(profile)) return true;
    if (isRentalPermanent(profile)) return true;
    const ents = profile.feature_entitlements;
    if (ents && typeof ents === "object") {
      for (const key of CONSUMER_FEATURES) {
        if (hasFeatureAccess(key)) return true;
      }
      // If map exists but all expired, fall through to display clock / flag.
      if (Object.keys(ents).length) {
        const exp = profile.rental_expires_at ? Date.parse(profile.rental_expires_at) : NaN;
        if (Number.isFinite(exp) && exp > Date.now()) return true;
        return false;
      }
    }
    return hasFarmAccessLegacy();
  }

  function featureRemainingLabel(feature) {
    if (isAdminUser(profile) || isRentalPermanent(profile)) return "ถาวร";
    const row = featureEntitlementRow(feature);
    if (!row) return "";
    if (row.permanent) return "ถาวร";
    const exp = row.expires_at ? Date.parse(row.expires_at) : NaN;
    if (!Number.isFinite(exp) || exp <= Date.now()) return "";
    const ms = exp - Date.now();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 48) return Math.ceil(h / 24) + " วัน";
    if (h >= 1) return h + " ชม." + (m > 0 ? " " + m + " น." : "");
    return Math.max(1, m) + " น.";
  }

  function requireFeatureAccess(feature) {
    if (hasFeatureAccess(feature)) return true;
    if (hasFarmAccess()) {
      showFeatureLockedModal(feature);
    } else {
      showEmptyCoinsModal();
    }
    return false;
  }

  function showFeatureLockedModal(feature) {
    const key = normalizeFeatureKey(feature);
    const label = FEATURE_LABEL_TH[key] || key;
    clearModalActions();
    openModal({
      mode: "empty",
      title: "ยังไม่ได้ปลดล็อก " + label,
      body:
        "ซื้อแพ็กวันเช่าเพื่อปลดทุกฟังก์ชัน หรือแพ็กเสริม 50฿ แล้วเลือกเฉพาะ " +
        label,
      icon: "assets/reward_icon_partyrun_ticket.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ไปต่ออายุ / ซื้อแพ็ก", "btn-candy", () => {
        closeModal();
        openVaultModal({ focusVoucher: true });
      })
    );
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
      const parts = ["เช่าถึง " + rentalStatusLabel()];
      const rem = rentalRemainingParts();
      if (rem) parts.unshift("เหลือ " + formatRentalRemaining(rem));
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
    if (data.feature_entitlements !== undefined) {
      profile.feature_entitlements = data.feature_entitlements;
    }
    if (data.pending_feature_pick !== undefined) {
      profile.pending_feature_pick = data.pending_feature_pick;
    }
    if (data.invite_credit_balance !== undefined) {
      profile.invite_credit_balance = data.invite_credit_balance;
      paintInviteStats({ invite_credit_balance: data.invite_credit_balance });
    }
    paintProfile();
  }

  function handleRentalDenied(e) {
    forceCloseRunStatusPopup();
    const detail = e?.data?.detail;
    const code = String(
      (typeof detail === "object" && detail?.code) ||
        detail ||
        e?.message ||
        e?.data?.code ||
        ""
    );
    if (profile) {
      if (e?.data?.rental_expires_at !== undefined) {
        profile.rental_expires_at = e.data.rental_expires_at;
      }
      if (e?.data?.feature_entitlements !== undefined) {
        profile.feature_entitlements = e.data.feature_entitlements;
      }
      // Only sticky-deny when the API explicitly says farm_access=false
      // (or rental_* codes). Never clear access on generic 402 / legacy tokens.
      if (e?.data?.farm_access !== undefined) {
        profile.farm_access = e.data.farm_access;
      } else if (/rental_expired|rental_required/i.test(code)) {
        profile.farm_access = false;
      }
    }
    paintProfile();
    if (/feature_entitlement_required/i.test(code)) {
      const feat =
        (typeof detail === "object" && detail?.feature) ||
        e?.data?.feature ||
        "";
      showFeatureLockedModal(feat || "ฟังก์ชันนี้");
      return;
    }
    showEmptyCoinsModal();
  }

  function isRentalDeniedError(e) {
    const msg = String(e?.message || "");
    const detail = e?.data?.detail;
    const code =
      (typeof detail === "string" && detail) ||
      detail?.code ||
      e?.data?.code ||
      msg;
    // Real rental denials only — do NOT treat legacy insufficient_tokens as expiry.
    if (/rental_required|rental_expired/i.test(String(code)) || /rental_required|rental_expired/i.test(msg)) {
      return true;
    }
    if (/feature_entitlement_required/i.test(String(code)) || /feature_entitlement_required/i.test(msg)) {
      return true;
    }
    if (e?.status === 402 && e?.data?.farm_access === false) return true;
    return false;
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

  function openModal({ mode, title, body, icon, locked, bodyHtml, cardClass }) {
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
      modalCard.classList.remove("is-shake", "modal-card--picker");
      void modalCard.offsetWidth;
      if (mode === "error") modalCard.classList.add("is-shake");
      if (cardClass) modalCard.classList.add(cardClass);
    }
    animateOpen(modalRoot);
    const sheet = modalRoot.querySelector(".modal-card") || modalRoot;
    trapFocus(sheet);
  }

  function closeModal() {
    if (modalMode === "queue") return;
    if (modalMode === "proxy" && modalRoot.classList.contains("locked")) return;
    if (modalMode === "feature-pick" && modalRoot.classList.contains("locked")) return;
    if (modalMode === "empty") emptyModalDismissed = true;
    modalMode = null;
    clearModalActions();
    clearPixelConfetti();
    releaseFocusTrap();
    animateClose(modalRoot, () => {
      modalRoot.classList.remove("locked");
      if (modalCard) modalCard.classList.remove("is-shake", "modal-card--picker");
      stopBalancePoll();
    });
    // A completion modal was the result surface — don't reveal the finished
    // live-status popup underneath after the user dismisses it.
    if (jobStatusView === "expanded" && (dockPhase === "done" || dockPhase === "error")) {
      closeRunStatusPopup();
    }
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
        if (modalCard) modalCard.classList.remove("is-shake", "modal-card--picker");
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
      body: "ต่ออายุได้ทันที — เลือกแพ็ก 1/3/7 วัน หรือแพ็กเสริม 50฿ (1 ฟังก์ชัน)",
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
      makeBtn("ไป เชิญเพื่อน 29 คน", "btn-ghost", () => {
        closeModal();
        openInviteFriendTab();
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

  function openInviteFriendTab() {
    closeNavDrawer();
    switchFarmTab(INVITE_TAB, { silent: true });
    refreshInviteStatus()
      .then(() => resumeInviteJobIfAny())
      .catch(() => resumeInviteJobIfAny());
    if (window.matchMedia("(max-width: 860px)").matches) {
      setFarmSidebarOpen(false);
    }
  }

  function inviteCreditBalance() {
    return Number(profile?.invite_credit_balance || 0) || 0;
  }

  function persistInviteJob(jobId, creditsCharged) {
    inviteActiveJobId = jobId || null;
    if (creditsCharged != null) {
      inviteLastCharge = Number(creditsCharged) || 14;
    }
    try {
      if (jobId) {
        sessionStorage.setItem(INVITE_JOB_KEY, String(jobId));
        sessionStorage.setItem(INVITE_CHARGE_KEY, String(inviteLastCharge));
      } else {
        sessionStorage.removeItem(INVITE_JOB_KEY);
        sessionStorage.removeItem(INVITE_CHARGE_KEY);
      }
    } catch (_) {}
  }

  function loadPersistedInviteJob() {
    try {
      const id = sessionStorage.getItem(INVITE_JOB_KEY);
      const charge = sessionStorage.getItem(INVITE_CHARGE_KEY);
      if (charge != null) inviteLastCharge = Number(charge) || 14;
      return id || null;
    } catch (_) {
      return null;
    }
  }

  function setInviteRunning(on) {
    inviteRunning = !!on;
    const panel = document.querySelector(".invite-panel");
    panel?.classList.toggle("is-invite-running", inviteRunning);
    document.body.classList.toggle("invite-job-running", inviteRunning);
    $("menu-nav-invite")?.classList.toggle("is-live-running", inviteRunning);
    const startBtn = $("invite-start-btn");
    const link = $("invite-link-input");
    const topupBtn = $("invite-credit-open-btn");
    const refreshBtn = $("invite-refresh-btn");
    const title = $("invite-start-btn-title");
    const cancelBtn = $("invite-cancel-btn");
    if (title) {
      title.textContent = inviteRunning ? "กำลังเชิญเพื่อน…" : "เริ่มเชิญเพื่อน";
    }
    if (link) link.disabled = inviteRunning;
    if (refreshBtn) refreshBtn.disabled = inviteRunning;
    if ($("invite-start-btn-sub") && inviteRunning) {
      $("invite-start-btn-sub").textContent = "รอให้งานเสร็จก่อน";
    }
    if (cancelBtn) {
      cancelBtn.hidden = !inviteRunning;
      cancelBtn.classList.toggle("hidden", !inviteRunning);
      cancelBtn.disabled = false;
    }
    if (inviteRunning) {
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.classList.add("is-disabled-look");
      }
      if (topupBtn) {
        topupBtn.disabled = true;
        topupBtn.classList.add("is-disabled-look");
        topupBtn.title = "รอให้งานเชิญเพื่อนเสร็จก่อน";
      }
    } else {
      // Re-apply idle enable rules from latest stats
      paintInviteStats({
        invite_credit_balance: inviteCreditBalance(),
        pool_available: invitePoolAvailable,
      });
    }
  }

  function showInviteProgressCard(show) {
    const card = $("invite-progress-card");
    if (!card) return;
    card.hidden = !show;
    card.classList.toggle("hidden", !show);
  }

  function inviteTargetGuests(job) {
    const result =
      job?.result && typeof job.result === "object" ? job.result : {};
    return (
      Number(result.target) ||
      Number(job?.params?.target_guests) ||
      Number(job?.progress?.total) ||
      29
    );
  }

  function inviteEffectiveCount(result) {
    if (!result || typeof result !== "object") return 0;
    if (result.effective != null) return Number(result.effective) || 0;
    return (Number(result.success) || 0) + (Number(result.already) || 0);
  }

  function paintInviteResultSummary(job) {
    const el = $("invite-result-summary");
    if (!el) return;
    const status = String(job?.status || "");
    if (!["succeeded", "failed", "cancelled"].includes(status)) {
      el.hidden = true;
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    const result =
      job?.result && typeof job.result === "object" ? job.result : {};
    const target = inviteTargetGuests(job);
    const effective = inviteEffectiveCount(result);
    const failed = Number(result.failed) || 0;
    const charged =
      Number(job?.params?.cost_credits) || inviteLastCharge || 14;
    const refunded =
      Number(result.refunded_credits) ||
      Number(result.billing_outcome?.refund_credits) ||
      0;
    const net =
      result.net_credits != null
        ? Number(result.net_credits)
        : charged - refunded;
    let text = "";
    if (status === "cancelled") {
      text = "ยกเลิกแล้ว · ใช้ไป " + formatNumTh(charged) + " Credit (ไม่คืน)";
    } else if (status === "succeeded" || result.ok) {
      text =
        "สำเร็จ " +
        formatNumTh(effective) +
        "/" +
        formatNumTh(target) +
        " · หักสุทธิ " +
        formatNumTh(net) +
        " Credit";
    } else if (effective === 0) {
      text =
        "ไม่สำเร็จ — คืนเต็ม " +
        formatNumTh(refunded || charged) +
        " Credit";
    } else {
      text =
        "ไม่ครบ " +
        formatNumTh(target) +
        " — ได้ " +
        formatNumTh(effective) +
        "/" +
        formatNumTh(target) +
        (refunded ? " · คืน " + formatNumTh(refunded) + " Credit" : "") +
        (failed ? " · ล้มเหลว " + formatNumTh(failed) : "");
    }
    el.textContent = text;
    el.hidden = false;
    el.classList.remove("hidden");
    el.classList.toggle("is-ok", status === "succeeded" || !!result.ok);
    el.classList.toggle("is-err", status === "failed" || status === "cancelled");
  }

  function paintInviteProgress(job) {
    showInviteProgressCard(true);
    const prog = job?.progress || {};
    const target = inviteTargetGuests(job);
    const current = Number(prog.current) || inviteEffectiveCount(job?.result) || 0;
    const total = Number(prog.total) || target;
    const status = String(job?.status || "queued");
    const phase = String(prog.phase || "");
    const pct =
      total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const labelMap = {
      queued: "รอคิว…",
      running: "กำลังเชิญเพื่อน…",
      succeeded: "เชิญเพื่อนสำเร็จ",
      failed: "เชิญเพื่อนไม่สำเร็จ",
      cancelled: "ยกเลิกแล้ว",
    };
    let label = labelMap[status] || phase || status;
    if (phase.startsWith("topup")) {
      const m = phase.match(/topup\s+(\d+)\/(\d+)/i);
      label = m
        ? "กำลังเติมส่วนที่ขาด รอบ " + m[1] + "/" + m[2]
        : "กำลังเติมส่วนที่ขาด…";
    }
    if ($("invite-progress-label")) {
      $("invite-progress-label").textContent = label;
    }
    if ($("invite-progress-current")) {
      $("invite-progress-current").textContent = formatNumTh(current);
    }
    if ($("invite-progress-total")) {
      $("invite-progress-total").textContent = formatNumTh(total || 0);
    }
    if ($("invite-progress-pct")) {
      $("invite-progress-pct").textContent = pct + "%";
    }
    const fill = $("invite-progress-fill");
    if (fill) fill.style.width = pct + "%";
    const track = $("invite-progress-track");
    if (track) track.setAttribute("aria-valuenow", String(pct));
    const lines = Array.isArray(job?.logs) ? job.logs : [];
    if (lines.length) inviteLogLines = lines.slice(-200);
    const logBody = $("invite-log-body");
    if (logBody && !$("invite-log-modal")?.classList.contains("hidden")) {
      logBody.textContent = inviteLogLines.length
        ? inviteLogLines.join("\n")
        : "ยังไม่มี log";
    }
    const cancelBtn = $("invite-cancel-btn");
    const live = status === "queued" || status === "running";
    if (cancelBtn) {
      cancelBtn.hidden = !live;
      cancelBtn.classList.toggle("hidden", !live);
      cancelBtn.disabled = false;
      cancelBtn.textContent =
        job?.cancel_requested && live ? "กำลังยกเลิก…" : "ยกเลิก";
    }
    paintInviteResultSummary(job);
  }

  function selectedInviteCoins() {
    if (inviteSelectedPackageId === "invite_custom") {
      const n = Math.floor(Number(inviteCustomAmountBaht) || 0);
      return n >= 1 ? n : 0;
    }
    const list = invitePackages.length ? invitePackages : fallbackInvitePackages();
    const pkg =
      list.find((p) => p.id === inviteSelectedPackageId) || list[0] || null;
    return Number(pkg?.credits || pkg?.price_baht || 14) || 14;
  }

  function paintInviteSelectedCoin() {
    const el = $("invite-selected-coin");
    if (el) el.textContent = formatNumTh(selectedInviteCoins() || 0);
    const custom = $("invite-credit-custom-amount");
    if (custom && inviteSelectedPackageId === "invite_custom" && document.activeElement !== custom) {
      const n = selectedInviteCoins();
      custom.value = n > 0 ? String(n) : "";
    }
  }

  function applyInviteCustomAmount(raw, { copy } = {}) {
    const n = Math.floor(Number(String(raw ?? "").replace(/[^\d]/g, "")) || 0);
    if (n < 1) {
      setStatus($("invite-credit-status"), "ใส่จำนวนอย่างน้อย 1 บาท", "err");
      return false;
    }
    if (n > 100000) {
      setStatus($("invite-credit-status"), "สูงสุด 100,000 บาทต่อครั้ง", "err");
      return false;
    }
    inviteCustomAmountBaht = n;
    inviteSelectedPackageId = "invite_custom";
    if ($("invite-credit-custom-amount")) $("invite-credit-custom-amount").value = String(n);
    renderInviteCreditPackages();
    paintInviteSelectedCoin();
    if (copy) copyInviteCoinAmount(n).catch(() => {});
    else setStatus($("invite-credit-status"), "ใช้ยอด " + formatNumTh(n) + " coin — สร้างซองแล้ววางลิงก์", "ok");
    return true;
  }

  async function copyInviteCoinAmount(amount) {
    const text = String(amount != null ? amount : selectedInviteCoins());
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
      setStatus($("invite-credit-status"), "คัดลอก " + text + " coin แล้ว", "ok");
      showToast("คัดลอก " + text + " coin แล้ว", "ok");
      return true;
    } catch (_) {
      setStatus($("invite-credit-status"), "คัดลอกไม่สำเร็จ — จำ " + text + " coin", "err");
      showToast("คัดลอกไม่สำเร็จ — จำ " + text + " coin", "err");
      return false;
    }
  }

  async function cancelInviteJob() {
    const jobId = inviteActiveJobId || loadPersistedInviteJob();
    if (!jobId || !inviteRunning) return;
    const btn = $("invite-cancel-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "กำลังยกเลิก…";
    }
    setStatus($("invite-status"), "กำลังยกเลิกงาน…", "muted");
    try {
      await cancelServerJob(jobId);
      // Soft-cancel may stay running briefly — keep polling until terminal.
      showToast("ส่งคำขอยกเลิกแล้ว", "ok");
      if (!invitePollTimer) pollInviteJob(jobId);
    } catch (e) {
      setStatus(
        $("invite-status"),
        String(e?.userMessage || e?.message || "ยกเลิกไม่สำเร็จ"),
        "err"
      );
      if (btn) {
        btn.disabled = false;
        btn.textContent = "ยกเลิก";
      }
    }
  }

  function openInviteLogModal() {
    openCreditLogModal(inviteLogLines, "Log งานเชิญเพื่อน");
  }

  function openCreditLogModal(lines, title) {
    const modal = $("invite-log-modal");
    if (!modal) return;
    const heading = $("invite-log-title");
    if (heading) heading.textContent = title || "Log งาน";
    const body = $("invite-log-body");
    if (body) {
      const rows = Array.isArray(lines) ? lines : [];
      body.textContent = rows.length ? rows.join("\n") : "ยังไม่มี log";
    }
    animateOpen(modal);
    lockBodyScroll("invite-log-open");
    const sheet = modal.querySelector(".invite-log-sheet") || modal;
    trapFocus(sheet);
  }

  function closeInviteLogModal() {
    const modal = $("invite-log-modal");
    if (!modal) return;
    unlockBodyScroll("invite-log-open");
    releaseFocusTrap();
    animateClose(modal);
  }

  function showInviteResultModal(job) {
    const result =
      job?.result && typeof job.result === "object" ? job.result : {};
    const ok = !!result.ok;
    const target = inviteTargetGuests(job);
    const effective = inviteEffectiveCount(result);
    const success = Number(result.success) || 0;
    const failed = Number(result.failed) || 0;
    const already = Number(result.already) || 0;
    const mid =
      result.target_mid ||
      job?.params?.target_mid ||
      "—";
    const charged =
      Number(job?.params?.cost_credits) ||
      inviteLastCharge ||
      14;
    const refunded =
      Number(result.refunded_credits) ||
      Number(result.billing_outcome?.refund_credits) ||
      0;
    const net =
      result.net_credits != null
        ? Number(result.net_credits)
        : charged - refunded;
    const bal = inviteCreditBalance();
    let statusLabel = "ไม่สำเร็จ";
    if (ok) {
      statusLabel = "สำเร็จ";
    } else if (effective === 0) {
      statusLabel = "ไม่สำเร็จ — คืนเต็ม " + formatNumTh(refunded || charged) + " Credit";
    } else if (refunded > 0) {
      statusLabel =
        "ไม่ครบ " +
        formatNumTh(target) +
        " — คืน " +
        formatNumTh(refunded) +
        " Credit";
    }
    const rows = [
      ["สถานะ", statusLabel],
      ["Target MID", escapeHtml(String(mid))],
      ["เป้าหมาย", formatNumTh(target) + " คน"],
      ["ได้จริง", formatNumTh(effective) + " / " + formatNumTh(target)],
      ["สำเร็จ (ใหม่)", formatNumTh(success)],
      ["มี referrer แล้ว", formatNumTh(already)],
      ["ล้มเหลว", formatNumTh(failed)],
      ["เครดิตที่หัก", formatNumTh(charged) + " Credit"],
    ];
    if (refunded > 0) {
      rows.push(["คืนเครดิต", formatNumTh(refunded) + " Credit"]);
    }
    rows.push(["หักสุทธิ", formatNumTh(net) + " Credit"]);
    rows.push(["เครดิตคงเหลือ", formatNumTh(bal) + " Credit"]);
    if (!ok && (job?.error || result.error)) {
      rows.push(["รายละเอียด", escapeHtml(String(job.error || result.error))]);
    }
    const html =
      '<table class="result-table"><tbody>' +
      rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join("") +
      "</tbody></table>";
    clearModalActions();
    openModal({
      mode: "result",
      title: ok ? "เชิญเพื่อนสำเร็จ" : "เชิญเพื่อนจบแล้ว",
      bodyHtml: html,
      icon: "assets/icon_giftpoint.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
    modalActions.appendChild(
      makeBtn("ดู Log", "btn-ghost", () => {
        forceCloseModal();
        openInviteLogModal();
      })
    );
  }

  function paintInviteStats(data) {
    const bal = data?.invite_credit_balance ?? inviteCreditBalance();
    const ready = data?.ready;
    const links = data?.links_available;
    const cost = data?.cost_credits ?? 14;
    if (data && ("pool_available" in data || ready != null || links != null)) {
      if (typeof data.pool_available === "boolean") {
        invitePoolAvailable = data.pool_available;
      } else {
        const readyN = Number(ready);
        const linksN = Number(links);
        invitePoolAvailable =
          (Number.isFinite(readyN) ? readyN >= 29 : true) &&
          (Number.isFinite(linksN) ? linksN > 0 : true);
      }
    }
    if ($("invite-stat-credit")) $("invite-stat-credit").textContent = formatCredit(bal);
    if ($("invite-credit-balance-label")) {
      $("invite-credit-balance-label").textContent = formatCredit(bal);
    }
    if ($("afterplay-stat-credit")) $("afterplay-stat-credit").textContent = formatCredit(bal);
    if ($("unlockl-stat-credit")) $("unlockl-stat-credit").textContent = formatCredit(bal);
    if ($("invite-stat-ready") && ready != null) {
      $("invite-stat-ready").textContent = formatNumTh(ready);
    }
    if ($("invite-stat-links") && links != null) {
      $("invite-stat-links").textContent = formatNumTh(links);
    }
    if ($("invite-stat-cost")) $("invite-stat-cost").textContent = String(cost);
    if ($("invite-start-btn-sub") && !inviteRunning) {
      $("invite-start-btn-sub").textContent = invitePoolAvailable
        ? "หัก " + cost + " Credit ต่อครั้ง"
        : "Pool หมด — เริ่มไม่ได้";
    }
    const startBtn = $("invite-start-btn");
    if (startBtn) {
      const canRun = !inviteRunning && invitePoolAvailable && bal >= cost;
      startBtn.classList.toggle("is-disabled-look", !canRun);
      startBtn.disabled = !canRun;
    }
    const topupBtn = $("invite-credit-open-btn");
    if (topupBtn) {
      const canTopup = !inviteRunning && invitePoolAvailable;
      topupBtn.classList.toggle("is-disabled-look", !canTopup);
      topupBtn.disabled = !canTopup;
      topupBtn.title = inviteRunning
        ? "รอให้งานเชิญเพื่อนเสร็จก่อน"
        : invitePoolAvailable
          ? ""
          : "Pool หมด — เติม Credit ไม่ได้";
    }
    const note = $("invite-pool-empty-note");
    if (note) {
      note.hidden = invitePoolAvailable;
      note.classList.toggle("hidden", invitePoolAvailable);
    }
  }

  async function refreshInviteStatus() {
    if (!accessToken) return null;
    try {
      const data = await api("/api/invite/status");
      if (data?.invite_credit_balance != null && profile) {
        profile.invite_credit_balance = data.invite_credit_balance;
      }
      paintInviteStats(data);
      return data;
    } catch (_) {
      paintInviteStats({ invite_credit_balance: inviteCreditBalance() });
      return null;
    }
  }

  function openInviteCreditModal() {
    const modal = $("invite-credit-modal");
    if (!modal) return;
    if (inviteRunning) {
      setStatus($("invite-status"), "รอให้งานเชิญเพื่อนเสร็จก่อน", "err");
      showToast("รอให้งานเชิญเพื่อนเสร็จก่อน", "err");
      return;
    }
    paintInviteStats({ invite_credit_balance: inviteCreditBalance() });
    setStatus($("invite-credit-status"), "", "muted");
    if ($("invite-credit-voucher")) $("invite-credit-voucher").value = "";
    // Must use animateOpen + is-open — otherwise invisible overlay freezes the page.
    renderInviteCreditPackages();
    paintInviteSelectedCoin();
    animateOpen(modal);
    lockBodyScroll("invite-credit-open");
    const sheet = modal.querySelector(".invite-credit-sheet") || modal;
    trapFocus(sheet);
    loadInvitePackages()
      .then(() => {
        renderInviteCreditPackages();
        paintInviteSelectedCoin();
      })
      .catch(() => {
        renderInviteCreditPackages();
        setStatus($("invite-credit-status"), "โหลดแพ็กไม่สำเร็จ — ใช้แพ็กเริ่มต้น หรือใส่จำนวนเอง", "err");
      });
    setTimeout(() => $("invite-credit-custom-amount")?.focus(), 220);
  }

  function closeInviteCreditModal() {
    const modal = $("invite-credit-modal");
    if (!modal) return;
    unlockBodyScroll("invite-credit-open");
    releaseFocusTrap();
    animateClose(modal);
    setStatus($("invite-credit-status"), "", "muted");
  }

  async function loadInvitePackages() {
    const data = await api("/api/invite/packages", { timeoutMs: 12000 });
    invitePackages = Array.isArray(data.packages) ? data.packages : [];
    if (typeof data.pool_available === "boolean") {
      invitePoolAvailable = data.pool_available;
    }
    if (
      inviteSelectedPackageId &&
      inviteSelectedPackageId !== "invite_custom" &&
      !invitePackages.some((p) => p.id === inviteSelectedPackageId)
    ) {
      inviteSelectedPackageId = invitePackages[0]?.id || "invite_custom";
    }
    return invitePackages;
  }

  function fallbackInvitePackages() {
    const ladder = [];
    for (let n = 14; n <= 140; n += 14) {
      ladder.push({
        id: "invite_" + n,
        credits: n,
        price_baht: n,
        label_th: n + " Credit",
      });
    }
    ladder.push({
      id: "invite_1400",
      credits: 1400,
      price_baht: 1400,
      label_th: "1400 Credit",
    });
    return ladder;
  }

  function renderInviteCreditPackages() {
    const root = $("invite-credit-packages");
    if (!root) return;
    root.innerHTML = "";
    const list = invitePackages.length ? invitePackages : fallbackInvitePackages();
    if (!inviteSelectedPackageId) {
      inviteSelectedPackageId = "invite_custom";
      if (!inviteCustomAmountBaht) inviteCustomAmountBaht = 14;
    }
    list.forEach((pkg) => {
      const credits = pkg.credits || pkg.price_baht;
      const selected = pkg.id === inviteSelectedPackageId;
      const bulk = Number(credits) >= 1400;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "invite-pack-btn" +
        (selected ? " is-selected" : "") +
        (bulk ? " is-bulk" : "");
      btn.dataset.pack = pkg.id;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      btn.title =
        (bulk
          ? "1400 coin · 100 ลิงก์"
          : formatNumTh(credits) +
            " coin · " +
            Math.floor(Number(credits) / 14) +
            " ลิงก์") + " · แตะเพื่อคัดลอก";
      btn.innerHTML =
        '<span class="invite-pack-credits">' +
        escapeHtml(formatNumTh(credits)) +
        "</span>" +
        '<span class="invite-pack-baht">coin</span>';
      btn.addEventListener("click", () => {
        inviteSelectedPackageId = pkg.id;
        inviteCustomAmountBaht = Number(credits) || null;
        if ($("invite-credit-custom-amount")) {
          $("invite-credit-custom-amount").value = String(credits);
        }
        renderInviteCreditPackages();
        paintInviteSelectedCoin();
        copyInviteCoinAmount(credits).catch(() => {});
      });
      root.appendChild(btn);
    });
    paintInviteSelectedCoin();
  }

  function inviteDetailFromError(e) {
    const detail =
      e?.data?.detail && typeof e.data.detail === "object" ? e.data.detail : null;
    const code = e?.code || detail?.code;
    if (code !== "invite_credit_voucher" && code !== "use_invite_topup_endpoint") {
      return null;
    }
    return detail || { code, message: e?.userMessage || e?.message };
  }

  function routeInviteCreditVoucher(voucher, detail) {
    const v = String(voucher || "").trim();
    const credits = Number(detail?.credits || detail?.amount_baht || 0) || 0;
    if (detail?.invite_package_id === "invite_custom") {
      inviteSelectedPackageId = "invite_custom";
      inviteCustomAmountBaht = credits || null;
    } else if (detail?.invite_package_id) {
      inviteSelectedPackageId = detail.invite_package_id;
      inviteCustomAmountBaht = credits || null;
    } else if (credits > 0) {
      inviteSelectedPackageId = "invite_custom";
      inviteCustomAmountBaht = credits;
    }
    closeVaultModal();
    openInviteCreditModal();
    if (v && $("invite-credit-voucher")) {
      $("invite-credit-voucher").value = v;
    }
    if ($("invite-credit-custom-amount") && credits > 0) {
      $("invite-credit-custom-amount").value = String(credits);
    }
    setStatus(
      $("invite-credit-status"),
      credits
        ? "ซองนี้ " + formatNumTh(credits) + " coin สำหรับ Credit — กดยืนยันเติมได้เลย"
        : "ซองนี้สำหรับ Credit — กดยืนยันเติมได้เลย",
      "ok"
    );
    showToast("พาไปเติม Credit แล้ว", "ok");
  }

  async function redeemInviteCredit() {
    if (inviteBusy) return;
    const voucher = String($("invite-credit-voucher")?.value || "").trim();
    if (!voucher) {
      setStatus($("invite-credit-status"), "วางลิงก์ซอง TrueMoney ก่อน", "err");
      return;
    }
    const customInput = $("invite-credit-custom-amount");
    if (customInput && String(customInput.value || "").trim()) {
      if (!applyInviteCustomAmount(customInput.value)) return;
    }
    const amount = selectedInviteCoins();
    if (!amount || amount < 1) {
      setStatus($("invite-credit-status"), "ใส่จำนวนเงินหรือเลือกแพ็กก่อน", "err");
      return;
    }
    const body =
      inviteSelectedPackageId === "invite_custom" ||
      !inviteSelectedPackageId ||
      !(invitePackages || []).some((p) => p.id === inviteSelectedPackageId)
        ? { voucher, package_id: "invite_custom", amount_baht: amount }
        : { voucher, package_id: inviteSelectedPackageId };
    inviteBusy = true;
    setStatus($("invite-credit-status"), "กำลังเติม Credit…", "muted");
    try {
      const data = await api("/api/invite/topup/redeem", {
        method: "POST",
        body,
      });
      if (profile && data.invite_credit_balance != null) {
        profile.invite_credit_balance = data.invite_credit_balance;
      }
      paintInviteStats({ invite_credit_balance: data.invite_credit_balance });
      setStatus(
        $("invite-credit-status"),
        "เติม +" + formatCredit(data.credits_credited || 0) + " Credit สำเร็จ",
        "ok"
      );
      showToast("เติม Credit สำเร็จ", "ok");
      if ($("invite-credit-voucher")) $("invite-credit-voucher").value = "";
      await refreshInviteStatus().catch(() => {});
      paintAfterplayStartEnabled();
      paintUnlockLQuote();
    } catch (e) {
      const detail = e?.data?.detail && typeof e.data.detail === "object" ? e.data.detail : e?.data;
      const msg =
        e?.userMessage ||
        detail?.message ||
        e?.message ||
        thError(e?.data?.detail || e?.message) ||
        "เติมไม่สำเร็จ";
      setStatus($("invite-credit-status"), String(msg), "err");
    } finally {
      inviteBusy = false;
    }
  }

  async function startInviteJob() {
    if (inviteBusy || inviteRunning) return;
    if (!invitePoolAvailable) {
      setStatus($("invite-status"), "Pool หมด — เริ่ม Invite ไม่ได้ชั่วคราว", "err");
      return;
    }
    const target = String($("invite-link-input")?.value || "").trim();
    if (!target) {
      setStatus($("invite-status"), "วางลิงก์เชิญเพื่อนก่อน", "err");
      return;
    }
    inviteBusy = true;
    setStatus($("invite-status"), "กำลังจอง Pool และเริ่มงาน…", "muted");
    try {
      const data = await api("/api/invite/start", {
        method: "POST",
        body: { target, workers: 5 },
      });
      if (profile && data.invite_credit_balance != null) {
        profile.invite_credit_balance = data.invite_credit_balance;
      }
      paintInviteStats({
        invite_credit_balance: data.invite_credit_balance,
      });
      const charged = data.credits_charged || 14;
      persistInviteJob(data.job_id, charged);
      inviteResultShownFor = null;
      inviteLogLines = ["job " + (data.job_id || "") + " queued…"];
      const summaryEl = $("invite-result-summary");
      if (summaryEl) {
        summaryEl.hidden = true;
        summaryEl.classList.add("hidden");
        summaryEl.textContent = "";
      }
      paintInviteProgress({
        status: "queued",
        progress: { current: 0, total: 29, phase: "queued" },
        logs: inviteLogLines,
      });
      setInviteRunning(true);
      setStatus(
        $("invite-status"),
        "เริ่มแล้ว · MID " + (data.target_mid || "") + " · หัก " + charged + " Credit",
        "ok"
      );
      if (data.job_id) pollInviteJob(data.job_id);
      await refreshInviteStatus();
    } catch (e) {
      const detail = e?.data?.detail && typeof e.data.detail === "object" ? e.data.detail : e?.data;
      const code = e?.code || detail?.code;
      if (code === "insufficient_invite_credit") {
        setStatus($("invite-status"), "Credit ไม่พอ — กดเติม Credit", "err");
        openInviteCreditModal();
      } else if (code === "already_running") {
        setStatus($("invite-status"), "มีงานกำลังรันอยู่แล้ว", "err");
        resumeInviteJobIfAny().catch(() => {});
      } else if (code === "invite_pool_empty" || code === "invite_pool_race") {
        invitePoolAvailable = false;
        paintInviteStats({
          invite_credit_balance: inviteCreditBalance(),
          pool_available: false,
          ready: detail?.ready,
          links_available: detail?.links_available,
        });
        setStatus($("invite-status"), "Pool หมด — เริ่มเชิญเพื่อนไม่ได้ชั่วคราว", "err");
      } else {
        setStatus(
          $("invite-status"),
          String(
            e?.userMessage ||
              detail?.message ||
              e?.message ||
              thError(e?.data?.detail || e?.message) ||
              "เริ่มไม่สำเร็จ"
          ),
          "err"
        );
      }
    } finally {
      inviteBusy = false;
    }
  }

  function stopInvitePoll() {
    if (invitePollTimer) {
      clearInterval(invitePollTimer);
      invitePollTimer = null;
    }
  }

  async function resumeInviteJobIfAny() {
    if (invitePollTimer) return;
    let jobId = inviteActiveJobId || loadPersistedInviteJob();
    if (!jobId && accessToken) {
      try {
        const active = await api("/api/farm/active-job", { timeoutMs: 10000 });
        if (active?.active) {
          const k = active.kind || active.job_kind;
          if (k === "invite") jobId = active.job_id;
          else if (k === "afterplay_fast" && active.job_id) pollAfterplayJob(active.job_id);
          else if (k === "unlock_l" && active.job_id) pollUnlockLJob(active.job_id);
        }
      } catch (_) {}
    }
    if (!jobId) {
      resumeCreditJobsIfAny();
      return;
    }
    try {
      const job = await api("/api/farm/job/" + encodeURIComponent(jobId), {
        timeoutMs: 12000,
      });
      const kind = job.kind || job.job_kind;
      if (kind && kind !== "invite") {
        persistInviteJob(null);
        return;
      }
      if (["queued", "running"].includes(job.status)) {
        persistInviteJob(jobId, job.params?.cost_credits || inviteLastCharge);
        inviteResultShownFor = null;
        setInviteRunning(true);
        paintInviteProgress(job);
        setStatus($("invite-status"), "กำลังเชิญเพื่อน…", "muted");
        pollInviteJob(jobId);
        return;
      }
      if (["succeeded", "failed", "cancelled"].includes(job.status)) {
        paintInviteProgress(job);
        persistInviteJob(null);
        setInviteRunning(false);
        if (inviteResultShownFor !== jobId) {
          inviteResultShownFor = jobId;
          await refreshInviteStatus();
          showInviteResultModal(job);
        }
      }
    } catch (_) {
      /* stale id */
      persistInviteJob(null);
    }
  }

  function pollInviteJob(jobId) {
    stopInvitePoll();
    inviteActiveJobId = jobId;
    let ticks = 0;
    const tick = async () => {
      ticks += 1;
      if (ticks > 900) {
        stopInvitePoll();
        setStatus($("invite-status"), "รอผลนานเกินไป — กดรีเฟรชดูสถานะ", "err");
        return;
      }
      try {
        const job = await api("/api/farm/job/" + encodeURIComponent(jobId));
        paintInviteProgress(job);
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          stopInvitePoll();
          persistInviteJob(null);
          setInviteRunning(false);
          await refreshInviteStatus().catch(() => {});
          setStatus(
            $("invite-status"),
            job.status === "succeeded"
              ? "เชิญเพื่อนสำเร็จ"
              : "เชิญเพื่อนจบ: " + (job.error || job.status),
            job.status === "succeeded" ? "ok" : "err"
          );
          if (inviteResultShownFor !== jobId) {
            inviteResultShownFor = jobId;
            showInviteResultModal(job);
          }
        }
      } catch (_) {
        /* ignore transient */
      }
    };
    tick();
    invitePollTimer = setInterval(tick, 2000);
  }

  function requireDevplaySessionId() {
    const sid = devplaySession?.id;
    if (!sid) {
      showDevPlayRequiredModal();
      return null;
    }
    return sid;
  }

  function persistKeyedJob(storageKey, jobId) {
    try {
      if (jobId) sessionStorage.setItem(storageKey, String(jobId));
      else sessionStorage.removeItem(storageKey);
    } catch (_) {}
  }

  function loadKeyedJob(storageKey) {
    try {
      return sessionStorage.getItem(storageKey) || null;
    } catch (_) {
      return null;
    }
  }

  function paintCreditJobProgress(prefix, job) {
    const card = $(prefix + "-progress-card");
    if (!card) return;
    const status = String(job?.status || "");
    const show = ["queued", "running", "succeeded", "failed", "cancelled"].includes(status);
    card.hidden = !show;
    card.classList.toggle("hidden", !show);
    const prog = job?.progress && typeof job.progress === "object" ? job.progress : {};
    const current = Number(prog.current) || 0;
    const total = Number(prog.total) || Number(job?.ticket_count) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : status === "succeeded" ? 100 : 0;
    const label =
      status === "queued"
        ? "รอคิว…"
        : status === "running"
          ? String(prog.label || "กำลังรัน…")
          : status === "succeeded"
            ? "สำเร็จ"
            : status === "cancelled"
              ? "ยกเลิกแล้ว"
              : "จบงาน";
    if ($(prefix + "-progress-label")) $(prefix + "-progress-label").textContent = label;
    if ($(prefix + "-progress-current")) $(prefix + "-progress-current").textContent = formatNumTh(current);
    if ($(prefix + "-progress-total")) $(prefix + "-progress-total").textContent = formatNumTh(total || 0);
    if ($(prefix + "-progress-pct")) $(prefix + "-progress-pct").textContent = pct + "%";
    const fill = $(prefix + "-progress-fill");
    if (fill) fill.style.width = pct + "%";
    const logs = Array.isArray(job?.logs) ? job.logs : [];
    if (prefix === "unlockl") {
      const ep = Number(prog.ep) || 0;
      document.querySelectorAll("#unlockl-grid .unlockl-card").forEach((el) => {
        el.classList.toggle("is-running", status === "running" && ep > 0 && Number(el.dataset.ep) === ep);
      });
    }
    syncCreditJobLogButtons();
    return logs.map(String).slice(-200);
  }

  function syncCreditJobLogButtons() {
    const admin = isAdminUser();
    ["afterplay-log-open-btn", "unlockl-log-open-btn"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.hidden = !admin;
      btn.classList.toggle("hidden", !admin);
    });
  }

  function isAfterplayEbox() {
    return afterplayFarmMode === "episode_box";
  }

  function readAfterplayBoxMax() {
    const n = Math.floor(Number($("afterplay-box-max")?.value));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(3, n));
  }

  function afterplayUiHints() {
    return isAfterplayEbox() ? afterplayPricesMeta.episode_box : afterplayPricesMeta.money_xp;
  }

  function paintAfterplayBoxMaxVisibility() {
    const wrap = $("afterplay-box-max-wrap");
    if (!wrap) return;
    const hints = afterplayUiHints() || {};
    const allow = hints.allow_customer_box_max !== false && !hints.lock_box_max;
    wrap.hidden = !allow;
    wrap.classList.toggle("hidden", !allow);
  }

  function paintAfterplayModeUi() {
    const eboxOn = isAfterplayEbox();
    const panel = $("farm-panel-afterplay_fast");
    panel?.classList.toggle("is-ebox", eboxOn);
    ["afterplay-mode-money_xp", "afterplay-mode-episode_box"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      const on = btn.getAttribute("data-farm-mode") === afterplayFarmMode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const eboxBtn = $("afterplay-mode-episode_box");
    if (eboxBtn) {
      const show = afterplayPricesMeta.eboxEnabled !== false;
      eboxBtn.hidden = !show;
      eboxBtn.classList.toggle("hidden", !show);
    }
    const goal = $("afterplay-goal-grid");
    if (goal) {
      goal.hidden = eboxOn;
      goal.classList.toggle("hidden", eboxOn);
    }
    const ebox = $("afterplay-ebox-panel");
    if (ebox) {
      ebox.hidden = !eboxOn;
      ebox.classList.toggle("hidden", !eboxOn);
    }
    const keyWrap = $("afterplay-snap-key-wrap");
    if (keyWrap) {
      keyWrap.hidden = !eboxOn;
      keyWrap.classList.toggle("hidden", !eboxOn);
    }
    const title = $("afterplay-start-btn-title");
    if (title && !afterplayRunning) {
      title.textContent = eboxOn ? "เริ่มเก็บกล่องด่าน" : "เริ่มฟาร์มเงิน/XP";
    }
    paintAfterplayBoxMaxVisibility();
    paintAfterplayCreditHint();
  }

  function setAfterplayFarmMode(mode, opts) {
    const options = opts || {};
    let next = mode === "episode_box" ? "episode_box" : "money_xp";
    if (next === "episode_box" && afterplayPricesMeta.eboxEnabled === false) next = "money_xp";
    afterplayFarmMode = next;
    try {
      localStorage.setItem(AFTERPLAY_MODE_KEY, next);
    } catch (_) {}
    afterplaySnapCache = { at: 0, sid: "", data: null };
    paintAfterplayModeUi();
    if (!options.silent) {
      scheduleAfterplayPreview(next === "episode_box" ? "ebox" : afterplayLastEdit);
    }
  }

  function setAfterplayRunning(on) {
    afterplayRunning = !!on;
    $("farm-tab-afterplay_fast")?.classList.toggle("is-live-running", afterplayRunning);
    $("menu-nav-afterplay_fast")?.classList.toggle("is-live-running", afterplayRunning);
    const cancelBtn = $("afterplay-cancel-btn");
    if (cancelBtn) {
      cancelBtn.hidden = !afterplayRunning;
      cancelBtn.classList.toggle("hidden", !afterplayRunning);
      cancelBtn.disabled = false;
      cancelBtn.textContent = "ยกเลิก";
    }
    paintAfterplayStartEnabled();
  }

  function paintAfterplayCreditHint(rate) {
    if (rate != null && Number.isFinite(Number(rate))) {
      if (isAfterplayEbox()) afterplayEboxCreditPerRun = Number(rate);
      else afterplayCreditPerRun = Number(rate);
    }
    const shown = isAfterplayEbox() ? afterplayEboxCreditPerRun : afterplayCreditPerRun;
    const el = $("afterplay-credit-per-run");
    if (el) el.textContent = formatCredit(shown);
    const kicker = $("afterplay-estimate")?.querySelector(".afterplay-summary-kicker");
    if (kicker && isAfterplayEbox()) {
      kicker.innerHTML = "1 รอบกล่อง = <strong id=\"afterplay-credit-per-run\">" + formatCredit(shown) + "</strong> Credit";
    } else if (kicker && !isAfterplayEbox()) {
      kicker.innerHTML = "1 รอบ = 1 หัวใจ = <strong id=\"afterplay-credit-per-run\">" + formatCredit(shown) + "</strong> Credit";
    }
    const hintEl = $("farm-panel-hint");
    if (farmTab === "afterplay_fast" && hintEl) {
      if (isAfterplayEbox()) {
        hintEl.textContent =
          "เก็บกล่องด่าน · 1 รอบกล่อง = " + formatCredit(shown) + " Credit · ไม่สุ่ม L";
      } else {
        hintEl.textContent =
          "1 รอบ = 1 หัวใจ = " + formatCredit(shown) + " Credit";
      }
    }
  }

  function paintAfterplayStartEnabled() {
    const btn = $("afterplay-start-btn");
    if (!btn) return;
    const plan = afterplayPlan;
    const ebox = isAfterplayEbox();
    const runs = Number(ebox ? plan?.planned || plan?.runs || 0 : plan?.runs || 0);
    const enoughLife = ebox ? Number(plan?.life || 0) >= 1 && runs > 0 : !!plan?.enough_life;
    const bal = inviteCreditBalance();
    const cost = Number(plan?.credit || plan?.cost || 0);
    const needEps = !ebox || afterplayEboxSelected.size > 0;
    const can =
      !afterplayRunning &&
      !afterplayBusy &&
      runs > 0 &&
      enoughLife &&
      needEps &&
      bal + 1e-9 >= cost &&
      !!devplaySession?.id;
    btn.disabled = !can;
    btn.classList.toggle("is-disabled-look", !can);
    const warn = $("afterplay-life-warn");
    if (warn) {
      const show = ebox ? runs > 0 && Number(plan?.life || 0) < 1 : runs > 0 && plan && !enoughLife;
      warn.hidden = !show;
      warn.classList.toggle("hidden", !show);
      if (ebox) warn.textContent = "หัวใจเป็น 0 — ห้ามเริ่ม";
      else warn.textContent = "หัวใจไม่พอ — ห้ามเริ่ม";
    }
    const hint = $("afterplay-ebox-hint");
    if (hint) {
      const life = Number(plan?.life || 0);
      const show = ebox && runs > 0 && life >= 1 && life < runs;
      hint.hidden = !show;
      hint.classList.toggle("hidden", !show);
    }
    const keyWarn = $("afterplay-ebox-key-warn");
    if (keyWarn) {
      const needKey = ebox && afterplayEboxSelected.has(5);
      const locked = (afterplayEboxCatalog || []).some((r) => Number(r.ep) === 5 && !r.unlocked);
      const keys = Number(plan?.key ?? $("afterplay-snap-key")?.textContent) || 0;
      const show = needKey && locked && keys < 1;
      keyWarn.hidden = !show;
      keyWarn.classList.toggle("hidden", !show);
    }
    if ($("afterplay-start-btn-sub") && !afterplayRunning) {
      if (!devplaySession?.id) $("afterplay-start-btn-sub").textContent = "ล็อกอิน DevPlay ก่อน";
      else if (ebox && afterplayEboxSelected.size < 1) $("afterplay-start-btn-sub").textContent = "เลือกด่านอย่างน้อย 1 ด่าน";
      else if (!enoughLife && runs > 0) $("afterplay-start-btn-sub").textContent = "หัวใจไม่พอ — ห้ามเริ่ม";
      else if (runs > 0) $("afterplay-start-btn-sub").textContent = "หัก " + formatCredit(cost) + " Credit · " + formatNumTh(runs) + " รอบ";
      else $("afterplay-start-btn-sub").textContent = ebox ? "เลือกด่านแล้วใส่จำนวนรอบ" : "ใส่เป้าเหรียญหรือเลเวล";
    }
  }

  function paintAfterplayBound(prefix, lo, hi, opts) {
    const a = Number(lo || 0);
    const b = Number(hi == null || hi === "" ? a : hi);
    const minV = Math.min(a, b);
    const maxV = Math.max(a, b);
    const wrap = $(prefix + "-wrap");
    wrap?.classList.toggle("is-single", minV === maxV);
    const fmt = (n) => {
      const t = formatNumTh(n);
      return opts && opts.plus && n > 0 ? "+" + t : t;
    };
    if ($(prefix + "-min")) $(prefix + "-min").textContent = fmt(minV);
    if ($(prefix + "-max")) $(prefix + "-max").textContent = fmt(maxV);
  }

  function paintAfterplayPlan(data) {
    const snap = data?.snapshot || {};
    const plan = data?.plan || afterplayPlan;
    afterplayPlan = plan;
    if (data?.invite_credit_balance != null && profile) {
      profile.invite_credit_balance = data.invite_credit_balance;
      paintInviteStats({ invite_credit_balance: data.invite_credit_balance });
    }
    if (plan?.credit_per_run != null) paintAfterplayCreditHint(plan.credit_per_run);
    else if (data?.afterplay_fast_credit_per_run != null) {
      paintAfterplayCreditHint(data.afterplay_fast_credit_per_run);
    }
    if ($("afterplay-snap-level")) $("afterplay-snap-level").textContent = snap.level != null ? formatNumTh(snap.level) : "—";
    if ($("afterplay-snap-exp")) $("afterplay-snap-exp").textContent = snap.exp != null ? formatNumTh(snap.exp) : "—";
    if ($("afterplay-snap-life")) $("afterplay-snap-life").textContent = snap.life != null ? formatNumTh(snap.life) : "—";
    if ($("afterplay-snap-coin")) $("afterplay-snap-coin").textContent = snap.coin != null ? formatNumTh(snap.coin) : "—";
    if ($("afterplay-snap-key")) $("afterplay-snap-key").textContent = snap.key != null ? formatNumTh(snap.key) : "—";
    if (Array.isArray(data?.episodes)) {
      afterplayEboxCatalog = data.episodes;
      paintAfterplayEboxGrid();
    }
    if (plan) {
      const planned = Number(plan.planned || plan.runs || 0);
      if ($("afterplay-est-runs")) $("afterplay-est-runs").textContent = formatNumTh(planned);
      if ($("afterplay-est-credit")) $("afterplay-est-credit").textContent = formatCredit(plan.credit || plan.cost || 0);
      if ($("afterplay-est-hearts")) {
        const need = isAfterplayEbox() ? Number(plan.life || snap.life || 0) : Number(plan.hearts_required || 0);
        $("afterplay-est-hearts").textContent = formatNumTh(need);
      }
      paintAfterplayBound("afterplay-est-xp", plan.xp_gain_min, plan.xp_gain_max, { plus: true });
      paintAfterplayBound("afterplay-est-coin", plan.coin_min, plan.coin_max, { plus: true });
      const before = plan.before || snap;
      const safe = plan.after_safe || {};
      const best = plan.after_best || {};
      const cmp = $("afterplay-compare");
      if (cmp) {
        const show = Number(plan.runs || 0) > 0;
        cmp.hidden = !show;
        cmp.classList.toggle("hidden", !show);
        if (show) {
          if ($("afterplay-cmp-before-level")) $("afterplay-cmp-before-level").textContent = formatNumTh(before.level || 0);
          if ($("afterplay-cmp-before-coin")) $("afterplay-cmp-before-coin").textContent = formatNumTh(before.coin || 0);
          if ($("afterplay-cmp-before-life")) $("afterplay-cmp-before-life").textContent = formatNumTh(before.life || 0);
          paintAfterplayBound("afterplay-cmp-after-level", safe.level, best.level);
          paintAfterplayBound("afterplay-cmp-after-coin", safe.coin, best.coin);
          if ($("afterplay-cmp-after-life")) $("afterplay-cmp-after-life").textContent = formatNumTh(safe.life || 0);
        }
      }
    }
    paintAfterplayGoalCards();
    paintAfterplayStartEnabled();
  }

  function paintAfterplayGoalCards() {
    $("afterplay-goal-level")?.classList.toggle("is-active", afterplayLastEdit !== "coin");
    $("afterplay-goal-coin")?.classList.toggle("is-active", afterplayLastEdit === "coin");
  }

  function setAfterplayGoal(kind) {
    afterplayLastEdit = kind === "coin" ? "coin" : "level";
    paintAfterplayGoalCards();
  }

  async function refreshAfterplayPrices() {
    try {
      const data = await api("/api/farm/afterplay/prices", { timeoutMs: 12000 });
      if (data?.afterplay_fast_credit_per_run != null) {
        afterplayCreditPerRun = Number(data.afterplay_fast_credit_per_run) || afterplayCreditPerRun;
      }
      if (data?.afterplay_episode_box_credit_per_run != null) {
        afterplayEboxCreditPerRun = Number(data.afterplay_episode_box_credit_per_run) || afterplayEboxCreditPerRun;
      }
      afterplayPricesMeta.eboxEnabled = data?.afterplay_episode_box_enabled !== false;
      afterplayPricesMeta.eboxMaxRuns = Number(data?.afterplay_episode_box_max_runs || 50) || 50;
      if (data?.money_xp && typeof data.money_xp === "object") afterplayPricesMeta.money_xp = data.money_xp;
      if (data?.episode_box && typeof data.episode_box === "object") afterplayPricesMeta.episode_box = data.episode_box;
      if (data?.unlock_l_credit_each != null) {
        unlockLPrices.each = Number(data.unlock_l_credit_each) || unlockLPrices.each;
      }
      if (data?.unlock_l_credit_bundle != null) {
        unlockLPrices.bundle = Number(data.unlock_l_credit_bundle) || unlockLPrices.bundle;
      }
      const eboxRuns = $("afterplay-ebox-runs");
      if (eboxRuns && !eboxRuns.dataset.touched) {
        eboxRuns.value = String(afterplayPricesMeta.episode_box.default_runs_per_ep || 5);
        eboxRuns.max = String(afterplayPricesMeta.eboxMaxRuns || 50);
      }
      const boxMax = $("afterplay-box-max");
      if (boxMax && !boxMax.dataset.touched) {
        const hints = afterplayUiHints() || {};
        boxMax.value = String(hints.box_max == null ? 0 : hints.box_max);
      }
      if (!afterplayPricesMeta.eboxEnabled && afterplayFarmMode === "episode_box") {
        setAfterplayFarmMode("money_xp", { silent: true });
      }
      paintAfterplayModeUi();
      paintAfterplayCreditHint();
      return data;
    } catch (_) {
      return null;
    }
  }

  async function refreshAfterplayPreview(opts) {
    const sid = requireDevplaySessionId();
    if (!sid) return null;
    const options = opts || {};
    const force = !!options.force;
    const fromTab = !!options.fromTab;
    if (
      fromTab &&
      !force &&
      afterplaySnapCache.data &&
      afterplaySnapCache.sid === sid &&
      Date.now() - afterplaySnapCache.at < AFTERPLAY_SNAP_TTL_MS
    ) {
      paintAfterplayPlan(afterplaySnapCache.data);
      return afterplaySnapCache.data;
    }
    const tgtNum = Math.floor(Number($("afterplay-target-level")?.value || 0));
    const coinNum = Math.floor(Number($("afterplay-target-coin")?.value || 0));
    const body = { devplay_session_id: sid, farm_mode: afterplayFarmMode };
    const boxMax = readAfterplayBoxMax();
    body.box_max = boxMax;
    if (isAfterplayEbox()) {
      body.target_eps = [...afterplayEboxSelected];
      const runsNum = Math.floor(Number($("afterplay-ebox-runs")?.value || 0));
      if (runsNum >= 1) body.runs = runsNum;
    } else {
      if (tgtNum >= 1) body.target_level = Math.max(1, Math.min(110, tgtNum));
      if (coinNum >= 1) body.target_coin = coinNum;
    }
    setStatus($("afterplay-status"), "กำลังอ่านไอดี…", "muted");
    try {
      const data = await api("/api/farm/afterplay/preview", { method: "POST", body, timeoutMs: 45000 });
      afterplaySnapCache = { at: Date.now(), sid, data };
      paintAfterplayPlan(data);
      const plan = data?.plan;
      if (isAfterplayEbox()) {
        if (!afterplayEboxSelected.size) {
          setStatus($("afterplay-status"), "เลือกด่านอย่างน้อย 1 ด่าน", "muted");
        } else if (plan?.capped) {
          setStatus(
            $("afterplay-status"),
            "รอบ/ด่านเกินเพดาน " + formatNumTh(plan.max_runs || 0) + " — ใช้จำนวนสูงสุด",
            "err"
          );
        } else if (plan?.planned) {
          setStatus(
            $("afterplay-status"),
            formatNumTh(plan.runs) + " รอบ/ด่าน × " + formatNumTh(plan.eps?.length || afterplayEboxSelected.size) +
              " ด่าน = " + formatNumTh(plan.planned) + " รอบ · หัวใจ" + (Number(plan.life || 0) >= 1 ? "พร้อมเริ่ม" : "เป็น 0"),
            Number(plan.life || 0) >= 1 ? "ok" : "err"
          );
        } else {
          setStatus($("afterplay-status"), "ใส่จำนวนรอบ/ด่าน", "muted");
        }
      } else if (plan?.capped) {
        setStatus(
          $("afterplay-status"),
          "เป้าเกินเพดาน " + formatNumTh(plan.max_runs || 0) + " รอบ — ใช้จำนวนสูงสุด",
          "err"
        );
      } else if (plan?.runs) {
        const why =
          plan.goal === "both"
            ? " (ยึดเป้าที่ต้องรอบมากกว่า)"
            : plan.goal === "level"
              ? " (จากเลเวล)"
              : plan.goal === "coin"
                ? " (จากเหรียญ)"
                : "";
        setStatus(
          $("afterplay-status"),
          "ชัวร์ " + formatNumTh(plan.runs) + " รอบ" + why + " · หัวใจ" + (plan.enough_life ? "พร้อม" : "ไม่พอ"),
          plan.enough_life ? "ok" : "err"
        );
      } else if (tgtNum >= 1 && !coinNum && Number(data?.snapshot?.level || 0) >= tgtNum) {
        setStatus($("afterplay-status"), "เลเวลถึงหรือเกินเป้าแล้ว", "ok");
      } else {
        setStatus($("afterplay-status"), "ใส่เป้าเหรียญหรือเลเวล", "muted");
      }
      return data;
    } catch (err) {
      setStatus($("afterplay-status"), String(err?.userMessage || err?.message || "คำนวณไม่สำเร็จ"), "err");
      return null;
    }
  }

  function scheduleAfterplayPreview(source) {
    afterplayLastEdit = source || afterplayLastEdit;
    paintAfterplayGoalCards();
    if (afterplayPreviewTimer) clearTimeout(afterplayPreviewTimer);
    afterplayPreviewTimer = setTimeout(() => {
      afterplayPreviewTimer = null;
      refreshAfterplayPreview({ source: afterplayLastEdit }).catch(() => {});
    }, 400);
  }

  function stopAfterplayPoll() {
    if (afterplayPollTimer) {
      clearInterval(afterplayPollTimer);
      afterplayPollTimer = null;
    }
  }

  async function startAfterplayJob() {
    if (afterplayBusy || afterplayRunning) return;
    const sid = requireDevplaySessionId();
    if (!sid) return;
    if (isAfterplayEbox()) {
      if (afterplayEboxSelected.size < 1) {
        setStatus($("afterplay-status"), "เลือกด่านอย่างน้อย 1 ด่าน", "err");
        return;
      }
      const runsNum = Math.floor(Number($("afterplay-ebox-runs")?.value || 0));
      if (runsNum < 1) {
        setStatus($("afterplay-status"), "ใส่จำนวนรอบ/ด่าน", "err");
        return;
      }
      if (Number(afterplayPlan?.life || 0) < 1) {
        setStatus($("afterplay-status"), "หัวใจเป็น 0 — ห้ามเริ่ม", "err");
        return;
      }
    } else {
      const tgt = Math.floor(Number($("afterplay-target-level")?.value || 0));
      const coin = Math.floor(Number($("afterplay-target-coin")?.value || 0));
      if (tgt < 1 && coin < 1) {
        setStatus($("afterplay-status"), "ใส่เป้าเหรียญหรือเลเวลก่อน", "err");
        return;
      }
      if (afterplayPlan && !afterplayPlan.enough_life) {
        setStatus($("afterplay-status"), "หัวใจไม่พอ — ห้ามเริ่ม", "err");
        return;
      }
    }
    afterplayBusy = true;
    setStatus($("afterplay-status"), "กำลังเริ่มงาน…", "muted");
    try {
      const body = { devplay_session_id: sid, farm_mode: afterplayFarmMode, box_max: readAfterplayBoxMax() };
      if (isAfterplayEbox()) {
        body.target_eps = [...afterplayEboxSelected];
        body.runs = Math.max(1, Math.floor(Number($("afterplay-ebox-runs")?.value || 1)));
      } else {
        const tgt = Math.floor(Number($("afterplay-target-level")?.value || 0));
        const coin = Math.floor(Number($("afterplay-target-coin")?.value || 0));
        if (tgt >= 1) body.target_level = Math.max(1, Math.min(110, tgt));
        if (coin >= 1) body.target_coin = coin;
      }
      const data = await api("/api/farm/afterplay/start", { method: "POST", body, timeoutMs: 45000 });
      if (data?.invite_credit_balance != null && profile) {
        profile.invite_credit_balance = data.invite_credit_balance;
        paintInviteStats({ invite_credit_balance: data.invite_credit_balance });
      }
      if (data?.job_id) {
        afterplayActiveJobId = data.job_id;
        persistKeyedJob(AFTERPLAY_JOB_KEY, data.job_id);
        afterplayResultShownFor = null;
        setAfterplayRunning(true);
        pollAfterplayJob(data.job_id);
        setStatus($("afterplay-status"), "เข้าคิวแล้ว — หัก " + formatCredit(data.credits_charged) + " Credit", "ok");
      }
    } catch (err) {
      setStatus($("afterplay-status"), String(err?.userMessage || err?.message || "เริ่มไม่สำเร็จ"), "err");
    } finally {
      afterplayBusy = false;
      paintAfterplayStartEnabled();
    }
  }

  function pollAfterplayJob(jobId) {
    stopAfterplayPoll();
    afterplayActiveJobId = jobId;
    let ticks = 0;
    const tick = async () => {
      ticks += 1;
      if (ticks > 1800) {
        stopAfterplayPoll();
        setStatus($("afterplay-status"), "รอผลนานเกินไป — กดรีเฟรช", "err");
        return;
      }
      try {
        const job = await api("/api/farm/job/" + encodeURIComponent(jobId));
        afterplayLogLines = paintCreditJobProgress("afterplay", job) || afterplayLogLines;
        if (["queued", "running"].includes(job.status)) setAfterplayRunning(true);
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          stopAfterplayPoll();
          persistKeyedJob(AFTERPLAY_JOB_KEY, null);
          setAfterplayRunning(false);
          await refreshInviteStatus().catch(() => {});
          const jobKey = String(job.id || jobId);
          if (afterplayResultShownFor !== jobKey) {
            afterplayResultShownFor = jobKey;
            showAfterplayResultModal(job);
          }
          setStatus(
            $("afterplay-status"),
            job.status === "succeeded"
              ? isAfterplayEbox()
                ? "เก็บกล่องด่านสำเร็จ"
                : "ฟาร์มเงิน/XP สำเร็จ"
              : "จบ: " + (job.error || job.status),
            job.status === "succeeded" ? "ok" : "err"
          );
          refreshAfterplayPreview({ force: true, source: afterplayLastEdit }).catch(() => {});
        }
      } catch (_) {}
    };
    tick();
    afterplayPollTimer = setInterval(tick, 2000);
  }

  function signedDelta(n) {
    const v = Number(n) || 0;
    if (v > 0) return "+" + formatNumTh(v);
    if (v < 0) return formatNumTh(v);
    return "0";
  }

  async function cancelAfterplayJob() {
    const jobId = afterplayActiveJobId || loadKeyedJob(AFTERPLAY_JOB_KEY);
    if (!jobId) return;
    try {
      await cancelServerJob(jobId);
      showToast("ส่งคำขอยกเลิกแล้ว", "ok");
      if (!afterplayPollTimer) pollAfterplayJob(jobId);
    } catch (e) {
      setStatus($("afterplay-status"), String(e?.userMessage || e?.message || "ยกเลิกไม่สำเร็จ"), "err");
    }
  }

  function unlockLQuote(selected, catalog) {
    const owned = new Set((catalog || []).filter((r) => r.owned).map((r) => Number(r.ep)));
    const billable = [...selected].filter((ep) => !owned.has(ep));
    const n = billable.length;
    const each = Number(unlockLPrices.each || 15);
    const bundle = Number(unlockLPrices.bundle || 100);
    const credit = n <= 0 ? 0 : n >= 7 ? bundle : Math.round(each * n * 100) / 100;
    return { n, credit, billable };
  }

  const UNLOCK_L_EP_IMAGES = {
    1: "assets/King_Choco_Drop.png",
    2: "assets/Tiger_Lily_Cookie.png",
    3: "assets/Fire_Spirit_Cookie.png",
    4: "assets/Moonlight_Cookie.png",
    5: "assets/Wind_Archer_Cookie.png",
    6: "assets/Blooming_Dancheong_Cookie.png",
    7: "assets/unlock_l_ep7.png",
  };

  function unlockLEpImage(ep, name) {
    const mapped = UNLOCK_L_EP_IMAGES[Number(ep)];
    if (mapped) return mapped;
    const n = String(name || "").trim();
    if (!n) return "assets/Tiger_Lily_Cookie.png";
    return "assets/" + n.replace(/\s+/g, "_").replace(/[()]/g, "") + ".png";
  }

  function afterplayEboxRows() {
    const rows = afterplayEboxCatalog && afterplayEboxCatalog.length ? afterplayEboxCatalog : [
      { ep: 1, name: "ด่าน 1" },
      { ep: 2, name: "ด่าน 2" },
      { ep: 3, name: "ด่าน 3" },
      { ep: 4, name: "ด่าน 4" },
      { ep: 5, name: "ด่าน 5 · Ice Tower" },
      { ep: 6, name: "ด่าน 6" },
      { ep: 7, name: "ด่าน 7" },
    ];
    return rows.filter((r) => Number(r.ep) >= 1 && Number(r.ep) <= 7);
  }

  function paintAfterplayEboxGrid() {
    const grid = $("afterplay-ebox-grid");
    if (!grid) return;
    grid.innerHTML = "";
    afterplayEboxRows().forEach((row) => {
      const ep = Number(row.ep);
      const selected = afterplayEboxSelected.has(ep);
      const owned = !!row.owned;
      const unlocked = row.unlocked !== false;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "unlockl-card" + (selected ? " is-selected" : "");
      btn.dataset.ep = String(ep);
      btn.title = row.name || ("EP " + ep);
      btn.setAttribute(
        "aria-label",
        "EP " + ep + (owned ? " มี L แล้ว" : "") + (unlocked ? "" : " ยังไม่ปลดด่าน")
      );
      const check = document.createElement("span");
      check.className = "unlockl-card-check";
      check.textContent = selected ? "✓" : "";
      const img = document.createElement("img");
      img.className = "unlockl-card-img";
      img.src = unlockLEpImage(ep, row.name);
      img.alt = "";
      img.width = 88;
      img.height = 88;
      img.loading = "lazy";
      img.onerror = () => {
        img.onerror = null;
        img.src = "assets/Tiger_Lily_Cookie.png";
      };
      const epEl = document.createElement("span");
      epEl.className = "unlockl-ep";
      epEl.textContent = "EP " + ep;
      const stateEl = document.createElement("span");
      stateEl.className = "unlockl-state";
      if (selected) stateEl.textContent = "เลือกแล้ว";
      else if (!unlocked) stateEl.textContent = "ยังไม่ปลด";
      else if (owned) stateEl.textContent = "มี L แล้ว";
      else stateEl.textContent = "เก็บกล่องได้";
      btn.append(check, img, epEl, stateEl);
      btn.addEventListener("click", () => {
        if (afterplayEboxSelected.has(ep)) afterplayEboxSelected.delete(ep);
        else afterplayEboxSelected.add(ep);
        paintAfterplayEboxGrid();
        scheduleAfterplayPreview("ebox");
      });
      grid.appendChild(btn);
    });
  }

  function paintUnlockLGrid() {
    const grid = $("unlockl-grid");
    if (!grid) return;
    grid.innerHTML = "";
    unlockLCatalog.forEach((row) => {
      const ep = Number(row.ep);
      const owned = !!row.owned;
      const selected = !owned && unlockLSelected.has(ep);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "unlockl-card" + (owned ? " is-owned" : "") + (selected ? " is-selected" : "");
      btn.dataset.ep = String(ep);
      btn.disabled = owned;
      btn.title = row.name || ("EP " + ep);
      btn.setAttribute("aria-label", "EP " + ep + (owned ? " มีแล้ว" : " ยังไม่มี"));
      const check = document.createElement("span");
      check.className = "unlockl-card-check";
      check.textContent = selected ? "✓" : "";
      const img = document.createElement("img");
      img.className = "unlockl-card-img";
      img.src = unlockLEpImage(ep, row.name);
      img.alt = "";
      img.width = 88;
      img.height = 88;
      img.loading = "lazy";
      img.onerror = () => {
        img.onerror = null;
        img.src = "assets/Tiger_Lily_Cookie.png";
      };
      const epEl = document.createElement("span");
      epEl.className = "unlockl-ep";
      epEl.textContent = "EP " + ep;
      const stateEl = document.createElement("span");
      stateEl.className = "unlockl-state";
      stateEl.textContent = owned ? "มีแล้ว" : selected ? "เลือกแล้ว" : "ยังไม่มี";
      btn.append(check, img, epEl, stateEl);
      if (!owned) {
        btn.addEventListener("click", () => {
          if (unlockLSelected.has(ep)) unlockLSelected.delete(ep);
          else unlockLSelected.add(ep);
          paintUnlockLGrid();
          paintUnlockLQuote();
        });
      }
      grid.appendChild(btn);
    });
    paintUnlockLQuote();
  }

  function paintUnlockLQuote() {
    const q = unlockLQuote(unlockLSelected, unlockLCatalog);
    if ($("unlockl-quote")) $("unlockl-quote").textContent = formatCredit(q.credit) + " Credit";
    if ($("unlockl-price-each")) $("unlockl-price-each").textContent = formatCredit(unlockLPrices.each);
    if ($("unlockl-price-bundle")) $("unlockl-price-bundle").textContent = formatCredit(unlockLPrices.bundle);
    if ($("unlockl-toolbar-meta")) {
      $("unlockl-toolbar-meta").textContent = q.n
        ? "เลือก " + formatNumTh(q.n) + " ตัว · " + formatCredit(q.credit) + " Credit"
        : "เลือกตัวที่ยังไม่มี · " + formatCredit(unlockLPrices.each) + " Credit/ตัว · ครบ 7 = " + formatCredit(unlockLPrices.bundle);
    }
    if ($("unlockl-snap-life")) $("unlockl-snap-life").textContent = formatNumTh(unlockLSnap.life || 0);
    if ($("unlockl-snap-key")) $("unlockl-snap-key").textContent = formatNumTh(unlockLSnap.key || 0);
    const btn = $("unlockl-start-btn");
    const bal = inviteCreditBalance();
    const noLife = Number(unlockLSnap.life || 0) < 1;
    const needsEp5 = q.billable.includes(5);
    const noKey = needsEp5 && Number(unlockLSnap.key || 0) < 1;
    const can =
      !unlockLRunning &&
      !unlockLBusy &&
      q.n > 0 &&
      bal + 1e-9 >= q.credit &&
      !!devplaySession?.id &&
      !noLife &&
      !noKey;
    if (btn) {
      btn.disabled = !can;
      btn.classList.toggle("is-disabled-look", !can);
    }
    const lifeWarn = $("unlockl-life-warn");
    if (lifeWarn) {
      lifeWarn.hidden = !noLife;
      lifeWarn.classList.toggle("hidden", !noLife);
    }
    const keyWarn = $("unlockl-key-warn");
    if (keyWarn) {
      keyWarn.hidden = !noKey;
      keyWarn.classList.toggle("hidden", !noKey);
    }
    if ($("unlockl-start-btn-sub") && !unlockLRunning) {
      if (!q.n) $("unlockl-start-btn-sub").textContent = "เลือกอย่างน้อย 1 ตัวที่ยังไม่มี";
      else if (noLife) $("unlockl-start-btn-sub").textContent = "หัวใจเป็น 0 — ห้ามเริ่ม";
      else if (noKey) $("unlockl-start-btn-sub").textContent = "EP5 ต้องมีกุญแจ";
      else if (bal + 1e-9 < q.credit) $("unlockl-start-btn-sub").textContent = "Credit ไม่พอ (" + formatCredit(q.credit) + ")";
      else $("unlockl-start-btn-sub").textContent = "เริ่มปลดล็อค · " + formatNumTh(q.n) + " ตัว · " + formatCredit(q.credit) + " Credit";
    }
  }

  async function refreshUnlockLCatalog(opts) {
    const sid = requireDevplaySessionId();
    if (!sid) return null;
    const options = opts || {};
    const force = !!options.force;
    const fromTab = !!options.fromTab;
    if (
      fromTab &&
      !force &&
      unlockLCatalogCache.data &&
      unlockLCatalogCache.sid === sid &&
      Date.now() - unlockLCatalogCache.at < AFTERPLAY_SNAP_TTL_MS
    ) {
      paintUnlockLGrid();
      return unlockLCatalogCache.data;
    }
    setStatus($("unlockl-status"), "กำลังโหลดคลัง…", "muted");
    try {
      const data = await api("/api/farm/unlock-l/catalog", {
        method: "POST",
        body: { devplay_session_id: sid },
        timeoutMs: 45000,
      });
      if (data?.invite_credit_balance != null && profile) {
        profile.invite_credit_balance = data.invite_credit_balance;
        paintInviteStats({ invite_credit_balance: data.invite_credit_balance });
      }
      unlockLPrices = {
        each: Number(data.credit_each || 15),
        bundle: Number(data.credit_bundle || 100),
      };
      unlockLCatalog = Array.isArray(data.episodes) ? data.episodes : [];
      unlockLSnap = {
        life: Number(data.snapshot?.life || 0),
        key: Number(data.snapshot?.key || 0),
      };
      const owned = new Set(unlockLCatalog.filter((r) => r.owned).map((r) => Number(r.ep)));
      unlockLSelected = new Set([...unlockLSelected].filter((ep) => !owned.has(ep)));
      unlockLCatalogCache = { at: Date.now(), sid, data };
      paintUnlockLGrid();
      setStatus($("unlockl-status"), "เลือกตัวที่ยังไม่มี หรือกดเลือกทั้งหมด", "ok");
      return data;
    } catch (err) {
      setStatus($("unlockl-status"), String(err?.userMessage || err?.message || "โหลดคลังไม่สำเร็จ"), "err");
      return null;
    }
  }

  function selectAllUnlockL() {
    unlockLSelected = new Set(
      unlockLCatalog.filter((r) => !r.owned).map((r) => Number(r.ep))
    );
    paintUnlockLGrid();
  }

  function setUnlockLRunning(on) {
    unlockLRunning = !!on;
    $("farm-tab-unlock_l")?.classList.toggle("is-live-running", unlockLRunning);
    $("menu-nav-unlock_l")?.classList.toggle("is-live-running", unlockLRunning);
    const cancelBtn = $("unlockl-cancel-btn");
    if (cancelBtn) {
      cancelBtn.hidden = !unlockLRunning;
      cancelBtn.classList.toggle("hidden", !unlockLRunning);
      cancelBtn.disabled = false;
      cancelBtn.textContent = "ยกเลิก";
    }
    paintUnlockLQuote();
  }

  async function startUnlockLJob() {
    if (unlockLBusy || unlockLRunning) return;
    const sid = requireDevplaySessionId();
    if (!sid) return;
    const q = unlockLQuote(unlockLSelected, unlockLCatalog);
    if (!q.n) {
      setStatus($("unlockl-status"), "เลือกอย่างน้อย 1 ตัวที่ยังไม่มี", "err");
      return;
    }
    if (Number(unlockLSnap.life || 0) < 1) {
      setStatus($("unlockl-status"), "หัวใจเป็น 0 — ห้ามเริ่มปลดล็อค L", "err");
      return;
    }
    if (q.billable.includes(5) && Number(unlockLSnap.key || 0) < 1) {
      setStatus($("unlockl-status"), "Ice Tower (EP5) ต้องมีกุญแจ", "err");
      return;
    }
    unlockLBusy = true;
    setStatus($("unlockl-status"), "กำลังเริ่มงาน…", "muted");
    try {
      const data = await api("/api/farm/unlock-l/start", {
        method: "POST",
        body: { devplay_session_id: sid, target_eps: [...unlockLSelected] },
        timeoutMs: 45000,
      });
      if (data?.invite_credit_balance != null && profile) {
        profile.invite_credit_balance = data.invite_credit_balance;
        paintInviteStats({ invite_credit_balance: data.invite_credit_balance });
      }
      if (data?.job_id) {
        unlockLActiveJobId = data.job_id;
        persistKeyedJob(UNLOCKL_JOB_KEY, data.job_id);
        unlockLResultShownFor = null;
        setUnlockLRunning(true);
        pollUnlockLJob(data.job_id);
        setStatus($("unlockl-status"), "เข้าคิวแล้ว — หัก " + formatCredit(data.credits_charged) + " Credit", "ok");
      }
    } catch (err) {
      setStatus($("unlockl-status"), String(err?.userMessage || err?.message || "เริ่มไม่สำเร็จ"), "err");
    } finally {
      unlockLBusy = false;
      paintUnlockLQuote();
    }
  }

  function stopUnlockLPoll() {
    if (unlockLPollTimer) {
      clearInterval(unlockLPollTimer);
      unlockLPollTimer = null;
    }
  }

  function pollUnlockLJob(jobId) {
    stopUnlockLPoll();
    unlockLActiveJobId = jobId;
    let ticks = 0;
    const tick = async () => {
      ticks += 1;
      if (ticks > 1800) {
        stopUnlockLPoll();
        setStatus($("unlockl-status"), "รอผลนานเกินไป — กดรีเฟรช", "err");
        return;
      }
      try {
        const job = await api("/api/farm/job/" + encodeURIComponent(jobId));
        unlockLLogLines = paintCreditJobProgress("unlockl", job) || unlockLLogLines;
        if (["queued", "running"].includes(job.status)) setUnlockLRunning(true);
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          stopUnlockLPoll();
          persistKeyedJob(UNLOCKL_JOB_KEY, null);
          setUnlockLRunning(false);
          await refreshInviteStatus().catch(() => {});
          const jobKey = String(job.id || jobId);
          if (unlockLResultShownFor !== jobKey) {
            unlockLResultShownFor = jobKey;
            showUnlockLResultModal(job);
          }
          setStatus(
            $("unlockl-status"),
            job.status === "succeeded" ? "ปลดล็อค L สำเร็จ" : "จบ: " + (job.error || job.status),
            job.status === "succeeded" ? "ok" : "err"
          );
          refreshUnlockLCatalog({ force: true }).catch(() => {});
        }
      } catch (_) {}
    };
    tick();
    unlockLPollTimer = setInterval(tick, 2500);
  }

  async function cancelUnlockLJob() {
    const jobId = unlockLActiveJobId || loadKeyedJob(UNLOCKL_JOB_KEY);
    if (!jobId) return;
    try {
      await cancelServerJob(jobId);
      showToast("ส่งคำขอยกเลิกแล้ว", "ok");
      if (!unlockLPollTimer) pollUnlockLJob(jobId);
    } catch (e) {
      setStatus($("unlockl-status"), String(e?.userMessage || e?.message || "ยกเลิกไม่สำเร็จ"), "err");
    }
  }

  function resumeCreditJobsIfAny() {
    const ap = loadKeyedJob(AFTERPLAY_JOB_KEY);
    if (ap) pollAfterplayJob(ap);
    const ul = loadKeyedJob(UNLOCKL_JOB_KEY);
    if (ul) pollUnlockLJob(ul);
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

  function showAfterplayResultModal(job) {
    const res = job?.result && typeof job.result === "object" ? job.result : {};
    const before = res.before || {};
    const after = res.after || {};
    const delta = res.delta || {};
    const ebox = String(res.farm_mode || "") === "episode_box";
    const ok = job?.status === "succeeded" || !!res.ok;
    const nick = escapeHtml(String(devplaySession?.nickname || "—"));
    const levelNow = after.level ?? before.level;
    const account =
      nick + (levelNow != null ? " · level " + escapeHtml(formatNumTh(levelNow)) : "");
    const runsDone = formatNumTh(res.runs_done || 0);
    const runsTotal = formatNumTh(res.runs || job?.ticket_count || 0);
    const rows = [
      ["บัญชีเกม", account],
      ["โหมด", ebox ? "Episode Box · กล่องด่าน" : "เงิน/XP"],
      ["รอบ", runsDone + " / " + runsTotal + " สำเร็จ"],
    ];
    if (ebox && Array.isArray(res.target_eps) && res.target_eps.length) {
      rows.push(["ด่าน", escapeHtml(res.target_eps.join(", "))]);
    }
    if (ebox && res.boxes != null) {
      rows.push(["กล่อง", formatNumTh(res.boxes)]);
    }
    if (before.level != null || after.level != null) {
      rows.push([
        "เลเวล",
        escapeHtml(formatNumTh(before.level || 0)) +
          " → " +
          escapeHtml(formatNumTh(after.level || before.level || 0)) +
          ' <span class="result-delta">' +
          escapeHtml(signedDelta(delta.level)) +
          "</span>",
      ]);
    }
    rows.push(
      [
        "เหรียญ",
        '<span class="result-delta">' +
          escapeHtml(signedDelta(delta.coin)) +
          "</span> → ยอดรวม " +
          escapeHtml(formatNumTh(after.coin ?? before.coin ?? "—")),
      ],
      [
        "XP",
        '<span class="result-delta">' +
          escapeHtml(signedDelta(delta.exp)) +
          "</span> → ยอดรวม " +
          escapeHtml(formatNumTh(after.exp ?? before.exp ?? "—")),
      ],
      [
        "หัวใจ",
        escapeHtml(formatNumTh(before.life || 0)) +
          " → " +
          escapeHtml(formatNumTh(after.life ?? before.life ?? 0)) +
          ' <span class="result-delta">' +
          escapeHtml(signedDelta(delta.life)) +
          "</span>",
      ]
    );
    if (res.ok200) rows.push(["รอบ 200", formatNumTh(res.ok200)]);
    if (res.flagged) rows.push(["ธง 210 (ไปต่อ)", formatNumTh(res.flagged)]);
    if (res.failed_send) rows.push(["ส่งไม่ติด", formatNumTh(res.failed_send)]);
    if (res.refunded) rows.push(["คืน Credit", formatCredit(res.refunded)]);
    if (!ok && (job?.error || res.error)) {
      rows.push(["รายละเอียด", escapeHtml(String(job.error || res.error))]);
    }
    const html =
      '<table class="result-table"><tbody>' +
      rows.map(([k, v]) => "<tr><th>" + k + "</th><td>" + v + "</td></tr>").join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">ถ้าในเกมยังไม่เห็นยอด ให้ปิดเกมแล้วเข้าใหม่</p>';
    clearModalActions();
    openModal({
      mode: "result",
      title: ok
        ? ebox
          ? "สรุปผลกล่องด่าน"
          : "สรุปผลฟาร์มเงิน/XP"
        : ebox
          ? "กล่องด่านจบแล้ว"
          : "ฟาร์มเงิน/XP จบแล้ว",
      bodyHtml: html,
      icon: "assets/Cookie0023_head.png",
      locked: false,
    });
    $("modal-body")?.classList.add("result-stagger");
    if (ok) spawnPixelConfetti();
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function unlockLEpLabel(ep) {
    const row = (unlockLCatalog || []).find((r) => Number(r.ep) === Number(ep));
    return row?.name ? "EP" + ep + " " + row.name : "EP " + ep;
  }

  function showUnlockLResultModal(job) {
    const res = job?.result && typeof job.result === "object" ? job.result : {};
    const ok = job?.status === "succeeded" || !!res.ok;
    const unlocked = Array.isArray(res.unlocked) ? res.unlocked : [];
    const already = Array.isArray(res.already_owned) ? res.already_owned : [];
    const rows = [
      ["บัญชีเกม", escapeHtml(String(devplaySession?.nickname || "—"))],
      ["สถานะ", ok ? "สำเร็จ" : job?.status === "cancelled" ? "ยกเลิก" : "ไม่สำเร็จ"],
      ["ปลดแล้ว", unlocked.length ? unlocked.map(unlockLEpLabel).map(escapeHtml).join(", ") : "—"],
    ];
    if (already.length) {
      rows.push(["มีอยู่แล้ว", already.map(unlockLEpLabel).map(escapeHtml).join(", ")]);
    }
    if (res.refunded) rows.push(["คืน Credit", formatCredit(res.refunded)]);
    if (!ok && (job?.error || res.error)) {
      rows.push(["รายละเอียด", escapeHtml(String(job.error || res.error))]);
    }
    const html =
      '<table class="result-table"><tbody>' +
      rows.map(([k, v]) => "<tr><th>" + k + "</th><td>" + v + "</td></tr>").join("") +
      "</tbody></table>" +
      '<p class="queue-note" style="margin-top:12px">ถ้าในเกมยังไม่เห็นด่าน ให้ปิดเกมแล้วเข้าใหม่</p>';
    clearModalActions();
    openModal({
      mode: "result",
      title: ok ? "สรุปผลปลดล็อค L" : "ปลดล็อค L จบแล้ว",
      bodyHtml: html,
      icon: "assets/Tiger_Lily_Cookie.png",
      locked: false,
    });
    $("modal-body")?.classList.add("result-stagger");
    if (ok) spawnPixelConfetti();
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
      icon: "assets/magic_powder.png",
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
      clearTimeout(queuePollTimer);
      queuePollTimer = null;
    }
  }

  function queuePollDelayMs() {
    const busy =
      !!activeWatchJobId ||
      pendingFarmJobs.length > 0 ||
      dockPhase === "running" ||
      dockPhase === "queued";
    return busy ? 2500 : 8000;
  }

  function scheduleQueuePollTick() {
    queuePollTimer = setTimeout(() => {
      queuePollTimer = null;
      if (!document.hidden) {
        refreshGateAndQueueUi().catch(() => {});
      }
      scheduleQueuePollTick();
    }, queuePollDelayMs());
  }

  function startQueuePoll() {
    // Avoid thundering-herd: do not reset the timer on every gate refresh.
    if (queuePollTimer) {
      refreshGateAndQueueUi().catch(() => {});
      return;
    }
    refreshGateAndQueueUi().catch(() => {});
    scheduleQueuePollTick();
  }

  function jobKindToMode(kind) {
    // Return null for unknown/missing kinds so callers can decide instead of
    // silently defaulting to Party Run (the old bug: active-job without job_kind).
    if (kind == null || kind === "") return null;
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
    return map[kind] || kind;
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
    afterplay_fast: "ฟาร์มเงิน/XP",
    unlock_l: "ปลดล็อค L",
    upgrade: "ตีบวกสมบัติ",
    cookie_unlock: "ปลดล็อกคุกกี้",
    reroll: "รีโรล",
    quest_claim: "รับรางวัลเควส",
  };

  // Rough wait from gate.me.eta_sec (pool-aware) with legacy position×turn fallback.
  function formatEtaSec(sec) {
    const n = Math.max(0, Math.floor(Number(sec) || 0));
    if (n <= 0) return "";
    if (n < 90) return "ประมาณ " + n + " วินาที";
    if (n < 3600) return "ประมาณ " + Math.ceil(n / 60) + " นาที";
    const h = Math.floor(n / 3600);
    const m = Math.ceil((n % 3600) / 60);
    return m > 0 ? "ประมาณ " + h + " ชม. " + m + " นาที" : "ประมาณ " + h + " ชม.";
  }

  function poolLabelTh(poolOrKind) {
    const k = String(poolOrKind || "").toLowerCase();
    if (k === "heart") return "คิวหัวใจ";
    if (k === "powder") return "คิวผง";
    if (k === "light") return "คิวงานเบา";
    return JOB_KIND_TH[k] ? "คิว" + JOB_KIND_TH[k] : "คิวฟาร์ม";
  }

  function queueWaitText(gate) {
    const g = gate || {};
    const me = g.me || {};
    if (me.eta_sec != null && Number(me.eta_sec) >= 0 && me.status === "waiting") {
      return formatEtaSec(me.eta_sec);
    }
    const ahead =
      me.ahead != null
        ? Number(me.ahead)
        : Number(me.position) > 0
          ? Number(me.position) - 1
          : NaN;
    const turn = Number(g.turn_seconds) || 120;
    if (!Number.isFinite(ahead) || ahead < 0) return "";
    if (ahead === 0) return "ใกล้ถึงคิวแล้ว";
    return formatEtaSec(ahead * turn);
  }

  function queueRankChipText(gate, phase) {
    if (phase !== "queued") return "";
    const me = (gate || lastGate || {}).me || {};
    if (me.position != null && Number(me.position) > 0) {
      return "รอคิว · อันดับ " + Number(me.position);
    }
    return "รอคิว";
  }

  function queueDetailText(gate, jobTitle) {
    const g = gate || lastGate || {};
    const me = g.me || {};
    const pool = me.pool || g.pool || me.kind || "";
    const label = poolLabelTh(pool) || jobTitle || "คิวฟาร์ม";
    const ahead =
      me.ahead != null
        ? Number(me.ahead)
        : me.position != null
          ? Math.max(0, Number(me.position) - 1)
          : null;
    const wait = queueWaitText(g);
    const parts = [label];
    if (ahead != null && Number.isFinite(ahead)) {
      parts.push(
        ahead <= 0 ? "ถึงคิวของคุณแล้ว" : "มี " + ahead + " คนอยู่ข้างหน้า"
      );
    }
    if (wait) parts.push("อีก" + wait.replace(/^ประมาณ /, " "));
    return parts.join(" · ");
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
    } else if (isHeavyWorkerRecycling()) {
      bodyHtml +=
        '<p class="queue-note">' + escapeHtml(ERR_TH.worker_unavailable) + "</p>";
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
          leaveServerQueue()
            .catch(() => {})
            .finally(() => {
              forceCloseModal();
            });
        })
      );
    }
  }

  async function leaveServerQueue() {
    try {
      await api("/api/farm/queue/leave", { method: "POST", body: {} });
    } catch (_) {
      /* still clear local state */
    }
    clearQueuedRun();
    stopQueuePoll();
    if (dockPhase === "queued") resetFarmDockIdle();
    setFarmStatus("ยกเลิกคิวแล้ว", "muted");
    refreshGateAndQueueUi().catch(() => {});
    renderFarmDock();
  }

  async function cancelServerJob(jobId) {
    if (!jobId) return null;
    return api("/api/farm/job/" + encodeURIComponent(jobId) + "/cancel", {
      method: "POST",
      body: {},
    });
  }

  async function cancelAllMyFarmWork() {
    clearPendingFarmJobs();
    const liveId = liveJob?.id || activeWatchJobId;
    // Optimistic UI first.
    clearQueuedRun();
    stopQueuePoll();
    stopWatchJobPoll();
    stopDockElapsedTimer();
    if (liveJob && !liveJob.finished) {
      liveJob.finished = true;
      dockPhase = "error";
      dockOk = false;
    }
    setFarmStatus("กำลังยกเลิกทั้งหมด…", "muted");
    scheduleRenderFarmDock({ immediate: true });
    try {
      await api("/api/farm/jobs/cancel-all", { method: "POST", body: {} });
    } catch (e) {
      if (liveId) {
        try {
          await cancelServerJob(liveId);
        } catch (_) {}
      }
      try {
        await api("/api/farm/queue/leave", { method: "POST", body: {} });
      } catch (_) {}
    }
    setFarmStatus("ยกเลิกงานทั้งหมดแล้ว", "muted");
    scheduleRenderFarmDock();
    updateFarmAvailability();
    refreshGateAndQueueUi().catch(() => {});
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

  /** Hard-reset live dock state so the next job never inherits the previous mode/steps/logs. */
  function resetDockLiveForJob(mode, target, extras = {}) {
    const m = mode || "partyrun";
    clearStageTimer();
    stopDockElapsedTimer();
    // New job takes over the single live slot; its id is attached once known (watchFarmJob).
    liveJob = { id: null, mode: m, target: Number(target) || 0, finished: false };
    dockPhase = "running";
    dockOk = null;
    dockJobStartedAt = Date.now();
    dockJobFinishedAt = null;
    dockLiveLogOpen = false;
    jobStatusTab = "live";
    const prevThumbs =
      statusContext?.mode === m && Array.isArray(statusContext?.cookieThumbs)
        ? statusContext.cookieThumbs
        : null;
    statusContext = {
      mode: m,
      target: Number(target) || 0,
      ...(prevThumbs ? { cookieThumbs: prevThumbs } : {}),
      ...extras,
    };
    pipelineState = freshPipeline(m);
    startDockElapsedTimer();
  }

  /** Drop a finished live card so a newly queued job is not buried under stale Party Run/etc. */
  function clearFinishedLiveCard() {
    if (dockPhase !== "done" && dockPhase !== "error") return;
    dockPhase = null;
    dockOk = null;
    dockJobStartedAt = null;
    dockJobFinishedAt = null;
    stopDockElapsedTimer();
    pipelineState = null;
    statusContext = null;
    if (liveJob?.finished) liveJob = null;
  }

  function enqueueFarmJob({ mode, label, target, runFn, extras }) {
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
      extras: extras || null,
    });
    // Finished card must not keep showing the previous mode over the new queued job.
    clearFinishedLiveCard();
    showFarmDock();
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

  function cancelLiveFarmJob() {
    const jobId = liveJob?.id || activeWatchJobId;
    if (!jobId) return Promise.resolve();
    const wasQueued = dockPhase === "queued";
    if (liveJob) liveJob.cancelRequested = true;
    if (pipelineState) pipelineState.cancelling = true;
    setFarmStatus(ERR_TH.cancelling, "muted");
    showToast(wasQueued ? "กำลังออกจากคิว…" : ERR_TH.cancelling, "muted");
    scheduleRenderFarmDock();
    return cancelServerJob(jobId)
      .then(() => {
        if (wasQueued) {
          // Queued cancel is immediate on server.
          if (liveJob) liveJob.finished = true;
          dockPhase = "error";
          dockOk = false;
          persistWatchJobId(null);
          stopWatchJobPoll();
          stopDockElapsedTimer();
          setFarmStatus("ออกจากคิวแล้ว", "muted");
        } else {
          // Soft-cancel: keep watching until terminal.
          setFarmStatus("ส่งคำขอยกเลิกแล้ว — รอระบบหยุดงาน", "muted");
          if (!watchJobTimer && jobId) {
            watchFarmJob(
              jobId,
              liveJob?.mode || statusContext?.mode || "partyrun",
              liveJob?.target || statusContext?.target || 0,
              {}
            ).catch(() => {});
          }
        }
        scheduleRenderFarmDock();
      })
      .catch((e) => {
        if (liveJob) liveJob.cancelRequested = false;
        if (pipelineState) pipelineState.cancelling = false;
        showErrorModal(thError(e.message) || "ยกเลิกไม่สำเร็จ", "ยกเลิกงาน");
        resumeFarmSession().catch(() => {});
      });
  }

  function stopAdminJobsPoll() {
    if (adminJobsPollTimer) {
      clearTimeout(adminJobsPollTimer);
      adminJobsPollTimer = null;
    }
  }

  function adminJobsPollDelayMs() {
    return jobStatusTab === "admin" && adminJobsTab === "live" ? 8000 : 12000;
  }

  function scheduleAdminJobsPollTick() {
    adminJobsPollTimer = setTimeout(() => {
      adminJobsPollTimer = null;
      if (!document.hidden && jobStatusTab === "admin" && adminJobsTab === "live") {
        loadAdminJobs({ reset: true, silent: true }).catch(() => {});
      }
      if (isAdminUser()) scheduleAdminJobsPollTick();
    }, adminJobsPollDelayMs());
  }

  function startAdminJobsPoll() {
    if (!isAdminUser()) return;
    if (adminJobsPollTimer) return;
    scheduleAdminJobsPollTick();
  }

  function adminJobsFingerprint(items) {
    return (items || [])
      .map((r) =>
        [
          r.job_id || "",
          r.status || "",
          r.cancel_requested ? "1" : "0",
          (r.progress && r.progress.current) || "",
          (r.progress && r.progress.phase) || "",
          r.error || "",
          r.heartbeat_at || "",
          adminJobIsStuck(r) ? "stuck" : "",
        ].join(":")
      )
      .join("|");
  }

  function adminJobAgeSec(row) {
    const ts = row.heartbeat_at || row.started_at || row.created_at;
    if (!ts) return null;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 1000));
  }

  function adminJobIsStuck(row) {
    const st = row.status || "";
    if (st !== "running" && st !== "queued") return false;
    if (row.cancel_requested) return true;
    const hb = row.heartbeat_at ? Date.parse(row.heartbeat_at) : NaN;
    const started = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at || "");
    const now = Date.now();
    // Running with no heartbeat for >90s, or heartbeat/start older than 10 min.
    if (st === "running") {
      if (!Number.isFinite(hb)) {
        if (Number.isFinite(started) && now - started > 90_000) return true;
      } else if (now - hb > 90_000) {
        return true;
      }
      if (Number.isFinite(started) && now - started > 600_000) return true;
    }
    if (st === "queued" && Number.isFinite(started) && now - started > 600_000) return true;
    return false;
  }

  function adminJobToCard(row) {
    const kind = row.kind || "partyrun";
    const mode = jobKindToMode(kind);
    const st = row.status || "";
    const stuck = adminJobIsStuck(row);
    const phase = stuck
      ? "stuck"
      : st === "succeeded"
        ? "done"
        : st === "failed" || st === "cancelled"
          ? "error"
          : st === "running"
            ? "running"
            : st === "queued"
              ? "queued"
              : "idle";
    let badge =
      st === "succeeded"
        ? "สำเร็จ"
        : st === "failed"
          ? "ล้มเหลว"
          : st === "cancelled"
            ? "ยกเลิก"
            : st === "running"
              ? "กำลังรัน"
              : st === "queued"
                ? "รอคิว"
                : st;
    if (stuck) badge = "ค้าง";
    const canCancel = st === "queued" || st === "running";
    const prog = row.progress || {};
    const progText =
      prog.total > 0
        ? String(prog.current || 0) + "/" + String(prog.total) + (prog.phase ? " · " + prog.phase : "")
        : prog.phase || "";
    const ageSec = adminJobAgeSec(row);
    const ageLine = ageSec != null ? "อายุ " + formatDockElapsed(ageSec) : "";
    const startedLine = formatDockStartedAt(row.started_at || row.created_at || row.finished_at) || "";
    const timeLine = [startedLine, ageLine, stuck ? "บังคับจบได้" : ""]
      .filter(Boolean)
      .join(" · ");
    return {
      mode,
      phase,
      title: (row.username || "user") + " · " + (JOB_KIND_TH[kind] || kind),
      badge,
      detail: row.error || progText || kind,
      timeLine,
      live: false,
      cancelable: canCancel,
      adminCancelId: canCancel ? row.job_id : "",
      jobId: row.job_id || "",
      stuck,
      adminJobId: row.job_id || "",
    };
  }

  function isHeavyWorkerRecycling() {
    const workers = (lastHealth && lastHealth.workers) || {};
    const heart = workers.heart || {};
    const powder = workers.powder || {};
    const heavy = workers.heavy || {};
    return !!(
      heavy.recycling ||
      heavy.alive === false ||
      (heart.alive === false && powder.alive === false) ||
      heart.recycling ||
      powder.recycling ||
      (lastHealth && lastHealth.worker_recycling) ||
      window.__ckrWorkerRecycling
    );
  }

  function renderAdminWorkerChip() {
    const chip = $("farm-dock-admin-worker");
    const text = $("farm-dock-admin-worker-text");
    if (!chip || !text) return;
    const alive = Number(window.__ckrWorkersAlive);
    const memPct = Number(window.__ckrMemoryPct);
    const memNote = Number.isFinite(memPct) ? " · RAM " + memPct + "%" : "";
    const workers = (lastHealth && lastHealth.workers) || {};
    const heartOk = !!(workers.heart && workers.heart.alive);
    const powderOk = !!(workers.powder && workers.powder.alive);
    const lightOk = !!(workers.light && workers.light.alive);
    const heavyOk = !!(workers.heavy && workers.heavy.alive) || heartOk || powderOk;
    chip.classList.remove("is-alive", "is-down");
    if (!Number.isFinite(alive)) {
      text.textContent = "กำลังตรวจสอบ worker…";
    } else if (alive <= 0) {
      chip.classList.add("is-down");
      text.textContent = "ไม่มี worker พร้อมทำงาน — งานใหม่จะค้างในคิว" + memNote;
    } else {
      const ok = (heartOk || heavyOk) && powderOk && lightOk;
      // If split pools missing from health payload, fall back to heavy/light.
      const hasSplit = !!(workers.heart || workers.powder);
      chip.classList.add(ok || (!hasSplit && heavyOk && lightOk) ? "is-alive" : "is-down");
      if (hasSplit) {
        text.textContent =
          "หัวใจ " +
          (heartOk ? "พร้อม" : "ออฟไลน์") +
          " · ผง " +
          (powderOk ? "พร้อม" : "ออฟไลน์") +
          " · เบา " +
          (lightOk ? "พร้อม" : "ออฟไลน์") +
          " (" +
          alive +
          " ตัว)" +
          memNote;
      } else {
        text.textContent =
          "Heavy " +
          (heavyOk ? "พร้อม" : "ออฟไลน์") +
          " · Light " +
          (lightOk ? "พร้อม" : "ออฟไลน์") +
          " (" +
          alive +
          " ตัว)" +
          memNote;
      }
    }
    const heartMaxRow = $("farm-dock-admin-heart-max");
    if (heartMaxRow) heartMaxRow.classList.toggle("hidden", !isAdminUser());
    const powderMaxRow = $("farm-dock-admin-powder-max");
    if (powderMaxRow) powderMaxRow.classList.toggle("hidden", !isAdminUser());
  }

  async function loadAdminHeartMaxSetting() {
    if (!isAdminUser()) return;
    const input = $("farm-dock-admin-heart-max-input");
    const msg = $("farm-dock-admin-heart-max-msg");
    const powderInput = $("farm-dock-admin-powder-max-input");
    const powderMsg = $("farm-dock-admin-powder-max-msg");
    if (!input && !powderInput) return;
    try {
      const data = await api("/api/admin/settings");
      const n = Number(data.heart_max_target);
      if (Number.isFinite(n) && input) input.value = String(n);
      const range = data.heart_max_target_range;
      if (Array.isArray(range) && range.length >= 2 && input) {
        input.min = String(range[0]);
        input.max = String(range[1]);
      }
      const pn = Number(data.powder_max_target);
      if (Number.isFinite(pn) && powderInput) {
        powderInput.value = String(pn);
        powderMax = Math.max(1, Math.floor(pn));
        clampPowderTargetInputs();
      }
      const pr = data.powder_max_target_range;
      if (Array.isArray(pr) && pr.length >= 2 && powderInput) {
        powderInput.min = String(pr[0]);
        powderInput.max = String(pr[1]);
      }
      if (msg) msg.textContent = "";
      if (powderMsg) {
        const hi = Array.isArray(pr) && pr.length >= 2 ? pr[1] : null;
        powderMsg.textContent = hi
          ? "ค่าปัจจุบันใช้เป็นเพดานผู้ใช้ · แอดมินปรับได้ 1–" + formatNumTh(hi)
          : "ค่าเริ่มต้น 5,000 — แอดมินปรับเพิ่ม/ลดได้";
      }
    } catch (e) {
      const err = thError(e.message) || "โหลดการตั้งค่าไม่สำเร็จ";
      if (msg) msg.textContent = err;
      if (powderMsg) powderMsg.textContent = err;
    }
  }

  async function saveAdminHeartMaxSetting() {
    const input = $("farm-dock-admin-heart-max-input");
    const msg = $("farm-dock-admin-heart-max-msg");
    const btn = $("farm-dock-admin-heart-max-save");
    if (!input || !isAdminUser()) return;
    const n = Math.floor(Number(input.value) || 0);
    if (!Number.isFinite(n) || n < 1) {
      if (msg) msg.textContent = "ใส่จำนวนหัวใจที่ถูกต้อง";
      return;
    }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = "กำลังบันทึก…";
    try {
      const data = await api("/api/admin/settings", {
        method: "POST",
        body: { heart_max_target: n },
      });
      const saved = Number(data.heart_max_target);
      if (Number.isFinite(saved)) {
        heartMax = saved;
        heartTarget = clampHeartTarget(heartTarget);
        paintHeartStepper();
        if (input) input.value = String(saved);
      }
      if (msg) msg.textContent = "บันทึกแล้ว — สูงสุด " + formatNumTh(saved || n) + " หัวใจ/job";
    } catch (e) {
      if (msg) msg.textContent = thError(e.message) || "บันทึกไม่สำเร็จ";
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function saveAdminPowderMaxSetting() {
    const input = $("farm-dock-admin-powder-max-input");
    const msg = $("farm-dock-admin-powder-max-msg");
    const btn = $("farm-dock-admin-powder-max-save");
    if (!input || !isAdminUser()) return;
    const n = Math.floor(Number(String(input.value || "").replace(/[^\d]/g, "")) || 0);
    const minAllowed = Math.max(1, Number(input.min) || 1);
    const maxAllowed = Math.max(minAllowed, Number(input.max) || 2000000);
    if (!Number.isFinite(n) || n < minAllowed) {
      if (msg) msg.textContent = "ใส่จำนวนผงอย่างน้อย " + formatNumTh(minAllowed);
      return;
    }
    if (n > maxAllowed) {
      if (msg)
        msg.textContent =
          "สูงสุดที่ระบบรับได้คือ " + formatNumTh(maxAllowed) + " ผง/รอบ";
      return;
    }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = "กำลังบันทึก…";
    try {
      const data = await api("/api/admin/settings", {
        method: "POST",
        body: { powder_max_target: n },
      });
      const saved = Number(data.powder_max_target);
      if (Number.isFinite(saved)) {
        powderMax = Math.max(1, Math.floor(saved));
        if (input) input.value = String(powderMax);
        clampPowderTargetInputs();
        paintPowderGoalControls();
        refreshPowderEstimate().catch(() => {});
      }
      const range = data.powder_max_target_range;
      if (Array.isArray(range) && range.length >= 2) {
        input.min = String(range[0]);
        input.max = String(range[1]);
      }
      if (msg)
        msg.textContent =
          "บันทึกแล้ว — ผู้ใช้ตั้งเป้าได้สูงสุด " +
          formatNumTh(saved || n) +
          " ผง/รอบ";
    } catch (e) {
      if (msg) msg.textContent = thError(e.message) || "บันทึกไม่สำเร็จ";
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderAdminStats() {
    const statsBox = $("farm-dock-admin-stats");
    const filters = $("farm-dock-admin-filters");
    const showLive = adminJobsTab === "live";
    if (statsBox) statsBox.classList.toggle("hidden", !showLive);
    if (filters) filters.classList.toggle("hidden", !showLive);
    if (!showLive) return;
    let running = 0;
    let queued = 0;
    let stuck = 0;
    for (const r of adminJobsItems) {
      if (adminJobIsStuck(r)) stuck += 1;
      if (r.status === "running") running += 1;
      else if (r.status === "queued") queued += 1;
    }
    const set = (id, n) => {
      const el = $(id);
      if (el) el.textContent = String(n);
    };
    set("farm-dock-admin-stat-running", running);
    set("farm-dock-admin-stat-queued", queued);
    set("farm-dock-admin-stat-stuck", stuck);
    document.querySelectorAll("[data-admin-filter]").forEach((btn) => {
      btn.classList.toggle(
        "is-active",
        btn.getAttribute("data-admin-filter") === adminJobsFilter
      );
    });
  }

  function adminJobsFiltered() {
    if (adminJobsTab !== "live" || adminJobsFilter === "all") return adminJobsItems;
    return adminJobsItems.filter((r) => {
      if (adminJobsFilter === "stuck") return adminJobIsStuck(r);
      if (adminJobsFilter === "running") return r.status === "running";
      if (adminJobsFilter === "queued") return r.status === "queued";
      return true;
    });
  }

  function renderAdminJobsList() {
    const box = $("farm-dock-admin-list");
    const moreBtn = $("farm-dock-admin-more");
    const warn = $("farm-dock-admin-warn");
    const focusedElement = document.activeElement;
    const focusedCancelId = box?.contains(focusedElement)
      ? focusedElement.dataset.adminCancel || ""
      : "";
    renderAdminWorkerChip();
    renderAdminStats();
    if (warn) {
      const alive = Number(window.__ckrWorkersAlive);
      if (isHeavyWorkerRecycling() && adminJobsTab === "live") {
        warn.textContent = ERR_TH.worker_unavailable;
        warn.classList.remove("hidden");
      } else if (Number.isFinite(alive) && alive <= 0 && adminJobsTab === "live") {
        warn.textContent = "ไม่มี worker ที่พร้อมทำงาน — งานใหม่อาจค้างในคิว";
        warn.classList.remove("hidden");
      } else {
        warn.textContent = "";
        warn.classList.add("hidden");
      }
    }
    if (!box) return;
    box.replaceChildren();
    const rows = adminJobsFiltered();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "farm-dock-empty";
      empty.textContent =
        adminJobsTab === "live"
          ? adminJobsItems.length
            ? "ไม่มีงานในตัวกรองนี้"
            : "ไม่มีงานที่กำลังรันหรือรอคิว"
          : "ยังไม่มีประวัติงาน";
      box.appendChild(empty);
    } else {
      for (const row of rows) {
        box.appendChild(renderTxCard(adminJobToCard(row)));
      }
    }
    if (focusedCancelId) {
      const focusedButton = Array.from(box.querySelectorAll("[data-admin-cancel]")).find(
        (button) => button.dataset.adminCancel === focusedCancelId
      );
      focusedButton?.focus({ preventScroll: true });
    }
    if (moreBtn) {
      moreBtn.classList.toggle("hidden", !(adminJobsTab === "history" && adminJobsHasMore));
    }
  }

  let adminJobsLoading = false;
  let adminJobsFp = "";

  async function loadAdminJobs({ reset = true, silent = false } = {}) {
    if (!isAdminUser()) return;
    if (adminJobsLoading) return;
    adminJobsLoading = true;
    try {
      if (reset) adminJobsOffset = 0;
      const status = adminJobsTab === "history" ? "history" : "active";
      const data = await api(
        "/api/admin/jobs?status=" +
          encodeURIComponent(status) +
          "&limit=" +
          ADMIN_JOBS_PAGE +
          "&offset=" +
          adminJobsOffset
      );
      const items = Array.isArray(data.items) ? data.items : [];
      const next = reset ? items : adminJobsItems.concat(items);
      const fp = adminJobsFingerprint(next);
      const changed = fp !== adminJobsFp || !reset;
      adminJobsItems = next;
      adminJobsOffset = adminJobsItems.length;
      adminJobsHasMore = items.length >= ADMIN_JOBS_PAGE;
      adminJobsFp = fp;
      // Silent poll: rebuild DOM only when data actually changed.
      if (!silent || changed) renderAdminJobsList();
      if (adminJobsTab === "live") startAdminJobsPoll();
      else stopAdminJobsPoll();
    } finally {
      adminJobsLoading = false;
    }
  }

  async function adminCancelJob(jobId) {
    if (!jobId) return;
    // Optimistic remove so stuck rows disappear immediately in Admin UI.
    adminJobsItems = adminJobsItems.filter((r) => r.job_id !== jobId);
    adminJobsFp = adminJobsFingerprint(adminJobsItems);
    renderAdminJobsList();
    try {
      await api("/api/admin/jobs/" + encodeURIComponent(jobId) + "/cancel", {
        method: "POST",
        body: {},
      });
      setFarmStatus("ยกเลิกงานของ user แล้ว", "muted");
    } finally {
      await loadAdminJobs({ reset: true });
    }
  }

  async function adminClearQueueAll() {
    const ok = window.confirm(
      "ล้างคิวทั้งระบบและยกเลิกงาน queued/running ทั้งหมด?"
    );
    if (!ok) return;
    adminJobsItems = [];
    adminJobsFp = "";
    renderAdminJobsList();
    const data = await api("/api/admin/queue/clear", { method: "POST", body: {} });
    setFarmStatus(
      "ล้างคิวแล้ว — งาน " + (data.cancelled_jobs || 0) + " รายการ",
      "ok"
    );
    await loadAdminJobs({ reset: true });
  }

  function dequeueAndStartNext(delayMs) {
    if (startingFromPersonalQueue) return;
    if (isFarmExecutorBusy()) return;
    if (queuedRun) return;
    if (!pendingFarmJobs.length) return;
    if (pendingStartTimer) return;
    // Keep success/error visible briefly before switching to the next queued job.
    const wait =
      delayMs != null
        ? Math.max(0, Number(delayMs) || 0)
        : dockPhase === "done" || dockPhase === "error"
          ? 900
          : 320;
    pendingStartTimer = setTimeout(() => {
      pendingStartTimer = null;
      if (isFarmExecutorBusy() || queuedRun) return;
      const next = pendingFarmJobs.shift();
      if (!next || typeof next.runFn !== "function") {
        renderFarmDock();
        updateFarmAvailability();
        return;
      }
      resetDockLiveForJob(next.mode, next.target, next.extras || {});
      renderFarmDock({ mode: next.mode, target: next.target });
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
    }, wait);
  }

  /** If a farm job is already running, enqueue instead of submitting now. */
  function queueIfBusy(mode, target, label, runFn, extras) {
    if (startingFromPersonalQueue) return false;
    if (!isFarmExecutorBusy()) return false;
    enqueueFarmJob({ mode, target, label, runFn, extras });
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
      if (data.is_admin && profile) {
        profile.role = "admin";
        profile.is_admin = true;
      }
      if (Array.isArray(data.early_access_features)) {
        applyEarlyAccess(data.early_access_features);
      }
      if (Array.isArray(data.farm_feature_order)) applyFarmFeatureOrder(data.farm_feature_order);
      if (data.feature_locks) applyFeatureLocks(data.feature_locks);
      else paintFeatureLocks();
      const queueStatus = data.me?.status;
      const isQueued = queueStatus === "waiting" || queueStatus === "active";
      if (isQueued) {
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
      const isLocallyQueued = dockPhase === "queued" || !!queuedRun;
      if (isLocallyQueued && isTransientNetworkError(e)) {
        showFarmDockQueue(lastGate || { farm_busy: true, queue_length: 0 }, { waking: true });
        startQueuePoll();
      }
      return null;
    }
  }

  function stopActivityPoll() {
    if (activityPollTimer) {
      clearTimeout(activityPollTimer);
      activityPollTimer = null;
    }
  }

  function activityPollDelayMs() {
    const busy =
      dockPhase === "running" ||
      dockPhase === "queued" ||
      !!activeWatchJobId ||
      pendingFarmJobs.length > 0;
    // Keep polls light — activity is cached server-side; hammering it under
    // heart load was starving login/run requests.
    return busy ? 8000 : 30000;
  }

  function scheduleActivityPollTick() {
    activityPollTimer = setTimeout(() => {
      activityPollTimer = null;
      if (!document.hidden) {
        refreshFarmActivity().catch(() => {});
      }
      scheduleActivityPollTick();
    }, activityPollDelayMs());
  }

  function startActivityPoll() {
    stopActivityPoll();
    refreshFarmActivity().catch(() => {});
    scheduleActivityPollTick();
  }

  function paintFarmActivity(data) {
    farmActivityData = data || null;
    // Activity is informational only. Rebuilding the status sheet here caused
    // tab/focus flicker every poll, especially on iOS.
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
    if (isHeavyWorkerRecycling()) {
      return {
        title: "สถานะระบบ",
        sub: ERR_TH.worker_unavailable,
      };
    }
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
    dockJobFinishedAt = null;
    liveJob = null;
    statusContext = null;
    pipelineState = null;
    farmDockFlash = { text: "", kind: "muted" };
    stopDockElapsedTimer();
    hideJobStatusShell();
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
    const plan = powderPlan || {};
    const coins = Number(plan.coin_available ?? devplaySession?.coin ?? 0);
    const r = Math.max(1, Number(rounds) || Number(plan.rounds) || 1);
    const cost = Number(plan.coin_cost) || r * powderPricePerRound();
    const gain = Number(plan.powder_gain) || r * powderYieldPerRound();
    const body =
      "รัน " +
      formatNumTh(r) +
      " กล่อง\n" +
      "ใช้เหรียญ " +
      formatNumTh(cost) +
      " (เหลือประมาณ " +
      formatNumTh(Math.max(0, coins - cost)) +
      ")\n" +
      "ได้ผงประมาณ +" +
      formatNumTh(gain);
    return new Promise((resolve) => {
      clearModalActions();
      openModal({
        mode: "confirm",
        title: "ยืนยันฟาร์มผง?",
        body,
        icon: "assets/magic_powder.png",
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
        icon: "assets/Heart.png",
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
    const { email, password } = getDevPlayCreds();
    return !!(email && password);
  }

  function getDevPlayCreds() {
    if (devplaySession?.email && devplaySession?.password) {
      return {
        email: String(devplaySession.email).trim(),
        password: String(devplaySession.password),
      };
    }
    const mail = ($("dp-acct-mail")?.value || "").trim();
    const secret = $("dp-acct-secret")?.value || "";
    return { email: mail, password: secret };
  }

  function getDevPlayAccountDisplayName() {
    if (!devplaySession) return "—";
    const nick = String(devplaySession.nickname || "").trim();
    if (nick && nick.toLowerCase() !== "player") return nick;
    const mail = String(devplaySession.email || "").trim();
    if (mail.includes("@")) return mail.split("@")[0] || mail;
    if (mail) return mail;
    if (nick) return nick;
    return "—";
  }

  function devplayVaultStorageKey() {
    const uid = profile?.id;
    if (!uid) return null;
    return "ckr_devplay_vault_v1_" + uid;
  }

  function vaultBytesToB64(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function vaultB64ToBytes(str) {
    const bin = atob(String(str || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveDevPlayVaultKey(userId) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(String(userId) + "|" + DEVPLAY_VAULT_PEPPER),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("ckr-devplay-vault-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptDevPlayVault(entries) {
    const uid = profile?.id;
    if (!uid) return null;
    const key = await deriveDevPlayVaultKey(uid);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(entries));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return JSON.stringify({ v: 1, iv: vaultBytesToB64(iv), data: vaultBytesToB64(cipher) });
  }

  async function decryptDevPlayVault(blob) {
    const uid = profile?.id;
    if (!uid) return [];
    const parsed = JSON.parse(blob);
    if (!parsed || parsed.v !== 1 || !parsed.iv || !parsed.data) return [];
    const key = await deriveDevPlayVaultKey(uid);
    const iv = vaultB64ToBytes(parsed.iv);
    const cipher = vaultB64ToBytes(parsed.data);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    const entries = JSON.parse(new TextDecoder().decode(plain));
    return Array.isArray(entries) ? entries : [];
  }

  async function loadLocalDevPlayVaultEntries() {
    const storageKey = devplayVaultStorageKey();
    if (!storageKey) return [];
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    try {
      const entries = await decryptDevPlayVault(raw);
      return Array.isArray(entries) ? entries : [];
    } catch (_) {
      return [];
    }
  }

  function clearLocalDevPlayVault() {
    const storageKey = devplayVaultStorageKey();
    if (storageKey) localStorage.removeItem(storageKey);
  }

  async function migrateLocalDevPlayVaultToCloud(localEntries) {
    if (!Array.isArray(localEntries) || !localEntries.length) return;
    for (const entry of localEntries) {
      const email = String(entry?.email || "").trim();
      const password = String(entry?.password || "");
      if (!email || !password) continue;
      try {
        await api("/api/devplay/vault", {
          method: "PUT",
          body: {
            email,
            password,
            nickname: entry.nickname || "player",
            cookieName: entry.cookieName || null,
            profileImageKey: entry.profileImageKey || null,
          },
        });
      } catch (_) {
        /* keep local; retry next login */
        return;
      }
    }
    clearLocalDevPlayVault();
  }

  async function persistLocalDevPlayVault(entries) {
    const storageKey = devplayVaultStorageKey();
    if (!storageKey) return;
    try {
      const list = Array.isArray(entries) ? entries.slice(0, DEVPLAY_VAULT_MAX) : [];
      if (!list.length) {
        localStorage.removeItem(storageKey);
        return;
      }
      const blob = await encryptDevPlayVault(list);
      if (blob) localStorage.setItem(storageKey, blob);
    } catch (_) {}
  }

  async function loadDevPlayVault() {
    devplayVaultEntries = [];
    if (!profile?.id || !accessToken) {
      paintDevPlayAccountPicker();
      return;
    }
    try {
      await ensureApiReady();
      const data = await api("/api/devplay/vault");
      const remote = Array.isArray(data.entries) ? data.entries : [];
      if (remote.length) {
        devplayVaultEntries = remote.slice(0, DEVPLAY_VAULT_MAX);
        await persistLocalDevPlayVault(devplayVaultEntries);
      } else {
        const localEntries = await loadLocalDevPlayVaultEntries();
        if (localEntries.length) {
          await migrateLocalDevPlayVaultToCloud(localEntries);
          const again = await api("/api/devplay/vault");
          devplayVaultEntries = Array.isArray(again.entries)
            ? again.entries.slice(0, DEVPLAY_VAULT_MAX)
            : localEntries.slice(0, DEVPLAY_VAULT_MAX);
          await persistLocalDevPlayVault(devplayVaultEntries);
        }
      }
    } catch (_) {
      const localEntries = await loadLocalDevPlayVaultEntries();
      devplayVaultEntries = localEntries.slice(0, DEVPLAY_VAULT_MAX);
    }
    paintDevPlayAccountPicker();
  }

  async function upsertDevPlayVaultEntry(creds, meta = {}) {
    const emailRaw = String(creds?.email || "").trim();
    const password = String(creds?.password || "");
    if (!emailRaw || !password) return;
    const emailKey = emailRaw.toLowerCase();
    const next = {
      email: emailRaw,
      password,
      nickname: meta.nickname || "player",
      cookieName: meta.cookieName || null,
      profileImageKey: meta.profileImageKey || null,
      lastUsedAt: Date.now(),
    };
    // Optimistic local update for snappy UI
    devplayVaultEntries = devplayVaultEntries.filter(
      (e) => String(e.email || "").trim().toLowerCase() !== emailKey
    );
    devplayVaultEntries.unshift(next);
    if (devplayVaultEntries.length > DEVPLAY_VAULT_MAX) {
      devplayVaultEntries = devplayVaultEntries.slice(0, DEVPLAY_VAULT_MAX);
    }
    paintDevPlayAccountPicker();
    try {
      await ensureApiReady();
      await api("/api/devplay/vault", {
        method: "PUT",
        body: {
          email: emailRaw,
          password,
          nickname: next.nickname,
          cookieName: next.cookieName,
          profileImageKey: next.profileImageKey,
        },
      });
      const data = await api("/api/devplay/vault");
      if (Array.isArray(data.entries)) {
        devplayVaultEntries = data.entries.slice(0, DEVPLAY_VAULT_MAX);
        paintDevPlayAccountPicker();
      }
    } catch (_) {
      /* keep optimistic list; next load will reconcile */
    }
    await persistLocalDevPlayVault(devplayVaultEntries);
  }

  async function removeDevPlayVaultEntry(email) {
    const norm = String(email || "").trim().toLowerCase();
    devplayVaultEntries = devplayVaultEntries.filter(
      (e) => String(e.email || "").trim().toLowerCase() !== norm
    );
    paintDevPlayAccountPicker();
    try {
      await ensureApiReady();
      await api("/api/devplay/vault?email=" + encodeURIComponent(email || ""), {
        method: "DELETE",
      });
    } catch (_) {
      /* list already updated locally */
    }
    await persistLocalDevPlayVault(devplayVaultEntries);
  }

  function maskDevPlayEmail(email) {
    const s = String(email || "").trim();
    const at = s.indexOf("@");
    if (at <= 1) return s;
    const name = s.slice(0, at);
    const domain = s.slice(at);
    const mask = name.length > 2 ? "***" : "*";
    return name.slice(0, 1) + mask + domain;
  }

  function resolveVaultAvatarUrl(entry) {
    return resolveDevPlayAvatarUrl({
      cookieName: entry?.cookieName,
      profileImageKey: entry?.profileImageKey,
    });
  }

  function paintDevPlayAccountPicker() {
    const picker = $("devplay-account-picker");
    const list = $("devplay-account-picker-list");
    const newWrap = $("devplay-new-account-wrap");
    if (!picker || !list) return;

    const show = !isDevPlayConnected() && devplayVaultEntries.length > 0;
    picker.classList.toggle("hidden", !show);
    picker.hidden = !show;
    if (newWrap) {
      newWrap.classList.toggle("hidden", !show);
      newWrap.hidden = !show;
    }

    list.innerHTML = "";
    if (!show) return;

    devplayVaultEntries.forEach((entry) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "devplay-vault-card";
      row.dataset.vaultEmail = entry.email;
      row.disabled = !!(devplayConnecting || farmRunning);
      row.setAttribute("role", "listitem");

      const img = document.createElement("img");
      img.className = "devplay-vault-card-avatar";
      img.src = resolveVaultAvatarUrl(entry);
      img.alt = "";
      img.width = 48;
      img.height = 48;
      img.onerror = () => {
        img.onerror = null;
        img.src = DEVPLAY_AVATAR_FALLBACK;
      };

      const body = document.createElement("div");
      body.className = "devplay-vault-card-body";
      const name = document.createElement("span");
      name.className = "devplay-vault-card-name";
      name.textContent = entry.nickname || "player";
      const mail = document.createElement("span");
      mail.className = "devplay-vault-card-email muted";
      mail.textContent = maskDevPlayEmail(entry.email);
      body.append(name, mail);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "devplay-vault-card-remove";
      removeBtn.dataset.vaultRemove = entry.email;
      removeBtn.setAttribute("aria-label", "ลบบัญชี " + entry.email);
      removeBtn.textContent = "×";

      row.append(img, body, removeBtn);
      list.appendChild(row);
    });
  }

  function isDevPlayConnected() {
    return !!devplaySession?.id && devplayConnectionState !== "expired";
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
    devplayConnectionState = "disconnected";
    ticketMax = 99;
    ticketCount = 1;
    upgradeTreasures = [];
    upgradeSelected.clear();
    upgradePickerDraft.clear();
    upgradePickerFilter = "";
    upgradeEstimate = null;
    upgradeCoin = 0;
    cookieItems = [];
    cookieSelected.clear();
    cookieEstimate = null;
    cookieCoin = 0;
    powderPlan = null;
    powderEstimate = null;
    clearDevPlayCreds();
    switchFarmTab("devplay", { silent: true });
    paintDevPlayConnectStatus("ออกจาก DevPlay แล้ว — เข้าด้วยบัญชีอื่นได้", "muted");
    paintDevPlayHub();
    paintDevPlayAccountPicker();
    paintUpgradeSelectedSummary();
    paintTicketStepper();
    updateFarmAvailability();
    setFarmStatus( "ออกจาก DevPlay แล้ว — พร้อมสลับไอดี", "muted");
    showToast("ออกจาก DevPlay แล้ว — พร้อมสลับไอดี", "muted");
  }

  function resetDevPlaySession() {
    devplayConnectionState = "expired";
    ticketMax = 99;
    ticketCount = 1;
    paintDevPlayConnectStatus("ยังไม่ได้เชื่อมบัญชีเกม", "muted");
    paintDevPlayHub();
    paintDevPlayAccountPicker();
    paintTicketStepper();
  }

  function paintFarmNavLock() {
    const connected = isDevPlayConnected();
    FARM_DOCK_TABS.forEach((t) => {
      const btn = $("farm-tab-" + t);
      if (!btn || btn.hidden) return;
      const featureLocked = isFeatureLocked(t);
      // DevPlay-not-connected lock vs admin feature lock are separate classes.
      btn.classList.toggle("is-locked", !connected && !featureLocked);
      btn.classList.toggle("is-feature-locked", featureLocked);
      btn.setAttribute(
        "aria-disabled",
        connected && !featureLocked ? "false" : "true"
      );
    });
    // Invite is opened from the Menu section only (not a farm-feature tab).
    paintFeatureLocks();
  }

  function paintDevPlayHub() {
    const connected = isDevPlayConnected();
    const onDevPlayTab = farmTab === "devplay";
    const loginCard = $("devplay-login-card");
    const hero = $("player-hero");
    const headChip = $("player-head-chip");
    const dock = $("feature-dock");
    const hub = document.querySelector("#farm-panel-devplay .devplay-hub");
    const run = $("run");
    loginCard?.classList.toggle("hidden", connected);
    hub?.classList.toggle("is-connected", connected);
    if (hero) {
      const showHero = connected && onDevPlayTab;
      hero.classList.toggle("hidden", !showHero);
      hero.hidden = !showHero;
      hero.classList.remove("player-hero--compact");
    }
    if (headChip) {
      const showChip = connected && !onDevPlayTab;
      headChip.classList.toggle("hidden", !showChip);
      headChip.hidden = !showChip;
    }
    if (dock) {
      const showDock = connected && onDevPlayTab;
      dock.classList.toggle("hidden", !showDock);
      dock.hidden = !showDock;
    }
    if (run) {
      run.classList.toggle("has-player-hero", connected && onDevPlayTab);
      run.classList.toggle("has-player-chip", connected && !onDevPlayTab);
    }
    paintFarmNavLock();
    syncOvenDevPlayLayout();
    paintFeatureDock();
    paintDevPlayAccountPicker();

    if (!devplaySession) return;

    const nick = getDevPlayAccountDisplayName();
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

    if ($("player-hero-name")) $("player-hero-name").textContent = nick;
    if ($("player-head-chip-name")) $("player-head-chip-name").textContent = nick;
    if ($("player-hero-level")) $("player-hero-level").textContent = lvl;
    if ($("player-stat-coin")) $("player-stat-coin").textContent = coin;
    if ($("player-stat-xp")) $("player-stat-xp").textContent = exp;
    if ($("player-stat-powder")) $("player-stat-powder").textContent = powder;
    if ($("player-stat-gem")) $("player-stat-gem").textContent = gem;
    if ($("player-stat-life")) $("player-stat-life").textContent = life;
    if ($("player-stat-boxes")) $("player-stat-boxes").textContent = boxes;
    if ($("player-stat-tickets")) $("player-stat-tickets").textContent = ticketsLabel;
    paintPlayerHeroAvatar();

    if (farmTab === "devplay") {
      const titleEl = $("farm-panel-title");
      const hintEl = $("farm-panel-hint");
      if (connected) {
        if (titleEl) titleEl.textContent = "ศูนย์ฟีเจอร์";
        if (hintEl) hintEl.textContent = "เลือกโหมดที่ต้องการใช้งาน";
      } else {
        const meta = FARM_TAB_META.devplay;
        if (titleEl && meta) titleEl.textContent = meta.title;
        if (hintEl && meta) hintEl.textContent = meta.hint;
      }
    }

    const refreshBtn = $("devplay-refresh-btn");
    const proxyBtn = $("devplay-proxy-btn");
    if (refreshBtn) {
      refreshBtn.hidden = !connected;
      refreshBtn.classList.toggle("hidden", !connected);
      refreshBtn.disabled = !!(devplayRefreshing || devplayConnecting || farmRunning);
    }
    if (proxyBtn) {
      proxyBtn.hidden = true;
      proxyBtn.classList.add("hidden");
    }
    paintDevPlayConnectStatus("", "ok");
  }

  function paintDevPlaySessionLine() {
    paintDevPlayHub();
  }


  function getSavedProxyDraft() {
    return "";
  }
  function saveProxyDraft(_value) {}
  function getSessionProxy() {
    return String((devplaySession && devplaySession.proxyUrl) || "").trim();
  }
  function shopProxyReady() {
    return !!(
      lastHealth?.farm_proxy_configured ||
      lastHealth?.proxy_pool?.shop_proxy_configured ||
      heartServiceStatus?.shop_proxy ||
      heartServiceStatus?.proxy_configured ||
      devplaySession?.proxyConfigured
    );
  }
  function hasUsableProxy() {
    if (shopProxyReady()) return true;
    if (lastHealth && lastHealth.farm_proxy_configured === false) return false;
    return true;
  }
  function isValidProxyUrl(_v) {
    return true;
  }
  async function saveProxyToServer(_proxyUrl, _opts = {}) {
    return { ok: true, shop_proxy: true };
  }
  async function promptProxyModal(_opts = {}) {
    return true;
  }
  function getHeartProxy() {
    return "";
  }
  function saveHeartProxy(_value) {}
  function loadHeartProxyIntoInput() {}
  function hasUsableHeartProxy() {
    return hasUsableProxy();
  }

  function clampPct(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
  }

  function paintProxyPool(data) {
    proxyPoolStatus = data || proxyPoolStatus;
    const card = $("proxy-pool-card");
    const pctEl = $("proxy-pool-pct");
    const fill = $("proxy-pool-bar-fill");
    const detail = $("proxy-pool-detail");
    if (!card) return;
    const row = proxyPoolStatus || lastHealth?.proxy_pool;
    if (!row) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const ready = !!(row.shop_proxy_configured ?? lastHealth?.farm_proxy_configured);
    // Match Webshare dashboard: show used %, not remaining.
    let used = null;
    if (row.usage_available) {
      used = clampPct(row.used_pct);
      if (used == null && row.remaining_pct != null) {
        used = clampPct(100 - Number(row.remaining_pct));
      }
    }
    const pctLabel =
      used != null ? used.toFixed(1).replace(/\.0$/, "") + "%" : null;
    if (pctEl) {
      pctEl.textContent = pctLabel || "—";
      pctEl.title = pctLabel ? "ใช้ไป " + pctLabel : "";
    }
    if (fill) {
      fill.style.width = (used ?? 0) + "%";
      fill.classList.toggle("is-warn", used != null && used >= 70 && used < 90);
      fill.classList.toggle("is-hot", used != null && used >= 90);
      fill.classList.toggle("is-unknown", used == null);
    }
    if (detail) {
      if (!ready) {
        detail.textContent = "Proxy ร้านยังไม่พร้อม";
      } else if (pctLabel) {
        detail.textContent = "ใช้ไป " + pctLabel;
      } else if (row.detail && !/GB/i.test(String(row.detail))) {
        detail.textContent = row.detail;
      } else {
        detail.textContent = "Proxy ร้านพร้อมใช้งาน";
      }
    }
    card.classList.toggle("is-ready", ready);
    card.classList.toggle("is-throttled", !!row.throttled);
  }

  async function loadProxyPool({ force = false } = {}) {
    if (!accessToken) {
      paintProxyPool(lastHealth?.proxy_pool || null);
      return;
    }
    try {
      const data = await api("/api/proxy/pool" + (force ? "?refresh=1" : ""));
      paintProxyPool(data);
    } catch (_) {
      paintProxyPool(lastHealth?.proxy_pool || proxyPoolStatus);
    }
  }

  function startProxyPoolPoll() {
    if (proxyPoolTimer) return;
    proxyPoolTimer = setInterval(() => {
      loadProxyPool().catch(() => {});
    }, 120000);
  }

  function paintHeartProxyHint() {
    const hint = $("heart-proxy-hint");
    if (!hint) return;
    const ready = hasUsableProxy();
    hint.classList.toggle("is-warn", !ready);
    hint.textContent = ready
      ? "ใช้ Proxy ร้าน (US · rotating) อัตโนมัติ — ไม่ต้องตั้งเอง"
      : "ระบบ Proxy ร้านยังไม่พร้อม — แจ้งแอดมิน";
    const btn = $("devplay-proxy-btn");
    if (btn) {
      btn.hidden = true;
      btn.classList.add("hidden");
    }
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
    if (userView) {
      if (compact) userView.classList.toggle("farm-sidebar-collapsed", !isOpen);
      else userView.classList.remove("farm-sidebar-collapsed");
    }
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

  async function loadHeartServiceStatus() {
    try {
      await ensureApiReady();
      heartServiceStatus = await api("/api/farm/heart/status");
    } catch (_) {
      heartServiceStatus = { ready: false, enabled: false, proxy_configured: false };
    }
    const mt = Number(heartServiceStatus?.max_target);
    if (Number.isFinite(mt) && mt >= 1) {
      heartMax = Math.floor(mt);
      heartTarget = clampHeartTarget(heartTarget);
    }
    paintHeartStepper();
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

  function applyDevPlayConnect(data, creds) {
    const loginCreds = creds || getDevPlayCreds();
    const ttlMs = (Number(data.expires_in) || 900) * 1000;
    const ticketsKnown =
      data.party_run_tickets != null && Number.isFinite(Number(data.party_run_tickets));
    const ticketsN = ticketsKnown ? Math.max(0, Number(data.party_run_tickets)) : null;
    const nickRaw = String(data.nickname || data.nick || "").trim();
    devplaySession = {
      id: data.devplay_session_id,
      nickname: nickRaw || "player",
      email: loginCreds.email,
      password: loginCreds.password,
      powderReady: data.powder_ready !== false,
      proxyConfigured: !!(data.proxy_configured || data.shop_proxy),
      proxyUrl: "",
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
      pictureStuffSeq: data.picture_stuff_seq,
      profileImageKey: data.profile_image_key || data.profileImageKey || null,
      cookieStuffSeq: data.cookie_stuff_seq,
      cookieName: data.cookie_name || data.cookieName || null,
      expiresAt: Date.now() + ttlMs,
    };
    devplayConnectionState = "connected";
    ticketMax = ticketsKnown ? Math.max(1, ticketsN || 1) : 99;
    ticketCount = ticketsKnown
      ? Math.min(Math.max(1, ticketsN || 1), ticketMax)
      : Math.min(5, ticketMax);
    paintDevPlaySessionLine();
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
      showToast(
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

  async function refreshDevPlayAccount() {
    if (!isDevPlayConnected() || devplayRefreshing || devplayConnecting || farmRunning) return;
    const sid = devplaySession?.id;
    if (!sid) {
      showToast("ไม่พบ session — สลับไอดีแล้วเชื่อมใหม่", "err");
      return;
    }
    const refreshBtn = $("devplay-refresh-btn");
    devplayRefreshing = true;
    setBtnLoading(refreshBtn, true);
    paintDevPlayConnectStatus("กำลังอัปเดตสถานะ…", "muted");
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const data = await api("/api/farm/devplay/refresh", {
        method: "POST",
        body: { devplay_session_id: sid },
      });
      if (!devplaySession || devplaySession.id !== sid) return;
      if (data.coin != null) devplaySession.coin = data.coin;
      if (data.exp != null) devplaySession.exp = data.exp;
      if (data.level != null) devplaySession.level = data.level;
      if (data.powder != null) devplaySession.powder = data.powder;
      if (data.gem != null) devplaySession.gem = data.gem;
      if (data.life != null) devplaySession.life = data.life;
      if (data.gift_boxes != null) devplaySession.giftBoxes = data.gift_boxes;
      if (data.key != null) devplaySession.key = data.key;
      devplaySession.expiresAt =
        Date.now() + (Number(data.expires_in) || 4 * 60 * 60) * 1000;
      devplayConnectionState = "connected";
      paintDevPlayHub();
      const creds = getDevPlayCreds();
      if (creds.email) {
        upsertDevPlayVaultEntry(creds, {
          nickname: devplaySession.nickname,
          cookieName: devplaySession.cookieName,
          profileImageKey: devplaySession.profileImageKey,
        }).catch(() => {});
      }
      if (!devplaySession.ticketsLoading) {
        devplaySession.ticketsLoading = true;
        paintDevPlayHub();
        refreshDevPlayTickets(sid);
      }
      setFarmStatus("อัปเดตสถานะไอดีแล้ว", "ok");
      showToast("อัปเดตสถานะไอดีแล้ว", "ok");
      paintDevPlayConnectStatus("", "ok");
    } catch (e) {
      const reason =
        thError(e.message) || e.userMessage || ERR_TH.refresh_failed || "รีเฟรชไม่สำเร็จ";
      paintDevPlayConnectStatus(reason, "err");
      showToast(reason, "err");
    } finally {
      devplayRefreshing = false;
      setBtnLoading(refreshBtn, false);
      updateFarmAvailability();
      paintDevPlayHub();
    }
  }

  async function connectDevPlay(opts = {}) {
    if (devplayConnecting) return false;
    if (isFarmExecutorBusy()) {
      showErrorModal(
        "มีงานฟาร์มค้างอยู่หรือกำลังรันอยู่\nเปิดแถบสถานะงาน แล้วกดยกเลิกก่อนเชื่อม DevPlay ใหม่",
        "ยังเชื่อมไม่ได้"
      );
      try {
        showFarmDock();
        openRunStatusPopup(true);
      } catch (_) {}
      return false;
    }
    const creds = {
      email: String(opts.email ?? $("dp-acct-mail")?.value ?? "").trim(),
      password: String(opts.password ?? $("dp-acct-secret")?.value ?? ""),
    };
    if (!creds.email || !creds.password) {
      showErrorModal("กรอกอีเมลและรหัสผ่าน DevPlay ให้ครบ", "ข้อมูลไม่ครบ");
      return false;
    }
    const connectBtn = $("devplay-connect-btn");
    devplayConnecting = true;
    devplayConnectionState = opts.reconnect ? "reconnecting" : "connecting";
    setBtnLoading(connectBtn, true);
    paintDevPlayConnectStatus("กำลังเชื่อมต่อ…", "muted");
    paintDevPlayAccountPicker();
    updateFarmAvailability();
    try {
      await ensureApiReady();
      const data = await api("/api/farm/devplay/connect", {
        method: "POST",
        body: {
          email: creds.email,
          password: creds.password,
        },
      });
      applyDevPlayConnect(data, creds);
      await upsertDevPlayVaultEntry(creds, {
        nickname: data.nickname,
        cookieName: data.cookie_name,
        profileImageKey: data.profile_image_key,
      });
      switchFarmTab("devplay", { silent: true });
      paintHeartProxyHint();
      loadProxyPool().catch(() => {});
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
      return true;
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
      if (!opts.silent) {
        showErrorModal(
          "เชื่อมไม่สำเร็จ เนื่องจาก\n" + reason + codeHint,
          "เชื่อม DevPlay ไม่สำเร็จ"
        );
      }
      return false;
    } finally {
      devplayConnecting = false;
      setBtnLoading(connectBtn, false);
      updateFarmAvailability();
      paintDevPlayAccountPicker();
    }
  }

  async function recoverDevPlaySession() {
    if (devplayConnecting) return false;
    const creds = {
      email: String(devplaySession?.email || $("dp-acct-mail")?.value || "").trim(),
      password: String(devplaySession?.password || $("dp-acct-secret")?.value || ""),
    };
    if (!creds.email || !creds.password) {
      devplayConnectionState = "expired";
      return false;
    }
    paintDevPlayConnectStatus("กำลังเชื่อม DevPlay ใหม่อัตโนมัติ…", "muted");
    const ok = await connectDevPlay({ ...creds, reconnect: true, silent: true });
    if (ok) {
      showToast("เชื่อม DevPlay ใหม่แล้ว — กดรันซ้ำได้ทันที", "ok");
    }
    return ok;
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
      "invite",
      "afterplay_fast",
      "unlock_l",
      "account",
      "dstool",
    ];
    let next = tabs.includes(tab) ? tab : "devplay";
    if (next !== "devplay" && next !== INVITE_TAB && isFeatureLocked(next)) {
      if (!opts.silent) showFeatureLockedModal(next);
      return;
    }
    // Invite Friend: no DevPlay / rental required
    if (next !== "devplay" && next !== INVITE_TAB && !isDevPlayConnected()) {
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
    ["invite", "afterplay_fast", "unlock_l"].forEach((t) => {
      $("menu-nav-" + t)?.classList.toggle("is-active", farmTab === t);
    });
    const meta = FARM_TAB_META[farmTab];
    if (meta) {
      const titleEl = $("farm-panel-title");
      const hintEl = $("farm-panel-hint");
      const iconEl = document.querySelector(".oven-title-icon");
      if (titleEl) titleEl.textContent = meta.title;
      if (hintEl) hintEl.textContent = meta.hint;
      if (iconEl && meta.icon) iconEl.src = "assets/" + meta.icon;
      if (farmTab === "afterplay_fast") paintAfterplayCreditHint();
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
    if (farmTab === AFTERPLAY_FAST_TAB) {
      refreshAfterplayPrices().catch(() => {});
      refreshAfterplayPreview({ fromTab: true, source: afterplayLastEdit }).catch(() => {});
    }
    if (farmTab === UNLOCK_L_TAB) {
      refreshUnlockLCatalog({ fromTab: true }).catch(() => {});
    }
    paintDevPlayHub();
    syncOvenDevPlayLayout();
  }

  function powderParams() {
    return {
      stuff_seq: Math.max(1, Number($("powder-stuff-seq")?.value) || 811),
      price: Math.max(0, Number($("powder-price")?.value) || 5000),
      powder_qty: Math.max(1, Number($("powder-qty")?.value) || POWDER_BREAK_FALLBACK),
      powder_yield_estimate: POWDER_YIELD_ESTIMATE,
      do_break: $("powder-do-break")?.checked !== false,
    };
  }

  function parsePowderNumInput(value) {
    return Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
  }

  function formatPowderInputValue(value) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return n > 0 ? String(n) : "";
  }

  function setPowderInputValue(id, value) {
    const el = $(id);
    if (!el || document.activeElement === el) return;
    el.value = formatPowderInputValue(value);
  }

  function powderYieldPerRound() {
    if ($("powder-do-break")?.checked === false) return 0;
    return POWDER_YIELD_ESTIMATE;
  }

  function formatPowderApprox(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    return v > 0 ? "≈" + formatNumTh(v) : "—";
  }

  function powderPricePerRound() {
    return Math.max(0, Number($("powder-price")?.value) || 5000);
  }

  function powderMaxRounds() {
    const fromPlan = Number(powderPlan?.max_rounds);
    if (Number.isFinite(fromPlan) && fromPlan >= 0) return fromPlan;
    const price = Math.max(1, powderPricePerRound() || 1);
    const coin = Number(powderPlan?.coin_available ?? devplaySession?.coin ?? 0);
    return Math.max(0, Math.floor(coin / price));
  }

  function powderJobMaxRounds() {
    const y = Math.max(1, powderYieldPerRound());
    return Math.max(1, Math.ceil(powderMax / y));
  }

  function powderJobMaxCoin() {
    return powderJobMaxRounds() * Math.max(1, powderPricePerRound() || 1);
  }

  function clampPowderTarget(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    return Math.min(Math.max(1, n || 1), powderMax);
  }

  function clampPowderCoinBudget(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    const maxCoin = powderJobMaxCoin();
    return Math.min(Math.max(1, n || 1), maxCoin);
  }

  function clampPowderTargetInputs() {
    const powderEl = $("powder-target-powder");
    if (powderEl) {
      const next = clampPowderTarget(parsePowderNumInput(powderEl.value) || powderMax);
      powderEl.value = formatPowderInputValue(next);
    }
    const coinEl = $("powder-target-coin");
    if (coinEl) {
      const next = clampPowderCoinBudget(
        parsePowderNumInput(coinEl.value) || powderJobMaxCoin()
      );
      coinEl.value = formatPowderInputValue(next);
    }
  }

  function clampPowderRounds(value) {
    const n = Math.floor(Number(String(value ?? "").replace(/[^\d]/g, "")) || 0);
    const max = Math.min(powderMaxRounds() || n || 1, powderJobMaxRounds());
    if (max <= 0) return Math.max(1, n || 1);
    return Math.min(Math.max(1, n || 1), max);
  }

  function powderPlanBody() {
    const p = powderParams();
    if (powderEditLock === "coin") {
      const budget = clampPowderCoinBudget(parsePowderNumInput($("powder-target-coin")?.value));
      return { ...p, coin_budget: Math.max(1, budget || 1) };
    }
    const target = clampPowderTarget(parsePowderNumInput($("powder-target-powder")?.value));
    return { ...p, target_powder: Math.max(1, target || 1) };
  }

  function computePowderPlanLocal(coin, opts) {
    const price = Math.max(0, Number(opts?.price) || powderPricePerRound());
    const doBreak = opts?.do_break !== false;
    const y = doBreak
      ? Math.max(1, Number(opts?.powder_yield_estimate) || powderYieldPerRound())
      : 0;
    const maxRoundsCoin = price > 0 ? Math.floor(Math.max(0, coin) / price) : 0;
    const maxRoundsJob = powderJobMaxRounds();
    const maxRounds = Math.min(maxRoundsCoin, maxRoundsJob);
    let chosen = 1;
    if (opts?.rounds != null) chosen = Math.max(1, Number(opts.rounds));
    else if (opts?.target_powder != null && y > 0) {
      chosen = Math.ceil(Math.max(1, Number(opts.target_powder)) / y);
    } else if (opts?.coin_budget != null && price > 0) {
      chosen = Math.max(1, Math.floor(Number(opts.coin_budget) / price));
    }
    const capped = chosen > maxRounds;
    const rounds = maxRounds > 0 ? Math.min(chosen, maxRounds) : 0;
    const coinCost = rounds * price;
    const powderGain = doBreak ? rounds * y : 0;
    return {
      ok: true,
      coin_available: Math.max(0, coin),
      price,
      powder_yield: y,
      do_break: doBreak,
      max_rounds: maxRoundsCoin,
      rounds,
      coin_cost: coinCost,
      powder_gain: powderGain,
      coin_after: Math.max(0, coin - coinCost),
      can_run: rounds >= 1,
      capped,
      job_capped: chosen > maxRoundsJob,
      max_target: powderMax,
    };
  }

  function syncPowderLinkedFields(plan) {
    if (!plan) return;
    const coinCost = Number(plan.coin_cost) || 0;
    const powderGain = Number(plan.powder_gain) || 0;
    const lock = powderEditLock;
    const setIfIdle = (id, value) => {
      const lock = powderEditLock;
      if (lock === "powder" && id === "powder-target-powder") return;
      if (lock === "coin" && id === "powder-target-coin") return;
      setPowderInputValue(id, value);
    };
    setIfIdle("powder-target-powder", powderGain);
    setIfIdle("powder-target-coin", coinCost);
    powderRounds = Number(plan.rounds) || 0;
  }

  function paintPowderPlan(plan) {
    powderPlan = plan;
    powderEstimate = plan;
    if (plan && Number.isFinite(Number(plan.max_target))) {
      powderMax = Math.max(1, Math.floor(Number(plan.max_target)));
    }
    const targetEl = $("powder-estimate-target");
    const noteEl = $("powder-estimate-note");
    const hintEl = $("powder-rounds-hint");
    const setTxt = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };

    if (!plan) {
      if (targetEl) {
        targetEl.textContent = "เชื่อม DevPlay เพื่อดูแผนฟาร์ม";
        targetEl.classList.remove("is-warn");
      }
      setTxt("powder-stat-coin-balance", "—");
      setTxt("powder-stat-powder-target", "—");
      setTxt("powder-stat-rounds", "—");
      setTxt("powder-stat-coin", "—");
      setTxt("powder-stat-powder", "—");
      setTxt("powder-stat-coin-after", "—");
      if (noteEl) noteEl.textContent = "";
      if (hintEl) hintEl.textContent = "เชื่อม DevPlay เพื่อดูแผน";
      paintPowderGoalControls();
      return;
    }

    syncPowderLinkedFields(plan);
    if (plan.coin != null && devplaySession) devplaySession.coin = plan.coin;
    if (plan.powder != null && devplaySession) devplaySession.powder = plan.powder;
    paintDevPlaySessionLine();

    const coinBal = Number(plan.coin_available ?? plan.coin ?? 0);
    const rounds = Number(plan.rounds) || 0;
    const coinCost = Number(plan.coin_cost) || 0;
    const powderGain = Number(plan.powder_gain) || 0;

    const coinAfter = Number(plan.coin_after ?? Math.max(0, coinBal - coinCost));
    const powderTargetDisplay =
      powderEditLock === "powder"
        ? clampPowderTarget(parsePowderNumInput($("powder-target-powder")?.value))
        : powderGain;
    const jobCapped = !!plan.job_capped;

    setTxt("powder-stat-coin-balance", formatNumTh(coinBal));
    setTxt("powder-stat-powder-target", formatNumTh(powderTargetDisplay));
    setTxt("powder-stat-rounds", formatNumTh(rounds) + " กล่อง");
    setTxt("powder-stat-coin", formatNumTh(coinCost));
    setTxt("powder-stat-powder", formatPowderApprox(powderGain));
    setTxt("powder-stat-coin-after", formatNumTh(coinAfter));

    if (targetEl) {
      targetEl.classList.toggle("is-warn", !!plan.capped || jobCapped);
      if (!isDevPlayConnected()) {
        targetEl.textContent = "เชื่อม DevPlay เพื่อดูแผนฟาร์ม";
      } else if (jobCapped) {
        targetEl.textContent =
          "เกินเพดานต่อรอบ (" +
          formatNumTh(powderMax) +
          " ผง) — จะรันได้สูงสุด " +
          formatNumTh(rounds) +
          " กล่อง · ได้ประมาณ " +
          formatPowderApprox(powderGain) +
          " ผง";
      } else if (plan.capped) {
        targetEl.textContent =
          "เหรียญไม่พอครบเป้า — จะรันได้สูงสุด " +
          formatNumTh(rounds) +
          " กล่อง · ได้ประมาณ " +
          formatPowderApprox(powderGain) +
          " ผง";
      } else if (powderEditLock === "coin") {
        targetEl.textContent =
          "ใช้ " +
          formatNumTh(coinCost) +
          " เหรียญ · ได้ประมาณ " +
          formatPowderApprox(powderGain) +
          " ผง · " +
          formatNumTh(rounds) +
          " กล่อง";
      } else {
        targetEl.textContent =
          "เป้า " +
          formatNumTh(powderTargetDisplay) +
          " ผง · ใช้ " +
          formatNumTh(coinCost) +
          " เหรียญ · " +
          formatNumTh(rounds) +
          " กล่อง";
      }
    }

    if (hintEl) {
      if (!isDevPlayConnected()) {
        hintEl.textContent = "เชื่อม DevPlay เพื่อดูแผน";
      } else if (powderEstimateLoading) {
        hintEl.textContent = "กำลังคำนวณ…";
      } else if (Number(plan.max_rounds) <= 0) {
        hintEl.textContent = "เหรียญไม่พอแม้ 1 กล่อง (มี " + formatNumTh(coinBal) + ")";
      } else {
        hintEl.textContent =
          "1 กล่อง = " +
          formatNumTh(plan.price ?? powderPricePerRound()) +
          " เหรียญ · ประมาณ " +
          formatNumTh(plan.powder_yield ?? powderYieldPerRound()) +
          " ผง/กล่อง (สุ่ม B/C) · สูงสุดต่อรอบ " +
          formatNumTh(powderMax) +
          " ผง";
      }
    }

    if (noteEl) {
      const parts = [];
      if (plan.do_break !== false) parts.push(POWDER_ESTIMATE_DISCLAIMER);
      if (plan.do_break === false) parts.push("โหมดซื้ออย่างเดียว — ไม่ย่อยเป็นผง");
      if (rounds >= 100) parts.push("อาจใช้เวลาหลายนาที");
      if (!plan.can_run) parts.push("เหรียญไม่พอแม้ 1 รอบ");
      noteEl.textContent = parts.join(" · ");
    }

    const nameEl = $("powder-stuff-name");
    if (nameEl) {
      const seq = Number($("powder-stuff-seq")?.value) || 811;
      nameEl.textContent = powderStuffLabel
        ? powderStuffLabel + " (" + seq + ")"
        : seq === 811
          ? "กล่องสมบัติธรรมดา (811)"
          : "ไอเทม seq " + seq;
    }

    paintPowderGoalControls();
    updateFarmAvailability();
  }

  function paintPowderGoalControls() {
    const connected = isDevPlayConnected();
    const busy = isModeActivelyRunning("powder") || !!devplayConnecting || powderEstimateLoading;
    const canEdit = connected && !busy;
    const powderStep = Math.max(1, powderYieldPerRound());
    const coinStep = Math.max(1, powderPricePerRound());
    const powderVal = parsePowderNumInput($("powder-target-powder")?.value);
    const coinVal = parsePowderNumInput($("powder-target-coin")?.value);

    [
      "powder-target-powder-minus",
      "powder-target-powder-plus",
      "powder-target-coin-minus",
      "powder-target-coin-plus",
    ].forEach((id) => {
      const btn = $(id);
      if (btn) btn.disabled = !canEdit;
    });
    if ($("powder-target-powder-minus")) {
      $("powder-target-powder-minus").disabled =
        !canEdit || powderVal <= powderStep;
    }
    if ($("powder-target-powder-plus")) {
      $("powder-target-powder-plus").disabled =
        !canEdit || powderVal >= powderMax;
    }
    if ($("powder-target-coin-minus")) {
      $("powder-target-coin-minus").disabled = !canEdit || coinVal <= coinStep;
    }
    if ($("powder-target-coin-plus")) {
      $("powder-target-coin-plus").disabled =
        !canEdit || coinVal >= powderJobMaxCoin();
    }
    if ($("powder-target-powder")) $("powder-target-powder").disabled = !canEdit;
    if ($("powder-target-coin")) $("powder-target-coin").disabled = !canEdit;
  }

  function bumpPowderTarget(delta) {
    powderEditLock = "powder";
    const step = Math.max(1, powderYieldPerRound());
    const el = $("powder-target-powder");
    if (!el) return;
    const next = clampPowderTarget(parsePowderNumInput(el.value) + delta * step);
    el.value = formatPowderInputValue(Math.max(step, next));
    refreshPowderEstimate().catch(() => {});
  }

  function bumpPowderCoinBudget(delta) {
    powderEditLock = "coin";
    const step = Math.max(1, powderPricePerRound());
    const el = $("powder-target-coin");
    if (!el) return;
    const next = clampPowderCoinBudget(parsePowderNumInput(el.value) + delta * step);
    el.value = formatPowderInputValue(Math.max(step, next));
    refreshPowderEstimate().catch(() => {});
  }

  function commitPowderTargetPowderFromInput() {
    powderEditLock = "powder";
    const el = $("powder-target-powder");
    if (!el) return;
    const v = clampPowderTarget(parsePowderNumInput(el.value) || 1);
    el.value = formatPowderInputValue(v);
    refreshPowderEstimate().catch(() => {});
  }

  function commitPowderTargetCoinFromInput() {
    powderEditLock = "coin";
    const el = $("powder-target-coin");
    if (!el) return;
    const v = clampPowderCoinBudget(parsePowderNumInput(el.value) || 1);
    el.value = formatPowderInputValue(v);
    refreshPowderEstimate().catch(() => {});
  }

  async function lookupPowderStuffSeq() {
    const seq = Math.max(1, Number($("powder-stuff-seq")?.value) || 811);
    powderStuffLabel = "";
    try {
      await ensureApiReady();
      const data = await api("/api/farm/powder/stuff/" + seq);
      if (data?.item?.name) {
        powderStuffLabel = String(data.item.name);
        const price = Number(data.item.price_coin);
        if (price > 0 && $("powder-price") && document.activeElement !== $("powder-price")) {
          $("powder-price").value = String(price);
        }
      }
    } catch (_) {
      powderStuffLabel = "";
    }
    paintPowderPlan(powderPlan);
  }

  function schedulePowderStuffLookup() {
    if (powderStuffLookupTimer) clearTimeout(powderStuffLookupTimer);
    powderStuffLookupTimer = setTimeout(() => {
      lookupPowderStuffSeq().catch(() => {});
    }, 350);
  }

  function showPowderStuffSearchModal() {
    clearModalActions();
    openModal({
      mode: "pick",
      title: "ค้นหาไอเทม (Stuff Seq)",
      bodyHtml:
        '<div class="powder-picker-modal">' +
        '<input type="search" id="powder-stuff-search" class="powder-picker-search" placeholder="พิมพ์ชื่อไอเทม…" autocomplete="off" />' +
        '<div class="powder-picker-grid" id="powder-stuff-search-grid" aria-live="polite"></div>' +
        "</div>",
      icon: "assets/magic_powder.png",
      locked: false,
    });
    const grid = $("powder-stuff-search-grid");
    const search = $("powder-stuff-search");
    let searchTimer = null;

    async function runSearch(q) {
      if (!grid) return;
      grid.innerHTML = '<p class="muted powder-picker-empty">กำลังค้นหา…</p>';
      try {
        await ensureApiReady();
        const data = await api(
          "/api/farm/powder/stuff/search?q=" + encodeURIComponent(q || "") + "&limit=40"
        );
        const items = Array.isArray(data.items) ? data.items : [];
        grid.innerHTML = "";
        if (!items.length) {
          grid.innerHTML = '<p class="muted powder-picker-empty">ไม่พบไอเทม</p>';
          return;
        }
        items.forEach((item) => {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "powder-pick-card";
          const name = document.createElement("div");
          name.className = "powder-pick-card-name";
          name.textContent = item.name || "Item " + item.seq;
          const meta = document.createElement("div");
          meta.className = "powder-pick-card-meta";
          meta.textContent =
            "seq " +
            item.seq +
            (item.price_coin ? " · " + formatNumTh(item.price_coin) + " เหรียญ" : "");
          card.append(name, meta);
          card.addEventListener("click", () => {
            const seqEl = $("powder-stuff-seq");
            if (seqEl) seqEl.value = String(item.seq);
            powderStuffLabel = item.name || "";
            if (item.price_coin > 0 && $("powder-price")) {
              $("powder-price").value = String(item.price_coin);
            }
            forceCloseModal();
            refreshPowderEstimate().catch(() => {});
          });
          grid.appendChild(card);
        });
      } catch (_) {
        grid.innerHTML = '<p class="muted powder-picker-empty">ค้นหาไม่สำเร็จ</p>';
      }
    }

    if (search) {
      search.value = "";
      search.addEventListener("input", () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runSearch(search.value || ""), 300);
      });
      requestAnimationFrame(() => {
        search.focus();
        runSearch("");
      });
    }
    modalActions.appendChild(makeBtn("ปิด", "btn-ghost", () => forceCloseModal()));
  }

  function schedulePowderRefresh() {
    if (powderRefreshTimer) clearTimeout(powderRefreshTimer);
    powderRefreshTimer = setTimeout(() => {
      refreshPowderEstimate().catch(() => {});
    }, 400);
  }

  async function refreshPowderEstimate() {
    if (farmTab !== "powder") return;
    if (!isDevPlayConnected()) {
      powderEstimateLoading = false;
      paintPowderPlan(null);
      return;
    }
    powderEstimateLoading = true;
    paintPowderGoalControls();
    const body = {
      devplay_session_id: devplaySession.id,
      ...powderPlanBody(),
    };
    try {
      await ensureApiReady();
      const data = await api("/api/farm/powder/plan", {
        method: "POST",
        body: JSON.stringify(body),
      });
      powderEstimateLoading = false;
      paintPowderPlan(data);
    } catch (_) {
      powderEstimateLoading = false;
      const coin = Number(devplaySession?.coin ?? 0);
      paintPowderPlan(computePowderPlanLocal(coin, powderPlanBody()));
    }
  }

  function powderYield() {
    return powderYieldPerRound();
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
      wrap.classList.contains("upgrade-card-img-wrap") ||
      wrap.classList.contains("upgrade-selected-chip-img");

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
      frameBg.onerror = () => {
        frameBg.remove();
      };
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
    if (selEl) selEl.textContent = formatNumTh(selected.length) + "/" + formatNumTh(UPGRADE_MAX_SELECT) + " ชิ้น";
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

  function upgradeTreasureLevel(t) {
    const level = t.enhancement ?? t.level ?? t.tag;
    return level != null ? level : "—";
  }

  function upgradeTreasureSortKey(t) {
    return [
      (t.grade || "Z").toUpperCase(),
      (t.name || "").toLowerCase(),
      Number(upgradeTreasureLevel(t)) || 0,
    ];
  }

  function sortedUpgradeTreasures(list) {
    return [...list].sort((a, b) => {
      const ka = upgradeTreasureSortKey(a);
      const kb = upgradeTreasureSortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  function paintUpgradePickCount() {
    const countEl = $("upgrade-pick-count");
    const selected = getSelectedUpgradeItems();
    if (countEl) countEl.textContent = formatNumTh(selected.length) + "/" + formatNumTh(UPGRADE_MAX_SELECT);
  }

  function paintUpgradeSelectedSummary() {
    const pickBtn = $("upgrade-pick-btn");
    const targetEl = $("upgrade-estimate-target");
    paintUpgradePickCount();

    if (upgradeListLoading) {
      if (targetEl) targetEl.textContent = "กำลังโหลดสมบัติ…";
      if (pickBtn) pickBtn.disabled = true;
      paintUpgradeEstimate();
      return;
    }
    if (!isDevPlayConnected()) {
      if (targetEl) targetEl.textContent = "เชื่อม DevPlay เพื่อเลือกสมบัติ";
      if (pickBtn) pickBtn.disabled = true;
      paintUpgradeEstimate();
      return;
    }
    if (!upgradeTreasures.length) {
      if (targetEl) targetEl.textContent = "ไม่พบสมบัติในคลัง — กดโหลดคลังใหม่";
      if (pickBtn) pickBtn.disabled = isModeActivelyRunning("upgrade") || devplayConnecting;
      paintUpgradeEstimate();
      return;
    }

    const canPick = !isModeActivelyRunning("upgrade") && !devplayConnecting;
    if (pickBtn) pickBtn.disabled = !canPick;

    const selected = getSelectedUpgradeItems();
    if (targetEl) {
      if (!selected.length) {
        targetEl.textContent = "กดเลือกสมบัติเพื่อดูประมาณการ";
      } else {
        targetEl.textContent =
          "เลือกแล้ว " +
          formatNumTh(selected.length) +
          "/" +
          formatNumTh(UPGRADE_MAX_SELECT) +
          " ชิ้น · เป้าหมาย +" +
          upgradeTargetLevel;
      }
    }
    paintUpgradeEstimate();
  }

  function paintUpgradePickerCounter() {
    const el = $("upgrade-picker-counter");
    const n = upgradePickerDraft.size;
    if (el) {
      el.textContent = formatNumTh(n) + "/" + formatNumTh(UPGRADE_MAX_SELECT);
      el.classList.toggle("is-full", n >= UPGRADE_MAX_SELECT);
    }
    const confirmBtn = $("upgrade-picker-confirm");
    if (confirmBtn) {
      confirmBtn.textContent =
        n > 0
          ? "ยืนยันตีบวก " + formatNumTh(n)
          : "ยืนยัน";
      confirmBtn.disabled = n < 1;
    }
    paintUpgradePickerTray();
  }

  function paintUpgradePickerTray() {
    const tray = $("upgrade-picker-tray");
    if (!tray) return;
    const items = upgradeTreasures.filter(
      (t) => upgradePickerDraft.has(t.uuid) && t.can_upgrade
    );
    tray.classList.toggle("is-empty", !items.length);
    tray.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "upgrade-picker-tray-empty muted";
      empty.textContent = "แตะการ์ดเพื่อเลือกสมบัติ";
      tray.appendChild(empty);
      return;
    }
    items.forEach((t) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "upgrade-picker-tray-chip grade-" + (t.grade || "C").toUpperCase();
      chip.dataset.uuid = t.uuid;
      chip.title = "เอาออก: " + (t.name || "Treasure");
      chip.setAttribute("aria-label", "เอาออก " + (t.name || "Treasure"));

      const media = document.createElement("span");
      media.className = "upgrade-picker-tray-media";
      appendUpgradePickerIcon(media, t);

      const label = document.createElement("span");
      label.className = "upgrade-picker-tray-label";
      label.textContent = "+" + upgradeTreasureLevel(t);

      const x = document.createElement("span");
      x.className = "upgrade-picker-tray-x";
      x.setAttribute("aria-hidden", "true");
      x.textContent = "×";

      chip.append(media, label, x);
      chip.addEventListener("click", (ev) => {
        ev.preventDefault();
        toggleUpgradePicker(t.uuid);
      });
      tray.appendChild(chip);
    });
  }

  function toggleUpgradePicker(uuid) {
    if (upgradePickerDraft.has(uuid)) {
      upgradePickerDraft.delete(uuid);
      const note = $("upgrade-picker-limit-note");
      if (note) note.textContent = "";
    } else {
      if (upgradePickerDraft.size >= UPGRADE_MAX_SELECT) {
        const note = $("upgrade-picker-limit-note");
        if (note) note.textContent = "เลือกได้สูงสุด " + formatNumTh(UPGRADE_MAX_SELECT) + " ชิ้นต่อรัน";
        return;
      }
      upgradePickerDraft.add(uuid);
      const note = $("upgrade-picker-limit-note");
      if (note) note.textContent = "";
    }
    // Update selection state only — avoid full re-render so scroll stays put.
    refreshUpgradePickerCardStates();
    paintUpgradePickerCounter();
  }

  function appendUpgradePickerIcon(wrap, t) {
    if (!wrap) return;
    wrap.innerHTML = "";
    const grade = (t?.grade || "C").toUpperCase();
    const frame = document.createElement("div");
    frame.className = "treasure-frame upgrade-pick-frame grade-" + grade;

    const frameBg = document.createElement("img");
    frameBg.className = "treasure-frame-bg";
    frameBg.alt = "";
    frameBg.width = 128;
    frameBg.height = 128;
    frameBg.decoding = "async";
    frameBg.referrerPolicy = "no-referrer";
    frameBg.src = gradeFrameSrc(grade);
    frameBg.onerror = () => {
      frameBg.remove();
    };

    const inner = document.createElement("div");
    inner.className = "treasure-frame-inner";
    const src = treasureImageSrc(t);
    if (src) {
      const img = document.createElement("img");
      img.className = "treasure-frame-icon";
      img.alt = "";
      img.width = 72;
      img.height = 72;
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
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
  }

  function syncUpgradePickerCardState(card, selected, atLimit) {
    if (!card) return;
    card.classList.toggle("is-selected", selected);
    card.classList.toggle("is-at-limit", !selected && atLimit);
    card.disabled = !selected && atLimit;
    card.setAttribute("aria-pressed", selected ? "true" : "false");
    const check = card.querySelector(".upgrade-pick-check");
    if (check) check.textContent = selected ? "✓" : "";
  }

  function refreshUpgradePickerCardStates() {
    const grid = $("upgrade-picker-grid");
    if (!grid) return;
    const atLimit = upgradePickerDraft.size >= UPGRADE_MAX_SELECT;
    grid.querySelectorAll(".upgrade-pick-card").forEach((card) => {
      const uuid = card.dataset.uuid;
      syncUpgradePickerCardState(card, upgradePickerDraft.has(uuid), atLimit);
    });
  }

  function paintUpgradePickerGrid() {
    const grid = $("upgrade-picker-grid");
    if (!grid) return;
    const scrollTop = grid.scrollTop;

    if (upgradeListLoading) {
      grid.innerHTML = "";
      renderSkeletonCards(grid, 6);
      return;
    }

    const q = upgradePickerFilter.trim().toLowerCase();
    const gradeFilter = (upgradePickerGradeFilter || "all").toUpperCase();
    const atLimit = upgradePickerDraft.size >= UPGRADE_MAX_SELECT;
    const list = sortedUpgradeTreasures(
      upgradeTreasures.filter((t) => {
        if (!t.can_upgrade) return false;
        if (q && !(t.name || "").toLowerCase().includes(q)) return false;
        if (gradeFilter !== "ALL") {
          if ((t.grade || "").toUpperCase() !== gradeFilter) return false;
        }
        return true;
      })
    );

    const existing = [...grid.querySelectorAll(".upgrade-pick-card")];
    const sameList =
      existing.length === list.length &&
      list.every((t, i) => existing[i]?.dataset.uuid === t.uuid);

    if (sameList && list.length) {
      list.forEach((t, i) => {
        syncUpgradePickerCardState(existing[i], upgradePickerDraft.has(t.uuid), atLimit);
      });
      paintUpgradePickerCounter();
      return;
    }

    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = '<p class="muted upgrade-picker-empty">ไม่พบสมบัติที่ตีบวกได้</p>';
      requestAnimationFrame(() => {
        grid.scrollTop = scrollTop;
      });
      return;
    }

    list.forEach((t) => {
      const selected = upgradePickerDraft.has(t.uuid);
      const grade = (t.grade || "S").toUpperCase();
      const card = document.createElement("button");
      card.type = "button";
      card.className = "upgrade-pick-card";
      card.dataset.uuid = t.uuid;
      card.setAttribute("aria-label", (t.name || "Treasure") + " " + grade + " +" + upgradeTreasureLevel(t));

      const mediaWrap = document.createElement("div");
      mediaWrap.className = "upgrade-pick-card-media";
      appendUpgradePickerIcon(mediaWrap, t);

      const check = document.createElement("span");
      check.className = "upgrade-pick-check";
      check.setAttribute("aria-hidden", "true");
      mediaWrap.appendChild(check);

      const name = document.createElement("div");
      name.className = "upgrade-pick-card-name";
      name.textContent = t.name || "Treasure";

      const meta = document.createElement("div");
      meta.className = "upgrade-pick-card-meta";
      const badge = document.createElement("span");
      badge.className = "upgrade-pick-grade grade-" + grade;
      badge.textContent = grade;
      const lvl = document.createElement("span");
      lvl.className = "upgrade-pick-level";
      lvl.textContent = "+" + upgradeTreasureLevel(t);
      meta.append(badge, lvl);

      syncUpgradePickerCardState(card, selected, atLimit);
      card.append(mediaWrap, name, meta);
      card.addEventListener("click", () => toggleUpgradePicker(t.uuid));
      grid.appendChild(card);
    });

    requestAnimationFrame(() => {
      grid.scrollTop = scrollTop;
    });
  }

  function confirmUpgradePicker() {
    upgradeSelected = new Set(upgradePickerDraft);
    forceCloseModal();
    paintUpgradeSelectedSummary();
    refreshUpgradeEstimate().catch(() => {});
    updateFarmAvailability();
  }

  function showUpgradePickerModal() {
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    upgradePickerFilter = "";
    upgradePickerGradeFilter = "all";
    upgradePickerDraft = new Set(upgradeSelected);
    clearModalActions();
    openModal({
      mode: "pick",
      title: "เลือกสมบัติตีบวก",
      bodyHtml:
        '<div class="upgrade-picker-modal">' +
        '<div class="upgrade-picker-toolbar">' +
        '<input type="search" id="upgrade-picker-search" class="upgrade-picker-search" placeholder="ค้นหาชื่อสมบัติ…" autocomplete="off" enterkeyhint="search" />' +
        '<div class="upgrade-picker-filters" id="upgrade-picker-filters" role="group" aria-label="กรองเกรด">' +
        '<button type="button" class="upgrade-picker-filter is-active" data-grade="all">ทั้งหมด</button>' +
        '<button type="button" class="upgrade-picker-filter" data-grade="S">S</button>' +
        '<button type="button" class="upgrade-picker-filter" data-grade="A">A</button>' +
        '<button type="button" class="upgrade-picker-filter" data-grade="B">B</button>' +
        '<button type="button" class="upgrade-picker-filter" data-grade="C">C</button>' +
        "</div>" +
        '<div class="upgrade-picker-meta-row">' +
        '<p class="upgrade-picker-counter" id="upgrade-picker-counter">0/10</p>' +
        '<p class="upgrade-picker-limit-note" id="upgrade-picker-limit-note"></p>' +
        "</div>" +
        "</div>" +
        '<div class="upgrade-picker-grid" id="upgrade-picker-grid" role="listbox" aria-multiselectable="true" aria-label="สมบัติที่ตีบวกได้"></div>' +
        '<div class="upgrade-picker-tray" id="upgrade-picker-tray" aria-label="สมบัติที่เลือก"></div>' +
        "</div>",
      icon: "assets/Crystal_Pearl_Earring_2B9.png",
      locked: false,
      cardClass: "modal-card--picker",
    });

    const loadAndPaint = () => {
      paintUpgradePickerGrid();
      paintUpgradePickerCounter();
    };

    if (!upgradeTreasures.length || upgradeListLoading) {
      loadUpgradeTreasures(true)
        .then(loadAndPaint)
        .catch(loadAndPaint);
    } else {
      loadAndPaint();
    }

    const search = $("upgrade-picker-search");
    if (search) {
      search.value = "";
      search.addEventListener("input", () => {
        upgradePickerFilter = search.value || "";
        paintUpgradePickerGrid();
      });
      requestAnimationFrame(() => search.focus());
    }

    $("upgrade-picker-filters")?.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-grade]");
      if (!btn) return;
      upgradePickerGradeFilter = btn.dataset.grade || "all";
      $("upgrade-picker-filters")
        ?.querySelectorAll(".upgrade-picker-filter")
        .forEach((el) => el.classList.toggle("is-active", el === btn));
      paintUpgradePickerGrid();
    });

    modalActions.classList.add("row");
    const confirmBtn = makeBtn("ยืนยัน", "btn-candy", () => confirmUpgradePicker());
    confirmBtn.id = "upgrade-picker-confirm";
    confirmBtn.disabled = upgradePickerDraft.size < 1;
    modalActions.appendChild(confirmBtn);
    modalActions.appendChild(makeBtn("ยกเลิก", "btn-ghost", () => forceCloseModal()));
    paintUpgradePickerCounter();
  }

  async function loadUpgradeTreasures(force) {
    if (!isDevPlayConnected()) {
      upgradeTreasures = [];
      upgradeSelected.clear();
      upgradePickerDraft.clear();
      paintUpgradeSelectedSummary();
      return;
    }
    if (upgradeTreasures.length && !force) {
      paintUpgradeSelectedSummary();
      return;
    }
    upgradeListLoading = true;
    paintUpgradeSelectedSummary();
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
      upgradePickerDraft.forEach((id) => {
        if (!valid.has(id)) upgradePickerDraft.delete(id);
      });
      upgradeListLoading = false;
      paintUpgradeSelectedSummary();
      if ($("upgrade-picker-grid")) {
        paintUpgradePickerGrid();
        paintUpgradePickerCounter();
      }
      await refreshUpgradeEstimate();
    } catch (e) {
      upgradeTreasures = [];
      upgradeListLoading = false;
      paintUpgradeSelectedSummary();
      const msg = thError(e.message);
      if (msg) setFarmStatus(msg, "err");
    }
  }

  async function refreshUpgradeEstimate() {
    const selected = getSelectedUpgradeItems().slice(0, UPGRADE_MAX_SELECT);
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
        icon: "assets/Crystal_Pearl_Earring_2B9.png",
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
        icon: "assets/Crystal_Pearl_Earring_2B9.png",
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

  function cookieModeLabel(mode) {
    return mode === "unlock_only" ? "ปลดล็อกอย่างเดียว" : "อัปเกรดเต็ม";
  }

  function cookieItemCost(item, mode) {
    if (!item) return 0;
    if (mode === "unlock_only") {
      return Number(item.coin_cost_unlock_only ?? item.coin_cost ?? item.total_cost ?? 0);
    }
    return Number(item.coin_cost_upgrade_full ?? item.coin_cost ?? item.total_cost ?? 0);
  }

  function cookieItemSelectable(item, mode) {
    if (!item) return false;
    if (mode === "unlock_only") {
      if (item.owned) return false;
      if (item.can_unlock != null) return !!item.can_unlock;
      return !!item.can_buy;
    }
    if (item.maxed) return false;
    if (item.can_upgrade != null) return !!item.can_upgrade;
    return !!item.can_buy;
  }

  function getSelectedCookieItems(mode) {
    const m = mode || cookieRunMode || "upgrade_full";
    return cookieItems.filter(
      (c) => cookieSelected.has(String(c.seq)) && cookieItemSelectable(c, m)
    );
  }

  function paintCookieEstimate() {
    const selected = getSelectedCookieItems(cookieRunMode);
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
      cost += cookieItemCost(c, cookieRunMode);
    });
    if (costEl) costEl.textContent = selected.length ? formatNumTh(cost) + " coin" : "—";
    if (!selected.length) {
      if (targetEl) targetEl.textContent = "เลือกคุกกี้เพื่อดูประมาณการ";
      if (noteEl) noteEl.textContent = "";
      return;
    }
    if (targetEl) {
      targetEl.textContent =
        cookieModeLabel(cookieRunMode) +
        " · " +
        formatNumTh(selected.length) +
        " ตัว · เรียงทีละตัว";
    }
    if (noteEl) {
      const expensive = selected.some((c) => cookieItemCost(c, cookieRunMode) >= 100000);
      let msg =
        cost > cookieCoin
          ? "เหรียญในไอดีไม่พอกับรายการที่เลือก"
          : cookieRunMode === "unlock_only"
            ? "โหมดปลดล็อกอย่างเดียว — ไม่เดินอัปเกรดต่อ"
            : "โหมดอัปเกรดเต็ม — ถ้ามีแล้วจะซื้อของที่เหลือแล้วอัปต่อ";
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
      const unlockable = cookieItems.filter((c) => cookieItemSelectable(c, "unlock_only")).length;
      const upgradable = cookieItems.filter((c) => cookieItemSelectable(c, "upgrade_full")).length;
      const owned = cookieItems.filter((c) => c.owned).length;
      hint.textContent =
        "ปลดได้ " +
        formatNumTh(unlockable) +
        " · อัปได้ " +
        formatNumTh(upgradable) +
        " · มีแล้ว " +
        formatNumTh(owned) +
        " · เหรียญในไอดี " +
        formatNumTh(cookieCoin);
    }
    grid.classList.add("card-stagger");
    cookieItems.forEach((c) => {
      const seq = String(c.seq);
      const canUnlock = cookieItemSelectable(c, "unlock_only");
      const canUpgrade = cookieItemSelectable(c, "upgrade_full");
      const canPick = canUnlock || canUpgrade;
      const card = document.createElement("button");
      card.type = "button";
      card.className =
        "upgrade-card cookie-card" +
        (cookieSelected.has(seq) ? " is-selected" : "") +
        (c.maxed ? " is-owned is-maxed" : "") +
        (c.owned && !c.maxed ? " is-owned" : "") +
        (!canPick ? " is-broke is-maxed" : "");
      card.disabled = !canPick || isModeActivelyRunning("cookie_unlock") || devplayConnecting;
      card.dataset.seq = seq;

      if (!canPick || c.owned) {
        const badge = document.createElement("span");
        badge.className = "cookie-card-badge";
        if (c.maxed) badge.textContent = "เต็มแล้ว";
        else if (c.owned) badge.textContent = "มีแล้ว · อัปต่อได้";
        else badge.textContent = "เหรียญไม่พอ";
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
      const unlockCost = cookieItemCost(c, "unlock_only");
      const fullCost = cookieItemCost(c, "upgrade_full");
      if (c.owned && !c.maxed) {
        meta.textContent = "อัปต่อ ≈ " + formatNumTh(fullCost) + " coin";
      } else if (unlockCost !== fullCost) {
        meta.textContent =
          "ปลด " + formatNumTh(unlockCost) + " · เต็ม " + formatNumTh(fullCost);
      } else {
        meta.textContent = formatNumTh(fullCost) + " coin";
      }

      card.append(check, imgWrap, name, meta);
      card.addEventListener("click", () => {
        if (!canPick) return;
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
      const valid = new Set(
        cookieItems
          .filter(
            (c) =>
              cookieItemSelectable(c, "unlock_only") || cookieItemSelectable(c, "upgrade_full")
          )
          .map((c) => String(c.seq))
      );
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
      if (
        cookieItemSelectable(c, "unlock_only") ||
        cookieItemSelectable(c, "upgrade_full")
      ) {
        cookieSelected.add(String(c.seq));
      }
    });
    paintCookieGrid();
    paintCookieEstimate();
    updateFarmAvailability();
  }

  function showCookieConfirmModal(items) {
    let mode = cookieRunMode || "upgrade_full";
    const names = items.map((c) => c.cookie_name || c.seq).join(", ");

    function costFor(m) {
      return items.reduce((sum, c) => sum + cookieItemCost(c, m), 0);
    }
    function runnableFor(m) {
      return items.filter((c) => cookieItemSelectable(c, m));
    }

    return new Promise((resolve) => {
      clearModalActions();
      const renderBody = () => {
        const runItems = runnableFor(mode);
        const cost = costFor(mode);
        const expensive = runItems.some((c) => cookieItemCost(c, mode) >= 100000);
        const skippedOwned =
          mode === "unlock_only" ? items.filter((c) => c.owned).length : 0;
        return (
          '<div class="cookie-mode-picker" role="radiogroup" aria-label="โหมดปลดล็อกคุกกี้">' +
          '<button type="button" class="cookie-mode-option' +
          (mode === "unlock_only" ? " is-active" : "") +
          '" data-cookie-mode="unlock_only">' +
          "<strong>ปลดล็อกอย่างเดียว</strong>" +
          "<span>หยุดหลังปลด · เหมาะ Sea Fairy / ไอดีเงินน้อย</span>" +
          "<em>≈ " +
          formatNumTh(costFor("unlock_only")) +
          " coin · " +
          formatNumTh(runnableFor("unlock_only").length) +
          " ตัว</em>" +
          "</button>" +
          '<button type="button" class="cookie-mode-option' +
          (mode === "upgrade_full" ? " is-active" : "") +
          '" data-cookie-mode="upgrade_full">' +
          "<strong>อัปเกรดเต็ม</strong>" +
          "<span>ปลดแล้วอัปต่อจนเต็ม · มีแล้วก็อัปต่อได้</span>" +
          "<em>≈ " +
          formatNumTh(costFor("upgrade_full")) +
          " coin · " +
          formatNumTh(runnableFor("upgrade_full").length) +
          " ตัว</em>" +
          "</button>" +
          "</div>" +
          '<p class="cookie-mode-summary">' +
          "รายการ: " +
          names +
          "<br/>โหมด: " +
          cookieModeLabel(mode) +
          " · ประมาณ " +
          formatNumTh(cost) +
          " coin<br/>เหรียญในไอดี: " +
          formatNumTh(cookieCoin) +
          (skippedOwned
            ? "<br/>หมายเหตุ: โหมดปลดล็อกจะข้าม " + formatNumTh(skippedOwned) + " ตัวที่มีแล้ว"
            : "") +
          (expensive ? "<br/>⚠ มีตัวราคาสูง — ตรวจยอดเหรียญให้ดี" : "") +
          "</p>"
        );
      };

      openModal({
        mode: "confirm",
        title: "เลือกโหมดก่อนรัน",
        bodyHtml: renderBody(),
        icon: "assets/pine_monk_cookie.png",
        locked: false,
      });

      const bindModeButtons = () => {
        modalBody.querySelectorAll("[data-cookie-mode]").forEach((btn) => {
          btn.addEventListener("click", () => {
            mode = btn.getAttribute("data-cookie-mode") || "upgrade_full";
            cookieRunMode = mode;
            modalBody.innerHTML = renderBody();
            bindModeButtons();
            paintCookieEstimate();
          });
        });
      };
      bindModeButtons();

      modalActions.classList.add("row");
      modalActions.appendChild(
        makeBtn("ยกเลิก", "btn-ghost", () => {
          forceCloseModal();
          resolve(null);
        })
      );
      modalActions.appendChild(
        makeBtn("ยืนยันรัน", "btn-candy", () => {
          const runItems = runnableFor(mode);
          if (!runItems.length) {
            showToast(
              mode === "unlock_only"
                ? "ไม่มีคุกกี้ที่ปลดล็อกได้ในรายการนี้"
                : "ไม่มีคุกกี้ที่อัปเกรดต่อได้ในรายการนี้",
              "err"
            );
            return;
          }
          cookieRunMode = mode;
          forceCloseModal();
          resolve({ mode, items: runItems });
        })
      );
    });
  }

  async function runCookieUnlock(preconfirmed) {
    let items = preconfirmed?.items || null;
    let mode = preconfirmed?.mode || cookieRunMode || "upgrade_full";

    if (!items) {
      const picked = cookieItems.filter((c) => cookieSelected.has(String(c.seq)));
      if (!picked.length) {
        showErrorModal("เลือกคุกกี้ก่อน", "ยังไม่ได้เลือก");
        return;
      }
      if (!requireFeatureAccess("cookie")) return;
      if (!isDevPlayConnected()) {
        showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
        return;
      }
      const choice = await showCookieConfirmModal(picked);
      if (!choice) return;
      items = choice.items || [];
      mode = choice.mode || "upgrade_full";
    }

    cookieRunMode = mode;
    if (!items.length) {
      showErrorModal(ERR_TH.cookie_selection_empty, "ยังไม่ได้เลือก");
      return;
    }
    if (!requireFeatureAccess("cookie")) return;
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }

    const cookieThumbs = items.map((c) => ({
      seq: String(c.seq),
      name: String(c.cookie_name || c.artifact_name || c.seq),
      url: String(c.image_url || "").trim(),
    }));
    const cookieExtras = {
      cookieThumbs,
      itemName: cookieThumbs[0]?.name || "",
      itemTotal: items.length,
      itemIndex: 1,
      cookieMode: mode,
    };

    setFarmStatus(
      cookieModeLabel(mode) + " " + formatNumTh(items.length) + " ตัว…",
      "muted"
    );

    if (
      queueIfBusy(
        "cookie_unlock",
        items.length,
        cookieModeLabel(mode) + " · " + formatNumTh(items.length) + " ตัว",
        () => runCookieUnlock({ items, mode }),
        cookieExtras
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
          mode,
        },
        mode: "cookie_unlock",
        target: items.length,
        extras: cookieExtras,
        handlers: {
          onSuccess: (data) => {
            refreshMe().catch(() => {});
            const result = data.result || data;
            const done = Number(result?.items_done || data.items_done || 0);
            const skipped = Number(result?.items_skipped || data.items_skipped || 0);
            const failed = Number(result?.items_failed || data.items_failed || 0);
            items.forEach((c) => cookieSelected.delete(String(c.seq)));
            const msg =
              cookieModeLabel(mode) +
              " สำเร็จ " +
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
      };
      target = rerollCount;
      label = "รีโรล · " + formatNumTh(rerollCount) + " ไอดี";
    }
    if (rerollMode === "accounts") {
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

  function questFilterCounts() {
    let all = 0;
    let claimable = 0;
    let claimed = 0;
    for (const q of questList) {
      all += 1;
      if (q.rewarded) claimed += 1;
      else if (q.claimable) claimable += 1;
    }
    return { all, claimable, claimed };
  }

  function paintQuestFilterTabs() {
    const counts = questFilterCounts();
    const map = {
      all: counts.all,
      claimable: counts.claimable,
      claimed: counts.claimed,
    };
    document.querySelectorAll("[data-quest-filter]").forEach((btn) => {
      const key = btn.getAttribute("data-quest-filter");
      const on = key === questFilter;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const countEl = $(`quest-filter-${key}-count`);
      if (countEl) countEl.textContent = "(" + (map[key] || 0) + ")";
    });
  }

  function filteredQuestList() {
    if (questFilter === "claimable") return questList.filter((q) => !!q.claimable);
    if (questFilter === "claimed") return questList.filter((q) => !!q.rewarded);
    return questList;
  }

  function paintQuestList() {
    const root = $("quest-list");
    if (!root) return;
    root.innerHTML = "";
    paintQuestFilterTabs();
    if (!questList.length) {
      root.innerHTML = '<p class="muted account-item-empty">ยังไม่มีรายการ — กดโหลดรายการเควส</p>';
      return;
    }
    const visible = filteredQuestList();
    if (!visible.length) {
      const emptyLabel =
        questFilter === "claimable"
          ? "ไม่มีเควสที่รับได้"
          : questFilter === "claimed"
            ? "ยังไม่มีเควสที่รับแล้ว"
            : "ยังไม่มีรายการ";
      root.innerHTML = '<p class="muted account-item-empty">' + emptyLabel + "</p>";
      return;
    }
    visible.forEach((q) => {
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
    return Math.min(Math.max(1, n || 1), heartMax);
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
        hint.textContent = "ระบบ Proxy ร้านยังไม่พร้อม";
      } else {
        hint.textContent =
          "ใส่ได้ 1–" + formatNumTh(heartMax) + " · ต้องการมากกว่านี้ให้ส่งหลายครั้ง";
      }
    }
    const canStep = !isModeActivelyRunning("heart") && !devplayConnecting && hasDevPlayCreds() && hasUsableHeartProxy();
    if (input) input.disabled = !canStep;
    if (minus) minus.disabled = !canStep || heartTarget <= 1;
    if (plus) plus.disabled = !canStep || heartTarget >= heartMax;
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
    const noParty = !hasFeatureAccess("partyrun");
    const noPowder = !hasFeatureAccess("powder");
    const noGift = !hasFeatureAccess("giftdraw");
    const noHeart = !hasFeatureAccess("heart");
    const noUpgrade = !hasFeatureAccess("upgrade");
    const noCookie = !hasFeatureAccess("cookie");
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
      if (noHeart) {
        const rem = featureRemainingLabel("heart");
        heartIdleSub = rem ? "เหลือ " + rem : "ยังไม่ได้ปลดล็อก · ซื้อแพ็ก";
      } else if (heartOffline) heartIdleSub = "ฟาร์มหัวใจยังไม่เปิด";
      else if (!credsReady) heartIdleSub = "กรอกบัญชีเกมก่อน";
      else if (needProxy) heartIdleSub = "Proxy ร้านยังไม่พร้อม";
      else {
        const rem = featureRemainingLabel("heart");
        if (rem) heartIdleSub += " · เหลือ " + rem;
      }
      applyRunBtn(
        heartBtn,
        heartSub,
        heartRunning,
        noHeart || !credsReady || connecting || heartOffline || needProxy,
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
      if (noGift) {
        const rem = featureRemainingLabel("giftdraw");
        gdSub = rem ? "เหลือ " + rem : "ยังไม่ได้ปลดล็อก · ซื้อแพ็ก";
      } else if (!connected) gdSub = "เชื่อม DevPlay ก่อน";
      else if (giftdrawEstimateLoading) gdSub = "กำลังนับกล่อง…";
      else if (noBoxes) gdSub = "ไม่มีกล่องขวัญ";
      else {
        const rem = featureRemainingLabel("giftdraw");
        if (rem) gdSub += " · เหลือ " + rem;
      }
      applyRunBtn(
        giftdrawBtn,
        giftdrawSub,
        giftdrawRunning,
        noGift || !connected || connecting || giftdrawEstimateLoading || noBoxes,
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
        !selected.length;
      let upSub =
        formatNumTh(needTokens) +
        "/" +
        formatNumTh(UPGRADE_MAX_SELECT) +
        " ชิ้น · " +
        (upgradeRunMode === "fast" ? "Fast" : "เรียงทีละชิ้น");
      if (noUpgrade) {
        const rem = featureRemainingLabel("upgrade");
        upSub = rem ? "เหลือ " + rem : "ยังไม่ได้ปลดล็อก · ซื้อแพ็ก";
      } else if (!connected) upSub = "เชื่อม DevPlay ก่อน";
      else if (!selected.length) upSub = "เลือกสมบัติก่อน";
      else if (upgradeEstimateLoading) upSub = "กำลังคำนวณ…";
      else {
        const rem = featureRemainingLabel("upgrade");
        if (rem) upSub += " · เหลือ " + rem;
      }
      applyRunBtn(
        upgradeBtn,
        upgradeSub,
        upgradeRunning,
        noUpgrade || connecting || blocked,
        upSub
      );
      if (btn) btn.disabled = true;
      if (powderBtn) powderBtn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
      // Allow picking next upgrade job while another mode runs.
      const canPick = connected && !connecting && !upgradeRunning;
      paintUpgradeTargetLevel();
      if (upgradeReload) upgradeReload.disabled = !canPick;
      const pickBtn = $("upgrade-pick-btn");
      if (pickBtn) pickBtn.disabled = !canPick;
      document.querySelectorAll("#upgrade-mode-row .upgrade-mode-btn").forEach((b) => {
        b.disabled = !canPick;
      });
      paintUpgradeEstimate();
    } else if (isCookie) {
      const selected = cookieItems.filter(
        (c) =>
          cookieSelected.has(String(c.seq)) &&
          (cookieItemSelectable(c, "unlock_only") || cookieItemSelectable(c, "upgrade_full"))
      );
      const needTokens = selected.length;
      const blocked =
        !connected ||
        cookieListLoading ||
        !selected.length;
      let ckSub = formatNumTh(needTokens) + " ตัว · เลือกโหมดตอนยืนยัน";
      if (noCookie) {
        const rem = featureRemainingLabel("cookie");
        ckSub = rem ? "เหลือ " + rem : "ยังไม่ได้ปลดล็อก · ซื้อแพ็ก";
      } else if (!connected) ckSub = "เชื่อม DevPlay ก่อน";
      else if (cookieListLoading) ckSub = "กำลังโหลด…";
      else if (!selected.length) ckSub = "เลือกคุกกี้ก่อน";
      else {
        const rem = featureRemainingLabel("cookie");
        if (rem) ckSub += " · เหลือ " + rem;
      }
      applyRunBtn(
        cookieBtn,
        cookieSub,
        cookieRunning,
        noCookie || connecting || blocked,
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
        !connected || powderEstimateLoading || !powderPlan?.can_run;
      const rounds = Number(powderPlan?.rounds) || powderRounds || 0;
      const gain = Number(powderPlan?.powder_gain) || rounds * powderYieldPerRound();
      let pwSub =
        rounds > 0
          ? formatNumTh(rounds) + " กล่อง · ≈+" + formatNumTh(gain) + " ผง"
          : "ตั้งเป้าผงหรืองบเหรียญ";
      if (noPowder) {
        const rem = featureRemainingLabel("powder");
        pwSub = rem ? "เหลือ " + rem : "ยังไม่ได้ปลดล็อก · ซื้อแพ็ก";
      } else if (!connected) pwSub = "เชื่อม DevPlay ก่อน";
      else if (powderEstimateLoading) pwSub = "กำลังคำนวณ…";
      else if (!powderPlan?.can_run) pwSub = "เหรียญไม่พอ";
      else if (powderPlan?.capped) {
        pwSub = "จำกัดเหรียญ · " + formatNumTh(rounds) + " กล่อง";
      } else {
        const rem = featureRemainingLabel("powder");
        if (rem) pwSub += " · เหลือ " + rem;
      }
      applyRunBtn(
        powderBtn,
        powderSub,
        powderRunning,
        noPowder || !connected || connecting || powderBlocked,
        pwSub
      );
      if (btn) btn.disabled = true;
      if (giftdrawBtn) giftdrawBtn.disabled = true;
      if (heartBtn) heartBtn.disabled = true;
      if (upgradeBtn) upgradeBtn.disabled = true;
      if (cookieBtn) cookieBtn.disabled = true;
      paintPowderGoalControls();
    } else if (farmTab === "partyrun") {
      let prSub = "รัน " + ticketCount + " ตั๋ว";
      if (noParty) {
        const rem = featureRemainingLabel("partyrun");
        prSub = rem ? "เหลือ " + rem : "ยังไม่ได้ปลดล็อก · ซื้อแพ็ก";
      } else if (!connected) prSub = "เชื่อม DevPlay ก่อน";
      else if (noTickets) prSub = "ไม่มีตั๋ว Party Run";
      else {
        const rem = featureRemainingLabel("partyrun");
        if (rem) prSub += " · เหลือ " + rem;
      }
      applyRunBtn(
        btn,
        sub,
        partyRunning,
        noParty || !connected || connecting || noTickets,
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

    // Admin feature locks override — disable CTAs and show maintenance label.
    const applyFeatureLockBtn = (el, subEl, locked) => {
      if (!el || !locked) return;
      el.disabled = true;
      if (subEl) subEl.textContent = "ปิดปรับปรุง";
    };
    applyFeatureLockBtn(btn, sub, isFeatureLocked("partyrun"));
    applyFeatureLockBtn(powderBtn, powderSub, isFeatureLocked("powder"));
    applyFeatureLockBtn(giftdrawBtn, giftdrawSub, isFeatureLocked("giftdraw"));
    applyFeatureLockBtn(heartBtn, heartSub, isFeatureLocked("heart"));
    applyFeatureLockBtn(upgradeBtn, upgradeSub, isFeatureLocked("upgrade"));
    applyFeatureLockBtn(cookieBtn, cookieSub, isFeatureLocked("cookie"));
    applyFeatureLockBtn(rerollBtn, rerollSub, isFeatureLocked("reroll"));
    applyFeatureLockBtn(questClaimBtn, questClaimSub, isFeatureLocked("quest"));
    applyFeatureLockBtn(dsCallBtn, dsCallSub, isFeatureLocked("dstool"));
    if (isFeatureLocked("upgrade")) {
      if (upgradeReload) upgradeReload.disabled = true;
    }
    if (isFeatureLocked("cookie")) {
      if (cookieReload) cookieReload.disabled = true;
      if (cookieSelectAll) cookieSelectAll.disabled = true;
    }
    if (isFeatureLocked("quest") && questReload) questReload.disabled = true;
    if (isFeatureLocked("account") && accountReload) accountReload.disabled = true;

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

  function rentalRemainingParts() {
    if (!profile || isRentalPermanent(profile)) return null;
    const exp = profile.rental_expires_at ? Date.parse(profile.rental_expires_at) : NaN;
    if (!Number.isFinite(exp) || exp <= Date.now()) return { totalMs: 0, days: 0, hours: 0, minutes: 0 };
    const totalMs = exp - Date.now();
    const totalMin = Math.max(0, Math.ceil(totalMs / 60000));
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const minutes = totalMin % 60;
    return { totalMs, days, hours, minutes };
  }

  function formatRentalRemaining(parts) {
    if (!parts) return "—";
    if (parts.totalMs <= 0) return "หมดอายุ";
    const bits = [];
    if (parts.days) bits.push(formatNumTh(parts.days) + " วัน");
    if (parts.hours) bits.push(formatNumTh(parts.hours) + " ชม.");
    if (parts.minutes && !parts.days) bits.push(formatNumTh(parts.minutes) + " นาที");
    if (!bits.length) bits.push("น้อยกว่า 1 นาที");
    return bits.join(" ");
  }

  function rentalDaysRemaining() {
    const parts = rentalRemainingParts();
    if (!parts) return null;
    if (parts.totalMs <= 0) return 0;
    // Keep numeric helper for any callers that still expect day ceil.
    return Math.max(1, Math.ceil(parts.totalMs / 86400000));
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
    const parts = rentalRemainingParts();
    if (hasFarmAccess()) {
      label.textContent = "ใช้งานได้";
      const bits = [];
      if (parts) bits.push("สูงสุดเหลือ " + formatRentalRemaining(parts));
      bits.push("หมด " + rentalStatusLabel());
      const activeFeats = CONSUMER_FEATURES.filter((k) => hasFeatureAccess(k)).map(
        (k) => FEATURE_LABEL_TH[k] || k
      );
      if (activeFeats.length && activeFeats.length < CONSUMER_FEATURES.length) {
        bits.push("ปลด " + activeFeats.length + "/" + CONSUMER_FEATURES.length + " ฟังก์ชัน");
      }
      if (detail) detail.textContent = bits.join(" · ");
      root?.classList.add("is-active");
      root?.classList.remove("is-expired");
    } else {
      label.textContent = "หมดอายุแล้ว";
      if (detail) detail.textContent = "เลือกแพ็กเต็มหรือแพ็กเสริม 50฿ ด้านล่าง";
      root?.classList.remove("is-active");
      root?.classList.add("is-expired");
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

  function resolveFarmJobMode(row) {
    const raw = row?.kind || row?.job_kind || "";
    if (raw) return jobKindToMode(raw);
    const res = parseFarmJobResult(row?.result);
    return jobKindToMode(res.mode || res.job_kind || "");
  }

  function heartProgressFromResult(res, fallbackTarget) {
    const got = Number(res?.hearts ?? res?.collected ?? 0) || 0;
    const tgt =
      Number(res?.target ?? res?.target_hearts ?? fallbackTarget ?? 0) || 0;
    return { got, tgt, incomplete: tgt > 0 && got < tgt };
  }

  function farmHistoryRowSummary(row) {
    const res = parseFarmJobResult(row.result);
    const mode = resolveFarmJobMode(row) || res.mode || "";
    const st = String(row.status || "").toLowerCase();
    const failedLike = st === "failed" || st === "cancelled" || st === "error";
    if (mode === "powder") {
      const rounds = Number(res.rounds ?? res.bought ?? 0) || 0;
      const tgt = Number(res.target ?? res.requested ?? 0) || 0;
      const base =
        "ผง +" +
        escapeHtml(formatNumTh(res.powder_gained || res.total_powder || 0)) +
        " · " +
        escapeHtml(formatNumTh(rounds)) +
        (tgt ? "/" + escapeHtml(formatNumTh(tgt)) : "") +
        " รอบ";
      if (failedLike || res.partial || (tgt > 0 && rounds < tgt)) {
        return (failedLike || (tgt > 0 && rounds < tgt) ? "ไม่ครบ · " : "") + base;
      }
      return base;
    }
    if (mode === "giftdraw") {
      const ok = Number(res.draws_ok || 0) || 0;
      const req = Number(res.requested || res.target || 0) || 0;
      const line =
        "กล่องขวัญ " +
        escapeHtml(formatNumTh(ok)) +
        (req ? "/" + escapeHtml(formatNumTh(req)) : "") +
        " กล่อง";
      if (failedLike || res.partial || (req > 0 && ok < req)) {
        return (failedLike || ok < req ? "ไม่ครบ · " : "") + line;
      }
      return line;
    }
    if (mode === "heart") {
      const { got, tgt, incomplete } = heartProgressFromResult(
        res,
        row.ticket_count
      );
      const progress =
        "หัวใจ " +
        escapeHtml(formatNumTh(got)) +
        (tgt ? "/" + escapeHtml(formatNumTh(tgt)) : "");
      if (failedLike || res.partial || incomplete) {
        return (failedLike || incomplete ? "ล้มเหลว · " : "") + progress;
      }
      return (
        "หัวใจ +" +
        escapeHtml(formatNumTh(got)) +
        (tgt ? " / ขอ " + escapeHtml(formatNumTh(tgt)) : "")
      );
    }
    if (mode === "upgrade") {
      const done = Number(res.items_done ?? res.items ?? res.count ?? 0) || 0;
      const total = Number(res.items_total ?? 0) || 0;
      const line =
        "ตีบวกสมบัติ · " +
        escapeHtml(formatNumTh(done)) +
        (total ? "/" + escapeHtml(formatNumTh(total)) : "") +
        " ชิ้น";
      if (failedLike || res.partial || (total > 0 && done < total)) {
        return (failedLike || done < total ? "ไม่ครบ · " : "") + line;
      }
      return line;
    }
    if (mode === "cookie" || mode === "cookie_unlock") {
      const done = res.items_done ?? res.items ?? res.count ?? 0;
      const total = res.items_total ?? 0;
      const base =
        "ปลดล็อกคุกกี้ · " +
        escapeHtml(formatNumTh(done)) +
        (total ? "/" + escapeHtml(formatNumTh(total)) : "") +
        " ตัว";
      if (res.partial) return base + " (บางส่วน)";
      return base;
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
    // Only treat as Party Run when kind/mode says so — never infer from ticket_count
    // alone (heart jobs also store target in ticket_count).
    if (mode === "partyrun") {
      return (
        "Party Run · " +
        escapeHtml(formatNumTh(row.ticket_count || res.tickets || 0)) +
        " ตั๋ว · S " +
        escapeHtml(formatNumTh(row.score)) +
        " · C " +
        escapeHtml(formatNumTh(row.coin))
      );
    }
    if (mode === "afterplay_fast") {
      const farmMode = String(res.farm_mode || row.params?.farm_mode || "");
      if (farmMode === "episode_box") {
        const done = Number(res.runs_done ?? 0) || 0;
        const total = Number(res.runs ?? res.planned_runs ?? row.ticket_count ?? 0) || 0;
        const boxes = Number(res.boxes ?? 0) || 0;
        const parts = ["ฟาร์มเงิน/XP · กล่องด่าน", escapeHtml(formatNumTh(done)) + "/" + escapeHtml(formatNumTh(total)) + " รอบ"];
        if (boxes) parts.push("กล่อง " + escapeHtml(formatNumTh(boxes)));
        return parts.join(" · ");
      }
      const runs = Number(res.runs ?? res.rounds ?? row.ticket_count ?? 0) || 0;
      const xp = Number(res.xp_gain ?? res.exp_gain ?? row.exp ?? 0) || 0;
      const coin = Number(res.coin_gain ?? row.coin ?? 0) || 0;
      const parts = ["ฟาร์มเงิน/XP"];
      if (runs) parts.push(escapeHtml(formatNumTh(runs)) + " รอบ");
      if (coin) parts.push("C +" + escapeHtml(formatNumTh(coin)));
      if (xp) parts.push("XP +" + escapeHtml(formatNumTh(xp)));
      return parts.join(" · ");
    }
    if (mode === "unlock_l") {
      const done = Number(res.unlocked ?? res.items_done ?? res.count ?? 0) || 0;
      const eps = Array.isArray(res.target_eps)
        ? res.target_eps.length
        : Number(res.items_total ?? res.selected ?? 0) || 0;
      return (
        "ปลดล็อค L · " +
        escapeHtml(formatNumTh(done)) +
        (eps ? "/" + escapeHtml(formatNumTh(eps)) : "") +
        " ตัว"
      );
    }
    if (mode === "invite" || mode === "invite_friend") {
      const ok = Number(res.success ?? res.invited ?? res.count ?? 0) || 0;
      const tgt = Number(res.target ?? res.requested ?? 29) || 29;
      return (
        "เชิญเพื่อน · " +
        escapeHtml(formatNumTh(ok)) +
        "/" +
        escapeHtml(formatNumTh(tgt)) +
        " คน"
      );
    }
    const title = jobTitleForMode(mode) || JOB_KIND_TH[mode] || mode || "ฟาร์ม";
    return escapeHtml(title);
  }

  function farmHistoryModeIcon(mode) {
    const meta = FARM_TAB_META[mode === "cookie_unlock" ? "cookie" : mode === "quest_claim" ? "quest" : mode];
    if (meta?.icon) return "assets/" + meta.icon;
    if (mode === "invite" || mode === "invite_friend") return "assets/icon_giftpoint.png";
    return "assets/notice_b20.png";
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
              : st === "cancelled"
                ? "ยกเลิก"
                : st === "running"
                  ? "กำลังรัน"
                  : st === "queued"
                    ? "รอคิว"
                    : st;
        const stClass =
          st === "succeeded"
            ? "hist-ok"
            : st === "failed" || st === "cancelled"
              ? "hist-warn"
              : "";
        const mode = resolveFarmJobMode(row) || parseFarmJobResult(row.result).mode || "";
        const summary = farmHistoryRowSummary(row);
        const icon = farmHistoryModeIcon(mode);
        return (
          "<li>" +
          '<span class="hist-summary">' +
          summary +
          "</span>" +
          '<span class="hist-status ' +
          stClass +
          '">' +
          escapeHtml(stLabel) +
          "</span>" +
          '<img class="hist-icon" src="' +
          escapeHtml(icon) +
          '" alt="" width="36" height="36" />' +
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
    const fullDays = list
      .filter((p) => (p.kind || "full") === "full")
      .map((p) => packageDays(p))
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (fullDays.join(",") === "1,7,30") return true;
    // Old catalog wrongly priced 1-day as 50฿ — feature pack must not use days:1.
    const oneDay = list.find(
      (p) => (p.kind || "full") === "full" && packageDays(p) === 1
    );
    if (oneDay && Number(oneDay.price_baht) === 50) return true;
    // Require full 1/3/7 present; feature pack optional in stale check.
    return !(
      fullDays.includes(1) &&
      fullDays.includes(3) &&
      fullDays.includes(7)
    );
  }

  function fallbackTopupPackages() {
    return [
      {
        id: "full_1d",
        kind: "full",
        hours: 24,
        days: 1,
        package_days: 1,
        price_baht: 200,
        per_day_baht: 200,
        pick_feature: false,
        label_th: "1 วัน",
      },
      {
        id: "full_3d",
        kind: "full",
        hours: 72,
        days: 3,
        package_days: 3,
        price_baht: 500,
        per_day_baht: 167,
        save_baht: 100,
        promo: true,
        pick_feature: false,
        label_th: "3 วัน",
      },
      {
        id: "full_7d",
        kind: "full",
        hours: 168,
        days: 7,
        package_days: 7,
        price_baht: 990,
        per_day_baht: 141,
        save_baht: 410,
        promo: true,
        pick_feature: false,
        label_th: "7 วัน",
      },
      {
        id: "feat_12h",
        kind: "feature",
        hours: 12,
        days: null,
        package_days: null,
        price_baht: 50,
        pick_feature: true,
        label_th: "12 ชม. · 1 ฟังก์ชัน",
      },
    ];
  }

  function enrichTopupPackage(pkg) {
    const kind = pkg.kind || (pkg.pick_feature ? "feature" : "full");
    const days =
      kind === "feature" ? null : packageDays(pkg) || null;
    const price = Number(pkg.price_baht) || 0;
    const hours = Number(pkg.hours) || (days ? days * 24 : 0);
    const baseline = 200;
    const save =
      kind === "feature"
        ? 0
        : pkg.save_baht != null
          ? Number(pkg.save_baht)
          : Math.max(0, baseline * (days || 0) - price);
    const perDay =
      kind === "feature"
        ? null
        : pkg.per_day_baht != null
          ? Number(pkg.per_day_baht)
          : days
            ? Math.round(price / days)
            : 0;
    const id =
      pkg.id ||
      (kind === "feature"
        ? "feat_12h"
        : days === 3
          ? "full_3d"
          : days === 7
            ? "full_7d"
            : "full_1d");
    return {
      ...pkg,
      id,
      kind,
      hours,
      days,
      package_days: days,
      tokens: days,
      price_baht: price,
      per_day_baht: perDay,
      save_baht: save,
      promo: !!(save > 0 || pkg.promo),
      pick_feature: !!(pkg.pick_feature || kind === "feature"),
      label_th: pkg.label_th || (kind === "feature" ? "12 ชม. · 1 ฟังก์ชัน" : days + " วัน"),
    };
  }

  function packageDays(pkg) {
    if (!pkg) return 0;
    if (pkg.kind === "feature" || pkg.pick_feature) return 0;
    const d = pkg.days ?? pkg.package_days ?? pkg.tokens;
    if (d == null || d === "") return 0;
    return Number(d) || 0;
  }

  function getSelectedTopupPackage() {
    const list = topupPackages.length ? topupPackages : fallbackTopupPackages();
    return (
      list.find((p) => p.id === selectedTopupPackageId) ||
      list.find((p) => packageDays(p) === selectedTopupTokens) ||
      list[0] ||
      null
    );
  }

  function paintTopupSelected() {
    const el = $("topup-selected-text");
    const stepAmt = $("topup-step-amount");
    if (!el) return;
    const pkg = getSelectedTopupPackage();
    if (!pkg) {
      el.textContent = "—";
      if (stepAmt) stepAmt.textContent = "—";
      return;
    }
    const coins = formatNumTh(pkg.price_baht);
    let text = coins + " coin · ";
    if (pkg.kind === "feature" || pkg.pick_feature) {
      text += (pkg.hours || 12) + " ชม. · เลือก 1 ฟังก์ชัน";
    } else {
      text += packageDays(pkg) + " วัน · ทุกฟังก์ชัน";
      if (pkg.save_baht > 0) {
        text += " · คุ้ม " + formatNumTh(pkg.save_baht) + " coin";
      }
    }
    el.textContent = text;
    if (stepAmt) stepAmt.textContent = coins + " coin";
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
    const pkg = getSelectedTopupPackage();
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
      setStatus($("topup-status"), "คัดลอก " + text + " coin แล้ว", "ok");
      showToast("คัดลอก " + text + " coin แล้ว", "ok");
    } catch (_) {
      setStatus($("topup-status"), "คัดลอกไม่สำเร็จ — จำ " + text + " coin", "err");
      showToast("คัดลอกไม่สำเร็จ — จำ " + text + " coin", "err");
    }
  }

  function selectTopupPackage(pkg) {
    if (!pkg) return;
    selectedTopupPackageId = pkg.id;
    selectedTopupTokens = packageDays(pkg) || selectedTopupTokens;
    renderTopupPackages();
  }

  function renderTopupPackageCard(pkg, root) {
    if (!root || !pkg) return;
    const isFeature = pkg.kind === "feature" || pkg.pick_feature;
    const days = packageDays(pkg);
    const selected = pkg.id === selectedTopupPackageId;
    const featured = !isFeature && days === 7;
    const save = Number(pkg.save_baht) || 0;
    const coins = formatNumTh(pkg.price_baht);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "pass-card" +
      (selected ? " is-selected" : "") +
      (featured ? " is-featured" : "") +
      (isFeature ? " is-feature-pack" : "");
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    btn.dataset.packageId = pkg.id;
    btn.title = coins + " coin";
    let html = "";
    if (featured) {
      html += '<span class="pass-card-badge">คุ้ม</span>';
    } else if (isFeature) {
      html += '<span class="pass-card-badge pass-card-badge-feature">เสริม</span>';
    }
    html +=
      '<span class="pass-card-days">' +
      escapeHtml(coins) +
      "</span>" +
      '<span class="pass-card-unit">coin</span>';
    if (isFeature) {
      html +=
        '<span class="pass-card-price">12 ชม. · 1 ฟังก์ชัน</span>' +
        '<span class="pass-card-perday">เลือกฟังก์ชันหลังเติม</span>';
    } else {
      html +=
        '<span class="pass-card-price">' +
        escapeHtml(String(days)) +
        (days === 7 ? " วัน · สัปดาห์" : " วัน · ทุกฟังก์ชัน") +
        "</span>";
      if (save > 0) {
        html +=
          '<span class="pass-card-save">คุ้ม +' +
          escapeHtml(formatNumTh(save)) +
          " coin</span>";
      }
    }
    btn.innerHTML = html;
    btn.addEventListener("click", () => selectTopupPackage(pkg));
    root.appendChild(btn);
  }

  function renderTopupPackages() {
    const fullRoot = $("topup-packages");
    const featRoot = $("topup-packages-feature");
    const list = (topupPackages.length ? topupPackages : fallbackTopupPackages()).map(
      enrichTopupPackage
    );
    if (fullRoot) {
      fullRoot.innerHTML = "";
      list.filter((p) => p.kind !== "feature").forEach((pkg) => {
        renderTopupPackageCard(pkg, fullRoot);
      });
    }
    if (featRoot) {
      featRoot.innerHTML = "";
      list.filter((p) => p.kind === "feature").forEach((pkg) => {
        renderTopupPackageCard(pkg, featRoot);
      });
    }
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
      if (Array.isArray(data.feature_choices) && data.feature_choices.length) {
        topupFeatureChoices = data.feature_choices;
      } else {
        topupFeatureChoices = CONSUMER_FEATURES.map((id) => ({
          id,
          label_th: FEATURE_LABEL_TH[id] || id,
        }));
      }
      if (isStaleTopupPackages(topupPackages)) {
        topupPackages = fallbackTopupPackages();
      }
    } catch (_) {
      topupPackages = fallbackTopupPackages();
      topupFeatureChoices = CONSUMER_FEATURES.map((id) => ({
        id,
        label_th: FEATURE_LABEL_TH[id] || id,
      }));
    }
    if (!topupPackages.some((p) => p.id === selectedTopupPackageId)) {
      const one = topupPackages.find((p) => packageDays(p) === 1);
      selectedTopupPackageId = one?.id || topupPackages[0]?.id || "full_1d";
      selectedTopupTokens = packageDays(one || topupPackages[0]) || 1;
    } else {
      const cur = topupPackages.find((p) => p.id === selectedTopupPackageId);
      selectedTopupTokens = packageDays(cur) || selectedTopupTokens;
    }
    renderTopupPackages();
  }

  function showTopupSuccessModal(data) {
    const isFeature = data.package_kind === "feature" || data.needs_feature_pick;
    const rows = [];
    if (isFeature) {
      const feat = data.feature || data.feature_key;
      rows.push([
        "แพ็ก",
        "50 coin · " + (data.hours || 12) + " ชม. · " + escapeHtml(
          FEATURE_LABEL_TH[feat] || feat || "1 ฟังก์ชัน"
        ),
      ]);
    } else {
      const days = data.days_credited ?? data.package_days ?? data.package_tokens ?? "—";
      rows.push(["แพ็ก", escapeHtml(days) + " วัน · ทุกฟังก์ชัน"]);
    }
    rows.push(["ยอดที่รับ", escapeHtml(formatNumTh(data.amount_baht)) + " coin"]);
    rows.push(["เช่าถึง", escapeHtml(formatRentalExpiry(data.rental_expires_at))]);
    const html =
      '<table class="result-table"><tbody>' +
      rows
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join("") +
      "</tbody></table>";
    clearModalActions();
    openModal({
      mode: "result",
      title: isFeature ? "ปลดล็อกฟังก์ชันสำเร็จ" : "ต่ออายุเช่าสำเร็จ",
      bodyHtml: html,
      icon: "assets/reward_icon_partyrun_ticket.png",
      locked: false,
    });
    modalActions.appendChild(
      makeBtn("ตกลง", "btn-candy", () => forceCloseModal())
    );
  }

  function showFeaturePickModal(payload) {
    const redemptionId = payload?.redemption_id || payload?.id;
    if (!redemptionId) return;
    const hours = Number(payload.hours || payload.hours_credited || 12);
    const labels = payload.feature_labels || {};
    const choices =
      (Array.isArray(payload.features) && payload.features.length
        ? payload.features.map((id) => ({
            id,
            label_th: labels[id] || FEATURE_LABEL_TH[id] || id,
          }))
        : null) ||
      (topupFeatureChoices.length
        ? topupFeatureChoices
        : CONSUMER_FEATURES.map((id) => ({
            id,
            label_th: FEATURE_LABEL_TH[id] || id,
          })));

    const buttonsHtml = choices
      .map((c) => {
        const rem = featureRemainingLabel(c.id);
        return (
          '<button type="button" class="feature-pick-btn" data-feature="' +
          escapeHtml(c.id) +
          '">' +
          '<span class="feature-pick-name">' +
          escapeHtml(c.label_th || c.id) +
          "</span>" +
          (rem
            ? '<span class="feature-pick-rem">เหลือ ' + escapeHtml(rem) + "</span>"
            : '<span class="feature-pick-rem">ยังไม่มีสิทธิ์</span>') +
          "</button>"
        );
      })
      .join("");

    clearModalActions();
    openModal({
      mode: "feature-pick",
      title: "เลือกฟังก์ชัน (+" + hours + " ชม.)",
      bodyHtml:
        '<p class="feature-pick-lead">รับซอง 50 coin แล้ว — เลือก <strong>1 ฟังก์ชัน</strong> เพื่อบวกเวลา ' +
        hours +
        " ชม. (ปิดหน้าต่างไม่ได้จนกว่าจะเลือก)</p>" +
        '<div class="feature-pick-grid">' +
        buttonsHtml +
        "</div>",
      icon: "assets/reward_icon_partyrun_ticket.png",
      locked: true,
    });

    const grid = document.querySelector(".feature-pick-grid");
    grid?.querySelectorAll("[data-feature]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (featurePickBusy) return;
        const feature = btn.getAttribute("data-feature");
        featurePickBusy = true;
        btn.disabled = true;
        try {
          await ensureApiReady();
          const data = await api("/api/topup/feature-pick", {
            method: "POST",
            body: { redemption_id: redemptionId, feature },
          });
          applyProfileRental(data);
          if (profile) profile.pending_feature_pick = null;
          try {
            await refreshMe();
          } catch (_) {}
          forceCloseModal();
          showTopupSuccessModal({
            ...data,
            package_kind: "feature",
            amount_baht: payload.amount_baht,
            hours,
          });
          showToast(
            "ปลดล็อก " +
              (FEATURE_LABEL_TH[feature] || feature) +
              " +" +
              hours +
              " ชม.",
            "ok"
          );
        } catch (e) {
          const msg =
            e.userMessage ||
            thError(e.code || e.message) ||
            "เลือกฟังก์ชันไม่สำเร็จ";
          showToast(msg, "err");
          btn.disabled = false;
        } finally {
          featurePickBusy = false;
        }
      });
    });
  }

  function ensurePendingFeaturePick() {
    const pending = profile?.pending_feature_pick;
    if (!pending?.redemption_id) return;
    if (modalMode === "feature-pick") return;
    showFeaturePickModal(pending);
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
      if (detail.code === "refresh_rate_limited" || detail.message === "refresh_rate_limited") {
        return "refresh_rate_limited";
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

  function isTransientNetworkError(error) {
    const message = String(error?.message || "");
    return error?.name === "AbortError" || /abort|timeout|network|failed to fetch/i.test(message);
  }

  async function api(path, options = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    if (sessionToken) headers["X-Session-Token"] = sessionToken;
    if (options.body?.client_job_key) {
      headers["X-Idempotency-Key"] = String(options.body.client_job_key).slice(0, 128);
    }
    const timeoutMs = Number(
      options.timeoutMs != null
        ? options.timeoutMs
        : /\/api\/auth\/login|\/api\/auth\/register|\/api\/auth\/signup/i.test(path)
          ? 20000
          : 35000
    );
    const ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(() => {
          try {
            ctrl.abort();
          } catch (_) {}
        }, Math.max(3000, timeoutMs))
      : null;
    let res;
    try {
      res = await fetch(API + path, {
        ...options,
        headers,
        signal: ctrl?.signal || options.signal,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (netErr) {
      const aborted =
        netErr?.name === "AbortError" || /abort/i.test(String(netErr?.message || ""));
      const method = String(options.method || "GET").toUpperCase();
      if (
        method === "GET" &&
        !options._transientRetry &&
        isTransientNetworkError(netErr)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        return api(path, {
          ...options,
          _transientRetry: true,
          timeoutMs: Math.max(timeoutMs, 45000),
        });
      }
      const err = new Error(aborted ? "timeout" : "network_error");
      err.cause = netErr;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
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
      if (
        res.status === 401 &&
        /session_replaced|invalid_token|missing_bearer_token/i.test(String(detail))
      ) {
        if (/session_replaced/i.test(String(detail))) {
          await handleSessionReplaced();
        } else if (/invalid_token|missing_bearer_token/i.test(String(detail))) {
          // Stale website JWT — don't pretend DevPlay password is wrong.
          try {
            await sb.auth.signOut();
          } catch (_) {}
          accessToken = null;
          clearSessionToken();
          showLogin();
          showErrorModal(
            ERR_TH.invalid_token || "เซสชันเว็บหมดอายุ — เข้าสู่ระบบใหม่",
            "เซสชันหมดอายุ"
          );
        }
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
    if (
      devplaySession?.id &&
      /^\/api\/farm\//.test(path) &&
      !/\/devplay\/connect$/.test(path)
    ) {
      devplaySession.expiresAt =
        Date.now() + (Number(data?.expires_in) || 4 * 60 * 60) * 1000;
      if (devplayConnectionState !== "reconnecting") {
        devplayConnectionState = "connected";
      }
    }
    return data;
  }

  function showApp() {
    loginView.classList.add("hidden");
    userView.classList.remove("hidden");
    $("logout-btn-menu")?.classList.remove("hidden");
    $("change-password-btn-menu")?.classList.remove("hidden");
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
    pingApiHealth(1).catch(() => {});
  }

  function clearFarmClientState(_opts = {}) {
    // Detach UI only — server jobs keep running (logout policy 1B).
    stopWatchJobPoll();
    stopQueuePoll();
    stopProgressPoll();
    stopDockElapsedTimer();
    clearQueuedRun();
    clearPendingFarmJobs();
    clearActiveWatcher(activeWatchJobId);
    activeWatcher = null;
    persistWatchJobId(null);
    persistFarmIntent(null);
    farmRunning = false;
    activeWatchJobId = null;
    liveJob = null;
    lastFinishedJobId = null;
    dockPhase = null;
    dockOk = null;
    dockJobStartedAt = null;
    dockJobFinishedAt = null;
    statusContext = null;
    pipelineState = null;
    lastGate = null;
    queuedJobKind = null;
    queueResumeAttempts = 0;
    farmDockFlash = { text: "", kind: "muted" };
    farmActivityData = null;
    hideFarmDock();
    updateFarmLiveBadges();
    updateFarmAvailability();
  }

  function updateFarmLiveBadges() {
    const mode =
      (liveJob && !liveJob.finished && liveJob.mode) ||
      (dockPhase === "running" || dockPhase === "queued"
        ? statusContext?.mode || queuedJobKind || null
        : null);
    const liveHeart =
      !!accessToken &&
      (mode === "heart" ||
        (lastGate?.me?.kind === "heart" &&
          (lastGate?.me?.status === "waiting" || lastGate?.me?.status === "active")));
    const livePowder =
      !!accessToken &&
      (mode === "powder" ||
        (lastGate?.me?.kind === "powder" &&
          (lastGate?.me?.status === "waiting" || lastGate?.me?.status === "active")));
    $("farm-tab-heart")?.classList.toggle("is-live-running", liveHeart);
    $("farm-tab-powder")?.classList.toggle("is-live-running", livePowder);
    $("menu-nav-heart")?.classList.toggle("is-live-running", liveHeart);
    $("menu-nav-powder")?.classList.toggle("is-live-running", livePowder);
  }

  function showLogin() {
    stopBalancePoll();
    stopQueuePoll();
    stopActivityPoll();
    stopWatchJobPoll();
    stopAdminJobsPoll();
    stopDockElapsedTimer();
    clearFarmClientState({ keepServerJob: true });
    forceCloseModal();
    forceCloseRunStatusPopup();
    farmActivityData = null;
    farmDockFlash = { text: "", kind: "muted" };
    closeTopbarMenu();
    loginView.classList.remove("hidden");
    userView.classList.add("hidden");
    $("logout-btn-menu")?.classList.add("hidden");
    $("change-password-btn-menu")?.classList.add("hidden");
    $("topbar-actions-compact")?.classList.add("hidden");
    $("topbar-menu-user")?.classList.add("hidden");
    closeChangePasswordModal();
  }

  function paintProfile() {
    const menuWho = $("menu-who-user");
    const menuRental = $("menu-rental-label");
    const menuMono = $("menu-user-mono");
    const whoName = profile?.username || profile?.display_name || "—";
    if (menuWho) menuWho.textContent = whoName;
    if (menuMono) {
      const ch = String(whoName || "").trim().charAt(0);
      menuMono.textContent = ch ? ch.toUpperCase() : "—";
    }
    const rental = sidebarRentalMeta();
    if (menuRental) {
      menuRental.textContent = rental.text;
      menuRental.className = "account-card-rental" + (rental.kind ? " " + rental.kind : "");
    }
    paintPassStatus();
    paintFeatureLocks();
    updateFarmAvailability();
  }

  async function refreshMe() {
    const data = await api("/api/me");
    applyEarlyAccess(
      data?.early_access_features || data?.profile?.early_access_features
    );
    if (Array.isArray(data?.farm_feature_order)) applyFarmFeatureOrder(data.farm_feature_order);
    profile = data.profile;
    await loadDevPlayVault();
    paintProfile();
    paintDevPlayAccountPicker();
    showApp();
    ensurePendingFeaturePick();
    loadProxyPool().catch(() => {});
    startProxyPoolPoll();
    refreshInviteStatus().catch(() => {});
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
      heroIcon: "assets/Heart.png",
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
      heroIcon: "assets/magic_powder.png",
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
      heroIcon: "assets/Crystal_Pearl_Earring_2B9.png",
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
      heroIcon: "assets/pine_monk_cookie.png",
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

  const LOG_PANEL_MAX = 280;

  function truncateLogLine(text, maxLen) {
    const s = String(text || "").trim();
    if (!s) return "";
    const limit = maxLen || LOG_PANEL_MAX;
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
        // Real backend: "session N done: +H  total X/Y" and ctx.progress(total,target,"collect").
        let m = s.match(/session\s+\d+\s+done:\s*\+(\d+)\s+total\s+(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[2]);
          out.total = Number(m[3]);
          out.phase = "collect";
          out.stepIdx = 3;
        }
        m = s.match(/\btotal\s+(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "collect";
          out.stepIdx = Math.max(out.stepIdx, 3);
        }
        m = s.match(/TOTAL\s+(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "collect";
          out.stepIdx = 3;
        }
        if (/prefetch|guests already|no guests available/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 1);
        if (/session\s+\d+:\s*target=/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 2);
        if (/SendLife|AcceptLife|sending life/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 2);
        if (/login main account/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 0);
      } else if (mode === "powder") {
        // Real backend: "[i/count] BUY <name> code=X" then "  BREAK OK powder+P".
        let m = s.match(/\[(\d+)\/(\d+)\]\s+BUY\b/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[2]);
          out.phase = "buy";
          out.stepIdx = 1;
        }
        m = s.match(/\[(\d+)\]\s+\+\d+\s+powder\s+gained=(\d+)\/(\d+)/i);
        if (m) {
          out.current = Number(m[1]);
          out.total = Number(m[3]);
          out.phase = "extract";
          out.stepIdx = 2;
        }
        if (/BREAK\s+OK|powder\+/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 2);
        if (/powder:\s*login|loading/i.test(s)) out.stepIdx = Math.max(out.stepIdx, 0);
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
          const name = m[3].trim();
          out.current = Math.max(0, Number(m[1]) - 1);
          out.total = Number(m[2]);
          out.phase = name.toLowerCase() === "prepare" ? "start" : "items";
          out.stepIdx = name.toLowerCase() === "prepare" ? 0 : 1;
          if (statusContext && name.toLowerCase() !== "prepare") {
            statusContext.itemIndex = Number(m[1]);
            statusContext.itemTotal = Number(m[2]);
            statusContext.itemName = name;
            statusContext.itemsCompleted = Math.max(0, Number(m[1]) - 1);
          }
        }
        m = s.match(/cookie-unlock:\s*start\s+(.+?)(?:\s+\(|$)/i);
        if (m && statusContext) {
          statusContext.itemName = m[1].trim();
          out.phase = "items";
          out.stepIdx = Math.max(out.stepIdx, 1);
        }
        if (/cookie-unlock:\s*done\s+/i.test(s)) {
          out.stepIdx = Math.max(out.stepIdx, 1);
          const doneCount = lines.filter((l) => /cookie-unlock:\s*done\s+/i.test(String(l))).length;
          if (doneCount > 0) {
            out.current = doneCount;
            out.phase = "items";
            if (statusContext) statusContext.itemsCompleted = doneCount;
          }
          m = s.match(/cookie-unlock:\s*done\s+(.+)/i);
          if (m && statusContext) statusContext.itemName = m[1].trim();
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
    if (mode === "cookie_unlock" && /cookie-unlock/i.test(s)) {
      const text = truncateLogLine(translated || s, 160);
      if (/failed|skip.+coin/i.test(s)) return { text, kind: "err" };
      if (/skip/i.test(s)) return { text, kind: "warn" };
      if (/done|OK/i.test(s)) return { text, kind: "ok" };
      return { text, kind: "ok" };
    }
    if (translated && translated !== s) return truncateLogLine(translated, 160);
    if (mode === "partyrun" && /\[round\s+(\d+)\/(\d+)\]/i.test(s)) {
      const m = s.match(/\[round\s+(\d+)\/(\d+)\]/i);
      const tail = s.replace(/\[round\s+\d+\/\d+\]\s*/i, "");
      let detail = truncateLogLine(tail, 200);
      const coinM = tail.match(/coin[=:]?\s*([+\-]?\d+)/i);
      const expM = tail.match(/exp[=:]?\s*([+\-]?\d+)/i);
      if (coinM || expM) {
        detail =
          (coinM ? "เหรียญ " + coinM[1] : "") +
          (coinM && expM ? " · " : "") +
          (expM ? "EXP " + expM[1] : "");
      }
      return "รอบ " + m[1] + "/" + m[2] + (detail ? " — " + detail : "");
    }
    if (mode === "giftdraw" && /giftdraw\s+\[(\d+)\/(\d+)\]/i.test(s)) {
      const m = s.match(/giftdraw\s+\[(\d+)\/(\d+)\]:\s*(.+)/i);
      if (m) return "กล่อง " + m[1] + "/" + m[2] + " — " + truncateLogLine(m[3], 220);
    }
    if (mode === "giftdraw" && /gift|box|reward|item/i.test(s)) {
      return truncateLogLine(translated || s, LOG_PANEL_MAX);
    }
    if (mode === "heart") {
      if (/TOTAL\s+(\d+)\/(\d+)/i.test(s)) {
        const m = s.match(/TOTAL\s+(\d+)\/(\d+)/i);
        return "รวมได้หัวใจ " + formatNumTh(m[1]) + "/" + formatNumTh(m[2]);
      }
      if (/heart[s]?\s*\+(\d+)/i.test(s)) {
        const m = s.match(/heart[s]?\s*\+(\d+)/i);
        return "ได้หัวใจ +" + formatNumTh(m[1]);
      }
      if (/SESSION\s+\d+\s+done/i.test(s)) return truncateLogLine(s, LOG_PANEL_MAX);
    }
    if (mode === "powder") {
      if (/\[(\d+)\]\s+\+(\d+)\s+powder\s+gained=(\d+)\/(\d+)/i.test(s)) {
        const m = s.match(/\[(\d+)\]\s+\+(\d+)\s+powder\s+gained=(\d+)\/(\d+)/i);
        if (m) {
          return (
            "รอบ " +
            m[1] +
            " +" +
            formatNumTh(m[2]) +
            " ผง (รวม " +
            formatNumTh(m[3]) +
            "/" +
            formatNumTh(m[4]) +
            ")"
          );
        }
      }
      if (/BUY\s+OK/i.test(s)) return { text: truncateLogLine(translated || s, LOG_PANEL_MAX), kind: "ok" };
      if (/BREAK\s+OK|powder\+/i.test(s)) {
        return { text: truncateLogLine(translated || s, LOG_PANEL_MAX), kind: "ok" };
      }
      if (/BUY\s+ERR|BREAK\s+ERR/i.test(s)) {
        return { text: truncateLogLine(translated || s, LOG_PANEL_MAX), kind: "err" };
      }
    }
    if (mode === "reroll") {
      const rm = s.match(/reroll(?:\s+guest)?\s*\[(\d+)\/(\d+)\]/i);
      if (rm) {
        return (
          "บัญชี " +
          rm[1] +
          "/" +
          rm[2] +
          " — " +
          truncateLogLine(s.replace(/reroll(?:\s+guest)?\s*\[\d+\/\d+\]\s*/i, ""), 200)
        );
      }
      if (/reroll:/i.test(s)) return truncateLogLine(translated || s, LOG_PANEL_MAX);
    }
    if (mode === "quest_claim") {
      const qm = s.match(/quest:\s*claimed\s+(\d+)\/(\d+)/i);
      if (qm) return "รับเควส " + qm[1] + "/" + qm[2];
      if (/quest:/i.test(s)) return truncateLogLine(translated || s, LOG_PANEL_MAX);
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
    if (s.length > LOG_PANEL_MAX + 40 || /^\{/.test(s)) return "";
    return truncateLogLine(s, LOG_PANEL_MAX);
  }

  function formatNumTh(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? "");
    return String(Math.trunc(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatCredit(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? "");
    const rounded = Math.round(num * 100) / 100;
    const [intPart, frac] = rounded.toFixed(2).split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (frac === "00") return grouped;
    if (frac.endsWith("0")) return grouped + "." + frac.slice(0, 1);
    return grouped + "." + frac;
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
    if (phase === "queued") {
      return queueRankChipText(lastGate, "queued") || "รอคิว";
    }
    if (phase === "running") return "กำลังดำเนินการ";
    if (phase === "done") return "สำเร็จ";
    if (phase === "error") return "ล้มเหลว";
    if (phase === "idle") return "ว่าง";
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
    if (mode === "afterplay_fast") return "รอบ";
    if (mode === "unlock_l") return "ตัว";
    return "รอบ";
  }

  function jobTitleForMode(mode) {
    if (mode === "giftdraw") return "เปิดกล่องขวัญ";
    if (mode === "partyrun") return "Party Run";
    if (mode === "heart") return "ฟาร์มหัวใจ";
    if (mode === "powder") return "ฟาร์มผง";
    if (mode === "upgrade") return "ตีบวกสมบัติ";
    if (mode === "cookie_unlock") return "ปลดล็อกคุกกี้";
    if (mode === "reroll") return "รีโรล";
    if (mode === "quest_claim") return "รับรางวัลเควส";
    if (mode === "afterplay_fast") return "ฟาร์มเงิน/XP";
    if (mode === "unlock_l") return "ปลดล็อค L";
    if (mode === "invite" || mode === "invite_friend") return "เชิญเพื่อน";
    return "ฟาร์ม";
  }

  function formatDockElapsed(sec) {
    const n = Math.max(0, Math.floor(Number(sec) || 0));
    if (n < 60) return n + " วิ";
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + " นาที " + s + " วิ";
  }

  function dockJobStartedMs() {
    if (!dockJobStartedAt) return null;
    const ms =
      typeof dockJobStartedAt === "number"
        ? dockJobStartedAt
        : Date.parse(dockJobStartedAt);
    return Number.isFinite(ms) ? ms : null;
  }

  function freezeDockJobElapsedIfTerminal(phase) {
    if ((phase === "done" || phase === "error") && dockJobStartedMs() && !dockJobFinishedAt) {
      dockJobFinishedAt = Date.now();
      stopDockElapsedTimer();
    }
  }

  function computeDockElapsedSec(phase) {
    const startedMs = dockJobStartedMs();
    if (!startedMs) return 0;
    if (
      phase !== "running" &&
      phase !== "done" &&
      phase !== "error" &&
      phase !== "queued"
    ) {
      return 0;
    }
    freezeDockJobElapsedIfTerminal(phase);
    const terminal = phase === "done" || phase === "error";
    const endMs = terminal && dockJobFinishedAt ? dockJobFinishedAt : Date.now();
    return Math.max(0, Math.floor((endMs - startedMs) / 1000));
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
      if (document.hidden) return;
      if (dockPhase !== "running" && dockPhase !== "queued") {
        stopDockElapsedTimer();
        return;
      }
      // Patch elapsed text only — avoid full dock rebuild every second.
      const el = document.querySelector(
        "#farm-dock-list .farm-dock-tx[data-live='1'] .farm-dock-tx-time"
      );
      if (dockJobStartedAt) {
        const startedMs = dockJobStartedMs();
        const startedFmt = formatDockStartedAt(dockJobStartedAt) || "";
        if (startedMs) {
          const sec = computeDockElapsedSec(dockPhase || "running");
          const line = startedFmt
            ? startedFmt + " · " + formatDockElapsed(sec)
            : formatDockElapsed(sec);
          if (el) el.textContent = line;
          // Keep the centered popup's live timer ticking too.
          if (liveStatusOpen) {
            const popTime = $("live-status-time");
            const popPhase = $("live-status-phase");
            if (popTime) popTime.textContent = "ใช้เวลา " + formatDockElapsed(sec);
            if (popPhase && dockPhase === "running") {
              const cur = String(popPhase.textContent || "").replace(/\s*[·•]\s*\d+.*$/, "").trim();
              if (!cur || /กำลังดำเนินการ/.test(cur)) {
                popPhase.textContent = "กำลังดำเนินการ";
              }
            }
          }
          if (el || liveStatusOpen) return;
        }
      }
      scheduleRenderFarmDock({ reason: "elapsed" });
    }, 1000);
  }

  function dockModeIcon(mode) {
    const cfg = modeConfig(mode);
    const hero = cfg.heroIcon || "assets/cookie_run.gif";
    return hero.replace(/^assets\//, "") || "cookie_run.gif";
  }

  function resolveMediaSrc(urlOrFile) {
    const raw = String(urlOrFile || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
      return raw;
    }
    if (raw.startsWith("assets/")) return raw;
    return "assets/" + raw.replace(/^assets\//, "");
  }

  function currentCookieThumb(mode) {
    if (mode !== "cookie_unlock") return null;
    const thumbs = Array.isArray(statusContext?.cookieThumbs)
      ? statusContext.cookieThumbs
      : [];
    if (!thumbs.length) return null;
    const want = String(statusContext?.itemName || "").trim().toLowerCase();
    if (want) {
      const hit = thumbs.find(
        (t) => String(t.name || "").trim().toLowerCase() === want
      );
      if (hit) return hit;
    }
    const idx = Math.max(0, (Number(statusContext?.itemIndex) || 1) - 1);
    return thumbs[Math.min(idx, thumbs.length - 1)] || thumbs[0];
  }

  function buildDockSnapshot(opts = {}) {
    // Prefer the explicitly-tracked live job, then the executing pipeline mode.
    // Never invent Party Run when nothing is actually running.
    const phase = opts.phase || dockPhase || "idle";
    const activeMode =
      opts.mode ||
      (liveJob && !liveJob.finished && liveJob.mode) ||
      (phase !== "idle" && pipelineState?.mode) ||
      (phase !== "idle" && liveJob && liveJob.mode) ||
      (phase !== "idle" && statusContext?.mode) ||
      (pendingFarmJobs[0] && pendingFarmJobs[0].mode) ||
      null;
    const idleEmpty = phase === "idle" && !activeMode;
    const mode = activeMode || (idleEmpty ? null : "partyrun");

    if (idleEmpty) {
      const nick = devplaySession?.nickname
        ? " · ไอดี " + devplaySession.nickname
        : "";
      return {
        phase: "idle",
        mode: null,
        ok: null,
        panelSub: "เลือกฟีเจอร์แล้วกดรันเมื่อพร้อม",
        progress: { current: 0, total: 0, pct: 0 },
        queue: Array.isArray(lastGate?.queue_items) ? lastGate.queue_items : [],
        jobTitle: "ไม่มีงาน",
        jobDetail: "ไม่มีงานที่กำลังรัน" + nick,
        timeLine: "",
        statusBadge: "ว่าง",
        statusLineText: "ไม่มีงาน",
        fractionText: "—",
        unit: "",
        progressLabel: "",
        elapsedSec: 0,
        steps: [],
        stepKinds: {},
        logLines: [],
        iconUrl: resolveMediaSrc("notice_b20.png"),
        cookieThumbs: [],
        currentCookieName: "",
        showLive: false,
        idleEmpty: true,
      };
    }

    const cfg = modeConfig(mode);
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
    const elapsedSec = computeDockElapsedSec(phase);
    const startedAtFormatted = formatDockStartedAt(dockJobStartedAt);
    const progressLabel =
      phase === "idle"
        ? ""
        : cfg.progressText(cur, tot);
    const jobTitle = jobTitleForMode(mode);
    const queue = Array.isArray(lastGate?.queue_items) ? lastGate.queue_items : [];

    const phaseKey = String(pipelineState?.progressPhase || "").toLowerCase();
    const phaseLabelTh = dockPhaseLabelTh(phaseKey, mode);
    const runningPhaseChip = phaseLabelTh
      ? /^กำลัง/.test(phaseLabelTh)
        ? phaseLabelTh
        : "กำลัง" + phaseLabelTh
      : "";
    const statusBadge =
      phase === "running" && runningPhaseChip
        ? runningPhaseChip
        : dockPhaseLabel(phase === "idle" ? "idle" : phase);

    let jobDetail = progressLabel || jobTitle;
    if (phase === "running" && phaseLabelTh) {
      jobDetail = phaseLabelTh + (tot > 0 ? " · " + progressLabel : "");
    } else if (
      phase === "running" &&
      mode === "cookie_unlock" &&
      statusContext?.itemName
    ) {
      jobDetail =
        "กำลังปลดล็อก " +
        statusContext.itemName +
        (tot > 0 ? " · " + progressLabel : "");
    } else if (phase === "idle") {
      jobDetail = "พร้อมเริ่ม · " + jobTitle;
    } else if (phase === "done" && ok !== false) {
      jobDetail = "สำเร็จ · " + jobTitle;
    } else if (phase === "queued") {
      jobDetail = queueDetailText(lastGate, jobTitle);
    }
    if (devplaySession?.nickname && phase !== "error") {
      jobDetail = (jobDetail || jobTitle) + " · " + devplaySession.nickname;
    }
    if (phase === "error" && opts.errorMsg) jobDetail = opts.errorMsg;

    const cookieThumb = currentCookieThumb(mode);
    const iconUrl = cookieThumb?.url
      ? resolveMediaSrc(cookieThumb.url)
      : resolveMediaSrc(dockModeIcon(mode));

    let statusLineText = statusBadge;
    if (phase === "running") {
      statusLineText = runningPhaseChip || phaseLabelTh || "กำลังดำเนินการ";
    } else if (phase === "done" && ok !== false) {
      statusLineText = "สำเร็จแล้ว";
    } else if (phase === "error") {
      statusLineText = "ล้มเหลว";
    } else if (phase === "queued") {
      statusLineText = queueRankChipText(lastGate, "queued") || "รอคิว";
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
    if (phase === "running") {
      panelSub = phaseLabelTh
        ? phaseLabelTh + (tot > 0 ? " · " + formatNumTh(cur) + "/" + formatNumTh(tot) + " " + unit : "")
        : cfg.runningSub || "กำลังฟาร์ม…";
    } else if (phase === "queued") {
      panelSub = queueDetailText(lastGate, jobTitle) || "รอคิว — ถึงคิวแล้วจะเริ่มอัตโนมัติ";
    } else if (phase === "done") panelSub = ok !== false ? "สำเร็จแล้ว" : "ไม่สำเร็จ";
    else if (phase === "error") panelSub = opts.errorMsg || "การฟาร์มล้มเหลว";
    else if (farmDockFlash.text) panelSub = farmDockFlash.text;

    const steps = Array.isArray(pipelineState?.steps) ? pipelineState.steps : modeConfig(mode).steps || [];
    const stepKinds = pipelineState?.kinds || {};
    const logLines = Array.isArray(pipelineState?.logLines) ? pipelineState.logLines.slice(-120) : [];
    const cookieThumbs = Array.isArray(statusContext?.cookieThumbs)
      ? statusContext.cookieThumbs
      : [];

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
      steps,
      stepKinds,
      logLines,
      iconUrl,
      cookieThumbs,
      currentCookieName: statusContext?.itemName || cookieThumb?.name || "",
      showLive:
        phase === "running" ||
        phase === "done" ||
        phase === "error" ||
        phase === "queued",
      idleEmpty: false,
    };
  }

  function dockPhaseLabelTh(phaseKey, mode) {
    const key = String(phaseKey || "").toLowerCase();
    if (!key) return "";
    if ((key === "items" || key === "unlock") && mode === "cookie_unlock") {
      const name = String(statusContext?.itemName || "").trim();
      return name ? "กำลังปลดล็อก " + name : "กำลังปลดล็อกคุกกี้";
    }
    const map = {
      login: "เข้าสู่ระบบเกม",
      start: "เริ่มงาน",
      clear: "เคลียร์รางวัลค้าง",
      match: "จับคู่",
      round: "วิ่งฟาร์ม",
      run: "วิ่งฟาร์ม",
      claim: "รับรางวัล",
      collect: "รับหัวใจ",
      send: "ส่งหัวใจ",
      guests: "สร้างเพื่อน guest",
      prefetch: "เตรียม guest",
      buy: "ซื้อสมบัติ",
      extract: "ย่อยเป็นผง",
      items: "กำลังดำเนินการ",
      unlock: "ปลดล็อกคุกกี้",
      draw: "สุ่มของ",
      open: "เปิดกล่อง",
      done: "สรุปผล",
    };
    if (map[key]) return map[key];
    const steps = modeConfig(mode).steps || [];
    const hit = steps.find((s) => s.id === key);
    return hit ? hit.label : "";
  }

  function historyRowToCard(row) {
    const mode = resolveFarmJobMode(row) || "partyrun";
    const st = String(row.status || "").toLowerCase();
    const res = parseFarmJobResult(row.result);
    const heart = heartProgressFromResult(res, row.ticket_count);
    const heartIncomplete = mode === "heart" && heart.incomplete;
    const powderRounds = Number(res.rounds ?? res.bought ?? 0) || 0;
    const powderTgt = Number(res.target ?? res.requested ?? 0) || 0;
    const powderIncomplete =
      mode === "powder" && powderTgt > 0 && powderRounds < powderTgt;
    const giftOk = Number(res.draws_ok || 0) || 0;
    const giftTgt = Number(res.requested || res.target || 0) || 0;
    const giftIncomplete = mode === "giftdraw" && giftTgt > 0 && giftOk < giftTgt;
    const incompleteProgress = heartIncomplete || powderIncomplete || giftIncomplete;

    let phase = "idle";
    if (st === "succeeded" && !incompleteProgress) phase = "done";
    else if (
      st === "failed" ||
      st === "error" ||
      st === "cancelled" ||
      incompleteProgress
    ) {
      phase = "error";
    } else if (st === "running" || st === "queued") {
      phase = "running";
    }

    let badge = "—";
    if (phase === "done") {
      badge = "สำเร็จ";
    } else if (st === "cancelled") {
      badge = "ยกเลิก";
    } else if (phase === "error") {
      if (heartIncomplete) {
        badge = "ล้มเหลว " + formatNumTh(heart.got) + "/" + formatNumTh(heart.tgt);
      } else if (powderIncomplete) {
        badge = "ไม่ครบ " + formatNumTh(powderRounds) + "/" + formatNumTh(powderTgt);
      } else if (giftIncomplete) {
        badge = "ไม่ครบ " + formatNumTh(giftOk) + "/" + formatNumTh(giftTgt);
      } else {
        badge = "ล้มเหลว";
      }
    } else if (phase === "running") {
      badge = st === "queued" ? "รอคิว" : "กำลังดำเนินการ";
    }

    let detail = "";
    try {
      detail = farmHistoryRowSummary(row);
      const tmp = document.createElement("div");
      tmp.innerHTML = detail;
      detail = tmp.textContent || detail;
    } catch (_) {
      detail = JOB_KIND_TH[mode] || mode;
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
    const canCancelLive =
      (snap.phase === "running" || snap.phase === "queued") &&
      !!(liveJob?.id || activeWatchJobId);
    return {
      mode: snap.mode,
      phase: snap.phase,
      title: snap.jobTitle,
      badge: snap.statusBadge,
      detail: snap.jobDetail,
      timeLine: snap.timeLine,
      live: true,
      cancelable: canCancelLive,
      jobId: liveJob?.id || activeWatchJobId || "",
      statusLineText: snap.statusLineText,
      steps: snap.steps || [],
      stepKinds: snap.stepKinds || {},
      logLines: snap.logLines || [],
      iconUrl: snap.iconUrl || "",
      cookieThumbs: snap.cookieThumbs || [],
      currentCookieName: snap.currentCookieName || "",
      progress: {
        pct: snap.progress.pct,
        fraction: snap.fractionText,
        show: snap.progress.total > 0 || snap.phase === "running",
      },
    };
  }

  function pendingJobsToCards() {
    return pendingFarmJobs.map((j, i) => {
      const thumbs = Array.isArray(j.extras?.cookieThumbs) ? j.extras.cookieThumbs : [];
      const first = thumbs[0];
      return {
        mode: j.mode,
        phase: "queued",
        title: typeof jobTitleForMode === "function" ? jobTitleForMode(j.mode) : j.mode,
        badge: "รอคิว",
        detail: j.label || ("คิว #" + (i + 1)),
        timeLine: "คิวส่วนตัว #" + (i + 1),
        live: false,
        pendingId: j.id,
        cancelable: true,
        iconUrl: first?.url || "",
        cookieThumbs: thumbs,
        currentCookieName: j.extras?.itemName || first?.name || "",
      };
    });
  }

  function renderTxCard(card) {
    const article = document.createElement("article");
    article.className = "farm-dock-tx";
    article.dataset.phase = card.phase || "idle";
    if (card.live) article.dataset.live = "1";
    if (card.pendingId) article.dataset.pendingId = card.pendingId;
    const iconSrc =
      resolveMediaSrc(card.iconUrl) || resolveMediaSrc(dockModeIcon(card.mode));
    const dotClass =
      card.phase === "done"
        ? "is-ok"
        : card.phase === "error"
          ? "is-err"
          : card.phase === "running" || card.phase === "queued"
            ? "is-running"
            : "";
    let thumbsHtml = "";
    if (
      card.mode === "cookie_unlock" &&
      Array.isArray(card.cookieThumbs) &&
      card.cookieThumbs.length
    ) {
      const current = String(card.currentCookieName || "").trim().toLowerCase();
      thumbsHtml =
        '<div class="farm-dock-tx-cookies" aria-label="คุกกี้ที่เลือก">' +
        card.cookieThumbs
          .map((t) => {
            const name = String(t.name || t.seq || "");
            const active =
              current && name.trim().toLowerCase() === current ? " is-active" : "";
            const src = resolveMediaSrc(t.url) || resolveMediaSrc(dockModeIcon("cookie_unlock"));
            return (
              '<span class="farm-dock-tx-cookie' +
              active +
              '" title="' +
              escapeHtml(name) +
              '">' +
              '<img src="' +
              escapeHtml(src) +
              '" alt="' +
              escapeHtml(name) +
              '" width="28" height="28" loading="lazy" decoding="async" />' +
              '<span class="farm-dock-tx-cookie-name">' +
              escapeHtml(name) +
              "</span></span>"
            );
          })
          .join("") +
        "</div>";
    }
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
    let stepsHtml = "";
    if (card.live && Array.isArray(card.steps) && card.steps.length) {
      const kinds = card.stepKinds || {};
      stepsHtml =
        '<ol class="farm-dock-tx-steps" aria-label="ขั้นตอน">' +
        card.steps
          .map((s) => {
            const kind = kinds[s.id] || "idle";
            return (
              '<li class="farm-dock-tx-step is-' +
              escapeHtml(kind) +
              '"><span class="farm-dock-tx-step-dot" aria-hidden="true"></span><span>' +
              escapeHtml(s.label || s.id) +
              "</span></li>"
            );
          })
          .join("") +
        "</ol>";
    }
    let logsHtml = "";
    if (card.live) {
      const lines = Array.isArray(card.logLines) ? card.logLines : [];
      const open = !!dockLiveLogOpen;
      logsHtml =
        '<div class="farm-dock-tx-logs">' +
        '<button type="button" class="farm-dock-tx-logs-toggle" data-dock-log-toggle="1" aria-expanded="' +
        (open ? "true" : "false") +
        '">' +
        (open ? "ซ่อนรายละเอียด" : "ดูรายละเอียด") +
        (lines.length ? " (" + lines.length + ")" : "") +
        "</button>" +
        '<ul class="farm-dock-tx-log-list' +
        (open ? "" : " hidden") +
        '" aria-hidden="' +
        (open ? "false" : "true") +
        '">' +
        (lines.length
          ? lines
              .map((l) => {
                const text = typeof l === "string" ? l : l?.text || "";
                const kind = typeof l === "object" && l?.kind ? l.kind : "ok";
                return (
                  '<li class="farm-dock-tx-log-line is-' +
                  escapeHtml(kind) +
                  '">' +
                  escapeHtml(text) +
                  "</li>"
                );
              })
              .join("")
          : '<li class="farm-dock-tx-log-line is-muted">ยังไม่มีรายละเอียด</li>') +
        "</ul></div>";
    }
    const cancelHtml = card.cancelable
      ? card.pendingId
        ? '<button type="button" class="farm-dock-tx-cancel" data-cancel-pending="' +
          escapeHtml(card.pendingId || "") +
          '" aria-label="ยกเลิกคิว">×</button>'
        : card.jobId && !card.adminCancelId
          ? '<button type="button" class="farm-dock-tx-cancel" data-cancel-job="' +
            escapeHtml(card.jobId) +
            '" aria-label="ยกเลิกงาน">×</button>'
          : ""
      : "";
    // Admin cards get an explicit labeled action button in the footer.
    const adminActionHtml = card.adminJobId
      ? '<div class="farm-dock-tx-admin-actions">' +
        '<button type="button" class="farm-dock-tx-admin-log" data-admin-log="' +
        escapeHtml(card.adminJobId) +
        '">Log</button>' +
        (card.cancelable && card.adminCancelId
          ? '<button type="button" class="farm-dock-tx-forcekill' +
            (card.stuck ? " is-stuck" : "") +
            '" data-admin-cancel="' +
            escapeHtml(card.adminCancelId) +
            '">' +
            (card.stuck ? "บังคับจบงานค้าง" : "ยกเลิก / บังคับจบ") +
            "</button>"
          : "") +
        "</div>"
      : "";
    article.innerHTML =
      '<div class="farm-dock-tx-top">' +
      '<div class="farm-dock-tx-icon" aria-hidden="true">' +
      '<img src="' +
      escapeHtml(iconSrc) +
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
      thumbsHtml +
      progressHtml +
      stepsHtml +
      logsHtml +
      adminActionHtml;
    return article;
  }

  let _farmDockRenderTimer = null;
  let _farmDockRenderRaf = 0;

  function scheduleRenderFarmDock(opts = {}) {
    // Coalesce rapid callers (pollers / elapsed / activity) into one paint.
    const immediate = !!opts.immediate;
    if (immediate) {
      if (_farmDockRenderTimer) {
        clearTimeout(_farmDockRenderTimer);
        _farmDockRenderTimer = null;
      }
      if (_farmDockRenderRaf) {
        cancelAnimationFrame(_farmDockRenderRaf);
        _farmDockRenderRaf = 0;
      }
      renderFarmDock(opts);
      return;
    }
    if (_farmDockRenderTimer) return;
    _farmDockRenderTimer = setTimeout(() => {
      _farmDockRenderTimer = null;
      if (_farmDockRenderRaf) cancelAnimationFrame(_farmDockRenderRaf);
      _farmDockRenderRaf = requestAnimationFrame(() => {
        _farmDockRenderRaf = 0;
        if (document.hidden) return;
        renderFarmDock(opts);
      });
    }, 120);
  }

  function renderFarmDock(opts = {}) {
    const snap = buildDockSnapshot(opts);
    if (hasActiveJobStatus() && jobStatusView === "hidden") {
      jobStatusView = "minimized";
    }
    if (jobStatusView !== "hidden") syncJobStatusShell();
    renderMiniStatus(snap);
    if (jobStatusView === "expanded") {
      syncJobStatusCardLayout(snap);
      // Shared header (chip/title/detail) must refresh even on History/Admin,
      // otherwise it sticks on idle "ว่าง / ไม่มีงาน" while a job is running.
      paintJobStatusHeader(snap);
      if (jobStatusTab === "live") renderLiveStatus(snap);
    }
    paintJobLogModalBody(snap.logLines);

    const panelSubEl = $("farm-dock-panel-sub");
    if (panelSubEl) panelSubEl.textContent = snap.panelSub;

    const flashSection = $("farm-dock-flash-section");
    const flashEl = $("farm-dock-flash");
    if (flashEl) {
      const flashText = farmDockFlash.text || "";
      // Don't surface inventory/status noise (e.g. ticket count) as a "live job" banner.
      const noisy =
        /^ตั๋ว\s/i.test(flashText) ||
        /Party Run\s+\d/i.test(flashText) ||
        flashText === "ยกเลิกแล้ว";
      const showFlash =
        !!flashText &&
        !noisy &&
        !snap.idleEmpty &&
        (snap.phase === "idle" || snap.phase === "done" || snap.phase === "error");
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

    const liveIsActive =
      !!liveCard && (snap.phase === "running" || snap.phase === "queued");
    const activeCount = (liveIsActive ? 1 : 0) + pendingCards.length;
    const allCount = activeCount + historyCards.length;
    const allCountEl = $("farm-dock-tab-all-count");
    if (allCountEl) allCountEl.textContent = "(" + allCount + ")";
    const histCountEl = $("farm-history-count");
    if (histCountEl) {
      histCountEl.textContent = String(historyCards.length);
      histCountEl.classList.toggle("hidden", historyCards.length <= 0);
      histCountEl.hidden = historyCards.length <= 0;
    }

    const adminTabBtn = $("farm-dock-tab-admin");
    if (adminTabBtn) {
      adminTabBtn.classList.toggle("hidden", !isAdminUser());
      if (!isAdminUser() && jobStatusTab === "admin") setJobStatusTab("live");
    }

    document.querySelectorAll("[data-job-tab]").forEach((btn) => {
      const tab = btn.getAttribute("data-job-tab");
      const on = tab === jobStatusTab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    const paneLive = $("job-status-pane-live");
    const paneHistory = $("job-status-pane-history");
    const paneAdmin = $("job-status-pane-admin");
    paneLive?.classList.toggle("hidden", jobStatusTab !== "live");
    if (paneLive) paneLive.hidden = jobStatusTab !== "live";
    paneHistory?.classList.toggle("hidden", jobStatusTab !== "history");
    if (paneHistory) paneHistory.hidden = jobStatusTab !== "history";
    paneAdmin?.classList.toggle("hidden", jobStatusTab !== "admin");
    if (paneAdmin) paneAdmin.hidden = jobStatusTab !== "admin";

    const isAdminView = jobStatusTab === "admin" && isAdminUser();
    const userActions = $("farm-dock-user-actions");
    const adminSection = $("farm-dock-admin-section");
    const list = $("farm-dock-list");

    if (userActions) {
      const showCancelAll =
        !isAdminView && (pendingCards.length > 0 || liveIsActive || !!queuedRun);
      userActions.classList.toggle("hidden", !showCancelAll);
    }

    if (adminSection && isAdminView) {
      document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
        const on = btn.getAttribute("data-admin-tab") === adminJobsTab;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      renderAdminJobsList();
    } else if (!isAdminView) {
      stopAdminJobsPoll();
    }

    if (list && jobStatusTab === "history") {
      list.replaceChildren();
      let painted = 0;
      if (
        liveCard &&
        (snap.phase === "done" ||
          snap.phase === "error" ||
          snap.phase === "running" ||
          snap.phase === "queued")
      ) {
        list.appendChild(renderTxCard(liveCard));
        painted += 1;
      }
      for (const card of pendingCards) {
        list.appendChild(renderTxCard(card));
        painted += 1;
      }
      for (const card of historyCards) {
        list.appendChild(renderTxCard(card));
        painted += 1;
      }
      if (!painted) {
        const empty = document.createElement("p");
        empty.className = "farm-dock-empty";
        empty.textContent = "ยังไม่มีประวัติการฟาร์ม";
        list.appendChild(empty);
      }
    }

    const queueSection = $("farm-dock-queue-section");
    const queueList = $("farm-dock-queue");
    const leaveQBtn = $("farm-dock-leave-queue");
    const queueRows = Array.isArray(snap.queue) ? snap.queue : [];
    const showQueue =
      !isAdminView &&
      (snap.phase === "queued" ||
        lastGate?.me?.status === "waiting" ||
        queueRows.length > 0);
    if (queueList) {
      queueList.replaceChildren();
      const leaveVisible =
        snap.phase === "queued" ||
        !!queuedRun ||
        lastGate?.me?.status === "waiting" ||
        (lastGate?.me?.status === "active" && snap.phase === "queued");
      if (showQueue) {
        queueSection?.classList.remove("hidden");
        leaveQBtn?.classList.toggle("hidden", !leaveVisible);
        if (leaveQBtn) {
          leaveQBtn.textContent =
            lastGate?.me?.status === "waiting" || snap.phase === "queued"
              ? "ออกจากคิว"
              : "ออกจากคิว";
          leaveQBtn.title =
            "ยกเลิกเฉพาะงานที่ยังรอคิว — งานที่กำลังรันให้ใช้ปุ่มยกเลิกงาน";
        }
        const rows = queueRows;
        if (rows.length === 0 && (lastGate?.me?.position || leaveVisible)) {
          const li = document.createElement("li");
          li.className = "farm-dock-queue-item is-me";
          const pos = lastGate?.me?.position ?? "—";
          const ahead = lastGate?.me?.ahead;
          const wait = queueWaitText(lastGate);
          li.innerHTML =
            '<span class="farm-dock-queue-pos">#' +
            escapeHtml(pos) +
            '</span><span class="farm-dock-queue-kind">' +
            escapeHtml(queueDetailText(lastGate, snap.jobTitle)) +
            '</span><span class="farm-dock-queue-badge">คิวของคุณ' +
            (ahead != null ? " · ข้างหน้า " + ahead : "") +
            (wait ? " · " + escapeHtml(wait) : "") +
            "</span>";
          queueList.appendChild(li);
        }
        for (const row of rows) {
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
        leaveQBtn?.classList.add("hidden");
      }
    }
    updateFarmLiveBadges();
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

  function hasActiveJobStatus() {
    return (
      dockPhase === "running" ||
      dockPhase === "queued" ||
      !!activeWatchJobId ||
      !!activeWatcher ||
      !!watchJobTimer ||
      !!farmRunning ||
      pendingJobsCount() > 0
    );
  }

  function syncJobStatusShell() {
    const root = $("job-status-root");
    if (!root) return;
    const showShell = jobStatusView !== "hidden";
    const showMini = showShell && hasActiveJobStatus() && jobStatusView === "minimized";
    const showExpanded = showShell && jobStatusView === "expanded";

    if (jobStatusAnimTimer) {
      clearTimeout(jobStatusAnimTimer);
      jobStatusAnimTimer = null;
    }

    const mini = $("job-status-mini");
    const panel = $("job-status-panel");
    const backdrop = $("job-status-backdrop");
    const finishShellHide = () => {
      root.classList.add("hidden");
      root.classList.remove("is-closing", "is-open", "is-minimized", "is-expanded");
      panel?.classList.add("hidden");
      panel?.classList.remove("is-closing");
      backdrop?.classList.add("hidden");
      panel?.setAttribute("aria-hidden", "true");
      backdrop?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("has-job-status", "has-farm-dock");
    };

    if (!showShell) {
      root.setAttribute("aria-hidden", "true");
      mini?.classList.add("hidden");
      mini?.setAttribute("aria-expanded", "false");
      releaseFocusTrap();
      if (root.classList.contains("is-open")) {
        root.classList.add("is-closing");
        root.classList.remove("is-open");
        if (panel && !panel.classList.contains("hidden")) {
          panel.classList.add("is-closing");
        }
        jobStatusAnimTimer = setTimeout(() => {
          jobStatusAnimTimer = null;
          if (jobStatusView !== "hidden") return;
          finishShellHide();
        }, 320);
      } else {
        finishShellHide();
      }
      return;
    }

    root.classList.remove("hidden", "is-closing");
    root.setAttribute("aria-hidden", "false");
    root.classList.toggle("is-minimized", showMini);
    root.classList.toggle("is-expanded", showExpanded);

    mini?.classList.toggle("hidden", !showMini);
    mini?.setAttribute("aria-expanded", showExpanded ? "true" : "false");

    if (showExpanded) {
      panel?.classList.remove("hidden", "is-closing");
      backdrop?.classList.remove("hidden");
      panel?.setAttribute("aria-hidden", "false");
      backdrop?.setAttribute("aria-hidden", "false");
      if (!root.classList.contains("is-open")) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => root.classList.add("is-open"));
        });
      }
      trapFocus($("live-status-card"));
    } else {
      if (panel && !panel.classList.contains("hidden")) {
        panel.classList.add("is-closing");
        releaseFocusTrap();
        jobStatusAnimTimer = setTimeout(() => {
          jobStatusAnimTimer = null;
          if (jobStatusView === "expanded") return;
          panel.classList.add("hidden");
          panel.classList.remove("is-closing");
          backdrop?.classList.add("hidden");
          panel.setAttribute("aria-hidden", "true");
          backdrop?.setAttribute("aria-hidden", "true");
        }, 320);
      } else {
        releaseFocusTrap();
        backdrop?.classList.add("hidden");
        panel?.classList.add("hidden");
        panel?.classList.remove("is-closing");
        panel?.setAttribute("aria-hidden", "true");
        backdrop?.setAttribute("aria-hidden", "true");
      }
      // Keep is-open while minimized so poll/sync does not drop opacity and flicker.
      if (showMini) {
        if (!root.classList.contains("is-open")) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => root.classList.add("is-open"));
          });
        }
      } else {
        root.classList.remove("is-open");
      }
    }

    document.body.classList.toggle("has-job-status", showShell);
    document.body.classList.toggle("has-farm-dock", showShell);
  }

  function renderMiniStatus(snap) {
    const mini = $("job-status-mini");
    if (!mini || jobStatusView !== "minimized") return;
    snap = snap || buildDockSnapshot();
    const phase = snap.phase || "idle";
    const isBusy = phase === "running" || phase === "queued";
    const pct = Math.max(
      0,
      Math.min(
        100,
        phase === "done" && snap.ok !== false
          ? 100
          : phase === "error"
            ? Math.max(Number(snap.progress?.pct) || 0, 8)
            : Number(snap.progress?.pct) || 0
      )
    );
    const indeterminate = isBusy && pct < 0.5;

    mini.classList.toggle("is-running", isBusy);

    const iconWrap = $("job-status-mini-icon");
    const iconSrc =
      resolveMediaSrc(snap.iconUrl) || resolveMediaSrc(dockModeIcon(snap.mode));
    if (iconWrap && iconSrc) {
      let img = iconWrap.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.width = 32;
        img.height = 32;
        img.decoding = "async";
        iconWrap.insertBefore(img, iconWrap.firstChild);
      }
      if (img.getAttribute("src") !== iconSrc) {
        img.setAttribute("src", iconSrc);
      }
      let dot = $("job-status-mini-dot");
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "job-status-mini-dot";
        dot.id = "job-status-mini-dot";
        dot.setAttribute("aria-hidden", "true");
        iconWrap.appendChild(dot);
      }
    }

    const dot = $("job-status-mini-dot");
    if (dot) {
      const wantRunning = isBusy;
      const wantOk = phase === "done" && snap.ok !== false;
      const wantErr =
        phase === "error" || (phase === "done" && snap.ok === false);
      if (
        dot.classList.contains("is-running") !== wantRunning ||
        dot.classList.contains("is-ok") !== wantOk ||
        dot.classList.contains("is-err") !== wantErr
      ) {
        dot.classList.toggle("is-running", wantRunning);
        dot.classList.toggle("is-ok", wantOk);
        dot.classList.toggle("is-err", wantErr);
      }
    }

    const nextTitle = snap.jobTitle || "งานฟาร์ม";
    const titleEl = $("job-status-mini-title");
    if (titleEl && titleEl.textContent !== nextTitle) titleEl.textContent = nextTitle;

    const nextChip =
      phase === "running"
        ? snap.statusBadge || snap.statusLineText || dockPhaseLabel(phase)
        : snap.statusBadge || dockPhaseLabel(phase);
    const chipEl = $("job-status-mini-chip");
    if (chipEl) {
      if (chipEl.textContent !== nextChip) chipEl.textContent = nextChip;
      if (chipEl.getAttribute("data-phase") !== phase) chipEl.setAttribute("data-phase", phase);
    }

    const fillEl = $("job-status-mini-fill");
    if (fillEl) {
      fillEl.classList.toggle("is-indeterminate", indeterminate);
      const nextWidth = (indeterminate ? 42 : pct) + "%";
      if (fillEl.style.width !== nextWidth) fillEl.style.width = nextWidth;
    }

    const nextPct = pct + "%";
    const pctEl = $("job-status-mini-pct");
    if (pctEl && pctEl.textContent !== nextPct) pctEl.textContent = nextPct;

    const nextFrac = snap.fractionText || "—";
    const fracEl = $("job-status-mini-frac");
    if (fracEl && fracEl.textContent !== nextFrac) fracEl.textContent = nextFrac;
  }

  function setJobStatusTab(tab) {
    jobStatusTab = tab === "history" ? "history" : tab === "admin" ? "admin" : "live";
    dockHistoryTab = jobStatusTab === "admin" ? "admin" : "all";
    if (jobStatusTab === "history") {
      loadFarmHistory().catch(() => {});
    } else if (jobStatusTab === "admin" && isAdminUser()) {
      loadAdminHeartMaxSetting().catch(() => {});
      loadAdminJobs({ reset: true }).catch(() => {});
    } else {
      stopAdminJobsPoll();
    }
    renderFarmDock({ immediate: true });
  }

  function expandJobStatus() {
    jobStatusView = "expanded";
    liveStatusOpen = true;
    dockExpanded = true;
    syncJobStatusShell();
    if (jobStatusTab === "history") loadFarmHistory().catch(() => {});
    if (jobStatusTab === "admin" && isAdminUser()) {
      loadAdminJobs({ reset: true }).catch(() => {});
    }
    renderFarmDock({ immediate: true });
  }

  function minimizeJobStatus() {
    if (hasActiveJobStatus()) {
      jobStatusView = "minimized";
    } else {
      jobStatusView = "hidden";
    }
    liveStatusOpen = false;
    dockExpanded = false;
    syncJobStatusShell();
  }

  function hideJobStatusShell() {
    jobStatusView = "hidden";
    liveStatusOpen = false;
    dockExpanded = false;
    dockLiveLogOpen = false;
    releaseFocusTrap();
    syncJobStatusShell();
  }

  function openJobStatusHistory() {
    setJobStatusTab("history");
    jobStatusView = "expanded";
    liveStatusOpen = true;
    dockExpanded = true;
    syncJobStatusShell();
    loadFarmHistory()
      .then(() => renderFarmDock({ immediate: true }))
      .catch(() => renderFarmDock({ immediate: true }));
  }

  function showFarmDock() {
    if (jobStatusView === "hidden") {
      if (hasActiveJobStatus()) jobStatusView = "minimized";
      else return;
    }
    syncJobStatusShell();
  }

  function hideFarmDock() {
    hideJobStatusShell();
    dockPhase = null;
    dockOk = null;
    dockJobStartedAt = null;
    dockJobFinishedAt = null;
    liveJob = null;
    statusContext = null;
    pipelineState = null;
    farmDockFlash = { text: "", kind: "muted" };
    stopDockElapsedTimer();
    clearPendingFarmJobs();
  }

  function expandFarmDock() {
    expandJobStatus();
  }

  function collapseFarmDock() {
    minimizeJobStatus();
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
    if (jobStatusView !== "expanded" || jobStatusTab === "live") {
      jobStatusTab = "live";
    }
    showFarmDock();
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

  function clearActiveWatcher(jobId) {
    if (activeWatcher?.jobId === jobId) activeWatcher = null;
  }

  function persistWatchJobId(id) {
    activeWatchJobId = id || null;
    try {
      if (id) localStorage.setItem(FARM_JOB_ID_KEY, id);
      else localStorage.removeItem(FARM_JOB_ID_KEY);
    } catch (_) {}
  }

  function persistFarmIntent(intent) {
    try {
      if (!intent) {
        sessionStorage.removeItem(FARM_JOB_INTENT_KEY);
        return;
      }
      const safeBody = { ...(intent.body || {}) };
      delete safeBody.password;
      delete safeBody.email;
      delete safeBody.proxy_url;
      sessionStorage.setItem(
        FARM_JOB_INTENT_KEY,
        JSON.stringify({
          url: intent.url,
          mode: intent.mode,
          target: Number(intent.target) || 0,
          body: safeBody,
          jobId: intent.jobId || null,
          savedAt: Date.now(),
        })
      );
    } catch (_) {}
  }

  function loadFarmIntent() {
    try {
      const raw = sessionStorage.getItem(FARM_JOB_INTENT_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || Date.now() - Number(parsed.savedAt || 0) > FARM_JOB_INTENT_TTL_MS) {
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function newClientJobKey() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2) +
      "-" +
      Math.random().toString(36).slice(2)
    );
  }

  async function fetchJobStatus(jobId) {
    return api("/api/farm/job/" + encodeURIComponent(jobId));
  }

  function applyLiveJobProgress(jobRow, mode, target) {
    const m = mode || jobKindToMode(jobRow?.job_kind) || statusContext?.mode || "partyrun";
    // Switch pipeline when the active job kind changes (prevents Party Run steps leaking onto Cookie Unlock).
    if (!pipelineState || pipelineState.mode !== m) {
      const keep = statusContext?.mode === m ? statusContext : null;
      statusContext = {
        ...(keep || {}),
        mode: m,
        target: target || keep?.target || 0,
      };
      pipelineState = freshPipeline(m);
      if (!dockJobStartedAt) dockJobStartedAt = Date.now();
      if (dockPhase !== "running" && dockPhase !== "done" && dockPhase !== "error") {
        dockPhase = "running";
      }
    } else if (dockPhase !== "running" && dockPhase !== "done" && dockPhase !== "error") {
      dockPhase = "running";
    }
    const logs = jobRow?.logs || [];
    applyLogsToPipeline(logs, m);
    const parsed = parseProgressFromLogs(logs, m, target);
    // Prefer DB progress only when it advances past log-parsed values (or job finished).
    // Stale worker heartbeats that keep writing {current:0} must not wipe live log progress.
    const jobDone =
      jobRow?.status === "succeeded" ||
      jobRow?.status === "failed" ||
      jobRow?.status === "cancelled";
    if (jobRow?.progress) {
      const dbCur = jobRow.progress.current != null ? Number(jobRow.progress.current) : null;
      const dbTot = jobRow.progress.total != null ? Number(jobRow.progress.total) : null;
      if (dbTot != null && dbTot > 0) {
        parsed.total = Math.max(Number(parsed.total) || 0, dbTot);
      }
      if (dbCur != null && Number.isFinite(dbCur)) {
        if (jobDone || dbCur >= (Number(parsed.current) || 0)) {
          parsed.current = dbCur;
        }
      }
      if (jobRow.progress.phase) {
        parsed.phase = jobRow.progress.phase;
      }
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
    if (parsed.phase) {
      pipelineState.progressPhase = parsed.phase;
      const phaseStep = stepIdxFromPhase(m, parsed.phase);
      if (phaseStep >= 0) setPipelineActive(phaseStep);
    }
    renderPipeline();
  }

  function stepIdxFromPhase(mode, phase) {
    const key = String(phase || "").toLowerCase();
    if (!key) return -1;
    const alias = {
      start: "login",
      round: "run",
      collect: "claim",
      items: mode === "cookie_unlock" ? "unlock" : mode === "upgrade" ? "upgrade" : "run",
      unlock: "unlock",
      buy: "buy",
      extract: "extract",
      open: "open",
      draw: "draw",
      guests: "guests",
      send: "send",
    };
    const want = alias[key] || key;
    const steps = pipelineStepsFor(mode);
    return steps.findIndex((s) => s.id === want);
  }

  async function watchFarmJob(jobId, mode, target, handlers) {
    if (activeWatcher?.jobId === jobId) {
      return activeWatcher.promise;
    }
    if (activeWatcher) {
      stopWatchJobPoll();
      activeWatcher.resolve?.(null);
      activeWatcher = null;
    }
    persistWatchJobId(jobId);
    // Bind the tracked live job to this concrete job id so pollers can't hijack it.
    if (!liveJob || liveJob.mode !== mode) {
      liveJob = { id: jobId, mode, target: Number(target) || 0, finished: false };
    } else {
      liveJob.id = jobId;
      liveJob.finished = false;
      if (target) liveJob.target = Number(target) || liveJob.target;
    }
    dockPhase = "running";
    dockOk = null;
    if (!dockJobStartedAt) dockJobStartedAt = Date.now();
    startDockElapsedTimer();
    jobStatusTab = "live";
    showFarmDock();
    renderFarmDock({ mode, target });

    let watcherResolve = null;
    const promise = new Promise((resolve) => {
      watcherResolve = resolve;
      let settled = false;
      let pollErrors = 0;
      let tickInFlight = false;
      const finishWatch = async (jobRow) => {
        if (settled) return;
        settled = true;
        stopWatchJobPoll();
        stopDockElapsedTimer();
        persistWatchJobId(null);
        const result = jobRow?.result || {};
        const logs = jobRow?.logs || [];
        const st = jobRow?.status || "";
        let ok = st === "succeeded";
        // Heart: short of target is a failure even if an older worker wrote succeeded.
        if (mode === "heart" && heartProgressFromResult(result, target).incomplete) {
          ok = false;
        }
        // Cookie unlock: treat in-game unlock / partial result as success even if
        // an older worker wrote failed after Unlock OK + upgrade fail.
        if (
          !ok &&
          st !== "cancelled" &&
          (mode === "cookie_unlock" || mode === "cookie") &&
          (Number(result.items_done || 0) > 0 || result.partial || result.ok === true)
        ) {
          ok = true;
        }
        dockOk = ok;
        dockPhase = ok ? "done" : "error";
        lastFinishedJobId = jobId;
        if (liveJob && (liveJob.id === jobId || !liveJob.id)) {
          liveJob.id = jobId;
          liveJob.finished = true;
        }
        stopProgressPoll();
        buildFinalPipeline(logs, result, ok, mode);
        const completed = Number(
          result.items_done ??
          result.rounds_completed ??
          result.hearts ??
          result.current ??
          0
        );
        if (!ok && completed <= 0 && pipelineState) {
          pipelineState.extras = [
            { text: "ล้มเหลวก่อนเริ่ม · 0/" + (Number(target) || 0), kind: "err" },
            ...(pipelineState.extras || []),
          ];
        }
        if (jobRow?.billing_outcome?.charged === false && pipelineState) {
          pipelineState.extras = [
            ...(pipelineState.extras || []),
            { text: "งานนี้รวมในวันเช่า · ไม่มีการหักโทเคน", kind: "ok" },
          ];
        }
        const resultError = String(
          result.error || jobRow?.error || jobRow?.detail || ""
        );
        if (/devplay_session_expired|session_expired|login_failed/i.test(resultError)) {
          devplayConnectionState = "expired";
          recoverDevPlaySession().catch(() => false);
        }
        // Show success/error state immediately (before any queued next job starts).
        openRunStatusPopup(false);
        setRunStatusClosable(true);
        setRunStatusSubtitle(true, ok);
        renderFarmDock({ mode, target, ok });
        if (ok && typeof handlers?.onSuccess === "function") {
          handlers.onSuccess({ ...jobRow, result, ok: true, logs, ...result });
        } else if (!ok && typeof handlers?.onError === "function") {
          handlers.onError({ ...jobRow, result, ok: false, logs, ...result });
        }
        clearActiveWatcher(jobId);
        persistFarmIntent(null);
        resolve(jobRow);
      };

      let gateTick = 0;
      const tick = async () => {
        if (settled || !accessToken || tickInFlight) return;
        tickInFlight = true;
        try {
          // Gate is expensive under load — poll it every 3s, not every tick.
          gateTick += 1;
          const wantGate = gateTick === 1 || gateTick % 3 === 0 || !!queuedRun;
          const gatePromise = wantGate
            ? api("/api/farm/gate", { timeoutMs: 12000 }).catch(() => null)
            : Promise.resolve(null);
          const activePromise = api("/api/farm/active-job", {
            timeoutMs: 12000,
          }).catch(() => null);
          const [gateData, activeData] = await Promise.all([gatePromise, activePromise]);
          if (settled || activeWatcher?.jobId !== jobId) return;
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
          if (settled || activeWatcher?.jobId !== jobId) return;
          if (jobRow.status === "running" || jobRow.status === "queued") {
            applyLiveJobProgress(jobRow, mode || jobKindToMode(jobRow.job_kind), target);
            return;
          }
          const payload = { ...jobRow, ...(jobRow.result || {}), result: jobRow.result };
          pollErrors = 0;
          await finishWatch(payload);
        } catch (e) {
          pollErrors += 1;
          if (pollErrors === 3 && pipelineState) {
            pipelineState.extras = [
              {
                text: "ขาดการเชื่อมต่อชั่วคราว — กำลังลองใหม่…",
                kind: "muted",
              },
              ...(pipelineState.extras || []).filter(
                (x) => !/ขาดการเชื่อมต่อ/.test(String(x?.text || ""))
              ),
            ];
            renderFarmDock({ mode, target });
          }
          if (pollErrors >= 8 && !settled) {
            dockPhase = "error";
            dockOk = false;
            stopDockElapsedTimer();
            const msg = thError(e.message || e.data?.detail || "job_poll_failed");
            if (pipelineState) {
              pipelineState.extras = [{ text: msg, kind: "err" }];
            }
            farmDockFlash = { text: msg, kind: "err" };
            renderFarmDock({ mode, target, ok: false, errorMsg: msg });
            showToast(msg, "err");
            if (typeof handlers?.onError === "function") {
              handlers.onError({ ok: false, error: "job_poll_failed", detail: msg });
            }
            settled = true;
            stopWatchJobPoll();
            persistWatchJobId(null);
            clearActiveWatcher(jobId);
            resolve(null);
            if (!queuedRun) dequeueAndStartNext();
          }
        } finally {
          tickInFlight = false;
        }
      };

      stopWatchJobPoll();
      watchJobTimer = setInterval(tick, 2500);
      tick();
    });
    activeWatcher = { jobId, promise, resolve: watcherResolve };
    return promise;
  }

  async function submitFarmJob({ url, body, mode, target, handlers, extras }) {
    body = {
      ...(body || {}),
      client_job_key: body?.client_job_key || newClientJobKey(),
    };
    farmRunning = true;
    persistFarmIntent({ url, body, mode, target });
    updateFarmAvailability();
    resetDockLiveForJob(mode, target, extras || {});
    showFarmDock();
    renderFarmDock({ mode, target });
    try {
      await ensureApiReady();
      const data = await api(url, { method: "POST", body });
      if (data.accepted && data.job_id) {
        persistFarmIntent({ url, body, mode, target, jobId: data.job_id });
        startLiveStages({ mode, target, ...(extras || {}) });
        showFarmDock();
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
        startLiveStages({ mode, target, ...(extras || {}) });
        buildFinalPipeline(data.logs || [], data.result || data, ok, mode);
        showFarmDock();
        if (ok && handlers?.onSuccess) handlers.onSuccess(data);
        else if (!ok && handlers?.onError) handlers.onError(data);
        persistFarmIntent(null);
        return data;
      }
      return data;
    } catch (e) {
      clearStageTimer();
      const detailCode =
        e?.data?.detail?.code ||
        e?.data?.detail?.message ||
        e?.code ||
        e?.message ||
        "";
      if (/already_running/i.test(String(detailCode))) {
        showToast(ERR_TH.already_running, "muted");
        showFarmDock();
        await resumeFarmSession();
        return null;
      }
      if (e.status === 409 || /farm_busy/i.test(String(e.message))) {
        showFarmDock();
        await enterQueueFor(
          e.gate || e.data?.detail?.gate,
          () => submitFarmJob({ url, body, mode, target, handlers, extras }),
          modeToJobKind(mode)
        );
        setFarmStatus( "ระบบไม่ว่าง — จองคิวให้แล้ว รอสักครู่", "muted");
        return null;
      }
      if (/job_tracking_unavailable/i.test(String(e.message))) {
        dockPhase = "error";
        dockOk = false;
        showFarmDock();
        renderFarmDock({ mode, target, ok: false, errorMsg: "ไม่สามารถติดตามงานบนเซิร์ฟเวอร์ได้ — ลองใหม่" });
      }
      if (!/timeout|network_error/i.test(String(e.message || ""))) {
        persistFarmIntent(null);
      }
      throw e;
    } finally {
      farmRunning = false;
      updateFarmAvailability();
      if (!queuedRun && !activeWatchJobId) {
        dequeueAndStartNext(dockPhase === "done" || dockPhase === "error" ? 900 : 320);
      }
    }
  }

  async function resumeFarmSession() {
    if (!accessToken) return;
    try {
      const savedIntent = loadFarmIntent();
      const gate = await api("/api/farm/gate").catch(() => null);
      if (gate) lastGate = gate;
      const active = await api("/api/farm/active-job").catch(() => null);
      let jobId = active?.active ? active.job_id : null;
      if (!jobId) {
        try {
          jobId = localStorage.getItem(FARM_JOB_ID_KEY);
        } catch (_) {}
      }
      // Never resurrect a job we already finished and are showing as done/error.
      if (active?.active && jobId && jobId === lastFinishedJobId) return;
      if (active?.active && jobId) {
        const mode =
          jobKindToMode(active.job_kind || active.kind) ||
          savedIntent?.mode ||
          "partyrun";
        const target =
          Number(active.progress?.total) ||
          Number(savedIntent?.target) ||
          statusContext?.target ||
          0;
        resetDockLiveForJob(mode, target);
        statusContext = { ...(statusContext || {}), mode, target };
        startLiveStages({ mode, target });
        showFarmDock();
        farmRunning = true;
        updateFarmAvailability();
        showToast(
          "พบงาน" +
            (JOB_KIND_TH[mode] || mode) +
            "ที่รันต่อจากครั้งก่อน" +
            (gate?.me?.position
              ? " · อันดับคิว " + gate.me.position
              : gate?.me?.status === "active"
                ? " · กำลังรัน"
                : "") +
            " — ดูแถบสถานะ",
          "muted"
        );
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
      if (
        !active?.active &&
        !gate?.me?.status &&
        !queuedRun &&
        pendingFarmJobs.length === 0 &&
        !activeWatchJobId &&
        !activeWatcher &&
        !watchJobTimer &&
        !farmRunning
      ) {
        // Clear stale local tracking after refresh/background resume. Without
        // this, an old running phase renders as a phantom Party Run forever.
        // Never wipe while a local watcher is still attached to a live job.
        let localJobId = null;
        try {
          localJobId = localStorage.getItem(FARM_JOB_ID_KEY);
        } catch (_) {}
        if (localJobId) {
          const row = await fetchJobStatus(localJobId).catch(() => null);
          const st = String(row?.status || "");
          if (st === "queued" || st === "running") {
            // Server still has the job — re-attach instead of wiping.
            const mode =
              jobKindToMode(row.job_kind || row.kind) ||
              savedIntent?.mode ||
              "partyrun";
            const target =
              Number(row.progress?.total) ||
              Number(savedIntent?.target) ||
              0;
            resetDockLiveForJob(mode, target);
            farmRunning = true;
            updateFarmAvailability();
            watchFarmJob(localJobId, mode, target, {}).catch(() => {});
            return;
          }
        }
        persistWatchJobId(null);
        farmRunning = false;
        if (dockPhase === "running" || dockPhase === "queued") {
          dockPhase = null;
          liveJob = null;
          statusContext = null;
          pipelineState = null;
          stopDockElapsedTimer();
        }
        if (
          (dockPhase === "done" || dockPhase === "error") &&
          jobStatusView !== "expanded"
        ) {
          dockPhase = null;
          liveJob = null;
          statusContext = null;
          pipelineState = null;
          hideJobStatusShell();
        }
      }
      if (gate?.me?.status === "waiting" || gate?.me?.status === "active") {
        if (savedIntent?.url && savedIntent?.body) {
          queuedJobKind = modeToJobKind(savedIntent.mode);
          queuedRun = () =>
            submitFarmJob({
              url: savedIntent.url,
              body: savedIntent.body,
              mode: savedIntent.mode,
              target: savedIntent.target,
              handlers: {},
            });
        }
        showFarmDockQueue(gate);
        startQueuePoll();
      }
    } catch (_) {}
  }

  function liveStatusJobId() {
    return liveJob?.id || activeWatchJobId || "";
  }

  function syncJobStatusCardLayout(snap) {
    const card = $("live-status-card");
    if (!card) return;
    snap = snap || buildDockSnapshot();
    const phase = snap.phase || "idle";
    card.dataset.jobTab = jobStatusTab;
    card.setAttribute("data-phase", phase);
    // Compact height is only for the idle live tab — history/admin need room to grow.
    const compactIdle =
      jobStatusTab === "live" && (phase === "idle" || phase === "done");
    card.classList.toggle("is-compact", compactIdle);
  }

  function paintJobStatusHeader(snap) {
    snap = snap || buildDockSnapshot();
    const phase = snap.phase || "idle";

    const iconImg = $("live-status-icon-img");
    const iconSrc =
      resolveMediaSrc(snap.iconUrl) ||
      (snap.mode ? resolveMediaSrc(dockModeIcon(snap.mode)) : resolveMediaSrc("notice_b20.png"));
    if (iconImg && iconSrc && iconImg.getAttribute("src") !== iconSrc) {
      iconImg.src = iconSrc;
    }

    const chip = $("live-status-chip");
    if (chip) {
      chip.textContent = snap.statusBadge || dockPhaseLabel(phase);
      chip.setAttribute("data-phase", phase);
    }

    const titleEl = $("live-status-title");
    if (titleEl) titleEl.textContent = snap.jobTitle || "งานฟาร์ม";
    const detailEl = $("live-status-detail");
    if (detailEl) detailEl.textContent = snap.jobDetail || snap.panelSub || "—";
  }

  function jobLogLinesAsText(logLines) {
    const lines = Array.isArray(logLines) ? logLines.slice(-200) : [];
    return lines
      .map((l) => (typeof l === "string" ? l : l?.text || ""))
      .filter((t) => String(t).trim())
      .join("\n");
  }

  function paintJobLogModalBody(logLines) {
    if (adminJobLogActive) return;
    const modal = $("job-log-modal");
    const body = $("job-log-body");
    if (!modal || !body || modal.classList.contains("hidden")) return;
    const text = jobLogLinesAsText(logLines);
    const next = text || "ยังไม่มี log";
    if (body.textContent !== next) {
      const stickBottom =
        body.scrollHeight - body.scrollTop - body.clientHeight < 48;
      body.textContent = next;
      if (stickBottom) body.scrollTop = body.scrollHeight;
    }
  }

  function openJobLogModal() {
    adminJobLogActive = false;
    const modal = $("job-log-modal");
    if (!modal) return;
    const snap = buildDockSnapshot();
    const eyebrow = $("job-log-eyebrow");
    if (eyebrow) eyebrow.textContent = snap.jobTitle || "Worker";
    const title = $("job-log-title");
    if (title) title.textContent = "Log งาน";
    const body = $("job-log-body");
    if (body) {
      body.textContent = jobLogLinesAsText(snap.logLines) || "ยังไม่มี log";
    }
    animateOpen(modal);
    lockBodyScroll("job-log-open");
    const sheet = modal.querySelector(".job-log-sheet") || modal;
    trapFocus(sheet);
    if (body) body.scrollTop = body.scrollHeight;
  }

  function closeJobLogModal() {
    const modal = $("job-log-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    adminJobLogActive = false;
    unlockBodyScroll("job-log-open");
    releaseFocusTrap();
    animateClose(modal);
  }

  async function openAdminJobLog(jobId) {
    const id = String(jobId || "").trim();
    if (!id) return;
    const modal = $("job-log-modal");
    if (!modal) return;
    adminJobLogActive = true;
    const eyebrow = $("job-log-eyebrow");
    if (eyebrow) eyebrow.textContent = "Admin";
    const title = $("job-log-title");
    if (title) title.textContent = "Log จริง";
    const body = $("job-log-body");
    if (body) body.textContent = "กำลังโหลด…";
    animateOpen(modal);
    lockBodyScroll("job-log-open");
    const sheet = modal.querySelector(".job-log-sheet") || modal;
    trapFocus(sheet);
    try {
      const data = await api("/api/admin/jobs/" + encodeURIComponent(id), { timeoutMs: 20000 });
      const kind = data.kind || "";
      const name = data.username || "";
      const shortId = id.slice(0, 8);
      if (eyebrow) eyebrow.textContent = [name, JOB_KIND_TH[kind] || kind, shortId].filter(Boolean).join(" · ");
      if (title) title.textContent = "Log จริง";
      const logs = Array.isArray(data.logs) ? data.logs : [];
      if (body) {
        body.textContent = jobLogLinesAsText(logs) || (data.error ? String(data.error) : "ยังไม่มี log");
        body.scrollTop = body.scrollHeight;
      }
    } catch (e) {
      if (body) body.textContent = thError(e.message) || e.message || "โหลด log ไม่สำเร็จ";
    }
  }

  function renderLiveStatus(snap) {
    if (jobStatusView !== "expanded" || jobStatusTab !== "live") return;
    snap = snap || buildDockSnapshot();
    const phase = snap.phase || "idle";

    const card = $("live-status-card");
    if (card) {
      syncJobStatusCardLayout(snap);
    }

    paintJobStatusHeader(snap);

    const pct = Math.max(0, Math.min(100, Number(snap.progress?.pct) || 0));
    const ring = $("live-status-ring");
    if (ring) ring.style.setProperty("--pct", String(pct));

    const fillEl = $("live-status-fill");
    if (fillEl) fillEl.style.width = pct + "%";
    const trackEl = $("live-status-track");
    if (trackEl) trackEl.setAttribute("aria-valuenow", String(pct));

    const pctEl = $("live-status-pct");
    if (pctEl) pctEl.textContent = pct + "%";
    const fracEl = $("live-status-fraction");
    if (fracEl) fracEl.textContent = snap.fractionText || "—";

    const phaseEl = $("live-status-phase");
    if (phaseEl) {
      const focusText = String(snap.statusLineText || dockPhaseLabel(phase) || "—")
        .replace(/\s*[·•]\s*\d+.*$/, "")
        .replace(/\.{2,}$/, "")
        .trim();
      phaseEl.textContent = focusText || dockPhaseLabel(phase) || "—";
    }
    const timeEl = $("live-status-time");
    if (timeEl) {
      if (snap.elapsedSec != null && Number(snap.elapsedSec) >= 0) {
        timeEl.textContent = "ใช้เวลา " + formatDockElapsed(snap.elapsedSec);
      } else if (snap.timeLine) {
        timeEl.textContent = snap.timeLine;
      } else {
        timeEl.textContent = "—";
      }
    }

    const stepsBox = $("live-status-steps");
    if (stepsBox) {
      stepsBox.replaceChildren();
      const steps = Array.isArray(snap.steps) ? snap.steps : [];
      const kinds = snap.stepKinds || {};
      for (const s of steps) {
        const kind = kinds[s.id] || "idle";
        const li = document.createElement("li");
        li.className =
          "session-timeline-item" +
          (kind === "ok"
            ? " is-ok"
            : kind === "pending"
              ? " is-pending"
              : kind === "err"
                ? " is-err"
                : "");
        const dot = document.createElement("span");
        dot.className = "session-timeline-dot";
        dot.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "session-timeline-label";
        label.textContent = stepLabel(s, kind, snap.mode) || s.label || s.id;
        li.appendChild(dot);
        li.appendChild(label);
        stepsBox.appendChild(li);
      }
    }

    const logLines = Array.isArray(snap.logLines) ? snap.logLines.slice(-200) : [];
    const previewWrap = $("live-status-log-preview");
    const previewList = $("live-status-log-preview-list");
    const logOpenBtn = $("job-log-open-btn");
    const activeLike =
      phase === "running" || phase === "queued" || phase === "done" || phase === "error";
    const showLogUi =
      activeLike && (logLines.length > 0 || phase === "running" || phase === "queued");
    if (previewWrap) {
      previewWrap.classList.toggle("hidden", !showLogUi);
    }
    if (previewList && showLogUi) {
      previewList.replaceChildren();
      const preview = logLines.slice(-5);
      if (!preview.length) {
        const li = document.createElement("li");
        li.className = "is-muted";
        li.textContent = phase === "queued" ? "รอคิว — ยังไม่มี log" : "กำลังรอ log…";
        previewList.appendChild(li);
      } else {
        for (const l of preview) {
          const text = typeof l === "string" ? l : l?.text || "";
          const k = typeof l === "object" && l?.kind ? l.kind : "";
          const li = document.createElement("li");
          if (k) li.className = "is-" + k;
          li.textContent = text;
          previewList.appendChild(li);
        }
      }
    }
    if (logOpenBtn) {
      logOpenBtn.classList.toggle("hidden", !showLogUi);
      logOpenBtn.disabled = !showLogUi;
    }

    // Keep legacy list in sync (hidden) for any leftover callers.
    const logWrap = $("live-status-log-wrap");
    const logList = $("live-status-log");
    if (logWrap && logList && logLines.length) {
      logList.replaceChildren();
      for (const l of logLines.slice(-120)) {
        const text = typeof l === "string" ? l : l?.text || "";
        const k = typeof l === "object" && l?.kind ? l.kind : "";
        const li = document.createElement("li");
        li.className = "live-status-log-line" + (k ? " is-" + k : "");
        li.textContent = text;
        logList.appendChild(li);
      }
    }

    paintJobLogModalBody(logLines);

    const running = phase === "running" || phase === "queued";
    const jobId = liveStatusJobId();
    const cancelable = running && !!jobId;
    const leaveVisible =
      phase === "queued" && (!jobId || lastGate?.me?.status === "waiting");
    const cancelBtn = $("live-status-cancel");
    if (cancelBtn) {
      cancelBtn.classList.toggle("hidden", !cancelable);
      const cancelling = !!(
        liveJob?.cancelRequested ||
        lastGate?.me?.cancel_requested ||
        pipelineState?.cancelling
      );
      cancelBtn.textContent = cancelling ? "กำลังยกเลิก…" : "ยกเลิกงาน";
      cancelBtn.disabled = !!cancelling;
      cancelBtn.title = cancelling
        ? ERR_TH.cancelling
        : phase === "queued"
          ? "ยกเลิกงานที่รอคิว"
          : "ขอหยุดงานที่กำลังรัน (อาจใช้เวลาสักครู่)";
    }
    const leaveQBtn = $("farm-dock-leave-queue");
    if (leaveQBtn && leaveVisible) {
      leaveQBtn.classList.remove("hidden");
    }
    const doneBtn = $("live-status-done");
    if (doneBtn) {
      doneBtn.classList.toggle("hidden", running);
      doneBtn.textContent = phase === "done" ? "เสร็จสิ้น" : "ปิด";
    }
  }

  function openLiveStatus() {
    jobStatusTab = "live";
    expandJobStatus();
  }

  function closeLiveStatus() {
    minimizeJobStatus();
  }

  function openRunStatusPopup(running) {
    clearRunStatusAutoClose();
    // Always jump to Live while a job is active so header/progress never stick on History idle copy.
    if (running) {
      jobStatusTab = "live";
      pendingAfterRunStatus = null;
      setRunStatusSubtitle(false);
    } else if (
      !(
        jobStatusView === "expanded" &&
        (jobStatusTab === "history" || jobStatusTab === "admin")
      )
    ) {
      jobStatusTab = "live";
    }
    if (hasActiveJobStatus() || running) {
      jobStatusView = jobStatusView === "expanded" ? "expanded" : "minimized";
      showFarmDock();
    }
    liveStatusOpen = jobStatusView === "expanded";
    syncJobStatusShell();
    renderFarmDock({ immediate: true });
  }

  function closeRunStatusPopup() {
    clearRunStatusAutoClose();
    const cb = pendingAfterRunStatus;
    pendingAfterRunStatus = null;
    hideJobStatusShell();
    if (typeof cb === "function") cb();
    if (dockPhase === "done" || dockPhase === "error") resetFarmDockIdle();
  }

  function forceCloseRunStatusPopup() {
    clearRunStatusAutoClose();
    runStatusClosable = true;
    pendingAfterRunStatus = null;
    hideJobStatusShell();
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
    if (parsed.phase) pipelineState.progressPhase = parsed.phase;
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
    if (watchJobTimer) return;
    if (!accessToken || (!farmRunning && !activeWatchJobId)) return;
    try {
      const data = await api("/api/farm/active-job");
      if (!data?.active || !pipelineState) return;
      // Only accept progress for the job we are actually tracking.
      // A different server-side "running" row (e.g. a stale party run) must not hijack the card.
      if (activeWatchJobId && data.job_id && data.job_id !== activeWatchJobId) return;
      if (liveJob?.finished) return;
      const mode =
        (liveJob && !liveJob.finished && liveJob.mode) ||
        jobKindToMode(data.job_kind) ||
        statusContext?.mode ||
        pipelineState.mode ||
        "partyrun";
      applyLiveJobProgress(data, mode, liveJob?.target || statusContext?.target);
    } catch (_) {}
  }

  function startProgressPoll() {
    stopProgressPoll();
    if (watchJobTimer) return;
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
    const next = ctx || { mode: "partyrun", target: 0 };
    const mode = next.mode || "partyrun";
    const prev =
      statusContext?.mode === mode
        ? statusContext
        : null;
    statusContext = {
      ...(prev || {}),
      ...next,
      mode,
      target: next.target != null ? next.target : prev?.target || 0,
    };
    clearStageTimer();
    clearRunStatusAutoClose();
    dockPhase = "running";
    dockOk = null;
    dockJobStartedAt = Date.now();
    dockJobFinishedAt = null;
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
    // Keep the user's selected History/Admin tab stable when a job completes.
    // Completed work is available in history and should not leave a stale pill.
    if (jobStatusView === "expanded" && jobStatusTab === "live") {
      renderFarmDock({ immediate: true });
    }
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
    [/^\[round\s+(\d+)\/(\d+)\]\s*\[2\/4\]/i, (m) => "รอบ " + m[1] + "/" + m[2] + " — จับคู่ห้อง"],
    [/^\[round\s+(\d+)\/(\d+)\]\s*\[3\/4\]/i, (m) => "รอบ " + m[1] + "/" + m[2] + " — กำลังวิ่ง+ส่งผล"],
    [/^\[round\s+(\d+)\/(\d+)\]/i, (m) => "รอบที่ " + m[1] + " จาก " + m[2]],
    [/partyrun:\s*starting\s+(\d+)\s+run/i, (m) => "เริ่มวิ่ง " + m[1] + " รอบ"],
    [/claiming reward/i, () => "กำลังรับรางวัล"],
    [/REWARD CLAIMED/i, () => "รับรางวัลแล้ว"],
    [/matchmaking/i, () => "กำลังจับคู่ห้อง"],
    [/creating guest/i, () => "กำลังสร้างไอดีชั่วคราว"],
    [/create_guest failed/i, () => "สร้างไอดีชั่วคราวไม่สำเร็จ"],
    [/sending life/i, () => "กำลังส่งหัวใจ"],
    // Heart farm — detailed session lines
    [/heart:\s*login main account/i, () => "เข้าสู่ระบบบัญชีหลัก"],
    [/heart:\s*prefetching\s+~?(\d+)\s+guests/i, (m) => "เตรียมเพื่อน guest ~" + m[1] + " คน"],
    [/session\s+(\d+):\s*target=(\d+)\s+collected=(\d+)\s+room=(\d+)\s+batch=(\d+)/i, (m) => "รอบ " + m[1] + ": เก็บแล้ว " + m[3] + "/" + m[2] + " (ชุดละ " + m[5] + ")"],
    [/session\s+(\d+)\s+done:\s*\+(\d+)\s+total\s+(\d+)\/(\d+)/i, (m) => "รอบ " + m[1] + " เสร็จ +" + m[2] + " · รวม " + m[3] + "/" + m[4]],
    [/(\d+)\/(\d+)\s+guests already prefetched/i, (m) => "เตรียมเพื่อนไว้แล้ว " + m[1] + "/" + m[2]],
    [/prefetch dry\s*\((\d+)\/(\d+)\)/i, (m) => "เพื่อนไม่พอ (" + m[1] + "/" + m[2] + ") — เติมเพิ่ม"],
    [/heart:\s*no guests available/i, () => "รอบนี้ไม่มีเพื่อนให้ส่ง"],
    [/heart:\s*2 zero sessions/i, () => "ไม่ได้หัวใจ 2 รอบติด — หยุด"],
    [/collected\s+(\d+)\/(\d+)\s+hearts/i, (m) => "เก็บหัวใจได้ " + m[1] + " จาก " + m[2]],
    [/claim:\s*collected\s+(\d+)\/(\d+)/i, (m) => "รับหัวใจได้ " + m[1] + " จาก " + m[2]],
    [/claim:\s*collected\s+(\d+)/i, (m) => "รับหัวใจได้ " + m[1]],
    [/hearts collected/i, () => "เก็บหัวใจแล้ว"],
    // Powder farm
    [/powder:\s*login/i, () => "เข้าสู่ระบบเพื่อฟาร์มผง"],
    [/\[(\d+)\/(\d+)\]\s+BUY\s+(.+?)\s+code=/i, (m) => "ซื้อสมบัติ " + m[1] + "/" + m[2] + " — " + m[3].trim()],
    [/\bBREAK\s+OK\s+powder\+(\d+)/i, (m) => "ย่อยได้ผง +" + m[1]],
    [/\[SKIP BREAK\]/i, () => "ข้ามการย่อย — ไม่พบ uuid"],
    [/\bBUY\b.*\bERR\b/i, () => "ซื้อสมบัติไม่สำเร็จ"],
    [/\bBREAK\b.*\bERR\b/i, () => "ย่อยสมบัติไม่สำเร็จ"],
    [/reroll guest\s*\[(\d+)\/(\d+)\]/i, (m) => "รีโรลไอดีใหม่ " + m[1] + "/" + m[2]],
    [/reroll\s*\[(\d+)\/(\d+)\]\s+(.+)/i, (m) => "รีโรลบัญชี " + m[1] + "/" + m[2] + " — " + m[3].trim()],
    [/reroll\s*\[(\d+)\/(\d+)\]/i, (m) => "รีโรลบัญชี " + m[1] + "/" + m[2]],
    [/\[TARGET\]\s*pet\s+(.+?)\s+—\s+stop hatch/i, (m) => "เจอเพ็ตเป้าหมาย " + m[1].trim() + " — หยุดฟัก"],
    [/reroll fail\s+(.+)/i, (m) => "รีโรลไม่สำเร็จ: " + m[1].trim()],
    [/quest:\s*claimed\s+(\d+)\/(\d+)/i, (m) => "รับรางวัลเควสแล้ว " + m[1] + "/" + m[2]],
    [/quest:\s*logging in/i, () => "กำลังเข้าสู่ระบบเพื่อรับเควส"],
    [/quest:\s*auto-selected\s+(\d+)/i, (m) => "เลือกเควสที่รับได้ " + m[1] + " รายการ"],
    [/cookie_unlock:\s*login/i, () => "กำลังเข้าสู่ระบบเพื่อปลดล็อกคุกกี้"],
    [/cookie-unlock batch:\s*item\s+(\d+)\/(\d+)\s+—\s+prepare/i, (m) => "เตรียมปลดล็อกคุกกี้ 0/" + m[2]],
    [/cookie-unlock batch:\s*item\s+(\d+)\/(\d+)\s+—\s+(.+)/i, (m) => "ปลดล็อกตัวที่ " + m[1] + "/" + m[2] + " — " + m[3].trim()],
    [/cookie-unlock:\s*start\s+(.+?)(?:\s+\(|$)/i, (m) => "เริ่มปลดล็อก " + m[1].trim()],
    [/cookie-unlock:\s*done\s+(.+)/i, (m) => "ปลดล็อก " + m[1].trim() + " สำเร็จ"],
    [/cookie-unlock:\s*skip\s+(.+?)\s+—\s+already owned/i, (m) => "ข้าม " + m[1].trim() + " — มีอยู่แล้ว"],
    [/cookie-unlock:\s*skip\s+(.+?)\s+—\s+coin\s+/i, (m) => "ข้าม " + m[1].trim() + " — เหรียญไม่พอ"],
    [/cookie-unlock:\s*pre-buy\s+(.+?)\s+×\s+(\d+)/i, (m) => "ซื้อล่วงหน้า " + m[1].trim() + " × " + m[2]],
    [/cookie-unlock:\s*pre-buy\s+(\d+)\/(\d+)\s+OK/i, (m) => "ซื้อล่วงหน้า " + m[1] + "/" + m[2] + " สำเร็จ"],
    [/cookie-unlock:\s*pre-buy failed/i, () => "ซื้อล่วงหน้าไม่สำเร็จ"],
    [/cookie-unlock:\s*(.+?)\s+\[(.+?)\]\s+\((.+)\)/i, (m) => m[1].trim() + " [" + m[2] + "] (" + m[3] + ")"],
    [/cookie-unlock:\s*(.+?)\s+OK$/i, (m) => m[1].trim() + " สำเร็จ"],
    [/cookie-unlock:\s*(.+?)\s+failed/i, (m) => m[1].trim() + " ไม่สำเร็จ"],
    [/cookie-unlock:\s*refresh inventory/i, () => "กำลังโหลดรายการคุกกี้"],
    [/cookie-unlock:\s*re-init failed/i, () => "รีเฟรชบัญชีไม่สำเร็จ"],
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
      showFarmDock();
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
    } else if (/feature_locked/i.test(raw)) {
      clearPendingFarmJobs();
      forceCloseRunStatusPopup();
      showErrorModal(ERR_TH.feature_locked, "ปิดปรับปรุง");
      setFarmStatus(ERR_TH.feature_locked, "err");
      paintFeatureLocks();
    } else if (/maintenance/i.test(raw)) {
      clearPendingFarmJobs();
      forceCloseRunStatusPopup();
      showErrorModal(ERR_TH.maintenance, "ปิดปรับปรุง");
      setFarmStatus( ERR_TH.maintenance, "err");
    } else if (e.status === 401 || /devplay_session_expired|login_failed/i.test(raw)) {
      devplayConnectionState = "expired";
      showFarmDock();
      renderFarmDock({
        mode,
        ok: false,
        errorMsg: "ล้มเหลวก่อนเริ่ม · กำลังเชื่อม DevPlay ใหม่",
      });
      setFarmStatus("กำลังเชื่อม DevPlay ใหม่อัตโนมัติ…", "muted");
      recoverDevPlaySession().then((ok) => {
        if (ok) {
          setFarmStatus("เชื่อมใหม่แล้ว — กดรันซ้ำได้ทันที", "ok");
          return;
        }
        showErrorModal(
          /login_failed/i.test(raw) ? ERR_TH.login_failed : ERR_TH.devplay_session_expired,
          mode === "heart" ? "เข้าสู่ระบบเกมไม่สำเร็จ" : "เชื่อมใหม่"
        );
        setFarmStatus(thError(raw), "err");
      });
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
      showFarmDock();
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
    if (!requireFeatureAccess("partyrun")) return;
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
    if (!requireFeatureAccess("powder")) return;
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
      return;
    }
    paintPowderPlan(powderPlan);
    if (!powderPlan?.can_run) {
      showErrorModal(ERR_TH.insufficient_coin, "เหรียญไม่พอ");
      return;
    }

    const rounds = clampPowderRounds(Number(powderPlan?.rounds) || powderRounds || 1);
    const stuffSeq = Math.max(1, Number($("powder-stuff-seq")?.value) || 811);
    const price = Math.max(0, Number($("powder-price")?.value) || 5000);
    const powderQty = Math.max(1, Number($("powder-qty")?.value) || POWDER_BREAK_FALLBACK);
    const doBreak = !!$("powder-do-break")?.checked;
    const estGain =
      Number(powderPlan?.powder_gain) || rounds * powderYieldPerRound();
    setFarmStatus(
      "กำลังฟาร์มผง " +
        formatNumTh(rounds) +
        " กล่อง (≈" +
        formatNumTh(estGain) +
        " ผง) …",
      "muted"
    );

    const body = {
      devplay_session_id: devplaySession.id,
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
          : "ฟาร์มผง · " + formatNumTh(rounds) + " กล่อง",
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
                treasure:
                  powderStuffLabel ||
                  ("กล่อง seq " + (Number($("powder-stuff-seq")?.value) || 811)),
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
    if (!requireFeatureAccess("giftdraw")) return;
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
      icon: "assets/Heart.png",
      locked: false,
    });
    $("modal-body")?.classList.add("result-stagger");
    spawnPixelConfetti();
    modalActions.appendChild(makeBtn("ตกลง", "btn-candy", () => forceCloseModal()));
  }

  async function runUpgrade() {
    const items = getSelectedUpgradeItems().slice(0, UPGRADE_MAX_SELECT);
    if (!items.length) {
      showErrorModal("เลือกสมบัติที่จะตีบวกก่อน", "ยังไม่ได้เลือก");
      return;
    }
    if (items.length > UPGRADE_MAX_SELECT) {
      showErrorModal(
        "เลือกได้สูงสุด " + formatNumTh(UPGRADE_MAX_SELECT) + " ชิ้นต่อรัน",
        "เกินจำนวนที่อนุญาต"
      );
      return;
    }
    if (!requireFeatureAccess("upgrade")) return;
    if (!isDevPlayConnected()) {
      showErrorModal(ERR_TH.devplay_session_expired, "เชื่อม DevPlay ก่อน");
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
            paintUpgradeSelectedSummary();
          },
          onError: (data) => {
            const result = data.result || data;
            const msg = farmErrorMessage(result, "ตีบวกไม่สำเร็จ (แห้วหรือ coin ไม่พอ)");
            setFarmStatus(msg, "err");
            loadUpgradeTreasures(true).catch(() => {});
            loadFarmHistory().catch(() => {});
            paintUpgradeSelectedSummary();
          },
        },
      });
    } catch (e) {
      handleFarmRunException(e, "upgrade");
      paintUpgradeSelectedSummary();
    }
  }

  async function runHeart() {
    if (!requireFeatureAccess("heart")) return;
    if (!hasDevPlayCreds()) {
      showErrorModal("กรอกอีเมลและรหัสผ่านบัญชีเกมให้ครบ", "ข้อมูลไม่ครบ");
      return;
    }
    if (!hasUsableHeartProxy()) {
      showErrorModal(ERR_TH.heart_proxy_not_configured, "Proxy ร้านยังไม่พร้อม");
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
          email: getDevPlayCreds().email,
          password: getDevPlayCreds().password,
          target_hearts: target,
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
                account: devplaySession?.nickname || getDevPlayCreds().email || "—",
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
            else if (/guest_creation_failed/i.test(code)) msg = ERR_TH.guest_creation_failed;
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
    // API status chip is for in-app only — never gate the login form.
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
      if (jobStatusTab === "admin" && adminJobsTab === "live") {
        loadAdminJobs({ reset: true, silent: true }).catch(() => {});
      }
      pingApiHealth(1).catch(() => {});
    });

    const { data } = await sb.auth.getSession();
    if (!data?.session) {
      showLogin();
      loadAutoLoginCreds()
        .then((creds) => {
          if (creds?.username && $("login-user") && !$("login-user").value) {
            $("login-user").value = creds.username;
          }
        })
        .catch(() => {});
      tryAutoLogin().catch(() => {});
      return;
    }
    accessToken = data.session.access_token;
    try {
      await refreshMe();
      loadFarmHistory().catch(() => {});
      pingApiHealth(1).catch(() => {});
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
      tryAutoLogin().catch(() => {});
    }
  }

  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const remember = !!$("remember-me")?.checked;
    setRememberPref(remember);
    setStatus($("login-status"), "กำลังเข้าสู่ระบบ…", "muted");
    const username = $("login-user").value.trim();
    const password = $("login-pass").value;
    await performLogin(username, password, false);
  });

  function setAuthMode(mode) {
    const m = mode === "signup" ? "signup" : "login";
    $("login-mode")?.classList.toggle("hidden", m !== "login");
    $("signup-mode")?.classList.toggle("hidden", m !== "signup");
    $("tab-login")?.classList.toggle("is-active", m === "login");
    $("tab-signup")?.classList.toggle("is-active", m === "signup");
    $("tab-login")?.setAttribute("aria-selected", String(m === "login"));
    $("tab-signup")?.setAttribute("aria-selected", String(m === "signup"));
    setStatus($("login-status"), "", "muted");
    setStatus($("signup-status"), "", "muted");
  }

  function bindPasswordToggles(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-password-toggle]").forEach((btn) => {
      if (btn.dataset.boundToggle === "1") return;
      btn.dataset.boundToggle = "1";
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-password-toggle");
        const input = id ? $(id) : null;
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "ซ่อน" : "แสดง";
        btn.setAttribute("aria-pressed", show ? "true" : "false");
        btn.setAttribute("aria-label", show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
        btn.title = show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน";
      });
    });
  }

  function openChangePasswordModal() {
    const modal = $("change-password-modal");
    if (!modal) return;
    const username = String(profile?.username || $("login-user")?.value || "").trim();
    if ($("reset-user")) $("reset-user").value = username;
    if ($("reset-old")) $("reset-old").value = "";
    if ($("reset-new")) $("reset-new").value = "";
    if ($("reset-new2")) $("reset-new2").value = "";
    setStatus($("reset-status"), "", "muted");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    bindPasswordToggles(modal);
    $("reset-old")?.focus();
  }

  function closeChangePasswordModal() {
    const modal = $("change-password-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    setStatus($("reset-status"), "", "muted");
  }

  $("tab-login")?.addEventListener("click", () => setAuthMode("login"));
  $("tab-signup")?.addEventListener("click", () => setAuthMode("signup"));
  bindPasswordToggles(document);

  $("reset-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const username = String(
      ($("reset-user")?.value || "").trim() || profile?.username || ""
    ).trim();
    const oldPassword = $("reset-old")?.value || "";
    const newPassword = $("reset-new")?.value || "";
    const confirmPassword = $("reset-new2")?.value || "";
    if (!username) {
      setStatus($("reset-status"), "ไม่พบชื่อผู้ใช้ในเซสชัน", "err");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus($("reset-status"), ERR_TH.password_mismatch, "err");
      $("reset-new2")?.focus();
      return;
    }
    if (newPassword.length < 6) {
      setStatus($("reset-status"), "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร", "err");
      return;
    }
    if (newPassword === oldPassword) {
      setStatus($("reset-status"), ERR_TH.password_unchanged, "err");
      return;
    }
    authBusy = true;
    setBtnLoading($("reset-btn"), true);
    setStatus($("reset-status"), "กำลังบันทึกรหัสผ่านใหม่…", "muted");
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: {
          username,
          old_password: oldPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        },
      });
      if ($("login-user")) $("login-user").value = username;
      if ($("login-pass")) $("login-pass").value = "";
      if ($("reset-old")) $("reset-old").value = "";
      if ($("reset-new")) $("reset-new").value = "";
      if ($("reset-new2")) $("reset-new2").value = "";
      if (wantsRemember()) await saveAutoLoginCreds(username, newPassword);
      setStatus($("reset-status"), "", "muted");
      showToast(ERR_TH.password_changed, "ok");
      closeChangePasswordModal();
    } catch (e) {
      const msg = thError(e.message) || e.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ";
      setStatus($("reset-status"), msg, "err");
      showErrorModal(msg, "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      authBusy = false;
      setBtnLoading($("reset-btn"), false);
    }
  });

  $("change-password-btn-menu")?.addEventListener("click", () => {
    openChangePasswordModal();
  });
  document.querySelectorAll("[data-change-password-close]").forEach((el) => {
    el.addEventListener("click", () => closeChangePasswordModal());
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const modal = $("change-password-modal");
    if (modal && !modal.classList.contains("hidden")) closeChangePasswordModal();
  });

  $("signup-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (lastHealth && lastHealth.signup_closed) {
      applySignupClosed(true);
      return;
    }
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
      if (wantsRemember()) await saveAutoLoginCreds(username, password);
      else clearAutoLoginCreds();
      setStatus($("signup-status"), "", "muted");
      setupDevPlayAutofillGuards();
      await refreshMe();
      paintDevPlayAccountPicker();
      pingApiHealth(1).catch(() => {});
    } catch (e) {
      const raw = String(e.message || "");
      let title = "สมัครสมาชิกไม่สำเร็จ";
      if (raw.includes("username_taken")) title = "ชื่อผู้ใช้ซ้ำ";
      else if (raw.includes("signup_closed")) title = "ปิดรับสมัครผ่านเว็บ";
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
    earlyAccessFeatures = new Set();
    clearSessionToken();
    autoLoginAttempted = false;
    if (!wantsRemember()) clearAutoLoginCreds();
    devplayVaultEntries = [];
    try {
      resetDevPlaySession();
    } catch (_) {
      devplaySession = null;
    }
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
  $("api-status-menu")?.addEventListener("click", () => {
    toggleApiStatusDetail();
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
  $("menu-nav-invite")?.addEventListener("click", () => {
    closeNavDrawer();
    openInviteFriendTab();
  });
  $("menu-nav-afterplay_fast")?.addEventListener("click", () => {
    closeNavDrawer();
    onFarmTabClick(AFTERPLAY_FAST_TAB);
  });
  $("menu-nav-unlock_l")?.addEventListener("click", () => {
    closeNavDrawer();
    onFarmTabClick(UNLOCK_L_TAB);
  });
  $("menu-nav-history")?.addEventListener("click", () => {
    closeNavDrawer();
    showFarmHistoryModal().catch(() => {});
  });

  document.querySelectorAll("[data-invite-credit-close]").forEach((el) => {
    el.addEventListener("click", () => closeInviteCreditModal());
  });
  document.querySelectorAll("[data-invite-log-close]").forEach((el) => {
    el.addEventListener("click", () => closeInviteLogModal());
  });
  $("invite-log-open-btn")?.addEventListener("click", () => openInviteLogModal());
  $("invite-cancel-btn")?.addEventListener("click", () => {
    cancelInviteJob().catch(() => {});
  });
  $("invite-copy-coin-btn")?.addEventListener("click", () => {
    copyInviteCoinAmount().catch(() => {});
  });
  $("invite-credit-open-btn")?.addEventListener("click", () => openInviteCreditModal());
  $("invite-credit-custom-apply")?.addEventListener("click", () => {
    applyInviteCustomAmount($("invite-credit-custom-amount")?.value, { copy: true });
  });
  $("invite-credit-custom-amount")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      applyInviteCustomAmount($("invite-credit-custom-amount")?.value, { copy: true });
    }
  });
  $("invite-credit-custom-amount")?.addEventListener("change", () => {
    const raw = $("invite-credit-custom-amount")?.value;
    if (String(raw || "").trim()) applyInviteCustomAmount(raw);
  });
  $("invite-refresh-btn")?.addEventListener("click", () => {
    if (inviteRunning) {
      setStatus($("invite-status"), "รอให้งานเชิญเพื่อนเสร็จก่อน", "err");
      return;
    }
    refreshInviteStatus().catch(() => {});
  });
  $("invite-credit-redeem-btn")?.addEventListener("click", () => {
    redeemInviteCredit().catch(() => {});
  });
  $("invite-start-btn")?.addEventListener("click", () => {
    startInviteJob().catch(() => {});
  });
  $("farm-tab-afterplay_fast")?.addEventListener("click", () => onFarmTabClick(AFTERPLAY_FAST_TAB));
  $("farm-tab-unlock_l")?.addEventListener("click", () => onFarmTabClick(UNLOCK_L_TAB));
  $("afterplay-credit-open-btn")?.addEventListener("click", () => openInviteCreditModal());
  $("unlockl-credit-open-btn")?.addEventListener("click", () => openInviteCreditModal());
  document.querySelectorAll("[data-afterplay-goal]").forEach((card) => {
    card.addEventListener("click", (ev) => {
      if (ev.target?.closest?.("input")) return;
      setAfterplayGoal(card.getAttribute("data-afterplay-goal"));
    });
    card.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      if (ev.target?.closest?.("input")) return;
      ev.preventDefault();
      setAfterplayGoal(card.getAttribute("data-afterplay-goal"));
    });
  });
  $("afterplay-start-btn")?.addEventListener("click", () => {
    startAfterplayJob().catch(() => {});
  });
  $("afterplay-cancel-btn")?.addEventListener("click", () => {
    cancelAfterplayJob().catch(() => {});
  });
  $("afterplay-log-open-btn")?.addEventListener("click", () => {
    openCreditLogModal(afterplayLogLines, "Log ฟาร์มเงิน/XP");
  });
  $("afterplay-target-level")?.addEventListener("input", () => scheduleAfterplayPreview("level"));
  $("afterplay-target-level")?.addEventListener("change", () => scheduleAfterplayPreview("level"));
  $("afterplay-target-coin")?.addEventListener("input", () => scheduleAfterplayPreview("coin"));
  $("afterplay-target-coin")?.addEventListener("change", () => scheduleAfterplayPreview("coin"));
  $("afterplay-box-max")?.addEventListener("input", () => {
    if ($("afterplay-box-max")) $("afterplay-box-max").dataset.touched = "1";
    scheduleAfterplayPreview("box");
  });
  $("afterplay-ebox-runs")?.addEventListener("input", () => {
    if ($("afterplay-ebox-runs")) $("afterplay-ebox-runs").dataset.touched = "1";
    scheduleAfterplayPreview("ebox");
  });
  $("afterplay-ebox-runs")?.addEventListener("change", () => scheduleAfterplayPreview("ebox"));
  document.querySelectorAll("[data-farm-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAfterplayFarmMode(btn.getAttribute("data-farm-mode"));
    });
  });
  try {
    const savedMode = localStorage.getItem(AFTERPLAY_MODE_KEY);
    if (savedMode === "episode_box" || savedMode === "money_xp") afterplayFarmMode = savedMode;
  } catch (_) {}
  paintAfterplayModeUi();
  paintAfterplayEboxGrid();
  $("unlockl-refresh-btn")?.addEventListener("click", () => {
    refreshUnlockLCatalog({ force: true }).catch(() => {});
  });
  $("unlockl-select-all-btn")?.addEventListener("click", () => selectAllUnlockL());
  $("unlockl-start-btn")?.addEventListener("click", () => {
    startUnlockLJob().catch(() => {});
  });
  $("unlockl-cancel-btn")?.addEventListener("click", () => {
    cancelUnlockLJob().catch(() => {});
  });
  $("unlockl-log-open-btn")?.addEventListener("click", () => {
    openCreditLogModal(unlockLLogLines, "Log ปลดล็อค L");
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
    if (!$("job-log-modal")?.classList.contains("hidden")) {
      closeJobLogModal();
      return;
    }
    if (!$("invite-log-modal")?.classList.contains("hidden")) {
      closeInviteLogModal();
      return;
    }
    if (!$("invite-credit-modal")?.classList.contains("hidden")) {
      closeInviteCreditModal();
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
    const pkg = getSelectedTopupPackage();
    const btn = $("topup-verify-btn");
    if (btn) btn.disabled = true;
    setStatus($("topup-status"), "กำลังตรวจซอง…", "muted");
    try {
      await ensureApiReady();
      const body = {
        voucher,
        package_id: pkg?.id || selectedTopupPackageId,
      };
      if (pkg?.kind !== "feature" && packageDays(pkg)) {
        body.package_days = packageDays(pkg);
        body.package_tokens = packageDays(pkg);
      }
      const data = await api("/api/topup/verify", {
        method: "POST",
        body,
      });
      if (data.package_id) {
        selectedTopupPackageId = data.package_id;
        if (data.package_days) selectedTopupTokens = Number(data.package_days);
        renderTopupPackages();
      }
      const packLabel =
        data.package_kind === "feature" || data.pick_feature
          ? (data.hours || 12) + " ชม. · 1 ฟังก์ชัน"
          : (data.package_days || data.package_tokens || "") + " วัน";
      setStatus(
        $("topup-status"),
        "ซองผ่าน · ยอด " + formatNumTh(data.amount_baht) + " coin ตรงแพ็ก " + packLabel,
        "ok"
      );
    } catch (e) {
      if (/session_replaced/i.test(String(e.message || ""))) return;
      const inviteDetail = inviteDetailFromError(e);
      if (inviteDetail) {
        routeInviteCreditVoucher(voucher, inviteDetail);
        return;
      }
      const msg =
        e.userMessage ||
        thError(e.code || e.message) ||
        "ตรวจซองไม่สำเร็จ";
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

    const pkg = getSelectedTopupPackage();
    topupBusy = true;
    const btn = $("topup-btn");
    if (btn) btn.disabled = true;
    setStatus($("topup-status"), "กำลังตรวจสอบและรับซอง…", "muted");
    try {
      await ensureApiReady();
      const body = {
        voucher,
        package_id: pkg?.id || selectedTopupPackageId,
      };
      if (pkg?.kind !== "feature" && packageDays(pkg)) {
        body.package_days = packageDays(pkg);
        body.package_tokens = packageDays(pkg);
      }
      const data = await api("/api/topup/redeem", {
        method: "POST",
        body,
      });
      applyProfileRental(data);
      if ($("topup-voucher")) $("topup-voucher").value = "";
      if (modalMode === "empty") forceCloseModal();
      flashTopupDoor();

      if (data.needs_feature_pick) {
        if (profile) {
          profile.pending_feature_pick = {
            redemption_id: data.redemption_id,
            package_id: data.package_id,
            hours: data.hours || 12,
            amount_baht: data.amount_baht,
            features: data.features,
            feature_labels: data.feature_labels,
          };
        }
        setStatus($("topup-status"), "รับซองสำเร็จ — เลือกฟังก์ชัน", "ok");
        closeVaultModal();
        showFeaturePickModal({
          redemption_id: data.redemption_id,
          hours: data.hours || 12,
          amount_baht: data.amount_baht,
          features: data.features,
          feature_labels: data.feature_labels,
        });
        return;
      }

      try {
        await refreshMe();
      } catch (_) {}
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
      const detail = e?.data?.detail;
      const inviteDetail = inviteDetailFromError(e);
      if (inviteDetail) {
        routeInviteCreditVoucher(voucher, inviteDetail);
        return;
      }
      if (
        detail?.code === "feature_pick_pending" ||
        /feature_pick_pending/i.test(String(e.message || e.code || ""))
      ) {
        const rid = detail?.redemption_id;
        if (rid) {
          showFeaturePickModal({
            redemption_id: rid,
            hours: 12,
            amount_baht: 50,
          });
          setStatus($("topup-status"), "เลือกฟังก์ชันจากแพ็ก 50 coin ก่อน", "err");
          return;
        }
      }
      const msg =
        e.userMessage ||
        thError(e.code || e.message) ||
        "ต่ออายุเช่าไม่สำเร็จ";
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

  $("devplay-account-picker-list")?.addEventListener("click", (ev) => {
    const removeBtn = ev.target.closest("[data-vault-remove]");
    if (removeBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      removeDevPlayVaultEntry(removeBtn.dataset.vaultRemove).catch(() => {});
      return;
    }
    const card = ev.target.closest("[data-vault-email]");
    if (!card || devplayConnecting || farmRunning) return;
    const email = card.dataset.vaultEmail;
    const entry = devplayVaultEntries.find(
      (e) => String(e.email || "").trim().toLowerCase() === String(email || "").trim().toLowerCase()
    );
    if (!entry) return;
    connectDevPlay({ email: entry.email, password: entry.password });
  });

  $("devplay-new-account-link")?.addEventListener("click", () => {
    const mail = $("dp-acct-mail");
    const secret = $("dp-acct-secret");
    mail?.removeAttribute("readonly");
    secret?.removeAttribute("readonly");
    mail?.focus();
    $("devplay-creds-section")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  $("devplay-refresh-btn")?.addEventListener("click", () => {
    refreshDevPlayAccount();
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

  ["powder-stuff-seq", "powder-price", "powder-qty", "powder-do-break"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if (id === "powder-stuff-seq") schedulePowderStuffLookup();
      refreshPowderEstimate().catch(() => {});
    });
    $(id)?.addEventListener("change", () => {
      if (id === "powder-stuff-seq") lookupPowderStuffSeq().catch(() => {});
      refreshPowderEstimate().catch(() => {});
    });
  });
  $("powder-stuff-search-btn")?.addEventListener("click", () => {
    showPowderStuffSearchModal();
  });

  $("feature-dock-grid")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-shortcut-tab]");
    if (!btn) return;
    onFarmTabClick(btn.dataset.shortcutTab);
  });

  function onFarmTabClick(tab) {
    if (tab === INVITE_TAB) {
      openInviteFriendTab();
      return;
    }
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
  document.querySelectorAll("[data-quest-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-quest-filter") || "all";
      if (next === questFilter) return;
      questFilter = next;
      paintQuestList();
    });
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

  $("upgrade-pick-btn")?.addEventListener("click", () => {
    showUpgradePickerModal();
  });

  $("powder-target-powder-minus")?.addEventListener("click", () => bumpPowderTarget(-1));
  $("powder-target-powder-plus")?.addEventListener("click", () => bumpPowderTarget(1));
  $("powder-target-coin-minus")?.addEventListener("click", () => bumpPowderCoinBudget(-1));
  $("powder-target-coin-plus")?.addEventListener("click", () => bumpPowderCoinBudget(1));

  ["powder-target-powder", "powder-target-coin"].forEach((id) => {
    $(id)?.addEventListener("focus", () => {
      powderEditLock = id === "powder-target-powder" ? "powder" : "coin";
    });
    $(id)?.addEventListener("input", (ev) => {
      const el = ev.target;
      const cleaned = String(el.value || "").replace(/[^\d]/g, "");
      if (el.value !== cleaned) el.value = cleaned;
      powderEditLock = id === "powder-target-powder" ? "powder" : "coin";
      schedulePowderRefresh();
    });
  });

  const commitPowderField = (id) => {
    if (id === "powder-target-powder") commitPowderTargetPowderFromInput();
    else commitPowderTargetCoinFromInput();
  };

  ["powder-target-powder", "powder-target-coin"].forEach((id) => {
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
        showErrorModal(ERR_TH.heart_proxy_not_configured, "Proxy ร้านยังไม่พร้อม");
        return;
      }
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
      const cookiePick = cookieItems.filter(
        (c) =>
          cookieSelected.has(String(c.seq)) &&
          (cookieItemSelectable(c, "unlock_only") || cookieItemSelectable(c, "upgrade_full"))
      );
      if (!cookiePick.length) {
        showErrorModal("เลือกคุกกี้ที่ปลดล็อกหรืออัปเกรดได้ก่อน", "ยังไม่ได้เลือก");
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
      await runCookieUnlock(cookieConfirmed);
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
      if (!powderPlan?.can_run) {
        showErrorModal(ERR_TH.insufficient_coin, "เหรียญไม่พอ");
        return;
      }
      if (powderEditLock === "coin") commitPowderTargetCoinFromInput();
      else commitPowderTargetPowderFromInput();
      const askRounds = clampPowderRounds(Number(powderPlan?.rounds) || powderRounds || 1);
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

  $("live-status-close")?.addEventListener("click", () => {
    closeRunStatusPopup();
  });
  $("live-status-done")?.addEventListener("click", () => {
    closeRunStatusPopup();
  });
  $("live-status-cancel")?.addEventListener("click", () => {
    cancelLiveFarmJob().catch(() => {});
  });
  $("job-log-open-btn")?.addEventListener("click", () => openJobLogModal());
  document.querySelectorAll("[data-job-log-close]").forEach((el) => {
    el.addEventListener("click", () => closeJobLogModal());
  });
  $("live-status-log-toggle")?.addEventListener("click", () => {
    liveStatusLogOpen = !liveStatusLogOpen;
    renderFarmDock({ immediate: true });
  });
  $("job-status-backdrop")?.addEventListener("click", () => {
    if (dockPhase === "running" || dockPhase === "queued") {
      minimizeJobStatus();
      return;
    }
    if (hasActiveJobStatus()) minimizeJobStatus();
    else hideJobStatusShell();
  });
  $("job-status-mini")?.addEventListener("click", () => {
    expandJobStatus();
  });
  $("job-status-minimize")?.addEventListener("click", () => {
    minimizeJobStatus();
  });
  $("farm-history-open")?.addEventListener("click", () => {
    openJobStatusHistory();
  });
  document.querySelectorAll("[data-job-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-job-tab") || "live";
      if (tab === "admin" && !isAdminUser()) return;
      setJobStatusTab(tab);
    });
  });

  function onDockListClick(ev) {
    const logToggle = ev.target?.closest?.("[data-dock-log-toggle]");
    if (logToggle) {
      ev.preventDefault();
      ev.stopPropagation();
      dockLiveLogOpen = !dockLiveLogOpen;
      renderFarmDock();
      return;
    }
    const pendingBtn = ev.target?.closest?.("[data-cancel-pending]");
    if (pendingBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = pendingBtn.getAttribute("data-cancel-pending");
      if (id) cancelPendingFarmJob(id);
      return;
    }
    const jobBtn = ev.target?.closest?.("[data-cancel-job]");
    if (jobBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      cancelLiveFarmJob().catch(() => {});
      return;
    }
    const adminBtn = ev.target?.closest?.("[data-admin-cancel]");
    if (adminBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = adminBtn.getAttribute("data-admin-cancel");
      if (id) {
        adminCancelJob(id).catch((e) =>
          showErrorModal(thError(e.message) || "ยกเลิกไม่สำเร็จ", "Admin")
        );
      }
      return;
    }
    const adminLogBtn = ev.target?.closest?.("[data-admin-log]");
    if (adminLogBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = adminLogBtn.getAttribute("data-admin-log");
      if (id) openAdminJobLog(id).catch((e) =>
        showErrorModal(thError(e.message) || "โหลด log ไม่สำเร็จ", "Admin")
      );
    }
  }

  $("farm-dock-list")?.addEventListener("click", onDockListClick);
  $("farm-dock-admin-list")?.addEventListener("click", onDockListClick);

  $("farm-dock-cancel-all")?.addEventListener("click", () => {
    cancelAllMyFarmWork().catch((e) =>
      showErrorModal(thError(e.message) || "ยกเลิกไม่สำเร็จ", "ยกเลิกทั้งหมด")
    );
  });

  $("farm-dock-leave-queue")?.addEventListener("click", () => {
    leaveServerQueue().catch(() => {});
  });

  $("farm-dock-admin-clear")?.addEventListener("click", () => {
    adminClearQueueAll().catch((e) =>
      showErrorModal(thError(e.message) || "ล้างคิวไม่สำเร็จ", "Admin")
    );
  });

  $("farm-dock-admin-heart-max-save")?.addEventListener("click", () => {
    saveAdminHeartMaxSetting().catch((e) =>
      showErrorModal(thError(e.message) || "บันทึกไม่สำเร็จ", "Admin")
    );
  });

  $("farm-dock-admin-powder-max-save")?.addEventListener("click", () => {
    saveAdminPowderMaxSetting().catch((e) =>
      showErrorModal(thError(e.message) || "บันทึกไม่สำเร็จ", "Admin")
    );
  });

  $("farm-dock-admin-more")?.addEventListener("click", () => {
    loadAdminJobs({ reset: false }).catch(() => {});
  });

  document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminJobsTab = btn.getAttribute("data-admin-tab") === "history" ? "history" : "live";
      adminJobsFilter = "all";
      loadAdminJobs({ reset: true })
        .catch(() => {})
        .finally(() => renderFarmDock());
    });
  });

  document.querySelectorAll("[data-admin-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminJobsFilter = btn.getAttribute("data-admin-filter") || "all";
      renderAdminJobsList();
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
    if (!$("job-log-modal")?.classList.contains("hidden")) {
      closeJobLogModal();
      return;
    }
    if (jobStatusView === "expanded") {
      if (dockPhase !== "running" && dockPhase !== "queued") {
        closeRunStatusPopup();
      } else {
        minimizeJobStatus();
      }
      return;
    }
    if (jobStatusView === "minimized") {
      minimizeJobStatus();
      return;
    }
    if (modalRoot && !modalRoot.classList.contains("hidden") && !modalRoot.classList.contains("locked")) {
      closeModal();
    }
  });

  paintUpgradeTargetLevel();

  bootstrap();
})();
