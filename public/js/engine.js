// engine.js: pure game logic. No DOM, no network.
// Runs inside the host's browser (and in Node for tests).
// Roles: mafia, villager, doctor, detective.

export const NIGHT_STEPS = ["mafia", "doctor", "detective"];
export const STEP_ACTION = { mafia: "kill", doctor: "save", detective: "check" };

export const DEFAULT_SETTINGS = {
  theme: "noir",
  moderator: "system", // "system" = the voiced narrator runs the game, "host" = the host narrates and does not play
  autoRoles: true,
  roles: { mafia: 1, doctor: 1, detective: 1 },
  timers: { reveal: 10, night: 25, dawn: 7, day: 120, vote: 45, result: 8 }, // night = seconds per role step
  tie: "none", // "none" = nobody is eliminated, "random" = pick one of the tied
  threshold: "plurality", // "plurality" = most votes, "majority" = needs more than half of the living
  allowAbstain: true,
  revealRoleOnDeath: true,
  doctorSelfSave: true,
  doctorNoRepeat: true, // doctor cannot protect the same person two nights running
  announceSaves: true,
  skipDayMajority: true, // majority can vote to end discussion early
  earlyNightAdvance: true,
  maskRoles: true, // keeps a fake delay when a role is dead so nobody can tell
  ghostsSeeAll: true, // dead players can read the mafia chat
};

const LIMITS = {
  reveal: [3, 60],
  night: [8, 120],
  dawn: [3, 30],
  day: [15, 900],
  vote: [10, 300],
  result: [3, 30],
};

export const MIN_PLAYERS = 4;

export function autoRoles(n) {
  return {
    mafia: Math.max(1, Math.round(n / 4)),
    doctor: n >= 5 ? 1 : 0,
    detective: n >= 5 ? (n >= 12 ? 2 : 1) : 0,
  };
}

export function validateRoles(n, r) {
  if (r.mafia < 1) return "Need at least 1 Mafia.";
  if (r.mafia * 2 >= n) return "Mafia must be fewer than half of the players.";
  if (r.mafia + r.doctor + r.detective > n) return "More special roles than players.";
  return null;
}

