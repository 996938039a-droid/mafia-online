// app.js: UI, networking glue and the host controller.
// The host's browser runs the game engine (authoritative). Everyone else sends intents and renders state.
import { Game, MIN_PLAYERS, STEP_ACTION } from "./engine.js";
import { theme, roleName, phaseLabel, line, lc } from "./themes.js";
import { Narrator } from "./narrator.js";
import { Net, LocalNet, loadConfig } from "./net.js";
import { Video } from "./video.js";
import { buildSettingsForm } from "./settings-ui.js";

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKMNPQRSTUVWXYZ"[b % 23]).join("");
const TIMED = new Set(["reveal", "night", "dawn", "day", "vote", "result"]);
const HUES = [352, 24, 42, 100, 160, 195, 215, 265, 300];

// ?local=1 lets several tabs of one browser play together, so identity must be per tab there.
const useLocal = new URLSearchParams(location.search).has("local");
const backend = () => (useLocal ? sessionStorage : localStorage);
const store = {
  get(k, d) { try { const v = backend().getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { backend().setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { backend().removeItem(k); } catch {} },
};

const ICON = {
  moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  vote: '<svg viewBox="0 0 24 24"><path d="M4 8h16v12H4z"/><path d="M9 8V4h6v4"/><path d="M9 14l2 2 4-4"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4 2 4 5"/></svg>',
  mafia: '<svg viewBox="0 0 24 24"><path d="M12 2l3 9-3 3-3-3z"/><path d="M8 15h8M12 15v7"/></svg>',
  villager: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  doctor: '<svg viewBox="0 0 24 24"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg>',
  detective: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.7A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4.4-1"/></svg>',
};

/* ---------------- identity & prefs ---------------- */
const me = Object.assign({ id: rid(10), name: "", hue: HUES[Math.floor(Math.random() * HUES.length)] }, store.get("mafia:me", {}));
const saveMe = () => store.set("mafia:me", me);
saveMe();

const prefs = Object.assign(
  { voiceOn: true, voice: "", rate: 0.92, pitch: 0.8, volume: 1, ambient: true, sfx: true, reduce: false },
  store.get("mafia:prefs", {})
);
const narrator = new Narrator();
const video = new Video({
  onState: (s) => {
    $("#videoBox").classList.toggle("live", !!s.joined);
    $("#btnVideoLeave").classList.toggle("hidden", !s.joined);
    $("#btnVideo").disabled = false;
    $("#btnVideo").textContent = "Join video";
  },
  onBlocked: () => toast(C && C.pub?.phase === "night" ? "The city sleeps. Mics and cameras stay off." : "Ghosts cannot use mic or camera."),
});

function applyPrefs() {
  narrator.voiceOn = prefs.voiceOn;
  narrator.voiceURI = prefs.voice;
  narrator.rate = prefs.rate;
  narrator.pitch = prefs.pitch;
  narrator.volume = prefs.volume;
  narrator.sfxOn = prefs.sfx;
  narrator.setAmbient(prefs.ambient);
  document.body.dataset.motion = prefs.reduce ? "reduced" : "";
}

/* ---------------- toast / flash ---------------- */
let toastT;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
}
function flash(text) {
  const v = $("#veilText");
  v.textContent = text;
  v.classList.remove("show");
  void v.offsetWidth;
  v.classList.add("show");
}

/* ---------------- state ---------------- */
let C = null; // current room context
let cfgPromise = null;
const getCfg = () => (cfgPromise ||= loadConfig());

function makeCtx(code, isHost, cfg) {
  return {
    code, isHost, cfg,
    net: null, game: null,
    pub: null, priv: null,
    endsAt: 0, total: 1, phaseKey: "", spoken: null,
    sel: null, voteSel: null, interact: null,
    chat: [], ch: "public", unread: {}, lastSent: 0,
    lastSeen: {}, dirty: new Set(), flushT: null,
    online: true, connectedBefore: false, hostPresent: true, hostGone: 0,
    roleHidden: false, lastTick: null, intervals: [],
  };
}

/* ====================================================================
   HOME
==================================================================== */
function showView(id) {
  $("#home").classList.toggle("hidden", id !== "home");
  $("#room").classList.toggle("hidden", id !== "room");
}

function homeError(msg) {
  const e = $("#homeError");
  e.textContent = msg || "";
  e.classList.toggle("hidden", !msg);
}

function friendlyError(e) {
  const m = String(e?.message || e);
  if (m === "config") return "Realtime is not configured yet. Set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify (see the README), or add ?local=1 to the address to try it across tabs on this device.";
  if (/timed out/i.test(m)) return "Could not reach the realtime server. Check your connection and Supabase settings.";
  return "Could not connect: " + m;
}

function setBusy(b) {
  ["btnCreate", "btnJoin"].forEach((id) => ($("#" + id).disabled = b));
}

function readName() {
  const name = $("#nameInput").value.trim().slice(0, 18);
  if (!name) {
    homeError("Pick a name first.");
    $("#nameInput").focus();
    return null;
  }
  me.name = name;
  saveMe();
  return name;
}

function initHome() {
  $("#nameInput").value = me.name;
  const sw = $("#swatches");
  sw.innerHTML = HUES.map((h) => `<button type="button" class="sw ${h === me.hue ? "on" : ""}" data-h="${h}" style="--h:${h}" aria-label="Colour ${h}"></button>`).join("");
  sw.addEventListener("click", (e) => {
    const b = e.target.closest(".sw");
    if (!b) return;
    me.hue = +b.dataset.h;
    saveMe();
    $$(".sw", sw).forEach((x) => x.classList.toggle("on", x === b));
  });

  $("#btnCreate").addEventListener("click", () => {
    narrator.unlock();
    homeError("");
    if (readName()) createRoom();
  });
  $("#btnJoin").addEventListener("click", () => {
    narrator.unlock();
    homeError("");
    const code = $("#codeInput").value.trim().toUpperCase();
    if (!readName()) return;
    if (code.length < 4) return homeError("Enter the 4-letter room code.");
    joinRoom(code);
  });
  $("#codeInput").addEventListener("keydown", (e) => e.key === "Enter" && $("#btnJoin").click());
  $("#nameInput").addEventListener("keydown", (e) => e.key === "Enter" && ($("#codeInput").value ? $("#btnJoin").click() : $("#btnCreate").click()));

  const qs = new URLSearchParams(location.search).get("room");
  if (qs) $("#codeInput").value = qs.toUpperCase().slice(0, 6);

  const sess = store.get("mafia:session", null);
  if (sess && sess.code) {
    const r = $("#rejoin");
    r.classList.remove("hidden");
    r.innerHTML = `<span>Rejoin room <b>${esc(sess.code)}</b>${sess.host ? " (as host)" : ""}</span><span><button class="btn small" id="btnRejoin">Rejoin</button> <button class="btn small ghost" id="btnForget">Forget</button></span>`;
    $("#btnRejoin").addEventListener("click", () => {
      narrator.unlock();
      if (!me.name) return homeError("Enter your name first.");
      sess.host ? resumeHost(sess.code) : joinRoom(sess.code);
    });
    $("#btnForget").addEventListener("click", () => {
      store.del("mafia:session");
      r.classList.add("hidden");
    });
  }
  loadBoard();
}

async function loadBoard() {
  try {
    const cfg = await getCfg();
    if (!cfg.sheets) return;
    const r = await fetch("/api/leaderboard");
    const j = await r.json();
    if (!j.ok || !j.rows?.length) return;
    const b = $("#leaderboard");
    b.classList.remove("hidden");
    b.innerHTML = `<h4>Hall of fame</h4><table>${j.rows.slice(0, 5).map((x) => `<tr><td>${esc(x.name)}</td><td>${x.wins} wins · ${x.games} games</td></tr>`).join("")}</table>`;
  } catch {}
}

/* ====================================================================
   CONNECTING
==================================================================== */
async function connectRoom(code, isHost) {
  const cfg = await getCfg();
  if (!useLocal && (!cfg.supabaseUrl || !cfg.supabaseAnonKey)) throw new Error("config");
  const ctx = makeCtx(code, isHost, cfg);
  const opts = {
    url: cfg.supabaseUrl, key: cfg.supabaseAnonKey, code, me: { id: me.id, name: me.name }, host: isHost,
    onMessage: (m) => onMessage(ctx, m),
    onPresence: (st) => onPresence(ctx, st),
    onStatus: (s) => onStatus(ctx, s),
  };
  ctx.net = useLocal ? new LocalNet(opts) : new Net(opts);
  await ctx.net.connect();
  return ctx;
}

async function createRoom() {
  setBusy(true);
  try {
    for (let i = 0; i < 4; i++) {
      const ctx = await connectRoom(genCode(), true);
      await sleep(900);
      const taken = Object.entries(ctx.net.presence()).some(([k, v]) => k !== me.id && v.some((m) => m.host));
      if (taken) { await ctx.net.close(); continue; }
      return beginHost(ctx);
    }
    homeError("Could not find a free room code. Try again.");
  } catch (e) {
    homeError(friendlyError(e));
  } finally {
    setBusy(false);
  }
}

async function resumeHost(code) {
  setBusy(true);
  try {
    beginHost(await connectRoom(code, true));
  } catch (e) {
    homeError(friendlyError(e));
  } finally {
    setBusy(false);
  }
}

async function joinRoom(code) {
  setBusy(true);
  try {
    beginClient(await connectRoom(code, false));
  } catch (e) {
    homeError(friendlyError(e));
  } finally {
    setBusy(false);
  }
}

function enterRoomView(ctx) {
  C = ctx;
  store.set("mafia:session", { code: ctx.code, host: ctx.isHost });
  history.replaceState(null, "", location.pathname + (useLocal ? "?local=1" : ""));
  showView("room");
  switchTab("game");
  $("#chatLog").innerHTML = "";
  ctx.intervals.push(setInterval(tickUI, 250));
  applyPrefs();
  render();
}

/* ---------- host ---------- */
function beginHost(ctx) {
  const g = new Game({ code: ctx.code, hostId: me.id, vkey: rid(10) });
  const saved = store.get("mafia:host:" + ctx.code, null);
  if (saved && saved.hostId === me.id && Date.now() - saved.at < 12 * 3600e3) {
    try {
      g.restore(saved.json);
      // freeze the clock for the time the host was away
      if (g.s.pausedLeft == null && g.s.endsAt) g.s.endsAt += Date.now() - saved.at;
    } catch {}
  }
  ctx.game = g;
  g.onChange = () => scheduleFlush(ctx);
  g.onPriv = (id) => ctx.dirty.add(id);
  g.onGameOver = (sum) => logGame(ctx, sum);
  g.join(me.id, me.name, String(me.hue));
  ctx.intervals.push(setInterval(() => g.tick(), 400));
  ctx.intervals.push(setInterval(() => { g.players.forEach((p) => ctx.dirty.add(p.id)); flush(ctx); }, 20000));
  ctx.intervals.push(setInterval(() => hostPresenceSweep(ctx), 2000));
  enterRoomView(ctx);
  flush(ctx);
}

function scheduleFlush(ctx) {
  if (!ctx.flushT) ctx.flushT = setTimeout(() => flush(ctx), 50);
}

function flush(ctx) {
  clearTimeout(ctx.flushT);
  ctx.flushT = null;
  const g = ctx.game;
  if (!g || C !== ctx) return;
  const pub = g.publicState();
  for (const id of ctx.dirty) {
    const data = g.privateFor(id);
    if (id === me.id) applyPriv(ctx, data);
    else ctx.net.send({ t: "priv", to: id, data });
  }
  ctx.dirty.clear();
  ctx.net.send({ t: "state", pub });
  applyPub(ctx, pub);
  store.set("mafia:host:" + ctx.code, { hostId: me.id, at: Date.now(), json: g.serialize() });
}

function hostPresenceSweep(ctx) {
  const present = new Set(Object.keys(ctx.net.presence()));
  const now = Date.now();
  for (const p of ctx.game.players) {
    if (p.id === me.id) continue;
    if (present.has(p.id)) {
      ctx.lastSeen[p.id] = now;
      if (!p.connected) ctx.game.setConnected(p.id, true);
    } else if (p.connected && now - (ctx.lastSeen[p.id] || 0) > 12000) {
      ctx.game.setConnected(p.id, false);
    }
  }
}

function runIntent(g, m) {
  const id = String(m.id || "");
  switch (m.kind) {
    case "act": return g.act(id, String(m.act), String(m.target));
    case "vote": return g.vote(id, String(m.target));
    case "ready": return g.ready(id);
    case "leave": g.leave(id); return { ok: true };
  }
  return { ok: false };
}

function hostMessage(ctx, m) {
  const g = ctx.game;
  if (m.t === "hello" && m.id) {
    const id = String(m.id).slice(0, 24);
    ctx.lastSeen[id] = Date.now();
    g.join(id, String(m.name || "Player"), String(m.hue ?? ""));
    ctx.dirty.add(id);
    scheduleFlush(ctx);
  } else if (m.t === "intent" && g.s.players[m.id]) {
    ctx.lastSeen[m.id] = Date.now();
    const r = runIntent(g, m);
    if (r && r.ok === false && r.error) ctx.net.send({ t: "err", to: m.id, msg: r.error });
  }
}

function hostKick(id) {
  if (!C?.isHost) return;
  C.net.send({ t: "kicked", to: id });
  C.game.kick(id);
}

function logGame(ctx, summary) {
  if (!ctx.cfg.sheets) return;
  fetch("/api/log-game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(summary) })
    .then((r) => r.json())
    .then((j) => j.ok && toast("Game saved to history"))
    .catch(() => {});
}

/* ---------- client ---------- */
function beginClient(ctx) {
  enterRoomView(ctx);
  const hello = () => ctx.net.send({ t: "hello", id: me.id, name: me.name, hue: me.hue });
  hello();
  ctx.hello = hello;
  // keep asking until the host answers, and re-ask if our private role never arrived
  ctx.intervals.push(setInterval(() => {
    if (!ctx.pub || (ctx.pub.phase !== "lobby" && !ctx.priv)) hello();
    const gone = !ctx.hostPresent && ctx.pub;
    ctx.hostGone = gone ? ctx.hostGone + 1 : 0;
    updateWait(ctx);
  }, 3000));
  updateWait(ctx);
}

function clientMessage(ctx, m) {
  switch (m.t) {
    case "state":
      if (!m.pub || m.pub.code !== ctx.code) return;
      if (ctx.hostId && m.pub.hostId !== ctx.hostId) return;
      ctx.hostId = m.pub.hostId;
      applyPub(ctx, m.pub);
      break;
    case "priv":
      if (m.to === me.id) applyPriv(ctx, m.data);
      break;
    case "err":
      if (m.to === me.id) { ctx.sel = null; ctx.voteSel = null; toast(m.msg); render(); }
      break;
    case "kicked":
      if (m.to === me.id) { toast("The host removed you from the room."); leaveRoom(true); }
      break;
    case "closed":
      toast("The host closed the room.");
      leaveRoom(true);
      break;
  }
}

function onMessage(ctx, m) {
  if (C !== ctx || !m || typeof m !== "object") return;
  if (m.t === "chat") return addChat(ctx, m);
  if (ctx.isHost) hostMessage(ctx, m);
  else clientMessage(ctx, m);
}

function onPresence(ctx, state) {
  if (C !== ctx) return;
  ctx.hostPresent = Object.values(state).some((arr) => arr.some((m) => m.host));
  if (ctx.isHost) hostPresenceSweep(ctx);
  updateWait(ctx);
}

function onStatus(ctx, status) {
  if (C !== ctx && !(ctx.net && !C)) { /* connecting */ }
  ctx.online = status === "SUBSCRIBED";
  const dot = $("#connDot");
  if (dot) dot.classList.toggle("off", !ctx.online);
  if (status === "SUBSCRIBED") {
    if (ctx.connectedBefore && C === ctx) {
      if (ctx.isHost) { ctx.game.players.forEach((p) => ctx.dirty.add(p.id)); flush(ctx); }
      else ctx.hello?.();
    }
    ctx.connectedBefore = true;
  }
}

function updateWait(ctx) {
  const b = $("#waitBanner");
  if (!ctx || C !== ctx) return;
  let msg = "";
  if (!ctx.isHost) {
    if (!ctx.pub) msg = "Looking for the host… check that the room code is right.";
    else if (!ctx.hostPresent && ctx.hostGone >= 3) msg = "The host disconnected. Waiting for them to come back…";
  }
  if (!ctx.online) msg = "Connection lost. Reconnecting…";
  b.textContent = msg;
  b.classList.toggle("hidden", !msg);
}

/* ---------- intents from the local player ---------- */
function sendIntent(kind, extra = {}) {
  if (!C) return;
  if (C.isHost) {
    const r = runIntent(C.game, { id: me.id, kind, ...extra });
    if (r && r.ok === false && r.error) { toast(r.error); C.sel = null; C.voteSel = null; render(); }
  } else {
    C.net.send({ t: "intent", id: me.id, kind, ...extra });
  }
}

async function leaveRoom(silent = false) {
  const ctx = C;
  if (!ctx) return;
  if (!silent && !confirm(ctx.isHost ? "Close this room for everyone?" : "Leave this room?")) return;
  if (ctx.isHost) {
    ctx.net.send({ t: "closed" });
    store.del("mafia:host:" + ctx.code);
    await sleep(200);
  } else if (!silent) {
    ctx.net.send({ t: "intent", id: me.id, kind: "leave" });
  }
  ctx.intervals.forEach(clearInterval);
  clearTimeout(ctx.flushT);
  C = null;
  narrator.stop();
  narrator.setMood("off");
  video.leave();
  await ctx.net.close();
  store.del("mafia:session");
  document.body.dataset.phase = "lobby";
  $("#rejoin").classList.add("hidden");
  showView("home");
}

/* ====================================================================
   APPLYING STATE
==================================================================== */
function applyPub(ctx, pub) {
  if (C !== ctx) return;
  const prev = ctx.pub;
  ctx.pub = pub;
  ctx.endsAt = Date.now() + pub.endsIn;
  const key = `${pub.phase}:${pub.step}:${pub.round}`;
  if (ctx.phaseKey !== key) {
    ctx.phaseKey = key;
    ctx.total = Math.max(pub.endsIn, 1);
    onPhaseChange(ctx, prev);
  } else if (pub.endsIn > ctx.total) {
    ctx.total = pub.endsIn;
  }
  narrate(ctx, pub);
  render();
}

function applyPriv(ctx, data) {
  if (C !== ctx) return;
  const prev = ctx.priv;
  ctx.priv = data;
  if (prev?.results && data.results && data.results.length > prev.results.length && ctx.pub) {
    const r = data.results[data.results.length - 1];
    const th = theme(ctx.pub.settings.theme);
    toast(`${r.name} ${r.mafia ? "IS" : "is NOT"} ${th.teams.mafia === "Mafia" ? "Mafia" : th.roles.mafia.name}`, 6000);
  }
  if (ctx.pub) render();
}

function onPhaseChange(ctx, prev) {
  const pub = ctx.pub;
  const th = theme(pub.settings.theme);
  document.body.dataset.phase = pub.phase;
  ctx.sel = null;
  ctx.voteSel = null;
  narrator.setMood(pub.phase === "night" ? "night" : pub.phase === "over" ? "off" : "day");
  if (!prev || prev.phase === pub.phase) return;
  if (pub.phase === "night") flash(`${cap(th.town)} goes to sleep`);
  else if (pub.phase === "dawn") flash("Dawn");
  else if (pub.phase === "day") flash(`Day ${pub.round}`);
  else if (pub.phase === "vote") flash("Judgement");
  else if (pub.phase === "reveal") flash(ctx.priv?.role ? `You are the ${roleName(pub.settings.theme, ctx.priv.role)}` : ctx.priv?.god ? "You are the narrator" : "The game begins");
  else if (pub.phase === "over") flash(th.wins[pub.winner] || "Game over");
}

function narrate(ctx, pub) {
  if (ctx.spoken == null) { ctx.spoken = pub.seq; return; }
  let fresh = pub.feed.filter((f) => f.seq > ctx.spoken);
  if (!fresh.length) return;
  ctx.spoken = fresh[fresh.length - 1].seq;
  if (fresh.length > 2) fresh = fresh.slice(-2);
  for (const f of fresh) {
    const text = line(pub.settings.theme, f);
    if (pub.settings.moderator === "system") narrator.speak(text);
    switch (f.key) {
      case "night_start": narrator.sfx("night"); break;
      case "dawn_peace": case "dawn_saved": narrator.sfx("dawn"); break;
      case "dawn_death": narrator.sfx("death"); break;
      case "vote_elim": narrator.sfx("death"); break;
      case "vote_tie": case "vote_none": case "vote_nomajority": narrator.sfx("gavel"); break;
      case "win_town": case "win_mafia": {
        const mine = ctx.priv?.role === "mafia" ? "mafia" : "town";
        narrator.sfx(ctx.priv?.god || f.key === `win_${mine}` ? "win" : "lose");
        break;
      }
    }
  }
}

/* ====================================================================
   RENDERING
==================================================================== */
function mine(ctx) {
  const pub = ctx.pub;
  const p = pub.players.find((x) => x.id === me.id) || null;
  const isMod = !!p?.isMod;
  return {
    p, isMod,
    alive: !!p && p.alive && !p.spectator && !isMod,
    ghost: pub.phase !== "lobby" && !!p && !p.alive && !isMod,
    god: !!ctx.priv?.god,
    role: ctx.priv?.role || null,
  };
}

const hueOf = (p) => (Number.isFinite(+p.avatar) && p.avatar !== "" ? +p.avatar : 210);
const initial = (name) => esc(([...String(name)][0] || "?").toUpperCase());

function render() {
  const ctx = C;
  if (!ctx || !ctx.pub) return;
  const pub = ctx.pub;
  const th = theme(pub.settings.theme);
  document.body.dataset.theme = pub.settings.theme;
  narrator.setBase(th.ambience.night, th.ambience.day);
  const my = mine(ctx);
  ctx.interact = null;
  renderTop(ctx);
  renderNarration(ctx, my);
  renderModBar(ctx, my);
  renderRole(ctx, my);
  renderAction(ctx, my);
  renderPlayers(ctx, my);
  renderLobbySettings(ctx);
  renderOver(ctx, my);
  renderChat(ctx, my);
  renderVideoRules(ctx, my);
  updateWait(ctx);
}

function renderTop(ctx) {
  const pub = ctx.pub;
  $("#codeText").textContent = pub.code;
  const round = pub.round && ["night", "dawn", "day", "vote", "result"].includes(pub.phase) ? ` · ${pub.round}` : "";
  $("#phaseText").textContent = phaseLabel(pub.phase) + round;
  const ic = pub.phase === "night" ? "moon" : pub.phase === "vote" ? "vote" : pub.phase === "over" ? "flag" : pub.phase === "lobby" ? "users" : "sun";
  $("#phaseIcon").innerHTML = ICON[ic];
}

function renderNarration(ctx, my) {
  const pub = ctx.pub;
  const last = pub.feed[pub.feed.length - 1];
  let text = last ? line(pub.settings.theme, last) : "";
  if (pub.phase === "lobby") text = "Gather your friends. When everyone is here, the host starts the game.";
  const el = $("#narration");
  const html = my.isMod && pub.phase !== "lobby" ? `<small>Say aloud</small>${esc(text)}` : esc(text);
  if (el.dataset.k !== html) {
    el.dataset.k = html;
    el.innerHTML = html;
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }
}

function renderModBar(ctx, my) {
  const bar = $("#modBar");
  const show = my.isMod && TIMED.has(ctx.pub.phase);
  bar.classList.toggle("hidden", !show);
  if (!show) return;
  bar.innerHTML = `<span class="tag">Moderator</span>
    <button class="btn small" data-ctl="pause">${ctx.pub.paused ? "Resume" : "Pause"}</button>
    <button class="btn small" data-ctl="extend">+30s</button>
    <button class="btn small" data-ctl="skip">Skip phase</button>`;
}

function blurb(role, th) {
  return {
    mafia: `Each night, ${lc(th.roles.mafia.plural)} choose one person to eliminate. By day, blend in. You win once you equal everyone else in number.`,
    villager: `You have no night power, only your voice and your vote. Find ${lc(th.roles.mafia.plural)} and eliminate them.`,
    doctor: "Each night you may protect one person from the nightly attack.",
    detective: `Each night you may investigate one person and learn whether they are ${th.roles.mafia.name}.`,
  }[role];
}

function renderRole(ctx, my) {
  const card = $("#roleCard");
  const pub = ctx.pub;
  const priv = ctx.priv;
  const th = theme(pub.settings.theme);
  const names = Object.fromEntries(pub.players.map((p) => [p.id, p.name]));
  if (!priv || pub.phase === "lobby" || (!priv.god && !priv.role)) return card.classList.add("hidden");
  card.classList.remove("hidden");

  if (priv.god) {
    const roles = priv.roles || {};
    const list = pub.players.filter((p) => !p.isMod && !p.spectator)
      .map((p) => `<span class="${p.alive ? "" : "dead"}">${esc(p.name)} · ${esc(roleName(pub.settings.theme, roles[p.id]))}</span>`).join("");
    let picks = "";
    if (priv.picks && pub.phase === "night") {
      const fmt = (o) => Object.entries(o || {}).map(([a, b]) => `${esc(names[a])} → ${esc(names[b])}`).join(", ") || "none yet";
      picks = `<div class="picks">${esc(th.roles.mafia.name)}: ${fmt(priv.picks.mafia)}<br>${esc(th.roles.doctor.name)}: ${fmt(priv.picks.doctor)}<br>${esc(th.roles.detective.name)}: ${fmt(priv.picks.detective)}</div>`;
    }
    card.className = "role-card";
    card.innerHTML = `<div class="top"><div class="badge-ico">${ICON.eye}</div><div><div class="team">Moderator</div><div class="nm">Narrator view</div></div></div>
      <div class="detail"><p>You see everything. Read the script above, and use the controls to pace the game.</p><div class="godlist">${list}</div>${picks}</div>`;
    return;
  }

  const role = priv.role;
  const hidden = ctx.roleHidden;
  const team = role === "mafia" ? th.teams.mafia : th.teams.town;
  let extra = "";
  if (role === "mafia" && priv.team) {
    extra += `<ul><li>Your team: ${priv.team.map((id) => `<b>${esc(names[id] || "?")}</b>${pub.players.find((p) => p.id === id)?.alive ? "" : " (out)"}`).join(", ")}</li></ul>`;
  }
  if (role === "detective" && priv.results?.length) {
    extra += `<ul>${priv.results.map((r) => `<li>Night ${r.round}: ${esc(r.name)} <span class="${r.mafia ? "bad" : "ok"}">${r.mafia ? "IS " + esc(th.roles.mafia.name) : "is not " + esc(th.roles.mafia.name)}</span></li>`).join("")}</ul>`;
  }
  if (role === "doctor" && priv.lastSaved) {
    extra += `<ul><li>Last protected: <b>${esc(names[priv.lastSaved] || "?")}</b></li></ul>`;
  }
  const ghost = !my.alive && pub.phase !== "over" ? `<p><b>You are out of the game.</b> Ghosts can watch and chat, but not speak to the living.</p>` : "";
  card.className = "role-card" + (hidden ? " hide" : "");
  card.innerHTML = `<div class="top"><div class="badge-ico">${ICON[role]}</div>
      <div><div class="team">${hidden ? "Hidden" : esc(team)}</div><div class="nm">${hidden ? "••••••" : esc(th.roles[role].name)}</div></div>
      <button class="icon-btn eye" data-eye title="Show or hide your role">${hidden ? ICON.eye : ICON.eyeOff}</button></div>
      <div class="detail"><p>${esc(blurb(role, th))}</p>${extra}${ghost}</div>`;
}

const PROMPT = {
  mafia: ["Choose your victim", "Your team sees each other's picks in chat. The most-picked target is eliminated."],
  doctor: ["Choose who to protect", "If the Mafia pick them, they survive the night."],
  detective: ["Choose who to investigate", "You will learn whether they are Mafia at dawn."],
};

function renderAction(ctx, my) {
  const box = $("#actionCard");
  const pub = ctx.pub, priv = ctx.priv, st = pub.settings, th = theme(st.theme);
  const nameOf = (id) => pub.players.find((p) => p.id === id)?.name || "?";
  box.classList.remove("pulse");
  box.classList.toggle("hidden", pub.phase === "over");
  let html = "";

  switch (pub.phase) {
    case "lobby": {
      const players = pub.players.filter((p) => !p.spectator && !(st.moderator === "host" && p.id === pub.hostId));
      const pl = pub.planned || {};
      const villagers = Math.max(0, players.length - (pl.mafia || 0) - (pl.doctor || 0) - (pl.detective || 0));
      const link = `${location.origin}${location.pathname}?room=${pub.code}${useLocal ? "&local=1" : ""}`;
      html = `<h3>Waiting room</h3><p>${players.length} player${players.length === 1 ? "" : "s"} here${players.length < MIN_PLAYERS ? ` · need ${MIN_PLAYERS - players.length} more` : ""}</p>
        <div class="comp"><span><b>${pl.mafia || 0}</b> ${esc(th.roles.mafia.name)}</span><span><b>${pl.doctor || 0}</b> ${esc(th.roles.doctor.name)}</span><span><b>${pl.detective || 0}</b> ${esc(th.roles.detective.name)}</span><span><b>${villagers}</b> ${esc(th.roles.villager.name)}</span></div>
        <div class="invite">${esc(link.replace(/^https?:\/\//, ""))} <button class="btn small" data-copy="${esc(link)}">Copy link</button></div>`;
      if (ctx.isHost) {
        const chk = ctx.game.canStart();
        html += `<div class="row"><button class="btn primary" data-start ${chk.ok ? "" : "disabled"}>Start game</button></div>${chk.ok ? "" : `<p class="note warn">${esc(chk.error)}</p>`}`;
      } else {
        html += `<p class="note">Waiting for the host to start…</p>`;
      }
      break;
    }
    case "reveal":
      html = `<h3>Roles are dealt</h3><p>${my.isMod ? "Everyone is looking at their role. Get ready to narrate." : "Check your role card above, and keep it to yourself."}</p>`;
      break;
    case "night": {
      const step = pub.step;
      if (my.isMod) {
        html = `<h3>${esc(roleName(st.theme, step) || "…")} is awake</h3><p>Watch the picks in your narrator view. Read the script aloud on the call.</p>`;
      } else if (my.alive && my.role === step) {
        const act = STEP_ACTION[step];
        const cur = ctx.sel || priv?.pick;
        box.classList.add("pulse");
        html = `<h3>${PROMPT[step][0]}</h3><p>${PROMPT[step][1]}</p>${cur ? `<div class="sel">Selected: ${esc(nameOf(cur))}</div>` : `<p class="note">Tap a player below.</p>`}`;
        ctx.interact = {
          kind: "act", act,
          ok: (p) => {
            if (!p.alive || p.isMod || p.spectator) return false;
            if (step === "mafia") return !priv?.team?.includes(p.id);
            if (step === "detective") return p.id !== me.id;
            if (step === "doctor") return (p.id !== me.id || st.doctorSelfSave) && !(st.doctorNoRepeat && priv?.lastSaved === p.id);
            return false;
          },
        };
      } else if (my.alive) {
        html = `<h3>Eyes closed</h3><p>${esc(cap(th.town))} sleeps. Stay silent until morning.</p>`;
      } else {
        html = `<h3>You are watching</h3><p>Ghosts see the night but cannot interfere.</p>`;
      }
      break;
    }
    case "dawn":
      html = `<h3>Dawn</h3><p>The night is over. See who made it through.</p>`;
      break;
    case "day": {
      const aliveN = pub.players.filter((p) => p.alive && !p.isMod && !p.spectator).length;
      const ready = pub.readyIds.length;
      html = `<h3>Discuss</h3><p>Find ${esc(lc(th.roles.mafia.plural))}. Accuse, defend, persuade.</p>`;
      if (my.alive && st.skipDayMajority) {
        const on = pub.readyIds.includes(me.id);
        html += `<div class="row"><button class="btn ${on ? "primary" : ""}" data-ready>${on ? "Ready to vote ✓" : "Ready to vote"} · ${ready}/${aliveN}</button></div>`;
      }
      break;
    }
    case "vote": {
      if (my.alive) {
        const cur = pub.votes[me.id] || ctx.voteSel;
        box.classList.add("pulse");
        html = `<h3>Cast your vote</h3><p>Votes are public. You can change yours until time runs out.</p>
          <div class="sel">${cur ? (cur === "abstain" ? "You are abstaining" : "Your vote: " + esc(nameOf(cur))) : "Tap a player below."}</div>`;
        if (st.allowAbstain) html += `<div class="row"><button class="btn small ${cur === "abstain" ? "primary" : ""}" data-abstain>Abstain</button></div>`;
        ctx.interact = { kind: "vote", ok: (p) => p.alive && !p.isMod && !p.spectator && p.id !== me.id };
      } else {
        html = `<h3>Voting</h3><p>${my.isMod ? "Watch the open votes come in." : "Ghosts can only watch."}</p>`;
      }
      break;
    }
    case "result":
      html = `<h3>Verdict</h3><p>The votes are counted.</p>`;
      break;
  }
  box.innerHTML = html;
}

function renderPlayers(ctx, my) {
  const pub = ctx.pub;
  const th = theme(pub.settings.theme);
  const roles = ctx.priv?.roles || {};
  const team = ctx.priv?.team || [];
  const tally = {};
  for (const [v, t] of Object.entries(pub.votes)) if (t !== "abstain") (tally[t] ||= []).push(v);
  const byId = Object.fromEntries(pub.players.map((p) => [p.id, p]));
  const inGame = pub.players.filter((p) => !p.isMod && !p.spectator);
  const aliveN = inGame.filter((p) => p.alive).length;
  $("#playersTitle").textContent = pub.phase === "lobby" ? `Players · ${inGame.length}` : `Players · ${aliveN} alive of ${inGame.length}`;

  const html = pub.players.map((p) => {
    const can = ctx.interact?.ok(p);
    const sel = ctx.interact?.kind === "act"
      ? (ctx.sel || ctx.priv?.pick) === p.id
      : ctx.interact?.kind === "vote" && (pub.votes[me.id] || ctx.voteSel) === p.id;
    const voters = tally[p.id] || [];
    const meta = [];
    let metaCls = "";
    if (p.id === me.id) meta.push("You");
    if (p.id === pub.hostId) meta.push("Host");
    if (p.isMod) meta.push("Moderator");
    else if (p.spectator) meta.push("Spectator");
    else if (p.role) meta.push(roleName(pub.settings.theme, p.role));
    else if (roles[p.id]) { meta.push(roleName(pub.settings.theme, roles[p.id])); if (roles[p.id] === "mafia") metaCls = "mafia"; }
    else if (team.includes(p.id) && p.id !== me.id) { meta.push(th.roles.mafia.name); metaCls = "mafia"; }
    if (p.role === "mafia") metaCls = "mafia";
    const cls = ["chip", can ? "can" : "", sel ? "sel" : "", !p.alive && !p.isMod && !p.spectator ? "dead" : "", p.spectator ? "dead" : "", !p.connected ? "off" : "", voters.length ? "has-voters" : ""].filter(Boolean).join(" ");
    const kick = ctx.isHost && pub.phase === "lobby" && p.id !== me.id ? `<span class="kick" data-kick="${esc(p.id)}" title="Remove player">×</span>` : "";
    return `<div class="${cls}" data-id="${esc(p.id)}" ${can ? 'role="button" tabindex="0"' : ""}>
      <span class="av" style="--h:${hueOf(p)}">${initial(p.name)}</span>
      <span class="tx"><span class="nm">${esc(p.name)}</span><span class="meta ${metaCls}">${esc(meta.join(" · "))}</span></span>
      ${kick}
      ${voters.length ? `<span class="count">${voters.length}</span><span class="voters">${voters.map((v) => `<i style="--h:${hueOf(byId[v] || {})}" title="${esc(byId[v]?.name || "")}">${initial(byId[v]?.name || "?")}</i>`).join("")}</span>` : ""}
    </div>`;
  }).join("");

  const wrap = $("#players");
  wrap.classList.toggle("night", pub.phase === "night");
  wrap.innerHTML = html;
}

function renderLobbySettings(ctx) {
  const box = $("#lobbySettings");
  const show = ctx.pub.phase === "lobby";
  box.classList.toggle("hidden", !show);
  if (!show) return;
  buildSettingsForm(box, ctx.pub, ctx.isHost, (patch) => {
    if (patch.autoRoles === false && ctx.pub.planned) patch.roles = { ...ctx.pub.planned };
    ctx.game.setSettings(patch);
  });
}

function renderOver(ctx, my) {
  const box = $("#overCard");
  const pub = ctx.pub;
  const show = pub.phase === "over";
  box.classList.toggle("hidden", !show);
  if (!show) return;
  const th = theme(pub.settings.theme);
  const rows = pub.players.filter((p) => !p.isMod && !p.spectator).map((p) => {
    const won = (p.role === "mafia") === (pub.winner === "mafia");
    return `<tr><td>${esc(p.name)}</td><td class="${p.role === "mafia" ? "bad" : ""}">${esc(roleName(pub.settings.theme, p.role))}</td><td class="${won ? "win" : "dead"}">${p.alive ? "Survived" : "Eliminated"}${won ? " · Won" : ""}</td></tr>`;
  }).join("");
  box.innerHTML = `<h3>${esc(th.wins[pub.winner] || "")}</h3><p class="sub">${pub.round} night${pub.round === 1 ? "" : "s"} survived</p>
    <table>${rows}</table>
    <div class="row" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      ${ctx.isHost ? `<button class="btn primary" data-again>Play again</button>` : `<span class="muted small">Waiting for the host to start another round…</span>`}
      <button class="btn" data-leave>Leave</button>
    </div>`;
}

/* ====================================================================
   CHAT
==================================================================== */
function canSee(ctx, my, ch) {
  const ph = ctx.pub.phase;
  if (ch === "public" || ch === "log") return true;
  if (ph === "over") return true;
  if (ch === "mafia") return my.god || my.role === "mafia" || (my.ghost && ctx.pub.settings.ghostsSeeAll);
  if (ch === "ghost") return my.ghost || my.god;
  return false;
}

function canPost(ctx, my, ch) {
  const ph = ctx.pub.phase;
  if (ph === "lobby" || ph === "over") return ch === "public";
  if (ch === "public") return my.isMod || (my.alive && ph !== "night");
  if (ch === "mafia") return my.role === "mafia" && my.alive;
  if (ch === "ghost") return my.ghost || my.isMod;
  return false;
}

function channels(ctx, my) {
  const th = theme(ctx.pub.settings.theme);
  const list = [{ id: "public", label: th.teams.town }];
  if (canSee(ctx, my, "mafia") && ctx.pub.phase !== "lobby") list.push({ id: "mafia", label: th.teams.mafia });
  if (canSee(ctx, my, "ghost") && ctx.pub.phase !== "lobby") list.push({ id: "ghost", label: "Ghosts" });
  list.push({ id: "log", label: "Log" });
  return list;
}

function addChat(ctx, m) {
  if (C !== ctx || typeof m.text !== "string" || !["public", "mafia", "ghost"].includes(m.ch)) return;
  if (ctx.chat.some((x) => x.mid === m.mid)) return;
  ctx.chat.push({ mid: m.mid, id: String(m.id), name: String(m.name || "?").slice(0, 18), hue: Number(m.hue) || 210, ch: m.ch, text: m.text.slice(0, 300), ts: m.ts });
  if (ctx.chat.length > 250) ctx.chat.shift();
  if (ctx.pub) {
    const my = mine(ctx);
    if (m.ch !== ctx.ch && m.id !== me.id && canSee(ctx, my, m.ch)) {
      ctx.unread[m.ch] = true;
      if ($("#room").dataset.tab !== "chat") $("#chatDot").classList.remove("hidden");
    }
    renderChat(ctx, my);
  }
}

function renderChat(ctx, my) {
  const th = theme(ctx.pub.settings.theme);
  const chans = channels(ctx, my);
  if (!chans.find((c) => c.id === ctx.ch)) ctx.ch = "public";
  // tabs
  const tabs = $("#chatTabs");
  tabs.innerHTML = chans.map((c) => `<button data-ch="${c.id}" class="${c.id === ctx.ch ? "on" : ""} ${ctx.unread[c.id] && c.id !== ctx.ch ? "unread" : ""}">${esc(c.label)}</button>`).join("");
  // log
  const log = $("#chatLog");
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  let html = "";
  if (ctx.ch === "log") {
    html = ctx.pub.feed.map((f) => `<div class="msg sys">${esc(line(ctx.pub.settings.theme, f))}</div>`).join("") || `<div class="chat-empty">Nothing has happened yet.</div>`;
  } else {
    const msgs = ctx.chat.filter((m) => m.ch === ctx.ch);
    html = msgs.map((m) => `<div class="msg ${m.id === me.id ? "me" : ""}" style="--h:${m.hue}"><div class="who">${esc(m.name)}</div><div class="tx">${esc(m.text)}</div></div>`).join("") ||
      `<div class="chat-empty">${ctx.ch === "mafia" ? esc(cap(th.roles.mafia.plural)) + " can plot here." : ctx.ch === "ghost" ? "Ghosts talk here. The living cannot hear you." : "No messages yet."}</div>`;
  }
  if (log.dataset.sig !== html) {
    log.dataset.sig = html;
    log.innerHTML = html;
    if (nearBottom || ctx.ch === "log") log.scrollTop = log.scrollHeight;
  }
  // input
  const input = $("#chatInput");
  const ok = ctx.ch !== "log" && canPost(ctx, my, ctx.ch);
  input.disabled = !ok;
  $("#chatForm button").disabled = !ok;
  input.placeholder = ok ? "Say something…"
    : ctx.ch === "log" ? "Game log"
    : ctx.pub.phase === "night" ? `${cap(th.town)} sleeps. Public chat is locked.`
    : ctx.ch === "public" && !my.alive ? "Ghosts cannot talk to the living (use Ghosts)"
    : "You cannot post here";
}

function sendChat(text) {
  const ctx = C;
  if (!ctx?.pub) return;
  const my = mine(ctx);
  text = text.trim().slice(0, 300);
  if (!text || !canPost(ctx, my, ctx.ch)) return;
  if (Date.now() - ctx.lastSent < 600) return;
  ctx.lastSent = Date.now();
  const m = { t: "chat", mid: rid(8), id: me.id, name: me.name, hue: me.hue, ch: ctx.ch, text, ts: Date.now() };
  ctx.net.send(m);
  addChat(ctx, m);
}

/* ====================================================================
   VIDEO
==================================================================== */
function renderVideoRules(ctx, my) {
  const pub = ctx.pub;
  const th = theme(pub.settings.theme);
  const ph = pub.phase;
  const allowed = ph === "lobby" || ph === "over" || my.isMod || (my.alive && ph !== "night");
  video.enforce(allowed);
  const box = $("#videoBox");
  box.classList.toggle("silenced", !allowed);
  $("#videoVeil span").textContent = ph === "night" ? `${cap(th.town)} sleeps. Cameras and mics are off.` : "Ghosts keep quiet. You can still watch and chat.";
}

async function toggleVideo() {
  const ctx = C;
  if (!ctx?.pub) return;
  const btn = $("#btnVideo");
  btn.disabled = true;
  btn.textContent = "Connecting…";
  try {
    await video.join({ cfg: ctx.cfg, room: `${ctx.code}${ctx.pub.vkey || ""}`, name: me.name, id: me.id, host: ctx.isHost, parent: $("#videoHolder") });
  } catch (e) {
    toast(String(e.message || e), 5000);
    btn.disabled = false;
    btn.textContent = "Join video";
  }
}

/* ====================================================================
   TIMER
==================================================================== */
function tickUI() {
  const ctx = C;
  if (!ctx?.pub) return;
  const pub = ctx.pub;
  const tEl = $("#timerText"), bar = $("#timerBar");
  if (!TIMED.has(pub.phase)) {
    tEl.textContent = "";
    bar.style.width = "0%";
    return;
  }
  const left = pub.paused ? pub.endsIn : Math.max(0, ctx.endsAt - Date.now());
  const s = Math.ceil(left / 1000);
  tEl.textContent = pub.paused ? "Paused" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const low = !pub.paused && s <= 10 && (pub.phase === "day" || pub.phase === "vote");
  tEl.classList.toggle("low", low);
  bar.style.width = Math.min(100, (left / ctx.total) * 100) + "%";
  if (!pub.paused && (pub.phase === "day" || pub.phase === "vote") && s >= 1 && s <= 5) {
    if (ctx.lastTick !== s) { ctx.lastTick = s; narrator.sfx("tick"); }
  } else if (s > 5) ctx.lastTick = null;
}

/* ====================================================================
   UI WIRING
==================================================================== */
function switchTab(tab) {
  $("#room").dataset.tab = tab;
  $$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab === "chat") {
    $("#chatDot").classList.add("hidden");
    if (C) { C.unread[C.ch] = false; const l = $("#chatLog"); setTimeout(() => (l.scrollTop = l.scrollHeight), 30); }
  }
}

function copyText(text) {
  const done = () => toast("Link copied");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => prompt("Copy this link", text));
  else prompt("Copy this link", text);
}

