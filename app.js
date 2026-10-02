/* TiNa-WebApp: Oberfläche. Zwei Betriebsarten:
   - Demo: keine Google-Client-ID in config.js -> Beispieldaten.
   - Echt: Gmail und Google Kalender über google.js. */
(function () {
  "use strict";
  var CFG = window.TINA_CONFIG || {}, L = window.TinaLogic, G = window.TinaGoogle;
  var DEMO = !G.configured();

  var CATS = {
    fam: { name: "Familie", color: "var(--c-fam)" },
    term: { name: "Termine", color: "var(--c-term)" },
    rech: { name: "Rechnungen", color: "var(--c-rech)" },
    post: { name: "Post & Einkauf", color: "var(--c-post)" },
    sonst: { name: "Sonstiges", color: "var(--c-sonst)" }
  };
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function addDays(n) { var d = new Date(today); d.setDate(d.getDate() + n); return d; }
  function key(d) { return L.dateKey(d); }
  function fmt(d, o) { return new Intl.DateTimeFormat("de-DE", o).format(d); }
  function longDay(d) { return fmt(d, { weekday: "long", day: "numeric", month: "long" }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- kleine Ablage auf dem Gerät ---------- */
  function lsGet(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }
  function famList() { return lsGet("tina_fam", "").split(/[,;\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
  function ownName() { return lsGet("tina_name", "") || G.given() || ""; }

  /* ---------- Daten ---------- */
  var dentist = addDays(6);
  var state = {
    tab: "home", openMail: null, filter: "alle", day: 0, size: lsGet("tina_size", "normal"),
    confirmSend: null, sending: false, sendErr: "",
    mails: [], events: [], notes: [],
    mailSt: "idle", mailErr: "", mailNote: "", calSt: "idle", calErr: "", calNote: "",
    gisReady: false, connecting: false, connectErr: "", loadedAt: 0
  };
  var PROJECTS = DEMO ? ["Familie", "Haushalt", "Urlaub"] : ["Allgemein", "Tiere", "Organisation"];
  state.project = PROJECTS[0];

  if (DEMO) {
    state.mails = [
      { id: "1", fromName: "Anna (Tochter)", from: "Anna (Tochter)", subj: "Sonntag zum Kaffee?", cat: "fam", answered: false, unread: true,
        body: "Hallo Mama,\n\nhättest du am Sonntag Lust, bei uns zum Kaffee vorbeizukommen? Die Kinder würden sich sehr freuen. Wir backen auch einen Kuchen.\n\nLiebe Grüße\nAnna",
        reply: "Liebe Anna,\n\nsehr gerne, ich komme am Sonntag zum Kaffee. Soll ich etwas mitbringen?\n\nLiebe Grüße\nMama" },
      { id: "2", fromName: "Zahnarztpraxis Dr. Weber", from: "Zahnarztpraxis Dr. Weber", subj: "Terminerinnerung", cat: "term", answered: false, unread: true,
        body: "Sehr geehrte Patientin,\n\nwir erinnern Sie an Ihren Termin am " + longDay(dentist) + " um 15:30 Uhr zur Kontrolluntersuchung.\n\nBitte geben Sie uns Bescheid, falls Sie den Termin nicht wahrnehmen können.\n\nIhre Praxis Dr. Weber",
        termin: { title: "Zahnarzt Kontrolle", date: key(dentist), time: "15:30", place: "Praxis Dr. Weber" },
        reply: "Sehr geehrte Damen und Herren,\n\nvielen Dank für die Erinnerung. Ich werde den Termin wahrnehmen.\n\nMit freundlichen Grüßen" },
      { id: "3", fromName: "Stadtwerke", from: "Stadtwerke", subj: "Ihre Jahresabrechnung", cat: "rech", answered: false, unread: false,
        body: "Sehr geehrte Kundin,\n\nIhre Jahresabrechnung liegt im Kundenportal bereit. Ein Guthaben wird in den nächsten Tagen überwiesen.\n\nIhre Stadtwerke",
        reply: "Sehr geehrte Damen und Herren,\n\nvielen Dank für die Information. Die Abrechnung habe ich zur Kenntnis genommen.\n\nMit freundlichen Grüßen" },
      { id: "4", fromName: "Renate", from: "Renate", subj: "Spaziergang am Samstag", cat: "fam", answered: false, unread: true,
        body: "Liebe Freundin,\n\nwollen wir am Samstag um 10 Uhr zusammen eine Runde im Park drehen? Das Wetter soll gut werden.\n\nHerzlich\nRenate",
        termin: { title: "Spaziergang mit Renate", date: key(addDays(1)), time: "10:00", place: "Stadtpark" },
        reply: "Liebe Renate,\n\ngerne, Samstag um 10 Uhr passt gut. Treffen wir uns am Parkeingang?\n\nHerzlich" },
      { id: "5", fromName: "Versandhaus Lindner", from: "Versandhaus Lindner", subj: "Ihr Paket ist unterwegs", cat: "post", answered: true, unread: false,
        body: "Ihr Paket wurde versendet und wird voraussichtlich in drei Tagen zugestellt.", reply: "" }
    ];
    state.events = [
      { d: 0, time: "09:30", title: "Physiotherapie", place: "Praxis Müller", src: "Google-Kalender" },
      { d: 0, time: "15:00", title: "Kaffee mit Nachbarin", place: "Zuhause", src: "iPhone-Kalender" },
      { d: 1, time: "10:00", title: "Wochenmarkt", place: "Marktplatz", src: "Google-Kalender" },
      { d: 2, time: "14:30", title: "Kaffee bei Anna", place: "Annas Wohnung", src: "Google-Kalender" },
      { d: 4, time: "11:00", title: "Friseur", place: "Salon Roth", src: "iPhone-Kalender" }
    ].map(function (e) { e.date = key(addDays(e.d)); return e; });
    state.notes = [
      { id: 1, project: "Familie", who: "Anna", when: "heute, 09:12", text: "Geburtstagsgeschenk für Opa: Gutschein oder lieber ein Buch?" },
      { id: 2, project: "Familie", who: "Mama", when: "gestern", text: "Sonntagskuchen: Apfel- oder Zwetschgenkuchen?" },
      { id: 3, project: "Haushalt", who: "Papa", when: "heute, 08:40", text: "Heizung: Wartungstermin im Oktober vereinbaren." },
      { id: 4, project: "Urlaub", who: "Anna", when: "Montag", text: "Ferienhaus Nordsee: drei Angebote verglichen, Liste folgt." }
    ];
  } else {
    try { state.notes = JSON.parse(lsGet("tina_notes", "[]")) || []; } catch (e) { state.notes = []; }
  }

  /* ---------- Hilfen ---------- */
  var $view = document.getElementById("view"), $nav = document.getElementById("nav"), $title = document.getElementById("title"), $toast = document.getElementById("toast"), $sample = document.getElementById("sample"), tt, et;
  function toast(msg) { $toast.textContent = msg; $toast.hidden = false; clearTimeout(tt); tt = setTimeout(function () { $toast.hidden = true; }, 4200); }
  function friendly(e) {
    if (!e) return "Unbekannter Fehler.";
    if (e.status === 429) return "Google bremst gerade (zu viele Anfragen). Bitte in einer Minute neu laden.";
    if (e.status === 403) return "Zugriff verweigert oder die Schnittstelle ist in der Google Cloud Console noch nicht aktiviert. (" + e.message + ")";
    if (e instanceof TypeError) return "Keine Internetverbindung.";
    return e.message || "Unbekannter Fehler.";
  }
  function ready() { return !DEMO && G.valid(); }
  function scheduleExpiry() {
    clearTimeout(et);
    var ms = G.expiresIn() - 60000;
    if (ms > 0) et = setTimeout(render, Math.min(ms, 2147000000) + 1500);
  }
  function cleanSubj(s) { return String(s || "").replace(/^\s*((re|aw|fwd?|wg)\s*:\s*)+/i, "").trim(); }
  function isAuth(e) { return e instanceof G.AuthError; }

  function classify(m) {
    var now = new Date();
    m.cat = L.categorize({ subject: m.subj, body: m.body, fromEmail: m.fromEmail }, { familyAddresses: famList(), today: now });
    m.appt = L.detectAppointment(m.subj + " " + String(m.body).slice(0, 3000), now);
    m.termin = m.appt ? { title: cleanSubj(m.subj), date: m.appt.date, time: m.appt.time, place: "" } : null;
    m.reply = L.suggestReply({ fromName: m.fromName, fromEmail: m.fromEmail, cat: m.cat, appt: m.appt }, { ownName: ownName() });
    return m;
  }

  /* ---------- Laden (nur echter Modus) ---------- */
  function loadMail() {
    if (!G.has("mail")) { state.mailSt = "noscope"; return Promise.resolve(); }
    state.mailSt = "loading"; render();
    return G.inbox(CFG.MAIL_DAYS || 30, CFG.MAIL_LIMIT || 15).then(function (r) {
      state.mails = r.mails.map(classify);
      state.mailSt = "ok";
      state.mailNote = r.failed ? r.failed + " E-Mail(s) konnten nicht geladen werden: " + friendly(r.last) : "";
    }).catch(function (e) {
      if (isAuth(e)) { state.mailSt = "idle"; } else { state.mailSt = "error"; state.mailErr = friendly(e); }
    });
  }
  function loadCal() {
    if (!G.has("cal")) { state.calSt = "noscope"; return Promise.resolve(); }
    state.calSt = "loading"; render();
    return G.events(7).then(function (r) {
      state.events = r.events; state.calSt = "ok";
      state.calNote = r.failed ? r.failed + " Kalender konnten nicht geladen werden: " + friendly(r.last) : "";
    }).catch(function (e) {
      if (isAuth(e)) { state.calSt = "idle"; } else { state.calSt = "error"; state.calErr = friendly(e); }
    });
  }
  function loadAll() {
    if (!ready()) return render();
    scheduleExpiry();
    return Promise.all([loadMail(), loadCal()]).then(function () { state.loadedAt = Date.now(); render(); });
  }

  /* ---------- Bausteine ---------- */
  var ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    proj: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h8"/></svg>'
  };
  var TABS = [["home", "Heute"], ["mail", "E-Mail"], ["cal", "Kalender"], ["proj", "Projekte"]];
  var TITLES = { home: "Heute", mail: "E-Mail", cal: "Kalender", proj: "Projekte", settings: "Einstellungen" };

  function openMails() { return state.mails.filter(function (m) { return !m.answered; }); }
  function dayEvents(d) { var k = key(addDays(d)); return state.events.filter(function (e) { return e.date === k; }); }
  function catChip(c) { return '<span class="chip"><i style="background:' + CATS[c].color + '"></i>' + CATS[c].name + "</span>"; }
  function findMail(id) { return state.mails.filter(function (x) { return String(x.id) === String(id); })[0]; }
  function noteWhen(n) {
    if (!n.ts) return n.when || "";
    var d = new Date(n.ts), t = fmt(d, { hour: "2-digit", minute: "2-digit" });
    return key(d) === key(today) ? "heute, " + t : fmt(d, { day: "numeric", month: "numeric" }) + ", " + t;
  }
  function isToday(n) { return n.ts ? key(new Date(n.ts)) === key(today) : /heute/.test(n.when || ""); }

  function mailRow(m) {
    return '<button class="row' + (m.unread && !m.answered ? " unread" : "") + (m.answered ? " done" : "") + '" data-mail="' + esc(m.id) + '">' +
      '<span class="dot" style="background:' + CATS[m.cat].color + '"></span><span class="grow"><div class="t">' + esc(m.from) + '</div><div class="s">' + esc(m.subj) + (m.answered ? " · beantwortet" : "") + "</div></span></button>";
  }
  function eventRow(e) {
    var sub = [e.place, e.src].filter(Boolean).map(esc).join(" · ");
    return '<div class="row"><span class="time">' + (e.time || "Ganztag") + '</span><span class="grow"><div class="t">' + esc(e.title) + '</div><div class="s">' + sub + "</div></span></div>";
  }
  function noteCard(n) {
    return '<div class="note"><p>' + esc(n.text) + '</p><div class="who">' + esc(n.who) + " · " + esc(noteWhen(n)) + " · " + esc(n.project) + "</div></div>";
  }
  function connectCard() {
    var again = G.wasConnected();
    var h = '<div class="card" style="margin-bottom:20px"><h3>' + (again ? "Bitte neu verbinden" : "Mit Google verbinden") + "</h3>";
    if (again) {
      h += "<div>Aus Sicherheitsgründen läuft die Anmeldung nach etwa einer Stunde ab. Ein Tipp auf den Knopf genügt.</div>";
    } else {
      h += "<div>Damit die App deine E-Mails und Termine anzeigen kann, melde dich einmal bei Google an. Die Verbindung kannst du jederzeit in den Einstellungen wieder trennen.</div>" +
        '<div class="info">Google zeigt dabei vermutlich den Hinweis, dass die App nicht überprüft wurde. Das ist bei dieser privaten App normal. Dann auf „Erweitert“ tippen, danach auf „Weiter“ bzw. „TiNa-WebApp öffnen“. Auf der nächsten Seite bitte alle Häkchen setzen, sonst fehlt später etwas.</div>';
    }
    if (state.connectErr) h += '<div class="info" style="background:var(--warn-soft);color:var(--warn)">' + esc(state.connectErr) + "</div>";
    h += '<div class="btns"><button class="btn" data-connect="1"' + (state.connecting || !state.gisReady ? " disabled" : "") + ">" + (state.connecting ? "Warte auf Google …" : state.gisReady ? "Mit Google verbinden" : "Wird vorbereitet …") + "</button></div></div>";
    return h;
  }
  function stateBox(st, err, noscopeText) {
    if (st === "loading") return '<div class="empty">Lade …</div>';
    if (st === "error") return '<div class="info" style="background:var(--warn-soft);color:var(--warn)">' + esc(err) + "</div>";
    if (st === "noscope") return '<div class="info" style="background:var(--warn-soft);color:var(--warn)">' + noscopeText + "</div>";
    return "";
  }
  var NOMAIL = "Der Zugriff auf E-Mails wurde bei der Anmeldung nicht erlaubt. In den Einstellungen unter „Berechtigungen neu erteilen“ bitte alle Häkchen setzen.";
  var NOCAL = "Der Zugriff auf den Kalender wurde bei der Anmeldung nicht erlaubt. In den Einstellungen unter „Berechtigungen neu erteilen“ bitte alle Häkchen setzen.";

  /* ---------- Seiten ---------- */
  function home() {
    var open = openMails(), ev = dayEvents(0), fresh = state.notes.filter(isToday);
    var head = '<div class="hello"><h2>Heute</h2><p>' + longDay(today) + "</p></div>" + (!DEMO && !ready() ? connectCard() : "");
    var mailBox = DEMO || ready() || state.mails.length ? (stateBox(state.mailSt, state.mailErr, NOMAIL) ||
      (open.length ? open.slice(0, 3).map(mailRow).join("") : '<div class="empty">' + (state.mailSt === "ok" || DEMO ? "Alles beantwortet." : "Noch keine E-Mails geladen.") + "</div>")) : '<div class="empty">Nach dem Verbinden erscheinen hier die offenen E-Mails.</div>';
    var calBox = DEMO || ready() || state.events.length ? (stateBox(state.calSt, state.calErr, NOCAL) ||
      (ev.length ? ev.map(eventRow).join("") : '<div class="empty">Heute stehen keine Termine an.</div>')) : '<div class="empty">Nach dem Verbinden erscheinen hier die Termine von heute.</div>';
    return head +
      '<section class="sec"><div class="sec-head"><h3>Noch zu beantworten' + (state.mailSt === "ok" || DEMO ? " (" + open.length + ")" : "") + '</h3><button class="link" data-go="mail">Alle E-Mails</button></div><div class="list">' + mailBox + "</div></section>" +
      '<section class="sec"><div class="sec-head"><h3>Heute im Kalender</h3><button class="link" data-go="cal">Kalender</button></div><div class="list">' + calBox + "</div></section>" +
      '<section class="sec"><div class="sec-head"><h3>Neue Notizen</h3><button class="link" data-go="proj">Projekte</button></div><div class="list">' +
      (fresh.length ? fresh.map(noteCard).join("") : '<div class="empty">Heute hat noch niemand etwas notiert.</div>') + "</div></section>";
  }

  function mail() {
    var pre = !DEMO && !ready() ? connectCard() : "";
    if (!DEMO && !ready() && !state.mails.length) return pre;
    var sb = stateBox(state.mailSt, state.mailErr, NOMAIL);
    if (state.openMail) {
      var m = findMail(state.openMail);
      if (!m) { state.openMail = null; return mail(); }
      var t = "";
      if (m.termin) {
        t = '<div class="termin"><strong>Termin erkannt</strong><div>' + esc(m.termin.title) + ", " + longDay(new Date(m.termin.date + "T00:00")) + (m.termin.time ? " um " + m.termin.time + " Uhr" : "") + "</div>" +
          '<div class="btns"><button class="btn" data-addtermin="' + esc(m.id) + '"' + (m.added || (!DEMO && !(ready() && G.has("cal"))) ? " disabled" : "") + ">" + (m.added ? "Eingetragen" : "In Kalender eintragen") + "</button></div></div>";
      }
      var act;
      if (m.answered) act = '<div class="info">Diese E-Mail ist beantwortet.</div>';
      else if (state.confirmSend === String(m.id)) {
        act = '<label>Diese Antwort wird gesendet an ' + esc(m.replyTo || m.fromEmail || m.from) + '</label><div class="mail-body" style="background:var(--bg);border-radius:10px;padding:12px">' + esc(m.reply) + "</div>" +
          (state.sendErr ? '<div class="info" style="background:var(--warn-soft);color:var(--warn)">' + esc(state.sendErr) + "</div>" : "") +
          '<div class="btns"><button class="btn" data-sendyes="1"' + (state.sending ? " disabled" : "") + ">" + (state.sending ? "Sende …" : "Ja, jetzt senden") + '</button><button class="btn ghost" data-sendno="1"' + (state.sending ? " disabled" : "") + ">Noch ändern</button></div>";
      } else {
        act = '<label for="reply">Vorgeschlagene Antwort (bitte prüfen und bei Bedarf ändern)</label><textarea id="reply">' + esc(m.reply) + "</textarea>" +
          (!DEMO && !G.has("send") ? '<div class="info" style="background:var(--warn-soft);color:var(--warn)">Das Senden wurde bei der Anmeldung nicht erlaubt. Bitte in den Einstellungen die Berechtigungen neu erteilen.</div>' : "") +
          '<div class="btns"><button class="btn" data-send="' + esc(m.id) + '"' + (!DEMO && !(ready() && G.has("send")) ? " disabled" : "") + '>Antwort senden</button><button class="btn ghost" data-back="1">Später</button></div>';
      }
      return pre + '<div class="card"><button class="link back" data-back="1">‹ Zurück zur Liste</button><div class="mail-head">' + catChip(m.cat) + '<h2 style="margin-top:8px">' + esc(m.subj) + '</h2><div class="s" style="color:var(--muted)">von ' + esc(m.from) + (m.fromEmail && m.fromName ? " (" + esc(m.fromEmail) + ")" : "") + '</div></div><div class="mail-body">' + esc(m.body) + "</div>" + t + act + "</div>";
    }
    var f = ["alle"].concat(Object.keys(CATS));
    var list = state.mails.filter(function (m) { return state.filter === "alle" || m.cat === state.filter; });
    return pre + (sb && !state.mails.length ? sb : "") + (state.mailNote ? '<div class="info" style="margin-bottom:12px">' + esc(state.mailNote) + "</div>" : "") +
      '<div class="filters" role="group" aria-label="Kategorien">' + f.map(function (k) { return '<button data-filter="' + k + '" aria-pressed="' + (state.filter === k) + '">' + (k === "alle" ? "Alle" : CATS[k].name) + "</button>"; }).join("") + '</div><div class="list">' +
      (list.length ? list.map(mailRow).join("") : (state.mailSt === "loading" ? "" : '<div class="empty">' + (state.mailSt === "ok" || DEMO ? "In dieser Kategorie liegt nichts." : "Keine E-Mails geladen.") + "</div>")) + "</div>";
  }

  function cal() {
    var pre = !DEMO && !ready() ? connectCard() : "";
    if (!DEMO && !ready() && !state.events.length) return pre;
    var strip = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(i);
      strip += '<button data-day="' + i + '" aria-pressed="' + (state.day === i) + '" class="' + (dayEvents(i).length ? "has" : "") + '" aria-label="' + longDay(d) + '"><span>' + fmt(d, { weekday: "short" }) + "</span><span>" + d.getDate() + "</span></button>";
    }
    var ev = dayEvents(state.day);
    var canAdd = DEMO || (ready() && G.has("cal"));
    return pre + stateBox(state.calSt, state.calErr, NOCAL) + (state.calNote ? '<div class="info" style="margin-bottom:12px">' + esc(state.calNote) + "</div>" : "") +
      '<div class="days">' + strip + '</div><div class="sec-head"><h3>' + longDay(addDays(state.day)) + '</h3></div><div class="list" style="margin-bottom:24px">' +
      (ev.length ? ev.map(eventRow).join("") : '<div class="empty">An diesem Tag steht nichts an.</div>') + "</div>" +
      '<form class="card" id="evform"><h3>Neuen Termin eintragen</h3><div><label for="ev-title">Was?</label><input type="text" id="ev-title" required placeholder="z. B. Friseur"></div><div class="fields"><div><label for="ev-date">Tag</label><input type="date" id="ev-date" value="' + key(addDays(state.day)) + '" required></div><div><label for="ev-time">Uhrzeit</label><input type="time" id="ev-time" value="10:00" required></div></div><div class="btns"><button class="btn" type="submit"' + (canAdd ? "" : " disabled") + ">Termin speichern</button></div></form>";
  }

  function proj() {
    var notes = state.notes.filter(function (n) { return n.project === state.project; });
    return '<div class="filters" role="group" aria-label="Projekte">' + PROJECTS.map(function (p) { return '<button data-project="' + p + '" aria-pressed="' + (state.project === p) + '">' + p + "</button>"; }).join("") + "</div>" +
      '<div class="info" style="margin-bottom:16px">' + (DEMO ? "Hier erscheinen die gemeinsamen Notizen aus dem Projektordner." : "Diese Notizen liegen vorerst nur auf diesem Gerät. Gemeinsame Notizen für alle folgen im nächsten Schritt.") + '</div><div class="list" style="margin-bottom:20px">' +
      (notes.length ? notes.map(noteCard).join("") : '<div class="empty">In diesem Projekt gibt es noch keine Notizen.</div>') + "</div>" +
      '<form class="card" id="noteform"><label for="note-text">Neue Notiz für ' + esc(state.project) + '</label><textarea id="note-text" required placeholder="Was soll das Team wissen?" style="min-height:100px"></textarea><div class="btns"><button class="btn" type="submit">Notiz speichern</button></div></form>';
  }

  function settings() {
    function row(t, s, p, soon) { return '<div class="set-row"><div><div class="t" style="font-weight:700">' + t + '</div><div class="s">' + s + '</div></div><span class="pill' + (soon ? " soon" : "") + '">' + p + "</span></div>"; }
    var google;
    if (DEMO) {
      google = '<div class="card" style="margin-bottom:16px"><h3>Google</h3>' + row("Gmail und Kalender", "Es fehlt noch die Client-ID in der Datei config.js", "Demo", true) + "</div>";
    } else {
      var on = ready();
      google = '<div class="card" style="margin-bottom:16px"><h3>Google</h3>' +
        row("Gmail", G.email() ? esc(G.email()) : "Nicht verbunden", on && G.has("mail") ? "Verbunden" : on ? "Eingeschränkt" : "Getrennt", !on) +
        row("Google Kalender", on ? "Kalender der Anmeldung" : "Nicht verbunden", on && G.has("cal") ? "Verbunden" : on ? "Eingeschränkt" : "Getrennt", !on) +
        '<div class="btns" style="margin-top:8px">' +
        (on ? '<button class="btn ghost" data-refresh="1">Neu laden</button>' : '<button class="btn" data-connect="1"' + (state.gisReady && !state.connecting ? "" : " disabled") + ">Mit Google verbinden</button>") +
        '<button class="btn ghost" data-connect="consent"' + (state.gisReady && !state.connecting ? "" : " disabled") + ">Berechtigungen neu erteilen</button>" +
        (G.wasConnected() ? '<button class="btn ghost" data-disconnect="1">Verbindung trennen</button>' : "") + "</div></div>";
    }
    var personal = DEMO ? "" :
      '<form class="card" id="setform" style="margin-bottom:16px"><h3>Persönliches</h3><div><label for="set-name">Dein Name (steht unter den Antworten)</label><input type="text" id="set-name" value="' + esc(lsGet("tina_name", "")) + '" placeholder="' + esc(G.given() || "z. B. Vorname") + '"></div>' +
      '<div><label for="set-fam">E-Mail-Adressen der Familie (mit Komma getrennt)</label><textarea id="set-fam" style="min-height:80px" placeholder="anna@example.com, renate@example.com">' + esc(lsGet("tina_fam", "")) + '</textarea><div class="s" style="color:var(--muted);font-size:.88rem">Mails von diesen Adressen landen in „Familie“ und werden mit „Hallo …“ beantwortet.</div></div>' +
      '<div class="btns"><button class="btn" type="submit">Speichern</button></div></form>';
    return google +
      '<div class="card" style="margin-bottom:16px"><h3>Weitere E-Mail-Konten</h3>' + row("GMX, iCloud, AOL", "Brauchen einen eigenen Server, kommen später", "Später", true) + "</div>" + personal +
      '<div class="card" style="margin-bottom:16px"><h3>Gemeinsame Notizen</h3>' + row("Notizdienst", DEMO ? "Noch nicht ausgewählt" : "Vorerst nur auf diesem Gerät", DEMO ? "Offen" : "Lokal", true) + "</div>" +
      '<div class="card"><h3>Darstellung</h3><div class="set-row"><div class="t" style="font-weight:700">Schriftgröße</div><div class="seg" role="group" aria-label="Schriftgröße"><button data-size="normal" aria-pressed="' + (state.size === "normal") + '">Normal</button><button data-size="gross" aria-pressed="' + (state.size === "gross") + '">Groß</button></div></div></div>';
  }

  function render() {
    $title.textContent = TITLES[state.tab]; $title.hidden = state.tab === "home";
    if ($sample) {
      $sample.hidden = !DEMO;
      if (DEMO) $sample.textContent = "Alle Inhalte sind Beispiele. Sobald in config.js eine Google-Client-ID steht, zeigt die App deine echten E-Mails und Termine.";
    }
    document.body.setAttribute("data-size", state.size);
    $view.innerHTML = { home: home, mail: mail, cal: cal, proj: proj, settings: settings }[state.tab]();
    var n = openMails().length;
    $nav.innerHTML = TABS.map(function (t) {
      return '<button data-go="' + t[0] + '"' + (state.tab === t[0] ? ' aria-current="page"' : "") + ">" + ICON[t[0]] + "<span>" + t[1] + "</span>" + (t[0] === "mail" && n ? '<span class="badge">' + n + "</span>" : "") + "</button>";
    }).join("");
  }
  function go(tab) { state.tab = tab; state.openMail = null; state.confirmSend = null; state.sendErr = ""; render(); window.scrollTo(0, 0); }

  /* ---------- Bedienung ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var d = b.dataset;
    if (d.go) return go(d.go);
    if (d.connect) {
      /* Wichtig: connect() ruft Google direkt im Klick auf, sonst blockiert der Browser das Fenster. */
      var p = G.connect(d.connect === "consent");
      state.connecting = true; state.connectErr = ""; render();
      p.then(function () { state.connecting = false; scheduleExpiry(); return loadAll(); })
        .catch(function (err) { state.connecting = false; state.connectErr = friendly(err); render(); });
      return;
    }
    if (d.refresh) { return loadAll(); }
    if (d.disconnect) {
      G.disconnect(); state.mails = []; state.events = []; state.mailSt = "idle"; state.calSt = "idle"; state.openMail = null;
      render(); return toast("Die Verbindung zu Google wurde getrennt.");
    }
    if (d.mail) { state.tab = "mail"; state.openMail = d.mail; state.confirmSend = null; state.sendErr = ""; var m = findMail(d.mail); if (m) m.unread = false; render(); return window.scrollTo(0, 0); }
    if (d.back) { state.openMail = null; state.confirmSend = null; return render(); }
    if (d.filter) { state.filter = d.filter; return render(); }
    if (d.day) { state.day = +d.day; return render(); }
    if (d.day === "0") { state.day = 0; return render(); }
    if (d.project) { state.project = d.project; return render(); }
    if (d.size) { state.size = d.size; lsSet("tina_size", d.size); return render(); }
    if (d.send) {
      var mm = findMail(d.send), ta = document.getElementById("reply");
      if (ta) mm.reply = ta.value;
      state.confirmSend = String(mm.id); state.sendErr = ""; render(); return window.scrollTo(0, 0);
    }
    if (d.sendno) { state.confirmSend = null; state.sendErr = ""; return render(); }
    if (d.sendyes) {
      var sm = findMail(state.confirmSend); if (!sm || state.sending) return;
      if (DEMO) {
        sm.answered = true; state.openMail = null; state.confirmSend = null; render();
        return toast("Beispiel: Hier würde die Antwort an " + sm.from + " gesendet.");
      }
      state.sending = true; state.sendErr = ""; render();
      G.sendReply({ to: sm.replyTo || sm.fromEmail, subject: sm.subj, body: sm.reply, inReplyTo: sm.messageId, references: sm.references, threadId: sm.threadId })
        .then(function () { sm.answered = true; state.sending = false; state.openMail = null; state.confirmSend = null; render(); toast("Antwort gesendet."); })
        .catch(function (err) { state.sending = false; state.sendErr = isAuth(err) ? "Die Anmeldung ist abgelaufen. Bitte unter „Heute“ neu verbinden; deine Antwort geht nicht verloren, solange du die Seite nicht neu lädst." : "Senden hat nicht geklappt: " + friendly(err); render(); });
      return;
    }
    if (d.addtermin) {
      var tm = findMail(d.addtermin); if (!tm || !tm.termin || tm.added) return;
      var t = tm.termin;
      if (DEMO) {
        state.events.push({ date: t.date, time: t.time, title: t.title, place: t.place, src: "Google-Kalender" });
        tm.added = true; render(); return toast("Termin im Kalender eingetragen: " + t.title);
      }
      b.disabled = true; b.textContent = "Trage ein …";
      G.createEvent({ title: t.title, date: t.date, time: t.time, place: t.place })
        .then(function (ev) { state.events.push(ev); tm.added = true; render(); toast("Termin im Kalender eingetragen: " + t.title); })
        .catch(function (err) { b.disabled = false; b.textContent = "In Kalender eintragen"; toast(isAuth(err) ? "Anmeldung abgelaufen. Bitte unter „Heute“ neu verbinden." : "Eintragen hat nicht geklappt: " + friendly(err)); render(); });
    }
  });

  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var id = e.target.id;
    if (id === "evform") {
      var date = document.getElementById("ev-date").value, time = document.getElementById("ev-time").value, title = document.getElementById("ev-title").value.trim();
      if (!title) return;
      var diff = Math.round((new Date(date + "T00:00") - today) / 864e5);
      var done = function (ev) { state.events.push(ev); if (diff >= 0 && diff < 7) state.day = diff; render(); toast("Termin gespeichert."); };
      if (DEMO) return done({ date: date, time: time, title: title, place: "Eigener Eintrag", src: "Google-Kalender" });
      var btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Speichere …";
      G.createEvent({ title: title, date: date, time: time }).then(done).catch(function (err) {
        render(); toast(isAuth(err) ? "Anmeldung abgelaufen. Bitte unter „Heute“ neu verbinden." : "Speichern hat nicht geklappt: " + friendly(err));
      });
    }
    if (id === "noteform") {
      var txt = document.getElementById("note-text").value.trim(); if (!txt) return;
      var note = { id: Date.now(), project: state.project, who: DEMO ? "Mama" : (ownName() || "Ich"), ts: Date.now(), text: txt };
      state.notes.unshift(note);
      if (!DEMO) lsSet("tina_notes", JSON.stringify(state.notes));
      render(); toast("Notiz gespeichert.");
    }
    if (id === "setform") {
      lsSet("tina_name", document.getElementById("set-name").value.trim());
      lsSet("tina_fam", document.getElementById("set-fam").value.trim());
      state.mails.forEach(classify); render(); toast("Gespeichert.");
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || DEMO) return;
    if (ready() && !state.openMail && state.loadedAt && Date.now() - state.loadedAt > 10 * 60000) loadAll(); else if (!state.openMail) render();
  });

  /* ---------- Start ---------- */
  render();
  if (!DEMO) {
    G.init().then(function () { state.gisReady = true; render(); })
      .catch(function (err) { state.connectErr = friendly(err); render(); });
    if (ready()) loadAll();
  }
})();
