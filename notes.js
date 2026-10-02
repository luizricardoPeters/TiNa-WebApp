/* TiNa-WebApp: gemeinsame Notizen über Supabase. Anmeldung mit Google, Zugriff nur für freigeschaltete Adressen. */
(function (root) {
  "use strict";
  var CFG = root.TINA_CONFIG || {};
  var sb = null, ses = null, ready = null, listeners = [];

  function configured() { return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY); }
  function emit(ev) { listeners.forEach(function (f) { try { f(ev); } catch (e) { /* egal */ } }); }

  function init() {
    if (ready) return ready;
    ready = new Promise(function (res, rej) {
      if (root.supabase && root.supabase.createClient) return res();
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { ready = null; rej(new Error("Der Notizdienst konnte nicht geladen werden. Bitte die Internetverbindung prüfen.")); };
      document.head.appendChild(s);
    }).then(function () {
      sb = root.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
      sb.auth.onAuthStateChange(function (ev, s) { ses = s; emit(ev); });
      return sb.auth.getSession();
    }).then(function (r) { ses = r.data && r.data.session; return ses; });
    return ready;
  }
  function must(r) { if (r.error) throw new Error(r.error.message); return r.data; }

  function signIn() {
    return sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: root.location.origin + root.location.pathname } }).then(must);
  }
  function signOut() { return sb.auth.signOut(); }
  function user() {
    if (!ses || !ses.user) return null;
    var m = ses.user.user_metadata || {};
    return { email: String(ses.user.email || "").toLowerCase(), name: m.full_name || m.name || "" };
  }
  function projects() { return sb.from("projects").select("id,name").order("sort").then(must); }
  function notes() {
    return sb.from("notes").select("id,project_id,text,author_name,author_email,created_at").order("created_at", { ascending: false }).limit(200).then(must);
  }
  function add(projectId, text, authorName) {
    return sb.from("notes").insert({ project_id: projectId, text: text, author_name: authorName || null }).then(must);
  }
  function remove(id) { return sb.from("notes").delete().eq("id", id).then(must); }
  function volunteers() { return sb.from("volunteers").select("id,name,task,contact").order("name").then(must); }
  function addVolunteers(rows) { return sb.from("volunteers").insert(rows).then(must); }
  function removeVolunteer(id) { return sb.from("volunteers").delete().eq("id", id).then(must); }
  function perms() { return sb.from("allowed_users").select("can_mail,is_admin").maybeSingle().then(must); }
  function invoke(name, body) {
    return sb.functions.invoke(name, { body: body }).then(function (r) {
      if (!r.error) return r.data;
      var c = r.error.context;
      if (c && typeof c.json === "function") {
        return c.json().then(function (j) { throw new Error(j && j.error ? j.error : r.error.message); }, function () { throw new Error(r.error.message); });
      }
      throw new Error(r.error.message);
    });
  }
  function watch() {
    return sb.channel("notes-changes").on("postgres_changes", { event: "*", schema: "public", table: "notes" }, function () { emit("NOTES_CHANGED"); }).subscribe();
  }

  root.TinaNotes = {
    configured: configured, init: init, signIn: signIn, signOut: signOut, user: user,
    projects: projects, notes: notes, perms: perms, invoke: invoke, volunteers: volunteers, addVolunteers: addVolunteers, removeVolunteer: removeVolunteer, add: add, remove: remove, watch: watch,
    session: function () { return !!ses; },
    onChange: function (f) { listeners.push(f); }
  };
})(window);
