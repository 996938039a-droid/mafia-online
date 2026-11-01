// Receives a finished-game summary from the host's browser and appends it to
// Google Sheets through an Apps Script web app (see apps-script/Code.gs).
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

const str = (v, n = 60) => String(v ?? "").slice(0, n);
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const hook = Netlify.env.get("SHEETS_WEBHOOK_URL");
  if (!hook) return json({ ok: false, error: "not_configured" });

  let raw = "";
  try {
    raw = await req.text();
    if (raw.length > 30000) return json({ ok: false, error: "too_large" }, 413);
  } catch {
    return json({ ok: false, error: "read" }, 400);
  }

  let g;
  try {
    g = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "json" }, 400);
  }
  if (!g || !Array.isArray(g.players) || g.players.length < 2 || g.players.length > 200) {
    return json({ ok: false, error: "shape" }, 400);
  }

  // Re-build the payload from known fields only.
  const game = {
    room: str(g.room, 12),
    theme: str(g.theme, 24),
    winner: str(g.winner, 12),
    rounds: num(g.rounds),
    durationSec: num(g.durationSec),
    startedAt: str(g.startedAt, 40),
    players: g.players.map((p) => ({
      name: str(p.name, 30),
      role: str(p.role, 12),
      alive: Boolean(p.alive),
      won: Boolean(p.won),
    })),
  };

  try {
    const r = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret: Netlify.env.get("SHEETS_SECRET") || "", game }),
      redirect: "follow",
    });
    return json({ ok: r.ok });
  } catch {
    return json({ ok: false, error: "upstream" }, 502);
  }
};

export const config = { path: "/api/log-game" };
