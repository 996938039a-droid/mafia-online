/**
 * Mafia Online: Google Sheets history + leaderboard.
 *
 * SETUP
 * 1. Create a Google Sheet (any name). Extensions > Apps Script. Paste this file.
 * 2. Project Settings > Script properties > add  SECRET = <a long random string>
 * 3. Deploy > New deployment > type "Web app"
 *      Execute as: Me      Who has access: Anyone
 *    Copy the web app URL (ends with /exec).
 * 4. In Netlify env vars set:
 *      SHEETS_WEBHOOK_URL = <that URL>
 *      SHEETS_SECRET      = <the same SECRET>
 */

const GAMES = 'Games';
const PLAYERS = 'Players';

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function ok_(secret) {
  const s = PropertiesService.getScriptProperties().getProperty('SECRET') || '';
  return s === '' || s === secret;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!ok_(body.secret)) return out_({ ok: false, error: 'auth' });
    const g = body.game;
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    const games = sheet_(GAMES, ['Played at', 'Room', 'Theme', 'Winner', 'Rounds', 'Duration (s)', 'Players']);
    const players = sheet_(PLAYERS, ['Played at', 'Room', 'Player', 'Role', 'Survived', 'Won']);

    const at = g.startedAt || new Date().toISOString();
    games.appendRow([at, g.room, g.theme, g.winner, g.rounds, g.durationSec, g.players.length]);
    const rows = g.players.map(function (p) {
      return [at, g.room, p.name, p.role, p.alive ? 'yes' : 'no', p.won ? 'yes' : 'no'];
    });
    if (rows.length) players.getRange(players.getLastRow() + 1, 1, rows.length, 6).setValues(rows);

    lock.releaseLock();
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.action !== 'leaderboard') return out_({ ok: true, service: 'mafia-online' });
  if (!ok_(e.parameter.secret)) return out_({ ok: false, error: 'auth' });

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAYERS);
  if (!sh || sh.getLastRow() < 2) return out_({ ok: true, rows: [] });

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const stats = {};
  data.forEach(function (r) {
    const name = String(r[2]).trim();
    if (!name) return;
    const key = name.toLowerCase();
    const s = stats[key] || (stats[key] = { name: name, games: 0, wins: 0, mafiaWins: 0 });
    s.games++;
    if (r[5] === 'yes') {
      s.wins++;
      if (r[3] === 'mafia') s.mafiaWins++;
    }
  });
  const rows = Object.keys(stats)
    .map(function (k) { return stats[k]; })
    .sort(function (a, b) { return b.wins - a.wins || a.games - b.games; })
    .slice(0, 10);
  return out_({ ok: true, rows: rows });
}
