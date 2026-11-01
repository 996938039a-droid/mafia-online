// net.js: Supabase Realtime (Broadcast + Presence). No database tables are needed.
// Every message is { t: "<type>", ... } on a single broadcast event.

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

export async function loadConfig() {
  let cfg = {};
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.ok) cfg = await r.json();
  } catch {}
  // Local fallback for plain static hosting / local testing: js/config.local.js sets window.MAFIA_CONFIG
  if (!cfg.supabaseUrl) {
    try {
      await loadScript("js/config.local.js");
    } catch {}
    if (window.MAFIA_CONFIG) cfg = { ...window.MAFIA_CONFIG, ...cfg, supabaseUrl: window.MAFIA_CONFIG.supabaseUrl, supabaseAnonKey: window.MAFIA_CONFIG.supabaseAnonKey };
  }
  return cfg;
}

/**
 * Same interface as Net, but runs over BroadcastChannel so several tabs of one browser can play
 * together with no backend at all. Open the app with ?local=1. Great for trying the game out.
 */
export class LocalNet {
  constructor({ code, me, host = false, onMessage, onPresence, onStatus }) {
    Object.assign(this, { code, me, host, onMessage, onPresence, onStatus });
    this.peers = new Map();
    this.ready = false;
  }

  async connect() {
    this.bc = new BroadcastChannel("mafia-local:" + this.code);
    this.bc.onmessage = (ev) => {
      const d = ev.data;
      if (!d) return;
      if (d.kind === "msg") this.onMessage(d.payload);
      else if (d.kind === "pres") {
        this.peers.set(d.id, { host: d.host, name: d.name, at: Date.now() });
        this.onPresence(this.presence());
      } else if (d.kind === "bye") {
        this.peers.delete(d.id);
        this.onPresence(this.presence());
      }
    };
    const announce = () => this.bc.postMessage({ kind: "pres", id: this.me.id, host: this.host, name: this.me.name });
    announce();
    this.timer = setInterval(() => {
      announce();
      const now = Date.now();
      let changed = false;
      for (const [id, p] of this.peers) if (now - p.at > 7000) { this.peers.delete(id); changed = true; }
      if (changed) this.onPresence(this.presence());
    }, 2000);
    this.ready = true;
    this.onStatus?.("SUBSCRIBED");
    setTimeout(() => this.onPresence(this.presence()), 60);
  }

  send(payload) {
    this.bc?.postMessage({ kind: "msg", payload });
  }

  presence() {
    const o = {};
    for (const [id, p] of this.peers) o[id] = [{ host: p.host, name: p.name }];
    o[this.me.id] = [{ host: this.host, name: this.me.name }];
    return o;
  }

  async close() {
    try {
      this.bc?.postMessage({ kind: "bye", id: this.me.id });
      clearInterval(this.timer);
      this.bc?.close();
    } catch {}
  }
}

export class Net {
  constructor({ url, key, code, me, host = false, onMessage, onPresence, onStatus }) {
    Object.assign(this, { url, key, code, me, host, onMessage, onPresence, onStatus });
    this.ch = null;
    this.client = null;
    this.ready = false;
  }

  async connect() {
    if (!window.supabase) await loadScript(SUPABASE_JS);
    this.client = window.supabase.createClient(this.url, this.key, {
      realtime: { params: { eventsPerSecond: 25 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.ch = this.client.channel(`mafia:${this.code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } },
    });
    this.ch.on("broadcast", { event: "m" }, ({ payload }) => this.onMessage(payload));
    this.ch.on("presence", { event: "sync" }, () => this.onPresence(this.ch.presenceState()));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime connection timed out")), 12000);
      this.ch.subscribe(async (status) => {
        this.onStatus?.(status);
        if (status === "SUBSCRIBED") {
          this.ready = true;
          clearTimeout(timer);
          // Presence is rate limited (5 calls / 30s), so track exactly once per (re)connect.
          try {
            await this.ch.track({ name: this.me.name, host: this.host, at: Date.now() });
          } catch {}
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.ready = false;
          if (status === "CHANNEL_ERROR") {
            clearTimeout(timer);
            reject(new Error("Realtime channel error"));
          }
        } else if (status === "CLOSED") {
          this.ready = false;
        }
      });
    });
  }

  send(payload) {
    if (!this.ch) return;
    return this.ch.send({ type: "broadcast", event: "m", payload });
  }

  presence() {
    return this.ch ? this.ch.presenceState() : {};
  }

  async close() {
    try {
      if (this.ch) await this.ch.untrack();
      if (this.client && this.ch) await this.client.removeChannel(this.ch);
    } catch {}
    this.ch = null;
  }
}
