// Reads aggregated stats back from the Google Sheet (Apps Script doGet).
export default async () => {
  const hook = Netlify.env.get("SHEETS_WEBHOOK_URL");
  if (!hook) {
    return new Response(JSON.stringify({ ok: false, error: "not_configured" }), {
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const url = `${hook}${hook.includes("?") ? "&" : "?"}action=leaderboard&secret=${encodeURIComponent(
      Netlify.env.get("SHEETS_SECRET") || ""
    )}`;
    const r = await fetch(url, { redirect: "follow" });
    const text = await r.text();
    return new Response(text, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "upstream" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/leaderboard" };