function initRoomUI() {
  $("#btnLeave").addEventListener("click", () => leaveRoom(false));
  $("#codeBtn").addEventListener("click", () => {
    if (!C) return;
    copyText(`${location.origin}${location.pathname}?room=${C.code}${useLocal ? "&local=1" : ""}`);
  });
  $("#tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) switchTab(b.dataset.tab);
  });

  $("#actionCard").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || !C) return;
    if (t.dataset.copy) copyText(t.dataset.copy);
    else if ("start" in t.dataset) { const r = C.game.start(); if (!r.ok) toast(r.error); }
    else if ("ready" in t.dataset) sendIntent("ready");
    else if ("abstain" in t.dataset) { C.voteSel = "abstain"; sendIntent("vote", { target: "abstain" }); render(); }
  });

  $("#players").addEventListener("click", (e) => {
    if (!C) return;
    const k = e.target.closest("[data-kick]");
    if (k) { hostKick(k.dataset.kick); return; }
    const chip = e.target.closest(".chip.can");
    if (!chip || !C.interact) return;
    const id = chip.dataset.id;
    if (C.interact.kind === "act") { C.sel = id; sendIntent("act", { act: C.interact.act, target: id }); }
    else if (C.interact.kind === "vote") { C.voteSel = id; sendIntent("vote", { target: id }); }
    render();
  });
  $("#players").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".chip.can")) { e.preventDefault(); e.target.click(); }
  });

  $("#roleCard").addEventListener("click", (e) => {
    if (e.target.closest("[data-eye]") && C) { C.roleHidden = !C.roleHidden; render(); }
  });

  $("#modBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ctl]");
    if (!b || !C?.isHost) return;
    C.game.control(b.dataset.ctl, 30);
  });

  $("#overCard").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !C) return;
    if ("again" in b.dataset && C.isHost) C.game.reset();
    if ("leave" in b.dataset) leaveRoom(false);
  });

  $("#chatTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ch]");
    if (!b || !C) return;
    C.ch = b.dataset.ch;
    C.unread[C.ch] = false;
    $("#chatLog").dataset.sig = "";
    renderChat(C, mine(C));
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  });
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const i = $("#chatInput");
    sendChat(i.value);
    i.value = "";
  });

  $("#btnVideo").addEventListener("click", toggleVideo);
  $("#btnVideoLeave").addEventListener("click", () => video.leave());
}

