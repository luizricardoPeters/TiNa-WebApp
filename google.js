/* TiNa-WebApp: Verbindung zu Google (Gmail und Kalender) direkt aus dem Browser.
   Es gibt keinen eigenen Server. Die Anmeldung läuft über Google Identity Services,
   das Zugriffs-Token gilt etwa eine Stunde und liegt nur im Speicher dieses Geräts. */
(function (root) {
  "use strict";
  var CFG = root.TINA_CONFIG || {};
  var L = root.TinaLogic;
  var SCOPES = [
    "openid", "email", "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
  ].join(" ");
  var KEY = "tina_google";
  var GM = "https://gmail.googleapis.com/gmail/v1/users/me";
  var CAL = "https://www.googleapis.com/calendar/v3";

  var S = { token: null, expires: 0, scope: "", email: "", name: "", given: "" };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.token) { S.token = saved.token; S.expires = saved.expires || 0; S.scope = saved.scope || ""; S.email = saved.email || ""; S.name = saved.name || ""; S.given = saved.given || ""; }
  } catch (e) { /* Speicher gesperrt: dann eben ohne */ }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* egal */ }
  }

  function AuthError(msg) { this.name = "AuthError"; this.message = msg || "Anmeldung abgelaufen"; }
  AuthError.prototype = Object.create(Error.prototype);

  function valid() { return !!S.token && Date.now() < S.expires - 60000; }
  function has(feature) {
    var s = " " + S.scope + " ";
    function g(x) { return s.indexOf("/auth/" + x + " ") >= 0; }
    if (feature === "mail") return g("gmail.readonly");
    if (feature === "send") return g("gmail.send");
    if (feature === "cal") return g("calendar.events") && g("calendar.calendarlist.readonly");
    return false;
  }

  /* ---------- Anmeldung ---------- */
  var gis = null, client = null, pending = null;
  function init() {
    if (gis) return gis;
    gis = new Promise(function (res, rej) {
      if (root.google && google.accounts && google.accounts.oauth2) return res();
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { gis = null; rej(new Error("Die Google-Anmeldung konnte nicht geladen werden. Bitte die Internetverbindung prüfen.")); };
      document.head.appendChild(s);
    }).then(function () {
      client = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID, scope: SCOPES,
        callback: onToken,
        error_callback: function (err) {
          var p = pending; pending = null;
          if (p) p.rej(new Error(err && err.type === "popup_closed" ? "Das Anmeldefenster wurde geschlossen." : "Die Anmeldung ist nicht möglich (" + ((err && err.type) || "unbekannt") + "). Erlaubt der Browser Pop-up-Fenster?"));
        }
      });
    });
    return gis;
  }
  function onToken(resp) {
    var p = pending; pending = null;
    if (!resp || resp.error) { if (p) p.rej(new Error("Anmeldung abgelehnt: " + ((resp && (resp.error_description || resp.error)) || "unbekannt"))); return; }
    S.token = resp.access_token;
    S.expires = Date.now() + (+resp.expires_in || 3600) * 1000;
    S.scope = resp.scope || "";
    save();
    fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + S.token } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (u) {
        if (u.email) S.email = u.email;
        if (u.name) S.name = u.name;
        if (u.given_name) S.given = u.given_name;
        save();
        if (p) p.res();
      });
  }
  /* Muss direkt im Klick aufgerufen werden, sonst blockiert der Browser das Fenster. */
  function connect(forceConsent) {
    if (!client) return Promise.reject(new Error("Die Google-Anmeldung ist noch nicht geladen. Bitte einen Moment warten und noch einmal tippen."));
    return new Promise(function (res, rej) {
      pending = { res: res, rej: rej };
      var o = {};
      if (forceConsent) o.prompt = "consent";
      if (S.email) o.login_hint = S.email;
      client.requestAccessToken(o);
    });
  }
  function disconnect() {
    var t = S.token;
    S = { token: null, expires: 0, scope: "", email: "", name: "", given: "" };
    try { localStorage.removeItem(KEY); } catch (e) { /* egal */ }
    if (t && root.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(t, function () {}); } catch (e) { /* egal */ } }
  }

  /* ---------- Grundaufruf ---------- */
  function api(url, o) {
    o = o || {};
    if (!valid()) return Promise.reject(new AuthError());
    var h = { Authorization: "Bearer " + S.token };
    if (o.json) h["Content-Type"] = "application/json";
    return fetch(url, { method: o.method || "GET", headers: h, body: o.json ? JSON.stringify(o.json) : undefined }).then(function (r) {
      if (r.status === 401) throw new AuthError();
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var e = new Error((j.error && (j.error.message || j.error.status)) || ("Fehler " + r.status));
        e.status = r.status; throw e;
      });
    });
  }
  function inChunks(items, n, fn) {
    var out = [], i = 0;
    return (function next() {
      if (i >= items.length) return Promise.resolve(out);
      var part = items.slice(i, i + n); i += n;
      return Promise.all(part.map(fn)).then(function (r) { out = out.concat(r); return next(); });
    })();
  }
  function swallow(counter) {
    return function (e) { if (e instanceof AuthError) throw e; counter.failed++; counter.last = e; return null; };
  }

  /* ---------- Gmail ---------- */
  function inbox(days, limit) {
    var q = "in:inbox newer_than:" + days + "d";
    var cnt = { failed: 0, last: null };
    return api(GM + "/threads?maxResults=" + limit + "&q=" + encodeURIComponent(q)).then(function (r) {
      return inChunks(r.threads || [], 5, function (t) {
        return api(GM + "/threads/" + t.id + "?format=full").then(function (th) { return normThread(th); }).catch(swallow(cnt));
      });
    }).then(function (list) {
      return { mails: list.filter(Boolean), failed: cnt.failed, last: cnt.last };
    });
  }
  function normThread(th) {
    var msgs = (th.messages || []).slice().sort(function (a, b) { return +a.internalDate - +b.internalDate; });
    if (!msgs.length) return null;
    var last = msgs[msgs.length - 1];
    var answered = (last.labelIds || []).indexOf("SENT") >= 0;
    var target = null;
    for (var i = msgs.length - 1; i >= 0; i--) { if ((msgs[i].labelIds || []).indexOf("SENT") < 0) { target = msgs[i]; break; } }
    if (!target) return null;
    var h = L.headerMap(target.payload && target.payload.headers);
    var from = L.parseFrom(h["from"]);
    var reply = L.parseFrom(h["reply-to"] || h["from"]);
    return {
      id: target.id, threadId: th.id,
      fromName: from.name, fromEmail: from.email, replyTo: reply.email,
      from: from.name || from.email, subj: h["subject"] || "(ohne Betreff)",
      body: L.extractBody(target.payload) || (target.snippet || ""),
      answered: answered, unread: (target.labelIds || []).indexOf("UNREAD") >= 0,
      messageId: h["message-id"] || "", references: h["references"] || "",
      ts: +target.internalDate
    };
  }
  function sendReply(o) {
    var raw = L.encodeB64Url(L.buildReplyMime(o));
    return api(GM + "/messages/send", { method: "POST", json: { raw: raw, threadId: o.threadId } });
  }

  /* ---------- Kalender ---------- */
  var TZ = CFG.TIMEZONE || "Europe/Berlin";
  var fDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  var fTime = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  function calendars() {
    return api(CAL + "/users/me/calendarList?minAccessRole=reader").then(function (r) {
      return (r.items || []).filter(function (c) { return c.selected !== false; });
    });
  }
  function expandEvent(ev, calName, out) {
    var title = ev.summary || "(ohne Titel)", place = ev.location || "";
    if (ev.start && ev.start.date) {
      var d = L.parseKey(ev.start.date), end = L.parseKey(ev.end && ev.end.date || ev.start.date), n = 0;
      while (d < end && n < 14) { out.push({ date: L.dateKey(d), time: null, title: title, place: place, src: calName }); d.setDate(d.getDate() + 1); n++; }
      if (!n) out.push({ date: ev.start.date, time: null, title: title, place: place, src: calName });
    } else if (ev.start && ev.start.dateTime) {
      var dt = new Date(ev.start.dateTime);
      out.push({ date: fDate.format(dt), time: fTime.format(dt), title: title, place: place, src: calName });
    }
  }
  function events(days) {
    var from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from); to.setDate(to.getDate() + days);
    var cnt = { failed: 0, last: null };
    return calendars().then(function (cals) {
      return Promise.all(cals.map(function (c) {
        var url = CAL + "/calendars/" + encodeURIComponent(c.id) + "/events?singleEvents=true&orderBy=startTime&maxResults=100" +
          "&timeMin=" + encodeURIComponent(from.toISOString()) + "&timeMax=" + encodeURIComponent(to.toISOString());
        return api(url).then(function (r) {
          var out = []; (r.items || []).forEach(function (ev) { if (ev.status !== "cancelled") expandEvent(ev, c.summaryOverride || c.summary || "Kalender", out); });
          return out;
        }).catch(function (e) { swallow(cnt)(e); return []; });
      }));
    }).then(function (lists) {
      var all = [].concat.apply([], lists);
      all.sort(function (a, b) { return (a.date + (a.time || "00:00")) < (b.date + (b.time || "00:00")) ? -1 : 1; });
      return { events: all, failed: cnt.failed, last: cnt.last };
    });
  }
  function createEvent(o) {
    var body = { summary: o.title };
    if (o.place) body.location = o.place;
    if (o.time) {
      var st = new Date(Date.UTC(+o.date.slice(0, 4), +o.date.slice(5, 7) - 1, +o.date.slice(8, 10), +o.time.slice(0, 2), +o.time.slice(3, 5)));
      var en = new Date(st.getTime() + 3600000);
      var iso = function (d) { return d.toISOString().slice(0, 19); };
      body.start = { dateTime: iso(st), timeZone: TZ };
      body.end = { dateTime: iso(en), timeZone: TZ };
    } else {
      var next = L.parseKey(o.date); next.setDate(next.getDate() + 1);
      body.start = { date: o.date }; body.end = { date: L.dateKey(next) };
    }
    return api(CAL + "/calendars/primary/events", { method: "POST", json: body }).then(function () {
      return { date: o.date, time: o.time || null, title: o.title, place: o.place || "", src: "Google" };
    });
  }

  root.TinaGoogle = {
    configured: function () { return !!CFG.GOOGLE_CLIENT_ID; },
    init: init, connect: connect, disconnect: disconnect,
    valid: valid, has: has, wasConnected: function () { return !!S.token; },
    email: function () { return S.email; }, name: function () { return S.name; }, given: function () { return S.given; },
    expiresIn: function () { return Math.max(0, S.expires - Date.now()); },
    inbox: inbox, sendReply: sendReply, events: events, createEvent: createEvent,
    AuthError: AuthError
  };
})(window);
