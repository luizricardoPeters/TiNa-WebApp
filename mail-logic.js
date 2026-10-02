/* TiNa-WebApp: Regeln für Mails und Termine. Alles lokal und kostenlos, ohne KI. */
(function (root) {
  "use strict";

  var MONTHS = { januar: 1, jan: 1, februar: 2, feb: 2, "märz": 3, maerz: 3, "mär": 3, april: 4, apr: 4, mai: 5,
    juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
    oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12 };
  var WEEKDAYS = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6 };
  var WD_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  var MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseKey(k) { var p = String(k).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function formatDateDE(k) { var d = parseKey(k); return WD_NAMES[d.getDay()] + ", " + d.getDate() + ". " + MONTH_NAMES[d.getMonth()]; }

  /* ---------- Kodierung ---------- */
  function utf8Bin(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return bin;
  }
  function b64(str) { return btoa(utf8Bin(str)); }
  function encodeB64Url(str) { return b64(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function decodeB64Url(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  /* ---------- Mail lesen ---------- */
  function htmlToText(h) {
    return String(h)
      .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function extractBody(payload) {
    var plain = [], html = [];
    (function walk(p) {
      if (!p) return;
      var mt = (p.mimeType || "").toLowerCase();
      if (p.body && p.body.data) {
        if (mt === "text/plain") plain.push(decodeB64Url(p.body.data));
        else if (mt === "text/html") html.push(decodeB64Url(p.body.data));
      }
      (p.parts || []).forEach(walk);
    })(payload);
    if (plain.length) return plain.join("\n").trim();
    if (html.length) return htmlToText(html.join("\n"));
    return "";
  }
  function headerMap(headers) {
    var m = {};
    (headers || []).forEach(function (h) { m[String(h.name).toLowerCase()] = h.value; });
    return m;
  }
  function parseFrom(v) {
    v = String(v || "");
    var m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
    return { name: "", email: v.trim().toLowerCase() };
  }
  function firstName(name) {
    name = String(name || "").replace(/\(.*?\)/g, "").trim();
    if (name.indexOf(",") > 0) name = name.split(",").slice(1).join(" ");
    name = name.replace(/[,;]/g, " ").trim();
    if (!name) return "";
    return name.split(/\s+/)[0];
  }

  /* ---------- Termine erkennen (deutsche Muster) ---------- */
  function resolveDate(d, mo, y, today) {
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return null;
    var year;
    if (y) { year = +y; if (year < 100) year += 2000; }
    else {
      year = today.getFullYear();
      if (new Date(year, mo - 1, d) < today) year += 1;
    }
    var dt = new Date(year, mo - 1, d);
    return dt.getMonth() === mo - 1 ? dt : null;
  }
  var CUE = /termin|treffen|verabred|einladung|besprechung|meeting|erinnerung|kaffee|spaziergang|vorbeikommen|feier|geburtstag|sitzung|gespräch|führung|abholen/i;

  function detectAppointment(text, today) {
    text = String(text || "");
    today = today ? new Date(today) : new Date();
    today.setHours(0, 0, 0, 0);
    var date = null, m;

    m = text.match(/(?:^|[^\d])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2}))?(?!\d)/);
    if (m) date = resolveDate(+m[1], +m[2], m[3], today);

    if (!date) {
      m = text.match(/\b(\d{1,2})\.?\s+(Januar|Jan|Februar|Feb|März|Maerz|Mär|April|Apr|Mai|Juni|Jun|Juli|Jul|August|Aug|September|Sept|Sep|Oktober|Okt|November|Nov|Dezember|Dez)(?![a-zäöüß])\.?(?:\s+(\d{4}))?/i);
      if (m) date = resolveDate(+m[1], MONTHS[m[2].toLowerCase()], m[3], today);
    }
    if (!date) {
      m = text.match(/\b(übermorgen|morgen|heute)\b/i);
      if (m) {
        var off = { heute: 0, morgen: 1, "übermorgen": 2 }[m[1].toLowerCase()];
        date = new Date(today); date.setDate(date.getDate() + off);
      }
    }
    if (!date) {
      m = text.match(/\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonnabend|Sonntag)\b/i);
      if (m) {
        var wd = WEEKDAYS[m[1].toLowerCase()];
        date = new Date(today); date.setDate(date.getDate() + ((wd - today.getDay() + 7) % 7));
      }
    }
    if (!date) return null;

    var time = null;
    m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m) time = pad2(+m[1]) + ":" + m[2];
    else {
      m = text.match(/\b([01]?\d|2[0-3])(?:[.:]([0-5]\d))?\s*Uhr\b/i);
      if (m) time = pad2(+m[1]) + ":" + (m[2] || "00");
    }
    if (!time && !CUE.test(text)) return null;
    return { date: dateKey(date), time: time };
  }

  /* ---------- Kategorien ---------- */
  function categorize(m, opts) {
    opts = opts || {};
    var fam = (opts.familyAddresses || []).map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
    var text = (m.subject || "") + " " + String(m.body || "").slice(0, 1500);
    if (m.fromEmail && fam.indexOf(String(m.fromEmail).toLowerCase()) >= 0) return "fam";
    if (/rechnung|invoice|mahnung|zahlungserinnerung|abrechnung|überweisung|quittung|spendenbescheinigung|mitgliedsbeitrag/i.test(text)) return "rech";
    if (/paket|sendung|versandbestätigung|versendet|lieferung|zustellung|bestellung|bestellbestätigung|sendungsverfolgung/i.test(text)) return "post";
    if (detectAppointment(text, opts.today) || /termin|einladung|besprechung|verabredung/i.test(m.subject || "")) return "term";
    return "sonst";
  }

  /* ---------- Antwortvorschlag ---------- */
  var ORG = /praxis|gmbh|\bag\b|e\.v\.|verein|stadt|\bamt\b|kasse|versicherung|service|team|support|noreply|no-reply|kundenservice|shop|bank|hotline|abrechnung|institut|schule/i;

  function suggestReply(m, opts) {
    opts = opts || {};
    var informal = m.cat === "fam";
    var fn = firstName(m.fromName);
    var isOrg = ORG.test((m.fromName || "") + " " + (m.fromEmail || "")) || !m.fromName;
    var greet;
    if (informal && fn) greet = "Hallo " + fn + ",";
    else if (isOrg) greet = "Sehr geehrte Damen und Herren,";
    else greet = "Guten Tag " + String(m.fromName).replace(/\(.*?\)/g, "").trim() + ",";

    var when = m.appt ? formatDateDE(m.appt.date) + (m.appt.time ? " um " + m.appt.time + " Uhr" : "") : "";
    var body;
    if (informal && m.appt) body = "gerne, " + when + " passt mir gut.";
    else if (m.appt && m.cat === "term") body = "vielen Dank für die Nachricht. Den Termin am " + when + " nehme ich gerne wahr.";
    else if (informal) body = "danke für deine Nachricht! Ich schaue kurz in meinen Kalender und melde mich gleich bei dir.";
    else if (m.cat === "rech") body = "vielen Dank für die Zusendung. Ich habe die Unterlagen erhalten und kümmere mich darum.";
    else if (m.cat === "post") body = "vielen Dank für die Information.";
    else body = "vielen Dank für Ihre Nachricht. Ich habe sie erhalten und melde mich in Kürze bei Ihnen.";
    if (!informal) body = body.charAt(0).toUpperCase() + body.slice(1);
    else body = body.charAt(0).toUpperCase() + body.slice(1);

    var closing = informal ? "Liebe Grüße" : "Viele Grüße";
    var own = opts.ownName ? "\n" + opts.ownName : "";
    return greet + "\n\n" + body + "\n\n" + closing + own;
  }

  /* ---------- Antwort-Mail bauen (RFC 822) ---------- */
  function oneLine(s) { return String(s || "").replace(/[\r\n]+/g, " ").trim(); }
  function encodeWord(s) {
    s = oneLine(s);
    return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?=";
  }
  function replySubject(s) {
    s = oneLine(s);
    return /^(re|aw):/i.test(s) ? s : "Re: " + s;
  }
  function buildReplyMime(o) {
    var h = [];
    h.push("To: " + oneLine(o.to));
    h.push("Subject: " + encodeWord(replySubject(o.subject)));
    if (o.inReplyTo) h.push("In-Reply-To: " + oneLine(o.inReplyTo));
    if (o.inReplyTo || o.references) h.push("References: " + oneLine([o.references, o.inReplyTo].filter(Boolean).join(" ")));
    h.push("MIME-Version: 1.0");
    h.push('Content-Type: text/plain; charset="UTF-8"');
    h.push("Content-Transfer-Encoding: base64");
    var body = b64(String(o.body || "").replace(/\r?\n/g, "\r\n")).replace(/(.{76})/g, "$1\r\n");
    return h.join("\r\n") + "\r\n\r\n" + body;
  }

  var api = {
    dateKey: dateKey, parseKey: parseKey, formatDateDE: formatDateDE,
    encodeB64Url: encodeB64Url, decodeB64Url: decodeB64Url,
    extractBody: extractBody, headerMap: headerMap, parseFrom: parseFrom, firstName: firstName,
    detectAppointment: detectAppointment, categorize: categorize, suggestReply: suggestReply,
    buildReplyMime: buildReplyMime, replySubject: replySubject
  };
  root.TinaLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