function deepMerge(target, patch) {
  for (const k of Object.keys(patch || {})) {
    if (!(k in target)) continue;
    const t = target[k];
    const p = patch[k];
    if (t && typeof t === "object" && !Array.isArray(t)) {
      if (p && typeof p === "object") deepMerge(t, p);
    } else if (typeof t === typeof p) {
      target[k] = p;
    }
  }
  return target;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export class Game {
  constructor({ code = "", hostId = "", vkey = "", rand = Math.random, now = () => Date.now() } = {}) {
    this.rand = rand;
    this.now = now;
    this.settings = clone(DEFAULT_SETTINGS);
    this.s = this._blank(code, hostId);
    this.s.vkey = vkey;
    // hooks (assigned by the host controller)
    this.onChange = () => {};
    this.onPriv = () => {};
    this.onGameOver = () => {};
  }

  _blank(code, hostId) {
    return {
      code,
      hostId,
      phase: "lobby", // lobby | reveal | night | dawn | day | vote | result | over
      step: null, // night step: mafia | doctor | detective
      round: 0,
      endsAt: 0,
      pausedLeft: null,
      players: {},
      order: [],
      composition: null,
      night: null,
      votes: {},
      ready: {},
      lastSaved: {},
      feed: [],
      seq: 0,
      winner: null,
      revealAll: false,
      stepShort: false,
      voteShort: false,
      startedAt: null,
      startedMs: 0,
    };
  }

  // ---------- helpers ----------
  _rnd(a, b) {
    return a + this.rand() * (b - a);
  }
  _pick(arr) {
    return arr[Math.floor(this.rand() * arr.length)];
  }
  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  _feed(key, vars = {}) {
    const s = this.s;
    s.seq += 1;
    s.feed.push({ seq: s.seq, key, vars, round: s.round });
    if (s.feed.length > 150) s.feed.shift();
  }
  _changed() {
    this.onChange();
  }
  _setTimer(sec) {
    this.s.endsAt = this.now() + sec * 1000;
    this.s.pausedLeft = null;
  }

  get players() {
    return this.s.order.map((id) => this.s.players[id]);
  }
  get playable() {
    return this.players.filter((p) => !p.isMod && !p.spectator);
  }
  get alive() {
    return this.playable.filter((p) => p.alive);
  }
  _aliveWith(role) {
    return this.alive.filter((p) => p.role === role);
  }

  // ---------- lobby ----------
  join(id, name, avatar = "") {
    const s = this.s;
    name = String(name || "Player").trim().slice(0, 18) || "Player";
    let p = s.players[id];
    if (p) {
      p.connected = true;
      p.name = name;
      if (avatar) p.avatar = avatar;
    } else {
      p = {
        id,
        name,
        avatar,
        alive: true,
        role: null,
        connected: true,
        isMod: false,
        spectator: s.phase !== "lobby",
        revealed: false,
        results: [],
      };
      if (p.spectator) p.alive = false;
      s.players[id] = p;
      s.order.push(id);
    }
    // names must be unique, so disambiguate
    const same = this.players.filter((q) => q.name.toLowerCase() === p.name.toLowerCase() && q.id !== id);
    if (same.length) p.name = `${p.name} ${same.length + 1}`;
    this._changed();
    this.onPriv(id);
    return p;
  }

  setConnected(id, on) {
    const p = this.s.players[id];
    if (!p) return;
    if (!on && this.s.phase === "lobby") return this.leave(id);
    p.connected = on;
    this._changed();
  }

  leave(id) {
    const s = this.s;
    const p = s.players[id];
    if (!p || id === s.hostId) {
      if (p) p.connected = false;
      this._changed();
      return;
    }
    if (s.phase === "lobby") {
      delete s.players[id];
      s.order = s.order.filter((x) => x !== id);
    } else {
      p.connected = false;
    }
    this._changed();
  }

  kick(id) {
    const s = this.s;
    if (id === s.hostId) return;
    const p = s.players[id];
    if (!p) return;
    if (s.phase === "lobby") {
      delete s.players[id];
      s.order = s.order.filter((x) => x !== id);
    } else {
      p.alive = false;
      p.spectator = true;
      p.connected = false;
    }
    this._changed();
    this._afterDeath();
  }

  setSettings(patch) {
    if (this.s.phase !== "lobby") return false;
    deepMerge(this.settings, patch);
    const t = this.settings.timers;
    for (const k of Object.keys(LIMITS)) t[k] = Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], Math.round(t[k])));
    const r = this.settings.roles;
    for (const k of Object.keys(r)) r[k] = Math.max(0, Math.min(30, Math.round(r[k])));
    this._changed();
    return true;
  }

  /** Mafia / special-role counts that would be used for the current lobby. */
  plannedRoles() {
    const n = this._candidates().length;
    return this.settings.autoRoles ? autoRoles(n) : { ...this.settings.roles };
  }

  _candidates() {
    const host = this.s.players[this.s.hostId];
    const modHost = this.settings.moderator === "host";
    return this.players.filter((p) => !p.spectator && !(modHost && p.id === host?.id));
  }

  canStart() {
    const s = this.s;
    if (s.phase !== "lobby") return { ok: false, error: "Game already started." };
    const n = this._candidates().filter((p) => p.connected).length;
    if (n < MIN_PLAYERS) return { ok: false, error: `Need at least ${MIN_PLAYERS} players (${n} here).` };
    const err = validateRoles(n, this.plannedRoles());
    if (err) return { ok: false, error: err };
    return { ok: true };
  }

  start() {
    const chk = this.canStart();
    if (!chk.ok) return chk;
    const s = this.s;
    const modHost = this.settings.moderator === "host";
    for (const p of this.players) {
      p.isMod = modHost && p.id === s.hostId;
      if (!p.connected && !p.isMod) {
        p.spectator = true; // anyone who dropped before start sits out
      }
      p.alive = !p.isMod && !p.spectator;
      p.role = null;
      p.revealed = false;
      p.results = [];
    }
    const pool = this.playable;
    const r = this.plannedRoles();
    const roles = [];
    for (let i = 0; i < r.mafia; i++) roles.push("mafia");
    for (let i = 0; i < r.doctor; i++) roles.push("doctor");
    for (let i = 0; i < r.detective; i++) roles.push("detective");
    while (roles.length < pool.length) roles.push("villager");
    const shuffled = this._shuffle(roles);
    pool.forEach((p, i) => (p.role = shuffled[i]));

    s.composition = { ...r, villager: pool.length - r.mafia - r.doctor - r.detective, total: pool.length };
    s.winner = null;
    s.revealAll = false;
    s.round = 0;
    s.votes = {};
    s.ready = {};
    s.lastSaved = {};
    s.night = null;
    s.feed = [];
    s.startedAt = new Date(this.now()).toISOString();
    s.startedMs = this.now();
    s.phase = "reveal";
    s.step = null;
    this._feed("game_start", { players: pool.length });
    this._setTimer(this.settings.timers.reveal);
    this._changed();
    for (const p of this.players) this.onPriv(p.id);
    return { ok: true };
  }

  /** Back to the lobby with the same people. */
  reset() {
    const s = this.s;
    s.phase = "lobby";
    s.step = null;
    s.round = 0;
    s.winner = null;
    s.revealAll = false;
    s.night = null;
    s.votes = {};
    s.ready = {};
    s.feed = [];
    s.composition = null;
    s.pausedLeft = null;
    for (const id of [...s.order]) {
      const p = s.players[id];
      if (!p.connected && id !== s.hostId) {
        delete s.players[id];
        s.order = s.order.filter((x) => x !== id);
        continue;
      }
      p.alive = true;
      p.role = null;
      p.isMod = false;
      p.spectator = false;
      p.revealed = false;
      p.results = [];
    }
    this._changed();
    for (const p of this.players) this.onPriv(p.id);
  }

  // ---------- clock ----------
  tick() {
    const s = this.s;
    if (s.pausedLeft != null) return;
    if (!["reveal", "night", "dawn", "day", "vote", "result"].includes(s.phase)) return;
    if (this.now() < s.endsAt) return;
    this._advance();
  }

  _advance() {
    const s = this.s;
    switch (s.phase) {
      case "reveal":
        return this._enterNight();
      case "night":
        return this._endStep();
      case "dawn":
        return this._enterDay();
      case "day":
        return this._enterVote();
      case "vote":
        return this._resolveVote();
      case "result":
        return this._enterNight();
    }
  }

  // ---------- night ----------
  _enterNight() {
    const s = this.s;
    s.round += 1;
    s.phase = "night";
    s.votes = {};
    s.night = { picks: { mafia: {}, doctor: {}, detective: {} } };
    this._feed("night_start", { round: s.round });
    this._enterStep(0);
  }

  _stepExists(step) {
    return (this.s.composition?.[step] || 0) > 0;
  }

  _enterStep(from) {
    const s = this.s;
    for (let i = from; i < NIGHT_STEPS.length; i++) {
      const step = NIGHT_STEPS[i];
      if (!this._stepExists(step)) continue;
      s.step = step;
      s.stepShort = false;
      const actors = this._aliveWith(step);
      if (actors.length === 0) {
        // The role is dead. Keep a believable pause so nobody can tell.
        this._setTimer(this.settings.maskRoles ? this._rnd(4, 8) : 1);
      } else {
        this._setTimer(this.settings.timers.night);
      }
      this._feed(`${step}_wake`, {});
      this._changed();
      for (const a of actors) this.onPriv(a.id);
      this._godPriv();
      return;
    }
    s.step = null;
    this._resolveNight();
  }

  _endStep() {
    const s = this.s;
    const step = s.step;
    this._feed(`${step}_sleep`, {});
    const idx = NIGHT_STEPS.indexOf(step);
    this._enterStep(idx + 1);
  }

  /** Returns {ok, error}. kind must match the role's night action. */
  act(id, kind, target) {
    const s = this.s;
    const p = s.players[id];
    if (!p || !p.alive || s.phase !== "night") return { ok: false, error: "Not now." };
    if (p.role !== s.step || STEP_ACTION[p.role] !== kind) return { ok: false, error: "It is not your turn." };
    const t = s.players[target];
    if (!t || !t.alive || t.isMod || t.spectator) return { ok: false, error: "Invalid target." };
    if (kind === "kill" && t.role === "mafia") return { ok: false, error: "You cannot target your own team." };
    if (kind === "check" && t.id === id) return { ok: false, error: "You already know yourself." };
    if (kind === "save") {
      if (t.id === id && !this.settings.doctorSelfSave) return { ok: false, error: "Self-protection is off." };
      if (this.settings.doctorNoRepeat && s.lastSaved[id] === target) {
        return { ok: false, error: "You cannot protect the same person two nights in a row." };
      }
    }
    s.night.picks[p.role][id] = target;
    this.onPriv(id);
    this._godPriv();

    if (this.settings.earlyNightAdvance && !s.stepShort) {
      const actors = this._aliveWith(p.role);
      if (actors.every((a) => s.night.picks[p.role][a.id])) {
        s.stepShort = true;
        const left = s.endsAt - this.now();
        const wait = this._rnd(1.5, 3.5) * 1000;
        if (wait < left) s.endsAt = this.now() + wait;
      }
    }
    this._changed();
    return { ok: true };
  }

  _resolveNight() {
    const s = this.s;
    const picks = s.night.picks;

    // Detective results, delivered privately.
    for (const [did, tid] of Object.entries(picks.detective)) {
      const d = s.players[did];
      const t = s.players[tid];
      if (d && t) {
        d.results.push({ round: s.round, id: tid, name: t.name, mafia: t.role === "mafia" });
        this.onPriv(did);
      }
    }

    // Doctor memory for the no-repeat rule.
    for (const [did, tid] of Object.entries(picks.doctor)) s.lastSaved[did] = tid;

    // Mafia decision: most votes, ties broken at random.
    const tally = {};
    for (const tid of Object.values(picks.mafia)) tally[tid] = (tally[tid] || 0) + 1;
    let victim = null;
    const top = Math.max(0, ...Object.values(tally));
    if (top > 0) victim = this._pick(Object.keys(tally).filter((k) => tally[k] === top));

    const saved = new Set(Object.values(picks.doctor));
    s.phase = "dawn";
    s.step = null;
    this._setTimer(this.settings.timers.dawn);

    if (victim && saved.has(victim)) {
      this._feed(this.settings.announceSaves ? "dawn_saved" : "dawn_peace", {});
    } else if (victim) {
      const v = s.players[victim];
      v.alive = false;
      if (this.settings.revealRoleOnDeath) v.revealed = true;
      this._feed("dawn_death", { id: v.id, name: v.name, role: this.settings.revealRoleOnDeath ? v.role : null });
    } else {
      this._feed("dawn_peace", {});
    }
    this._changed();
    this._afterDeath();
  }

  // ---------- day & vote ----------
  _enterDay() {
    const s = this.s;
    s.phase = "day";
    s.ready = {};
    s.votes = {};
    s.voteShort = false;
    this._feed("day_start", { round: s.round });
    this._setTimer(this.settings.timers.day);
    this._changed();
  }

  ready(id) {
    const s = this.s;
    const p = s.players[id];
    if (s.phase !== "day" || !p || !p.alive) return { ok: false };
    if (s.ready[id]) delete s.ready[id];
    else s.ready[id] = true;
    if (this.settings.skipDayMajority && Object.keys(s.ready).length > this.alive.length / 2) {
      s.endsAt = Math.min(s.endsAt, this.now() + 1500);
    }
    this._changed();
    return { ok: true };
  }

  _enterVote() {
    const s = this.s;
    s.phase = "vote";
    s.votes = {};
    s.voteShort = false;
    this._feed("vote_start", {});
    this._setTimer(this.settings.timers.vote);
    this._changed();
  }

  /** target = player id, or "abstain". */
  vote(id, target) {
    const s = this.s;
    const p = s.players[id];
    if (s.phase !== "vote" || !p || !p.alive) return { ok: false, error: "Voting is closed." };
    if (target === "abstain") {
      if (!this.settings.allowAbstain) return { ok: false, error: "Abstaining is off." };
    } else {
      const t = s.players[target];
      if (!t || !t.alive || t.isMod || t.spectator) return { ok: false, error: "Invalid target." };
    }
    s.votes[id] = target;
    if (!s.voteShort && this.alive.every((a) => s.votes[a.id])) {
      s.voteShort = true;
      s.endsAt = Math.min(s.endsAt, this.now() + 3000); // short grace to change your mind
    }
    this._changed();
    return { ok: true };
  }

  _resolveVote() {
    const s = this.s;
    const aliveCount = this.alive.length;
    const tally = {};
    for (const t of Object.values(s.votes)) if (t !== "abstain") tally[t] = (tally[t] || 0) + 1;
    const top = Math.max(0, ...Object.values(tally));
    const leaders = Object.keys(tally).filter((k) => tally[k] === top);

    s.phase = "result";
    this._setTimer(this.settings.timers.result);

    let eliminated = null;
    if (top === 0) {
      this._feed("vote_none", {});
    } else if (this.settings.threshold === "majority" && top * 2 <= aliveCount) {
      this._feed("vote_nomajority", {});
    } else if (leaders.length > 1) {
      if (this.settings.tie === "random") eliminated = this._pick(leaders);
      else this._feed("vote_tie", {});
    } else {
      eliminated = leaders[0];
    }

    if (eliminated) {
      const v = s.players[eliminated];
      v.alive = false;
      if (this.settings.revealRoleOnDeath) v.revealed = true;
      this._feed("vote_elim", {
        id: v.id,
        name: v.name,
        votes: tally[eliminated],
        role: this.settings.revealRoleOnDeath ? v.role : null,
      });
    }
    this._changed();
    this._afterDeath();
  }

  // ---------- win / end ----------
  _checkWin() {
    const mafia = this.alive.filter((p) => p.role === "mafia").length;
    const town = this.alive.length - mafia;
    if (mafia === 0) return "town";
    if (mafia >= town) return "mafia";
    return null;
  }

  _afterDeath() {
    const s = this.s;
    if (s.phase === "lobby" || s.phase === "over") return;
    const w = this._checkWin();
    if (w) this._end(w);
  }

  _end(winner) {
    const s = this.s;
    s.phase = "over";
    s.step = null;
    s.winner = winner;
    s.revealAll = true;
    s.pausedLeft = null;
    this._feed(`win_${winner}`, {});
    this._changed();
    for (const p of this.players) this.onPriv(p.id);
    this.onGameOver(this.summary());
  }

  summary() {
    const s = this.s;
    return {
      room: s.code,
      theme: this.settings.theme,
      winner: s.winner,
      rounds: s.round,
      durationSec: Math.round((this.now() - s.startedMs) / 1000),
      startedAt: s.startedAt,
      players: this.playable.map((p) => ({
        name: p.name,
        role: p.role,
        alive: p.alive,
        won: (p.role === "mafia") === (s.winner === "mafia"),
      })),
    };
  }

  // ---------- moderator controls ----------
  control(action, value) {
    const s = this.s;
    if (!["reveal", "night", "dawn", "day", "vote", "result"].includes(s.phase)) return;
    if (action === "pause") {
      if (s.pausedLeft == null) s.pausedLeft = Math.max(0, s.endsAt - this.now());
      else {
        s.endsAt = this.now() + s.pausedLeft;
        s.pausedLeft = null;
      }
    } else if (action === "extend") {
      const add = (Number(value) || 30) * 1000;
      if (s.pausedLeft != null) s.pausedLeft += add;
      else s.endsAt += add;
    } else if (action === "skip") {
      s.pausedLeft = null;
      s.endsAt = this.now();
    }
    this._changed();
  }

  // ---------- views ----------
  _godPriv() {
    const mod = this.players.find((p) => p.isMod);
    if (mod) this.onPriv(mod.id);
  }

  publicState() {
    const s = this.s;
    const now = this.now();
    const showVotes = s.phase === "vote" || s.phase === "result";
    return {
      code: s.code,
      vkey: s.vkey,
      hostId: s.hostId,
      phase: s.phase,
      step: s.step,
      round: s.round,
      endsIn: s.pausedLeft != null ? s.pausedLeft : Math.max(0, s.endsAt - now),
      paused: s.pausedLeft != null,
      settings: this.settings,
      composition: s.composition,
      planned: s.phase === "lobby" ? this.plannedRoles() : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        alive: p.alive,
        connected: p.connected,
        isMod: p.isMod,
        spectator: p.spectator,
        role: s.revealAll || p.revealed ? p.role : null,
      })),
      votes: showVotes ? s.votes : {},
      readyIds: s.phase === "day" ? Object.keys(s.ready) : [],
      feed: s.feed.slice(-80),
      seq: s.seq,
      winner: s.winner,
    };
  }

  privateFor(id) {
    const s = this.s;
    const p = s.players[id];
    if (!p) return { role: null };
    if (p.isMod) {
      const roles = {};
      for (const q of this.playable) roles[q.id] = q.role;
      return { god: true, roles, picks: s.night ? s.night.picks : null };
    }
    if (!p.role) return { role: null };
    const out = { role: p.role, results: p.results, pick: null };
    if (p.role === "mafia") out.team = this.playable.filter((q) => q.role === "mafia").map((q) => q.id);
    if (s.night && s.phase === "night") out.pick = s.night.picks[p.role]?.[id] || null;
    if (p.role === "doctor") out.lastSaved = s.lastSaved[id] || null;
    return out;
  }

  // ---------- persistence ----------
  serialize() {
    return JSON.stringify({ s: this.s, settings: this.settings });
  }

  restore(json) {
    const d = JSON.parse(json);
    this.s = d.s;
    this.settings = d.settings;
    this._changed();
  }
}
