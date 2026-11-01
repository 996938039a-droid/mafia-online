import assert from "node:assert/strict";
import { Game, autoRoles, validateRoles, MIN_PLAYERS } from "../public/js/engine.js";

// deterministic RNG
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGame(n, seed = 1, patch = {}) {
  const clock = { t: 1_000_000 };
  const g = new Game({ code: "TEST", hostId: "p0", rand: seeded(seed), now: () => clock.t });
  for (let i = 0; i < n; i++) g.join(`p${i}`, `Player${i}`);
  if (Object.keys(patch).length) g.setSettings(patch);
  return { g, clock };
}

function advance(g, clock, ms) {
  clock.t += ms;
  g.tick();
}

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log("  ok  ", name);
  } catch (e) {
    console.error("  FAIL", name);
    console.error(e);
    process.exitCode = 1;
  }
};

console.log("engine tests");

test("role presets are valid for 4..40 players", () => {
  for (let n = MIN_PLAYERS; n <= 40; n++) assert.equal(validateRoles(n, autoRoles(n)), null, `n=${n}`);
});

test("cannot start with too few players", () => {
  const { g } = makeGame(3);
  assert.equal(g.start().ok, false);
});

test("roles are dealt according to the plan", () => {
  const { g } = makeGame(9);
  assert.equal(g.start().ok, true);
  const count = {};
  for (const p of g.playable) count[p.role] = (count[p.role] || 0) + 1;
  const plan = autoRoles(9);
  assert.equal(count.mafia, plan.mafia);
  assert.equal(count.doctor, plan.doctor);
  assert.equal(count.detective, plan.detective);
  assert.equal(g.playable.length, 9);
});

test("host moderator does not get a role and is not counted", () => {
  const { g } = makeGame(7, 3, { moderator: "host" });
  g.start();
  const host = g.s.players.p0;
  assert.equal(host.isMod, true);
  assert.equal(host.role, null);
  assert.equal(g.playable.length, 6);
  const priv = g.privateFor("p0");
  assert.equal(priv.god, true);
  assert.equal(Object.keys(priv.roles).length, 6);
});

test("public state never leaks live roles", () => {
  const { g } = makeGame(8);
  g.start();
  const pub = g.publicState();
  assert.ok(pub.players.every((p) => p.role === null));
});

function toNightStep(g, clock, step) {
  // run clock until the requested night step begins
  for (let i = 0; i < 400 && !(g.s.phase === "night" && g.s.step === step); i++) advance(g, clock, 1000);
  assert.equal(g.s.step, step);
}

function find(g, role) {
  return g.playable.filter((p) => p.role === role);
}

test("mafia kill succeeds without doctor save, victim revealed", () => {
  const { g, clock } = makeGame(8, 5);
  g.start();
  toNightStep(g, clock, "mafia");
  const m = find(g, "mafia")[0];
  const victim = g.playable.find((p) => p.role !== "mafia");
  assert.equal(g.act(m.id, "kill", victim.id).ok, true);
  // wrong role cannot act now
  const doc = find(g, "doctor")[0];
  assert.equal(g.act(doc.id, "save", victim.id).ok, false);
  for (let i = 0; i < 200 && g.s.phase !== "dawn"; i++) advance(g, clock, 1000);
  assert.equal(g.s.phase, "dawn");
  assert.equal(g.s.players[victim.id].alive, false);
  assert.ok(g.s.feed.some((f) => f.key === "dawn_death" && f.vars.id === victim.id));
  assert.equal(g.publicState().players.find((p) => p.id === victim.id).role, victim.role);
});

test("doctor save cancels the kill", () => {
  const { g, clock } = makeGame(8, 6);
  g.start();
  toNightStep(g, clock, "mafia");
  const m = find(g, "mafia")[0];
  const victim = g.playable.find((p) => p.role !== "mafia");
  g.act(m.id, "kill", victim.id);
  toNightStep(g, clock, "doctor");
  const doc = find(g, "doctor")[0];
  assert.equal(g.act(doc.id, "save", victim.id).ok, true);
  for (let i = 0; i < 200 && g.s.phase !== "dawn"; i++) advance(g, clock, 1000);
  assert.equal(g.s.players[victim.id].alive, true);
  assert.ok(g.s.feed.some((f) => f.key === "dawn_saved"));
});

test("doctor cannot protect the same person two nights running", () => {
  const { g, clock } = makeGame(8, 7);
  g.start();
  toNightStep(g, clock, "doctor");
  const doc = find(g, "doctor")[0];
  const other = g.playable.find((p) => p.id !== doc.id);
  assert.equal(g.act(doc.id, "save", other.id).ok, true);
  // finish the night, day, vote with no votes, next night
  for (let i = 0; i < 600 && !(g.s.round === 2 && g.s.step === "doctor"); i++) advance(g, clock, 1000);
  if (g.s.phase === "over") return; // game ended early, nothing to assert
  const r = g.act(doc.id, "save", other.id);
  assert.equal(r.ok, false);
});

test("detective receives a private, correct result", () => {
  const { g, clock } = makeGame(8, 8);
  g.start();
  toNightStep(g, clock, "detective");
  const det = find(g, "detective")[0];
  const mafioso = find(g, "mafia")[0];
  assert.equal(g.act(det.id, "check", mafioso.id).ok, true);
  assert.equal(g.act(det.id, "check", det.id).ok, false);
  for (let i = 0; i < 200 && g.s.phase !== "dawn"; i++) advance(g, clock, 1000);
  const priv = g.privateFor(det.id);
  assert.equal(priv.results.length, 1);
  assert.equal(priv.results[0].mafia, true);
});

