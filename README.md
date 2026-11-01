# Mafia Online

A dark, minimal, themeable online version of Mafia. Unlimited players, live chat, video, and a voiced narrator that runs the whole night/day cycle ("the city goes to sleep…"), or let a human host narrate instead.

```
Browser (every player)  ──►  Netlify (static site + 4 tiny functions)
        │                          │
        │ realtime                 └──► Google Sheets (game history, leaderboard) via Apps Script
        ▼
 Supabase Realtime (Broadcast + Presence)      Jitsi (video)
```

- **Game state and chat:** Supabase Realtime. No database tables to create.
- **Game logic:** runs in the **host's browser** (`public/js/engine.js`). Everyone else sends intents and renders state.
- **Google Sheets:** finished-game history and a "Hall of fame" leaderboard (not live state; Sheets is too slow and rate-limited for that).
- **Video:** Jitsi, switched off automatically at night and for dead players.
- **Narrator:** the browser's built-in speech synthesis plus generated ambient sound. No audio files, no paid API.

## What's in the game

| Area | Options |
|---|---|
| Roles | Mafia, Villager, Doctor, Detective. Auto-balanced from player count, or set counts by hand |
| Moderator | **System voice** (narrator runs everything) or **Host narrates** (host does not play: sees all roles, reads a script, can pause / +30s / skip) |
| Voting | Always open (everyone sees who voted for whom, live). Plurality or majority-needed. Tie: nobody out or random. Abstain on/off |
| Timers | Seconds per phase: role reveal, each night role, dawn, discussion, voting, verdict |
| Rules | Reveal role on death, doctor self-protect, doctor can't repeat target, announce saves, majority can end discussion, early night advance, hide which roles are dead, ghosts read Mafia chat |
| Themes | Noir City, Midnight Village, Neon Syndicate, Gilded Manor. Each has its own look, role names and narration script |
| Chat | Town chat (locked at night), Mafia chat, Ghost chat for the dead and spectators, and a game log |
| Video | Mics and cameras forced off at night and for ghosts |
| Personal | Voice, speed, pitch, volume, ambient sound, sound effects, reduced motion |
| Extras | Room codes and invite links, reconnect after a drop, late joiners become spectators, kick in the lobby, play again |

## Setup (about 15 minutes)

### 1. Supabase (free)
1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

Nothing else is needed: Realtime Broadcast and Presence work out of the box. Free-plan Realtime limits at the time of writing: 200 concurrent connections and 100 messages/second per project ([source](https://supabase.com/docs/guides/realtime/limits)). That comfortably covers many rooms of friends.

### 2. Google Sheets history (optional)
1. Create a Google Sheet. **Extensions → Apps Script**, paste `apps-script/Code.gs`.
2. **Project Settings → Script properties**: add `SECRET` = any long random string.
3. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Copy the `/exec` URL.

Tabs **Games** and **Players** are created automatically. A "Hall of fame" appears on the home screen.

### 3. Deploy to Netlify
Functions need a Git deploy or the CLI (plain drag-and-drop of a folder does not build them):

```bash
npm i -g netlify-cli
netlify login
netlify init            # or: netlify deploy --prod
```

Set these environment variables (Site settings → Environment variables):

| Variable | Required | Value |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_ANON_KEY` | yes | anon public key |
| `SHEETS_WEBHOOK_URL` | no | Apps Script `/exec` URL |
| `SHEETS_SECRET` | no | the same `SECRET` |
| `JITSI_DOMAIN` | no | default `meet.jit.si` |
| `JAAS_APP_ID`, `JAAS_KID`, `JAAS_PRIVATE_KEY` | no | 8x8 JaaS (hosted Jitsi) credentials, see below |

### 4. Video provider
- **Default:** public `meet.jit.si`. I could not confirm its current terms for embedding in third-party sites, so test it with your group before game night.
- **Recommended if the public server limits you:** [8x8 JaaS](https://jaas.8x8.vc) (hosted Jitsi, has a free tier; check its current allowance). Set the three `JAAS_*` variables. `netlify/functions/jaas-token.mjs` signs the short-lived tokens. `JAAS_PRIVATE_KEY` is the PEM private key (newlines as `\n` are fine).
- **Self-hosted Jitsi:** set `JITSI_DOMAIN` and add your domain to the `Permissions-Policy` header in `netlify.toml` (camera, microphone, display-capture).

## Try it with no backend

You can play across several tabs of one browser, no Supabase or Netlify needed:

```bash
npx serve public          # or: python3 -m http.server -d public 8080
# open http://localhost:3000/?local=1 in 4+ tabs, create a room in one, join from the others
```

For a real backend while developing locally, run `netlify dev`, or copy `public/js/config.local.example.js` to `config.local.js` and fill in your Supabase values.

## Tests

```bash
npm test                          # game engine: rules, roles, voting, 200 randomized bot games
python3 tests/ui-smoke.py 5       # optional: plays a full game across 5 real browser tabs
MOD=host python3 tests/ui-smoke.py 6    # same, with a human host narrating
```
The UI test needs `pip install playwright && playwright install chromium`.

## Honest limitations

- **Not cheat-proof.** The host's browser is authoritative, but every client receives the same broadcast channel, including messages addressed to individuals (roles, Mafia chat). The UI only shows what you may see; a player who opens developer tools can read more. Fine for friends. A tamper-resistant version needs a server-side referee (for example Supabase Edge Functions with private channels).
- **If the host closes the tab,** the game pauses. Reopen the room code in the same browser and tap **Rejoin as host**: saved state is restored and the clock resumes where it stopped. Others reconnect automatically.
- **Video muting is soft enforcement.** The app switches mics and cameras off at night and for ghosts and re-mutes anyone who turns them back on, but a modified client could ignore it. Hard muting needs Jitsi moderator tokens.
- **Disconnect detection** relies on presence and can take 10–30 seconds.
- **Narrator voice quality** depends on the device's installed voices (pick one in My settings). A drop-in upgrade would be pre-generated audio from a premium voice service.
- Room codes are 4 letters. Video rooms get an extra secret suffix so strangers cannot guess them.

## Project layout

```
public/            static site (index.html, css/style.css, js/*)
  js/engine.js     pure game rules (also run by the tests in Node)
  js/app.js        UI, host controller, networking glue
  js/themes.js     theme names and narration scripts
  js/narrator.js   speech, ambient sound, effects
  js/net.js        Supabase Realtime wrapper (+ BroadcastChannel local mode)
  js/video.js      Jitsi wrapper with night / ghost muting
netlify/functions/ config, log-game, leaderboard, jaas-token
apps-script/Code.gs  Google Sheets history + leaderboard
tests/             engine tests and browser smoke test
```

## Ideas for next

More roles (Jester, Vigilante, Godfather), a server-side referee, hard video muting with moderator tokens, spoken roles from a premium voice, and a Sheet-driven custom narration script editor.
