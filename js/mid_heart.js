/* ฟาร์มใจ MID — pool accounts befriend any MID and send hearts.
   No DevPlay login. Jobs are long-lived (wait for the customer to accept in-game),
   so this page manages its own job cards instead of the shared live card. */
(function () {
  "use strict";

  var POLL_MS = 5000;
  var FRIEND_CAP = 300;
  var RECENT_KEY = "ckr_mid_heart_recent";
  var WARN_LEFT_SEC = 300;
  var st = {
    info: null,
    target: null,
    mid: "",
    count: "",
    friends: "",
    looking: false,
    starting: false,
    jobs: [],
    seen: {}, // job_id → {sent, warned, count}
    timer: 0,
    tick: 0,
    shown: false,
    busyJob: {},
    rulesOpen: false,
  };

  function T() {
    return window.CKR_TOOLS || {};
  }
  function $(id) {
    return document.getElementById(id);
  }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function num(n) {
    var f = T().formatNumTh;
    return typeof f === "function" ? f(Number(n) || 0) : String(Number(n) || 0);
  }
  function tok(n) {
    return String(Math.round((Number(n) || 0) * 1000) / 1000);
  }
  function api(path, opts) {
    return T().api(path, opts || {});
  }
  function errText(e) {
    var d = (e && e.data && e.data.detail) || (e && e.detail);
    if (d && typeof d === "object") return d.message || d.code || "ไม่สำเร็จ";
    return (typeof d === "string" && d) || (e && e.message) || "ไม่สำเร็จ";
  }
  function showErr(msg, title) {
    var t = T();
    if (typeof t.showErrorModal === "function") t.showErrorModal(msg, title || "ไม่สำเร็จ");
  }
  function toast(msg, kind, title) {
    var a = window.CKR_ADMIN || {};
    if (typeof a.toast === "function") a.toast(msg, kind || "info", { title: title, duration: kind === "err" ? 7000 : 5000 });
  }
  function rate() {
    var f = T().tokenRate;
    var r = typeof f === "function" ? Number(f("mid_heart")) : NaN;
    return isFinite(r) ? r : 0.1;
  }
  function coveredByRental(n) {
    var f = T().tokenJobPreview;
    if (typeof f !== "function") return false;
    try {
      var p = f("mid_heart", Math.max(1, n || 1), "mid_heart", {});
      return !!(p && (p.covered || p.free));
    } catch (_) {
      return false;
    }
  }
  function fmtLeft(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
  }
  function cleanMid(v) {
    return String(v || "").replace(/\s+/g, "").toUpperCase();
  }

  // ── recent MIDs (per browser convenience only) ─────────────────────────────
  function recentList() {
    try {
      var v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(v) ? v.slice(0, 5) : [];
    } catch (_) {
      return [];
    }
  }
  function rememberMid(t) {
    try {
      var list = recentList().filter(function (x) { return x && x.mid !== t.mid; });
      list.unshift({ mid: t.mid, name: t.nickname || "" });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (_) {}
  }

  // ── limits ────────────────────────────────────────────────────────────────
  function friendRoom() {
    var f = String(st.friends).trim();
    if (f === "") return FRIEND_CAP;
    var n = Math.floor(Number(f));
    if (!isFinite(n) || n < 0) return FRIEND_CAP;
    return Math.max(0, FRIEND_CAP - Math.min(FRIEND_CAP, n));
  }
  function maxCount() {
    var t = st.target;
    if (!t) return 0;
    return Math.max(0, Math.min(t.available || 0, t.count_max || FRIEND_CAP, friendRoom()));
  }

  // ── view ──────────────────────────────────────────────────────────────────
  function stepsHtml() {
    return (
      '<div class="mh-steps">' +
      '<div class="mh-step"><span>1</span><b>ใส่ MID</b><small>รหัสผู้เล่นของคุณ</small></div>' +
      '<div class="mh-step"><span>2</span><b>กดรับเพื่อนในเกม</b><small>เมนูเพื่อน → คำขอ → รับทั้งหมด</small></div>' +
      '<div class="mh-step"><span>3</span><b>ได้หัวใจทันที</b><small>รับ 1 คน = 1 หัวใจ</small></div>' +
      "</div>"
    );
  }

  function rulesHtml() {
    var i = st.info || {};
    return (
      '<details class="mh-rules"' + (st.rulesOpen ? " open" : "") + '><summary>อ่านเงื่อนไขทั้งหมด</summary><ul>' +
      "<li>ไม่ต้องล็อกอิน DevPlay และไม่ต้องให้รหัสผ่านเกม ใช้แค่ MID</li>" +
      "<li>ต้อง<b>กดรับเพื่อนในเกมเอง</b> ระบบจะส่งหัวใจให้ทันทีหลังคุณกดรับแต่ละคน</li>" +
      "<li>ครั้งละไม่เกิน <b>" + num(i.count_max || 300) + " หัวใจ</b> และต้องไม่เกินช่องเพื่อนที่ว่างของคุณ (เกมให้มีเพื่อนได้ 300 คน)</li>" +
      "<li>จ่ายเฉพาะหัวใจที่ได้จริง ส่วนที่ไม่ได้คืน Token อัตโนมัติ · ผู้เช่าใช้ฟรี</li>" +
      "<li>มีเวลากดรับ <b>" + num(i.default_minutes || 60) + " นาที</b> ถ้าไม่พอกด <b>+" + num(i.extend_minutes || 30) + " นาที</b> ได้ (รวมไม่เกิน " + num(i.max_hours || 12) + " ชม.)</li>" +
      "<li>ได้ครบแล้วกด <b>จบงาน</b> ระบบจะลบเพื่อนที่เพิ่มให้เอง ถ้าลืมกด ระบบปิดให้เองใน " + num(i.complete_grace_minutes || 15) + " นาที</li>" +
      "<li>เปิดหลาย MID พร้อมกันได้</li>" +
      "</ul></details>"
    );
  }

  function rateCardHtml() {
    var f = T().formatTokenRateCardHtml;
    if (typeof f !== "function") {
      return '<div class="mh-card mh-rate">ราคา <b>' + rate() + " Token / หัวใจ</b> · ผู้เช่าใช้ฟรี</div>";
    }
    return (
      '<div class="mh-rate">' +
      f({
        rateKey: "mid_heart",
        rate: rate(),
        unitWord: "หัวใจ",
        sampleSteps: [10, 50, 100, 300],
        currentUnits: Math.floor(Number(st.count) || 0),
        targetInputId: st.target ? "mh-count" : "",
      }) +
      "</div>"
    );
  }

  function formHtml() {
    var t = st.target;
    var recents = recentList();
    var h =
      '<div class="mh-card"><label class="mh-label" for="mh-mid">MID ของคุณ</label>' +
      '<div class="mh-row">' +
      '<input id="mh-mid" class="mh-input" placeholder="เช่น ABCDE1234" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" value="' + esc(st.mid) + '" />' +
      '<button type="button" class="btn btn-ghost" id="mh-lookup"' + (st.looking ? " disabled" : "") + ">" + (st.looking ? "กำลังค้นหา…" : "ค้นหา") + "</button>" +
      "</div>" +
      '<span class="mh-hint">ดู MID ได้ในเกม: กดรูปโปรไฟล์ → รหัสผู้เล่น</span>';
    if (recents.length && !t) {
      h += '<div class="mh-recent"><span>ใช้ล่าสุด</span>' +
        recents.map(function (r) {
          return '<button type="button" class="mh-chip" data-mid="' + esc(r.mid) + '">' + esc(r.name || r.mid) + " · " + esc(r.mid) + "</button>";
        }).join("") + "</div>";
    }
    if (t) {
      var max = maxCount();
      var n = Math.min(max, Math.max(0, Math.floor(Number(st.count) || 0)));
      h +=
        '<div class="mh-target"><img src="assets/mid_heart.png?v=20261001" alt="" width="36" height="36" />' +
        "<div><b>" + esc(t.nickname || "(ไม่มีชื่อ)") + "</b><span>MID " + esc(t.mid) + " · Lv." + num(t.level) + "</span></div>" +
        '<button type="button" class="mh-link" id="mh-reset">เปลี่ยน MID</button></div>' +
        '<div class="mh-grid">' +
        '<label class="mh-field"><span>อยากได้กี่หัวใจ</span><input id="mh-count" type="number" inputmode="numeric" min="1" max="' + max + '" step="1" value="' + esc(st.count) + '" /></label>' +
        '<label class="mh-field"><span>ตอนนี้มีเพื่อนในเกมกี่คน <em>(ไม่บังคับ)</em></span><input id="mh-friends" type="number" inputmode="numeric" min="0" max="300" step="1" placeholder="ไม่รู้ก็เว้นว่าง" value="' + esc(st.friends) + '" /></label>' +
        "</div>" +
        '<span class="mh-hint" id="mh-limit">' + limitText(max) + "</span>" +
        '<button type="button" class="btn btn-candy mh-start" id="mh-start"' + (st.starting || max < 1 || n < 1 ? " disabled" : "") + ">" +
        (st.starting ? "กำลังเริ่ม…" : startLabel(n)) + "</button>";
    }
    return h + "</div>";
  }

  function limitText(max) {
    if (friendRoom() < 1) return '<b class="mh-bad">เพื่อนในเกมของคุณเต็มแล้ว ลบเพื่อนในเกมก่อน</b>';
    if (max < 1) return '<b class="mh-bad">ตอนนี้ยังส่งให้ MID นี้ไม่ได้ ลองใหม่ภายหลัง</b>';
    return "ขอได้สูงสุด " + num(max) + " หัวใจ" + (String(st.friends).trim() !== "" ? " (ช่องเพื่อนว่าง " + num(friendRoom()) + ")" : "");
  }

  function startLabel(n) {
    if (n < 1) return "เริ่มรับหัวใจ";
    if (coveredByRental(n)) return "เริ่มรับ " + num(n) + " หัวใจ · ฟรี (ผู้เช่า)";
    return "เริ่มรับ " + num(n) + " หัวใจ · " + tok(n * rate()) + " Token";
  }

  function ringHtml(left, total, tone) {
    var R = 26;
    var C = 2 * Math.PI * R;
    var frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
    return (
      '<div class="mh-ring ' + tone + '" data-ring-total="' + Math.round(total) + '">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="' + R + '" class="mh-ring-bg"/>' +
      '<circle cx="32" cy="32" r="' + R + '" class="mh-ring-fg" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '"/></svg>' +
      "</div>"
    );
  }

  function toneFor(left, complete) {
    if (complete) return "is-done";
    if (left <= WARN_LEFT_SEC) return "is-red";
    if (left <= 900) return "is-amber";
    return "is-green";
  }

  function jobHtml(j) {
    var p = j.progress || {};
    var now = Date.now() / 1000;
    var phase = String(p.phase || "");
    var complete = phase === "complete";
    var closing = j.finish_requested || j.cancel_requested || phase === "cleanup";
    var running = j.status === "running";
    var sent = Number(p.current || 0);
    var total = Number(j.count || p.total || 0);
    var waiting = Number(p.waiting || 0);
    var left = j.deadline ? j.deadline - now : 0;
    var span = j.deadline && j.started ? Math.max(60, j.deadline - j.started) : 3600;
    if (complete) span = Math.min(span, 900);
    var pct = total ? Math.min(100, Math.round((sent / total) * 100)) : 0;
    var busy = !!st.busyJob[j.job_id];

    var headline;
    if (!running) headline = "รอคิวเริ่มงาน…";
    else if (closing) headline = "กำลังจบงานและลบเพื่อน…";
    else if (phase === "recruit") headline = "กำลังส่งคำขอเพื่อนไปที่ MID ของคุณ…";
    else if (complete) headline = "ได้หัวใจครบแล้ว ✓";
    else headline = "เข้าเกมแล้วกดรับเพื่อน <b>อีก " + num(waiting) + " คน</b>";

    var timer = "";
    if (running && !closing && j.deadline) {
      var tone = toneFor(left, complete);
      timer =
        '<div class="mh-timer">' + ringHtml(left, span, tone) +
        '<div class="mh-timer-txt"><b data-deadline="' + j.deadline + '" data-span="' + Math.round(span) + '" data-complete="' + (complete ? 1 : 0) + '">' + fmtLeft(left) + "</b>" +
        "<small>" + (complete ? "ปิดงานอัตโนมัติใน" : "เวลาที่เหลือให้กดรับ") + "</small></div></div>";
    }

    var actions = "";
    if (!closing) {
      if (complete) {
        actions = '<button type="button" class="btn btn-candy mh-finish-big" data-mh="finish"' + (busy ? " disabled" : "") + ">ได้หัวใจแล้ว จบงาน</button>";
      } else if (running) {
        actions =
          '<button type="button" class="btn btn-ghost" data-mh="extend"' + (busy ? " disabled" : "") + ">+30 นาที</button>" +
          '<button type="button" class="btn btn-candy" data-mh="finish"' + (busy ? " disabled" : "") + ">ได้หัวใจแล้ว จบงาน</button>";
      }
      actions += '<button type="button" class="btn btn-ghost mh-cancel" data-mh="cancel"' + (busy ? " disabled" : "") + ">ยกเลิก</button>";
    }

    return (
      '<div class="mh-job' + (complete ? " is-complete" : "") + '" data-job="' + esc(j.job_id) + '">' +
      '<div class="mh-job-top"><div class="mh-job-head"><b>' + esc(j.nickname || j.target_mid) + "</b><span>MID " + esc(j.target_mid) + "</span></div>" + timer + "</div>" +
      '<div class="mh-state">' + headline + "</div>" +
      (p.target_full ? '<div class="mh-alert">เพื่อนในเกมของคุณเต็มแล้ว ส่วนที่เหลือส่งไม่ได้ · ลบเพื่อนในเกมแล้วเริ่มงานใหม่ได้</div>' : "") +
      '<div class="mh-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="mh-stats"><span>ได้แล้ว <b>' + num(sent) + "</b> / " + num(total) + " หัวใจ</span></div>" +
      (actions ? '<div class="mh-actions">' + actions + "</div>" : "") +
      "</div>"
    );
  }

  function render() {
    var root = $("mid-heart-page");
    if (!root) return;
    var jobs = st.jobs.length ? '<h3 class="mh-sub">งานของคุณ</h3>' + st.jobs.map(jobHtml).join("") : "";
    root.innerHTML =
      '<div class="mh-head"><img src="assets/mid_heart.png?v=20261001" alt="" width="44" height="44" /><div><h2>ฟาร์มใจ MID</h2>' +
      "<p>รับหัวใจเข้า MID ของคุณ ไม่ต้องล็อกอินเกม</p></div></div>" +
      jobs + stepsHtml() + formHtml() + rateCardHtml() + rulesHtml();
  }

  function repaintForm() {
    var btn = $("mh-start");
    var lim = $("mh-limit");
    var max = maxCount();
    var n = Math.floor(Number(st.count) || 0);
    if (lim) lim.innerHTML = limitText(max);
    var cnt = $("mh-count");
    if (cnt) cnt.max = String(max);
    if (btn && !st.starting) {
      btn.disabled = max < 1 || n < 1 || n > max;
      btn.textContent = n > max ? "เกินที่ขอได้ (สูงสุด " + num(max) + ")" : startLabel(n);
    }
  }

  // ── data ──────────────────────────────────────────────────────────────────
  function loadInfo() {
    return api("/api/farm/mid-heart/info")
      .then(function (d) {
        st.info = d || null;
        if (d && d.friend_cap) FRIEND_CAP = d.friend_cap;
      })
      .catch(function () {});
  }

  function summarize(jobId, prev) {
    api("/api/farm/mid-heart/job/" + encodeURIComponent(jobId))
      .then(function (d) {
        var got = Number(d.sent || 0);
        var b = d.billing || {};
        var parts = ["ได้ " + num(got) + " หัวใจ"];
        if (b.model === "token") {
          parts.push("จ่าย " + tok(b.charged || 0) + " Token");
          if (Number(b.refunded || 0) > 0) parts.push("คืน " + tok(b.refunded) + " Token");
        } else if (got > 0) {
          parts.push("ฟรี (ผู้เช่า)");
        }
        var kind = got > 0 ? "ok" : "warn";
        toast(parts.join(" · "), kind, got > 0 ? "จบงาน " + (prev && prev.name ? prev.name : "") : "จบงานโดยยังไม่ได้หัวใจ");
        if (typeof T().refreshMe === "function") T().refreshMe();
      })
      .catch(function () {});
  }

  function diffJobs(next) {
    var now = Date.now() / 1000;
    var ids = {};
    next.forEach(function (j) {
      ids[j.job_id] = 1;
      var p = j.progress || {};
      var sent = Number(p.current || 0);
      var prev = st.seen[j.job_id];
      var name = j.nickname || j.target_mid;
      if (prev && sent > prev.sent) {
        toast("+" + num(sent - prev.sent) + " หัวใจ (รวม " + num(sent) + "/" + num(j.count || p.total || 0) + ")", "ok", name);
      }
      var complete = String(p.phase || "") === "complete";
      if (prev && complete && !prev.complete) toast("ได้ครบแล้ว กด “ได้หัวใจแล้ว จบงาน” ได้เลย", "ok", name);
      var left = j.deadline ? j.deadline - now : 0;
      var warned = prev ? prev.warned : false;
      if (!complete && j.status === "running" && j.deadline && left > 0 && left <= WARN_LEFT_SEC && !warned && !j.finish_requested) {
        toast("เหลือเวลาไม่ถึง 5 นาที ถ้ายังรับไม่ครบ กด +30 นาที", "warn", name);
        warned = true;
      }
      if (left > WARN_LEFT_SEC) warned = false;
      st.seen[j.job_id] = { sent: sent, warned: warned, complete: complete, name: name };
    });
    Object.keys(st.seen).forEach(function (id) {
      if (!ids[id]) {
        summarize(id, st.seen[id]);
        delete st.seen[id];
      }
    });
  }

  function loadJobs() {
    return api("/api/farm/mid-heart/jobs")
      .then(function (d) {
        var next = (d && d.jobs) || [];
        diffJobs(next);
        st.jobs = next;
      })
      .catch(function () {});
  }

  // ── actions ───────────────────────────────────────────────────────────────
  function lookup(midArg) {
    var mid = cleanMid(midArg || ($("mh-mid") || {}).value);
    st.mid = mid;
    if (!/^[A-Z0-9]{4,24}$/.test(mid)) return showErr("MID ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 4–24 ตัว", "MID ไม่ถูกต้อง");
    st.looking = true;
    st.target = null;
    render();
    api("/api/farm/mid-heart/lookup", { method: "POST", body: { mid: mid } })
      .then(function (d) {
        st.target = d;
        rememberMid(d);
        st.count = String(Math.min(50, Math.max(0, Math.min(d.available || 0, d.count_max || 300))));
      })
      .catch(function (e) {
        showErr(errText(e), "ค้นหา MID ไม่สำเร็จ");
      })
      .then(function () {
        st.looking = false;
        render();
        var c = $("mh-count");
        if (c && st.target) c.focus();
      });
  }

  function start() {
    var t = T();
    var tg = st.target;
    if (!tg) return;
    var n = Math.floor(Number(($("mh-count") || {}).value) || 0);
    var max = maxCount();
    if (n < 1 || n > max) return showErr("ใส่จำนวน 1 – " + num(max) + " หัวใจ", "ยังเริ่มไม่ได้");
    if (typeof t.hasProfile === "function" && !t.hasProfile()) return t.requireFeatureAccess && t.requireFeatureAccess("mid_heart");
    st.count = String(n);
    var friends = String(st.friends).trim() === "" ? null : Math.floor(Number(st.friends));
    var preview = typeof t.tokenJobPreview === "function" ? t.tokenJobPreview("mid_heart", n, "mid_heart", {}) : null;
    Promise.resolve(
      t.showJobConfirmModal({
        title: "รับ " + num(n) + " หัวใจ เข้า " + (tg.nickname || tg.mid) + "?",
        body:
          "หลังกดเริ่ม ให้เข้าเกม → เมนูเพื่อน → คำขอเป็นเพื่อน แล้วกดรับทั้งหมด\n" +
          "รับ 1 คน = ได้ 1 หัวใจ · มีเวลา 1 ชม. (ขยายได้)\n" +
          "จ่ายเฉพาะหัวใจที่ได้จริง",
        icon: "assets/mid_heart.png?v=20261001",
        preview: preview,
      })
    ).then(function (ok) {
      if (!ok) return;
      st.starting = true;
      render();
      var body = { mid: tg.mid, count: n };
      if (friends !== null && isFinite(friends)) body.friends = friends;
      return api("/api/farm/mid-heart/run", { method: "POST", body: body })
        .then(function (d) {
          st.target = null;
          st.mid = "";
          st.friends = "";
          if (typeof t.refreshMe === "function") t.refreshMe();
          if (d && d.count && d.count < n) toast("เริ่มได้ " + num(d.count) + " หัวใจ (ตอนนี้ส่งได้เท่านี้)", "warn", "เริ่มงานแล้ว");
          else toast("เข้าเกมแล้วกดรับเพื่อนได้เลย", "info", "เริ่มงานแล้ว");
          return loadJobs();
        })
        .catch(function (e) {
          if (typeof t.handleFarmRunException === "function") t.handleFarmRunException(e, "mid_heart");
          else showErr(errText(e), "เริ่มงานไม่สำเร็จ");
        })
        .then(function () {
          st.starting = false;
          render();
        });
    });
  }

  function jobAction(jobId, act) {
    var t = T();
    var go = function () {
      st.busyJob[jobId] = true;
      render();
      var url =
        act === "cancel" ? "/api/farm/job/" + encodeURIComponent(jobId) + "/cancel" : "/api/farm/mid-heart/" + encodeURIComponent(jobId) + "/" + act;
      return api(url, { method: "POST", body: {} })
        .then(function () {
          if (act === "extend") toast("ขยายเวลาอีก 30 นาทีแล้ว", "ok");
          if (st.seen[jobId]) st.seen[jobId].warned = false;
        })
        .catch(function (e) {
          toast(errText(e), "err", "ทำรายการไม่สำเร็จ");
        })
        .then(function () {
          delete st.busyJob[jobId];
          return loadJobs();
        })
        .then(render);
    };
    if (act === "extend") return go();
    var c =
      act === "finish"
        ? { title: "ได้หัวใจแล้วใช่ไหม?", body: "กดยืนยันแล้วระบบจะจบงาน ลบเพื่อนที่เพิ่มให้ และคิด Token เฉพาะหัวใจที่ได้จริง" }
        : { title: "ยกเลิกงานนี้?", body: "ระบบจะหยุดรอ ลบเพื่อนที่เพิ่มไว้ และคิด Token เฉพาะหัวใจที่ได้ไปแล้ว" };
    Promise.resolve(t.showJobConfirmModal({ title: c.title, body: c.body, icon: "assets/mid_heart.png?v=20261001", preview: null })).then(function (ok) {
      if (ok) go();
    });
  }

  // ── events ────────────────────────────────────────────────────────────────
  function onClick(e) {
    var el = e.target.closest && e.target.closest("button");
    var root = $("mid-heart-page");
    if (!el || !root || !root.contains(el)) return;
    if (el.id === "mh-lookup") return lookup();
    if (el.id === "mh-start") return start();
    if (el.id === "mh-reset") {
      st.target = null;
      render();
      var m = $("mh-mid");
      if (m) m.focus();
      return;
    }
    var chipMid = el.getAttribute("data-mid");
    if (chipMid) {
      st.mid = chipMid;
      return lookup(chipMid);
    }
    var act = el.getAttribute("data-mh");
    var card = el.closest(".mh-job");
    if (act && card) jobAction(card.getAttribute("data-job"), act);
  }

  function onInput(e) {
    var id = e.target && e.target.id;
    if (id === "mh-count") {
      st.count = e.target.value;
      repaintForm();
    } else if (id === "mh-friends") {
      st.friends = e.target.value;
      repaintForm();
    } else if (id === "mh-mid") {
      st.mid = e.target.value;
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && e.target && e.target.id === "mh-mid") lookup();
  }

  function tickClock() {
    var now = Date.now() / 1000;
    document.querySelectorAll("#mid-heart-page [data-deadline]").forEach(function (el) {
      var left = Number(el.getAttribute("data-deadline")) - now;
      var span = Number(el.getAttribute("data-span")) || 3600;
      var complete = el.getAttribute("data-complete") === "1";
      el.textContent = fmtLeft(left);
      var box = el.closest(".mh-timer");
      var ring = box && box.querySelector(".mh-ring");
      var fg = ring && ring.querySelector(".mh-ring-fg");
      if (fg) {
        var C = Number(fg.getAttribute("stroke-dasharray")) || 163.4;
        fg.setAttribute("stroke-dashoffset", (C * (1 - Math.max(0, Math.min(1, left / span)))).toFixed(1));
      }
      if (ring) ring.className = "mh-ring " + toneFor(left, complete);
    });
  }

  function poll() {
    if (!st.shown) return;
    var a = document.activeElement;
    var typing = a && /^mh-(mid|count|friends)$/.test(a.id || "");
    loadJobs().then(function () {
      if (!typing) render();
    });
  }

  function bind() {
    var root = $("mid-heart-page");
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKey);
    // Polling re-renders the page every few seconds — keep the conditions box as the user left it.
    root.addEventListener(
      "toggle",
      function (e) {
        if (e.target && e.target.classList && e.target.classList.contains("mh-rules")) st.rulesOpen = e.target.open;
      },
      true
    );
  }

  function onShow() {
    st.shown = true;
    bind();
    var root = $("mid-heart-page");
    if (root && !root.innerHTML) root.innerHTML = '<div class="mh-loading">กำลังโหลด…</div>';
    Promise.all([loadInfo(), loadJobs()]).then(render);
    clearInterval(st.timer);
    clearInterval(st.tick);
    st.timer = setInterval(poll, POLL_MS);
    st.tick = setInterval(tickClock, 1000);
  }

  function onHide() {
    st.shown = false;
    clearInterval(st.timer);
    clearInterval(st.tick);
  }

  window.CKRMidHeart = { onShow: onShow, onHide: onHide };
})();
