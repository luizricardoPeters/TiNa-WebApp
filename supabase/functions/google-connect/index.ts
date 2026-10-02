// Edge Function "google-connect": Admin verbindet einmalig das Gemeinschaftskonto.
// Tauscht den Google-Code gegen einen Dauerzugang (Refresh-Token) und speichert ihn nur für den Server lesbar.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await userClient.auth.getUser();
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Nicht angemeldet." }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: perm } = await admin.from("allowed_users").select("is_admin").eq("email", email).maybeSingle();
    if (!perm?.is_admin) return json({ error: "Nur Administratoren dürfen das Gemeinschaftskonto verbinden." }, 403);

    const { code, redirect_uri } = await req.json();
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, redirect_uri, grant_type: "authorization_code",
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      }),
    });
    const t = await r.json();
    if (!r.ok) return json({ error: "Google: " + (t.error_description || t.error) }, 400);
    if (!t.refresh_token) return json({ error: "Google hat keinen Dauerzugang geliefert. Bitte erneut verbinden und alle Häkchen setzen." }, 400);
    const ui = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + t.access_token } })).json();
    const { error } = await admin.from("google_connection").upsert({ id: 1, email: ui.email, refresh_token: t.refresh_token, updated_at: new Date().toISOString() });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, email: ui.email, scope: t.scope });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
