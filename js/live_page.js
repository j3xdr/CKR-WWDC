/* Full-page Live monitor: real-time job status straight from the server. */
(function () {
  "use strict";

  var PANES = ["current", "server", "history", "board"];
  var PAGE_SIZE = window.matchMedia && window.matchMedia("(max-width: 640px)").matches ? 10 : 20;
  var RING_C = 2 * Math.PI * 52;
  var KIND_OPTIONS = [
    ["", "ทุกฟังก์ชัน"],
    ["partyrun", "Party Run"],
    ["heart", "ฟาร์มหัวใจ"],
    ["heartloop_timed", "HeartLoop"],
    ["powder", "ฟาร์มผง"],
    ["giftdraw", "เปิดกล่องขวัญ"],
    ["afterplay_fast", "ฟาร์มเงิน / XP / กล่อง"],
    ["unlock_l", "ปลดล็อค L"],
    ["ice_tower", "Ice Tower"],
    ["friend", "เพื่อน"],
    ["quest_claim", "รับ Quest"],
    ["daily_reward", "รับรางวัลรายวัน"],
    ["boost_buy", "ซื้อ Boost"],
    ["treasure_ticket", "เปิดตั๋วสมบัติ"],
    ["ingredient_extract", "สกัดวัตถุดิบ"],
    ["treasure_break", "ย่อยสมบัติ"],
    ["daily_reward_multi", "รับรางวัลรายวัน (หลายบัญชี)"],
    ["mid_heart", "ฟาร์มใจ MID"],
    ["treasure_evo", "EVO สมบัติ"],
    ["invite", "เชิญเพื่อน"],
    ["upgrade", "ตีบวกสมบัติ"],
    ["jelly_upgrade", "อัปเกรด Jelly"],
    ["cookie_unlock", "ปลดล็อก Cookie"],
    ["pet_unlock", "ปลดล็อก Pet"],
    ["heart_free", "ฟาร์มหัวใจ (ฟรี)"],
  ];
  var MODE_OPTIONS = [
    ["", "ทุกโหมด"],
    ["coin", "ฟาร์มเงิน"],
    ["xp", "ฟาร์ม XP"],
    ["box", "กล่อง"],
    ["combined", "Coin/XP/Box"],
  ];
  var STATUS_CHIPS = {
    history: [
      ["", "ทั้งหมด"],
      ["running", "กำลังรัน"],
      ["queued", "รอคิว"],
      ["succeeded", "สำเร็จ"],
      ["failed", "ล้มเหลว"],
      ["cancelled", "ยกเลิก"],
    ],
    board: [
      ["", "ทั้งหมด", "count"],
      ["live", "กำลังทำ", "live"],
      ["succeeded", "สำเร็จ", "succeeded"],
      ["partial", "สำเร็จบางส่วน", "partial"],
      ["failed", "ล้มเหลว", "failed"],
      ["stuck", "ค้าง", "stuck"],
    ],
  };
  var CURRENCY_ICON = {
    coin: "coin_silver.png",
    life: "Heart.png?v=20260817h",
    key: "token.png",
    gem: "crystal.png",
    jelly: "jelly.png",
  };
  var NUM_LABEL = {
    score: "คะแนน",
    coin: "เหรียญ",
    exp: "EXP",
    ticket_count: "ตั๋ว",
    life: "หัวใจ",
    gem: "คริสตัล",
  };

  var ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    filter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16M7 12h10M10 19h4"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    term: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 8 4 4-4 4M12 16h7"/></svg>',
    fn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    mode: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    date: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    worker: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01"/></svg>',
    slot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    run: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-6 5 12 2.5-6h4"/></svg>',
    wait: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  };

  // Standby art: every motion is periodic (rotate 360° / shift one wave period / alternate),
  // so each loop ends exactly where it starts. syncArt() keeps the phase across re-renders.
  var IDLE_ART =
    '<svg class="lv-idle-art" viewBox="0 0 120 120" aria-hidden="true">' +
    '<defs><clipPath id="lv-idle-clip"><circle cx="60" cy="60" r="19"/></clipPath>' +
    '<linearGradient id="lv-idle-tail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7678ed" stop-opacity="0"/><stop offset="1" stop-color="#a5a7ff"/></linearGradient></defs>' +
    '<circle class="lv-idle-track" cx="60" cy="60" r="46"/>' +
    '<g class="lv-idle-orbit"><path class="lv-idle-tail" d="M27.5 27.5 A46 46 0 0 1 60 14"/><circle class="lv-idle-dot" cx="60" cy="14" r="3.6"/></g>' +
    '<circle class="lv-idle-dash" cx="60" cy="60" r="32"/>' +
    '<circle class="lv-idle-core" cx="60" cy="60" r="19"/>' +
    '<g clip-path="url(#lv-idle-clip)"><path class="lv-idle-wave" d="M12 60h8l3-7 4 14 3-7h6h8l3-7 4 14 3-7h6h8l3-7 4 14 3-7h6h8l3-7 4 14 3-7h6"/></g>' +
    "</svg>";
  var LOCK_ART =
    '<svg class="lv-idle-art is-lock" viewBox="0 0 120 120" aria-hidden="true">' +
    '<rect class="lv-lock-body" x="36" y="54" width="48" height="38" rx="9"/>' +
    '<path class="lv-lock-shackle" d="M46 54V42a14 14 0 0 1 28 0v12"/>' +
    '<circle class="lv-lock-dot" cx="60" cy="71" r="4"/>' +
    "</svg>";

  var pane = "current";
  var timer = 0;
  var tickTimer = 0;
  var cancellingId = "";
  var historyDetailId = "";
  var runClock = { jobId: "", base: 0, at: 0 };
  var state = {
    history: { status: "", kind: "", mode: "", from: "", to: "", offset: 0 },
    board: { status: "", kind: "", mode: "", from: "", to: "", offset: 0 },
  };

  function bridge() {
    return window.CKR_LIVE || {};
  }

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function num(value) {
    var n = Number(value);
    if (!isFinite(n)) return String(value == null ? "" : value);
    try {
      return n.toLocaleString("th-TH");
    } catch (e) {
      return String(n);
    }
  }

  function loggedIn() {
    var b = bridge();
    return typeof b.loggedIn === "function" ? !!b.loggedIn() : false;
  }

  function kindLabel(kind, farmMode) {
    var b = bridge();
    if (typeof b.kindLabel === "function") {
      return b.kindLabel(kind, { farm_mode: farmMode || "", family: farmMode || "" });
    }
    return kind || "งาน";
  }

  function kindIcon(kind, farmMode) {
    var b = bridge();
    if (typeof b.kindIcon === "function") {
      return b.kindIcon(kind, { farm_mode: farmMode || "", family: farmMode || "" }) || "";
    }
    return "";
  }

  function iconSrc(file) {
    var b = bridge();
    if (!file) return "";
    if (typeof b.icon === "function") return b.icon(file);
    return file;
  }

  function api(path, options) {
    var b = bridge();
    if (typeof b.api !== "function") return Promise.reject(new Error("live_api_missing"));
    return b.api(path, options || {});
  }

  function kindImg(kind, mode, size) {
    var src = kindIcon(kind, mode);
    var s = size || 32;
    return src
      ? '<img class="lv-kind-img" src="' + esc(src) + '" alt="" width="' + s + '" height="' + s + '" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'lv-kind-img is-blank\'}))" />'
      : '<span class="lv-kind-img is-blank"></span>';
  }

  function toDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtWhen(iso) {
    var d = toDate(iso);
    if (!d) return "—";
    var now = new Date();
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (d.toDateString() === now.toDateString()) return "วันนี้ " + hm;
    var y = new Date(now.getTime() - 864e5);
    if (d.toDateString() === y.toDateString()) return "เมื่อวาน " + hm;
    var date = d.getDate() + "/" + (d.getMonth() + 1);
    if (d.getFullYear() !== now.getFullYear()) date += "/" + String(d.getFullYear() + 543).slice(-2);
    return date + " " + hm;
  }

  function fmtDur(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }

  function fmtSpan(a, b) {
    var s = toDate(a);
    var e = toDate(b);
    if (!s || !e) return "";
    var sec = Math.max(0, Math.round((e - s) / 1000));
    if (sec < 60) return sec + " วิ";
    if (sec < 3600) return Math.round(sec / 60) + " นาที";
    return (sec / 3600).toFixed(1).replace(/\.0$/, "") + " ชม.";
  }

  function progressPct(progress) {
    var current = Number(progress && progress.current) || 0;
    var total = Number(progress && progress.total) || 0;
    if (total <= 0) return -1;
    return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  }

  function miniBar(progress) {
    var n = progressPct(progress);
    var current = Number(progress && progress.current) || 0;
    var total = Number(progress && progress.total) || 0;
    if (n < 0) return '<span class="lv-mini is-indet"><i></i></span>';
    return (
      '<span class="lv-mini" role="progressbar" aria-valuenow="' + n + '" aria-valuemin="0" aria-valuemax="100">' +
      '<i style="width:' + n + '%"></i></span>' +
      '<span class="lv-mini-meta">' + esc(num(current)) + "/" + esc(num(total)) + "</span>"
    );
  }

  // HeartLoop progress → plain Thai ("รอบ 3/24 · เก็บแล้ว 897 ❤️ · รอบถัดไปใน 42 นาที").
  var HL_PHASE = {
    login: "กำลังล็อกอินไอดี",
    start: "กำลังเริ่ม",
    establish: "กำลังตั้งเพื่อนถาวร",
    harvest: "กำลังเก็บหัวใจ",
    cooldown: "พักรอบ",
    teardown: "กำลังลบเพื่อนคลังออก",
  };

  function heartloopText(p, resumeSec) {
    p = p || {};
    var bits = [];
    var phase = String(p.phase || "");
    if (phase === "establish" && p.roster_target) {
      bits.push(HL_PHASE.establish + " " + num(p.roster || 0) + "/" + num(p.roster_target));
    } else if (HL_PHASE[phase]) {
      bits.push(HL_PHASE[phase]);
    }
    if (p.total) bits.push("รอบ " + num(p.current || 0) + "/" + num(p.total));
    if (p.collected) bits.push("เก็บแล้ว " + num(p.collected) + " ❤️");
    var wait = resumeSec != null ? resumeSec : p.next_in_sec;
    if ((phase === "cooldown" || resumeSec != null) && wait != null) {
      bits.push("รอบถัดไปใน " + fmtDur(Math.max(0, Number(wait) || 0)));
    }
    return bits.join(" · ");
  }

  function statusLabel(status, bucket) {
    var map = {
      live: "กำลังทำ",
      running: "กำลังทำงาน",
      queued: "อยู่ในคิว",
      ready: "รอช่องว่าง",
      waiting_owner: "รองานเดิมจบ",
      waiting_account: "รอไอดีว่าง",
      holding: "กำลังเตรียม",
      cooldown: "พักรอบถัดไป",
      succeeded: "สำเร็จ",
      partial: "สำเร็จบางส่วน",
      failed: "ล้มเหลว",
      cancelled: "ยกเลิก",
      stuck: "ค้าง",
      cancelling: "กำลังยกเลิก",
    };
    return map[bucket] || map[status] || status || "—";
  }

  function tone(status, bucket) {
    var key = bucket || status || "";
    if (key === "running" || (key === "live" && status === "running") || key === "cancelling") return "run";
    if (key === "live" || key === "queued" || key === "holding" || key === "ready" || key === "waiting_owner" || key === "waiting_account" || key === "cooldown") return "queue";
    return "done";
  }

  function badge(status, bucket) {
    var key = bucket || status || "idle";
    return '<span class="lv-badge is-' + esc(key) + '"><i></i>' + esc(statusLabel(status, bucket)) + "</span>";
  }

  /* ---------- rewards / numbers ---------- */

  function rewardIcon(key) {
    var raw = String(key || "");
    if (CURRENCY_ICON[raw]) return iconSrc(CURRENCY_ICON[raw]);
    var id = (raw.match(/(\d+)/) || [])[1];
    if (id && window.ckrHostedAsset) return window.ckrHostedAsset("assets/icons/items/" + id + ".png");
    return "";
  }

  function rewardLabel(key) {
    var b = bridge();
    if (typeof b.itemLabel === "function" && String(key).indexOf("item:") === 0) {
      return String(b.itemLabel(key) || key).replace(/^🎁\s*/, "");
    }
    var names = { coin: "เหรียญ", life: "หัวใจ", key: "กุญแจ", gem: "คริสตัล", jelly: "เจลลี่" };
    return names[key] || key;
  }

  function rewardChips(line) {
    var found = [];
    var re = /['"]([^'"]+)['"]\s*:\s*(-?\d+(?:\.\d+)?)/g;
    var match;
    var text = String(line || "");
    while ((match = re.exec(text))) found.push([match[1], match[2]]);
    if (!found.length) {
      var itemRe = /item:(\d+)[^\s'"`,}\]]*/g;
      while ((match = itemRe.exec(text))) found.push(["item:" + match[1], ""]);
    }
    if (!found.length) return "";
    return (
      '<span class="lv-ln-rw">' +
      found
        .slice(0, 4)
        .map(function (pair) {
          var src = rewardIcon(pair[0]);
          var img = src ? '<img src="' + esc(src) + '" alt="" width="14" height="14" onerror="this.remove()" />' : "";
          var qty = pair[1] ? " ×" + esc(num(pair[1])) : "";
          return "<span>" + img + esc(rewardLabel(pair[0])) + qty + "</span>";
        })
        .join("") +
      "</span>"
    );
  }

  function numbersHtml(numbers) {
    var keys = Object.keys(numbers || {}).filter(function (key) {
      var value = numbers[key];
      return value !== undefined && value !== null && value !== "" && Number(value) !== 0;
    });
    if (!keys.length) return '<span class="lv-dim">—</span>';
    var order = ["score", "coin", "exp", "ticket_count"];
    keys.sort(function (a, b) {
      var ia = order.indexOf(a);
      var ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var shown = keys.slice(0, 4);
    return (
      shown
        .map(function (key) {
          var src = CURRENCY_ICON[key] ? iconSrc(CURRENCY_ICON[key]) : "";
          var img = src ? '<img src="' + esc(src) + '" alt="" width="14" height="14" onerror="this.remove()" />' : "";
          return (
            '<span class="lv-num">' + img + '<b>' + esc(num(numbers[key])) + "</b>" +
            esc(NUM_LABEL[key] || key.replace(/_/g, " ")) + "</span>"
          );
        })
        .join("") + (keys.length > shown.length ? '<span class="lv-num is-more">+' + (keys.length - shown.length) + "</span>" : "")
    );
  }

  /* ---------- terminal log ---------- */

  function logLevel(line) {
    var text = String(line || "");
    if (/error|fail|exception|traceback|ยกเลิก|ล้มเหลว/i.test(text)) return "err";
    if (/warn|retry|timeout|ลองใหม่|รอ /i.test(text)) return "warn";
    if (/\bok\b|success|done|สำเร็จ|เสร็จ/i.test(text)) return "ok";
    return "info";
  }

  var LEVEL_TAG = { err: "ERR", warn: "WRN", ok: " OK", info: "INF" };

  function splitTime(line) {
    var text = String(line || "");
    var m = text.match(/^\s*\[?(\d{2}:\d{2}:\d{2})\]?\s*/);
    if (m) return [m[1], text.slice(m[0].length)];
    var any = text.match(/\b\d{2}:\d{2}:\d{2}\b/);
    return [any ? any[0] : "", text];
  }

  function logMessage(text) {
    var b = bridge();
    if (typeof b.formatReward === "function") {
      var pretty = b.formatReward(text);
      if (pretty) return pretty;
    }
    return text;
  }

  function logLine(line, isNew) {
    var li = document.createElement("li");
    var lv = logLevel(line);
    var parts = splitTime(line);
    var msg = logMessage(parts[1]);
    li.className = "lv-ln is-" + lv + (isNew ? " is-new" : "");
    li.innerHTML =
      '<span class="lv-ln-t">' + esc(parts[0] || "--:--:--") + "</span>" +
      '<span class="lv-ln-lv">' + LEVEL_TAG[lv] + "</span>" +
      '<span class="lv-ln-msg">' + esc(msg) + "</span>" +
      (msg === parts[1] ? rewardChips(line) : "");
    return li;
  }

  function overlapCount(prev, next) {
    var max = Math.min(prev.length, next.length);
    for (var n = max; n > 0; n--) {
      var ok = true;
      for (var i = 0; i < n; i++) {
        if (prev[prev.length - n + i] !== next[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return n;
    }
    return 0;
  }

  function termHtml(id, title, opts) {
    opts = opts || {};
    return (
      '<section class="lv-term' + (opts.cls ? " " + opts.cls : "") + '" id="' + id + '">' +
      '<header class="lv-term-bar">' +
      '<span class="lv-term-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="lv-term-title">' + ICON.term + '<span data-term-title>' + esc(title) + "</span></span>" +
      '<span class="lv-term-tools">' +
      (opts.closable ? '<button type="button" class="lv-icon-btn" data-term-close title="ปิด" aria-label="ปิด">' + ICON.close + "</button>" : "") +
      '<button type="button" class="lv-icon-btn" data-term-copy title="คัดลอก Log" aria-label="คัดลอก Log">' + ICON.copy + "</button>" +
      "</span></header>" +
      '<div class="lv-term-body" data-term-scroll tabindex="0" aria-label="Log">' +
      '<ol class="lv-term-lines" data-term-lines aria-live="polite"></ol>' +
      '<p class="lv-term-prompt"><span class="lv-term-ps">ckr@live</span><span class="lv-term-path">:~$</span> <span class="lv-term-hint" data-term-hint></span><span class="lv-caret" aria-hidden="true"></span></p>' +
      "</div>" +
      '<button type="button" class="lv-term-jump" data-term-jump hidden>' + ICON.down + "ล่าสุด</button>" +
      "</section>"
    );
  }

  function bindTerm(root) {
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";
    var scroll = root.querySelector("[data-term-scroll]");
    var jump = root.querySelector("[data-term-jump]");
    scroll.addEventListener(
      "scroll",
      function () {
        var far = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 48;
        jump.hidden = !far;
      },
      { passive: true }
    );
    root.querySelector("[data-term-lines]").addEventListener(
      "load",
      function () {
        if (jump.hidden) scroll.scrollTop = scroll.scrollHeight;
      },
      true
    );
    jump.addEventListener("click", function () {
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
    });
    root.querySelector("[data-term-copy]").addEventListener("click", function () {
      copyLines(root.querySelector("[data-term-lines]").__lines || []);
    });
  }

  function syncTerm(root, lines, jobId, hint) {
    if (!root) return;
    var list = root.querySelector("[data-term-lines]");
    var scroll = root.querySelector("[data-term-scroll]");
    var hintEl = root.querySelector("[data-term-hint]");
    if (hintEl) hintEl.textContent = hint || "";
    var next = Array.isArray(lines) ? lines.map(function (line) { return String(line); }) : [];
    if (list.__job !== jobId) {
      list.__job = jobId || "";
      list.__lines = [];
      list.replaceChildren();
    }
    var prev = list.__lines || [];
    var follow = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 56;
    var keep = prev.length ? overlapCount(prev, next) : 0;
    if (!keep) {
      list.replaceChildren();
      next.forEach(function (line) { list.appendChild(logLine(line, false)); });
    } else {
      var dropped = prev.length - keep;
      var removed = 0;
      for (var d = 0; d < dropped; d++) {
        var row = list.firstElementChild;
        if (!row) break;
        removed += row.offsetHeight || 0;
        row.remove();
      }
      if (dropped && scroll.scrollTop > 0) scroll.scrollTop = Math.max(0, scroll.scrollTop - removed);
      next.slice(keep).forEach(function (line) { list.appendChild(logLine(line, true)); });
    }
    list.__lines = next.slice();
    if (follow) scroll.scrollTop = scroll.scrollHeight;
  }

  function copyLines(lines) {
    var text = (lines || []).join("\n");
    var done = function () {
      var b = bridge();
      if (typeof b.toast === "function") b.toast("คัดลอก Log แล้ว", "ok");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
      return;
    }
    done();
  }

  function emptyState(art, title, sub) {
    return (
      '<div class="lv-empty">' + art + "<p class=\"lv-empty-title\">" + esc(title) + "</p>" +
      (sub ? '<p class="lv-empty-sub">' + esc(sub) + "</p>" : "") + "</div>"
    );
  }

  function loginGate() {
    return emptyState(LOCK_ART, "เข้าสู่ระบบก่อน", "ล็อกอินเพื่อดูงานสด คิว และประวัติ");
  }

  /* ---------- current pane ---------- */

  function ensureCurrentShell() {
    var root = $("live-pane-current");
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";
    root.innerHTML =
      '<div class="lv-switch" id="live-current-switch" role="tablist" aria-label="งานที่กำลังรัน" hidden></div>' +
      '<div id="live-current-card"></div>' +
      '<div id="live-current-queue"></div>' +
      termHtml("live-term", "job.log");
    bindTerm($("live-term"));
    root.addEventListener("click", function (ev) {
      var pick = ev.target.closest("[data-live-focus]");
      if (pick) {
        focusJobId = pick.getAttribute("data-live-focus") || "";
        refresh();
        return;
      }
      var btn = ev.target.closest("#live-cancel-job");
      if (!btn || btn.disabled) return;
      var id = btn.getAttribute("data-job");
      cancellingId = id;
      btn.disabled = true;
      btn.querySelector("span").textContent = "กำลังยกเลิก…";
      var b = bridge();
      var run = typeof b.cancelJob === "function" ? b.cancelJob(id) : Promise.resolve();
      Promise.resolve(run)
        .then(function () { return refresh(); })
        .catch(function () {
          cancellingId = "";
          btn.disabled = false;
          btn.querySelector("span").textContent = "ยกเลิกงาน";
        });
    });
  }

  // Several functions can run at once: one chip per running job, click to watch it.
  var focusJobId = "";

  function renderSwitch(job) {
    var box = $("live-current-switch");
    if (!box) return;
    var list = (job && job.running_jobs) || [];
    if (list.length < 2) {
      box.hidden = true;
      box.innerHTML = "";
      if (!list.length) focusJobId = "";
      return;
    }
    var cur = String((job && job.job_id) || "");
    if (focusJobId && !list.some(function (r) { return String(r.job_id) === focusJobId; })) focusJobId = "";
    var sig = list.map(function (r) { return r.job_id; }).join(",") + "|" + cur;
    var pctOf = function (r) {
      var p = r.progress || {};
      return p.total ? Math.round((Number(p.current) || 0) / Number(p.total) * 100) : -1;
    };
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML =
        '<span class="lv-switch-label">กำลังรันพร้อมกัน ' + list.length + " งาน</span>" +
        list
          .map(function (r) {
            var on = String(r.job_id) === cur;
            return (
              '<button type="button" role="tab" aria-selected="' + on + '" class="lv-switch-chip' + (on ? " is-on" : "") +
              '" data-live-focus="' + esc(r.job_id) + '">' + kindImg(r.kind, r.farm_mode || "", 22) +
              "<span>" + esc(kindLabel(r.kind, r.farm_mode || "")) + '</span><b data-live-pct="' + esc(r.job_id) + '"></b></button>'
            );
          })
          .join("");
    }
    list.forEach(function (r) {
      var el = box.querySelector('[data-live-pct="' + CSS.escape(String(r.job_id)) + '"]');
      var n = pctOf(r);
      var txt = n < 0 ? "" : n + "%";
      if (el && el.textContent !== txt) el.textContent = txt;
    });
    box.hidden = false;
  }

  function ringHtml(pct, running) {
    var indet = pct < 0;
    var off = indet ? RING_C * 0.72 : RING_C * (1 - pct / 100);
    return (
      '<svg class="lv-ring' + (indet ? " is-indet" : "") + (running ? " is-running" : "") + '" viewBox="0 0 120 120" aria-hidden="true">' +
      '<defs><linearGradient id="lv-ring-run" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a7f3d0"/><stop offset=".5" stop-color="#34d399"/><stop offset="1" stop-color="#059669"/></linearGradient>' +
      '<linearGradient id="lv-ring-queue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93c5fd"/><stop offset=".5" stop-color="#7678ed"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
      '<circle class="lv-ring-track" cx="60" cy="60" r="52"/>' +
      '<circle class="lv-ring-bar" cx="60" cy="60" r="52" stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      (running ? '<circle class="lv-ring-orbit" cx="60" cy="8" r="3.2"/>' : "") +
      "</svg>"
    );
  }

  function updateRing(card, pct, running) {
    var bar = card.querySelector(".lv-ring-bar");
    var svg = card.querySelector(".lv-ring");
    if (!bar || !svg) return false;
    var indet = pct < 0;
    if (svg.classList.contains("is-running") !== !!running) return false;
    svg.classList.toggle("is-indet", indet);
    bar.setAttribute("stroke-dashoffset", (indet ? RING_C * 0.72 : RING_C * (1 - pct / 100)).toFixed(1));
    return true;
  }

  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(function () {
      var el = $("live-elapsed");
      if (!el || !runClock.jobId) return;
      el.textContent = fmtDur(runClock.base + (Date.now() - runClock.at) / 1000);
    }, 1000);
  }

  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = 0;
  }

  function renderCurrent(active, queue, server) {
    ensureCurrentShell();
    var card = $("live-current-card");
    var queueEl = $("live-current-queue");
    var term = $("live-term");
    if (!loggedIn()) {
      card.innerHTML = loginGate();
      card.dataset.job = "login";
      queueEl.innerHTML = "";
      term.hidden = true;
      syncTerm(term, [], "");
      return;
    }
    term.hidden = false;
    var job = active && active.active ? active : null;
    if (!job) cancellingId = "";
    renderSwitch(job);
    var mine = (server && server.mine) || [];
    var mineById = {};
    mine.forEach(function (row) { mineById[String(row.job_id)] = row; });

    if (!job) {
      runClock.jobId = "";
      var nextUp = mine.filter(function (r) { return r.state !== "running"; })
        .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })[0];
      var sub = nextUp && nextUp.others_ahead > 0
        ? "มีคิวคนอื่นก่อนหน้า " + nextUp.others_ahead + " งาน"
        : "สั่งงานจากเมนูฟังก์ชัน แล้วสถานะจะขึ้นที่นี่ทันที";
      if (card.dataset.job !== "idle") {
        card.dataset.job = "idle";
        card.innerHTML = '<article class="lv-hero is-idle">' + emptyState(IDLE_ART, "ยังไม่มีงานที่กำลังรัน", sub) + "</article>";
      } else {
        var idleSub = card.querySelector(".lv-empty-sub");
        if (idleSub && idleSub.textContent !== sub) idleSub.textContent = sub;
      }
      syncTerm(term, [], "", "รองานใหม่");
    } else {
      var id = String(job.job_id || "");
      var mode = (job.params && (job.params.farm_mode || job.params.mode)) || "";
      var kind = job.kind || job.job_kind;
      var running = job.status === "running";
      var cancelling = cancellingId && id === String(cancellingId);
      var progress = job.progress || {};
      var pct = progressPct(progress);
      var me = mineById[id] || {};
      if (running && me.run_sec != null && runClock.jobId !== id) {
        runClock = { jobId: id, base: Number(me.run_sec) || 0, at: Date.now() };
      } else if (!running) {
        runClock.jobId = "";
      }
      var statusKey = cancelling ? "cancelling" : job.status;
      var sig = id + "|" + statusKey + "|" + running;
      var current = Number(progress.current) || 0;
      var total = Number(progress.total) || 0;
      var phase = String(progress.phase || "").trim();
      var isLoop = String(kind || "") === "heartloop_timed";
      var sub2 = isLoop && (running || me.state === "cooldown")
        ? heartloopText(progress, me.state === "cooldown" ? me.resume_in_sec : null) || "กำลังทำงานบนเซิร์ฟเวอร์"
        : running
        ? (phase && phase !== "run" ? phase : "กำลังทำงานบนเซิร์ฟเวอร์")
        : me.others_ahead > 0
          ? "มีคิวคนอื่นก่อนหน้า " + me.others_ahead + " งาน" + (me.eta_sec ? " · ประมาณ " + fmtDur(me.eta_sec) : "")
          : me.state === "waiting_owner"
            ? "รองานก่อนหน้าของคุณจบ แล้วจะเริ่มทันที"
            : "รอช่องว่าง";
      if (card.dataset.job !== sig) {
        card.dataset.job = sig;
        card.innerHTML =
          '<article class="lv-hero' + (running ? " is-running" : " is-waiting") + '">' +
          '<div class="lv-hero-ring">' + ringHtml(pct, running) +
          '<div class="lv-hero-ring-in"><b id="live-pct">' + (pct < 0 ? "—" : pct + "%") + '</b><small id="live-frac">' +
          (total > 0 ? esc(num(current)) + " / " + esc(num(total)) : "&nbsp;") + "</small></div></div>" +
          '<div class="lv-hero-body">' +
          '<div class="lv-hero-top">' + kindImg(kind, mode, 40) +
          '<div class="lv-hero-name"><h2>' + esc(kindLabel(kind, mode)) + "</h2>" +
          '<p class="lv-hero-sub" id="live-sub">' + esc(sub2) + "</p></div>" + badge(statusKey) + "</div>" +
          '<dl class="lv-hero-stats">' +
          '<div><dt>ความคืบหน้า</dt><dd id="live-stat-prog">' + (total > 0 ? esc(num(current)) + " / " + esc(num(total)) : "—") + "</dd></div>" +
          '<div><dt>' + (running ? "เวลาที่รัน" : "ลำดับคิว") + '</dt><dd id="live-elapsed">' +
          (running ? (runClock.jobId ? fmtDur(runClock.base) : "—") : esc(me.position || "—")) + "</dd></div>" +
          '<div><dt>Worker</dt><dd>' + esc(me.pool_label || "—") + "</dd></div>" +
          "</dl>" +
          '<div class="lv-hero-actions"><button type="button" class="lv-btn is-danger" id="live-cancel-job" data-job="' + esc(id) + '"' +
          (cancelling ? " disabled" : "") + ">" + ICON.stop + "<span>" + (cancelling ? "กำลังยกเลิก…" : "ยกเลิกงาน") + "</span></button></div>" +
          "</div></article>";
      } else {
        updateRing(card, pct, running);
        var pctEl = $("live-pct");
        if (pctEl) pctEl.textContent = pct < 0 ? "—" : pct + "%";
        var fracEl = $("live-frac");
        if (fracEl) fracEl.innerHTML = total > 0 ? esc(num(current)) + " / " + esc(num(total)) : "&nbsp;";
        var progEl = $("live-stat-prog");
        if (progEl) progEl.textContent = total > 0 ? num(current) + " / " + num(total) : "—";
        var subEl = $("live-sub");
        if (subEl) subEl.textContent = sub2;
        if (!running) {
          var posEl = $("live-elapsed");
          if (posEl) posEl.textContent = me.position || "—";
        }
      }
      if (running) startTick();
      syncTerm(term, job.logs || [], id, running ? "tail -f " + kind + ".log" : "รอเริ่มงาน");
    }

    var ahead = ((queue && queue.items) || []).filter(function (item) {
      return !job || String(item.job_id) !== String(job.job_id);
    });
    if (!ahead.length) {
      queueEl.innerHTML = "";
      return;
    }
    queueEl.innerHTML =
      '<section class="lv-card lv-upnext"><header class="lv-card-head"><h3>คิวถัดไปของคุณ</h3><span class="lv-count">' + ahead.length + "</span></header>" +
      '<ol class="lv-upnext-list">' +
      ahead
        .map(function (item) {
          var info = mineById[String(item.job_id)] || {};
          var wait =
            info.state === "waiting_owner"
              ? "เริ่มต่อทันทีเมื่องานก่อนหน้าของคุณจบ"
              : info.state === "waiting_account"
              ? "รอไอดีเกมว่าง — เกมให้เข้าได้พร้อมกันสูงสุด 2 ที่"
              : info.others_ahead > 0
                ? "มีคิวคนอื่นก่อนหน้า " + info.others_ahead + " งาน"
                : "รอช่องว่าง";
          if (info.eta_sec) wait += " · ประมาณ " + fmtDur(info.eta_sec);
          return (
            '<li class="is-' + tone(item.status) + '">' + kindImg(item.kind, item.farm_mode, 28) +
            '<span class="lv-upnext-name">' + esc(kindLabel(item.kind, item.farm_mode)) +
            (wait ? "<small>" + esc(wait) + "</small>" : "") + "</span>" +
            badge(item.status) + "</li>"
          );
        })
        .join("") +
      "</ol></section>";
  }

  /* ---------- server pane ---------- */

  function statTile(icon, label, value, cls) {
    return (
      '<div class="lv-stat' + (cls ? " " + cls : "") + '">' + icon +
      "<span><b>" + esc(num(value || 0)) + "</b><small>" + esc(label) + "</small></span></div>"
    );
  }

  /* Server pane: one card per function, a slot grid per worker, the queue with a plain
     reason for every wait. Updated in place (keyed by pool) so refreshes never flicker. */
  var serverSigs = {};

  function fmtAge(sec) {
    var n = Math.max(0, Number(sec) || 0);
    if (n < 60) return "ไม่ถึง 1 นาที";
    if (n < 3600) return Math.round(n / 60) + " นาที";
    return Math.floor(n / 3600) + " ชม. " + Math.round((n % 3600) / 60) + " นาที";
  }

  function waitReason(state) {
    if (state === "waiting_owner") return "รองานฟังก์ชันเดียวกันของผู้ใช้คนนี้จบก่อน";
    if (state === "waiting_account") return "รอไอดีเกมว่าง — กฎเกม: 1 ไอดีเข้าได้พร้อมกันสูงสุด 2 ที่";
    if (state === "holding") return "กำลังเตรียมงาน";
    if (state === "cooldown") return "พักรอบถัดไป · ไม่ได้รอคิว เริ่มต่อเองตามเวลา";
    return "รอช่องว่าง";
  }

  function poolFree(pool) {
    return pool.free_slots != null ? Number(pool.free_slots) : Math.max(0, (Number(pool.slots) || 0) - (Number(pool.running) || 0));
  }

  function poolPill(pool) {
    var free = poolFree(pool);
    var slots = Number(pool.slots) || 0;
    if (!slots && pool.draining) return '<span class="sv-pill is-warn">กำลังรีสตาร์ท</span>';
    if (!(pool.running || 0) && !(pool.queued || 0)) return '<span class="sv-pill is-idle">เครื่องว่าง</span>';
    if (free <= 0) return '<span class="sv-pill is-full">เต็ม ' + slots + "/" + slots + "</span>";
    return '<span class="sv-pill is-free">ว่าง ' + free + " จาก " + slots + " ช่อง</span>";
  }

  function slotRunning(entry, idx) {
    var p = entry.progress || null;
    var pct = p && p.total ? Math.max(0, Math.min(100, Math.round((p.current / p.total) * 100))) : -1;
    return (
      '<div class="sv-slot is-run' + (entry.mine ? " is-mine" : "") + '">' +
      '<div class="sv-slot-top">' + kindImg(entry.kind, "", 26) +
      '<span class="sv-slot-name">' + esc(kindLabel(entry.kind, "")) + "</span>" + (entry.mine ? '<em class="sv-mine-tag">งานคุณ</em>' : "") + "</div>" +
      '<span class="sv-bar' + (pct < 0 ? " is-indet" : "") + '"><i data-sv-bar="' + idx + '" style="width:' + (pct < 0 ? 100 : pct) + '%"></i></span>' +
      '<span class="sv-slot-meta" data-sv-meta="' + idx + '">' + slotMeta(entry) + "</span></div>"
    );
  }

  function slotMeta(entry) {
    var p = entry.progress || null;
    var bits = [];
    if (String(entry.kind || "") === "heartloop_timed" && p) {
      var hl = heartloopText(p, null);
      if (hl) bits.push(hl);
    } else if (p && p.total) bits.push(num(p.current) + "/" + num(p.total));
    if (entry.age_sec != null) bits.push("รันมา " + fmtAge(entry.age_sec));
    return esc(bits.join(" · ") || "กำลังทำงาน");
  }

  function poolSlotsHtml(pool, running) {
    var workers = (pool.workers && pool.workers.length ? pool.workers : [{ id: pool.id, slots: pool.slots_total || pool.slots, draining: pool.draining }]);
    var byWorker = {};
    running.forEach(function (e, i) {
      var w = e.worker || "";
      (byWorker[w] = byWorker[w] || []).push({ e: e, i: i });
    });
    var spare = [];
    Object.keys(byWorker).forEach(function (w) {
      if (!workers.some(function (x) { return x.id === w; })) spare = spare.concat(byWorker[w]);
    });
    var multi = workers.length > 1;
    return workers
      .map(function (w, wi) {
        var mine = (byWorker[w.id] || []).slice();
        while (mine.length < w.slots && spare.length) mine.push(spare.shift());
        var cells = "";
        // Big pools (HeartLoop: 60 light slots) show busy slots + one "N ว่าง" tile.
        var compact = w.slots > 12;
        var shown = compact ? Math.min(w.slots, mine.length) : w.slots;
        for (var k = 0; k < shown; k++) {
          var hit = mine[k];
          cells += hit
            ? slotRunning(hit.e, hit.i)
            : '<div class="sv-slot is-empty' + (w.draining ? " is-drain" : "") + '"><span>' + (w.draining ? "กำลังรีสตาร์ท" : "ว่าง") + "</span></div>";
        }
        if (compact && w.slots - shown > 0) {
          cells += '<div class="sv-slot is-empty' + (w.draining ? " is-drain" : "") + '"><span>' +
            (w.draining ? "กำลังรีสตาร์ท" : "ว่าง " + (w.slots - shown) + " ช่อง") + "</span></div>";
        }
        return (
          '<div class="sv-worker' + (w.draining ? " is-drain" : "") + '">' +
          (multi
            ? '<p class="sv-worker-name">เครื่อง ' + (wi + 1) + " · " + (w.running || 0) + "/" + w.slots + " ช่อง" +
              (w.draining ? ' <span class="sv-pill is-warn">กำลังรีสตาร์ท · ไม่รับงานใหม่</span>' : "") + "</p>"
            : "") +
          '<div class="sv-slots">' + cells + "</div></div>"
        );
      })
      .join("");
  }

  function poolQueueHtml(pool, pending) {
    if (!pending.length) return '<p class="sv-queue-empty">ไม่มีคิวรอ</p>';
    var ready = 0;
    return (
      '<ol class="sv-queue">' +
      pending
        .map(function (e, i) {
          if (e.state === "ready") ready += 1;
          var label = e.state === "cooldown"
            ? heartloopText(e.progress, e.resume_in_sec) || "พักรอบถัดไป"
            : e.state === "ready" ? "ลำดับ " + ready + " · รอช่องว่าง" : waitReason(e.state);
          return (
            '<li class="is-' + esc(e.state) + (e.mine ? " is-mine" : "") + '">' + kindImg(e.kind, "", 24) +
            '<span class="sv-q-name">' + esc(kindLabel(e.kind, "")) + (e.mine ? "<em>งานคุณ</em>" : "") +
            "<small>" + esc(label) + "</small></span>" +
            '<span class="sv-q-age" data-sv-age="' + i + '">' + (e.state !== "cooldown" && e.age_sec != null ? "รอมา " + esc(fmtAge(e.age_sec)) : "") + "</span></li>"
          );
        })
        .join("") +
      (pool.lineup_more ? '<li class="sv-queue-more">และอีก ' + esc(pool.lineup_more) + " งาน</li>" : "") +
      "</ol>"
    );
  }

  function poolParts(pool) {
    var rows = pool.lineup || [];
    return {
      running: rows.filter(function (r) { return r.state === "running"; }),
      pending: rows.filter(function (r) { return r.state !== "running"; }),
    };
  }

  function poolSig(pool, parts) {
    return JSON.stringify([
      pool.slots, pool.slots_total, pool.draining, poolFree(pool), pool.lineup_more, pool.cooldown, pool.running, pool.queued,
      (pool.workers || []).map(function (w) { return [w.id, w.slots, w.draining, w.running]; }),
      parts.running.map(function (r) { return [r.kind, r.worker, !!r.mine, !!(r.progress && r.progress.total)]; }),
      parts.pending.map(function (r) { return [r.kind, r.state, !!r.mine]; }),
    ]);
  }

  function poolCardHtml(pool, parts) {
    return (
      '<header class="sv-pool-head"><div><h3>' + esc(pool.label || pool.id) + "</h3>" +
      '<p>' + (Number(pool.running) || 0) + " กำลังทำงาน · " + (Number(pool.queued) || 0) + " ในคิว" +
      (Number(pool.cooldown) ? " · " + Number(pool.cooldown) + " พักรอบ" : "") + "</p></div>" + poolPill(pool) + "</header>" +
      poolSlotsHtml(pool, parts.running) +
      '<div class="sv-queue-wrap"><h4>คิวรอ</h4>' + poolQueueHtml(pool, parts.pending) + "</div>"
    );
  }

  function patchPool(el, parts) {
    parts.running.forEach(function (e, i) {
      var bar = el.querySelector('[data-sv-bar="' + i + '"]');
      var p = e.progress;
      if (bar && p && p.total) bar.style.width = Math.max(0, Math.min(100, Math.round((p.current / p.total) * 100))) + "%";
      var meta = el.querySelector('[data-sv-meta="' + i + '"]');
      if (meta) {
        var txt = slotMeta(e);
        if (meta.innerHTML !== txt) meta.innerHTML = txt;
      }
    });
    parts.pending.forEach(function (e, i) {
      var age = el.querySelector('[data-sv-age="' + i + '"]');
      var txt = e.state === "cooldown" ? "" : e.age_sec != null ? "รอมา " + fmtAge(e.age_sec) : "";
      if (age && age.textContent !== txt) age.textContent = txt;
      if (e.state === "cooldown") {
        var small = age && age.parentNode && age.parentNode.querySelector(".sv-q-name small");
        var lbl = heartloopText(e.progress, e.resume_in_sec) || "พักรอบถัดไป";
        if (small && small.textContent !== lbl) small.textContent = lbl;
      }
    });
  }

  function summaryText(totals, pools) {
    var running = Number(totals.running) || 0;
    var queued = Number(totals.queued) || 0;
    var ready = Number(totals.ready) || 0;
    var slots = Number(totals.slots) || 0;
    var free = totals.free_slots != null ? Number(totals.free_slots) : Math.max(0, slots - running);
    if (!running && !queued) return { tone: "idle", title: "เครื่องว่างทั้งหมด", sub: "พร้อมรับงานทันที · " + slots + " ช่องว่าง" };
    if (ready > 0 && pools.some(function (p) { return poolFree(p) <= 0 && p.ready > 0; })) {
      return { tone: "busy", title: "มีงานรอช่องว่าง " + ready + " งาน", sub: "งานจะเริ่มทันทีที่มีช่องว่างในฟังก์ชันนั้น" };
    }
    if (queued > 0 && ready === 0) {
      var acctWait = Number(totals.waiting_account) || 0;
      return {
        tone: "ok",
        title: "เครื่องยังว่าง " + free + " จาก " + slots + " ช่อง",
        sub: acctWait
          ? "คิวที่รออยู่ = งานต่อจากงานฟังก์ชันเดียวกัน หรือรอไอดีเกมว่าง (กฎเกม: 1 ไอดีเข้าพร้อมกันได้ 2 ที่)"
          : "คิวที่รออยู่เป็นงานต่อจากงานฟังก์ชันเดียวกันของผู้ใช้คนเดิม",
      };
    }
    return { tone: "ok", title: "กำลังทำงาน " + running + " งาน", sub: "ว่าง " + free + " จาก " + slots + " ช่อง · ไม่มีงานรอช่องว่าง" };
  }

  /* ---------- server view: cards (เดิม) ↔ tree (แบบ Charles) ---------- */
  var lastServer = null;

  function serverView() {
    try { return localStorage.getItem("ckr_live_server_view") === "tree" ? "tree" : "cards"; }
    catch (_) { return "cards"; }
  }
  function setServerView(v) {
    try { localStorage.setItem("ckr_live_server_view", v === "tree" ? "tree" : "cards"); } catch (_) {}
  }
  function bindServerViewToggle(root) {
    ensureTreeCss();
    root.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest(".sv-vt-btn");
      if (!b) return;
      setServerView(b.getAttribute("data-sv-view"));
      if (lastServer) renderServer(lastServer);
    });
  }
  function ensureTreeCss() {
    if (document.getElementById("sv-tree-css")) return;
    var s = document.createElement("style");
    s.id = "sv-tree-css";
    s.textContent =
      ".sv-viewtoggle{display:inline-flex;gap:4px;margin-top:8px;background:var(--muted-bg,#f1ebe0);border-radius:10px;padding:3px}" +
      ".sv-vt-btn{border:0;background:transparent;padding:5px 12px;border-radius:8px;font-size:.85rem;cursor:pointer;color:var(--muted,#8a7f6d)}" +
      ".sv-vt-btn.is-active{background:var(--card,#fff);color:inherit;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      ".sv-tree{font-size:.88rem;line-height:1.5}" +
      ".svt-root details{margin:0}" +
      ".svt-pool{border:1px solid var(--line,#e3d7c6);border-radius:12px;margin:8px 0;overflow:hidden;background:var(--card,#fff)}" +
      ".svt-pool>summary{padding:9px 12px;font-weight:700;background:var(--muted-bg,#faf6ef);cursor:pointer;list-style:none}" +
      ".svt-pool.is-busy>summary{background:#fff0f7}" +
      ".svt-worker{margin:0 0 0 14px}" +
      ".svt-worker>summary,.svt-queue>summary{padding:6px 10px;cursor:pointer;color:var(--muted,#6b6150);list-style:none}" +
      ".svt-node>summary::-webkit-details-marker{display:none}" +
      ".svt-node>summary::before{content:'▸';display:inline-block;width:1em;transition:transform .15s;color:#b7a98f}" +
      ".svt-node[open]>summary::before{transform:rotate(90deg)}" +
      ".svt-job{display:flex;align-items:center;gap:7px;padding:5px 10px 5px 30px;border-top:1px solid var(--line,#f0e8d8)}" +
      ".svt-job img{width:20px;height:20px}" +
      ".svt-job.is-mine{background:#fff0f7}" +
      ".svt-job .svt-tag{margin-left:auto;font-size:.76rem;padding:1px 7px;border-radius:999px;background:var(--muted-bg,#eee)}" +
      ".svt-job.is-running .svt-tag{background:#e6f7ec;color:#0a7a33}" +
      ".svt-job .svt-mine{color:#ff2e93;font-weight:700;font-size:.76rem}" +
      ".svt-prog{margin-left:auto;font-variant-numeric:tabular-nums;color:#6b6150;font-size:.8rem}" +
      ".svt-empty{padding:6px 10px 6px 30px;color:var(--muted,#9a8f7d);font-size:.82rem}";
    document.head.appendChild(s);
  }

  function svtJobRow(e) {
    var prog = "";
    if (e.progress && Number(e.progress.total) > 0) {
      prog = '<span class="svt-prog">' + num(e.progress.current || 0) + "/" + num(e.progress.total) + "</span>";
    }
    var tag = e.state === "running"
      ? '<span class="svt-tag">กำลังทำงาน</span>'
      : '<span class="svt-tag">' + esc(stateTh(e.state)) + "</span>";
    return (
      '<div class="svt-job is-' + esc(e.state || "wait") + (e.mine ? " is-mine" : "") + '">' +
      kindImg(e.kind, e.farm_mode || "", 20) +
      "<span>" + esc(kindLabel(e.kind, e.farm_mode || "")) + "</span>" +
      (e.mine ? '<span class="svt-mine">งานคุณ</span>' : "") +
      (prog || tag) +
      "</div>"
    );
  }
  function stateTh(s) {
    if (s === "ready") return "พร้อมเริ่ม";
    if (s === "holding") return "กำลังเตรียม";
    if (s === "waiting_owner") return "รองานเดิม";
    return "ในคิว";
  }

  function renderServerTree(host, pools, totals) {
    if (!host) return;
    if (!pools.length) {
      host.innerHTML = emptyState(IDLE_ART, "ยังไม่มี Worker ออนไลน์", "ระบบกำลังเริ่ม Worker ใหม่");
      return;
    }
    // เก็บสถานะ เปิด/ปิด ของแต่ละโหนดก่อน rebuild เพื่อไม่ให้เด้งปิดตอน refresh
    var openKeys = {};
    var hadTree = false;
    Array.prototype.forEach.call(host.querySelectorAll("details[data-svk]"), function (d) {
      hadTree = true;
      if (d.open) openKeys[d.getAttribute("data-svk")] = 1;
    });
    var html = pools.map(function (pool) {
      var pid = String(pool.id);
      var pk = "p:" + pid;
      var lineup = pool.lineup || [];
      var running = lineup.filter(function (r) { return r.state === "running"; });
      var pending = lineup.filter(function (r) { return r.state !== "running"; });
      var workers = (pool.workers && pool.workers.length)
        ? pool.workers
        : [{ id: pid, slots: pool.slots_total || pool.slots, running: pool.running }];
      var busy = (Number(pool.running) || 0) > 0;
      var poolOpen = hadTree ? !!openKeys[pk] : busy; // ครั้งแรก: เปิดเฉพาะ pool ที่มีงาน
      var workersHtml = workers.map(function (w) {
        var wk = "w:" + pid + ":" + w.id;
        var wruns = running.filter(function (r) { return String(r.worker || pid) === String(w.id); });
        var wOpen = hadTree ? !!openKeys[wk] : true;
        var jobs = wruns.length
          ? wruns.map(svtJobRow).join("")
          : '<div class="svt-empty">ว่าง</div>';
        return (
          '<details class="svt-node svt-worker" data-svk="' + esc(wk) + '"' + (wOpen ? " open" : "") + ">" +
          "<summary>⚙️ " + esc(w.id) + " · " + wruns.length + "/" + (Number(w.slots) || 0) + "</summary>" +
          jobs + "</details>"
        );
      }).join("");
      var queueHtml = "";
      if (pending.length || Number(pool.lineup_more)) {
        var qk = "q:" + pid;
        var qOpen = hadTree ? !!openKeys[qk] : false;
        queueHtml =
          '<details class="svt-node svt-queue" data-svk="' + esc(qk) + '"' + (qOpen ? " open" : "") + ">" +
          "<summary>⏳ คิว " + (pending.length + (Number(pool.lineup_more) || 0)) + "</summary>" +
          pending.map(svtJobRow).join("") +
          (Number(pool.lineup_more) ? '<div class="svt-empty">และอีก ' + num(pool.lineup_more) + " งาน</div>" : "") +
          "</details>";
      }
      return (
        '<details class="svt-node svt-pool' + (busy ? " is-busy" : "") + '" data-svk="' + esc(pk) + '"' + (poolOpen ? " open" : "") + ">" +
        "<summary>📁 " + esc(pool.label || pid) + " · " + (Number(pool.running) || 0) + "/" + (Number(pool.slots) || 0) +
        (Number(pool.queued) ? " · คิว " + num(pool.queued) : "") + "</summary>" +
        workersHtml + queueHtml + "</details>"
      );
    }).join("");
    host.innerHTML = '<div class="svt-root">' + html + "</div>";
  }

  function renderServer(server) {
    lastServer = server;
    var root = $("live-pane-server");
    if (!root) return;
    if (!loggedIn()) {
      root.innerHTML = loginGate();
      root.dataset.shell = "";
      serverSigs = {};
      return;
    }
    var totals = (server && server.totals) || {};
    var pools = (server && server.pools) || [];
    if (root.dataset.shell !== "1") {
      root.dataset.shell = "1";
      serverSigs = {};
      root.innerHTML =
        '<section class="sv-summary" id="sv-summary"><div class="sv-summary-copy"><span class="sv-dot" aria-hidden="true"></span>' +
        '<div><h3 id="sv-title"></h3><p id="sv-sub"></p></div></div>' +
        '<div class="sv-tiles">' +
        '<div class="sv-tile is-run"><b data-sv-t="running">0</b><small>กำลังทำงาน</small></div>' +
        '<div class="sv-tile is-free"><b data-sv-t="free">0</b><small>ช่องว่าง</small></div>' +
        '<div class="sv-tile is-wait"><b data-sv-t="ready">0</b><small>รอช่องว่าง</small></div>' +
        '<div class="sv-tile is-owner"><b data-sv-t="owner">0</b><small>รองานเดิมของผู้ใช้</small></div>' +
        "</div>" +
        '<div class="sv-viewtoggle" role="tablist" aria-label="มุมมอง">' +
        '<button type="button" class="sv-vt-btn" data-sv-view="cards" role="tab">▦ การ์ด</button>' +
        '<button type="button" class="sv-vt-btn" data-sv-view="tree" role="tab">🌳 โครงสร้าง</button>' +
        "</div></section>" +
        '<div class="sv-pools" id="sv-pools"></div>' +
        '<div class="sv-tree" id="sv-tree" hidden></div>';
      bindServerViewToggle(root);
    }
    var sum = summaryText(totals, pools);
    var box = $("sv-summary");
    box.className = "sv-summary is-" + sum.tone;
    if ($("sv-title").textContent !== sum.title) $("sv-title").textContent = sum.title;
    if ($("sv-sub").textContent !== sum.sub) $("sv-sub").textContent = sum.sub;
    var owner = pools.reduce(function (a, p) { return a + (Number(p.waiting_owner) || 0); }, 0);
    var free = totals.free_slots != null ? totals.free_slots : Math.max(0, (Number(totals.slots) || 0) - (Number(totals.running) || 0));
    var tv = { running: totals.running || 0, free: free + "/" + (totals.slots || 0), ready: totals.ready || 0, owner: owner };
    Object.keys(tv).forEach(function (k) {
      var el = root.querySelector('[data-sv-t="' + k + '"]');
      if (el && el.textContent !== String(tv[k])) el.textContent = tv[k];
    });

    // view mode: cards (เดิม) หรือ tree (แบบ Charles) — สลับได้ เก็บใน localStorage
    var view = serverView();
    Array.prototype.forEach.call(root.querySelectorAll(".sv-vt-btn"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-sv-view") === view);
      b.setAttribute("aria-selected", b.getAttribute("data-sv-view") === view ? "true" : "false");
    });
    var cardsHost = $("sv-pools");
    var treeHost = $("sv-tree");
    if (cardsHost) cardsHost.hidden = view !== "cards";
    if (treeHost) treeHost.hidden = view !== "tree";
    if (view === "tree") {
      renderServerTree(treeHost, pools, totals);
      return;
    }

    var host = cardsHost;
    if (!pools.length) {
      host.innerHTML = emptyState(IDLE_ART, "ยังไม่มี Worker ออนไลน์", "ระบบกำลังเริ่ม Worker ใหม่ ลองรีเฟรชอีกครั้งในไม่กี่วินาที");
      serverSigs = {};
      return;
    }
    if (host.querySelector(".lv-empty")) host.innerHTML = "";
    var seen = {};
    pools.forEach(function (pool, order) {
      var id = String(pool.id);
      seen[id] = 1;
      var el = host.querySelector('[data-sv-pool="' + CSS.escape(id) + '"]');
      if (!el) {
        el = document.createElement("article");
        el.className = "lv-card sv-pool";
        el.setAttribute("data-sv-pool", id);
      }
      if (host.children[order] !== el) host.insertBefore(el, host.children[order] || null);
      var parts = poolParts(pool);
      var sig = poolSig(pool, parts);
      el.classList.toggle("is-busy", (Number(pool.running) || 0) > 0);
      el.classList.toggle("is-full", poolFree(pool) <= 0 && (Number(pool.slots) || 0) > 0);
      if (serverSigs[id] !== sig) {
        serverSigs[id] = sig;
        el.innerHTML = poolCardHtml(pool, parts);
      } else {
        patchPool(el, parts);
      }
    });
    Array.prototype.slice.call(host.children).forEach(function (el) {
      var id = el.getAttribute("data-sv-pool");
      if (id && !seen[id]) {
        el.remove();
        delete serverSigs[id];
      }
    });
  }

  /* ---------- filters (idshop style) ---------- */

  function optionsHtml(options, value) {
    return options
      .map(function (opt) {
        return '<option value="' + esc(opt[0]) + '"' + (opt[0] === value ? " selected" : "") + ">" + esc(opt[1]) + "</option>";
      })
      .join("");
  }

  function filterShell(key) {
    var p = "live-" + key;
    return (
      '<div class="lv-toolbar">' +
      '<div class="lv-chips" role="radiogroup" aria-label="สถานะ" id="' + p + '-chips"></div>' +
      '<button type="button" class="idshop-ctrl idshop-ctrl-filter" id="' + p + '-ftoggle" aria-expanded="false" aria-controls="' + p + '-filters">' +
      ICON.filter + "<span>ตัวกรอง</span>" +
      '<span class="idshop-filter-badge" id="' + p + '-fbadge" hidden>0</span></button>' +
      "</div>" +
      '<section id="' + p + '-filters" class="idshop-filters lv-filters" aria-label="ตัวกรอง" aria-hidden="true" inert>' +
      '<div class="idshop-filters-inner"><div class="idshop-filter-bento">' +
      '<label class="idshop-bento-ctrl is-cookies" for="' + p + '-kind"><span class="idshop-bento-ctrl-head">' + ICON.fn + "ฟังก์ชัน</span>" +
      '<select id="' + p + '-kind">' + optionsHtml(KIND_OPTIONS, "") + "</select></label>" +
      '<label class="idshop-bento-ctrl is-gem" for="' + p + '-mode"><span class="idshop-bento-ctrl-head">' + ICON.mode + "โหมด</span>" +
      '<select id="' + p + '-mode">' + optionsHtml(MODE_OPTIONS, "") + "</select></label>" +
      '<div class="idshop-bento-ctrl is-price lv-date-ctrl"><span class="idshop-bento-ctrl-head">' + ICON.date + "ช่วงวันที่</span>" +
      '<div class="idshop-bento-ctrl-pair"><input type="date" id="' + p + '-from" aria-label="จากวันที่" /><input type="date" id="' + p + '-to" aria-label="ถึงวันที่" /></div></div>' +
      '<div class="idshop-bento-ctrl is-actions"><span class="idshop-bento-ctrl-head">ค้นหา</span>' +
      '<div class="idshop-bento-ctrl-pair"><button type="button" class="idshop-filter-apply" id="' + p + '-apply">ยืนยัน</button>' +
      '<button type="button" class="idshop-filter-clear" id="' + p + '-clear">ล้าง</button></div></div>' +
      "</div></div></section>"
    );
  }

  function renderChips(key, totals) {
    var box = $("live-" + key + "-chips");
    if (!box) return;
    var st = state[key];
    box.innerHTML = STATUS_CHIPS[key]
      .map(function (chip) {
        var on = chip[0] === st.status;
        var count = totals && chip[2] && totals[chip[2]] != null ? '<b>' + esc(num(totals[chip[2]])) + "</b>" : "";
        return (
          '<button type="button" role="radio" aria-checked="' + on + '" class="lv-chip is-' + (chip[0] || "all") + (on ? " is-on" : "") +
          '" data-chip="' + esc(chip[0]) + '"><i></i>' + esc(chip[1]) + count + "</button>"
        );
      })
      .join("");
  }

  function setFilterOpen(key, open) {
    var p = "live-" + key;
    var panel = $(p + "-filters");
    var btn = $(p + "-ftoggle");
    if (!panel || !btn) return;
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncFilterBadge(key) {
    var st = state[key];
    var n = (st.kind ? 1 : 0) + (st.mode ? 1 : 0) + (st.from || st.to ? 1 : 0);
    var badgeEl = $("live-" + key + "-fbadge");
    var btn = $("live-" + key + "-ftoggle");
    if (badgeEl) {
      badgeEl.textContent = String(n);
      badgeEl.hidden = !n;
    }
    if (btn) btn.classList.toggle("is-on", n > 0);
  }

  function bindFilters(key, reload) {
    var p = "live-" + key;
    var st = state[key];
    $(p + "-ftoggle").addEventListener("click", function () {
      setFilterOpen(key, !$(p + "-filters").classList.contains("is-open"));
    });
    $(p + "-chips").addEventListener("click", function (ev) {
      var chip = ev.target.closest("[data-chip]");
      if (!chip) return;
      st.status = chip.getAttribute("data-chip") || "";
      st.offset = 0;
      renderChips(key, $(p + "-chips").__totals);
      reload();
    });
    $(p + "-apply").addEventListener("click", function () {
      st.kind = $(p + "-kind").value;
      st.mode = $(p + "-mode").value;
      st.from = $(p + "-from").value;
      st.to = $(p + "-to").value;
      if (st.from && st.to && st.from > st.to) {
        var t = st.from;
        st.from = st.to;
        st.to = t;
        $(p + "-from").value = st.from;
        $(p + "-to").value = st.to;
      }
      st.offset = 0;
      syncFilterBadge(key);
      setFilterOpen(key, false);
      reload();
    });
    $(p + "-clear").addEventListener("click", function () {
      st.kind = st.mode = st.from = st.to = "";
      ["kind", "mode", "from", "to"].forEach(function (f) { $(p + "-" + f).value = ""; });
      st.offset = 0;
      syncFilterBadge(key);
      reload();
    });
  }

  function queryFor(key) {
    var st = state[key];
    var params = new URLSearchParams();
    if (st.kind) params.set("kind", st.kind);
    if (st.mode) params.set("farm_mode", st.mode);
    if (st.status) params.set("status", st.status);
    if (st.from) params.set("from", st.from);
    if (st.to) params.set("to", st.to + "T23:59:59");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(st.offset));
    return params;
  }

  function pagerHtml(key) {
    return (
      '<nav class="lv-pager" aria-label="เปลี่ยนหน้า">' +
      '<button type="button" class="lv-icon-btn" id="live-' + key + '-prev" aria-label="หน้าก่อน">' + ICON.prev + "</button>" +
      '<span id="live-' + key + '-range">—</span>' +
      '<button type="button" class="lv-icon-btn" id="live-' + key + '-next" aria-label="หน้าถัดไป">' + ICON.next + "</button>" +
      "</nav>"
    );
  }

  function bindPager(key, reload) {
    var st = state[key];
    $("live-" + key + "-prev").addEventListener("click", function () {
      if (st.offset <= 0) return;
      st.offset = Math.max(0, st.offset - PAGE_SIZE);
      reload(true);
    });
    $("live-" + key + "-next").addEventListener("click", function () {
      if ($("live-pane-" + key).dataset.more !== "1") return;
      st.offset += PAGE_SIZE;
      reload(true);
    });
  }

  function syncPager(key, count, hasMore, total) {
    var st = state[key];
    var root = $("live-pane-" + key);
    root.dataset.more = hasMore ? "1" : "0";
    var range = $("live-" + key + "-range");
    var prev = $("live-" + key + "-prev");
    var next = $("live-" + key + "-next");
    if (prev) prev.disabled = st.offset <= 0;
    if (next) next.disabled = !hasMore;
    if (!range) return;
    if (!count) {
      range.textContent = st.offset ? "ไม่มีรายการในหน้านี้" : "";
      return;
    }
    var from = st.offset + 1;
    var to = st.offset + count;
    range.innerHTML =
      "<b>" + num(from) + "–" + num(to) + "</b>" +
      (total != null ? " จาก " + num(total) : " · หน้า " + (Math.floor(st.offset / PAGE_SIZE) + 1));
  }

  function scrollPaneTop(key) {
    var el = $("live-pane-" + key);
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /* ---------- history (mine) ---------- */

  function rowNumbers(row) {
    var out = {};
    ["score", "coin", "exp", "ticket_count"].forEach(function (key) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== "") out[key] = row[key];
    });
    var result = row && row.result;
    if (result && typeof result === "object") {
      Object.keys(result).forEach(function (key) {
        if (typeof result[key] === "number" && out[key] === undefined) out[key] = result[key];
      });
    }
    return out;
  }

  function ensureHistoryShell() {
    var root = $("live-pane-history");
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";
    root.innerHTML =
      filterShell("history") +
      termHtml("live-hist-term", "job.log", { cls: "is-detail", closable: true }) +
      '<div id="live-history-list" class="lv-rows is-history"></div>' +
      pagerHtml("history");
    var term = $("live-hist-term");
    term.hidden = true;
    bindTerm(term);
    term.querySelector("[data-term-close]").addEventListener("click", function () {
      term.hidden = true;
      historyDetailId = "";
      markOpenRow("");
    });
    renderChips("history");
    bindFilters("history", loadHistory);
    bindPager("history", function (jump) {
      loadHistory().then(function () { if (jump) scrollPaneTop("history"); });
    });
    root.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-live-job]");
      if (!btn) return;
      openOwnLog(btn.getAttribute("data-live-job"), btn.getAttribute("data-live-label") || "job");
    });
  }

  function markOpenRow(id) {
    document.querySelectorAll("#live-history-list [data-live-job]").forEach(function (btn) {
      var on = btn.getAttribute("data-live-job") === id;
      btn.classList.toggle("is-on", on);
      btn.closest(".lv-row").classList.toggle("is-open", on);
    });
  }

  function rowsHead(cols) {
    return '<div class="lv-row is-head" aria-hidden="true">' + cols.map(function (c) { return '<span class="' + c[0] + '">' + esc(c[1]) + "</span>"; }).join("") + "</div>";
  }

  function renderHistory(data) {
    ensureHistoryShell();
    var list = $("live-history-list");
    if (!loggedIn()) {
      list.innerHTML = loginGate();
      syncPager("history", 0, false);
      return;
    }
    var items = (data && data.items) || [];
    syncPager("history", items.length, !!(data && data.has_more));
    list.innerHTML = items.length
      ? rowsHead([["lv-c-icon", ""], ["lv-c-name", "ฟังก์ชัน"], ["lv-c-status", "สถานะ"], ["lv-c-nums", "ผลลัพธ์"], ["lv-c-time", "เวลา"], ["lv-c-act", ""]]) +
        items
          .map(function (row) {
            var id = row.id || row.job_id;
            var label = kindLabel(row.kind, row.farm_mode);
            var span = fmtSpan(row.started_at || row.created_at, row.finished_at);
            return (
              '<article class="lv-row is-' + tone(row.status) + (String(id) === historyDetailId ? " is-open" : "") + '">' +
              '<span class="lv-c-icon">' + kindImg(row.kind, row.farm_mode, 32) + "</span>" +
              '<span class="lv-c-name">' + esc(label) + "</span>" +
              '<span class="lv-c-status">' + badge(row.status) + "</span>" +
              '<span class="lv-c-nums">' + numbersHtml(rowNumbers(row)) + "</span>" +
              '<span class="lv-c-time">' + esc(fmtWhen(row.finished_at || row.created_at)) + (span ? "<small>ใช้ " + esc(span) + "</small>" : "") + "</span>" +
              '<span class="lv-c-act"><button type="button" class="lv-log-btn' + (String(id) === historyDetailId ? " is-on" : "") +
              '" data-live-job="' + esc(id) + '" data-live-label="' + esc(label) + '">' + ICON.term + "Log</button></span>" +
              "</article>"
            );
          })
          .join("")
      : emptyState(IDLE_ART, "ไม่พบงานตามตัวกรองนี้", "ลองเปลี่ยนสถานะหรือกด ล้าง ในตัวกรอง");
  }

  function openOwnLog(jobId, label) {
    if (!jobId) return;
    historyDetailId = jobId;
    markOpenRow(jobId);
    var term = $("live-hist-term");
    term.hidden = false;
    term.querySelector("[data-term-title]").textContent = label + " · #" + String(jobId).slice(0, 8);
    syncTerm(term, [], "load:" + jobId, "กำลังโหลด…");
    term.scrollIntoView({ block: "nearest", behavior: "smooth" });
    api("/api/farm/job/" + encodeURIComponent(jobId))
      .then(function (data) {
        if (historyDetailId !== jobId) return;
        var logs = (data && data.logs) || [];
        syncTerm(term, logs.length ? logs : ["(ไม่มี Log สำหรับงานนี้)"], jobId, "cat " + String(jobId).slice(0, 8) + ".log");
      })
      .catch(function () {
        if (historyDetailId !== jobId) return;
        syncTerm(term, ["ERROR โหลด Log ไม่สำเร็จ"], jobId, "");
      });
  }

  /* ---------- board (everyone, all time) ---------- */

  function ensureBoardShell() {
    var root = $("live-pane-board");
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";
    root.innerHTML =
      '<p class="lv-board-note"><span class="lv-live-dot" aria-hidden="true"></span>งานของทุกคนตั้งแต่เปิดเซิร์ฟเวอร์ · ชื่อผู้ใช้ถูกซ่อนบางส่วน</p>' +
      filterShell("board") +
      '<div id="live-board-list" class="lv-rows is-board"></div>' +
      pagerHtml("board");
    renderChips("board");
    bindFilters("board", loadBoard);
    bindPager("board", function (jump) {
      loadBoard().then(function () { if (jump) scrollPaneTop("board"); });
    });
  }

  function totalsFrom(data) {
    if (data && data.totals && data.totals.count != null) return data.totals;
    var summary = (data && data.summary) || {};
    var out = { count: 0, live: 0, succeeded: 0, partial: 0, failed: 0, stuck: 0 };
    Object.keys(summary).forEach(function (key) {
      var slot = summary[key] || {};
      Object.keys(out).forEach(function (f) { out[f] += Number(slot[f]) || 0; });
    });
    return Object.keys(summary).length ? out : null;
  }

  // Finished-but-not-succeeded rows show how much actually got done (e.g. 2,000/3,000).
  function boardResult(row, live) {
    if (live && row.progress) return miniBar(row.progress);
    var p = row.progress;
    var done = p && Number(p.total) > 0 && (row.bucket === "partial" || row.bucket === "failed" || row.bucket === "stuck");
    if (!done) return numbersHtml(row.numbers);
    var cur = Number(p.current) || 0;
    var total = Number(p.total) || 0;
    var pct = Math.max(0, Math.min(100, Math.round((cur / total) * 100)));
    return (
      '<span class="lv-done-frac is-' + esc(row.bucket) + '"><span><b>' + esc(num(cur)) + "</b> / " + esc(num(total)) + "</span>" +
      '<span class="lv-done-bar"><i style="width:' + pct + '%"></i></span><small>' + pct + "%</small></span>" +
      (row.bucket === "partial" ? numbersHtml(row.numbers).replace('<span class="lv-dim">—</span>', "") : "")
    );
  }

  function renderBoard(data) {
    ensureBoardShell();
    var list = $("live-board-list");
    if (!loggedIn()) {
      list.innerHTML = loginGate();
      syncPager("board", 0, false);
      return;
    }
    var totals = totalsFrom(data);
    var chips = $("live-board-chips");
    chips.__totals = totals;
    renderChips("board", totals);
    var st = state.board;
    var totalForView = null;
    if (totals && data && data.totals && data.totals.count != null) {
      var map = { "": "count", live: "live", succeeded: "succeeded", partial: "partial", failed: "failed", stuck: "stuck" };
      totalForView = totals[map[st.status]];
    }
    var items = (data && data.items) || [];
    syncPager("board", items.length, !!(data && data.has_more), totalForView);
    var me = bridge().username ? bridge().username() : "";
    list.innerHTML = items.length
      ? rowsHead([["lv-c-icon", ""], ["lv-c-name", "ฟังก์ชัน / ผู้ใช้"], ["lv-c-status", "สถานะ"], ["lv-c-nums", "ผลลัพธ์"], ["lv-c-time", "เวลา"]]) +
        items
          .map(function (row) {
            var name = row.mine ? me || row.display_name : row.display_name;
            var span = fmtSpan(row.started_at || row.created_at, row.finished_at);
            var live = row.bucket === "live";
            return (
              '<article class="lv-row is-' + tone(row.status, row.bucket) + (row.mine ? " is-mine" : "") + '">' +
              '<span class="lv-c-icon">' + kindImg(row.kind, row.farm_mode, 32) + "</span>" +
              '<span class="lv-c-name">' + esc(kindLabel(row.kind, row.farm_mode)) +
              '<small class="lv-user">' + ICON.user + esc(name || "u***") + (row.mine ? "<em>คุณ</em>" : "") + "</small></span>" +
              '<span class="lv-c-status">' + badge(row.status, row.bucket) + "</span>" +
              '<span class="lv-c-nums">' + boardResult(row, live) + "</span>" +
              '<span class="lv-c-time">' + esc(fmtWhen(row.started_at || row.created_at)) +
              (span ? "<small>ใช้ " + esc(span) + "</small>" : "") + "</span>" +
              "</article>"
            );
          })
          .join("")
      : emptyState(IDLE_ART, "ไม่พบงานตามตัวกรองนี้", "ลองเลือก ทั้งหมด หรือกด ล้าง ในตัวกรอง");
  }

  /* ---------- loading / polling ---------- */

  function loadHistory() {
    ensureHistoryShell();
    return api("/api/farm/history?" + queryFor("history").toString())
      .then(renderHistory)
      .catch(function () { renderHistory({ items: [] }); });
  }

  function loadBoard() {
    ensureBoardShell();
    return api("/api/farm/board?" + queryFor("board").toString())
      .then(renderBoard)
      .catch(function () { renderBoard({ items: [], summary: {} }); });
  }

  function refresh() {
    if (!loggedIn()) {
      if (pane === "current") renderCurrent(null, null, null);
      if (pane === "server") renderServer(null);
      if (pane === "history") renderHistory(null);
      if (pane === "board") renderBoard(null);
      return Promise.resolve();
    }
    if (pane === "current") {
      return Promise.all([
        api("/api/farm/active-job" + (focusJobId ? "?job_id=" + encodeURIComponent(focusJobId) : "")),
        api("/api/farm/queue").catch(function () { return { items: [] }; }),
        api("/api/farm/queue/server").catch(function () { return { pools: [], mine: [] }; }),
      ])
        .then(function (rows) {
          var active = rows[0];
          if (cancellingId && (!active || !active.active)) cancellingId = "";
          renderCurrent(active, rows[1], rows[2]);
        })
        .catch(function () { renderCurrent({ active: false }, { items: [] }, { pools: [] }); });
    }
    if (pane === "server") {
      return api("/api/farm/queue/server").then(renderServer).catch(function () { renderServer({ pools: [] }); });
    }
    if (pane === "history") return loadHistory();
    if (pane === "board") return loadBoard();
    return Promise.resolve();
  }

  function pollMs() {
    if (pane === "current") return 2000;
    if (pane === "server") return 4000;
    if (pane === "board") return 10000;
    return 0;
  }

  function stopPoll() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  function startPoll() {
    stopPoll();
    var ms = pollMs();
    if (!ms) return;
    timer = setInterval(function () {
      if (document.hidden) return;
      if (pane === "board" && state.board.offset > 0) return;
      refresh();
    }, ms);
  }

  function setPane(next, opts) {
    opts = opts || {};
    pane = PANES.indexOf(next) >= 0 ? next : "current";
    window.__ckrLivePane = pane;
    document.querySelectorAll("[data-live-pane]").forEach(function (btn) {
      var on = btn.getAttribute("data-live-pane") === pane;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    var tabs = document.querySelector(".live-tabs");
    if (tabs) tabs.style.setProperty("--lv-tab", String(PANES.indexOf(pane)));
    PANES.forEach(function (name) {
      var el = $("live-pane-" + name);
      if (!el) return;
      var show = name === pane;
      el.hidden = !show;
      el.classList.toggle("is-shown", show);
    });
    if (pane !== "current") stopTick();
    if (!opts.skipUrl) {
      try {
        var url = new URL(location.href);
        if (pane === "current") url.searchParams.delete("pane");
        else url.searchParams.set("pane", pane);
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      } catch (e) {}
    }
    refresh();
    startPoll();
  }

  function onShow() {
    var asked = window.__ckrLivePane || new URLSearchParams(location.search).get("pane");
    setPane(asked || "current", { skipUrl: true });
  }

  function onHide() {
    stopPoll();
    stopTick();
  }

  // Panes re-render on every poll; give fresh art a negative delay so its loop
  // continues from the current phase instead of restarting (no visible jump).
  function syncArt(scope) {
    var now = performance.now();
    scope.querySelectorAll(".lv-idle-art, .lv-idle-art *").forEach(function (el) {
      var cs = getComputedStyle(el);
      if (!cs.animationName || cs.animationName === "none") return;
      el.style.animationDelay = cs.animationDuration
        .split(",")
        .map(function (d) {
          var ms = parseFloat(d) * (/ms$/.test(d.trim()) ? 1 : 1000);
          return ms > 0 ? -(now % ms) + "ms" : "0ms";
        })
        .join(",");
    });
  }

  function bind() {
    var root = $("live-page");
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";
    if (window.MutationObserver) {
      new MutationObserver(function (records) {
        records.forEach(function (rec) {
          rec.addedNodes.forEach(function (node) {
            if (node.nodeType === 1 && (node.matches(".lv-idle-art") || node.querySelector(".lv-idle-art"))) syncArt(node.parentNode || node);
          });
        });
      }).observe(root, { childList: true, subtree: true });
      syncArt(root);
    }
    root.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-live-pane]");
      if (!btn) return;
      setPane(btn.getAttribute("data-live-pane"));
    });
  }

  window.CKRLivePage = {
    onShow: onShow,
    onHide: onHide,
    setPane: setPane,
    refresh: refresh,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  function boot() {
    bind();
    var panel = $("farm-panel-live");
    if (panel && !panel.hidden) onShow();
  }
})();