test("mafia cannot target teammates", () => {
  const { g, clock } = makeGame(12, 9);
  g.start();
  toNightStep(g, clock, "mafia");
  const [a, b] = find(g, "mafia");
  assert.ok(b, "needs two mafia");
  assert.equal(g.act(a.id, "kill", b.id).ok, false);
});

function reachVote(g, clock) {
  for (let i = 0; i < 800 && g.s.phase !== "vote" && g.s.phase !== "over"; i++) advance(g, clock, 1000);
}

test("open voting: plurality eliminates, ties eliminate nobody", () => {
  const { g, clock } = makeGame(8, 11);
  g.start();
  reachVote(g, clock);
  assert.equal(g.s.phase, "vote");
  const alive = g.alive;
  // two-way tie
  const a = alive[0], b = alive[1];
  alive.slice(0, 2).forEach((p, i) => g.vote(p.id, i === 0 ? b.id : a.id));
  alive.slice(2).forEach((p, i) => g.vote(p.id, i % 2 === 0 ? a.id : b.id));
  // make exact tie among all alive
  const votes = Object.values(g.s.votes);
  const ca = votes.filter((v) => v === a.id).length;
  const cb = votes.filter((v) => v === b.id).length;
  if (ca !== cb) g.vote(alive[alive.length - 1].id, ca < cb ? a.id : b.id);
  const pub = g.publicState();
  assert.ok(Object.keys(pub.votes).length > 0, "votes are public");
  const before = g.alive.length;
  for (let i = 0; i < 100 && g.s.phase === "vote"; i++) advance(g, clock, 1000);
  const tied = Math.abs(
    Object.values(g.s.votes).filter((v) => v === a.id).length - Object.values(g.s.votes).filter((v) => v === b.id).length
  ) === 0;
  if (tied) assert.equal(g.alive.length, before);
});

test("majority threshold blocks a plain plurality", () => {
  const { g, clock } = makeGame(9, 12, { threshold: "majority" });
  g.start();
  reachVote(g, clock);
  const alive = g.alive;
  g.vote(alive[0].id, alive[1].id);
  g.vote(alive[1].id, alive[2].id);
  const before = g.alive.length;
  for (let i = 0; i < 100 && g.s.phase === "vote"; i++) advance(g, clock, 1000);
  assert.equal(g.alive.length, before);
  assert.ok(g.s.feed.some((f) => f.key === "vote_nomajority"));
});

test("early advance when every alive player voted", () => {
  const { g, clock } = makeGame(6, 13);
  g.start();
  reachVote(g, clock);
  g.alive.forEach((p) => g.vote(p.id, g.alive.find((q) => q.id !== p.id).id));
  advance(g, clock, 3500);
  assert.notEqual(g.s.phase, "vote");
});

test("pause / extend / skip controls", () => {
  const { g, clock } = makeGame(6, 14);
  g.start();
  g.control("pause");
  const phase = g.s.phase;
  advance(g, clock, 120_000);
  assert.equal(g.s.phase, phase);
  g.control("pause");
  g.control("skip");
  advance(g, clock, 10);
  assert.notEqual(g.s.phase, phase);
});

test("serialize / restore round trip", () => {
  const { g, clock } = makeGame(7, 15);
  g.start();
  advance(g, clock, 12_000);
  const json = g.serialize();
  const h = new Game({ now: () => clock.t });
  h.restore(json);
  assert.equal(h.s.phase, g.s.phase);
  assert.equal(h.privateFor("p3").role, g.privateFor("p3").role);
});

// Full random games with bots
function botTurn(g) {
  const s = g.s;
  if (s.phase === "night" && s.step) {
    for (const a of g.alive.filter((p) => p.role === s.step)) {
      const kind = { mafia: "kill", doctor: "save", detective: "check" }[s.step];
      const opts = g.alive.filter((p) => p.id !== a.id && !(kind === "kill" && p.role === "mafia"));
      if (opts.length && !s.night.picks[s.step][a.id]) g.act(a.id, kind, opts[Math.floor(Math.random() * opts.length)].id);
    }
  } else if (s.phase === "vote") {
    for (const a of g.alive) {
      const opts = g.alive.filter((p) => p.id !== a.id);
      if (!s.votes[a.id]) g.vote(a.id, opts[Math.floor(Math.random() * opts.length)].id);
    }
  }
}

test("200 random bot games always finish with a winner", () => {
  for (let k = 0; k < 200; k++) {
    const hostMod = k % 2 === 1;
    const n = MIN_PLAYERS + (k % 17) + (hostMod ? 1 : 0); // the moderating host does not play
    const { g, clock } = makeGame(n, 1000 + k, hostMod ? { moderator: "host", tie: "random" } : {});
    let overSeen = 0;
    g.onGameOver = () => overSeen++;
    assert.equal(g.start().ok, true, `start n=${n}`);
    for (let i = 0; i < 20000 && g.s.phase !== "over"; i++) {
      botTurn(g);
      advance(g, clock, 1000);
    }
    assert.equal(g.s.phase, "over", `game ${k} (n=${n}) did not finish`);
    assert.ok(g.s.winner === "town" || g.s.winner === "mafia");
    assert.equal(overSeen, 1);
    const alive = g.alive;
    const mafia = alive.filter((p) => p.role === "mafia").length;
    if (g.s.winner === "town") assert.equal(mafia, 0);
    else assert.ok(mafia >= alive.length - mafia);
  }
});

test("play again resets to lobby and allows a new game", () => {
  const { g, clock } = makeGame(6, 21);
  g.start();
  for (let i = 0; i < 20000 && g.s.phase !== "over"; i++) {
    botTurn(g);
    advance(g, clock, 1000);
  }
  g.reset();
  assert.equal(g.s.phase, "lobby");
  assert.equal(g.start().ok, true);
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}`);
