// Public runtime config for the browser. Nothing secret here:
// the Supabase anon key is designed to be public.
export default async () => {
  const env = (k) => Netlify.env.get(k) || "";
  const body = {
    supabaseUrl: env("SUPABASE_URL"),
    supabaseAnonKey: env("SUPABASE_ANON_KEY"),
    jitsiDomain: env("JITSI_DOMAIN") || "meet.jit.si",
    jaasAppId: env("JAAS_APP_ID"),
    sheets: Boolean(env("SHEETS_WEBHOOK_URL")),
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/config" };
