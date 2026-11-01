// video.js: Jitsi Meet embed (public meet.jit.si, your own Jitsi domain, or 8x8 JaaS with a signed token).
// Mic and camera are switched off for everybody at night and for dead players (soft enforcement).

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load video library"));
    document.head.appendChild(s);
  });
}

export class Video {
  constructor({ onState, onBlocked }) {
    this.api = null;
    this.joined = false;
    this.allowed = true;
    this.onState = onState || (() => {});
    this.onBlocked = onBlocked || (() => {});
    this._restore = { a: false, v: false };
    this._busy = false;
  }

  async join({ cfg, room, name, id, host, parent }) {
    if (this.api) return;
    const useJaas = Boolean(cfg.jaasAppId);
    let domain = cfg.jitsiDomain || "meet.jit.si";
    let roomName = `mafia-${room}`;
    let jwt;

    if (useJaas) {
      const r = await fetch("/api/jaas-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomName, name, id, host }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error("Video token failed (" + (j.error || "unknown") + ")");
      jwt = j.jwt;
      domain = "8x8.vc";
      roomName = `${cfg.jaasAppId}/${roomName}`;
      await loadScript(`https://8x8.vc/${cfg.jaasAppId}/external_api.js`);
    } else {
      await loadScript(`https://${domain}/external_api.js`);
    }

    this.api = new window.JitsiMeetExternalAPI(domain, {
      roomName,
      parentNode: parent,
      width: "100%",
      height: "100%",
      jwt,
      userInfo: { displayName: name },
      configOverwrite: {
        prejoinPageEnabled: false,
        startWithAudioMuted: true,
        startWithVideoMuted: true,
        disableDeepLinking: true,
        disableInviteFunctions: true,
        hideConferenceSubject: true,
        hideConferenceTimer: true,
        disableThirdPartyRequests: true,
        enableWelcomePage: false,
        toolbarButtons: ["microphone", "camera", "tileview", "fullscreen"],
        notifications: [],
      },
      interfaceConfigOverwrite: {
        SHOW_JITSI_WATERMARK: false,
        SHOW_BRAND_WATERMARK: false,
        SHOW_POWERED_BY: false,
        DEFAULT_BACKGROUND: "#08080b",
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
        MOBILE_APP_PROMO: false,
        TILE_VIEW_MAX_COLUMNS: 3,
      },
    });

    this.api.addListener("videoConferenceJoined", () => {
      this.joined = true;
      this.api.executeCommand("setTileView", true);
      this.onState({ joined: true });
      this.enforce(this.allowed, true);
    });
    this.api.addListener("audioMuteStatusChanged", ({ muted }) => {
      if (!muted && !this.allowed && !this._busy) {
        this.api.executeCommand("toggleAudio");
        this.onBlocked();
      }
    });
    this.api.addListener("videoMuteStatusChanged", ({ muted }) => {
      if (!muted && !this.allowed && !this._busy) {
        this.api.executeCommand("toggleVideo");
        this.onBlocked();
      }
    });
    this.api.addListener("readyToClose", () => this.leave());
  }

  /** allowed = may this person have mic/camera on right now? */
  async enforce(allowed, force = false) {
    if (allowed === this.allowed && !force) return;
    const was = this.allowed;
    this.allowed = allowed;
    if (!this.api || !this.joined) return;
    this._busy = true;
    try {
      if (!allowed) {
        const [aMuted, vMuted] = await Promise.all([this.api.isAudioMuted(), this.api.isVideoMuted()]);
        if (was) this._restore = { a: !aMuted, v: !vMuted };
        if (!aMuted) this.api.executeCommand("toggleAudio");
        if (!vMuted) this.api.executeCommand("toggleVideo");
      } else {
        const [aMuted, vMuted] = await Promise.all([this.api.isAudioMuted(), this.api.isVideoMuted()]);
        if (this._restore.a && aMuted) this.api.executeCommand("toggleAudio");
        if (this._restore.v && vMuted) this.api.executeCommand("toggleVideo");
        this._restore = { a: false, v: false };
      }
    } catch {}
    setTimeout(() => (this._busy = false), 800);
  }

  leave() {
    try {
      this.api?.dispose();
    } catch {}
    this.api = null;
    this.joined = false;
    this.onState({ joined: false });
  }
}
