// themes.js: names, narration scripts and phase labels per theme.
// Visual styling for each theme lives in css/style.css ([data-theme="..."]).

const BASE = {
  game_start: [
    "The game begins. Somewhere among you hide the {mafiaP}. Check your role, and keep it secret.",
  ],
  night_start: [
    "Night falls. {Town} goes to sleep. Everyone, close your eyes.",
    "Darkness settles. {Town} goes to sleep. Close your eyes, everyone.",
  ],
  mafia_wake: ["{mafiaP}, wake up. Choose your victim.", "{mafiaP}, open your eyes. Choose who will not see the morning."],
  mafia_sleep: ["{mafiaP}, go back to sleep."],
  doctor_wake: ["{doctor}, wake up. Choose someone to protect."],
  doctor_sleep: ["{doctor}, go back to sleep."],
  detective_wake: ["{detective}, wake up. Choose someone to investigate."],
  detective_sleep: ["{detective}, go back to sleep."],
  dawn_peace: ["Morning breaks. Against the odds, nobody died last night."],
  dawn_saved: ["Morning breaks. {mafiaP} struck in the dark, but someone was watching over the target. Nobody died."],
  dawn_death: ["Morning breaks. {name} was found dead. They were {aRole}."],
  dawn_death_norole: ["Morning breaks. {name} was found dead."],
  day_start: ["{Town} wakes up. Discuss. One of you is lying."],
  vote_start: ["Discussion is over. Cast your votes."],
  vote_elim: ["{Town} has decided. {name} is eliminated with {votes} votes. They were {aRole}."],
  vote_elim_norole: ["{Town} has decided. {name} is eliminated with {votes} votes."],
  vote_tie: ["A tie. {Town} could not agree, and nobody is eliminated."],
  vote_none: ["No votes were cast. Nobody is eliminated."],
  vote_nomajority: ["Nobody reached a majority. Nobody is eliminated."],
  win_town: ["{mafiaP} have been rooted out. {Town} is safe, for now. {winTown}."],
  win_mafia: ["{mafiaP} now rule {town}. {winMafia}."],
};

export const THEMES = {
  noir: {
    id: "noir",
    name: "Noir City",
    blurb: "Rain, neon and secrets.",
    town: "the city",
    townP: "The city",
    roles: {
      mafia: { name: "Mafia", plural: "The Mafia" },
      villager: { name: "Villager", plural: "Villagers" },
      doctor: { name: "Doctor", plural: "Doctors" },
      detective: { name: "Detective", plural: "Detectives" },
    },
    teams: { mafia: "Mafia", town: "Town" },
    wins: { mafia: "Mafia wins", town: "Town wins" },
    lines: {
      game_start: [
        "The rain has not stopped in three days. Somewhere in this city, the Mafia walk among you. Check your role, and keep it close.",
      ],
      night_start: [
        "Night falls. The city goes to sleep. Everyone, close your eyes.",
        "The streetlights flicker out. The city goes to sleep. Close your eyes.",
      ],
      dawn_death: ["Morning breaks. {name} was found dead in the street. They were {aRole}."],
      dawn_death_norole: ["Morning breaks. {name} was found dead in the street."],
    },
    ambience: { night: 55, day: 196 },
  },

  village: {
    id: "village",
    name: "Midnight Village",
    blurb: "Fog, lanterns and wolves.",
    town: "the village",
    townP: "The village",
    roles: {
      mafia: { name: "Wolf", plural: "The Wolves" },
      villager: { name: "Villager", plural: "Villagers" },
      doctor: { name: "Healer", plural: "Healers" },
      detective: { name: "Seer", plural: "Seers" },
    },
    teams: { mafia: "Wolves", town: "Village" },
    wins: { mafia: "The wolves win", town: "The village wins" },
    lines: {
      game_start: ["A cold fog settles over the village. Among you walk the wolves. Look at your role, and tell no one."],
      night_start: [
        "Night falls over the village. The lanterns burn low. Everyone, close your eyes.",
        "The moon rises. The village goes to sleep. Close your eyes.",
      ],
      mafia_wake: ["Wolves, wake up. Choose your prey."],
      mafia_sleep: ["Wolves, return to your dens."],
      doctor_wake: ["Healer, wake up. Choose who you will shield tonight."],
      detective_wake: ["Seer, wake up. Choose someone whose true nature you wish to see."],
      dawn_death: ["Dawn breaks. {name} was found lifeless by the well. They were {aRole}."],
      dawn_death_norole: ["Dawn breaks. {name} was found lifeless by the well."],
      dawn_saved: ["Dawn breaks. The wolves hunted in the dark, but the healer's ward held. Nobody died."],
      win_town: ["The last wolf is gone. The village sleeps in peace. The village wins."],
      win_mafia: ["The wolves have taken the village. The wolves win."],
    },
    ambience: { night: 49, day: 174 },
  },

  neon: {
    id: "neon",
    name: "Neon Syndicate",
    blurb: "Rain-slick streets, electric nights.",
    town: "the district",
    townP: "The district",
    roles: {
      mafia: { name: "Syndicate", plural: "The Syndicate" },
      villager: { name: "Citizen", plural: "Citizens" },
      doctor: { name: "Medic", plural: "Medics" },
      detective: { name: "Hacker", plural: "Hackers" },
    },
    teams: { mafia: "Syndicate", town: "Citizens" },
    wins: { mafia: "The Syndicate wins", town: "The citizens win" },
    lines: {
      game_start: ["Grid online. The Syndicate is hiding inside your district. Read your role, and keep it encrypted."],
      night_start: ["Lights out. The district goes dark. Everyone, close your eyes."],
      mafia_wake: ["Syndicate, wake up. Mark your target."],
      doctor_wake: ["Medic, wake up. Choose someone to patch up."],
      detective_wake: ["Hacker, wake up. Choose someone to scan."],
      dawn_death: ["Power returns. {name} was found offline for good. They were {aRole}."],
      dawn_death_norole: ["Power returns. {name} was found offline for good."],
      dawn_saved: ["Power returns. The Syndicate made their move, but the medic got there first. Nobody died."],
      day_start: ["The district wakes up. Talk. Somebody is lying."],
      win_town: ["The Syndicate is wiped from the grid. Citizens win."],
      win_mafia: ["The Syndicate owns the district now. The Syndicate wins."],
    },
    ambience: { night: 62, day: 233 },
  },

  gilded: {
    id: "gilded",
    name: "Gilded Manor",
    blurb: "Candlelight and quiet betrayals.",
    town: "the manor",
    townP: "The manor",
    roles: {
      mafia: { name: "Assassin", plural: "The Assassins" },
      villager: { name: "Guest", plural: "Guests" },
      doctor: { name: "Physician", plural: "Physicians" },
      detective: { name: "Inspector", plural: "Inspectors" },
    },
    teams: { mafia: "Assassins", town: "Guests" },
    wins: { mafia: "The assassins win", town: "The guests win" },
    lines: {
      game_start: ["Dinner is served, and not every guest is who they claim. Read your role, and give nothing away."],
      night_start: ["The candles burn low. The manor falls silent. Everyone, close your eyes."],
      mafia_wake: ["Assassins, wake up. Choose tonight's victim."],
      doctor_wake: ["Physician, wake up. Choose who to keep alive."],
      detective_wake: ["Inspector, wake up. Choose someone to examine."],
      dawn_death: ["Morning light. {name} was found dead in the library. They were {aRole}."],
      dawn_death_norole: ["Morning light. {name} was found dead in the library."],
      dawn_saved: ["Morning light. A blade was raised in the dark, but the physician intervened. Nobody died."],
      day_start: ["The manor wakes up. Over breakfast, accuse whoever you must."],
      win_town: ["The assassins are exposed. The manor is safe. The guests win."],
      win_mafia: ["The manor belongs to the assassins now. The assassins win."],
    },
    ambience: { night: 58, day: 207 },
  },
};

