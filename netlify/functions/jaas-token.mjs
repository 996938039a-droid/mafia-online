// Optional: signs a short-lived JWT for 8x8 JaaS (hosted Jitsi) so you can use
// their free tier instead of the public meet.jit.si server.
// Needs env: JAAS_APP_ID, JAAS_KID, JAAS_PRIVATE_KEY (PEM, "\n" escapes allowed).
import { createSign } from "node:crypto";

const b64u = (b) =>
  Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);

  const appId = Netlify.env.get("JAAS_APP_ID");
  const kid = Netlify.env.get("JAAS_KID");
  const key = (Netlify.env.get("JAAS_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
  if (!appId || !kid || !key) return json({ ok: false, error: "not_configured" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "json" }, 400);
  }

  const room = String(body.room || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const name = String(body.name || "Player").slice(0, 30);
  const id = String(body.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (!room) return json({ ok: false, error: "room" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid };
  const payload = {
    aud: "jitsi",
    iss: "chat",
    iat: now,
    nbf: now - 10,
    exp: now + 3 * 60 * 60,
    sub: appId,
    room,
    context: {
      user: { id, name, avatar: "", email: "", moderator: body.host ? "true" : "false" },
      features: { livestreaming: "false", recording: "false", transcription: "false", "outbound-call": "false" },
    },
  };

  try {
    const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
    const sig = createSign("RSA-SHA256").update(data).sign(key);
    return json({ ok: true, jwt: `${data}.${b64u(sig)}`, appId, room });
  } catch {
    return json({ ok: false, error: "sign" }, 500);
  }
};

export const config = { path: "/api/jaas-token" };
