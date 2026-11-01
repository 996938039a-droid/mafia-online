// settings-ui.js: builds the room-rules form shown in the lobby (editable for the host, read-only for others).
import { THEMES, THEME_IDS } from "./themes.js";
import { autoRoles, validateRoles, MIN_PLAYERS } from "./engine.js";

const TOGGLES = [
  ["revealRoleOnDeath", "Reveal role on death", "Everyone sees the role of an eliminated player."],
  ["doctorSelfSave", "Doctor can protect themselves", ""],
  ["doctorNoRepeat", "Doctor cannot repeat a target", "No protecting the same person two nights in a row."],
  ["announceSaves", "Announce saves", "The narrator says when a kill was foiled (without naming anyone)."],
  ["skipDayMajority", "Majority can end discussion", "Living players can vote to skip straight to the vote."],
  ["earlyNightAdvance", "Advance night early", "Move on once everyone with a night action has acted."],
  ["maskRoles", "Hide which roles are dead", "Keeps a fake delay when a role has no living player."],
  ["ghostsSeeAll", "Ghosts can read Mafia chat", ""],
  ["allowAbstain", "Allow abstain votes", ""],
];

const TIMERS = [
  ["reveal", "Role reveal", 3, 60],
  ["night", "Night, per role", 8, 120],
  ["dawn", "Dawn", 3, 30],
  ["day", "Discussion", 15, 900],
  ["vote", "Voting", 10, 300],
  ["result", "Verdict", 3, 30],
];

const THEME_COLORS = { noir: "#c9423a", village: "#8fb3ff", neon: "#34e1d3", gilded: "#d4af37" };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function buildSettingsForm(root, pub, canEdit, onChange) {
  // Do not rebuild while someone is typing in a field.
  if (root.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;

  const s = pub.settings;
  const th = THEMES[s.theme] || THEMES.noir;
  const dis = canEdit ? "" : "disabled";
  const n = pub.players.filter((p) => !p.spectator && !(s.moderator === "host" && p.id === pub.hostId)).length;
  const planned = s.autoRoles ? autoRoles(n) : s.roles;
  const villagers = Math.max(0, n - planned.mafia - planned.doctor - planned.detective);
  const err = n >= MIN_PLAYERS ? validateRoles(n, planned) : null;
  const rn = (k) => th.roles[k].name;

  const stepper = (k) => `
    <div class="stepper"><span>${esc(rn(k))}</span>
      <div class="ctl">
        <button type="button" data-step="${k}" data-d="-1" ${dis || s.autoRoles ? "disabled" : ""}>−</button>
        <b>${planned[k]}</b>
        <button type="button" data-step="${k}" data-d="1" ${dis || s.autoRoles ? "disabled" : ""}>+</button>
      </div></div>`;

  root.innerHTML = `
    <h4>Room rules</h4>
    <p class="muted small">${canEdit ? "You are the host. Everyone sees changes live." : "Only the host can change these."}</p>

    <div class="sgroup"><div class="t">Moderator</div>
      <div class="seg">
        <button type="button" data-set="moderator" data-v="system" class="${s.moderator === "system" ? "on" : ""}" ${dis}>System voice</button>
        <button type="button" data-set="moderator" data-v="host" class="${s.moderator === "host" ? "on" : ""}" ${dis}>Host narrates</button>
      </div>
      <p class="note">${s.moderator === "system"
        ? "A voiced narrator runs every phase. The host plays like everyone else."
        : "The host becomes a non-playing moderator: sees all roles, reads a script and controls the clock."}</p>
    </div>

    <div class="sgroup"><div class="t">Theme</div>
      <div class="themes">
        ${THEME_IDS.map((id) => `<button type="button" class="theme-card ${s.theme === id ? "on" : ""}" style="--c:${THEME_COLORS[id]}" data-set="theme" data-v="${id}" ${dis}><b>${esc(THEMES[id].name)}</b><span>${esc(THEMES[id].blurb)}</span></button>`).join("")}
      </div>
    </div>

    <div class="sgroup"><div class="t">Roles</div>
      <div class="rule"><div><b>Balance automatically</b><span>Sized from the number of players.</span></div>
        <label class="switch"><input type="checkbox" data-toggle="autoRoles" ${s.autoRoles ? "checked" : ""} ${dis} /><i></i></label></div>
      <div class="rolegrid">
        ${stepper("mafia")}${stepper("doctor")}${stepper("detective")}
        <div class="stepper"><span>${esc(rn("villager"))}</span><div class="ctl"><b>${villagers}</b></div></div>
      </div>
      <p class="note ${err ? "warn" : ""}">${n < MIN_PLAYERS ? `Needs at least ${MIN_PLAYERS} players (${n} so far).` : err ? esc(err) : `${n} players in this game.`}</p>
    </div>

    <div class="sgroup"><div class="t">Time per phase (seconds)</div>
      <div class="timers">
        ${TIMERS.map(([k, label, lo, hi]) => `<label>${label}<input type="number" inputmode="numeric" data-timer="${k}" min="${lo}" max="${hi}" value="${s.timers[k]}" ${dis} /></label>`).join("")}
      </div>
    </div>

    <div class="sgroup"><div class="t">Voting</div>
      <div class="rule"><div><b>Open voting</b><span>Everyone sees who voted for whom, live.</span></div><span class="muted small">Always on</span></div>
      <div class="rule"><div><b>Winning a vote</b></div>
        <div class="sel-wrap"><select data-select="threshold" ${dis}>
          <option value="plurality" ${s.threshold === "plurality" ? "selected" : ""}>Most votes</option>
          <option value="majority" ${s.threshold === "majority" ? "selected" : ""}>Majority of the living</option></select></div></div>
      <div class="rule"><div><b>If there is a tie</b></div>
        <div class="sel-wrap"><select data-select="tie" ${dis}>
          <option value="none" ${s.tie === "none" ? "selected" : ""}>Nobody is eliminated</option>
          <option value="random" ${s.tie === "random" ? "selected" : ""}>Pick one at random</option></select></div></div>
    </div>

    <div class="sgroup"><div class="t">Rules</div>
      <div class="rules">
        ${TOGGLES.map(([k, label, desc]) => `<div class="rule"><div><b>${label}</b>${desc ? `<span>${desc}</span>` : ""}</div>
          <label class="switch"><input type="checkbox" data-toggle="${k}" ${s[k] ? "checked" : ""} ${dis} /><i></i></label></div>`).join("")}
      </div>
    </div>`;

  if (!canEdit) return;

  root.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => onChange({ [b.dataset.set]: b.dataset.v })));
  root.querySelectorAll("[data-toggle]").forEach((i) => i.addEventListener("change", () => onChange({ [i.dataset.toggle]: i.checked })));
  root.querySelectorAll("[data-select]").forEach((i) => i.addEventListener("change", () => onChange({ [i.dataset.select]: i.value })));
  root.querySelectorAll("[data-timer]").forEach((i) =>
    i.addEventListener("change", () => {
      const v = parseInt(i.value, 10);
      if (Number.isFinite(v)) onChange({ timers: { [i.dataset.timer]: v } });
    })
  );
  root.querySelectorAll("[data-step]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.step;
      onChange({ roles: { [k]: Math.max(0, (s.roles[k] ?? planned[k]) + parseInt(b.dataset.d, 10)) } });
    })
  );
}
