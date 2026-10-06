/* Bot-Ad — Android bot key shop. Frontend only. */
(function () {
  var IMG = "assets/token_bot.png";
  var REASONS = {
    insufficient_bot_tokens: "Token Bot ไม่พอ",
    has_keys_use_renew: "มีคีย์อยู่แล้ว ใช้ต่ออายุแทนการออกคีย์ใหม่",
    base_expired_renew_first: "คีย์ตั้งต้นหมดอายุแล้ว ต่ออายุก่อน",
    key_permanent: "คีย์ถาวรต่ออายุหรือเพิ่มจอไม่ได้",
    not_your_key: "คีย์นี้ไม่ใช่ของคุณ",
    pack_not_found: "ไม่พบแพ็ก",
    rate_limited: "ทำรายการถี่เกินไป ลองใหม่อีกครั้ง",
    cooldown: "ยังย้ายเครื่องไม่ได้",
    not_bound: "คีย์นี้ยังไม่ผูกเครื่อง",
    login_required: "เข้าสู่ระบบก่อน",
  };
  var st = { shop: null, packId: "", pick: {}, reveal: "", busy: false, pending: null, timer: 0 };

  function T() { return window.CKR_TOOLS || {}; }
  function root() { return document.getElementById("bot-ad-page"); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return "0";
    if (typeof T().formatTokenAmount === "function") return T().formatTokenAmount(v);
    return String(Math.round(v));
  }
  function deviceLabel(short) {
    var s = String(short || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (!s) return "";
    return s.slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");
  }
  function fmtLeft(iso) {
    var t = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(t)) return "";
    if (t <= 0) return "หมดอายุแล้ว";
    var s = Math.floor(t / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (x) { return (x < 10 ? "0" : "") + x; };
    return (d ? d + " วัน " : "") + pad(h) + ":" + pad(m) + ":" + pad(sec);
  }
  function keyState(k) {
    if (k.status === "revoked") return { cls: "is-bad", text: "ถูกระงับ", dead: true, perm: false };
    if (k.is_permanent) return { cls: "is-ok", text: "ถาวร", dead: false, perm: true };
    var exp = k.expires_at ? new Date(k.expires_at).getTime() : 0;
    var dead = k.status === "expired" || (exp && exp <= Date.now());
    if (dead) return { cls: "is-warn", text: "หมดอายุ", dead: true, perm: false };
    return { cls: "is-ok", text: "ใช้งานได้", dead: false, perm: false };
  }
  function reasonText(data) {
    var reason = (data && (data.reason || data.detail)) || "";
    if (reason && typeof reason === "object") reason = reason.code || reason.message || "";
    var msg = REASONS[reason] || (reason ? String(reason) : "ไม่สำเร็จ");
    if (reason === "insufficient_bot_tokens" && data) {
      msg += " · ต้องใช้ " + num(data.price) + " คงเหลือ " + num(data.balance);
    }
    if (reason === "cooldown" && data && data.next_at) {
      msg += " · ได้อีกครั้ง " + fmtLeft(data.next_at).replace("หมดอายุแล้ว", "ตอนนี้");
    }
    return msg;
  }
  function fail(e) {
    var data = e && e.data ? e.data : {};
    if (typeof T().showErrorModal === "function") T().showErrorModal(reasonText(data.reason ? data : { reason: e && e.message }));
  }
  function shopCall(path, body) {
    var api = T().api;
    var opts = body ? { method: "POST", body: body } : {};
    return api(path, opts).then(function (d) {
      if (d && d.ok === false) {
        var err = new Error(d.reason || "failed");
        err.data = d;
        throw err;
      }
      return d;
    });
  }
  function paintPill(n) {
    if (typeof T().setBotTokenBalance === "function") T().setBotTokenBalance(n);
  }
  function selectedPack() {
    var packs = (st.shop && st.shop.packs) || [];
    for (var i = 0; i < packs.length; i++) if (packs[i].id === st.packId) return packs[i];
    return null;
  }
  function pickedIds() { return Object.keys(st.pick).filter(function (id) { return st.pick[id]; }); }
  function quote(kind, n) {
    var pack = selectedPack();
    var extra = Number(st.shop && st.shop.extra_screen_price) || 50;
    if (kind === "new") return pack ? Number(pack.price) || 0 : 0;
    if (kind === "renew") return pack && n > 0 ? (Number(pack.price) || 0) + extra * (n - 1) : 0;
    if (kind === "extra") return extra;
    return 0;
  }
  function ask(pending) {
    st.pending = pending;
    var box = document.getElementById("bad-modal");
    var body = document.getElementById("bad-modal-body");
    if (!box || !body) return;
    var bal = Number(st.shop && st.shop.bot_token_balance) || 0;
    var after = bal - pending.price;
    body.innerHTML =
      "<b>" + esc(pending.title) + "</b>" +
      "<p>หัก <strong>" + num(pending.price) + "</strong> Token Bot · หลังหักเหลือ <strong>" + num(after) + "</strong></p>";
    box.hidden = false;
  }
  function closeAsk() {
    st.pending = null;
    var box = document.getElementById("bad-modal");
    if (box) box.hidden = true;
  }
  function render() {
    var el = root();
    if (!el) return;
    var shop = st.shop;
    var logged = typeof T().loggedIn === "function" && T().loggedIn();
    if (!logged || !shop || shop.reason === "login_required") {
      el.innerHTML =
        '<div class="pcp-card bad-head"><img src="' + IMG + '" alt="" width="42" height="42" />' +
        "<div><b>Bot-Ad</b><p class=\"bad-note\">ร้านคีย์บอท Android · ใช้ Token Bot ไม่ใช้ DevPlay</p></div></div>" +
        '<div class="pcp-card"><button type="button" class="btn btn-candy" data-bad="login">เข้าสู่ระบบ</button></div>';
      return;
    }
    var bal = Number(shop.bot_token_balance) || 0;
    var packs = (shop.packs || []).filter(function (p) { return p.active !== false; });
    var keys = shop.keys || [];
    var extra = Number(shop.extra_screen_price) || 50;
    var days = Number(shop.move_cooldown_days) || 30;
    var html = "";
    if (st.reveal) {
      html += '<div class="pcp-card bad-reveal"><b>คีย์ใหม่</b><code id="bad-new-key">' + esc(st.reveal) + "</code>" +
        '<p class="bad-note">คัดลอกแล้วไปกรอกในแอป WWDC BOT</p>' +
        '<button type="button" class="btn btn-candy" data-bad="copy">คัดลอกคีย์</button></div>';
    }
    html += '<div class="pcp-card bad-head"><img src="' + IMG + '" alt="" width="42" height="42" />' +
      "<div><b>Bot-Ad</b><p class=\"bad-note\">ร้านคีย์บอท Android</p></div>" +
      '<div class="bad-bal"><b>' + num(bal) + "</b><span>Token Bot</span></div></div>";
    html += '<div class="pcp-card bad-note">Token Bot ได้เป็นของแถมฟรีเมื่อเติม Token ปกติ (เติม 300 ได้ Token Bot 300) ใช้ซื้อและต่ออายุคีย์บอทได้ที่หน้านี้เท่านั้น</div>';
    html += '<div class="pcp-card" id="bad-packs"><b>เลือกแพ็ก</b><div class="bad-packs">';
    packs.forEach(function (p) {
      var days = p.days ? esc(p.days) + " วัน" : "";
      var cover = p.image_url
        ? '<img src="' + esc(p.image_url) + '" alt="" />'
        : "<span>" + (days || "แพ็ก") + "</span>";
      html += '<button type="button" class="bad-pack' + (p.id === st.packId ? " is-on" : "") + '" data-bad="pack" data-id="' + esc(p.id) + '">' +
        '<span class="bad-cover">' + cover + "</span>" +
        "<b>" + esc(p.label || p.name || p.id) + "</b>" +
        '<span class="bad-pack-meta">' + (days ? days + " · " : "") + num(p.price) + " Token Bot</span></button>";
    });
    html += "</div>";
    if (!shop.has_keys) {
      html += '<div class="bad-acts" style="margin-top:10px"><button type="button" class="btn btn-candy" data-bad="new"' + (st.busy ? " disabled" : "") + ">ออกคีย์ใหม่</button></div>";
    }
    html += "</div>";
    html += '<div class="pcp-card"><b>คีย์ของฉัน</b>';
    if (!keys.length) {
      html += '<p class="bad-note">ยังไม่มีคีย์</p>';
    }
    keys.forEach(function (k) {
      var stt = keyState(k);
      var dev = deviceLabel(k.device_short);
      html += '<div class="bad-key">';
      html += '<div class="bad-key-top"><code>' + esc(k.key_prefix || k.id) + "</code>";
      html += '<span class="pcp-badge ' + stt.cls + '">' + stt.text + "</span>";
      if (!stt.perm && k.expires_at) {
        html += '<span data-bad-exp="' + esc(k.expires_at) + '">' + esc(fmtLeft(k.expires_at)) + "</span>";
      }
      html += "</div>";
      html += '<div class="bad-note">เครื่อง: <b>' + (dev ? esc(dev) : "ยังไม่ผูกเครื่อง") + "</b>";
      if (k.notes) html += " · " + esc(k.notes);
      html += "</div>";
      html += '<div class="bad-acts">';
      if (!stt.perm && k.status !== "revoked") {
        html += '<label class="bad-note"><input type="checkbox" data-bad="pick" data-id="' + esc(k.id) + '"' + (st.pick[k.id] ? " checked" : "") + " /> เลือกต่ออายุ</label>";
      }
      if (!stt.perm && !stt.dead && k.status !== "revoked") {
        html += '<button type="button" class="btn btn-ghost" data-bad="extra" data-id="' + esc(k.id) + '">+ ซื้อจอเสริม (' + num(extra) + ")</button>";
      }
      if (dev) {
        html += '<button type="button" class="btn btn-ghost" data-bad="move" data-id="' + esc(k.id) + '">ย้ายเครื่อง</button>';
      }
      html += "</div></div>";
    });
    if (shop.has_keys) {
      html += '<div class="bad-acts"><button type="button" class="btn btn-candy" data-bad="renew"' + (st.busy ? " disabled" : "") + ">ต่ออายุคีย์ที่เลือก</button></div>";
    }
    html += '<p class="bad-note">เพิ่มจอครั้งละ ' + num(extra) + " Token Bot · ย้ายเครื่องได้ทุก " + days +
      " วัน · เลขเครื่องตรงกับแอป WWDC BOT 0.0.6 ขึ้นไป ที่ ตั้งค่า &gt; รหัสเครื่องนี้</p></div>";
    html += '<div class="bad-modal" id="bad-modal" hidden><div class="bad-modal-card"><div id="bad-modal-body"></div>' +
      '<div class="bad-acts"><button type="button" class="btn btn-candy" data-bad="confirm">ยืนยัน</button>' +
      '<button type="button" class="btn btn-ghost" data-bad="cancel">ยกเลิก</button></div></div></div>';
    el.innerHTML = html;
  }
  function tick() {
    document.querySelectorAll("[data-bad-exp]").forEach(function (node) {
      node.textContent = fmtLeft(node.getAttribute("data-bad-exp"));
    });
  }
  function load() {
    if (typeof T().loggedIn === "function" && !T().loggedIn()) {
      st.shop = null;
      render();
      return Promise.resolve();
    }
    return shopCall("/api/android/v1/shop").then(function (d) {
      st.shop = d;
      paintPill(d.bot_token_balance);
      var ids = {};
      (d.keys || []).forEach(function (k) { ids[k.id] = true; });
      Object.keys(st.pick).forEach(function (id) { if (!ids[id]) delete st.pick[id]; });
      render();
    }).catch(function (e) {
      if (e && e.data && e.data.reason === "login_required") {
        st.shop = null;
        render();
        return;
      }
      fail(e);
      render();
    });
  }
  function afterBuy(d) {
    if (d && d.new_key) st.reveal = d.new_key;
    if (d && d.bot_token_balance != null) paintPill(d.bot_token_balance);
    return load();
  }
  function buy(kind, licenseIds) {
    var pack = selectedPack();
    if (kind !== "extra" && !pack) return fail({ data: { reason: "pack_not_found" } });
    var ids = licenseIds || [];
    var price = quote(kind, ids.length || 1);
    var title = kind === "new" ? "ออกคีย์ใหม่" : kind === "renew" ? "ต่ออายุ " + ids.length + " คีย์" : "เพิ่มจอ";
    var packId = pack ? pack.id : (((st.shop && st.shop.packs) || [])[0] || {}).id || "";
    ask({ kind: kind, pack_id: packId, license_ids: ids, price: price, title: title });
  }
  function confirmBuy() {
    var p = st.pending;
    if (!p || st.busy) return;
    st.busy = true;
    closeAsk();
    shopCall("/api/android/v1/shop/buy", {
      kind: p.kind,
      pack_id: p.pack_id,
      license_ids: p.license_ids,
    }).then(afterBuy).catch(fail).then(function () { st.busy = false; render(); });
  }
  function move(id) {
    if (st.busy) return;
    var days = Number(st.shop && st.shop.move_cooldown_days) || 30;
    if (!window.confirm("ปลดเครื่องของคีย์นี้ แล้วย้ายได้อีกครั้งใน " + days + " วัน\nไม่หัก Token Bot")) return;
    st.busy = true;
    shopCall("/api/android/v1/shop/move", { license_id: id }).then(function () {
      return load();
    }).catch(fail).then(function () { st.busy = false; });
  }
  function onClick(ev) {
    var btn = ev.target.closest("[data-bad]");
    if (!btn || !root() || !root().contains(btn)) {
      if (ev.target.id === "bad-modal") closeAsk();
      return;
    }
    var a = btn.getAttribute("data-bad");
    if (a === "login" && typeof T().openAuthModal === "function") T().openAuthModal("login");
    if (a === "pack") {
      st.packId = btn.getAttribute("data-id") || "";
      render();
    }
    if (a === "pick") {
      var id = btn.getAttribute("data-id");
      st.pick[id] = btn.checked;
      return;
    }
    if (a === "new") {
      if (st.shop && st.shop.has_keys) return fail({ data: { reason: "has_keys_use_renew" } });
      buy("new", []);
    }
    if (a === "renew") {
      var ids = pickedIds();
      if (!ids.length) return fail({ data: { reason: "เลือกคีย์ก่อนต่ออายุ" } });
      buy("renew", ids);
    }
    if (a === "extra") buy("extra", [btn.getAttribute("data-id")]);
    if (a === "move") move(btn.getAttribute("data-id"));
    if (a === "cancel") closeAsk();
    if (a === "confirm") confirmBuy();
    if (a === "copy") {
      var key = st.reveal;
      var done = function () { btn.textContent = "คัดลอกแล้ว"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(key).then(done).catch(done);
      else done();
    }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", function (ev) {
    var box = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-bad") === "pick" ? ev.target : null;
    if (!box) return;
    st.pick[box.getAttribute("data-id")] = !!box.checked;
  });
  setInterval(function () {
    var page = root();
    if (!page || page.closest(".hidden")) return;
    var logged = typeof T().loggedIn === "function" && T().loggedIn();
    if (logged && !st.shop && !st.busy) load();
  }, 1500);

  function showTour() {
    var wrap = document.getElementById("bot-tour-wrap");
    var frame = document.getElementById("bot-tour-frame");
    if (!wrap || !frame) return;
    wrap.hidden = false;
    if (!frame.getAttribute("src")) frame.setAttribute("src", "/bot-tour?v=1");
  }

  function onShow() {
    if (!st.timer) st.timer = setInterval(tick, 1000);
    showTour();
    load();
  }

  window.addEventListener("message", function (ev) {
    if (ev.origin !== location.origin || !ev.data) return;
    var frame = document.getElementById("bot-tour-frame");
    if (ev.data.type === "bot-tour-height" && frame && Number(ev.data.h) > 200) {
      frame.style.height = Math.ceil(Number(ev.data.h)) + "px";
    }
    if (ev.data.type === "bot-tour-buy") {
      var packs = document.getElementById("bad-packs") || root();
      if (packs) packs.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  window.CKRBotAd = { onShow: onShow };

  var panel = document.getElementById("farm-panel-bot_ad");
  if (panel && panel.classList.contains("is-active")) onShow();
})();