export const THEME_IDS = Object.keys(THEMES);

export function theme(id) {
  return THEMES[id] || THEMES.noir;
}

export function roleName(id, role) {
  const t = theme(id);
  return t.roles[role]?.name || role || "?";
}

export function phaseLabel(phase) {
  return (
    {
      lobby: "Gathering",
      reveal: "Your role",
      night: "Night",
      dawn: "Dawn",
      day: "Day",
      vote: "Judgement",
      result: "Verdict",
      over: "Game over",
    }[phase] || phase
  );
}

export const ROLE_BLURB = {
  mafia: "Each night the Mafia choose one person to eliminate. By day, blend in. You win when you equal the town in number.",
  villager: "You have no night power, only your voice and your vote. Find the Mafia and eliminate them.",
  doctor: "Each night you may protect one person from the Mafia's attack.",
  detective: "Each night you may investigate one person and learn whether they are Mafia.",
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const withArticle = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;

/** Turn a feed item into text. Same seq gives the same variant on every device. */
export function line(themeId, item) {
  const t = theme(themeId);
  let key = item.key;
  const v = item.vars || {};
  if ((key === "dawn_death" || key === "vote_elim") && !v.role) key += "_norole";
  const pool = t.lines[key] || BASE[key] || BASE[key.replace("_norole", "")] || [key];
  const tpl = pool[item.seq % pool.length];
  const map = {
    mafia: t.roles.mafia.name,
    mafiaP: t.roles.mafia.plural,
    doctor: t.roles.doctor.name,
    detective: t.roles.detective.name,
    villager: t.roles.villager.name,
    town: t.town,
    Town: cap(t.town),
    townP: t.townP,
    winTown: t.wins.town,
    winMafia: t.wins.mafia,
    name: v.name || "",
    votes: v.votes ?? "",
    role: v.role ? t.roles[v.role]?.name || v.role : "",
    aRole: v.role ? withArticle(t.roles[v.role]?.name || v.role) : "",
    round: v.round ?? "",
    players: v.players ?? "",
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in map ? map[k] : ""));
}

/** "The Mafia" -> "the Mafia" for mid-sentence use. */
export function lc(s) {
  return String(s).replace(/^The /, "the ");
}
