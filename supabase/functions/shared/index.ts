// Edge Function "shared": Kalender und Postfach des Gemeinschaftskontos für freigeschaltete Personen.
// Secrets (Dashboard): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. SUPABASE_URL, SUPABASE_ANON_KEY und
// SUPABASE_SERVICE_ROLE_KEY stellt Supabase selbst bereit. "Verify JWT" bitte ausschalten, die Prüfung passiert hier.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3";

async function accessToken(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from("google_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (error || !data) throw new Error("Das Gemeinschaftskonto ist noch nicht verbunden.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: data.refresh_token, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google hat den Zugang abgelehnt (" + (j.error_description || j.error) + "). Das Gemeinschaftskonto muss neu verbunden werden.");
  return j.access_token as string;
}

async function g(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } });
  const j = r.status === 204 ? null : await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(j?.error?.message || "Google-Fehler " + r.status); e.status = r.status; throw e; }
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Nicht angemeldet." }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: perm } = await admin.from("allowed_users").select("can_mail,can_edit_cal,is_admin").eq("email", email).maybeSingle();
    if (!perm) return json({ error: "Diese Adresse ist nicht freigeschaltet." }, 403);

    const b = await req.json();
    const needMail = String(b.action).startsWith("mail.");
    if (needMail && !perm.can_mail && !perm.is_admin) return json({ error: "Kein Zugriff auf das Postfach." }, 403);

    if (b.action === "cal.create" && !perm.can_edit_cal && !perm.is_admin) return json({ error: "Du darfst keine Termine eintragen." }, 403);

    const token = await accessToken(admin);

    if (b.action === "cal.list") {
      const days = Math.min(Math.max(+b.days || 7, 1), 62);
      const from = new Date(b.from || Date.now()); const to = new Date(from.getTime() + days * 864e5);
      const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: "250", timeMin: from.toISOString(), timeMax: to.toISOString() });
      const r = await g(token, `${CAL}/calendars/primary/events?${q}`);
      return json({ items: r.items ?? [] });
    }
    if (b.action === "cal.create") {
      const title = String(b.title || "").slice(0, 300); if (!title) return json({ error: "Titel fehlt." }, 400);
      const tz = "Europe/Berlin";
      const body: any = { summary: title };
      if (b.place) body.location = String(b.place).slice(0, 300);
      body.description = "Eingetragen in der TiNa-WebApp von " + email;
      if (b.time) {
        const st = new Date(Date.UTC(+b.date.slice(0, 4), +b.date.slice(5, 7) - 1, +b.date.slice(8, 10), +b.time.slice(0, 2), +b.time.slice(3, 5)));
        const iso = (d: Date) => d.toISOString().slice(0, 19);
        body.start = { dateTime: iso(st), timeZone: tz }; body.end = { dateTime: iso(new Date(st.getTime() + 3600000)), timeZone: tz };
      } else {
        const n = new Date(Date.UTC(+b.date.slice(0, 4), +b.date.slice(5, 7) - 1, +b.date.slice(8, 10) + 1));
        body.start = { date: b.date }; body.end = { date: n.toISOString().slice(0, 10) };
      }
      await g(token, `${CAL}/calendars/primary/events`, { method: "POST", body: JSON.stringify(body) });
      return json({ ok: true });
    }
    if (b.action === "mail.list") {
      const days = Math.min(Math.max(+b.days || 30, 1), 90), limit = Math.min(Math.max(+b.limit || 15, 1), 30);
      const q = encodeURIComponent(`in:inbox newer_than:${days}d`);
      const list = await g(token, `${GM}/threads?maxResults=${limit}&q=${q}`);
      const threads: unknown[] = [];
      for (let i = 0; i < (list.threads ?? []).length; i += 5) {
        const part = (list.threads as { id: string }[]).slice(i, i + 5);
        const got = await Promise.all(part.map((t) => g(token, `${GM}/threads/${t.id}?format=full`).catch(() => null)));
        threads.push(...got.filter(Boolean));
      }
      return json({ threads });
    }
    if (b.action === "mail.send") {
      if (!b.raw || typeof b.raw !== "string") return json({ error: "Nachricht fehlt." }, 400);
      await g(token, `${GM}/messages/send`, { method: "POST", body: JSON.stringify({ raw: b.raw, threadId: b.threadId }) });
      return json({ ok: true });
    }
    return json({ error: "Unbekannte Aktion." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, (e as any).status === 401 ? 502 : 500);
  }
});