function initSettingsDialog() {
  const dlg = $("#settingsDialog");
  const bind = (id, key, type = "value") => {
    const el = $("#" + id);
    el[type === "check" ? "checked" : "value"] = prefs[key];
    el.addEventListener("input", () => {
      prefs[key] = type === "check" ? el.checked : type === "num" ? parseFloat(el.value) : el.value;
      store.set("mafia:prefs", prefs);
      applyPrefs();
      labels();
    });
  };
  const labels = () => {
    $("#pRateV").textContent = prefs.rate.toFixed(2) + "×";
    $("#pPitchV").textContent = prefs.pitch.toFixed(2);
    $("#pVolumeV").textContent = Math.round(prefs.volume * 100) + "%";
  };
  bind("pVoiceOn", "voiceOn", "check");
  bind("pAmbient", "ambient", "check");
  bind("pSfx", "sfx", "check");
  bind("pMotion", "reduce", "check");
  ["pRate:rate", "pPitch:pitch", "pVolume:volume"].forEach((s) => {
    const [id, key] = s.split(":");
    const el = $("#" + id);
    el.value = prefs[key];
    el.addEventListener("input", () => {
      prefs[key] = parseFloat(el.value);
      store.set("mafia:prefs", prefs);
      applyPrefs();
      labels();
    });
  });
  const fillVoices = (voices) => {
    const sel = $("#pVoice");
    sel.innerHTML = `<option value="">Automatic (deep English)</option>` + voices.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
    sel.value = prefs.voice;
  };
  narrator.onVoices = fillVoices;
  fillVoices(narrator.voices);
  $("#pVoice").addEventListener("change", (e) => {
    prefs.voice = e.target.value;
    store.set("mafia:prefs", prefs);
    applyPrefs();
  });
  $("#btnTestVoice").addEventListener("click", () => {
    narrator.unlock();
    narrator.stop();
    const th = C?.pub ? C.pub.settings.theme : "noir";
    const wasOn = narrator.voiceOn;
    narrator.voiceOn = true;
    narrator.speak(line(th, { key: "night_start", seq: 0, vars: {} }));
    narrator.voiceOn = wasOn;
  });
  $("#btnSettings").addEventListener("click", () => { labels(); dlg.showModal(); });
  labels();
  applyPrefs();
}

/* ---------------- boot ---------------- */
initHome();
initRoomUI();
initSettingsDialog();
getCfg().then((cfg) => {
  if (!useLocal && (!cfg.supabaseUrl || !cfg.supabaseAnonKey)) {
    homeError("This deployment has no realtime backend yet. Set SUPABASE_URL and SUPABASE_ANON_KEY (see README), or open with ?local=1 to try it across tabs on this device.");
  }
});
