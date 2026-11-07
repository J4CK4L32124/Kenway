'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7236;

function getBaseDir() {
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
}

const CONFIG_FILE = path.join(getBaseDir(), 'config', 'plugins', 'nickbot.config.json');
const FONT_FILE = path.join(getBaseDir(), 'main.ttf');
const HISTORY_FILE = path.join(getBaseDir(), 'data', 'nickbot-history.jsonl');

const DEFAULTS = {
  player: { IGN: '', Nick: '' },
  nickBot: {
    enabled: false,
    mode: 'passive',
    profiles: {
      active: {
        cooldown: 1,
        switchLobby: 0,
        allowFourLetter: true,
        allowFiveLetter: true,
        requireTripleVowel: true,
        autoClaimLegacy: true,
        legacyRegex: true,
        preTest: false,
        contains: '',
        startsWith: '',
        endsWith: ''
      },
      passive: {
        cooldown: 1,
        switchLobby: 10,
        allowFourLetter: true,
        allowFiveLetter: true,
        requireTripleVowel: true,
        autoClaimLegacy: true,
        legacyRegex: true,
        preTest: false,
        contains: '',
        startsWith: '',
        endsWith: ''
      }
    },
    totalRerolls: 0
  }
};

function deepMerge(target, source) {
  const out = Object.assign({}, target);
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(typeof target[key] === 'object' && target[key] ? target[key] : {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

class NickBotWebServer {
  constructor() {
    this.server = null;
    this._liveProvider = null;
    this._onChange = null;
    this._onNickBotAction = null;
  }

  setLiveProvider(fn) { this._liveProvider = fn; }
  onConfigChange(fn) { this._onChange = fn; }
  onNickBotAction(fn) { this._onNickBotAction = fn; }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return {};
    }
  }

  _readView() {
    const raw = this._read();
    const nickBot = raw.nickBot || {};
    const player = raw.player || {};
    const legacyProfile = {
      cooldown: nickBot.cooldown ?? raw.cooldown ?? DEFAULTS.nickBot.profiles.passive.cooldown,
      switchLobby: nickBot.switchLobby ?? raw.switchLobby ?? DEFAULTS.nickBot.profiles.passive.switchLobby,
      allowFourLetter: nickBot.allowFourLetter ?? raw.allowFourLetter ?? DEFAULTS.nickBot.profiles.passive.allowFourLetter,
      allowFiveLetter: nickBot.allowFiveLetter ?? raw.allowFiveLetter ?? DEFAULTS.nickBot.profiles.passive.allowFiveLetter,
      requireTripleVowel: nickBot.requireTripleVowel ?? raw.requireTripleVowel ?? DEFAULTS.nickBot.profiles.passive.requireTripleVowel,
      autoClaimLegacy: nickBot.autoClaimLegacy ?? raw.autoClaimLegacy ?? DEFAULTS.nickBot.profiles.passive.autoClaimLegacy,
      legacyRegex: nickBot.legacyRegex ?? raw.legacyRegex ?? DEFAULTS.nickBot.profiles.passive.legacyRegex,
      preTest: nickBot.preTest ?? raw.preTest ?? DEFAULTS.nickBot.profiles.passive.preTest,
      contains: nickBot.contains ?? raw.contains ?? DEFAULTS.nickBot.profiles.passive.contains,
      startsWith: nickBot.startsWith ?? raw.startsWith ?? DEFAULTS.nickBot.profiles.passive.startsWith,
      endsWith: nickBot.endsWith ?? raw.endsWith ?? DEFAULTS.nickBot.profiles.passive.endsWith
    };
    const profiles = nickBot.profiles || {};
    const active = deepMerge(DEFAULTS.nickBot.profiles.active, profiles.active || {});
    const passive = deepMerge(
      DEFAULTS.nickBot.profiles.passive,
      Object.keys(profiles.passive || {}).length ? profiles.passive : legacyProfile
    );
    active.switchLobby = 0;

    return {
      enabled: raw.enabled !== false,
      debug: !!raw.debug,
      player: {
        IGN: typeof player.IGN === 'string' ? player.IGN : DEFAULTS.player.IGN,
        Nick: typeof player.Nick === 'string' ? player.Nick : DEFAULTS.player.Nick
      },
      nickBot: {
        enabled: nickBot.enabled ?? DEFAULTS.nickBot.enabled,
        mode: nickBot.mode === 'active' ? 'active' : 'passive',
        profiles: { active, passive },
        totalRerolls: nickBot.totalRerolls ?? DEFAULTS.nickBot.totalRerolls
      }
    };
  }

  _mapPatch(patch) {
    const mapped = {};
    const nickBotPatch = {};

    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) nickBotPatch.enabled = patch.enabled;
    if (Object.prototype.hasOwnProperty.call(patch, 'mode')) nickBotPatch.mode = patch.mode === 'active' ? 'active' : 'passive';

    if (patch.profile && patch.settings && typeof patch.settings === 'object' && !Array.isArray(patch.settings)) {
      const mode = patch.profile === 'active' ? 'active' : 'passive';
      nickBotPatch.profiles = { [mode]: { ...patch.settings } };
      if (mode === 'active') nickBotPatch.profiles.active.switchLobby = 0;
    }

    if (patch.nickBot && typeof patch.nickBot === 'object' && !Array.isArray(patch.nickBot)) {
      Object.assign(nickBotPatch, patch.nickBot);
    }

    if (Object.keys(nickBotPatch).length > 0) mapped.nickBot = nickBotPatch;

    if (patch.player && typeof patch.player === 'object' && !Array.isArray(patch.player)) {
      mapped.player = {};
      if (Object.prototype.hasOwnProperty.call(patch.player, 'IGN')) mapped.player.IGN = patch.player.IGN;
      if (Object.prototype.hasOwnProperty.call(patch.player, 'Nick')) mapped.player.Nick = patch.player.Nick;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'debug')) mapped.debug = patch.debug;

    return mapped;
  }

  _write(patch) {
    const merged = deepMerge(this._read(), this._mapPatch(patch));
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
    if (this._onChange) this._onChange(merged);
    return merged;
  }

  start() {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      try {
        this._route(req, res);
      } catch (error) {
        res.writeHead(500);
        res.end(error.message);
      }
    });
    this.server.on('error', error => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[NickBot] Port ${PORT} busy - settings UI unavailable`);
      } else {
        console.error(`[NickBot] Web server: ${error.message}`);
      }
    });
    this.server.listen(PORT, '127.0.0.1', () => {
      console.log(`[NickBot] Settings UI -> http://localhost:${PORT}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  _route(req, res) {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/font') {
      if (!fs.existsSync(FONT_FILE)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'font/truetype', 'Cache-Control': 'max-age=86400' });
      res.end(fs.readFileSync(FONT_FILE));
      return;
    }

    if (req.method === 'GET' && url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this._readView()));
      return;
    }

    if (req.method === 'POST' && url === '/api/config') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      req.on('end', () => {
        try {
          this._write(JSON.parse(body));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400);
          res.end('Bad JSON');
        }
      });
      return;
    }

    if (req.method === 'GET' && url === '/api/live') {
      const data = this._liveProvider ? this._liveProvider() : {};
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(data));
      return;
    }

    if (req.method === 'GET' && url.startsWith('/api/history')) {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
      const params = new URLSearchParams(qs);
      const search = (params.get('search') || '').toLowerCase().trim();
      const page = Math.max(0, parseInt(params.get('page') || '0', 10));
      const limit = Math.min(500, Math.max(1, parseInt(params.get('limit') || '200', 10)));
      try {
        let entries = [];
        if (fs.existsSync(HISTORY_FILE)) {
          entries = fs.readFileSync(HISTORY_FILE, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .reverse()
            .map(line => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
        }
        const total = entries.length;
        if (search) {
          entries = entries.filter(entry =>
            ((entry.nick || '') + ' ' + (entry.status || '') + ' ' + (entry.reason || '')).toLowerCase().includes(search)
          );
        }
        const filtered = entries.length;
        const slice = entries.slice(page * limit, (page + 1) * limit);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ total, filtered, page, limit, entries: slice }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (req.method === 'POST' && url === '/api/action') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 256) req.destroy();
      });
      req.on('end', () => {
        try {
          const { action } = JSON.parse(body);
          if (!['claim', 'skip', 'on', 'off'].includes(action)) {
            res.writeHead(400);
            res.end('Unknown action');
            return;
          }
          if (this._onNickBotAction) this._onNickBotAction(action);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400);
          res.end('Bad JSON');
        }
      });
      return;
    }

    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NickBot</title>
<style>
  @font-face { font-family: MC; src: url('/font') format('truetype'); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0c1020;
    --bg2: #151a31;
    --surface: #141a32;
    --surface2: #1b2342;
    --card: rgba(18, 23, 42, 0.92);
    --card2: rgba(24, 31, 56, 0.98);
    --border: #242d4e;
    --border2: #33406a;
    --accent: #a855f7;
    --accent2: #d8b4fe;
    --accentGlow: rgba(168, 85, 247, 0.22);
    --text: #eef2ff;
    --muted: #94a3c5;
    --muted2: #6e7b9a;
    --green: #4ade80;
    --greenBg: rgba(22, 101, 52, 0.22);
    --red: #fb7185;
    --redBg: rgba(127, 29, 29, 0.2);
    --yellow: #fbbf24;
    --yellowBg: rgba(146, 64, 14, 0.22);
    --blue: #60a5fa;
    --blueBg: rgba(30, 64, 175, 0.2);
    --shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
    --shellMax: 1080px;
    --space: 18px;
    --spaceLg: 24px;
    --radiusCard: 18px;
    --radiusControl: 12px;
    --radiusPill: 999px;
    --glow: 0 0 0 rgba(0, 0, 0, 0);
  }

  html { scroll-behavior: smooth; }
  body {
    font-family: MC, monospace;
    background:
      radial-gradient(circle at top left, rgba(255,255,255,0.05), transparent 32%),
      radial-gradient(circle at top right, var(--accentGlow), transparent 30%),
      linear-gradient(180deg, var(--bg2), var(--bg));
    color: var(--text);
    min-height: 100vh;
    font-size: 13px;
    line-height: 1.5;
    transition: background .25s ease, color .25s ease;
  }

  body[data-density="compact"] {
    --space: 14px;
    --spaceLg: 20px;
  }

  body[data-density="wide"] {
    --space: 22px;
    --spaceLg: 30px;
    --shellMax: 1180px;
  }

  body[data-radius="sharp"] {
    --radiusCard: 10px;
    --radiusControl: 8px;
  }

  body[data-radius="soft"] {
    --radiusCard: 24px;
    --radiusControl: 18px;
  }

  body[data-effects="off"] {
    --shadow: none;
    --glow: none;
  }

  body[data-effects="on"] {
    --glow: 0 0 30px var(--accentGlow);
  }

  body[data-surface="slate"] {
    --bg: #10141d;
    --bg2: #1a2230;
    --surface: #171d29;
    --surface2: #20283a;
    --card: rgba(22, 29, 42, 0.94);
    --card2: rgba(29, 36, 52, 0.98);
    --border: #313c54;
    --border2: #47546f;
  }

  body[data-surface="forest"] {
    --bg: #071511;
    --bg2: #102a22;
    --surface: #123126;
    --surface2: #173d2f;
    --card: rgba(14, 36, 29, 0.94);
    --card2: rgba(19, 48, 39, 0.98);
    --border: #235241;
    --border2: #2f6d58;
  }

  body[data-surface="ember"] {
    --bg: #190d10;
    --bg2: #2b151a;
    --surface: #301920;
    --surface2: #42242b;
    --card: rgba(41, 22, 28, 0.94);
    --card2: rgba(58, 29, 38, 0.98);
    --border: #6b3040;
    --border2: #87495a;
  }

  body[data-surface="ocean"] {
    --bg: #07131b;
    --bg2: #0f2433;
    --surface: #123146;
    --surface2: #183d56;
    --card: rgba(13, 31, 46, 0.94);
    --card2: rgba(19, 43, 61, 0.98);
    --border: #26506b;
    --border2: #32708f;
  }

  body[data-surface="frost"] {
    --bg: #0d1420;
    --bg2: #192436;
    --surface: #21314a;
    --surface2: #2a4061;
    --card: rgba(20, 31, 47, 0.94);
    --card2: rgba(31, 47, 70, 0.98);
    --border: #4a6489;
    --border2: #6e88af;
  }

  body[data-surface="sunset"] {
    --bg: #1b1020;
    --bg2: #311727;
    --surface: #44212d;
    --surface2: #5a2b39;
    --card: rgba(42, 21, 33, 0.94);
    --card2: rgba(61, 31, 45, 0.98);
    --border: #7f4554;
    --border2: #b05c62;
  }

  body[data-surface="graphite"] {
    --bg: #0e1014;
    --bg2: #161a20;
    --surface: #20262f;
    --surface2: #2a323d;
    --card: rgba(22, 26, 32, 0.94);
    --card2: rgba(31, 37, 45, 0.98);
    --border: #3f4a57;
    --border2: #5f6d7d;
  }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.18); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 999px; }

  .shell {
    width: min(100%, var(--shellMax));
    margin: 0 auto;
    padding: 30px 18px 56px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .eyebrow {
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 1.2px;
    margin-bottom: 8px;
  }

  h1 {
    font-size: 30px;
    letter-spacing: 2px;
    line-height: 1;
    color: var(--text);
    text-shadow: var(--glow);
  }

  .tagline {
    margin-top: 8px;
    color: var(--muted);
    max-width: 640px;
    font-size: 11px;
  }

  .header-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pill-btn,
  .tab-btn,
  .mc-btn,
  .btn-ctrl,
  .modal-close,
  .option-btn,
  .pager-btn {
    font-family: MC, monospace;
  }

  .pill-btn {
    border: 1px solid var(--border2);
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
    color: var(--text);
    border-radius: var(--radiusPill);
    padding: 9px 14px;
    cursor: pointer;
    font-size: 11px;
    letter-spacing: .9px;
    transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
  }

  .pill-btn:hover {
    border-color: var(--accent);
    box-shadow: 0 0 18px var(--accentGlow);
    transform: translateY(-1px);
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding: 6px;
    background: rgba(8, 12, 24, 0.65);
    border: 1px solid var(--border);
    border-radius: calc(var(--radiusCard) + 2px);
    box-shadow: var(--shadow);
    margin-bottom: 20px;
  }

  .tab-btn {
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    border-radius: calc(var(--radiusControl) + 2px);
    padding: 12px 10px;
    font-size: 12px;
    letter-spacing: 1.2px;
    cursor: pointer;
    transition: all .18s ease;
  }

  .tab-btn:hover {
    color: var(--text);
    background: rgba(255,255,255,0.04);
  }

  .tab-btn.active {
    color: var(--accent2);
    border-color: rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
    box-shadow: 0 0 20px var(--accentGlow);
  }

  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  .panel-grid {
    display: grid;
    gap: 16px;
  }

  .card {
    background: linear-gradient(180deg, var(--card2), var(--card));
    border: 1px solid var(--border);
    border-radius: var(--radiusCard);
    overflow: hidden;
    box-shadow: var(--shadow);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0));
  }

  .card-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--text);
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .card-title {
    color: var(--text);
    font-size: 14px;
    letter-spacing: .6px;
  }

  .card-note {
    margin-left: auto;
    color: var(--muted);
    font-size: 10px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
  }

  .row + .row {
    border-top: 1px solid rgba(255,255,255,0.04);
  }

  .row.dim {
    opacity: .48;
  }

  .row-label {
    min-width: 0;
    flex: 1;
  }

  .key {
    color: var(--text);
    font-size: 13px;
  }

  .desc {
    color: var(--muted);
    font-size: 10px;
    margin-top: 4px;
    line-height: 1.45;
  }

  .row-ctrl {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-shrink: 0;
  }

  .mc-btn,
  .btn-ctrl,
  .option-btn,
  .pager-btn,
  .modal-close {
    border: 1px solid var(--border2);
    background: rgba(0,0,0,0.18);
    color: var(--muted);
    border-radius: var(--radiusControl);
    padding: 8px 14px;
    cursor: pointer;
    font-size: 11px;
    letter-spacing: .9px;
    transition: all .16s ease;
  }

  .mc-btn:hover,
  .btn-ctrl:hover,
  .option-btn:hover,
  .pager-btn:hover,
  .modal-close:hover {
    border-color: var(--accent);
    color: var(--text);
    box-shadow: 0 0 16px var(--accentGlow);
  }

  .mc-btn.on,
  .option-btn.active {
    color: var(--accent2);
    border-color: rgba(255,255,255,0.06);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
    box-shadow: 0 0 18px var(--accentGlow);
  }

  .mc-btn.off {
    color: var(--muted);
  }

  .mc-inp {
    width: 190px;
    border: 1px solid var(--border2);
    background: rgba(7, 10, 20, 0.58);
    color: var(--text);
    border-radius: var(--radiusControl);
    padding: 9px 10px;
    font-family: MC, monospace;
    font-size: 12px;
    transition: border-color .16s ease, box-shadow .16s ease, opacity .16s ease;
  }

  .mc-inp:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(255,255,255,0.03), 0 0 18px var(--accentGlow);
  }

  .mc-inp:disabled {
    opacity: .55;
  }

  input[type="number"].mc-inp { width: 98px; }

  .save-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 10px var(--green);
    opacity: 0;
    transition: opacity .18s ease;
  }

  .save-dot.show { opacity: 1; }

  .mode-switch {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 16px;
  }

  .stat-card {
    background: linear-gradient(180deg, var(--card2), var(--card));
    border: 1px solid var(--border);
    border-radius: var(--radiusCard);
    padding: 16px;
    box-shadow: var(--shadow);
  }

  .stat-label {
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .stat-value {
    margin-top: 10px;
    font-size: 18px;
    line-height: 1.1;
    color: var(--text);
  }

  .stat-value.on { color: var(--green); }
  .stat-value.off { color: var(--red); }
  .stat-value.waiting { color: var(--yellow); }
  .stat-value.nick { color: var(--blue); font-size: 15px; }
  .stat-value.num { color: var(--accent2); }

  .pretest-banner {
    display: none;
    margin-bottom: 16px;
    padding: 18px;
    border-radius: var(--radiusCard);
    border: 1px solid rgba(74, 222, 128, 0.32);
    background: linear-gradient(180deg, rgba(22, 101, 52, 0.22), rgba(3, 24, 13, 0.8));
    box-shadow: 0 0 24px rgba(74, 222, 128, 0.12);
  }

  .pretest-banner.visible { display: block; }

  .pretest-label {
    color: var(--green);
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .pretest-nick {
    margin: 10px 0 14px;
    font-size: 24px;
    color: var(--blue);
  }

  .pretest-actions,
  .bot-controls {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn-claim {
    color: var(--green);
    border-color: rgba(74, 222, 128, 0.35);
    background: var(--greenBg);
  }

  .btn-skip,
  .btn-disable {
    color: var(--red);
    border-color: rgba(251, 113, 133, 0.35);
    background: var(--redBg);
  }

  .btn-enable {
    color: var(--green);
    border-color: rgba(74, 222, 128, 0.35);
    background: var(--greenBg);
  }

  .bot-controls {
    margin-bottom: 16px;
  }

  .history-controls {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .search-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--border2);
    border-radius: var(--radiusControl);
    background: rgba(7, 10, 20, 0.58);
    padding: 0 12px;
    min-width: min(100%, 520px);
  }

  .search-ico {
    color: var(--muted);
    font-size: 12px;
  }

  .search-inp {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: MC, monospace;
    font-size: 12px;
    padding: 10px 0;
  }

  .search-inp:focus {
    outline: none;
  }

  .hist-meta {
    color: var(--muted);
    font-size: 10px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    text-align: left;
    padding: 12px 18px;
    border-top: 1px solid rgba(255,255,255,0.04);
    font-size: 11px;
    vertical-align: top;
  }

  th {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 10px;
  }

  tr:hover td {
    background: rgba(255,255,255,0.02);
  }

  .att-cell,
  .time-cell {
    color: var(--muted);
    white-space: nowrap;
  }

  .nick-cell {
    color: var(--blue);
  }

  .reason-cell {
    color: var(--text);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 5px 10px;
    border: 1px solid var(--border2);
    color: var(--text);
    font-size: 10px;
    letter-spacing: .8px;
    text-transform: uppercase;
  }

  .badge-accept {
    color: var(--yellow);
    background: var(--yellowBg);
    border-color: rgba(251, 191, 36, 0.34);
  }

  .badge-reject {
    color: var(--red);
    background: var(--redBg);
    border-color: rgba(251, 113, 133, 0.3);
  }

  .badge-claim {
    color: var(--green);
    background: var(--greenBg);
    border-color: rgba(74, 222, 128, 0.3);
  }

  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .pager-label {
    color: var(--muted);
    font-size: 10px;
  }

  .pager-btn:disabled {
    opacity: .45;
    cursor: default;
    box-shadow: none;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(3, 5, 12, 0.78);
    backdrop-filter: blur(10px);
    display: none;
    padding: 22px;
    overflow-y: auto;
    z-index: 20;
  }

  .modal-backdrop.visible {
    display: block;
  }

  .modal-card {
    width: min(100%, 760px);
    margin: 34px auto;
    background: linear-gradient(180deg, var(--card2), var(--card));
    border: 1px solid var(--border);
    border-radius: calc(var(--radiusCard) + 4px);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 22px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .modal-title {
    font-size: 16px;
    color: var(--text);
  }

  .modal-subtitle {
    margin-top: 6px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.45;
  }

  .modal-body {
    padding: 18px 22px 22px;
    display: grid;
    gap: 18px;
  }

  .help-block {
    display: grid;
    gap: 8px;
  }

  .help-heading {
    color: var(--accent2);
    font-size: 12px;
  }

  .help-text,
  .help-item,
  .help-meta {
    color: var(--text);
    font-size: 11px;
    line-height: 1.55;
  }

  .help-item strong,
  .help-meta strong {
    color: var(--accent2);
  }

  .option-grid {
    display: grid;
    gap: 10px;
  }

  .palette-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }

  .palette-btn {
    border: 1px solid var(--border2);
    background: rgba(0,0,0,0.18);
    color: var(--text);
    border-radius: var(--radiusControl);
    padding: 12px;
    cursor: pointer;
    text-align: left;
    transition: all .16s ease;
  }

  .palette-btn:hover {
    border-color: var(--accent);
    box-shadow: 0 0 16px var(--accentGlow);
    transform: translateY(-1px);
  }

  .palette-btn.active {
    border-color: rgba(255,255,255,0.08);
    box-shadow: 0 0 18px var(--accentGlow);
    background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  }

  .palette-swatch {
    height: 44px;
    border-radius: calc(var(--radiusControl) - 2px);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
  }

  .palette-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }

  .palette-name {
    font-size: 11px;
    color: var(--text);
  }

  .palette-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.25);
    flex-shrink: 0;
  }

  .option-title {
    color: var(--accent2);
    font-size: 12px;
  }

  .option-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .option-btn {
    min-width: 92px;
    text-align: center;
  }

  .custom-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .save-inline {
    color: var(--muted);
    font-size: 10px;
  }

  @media (max-width: 720px) {
    .shell { padding-inline: 12px; }
    .header { align-items: stretch; }
    .header-actions { width: 100%; }
    .pill-btn { flex: 1; text-align: center; }
    .row { flex-direction: column; align-items: flex-start; }
    .row-ctrl { width: 100%; flex-wrap: wrap; }
    .mc-inp,
    input[type="number"].mc-inp { width: 100%; }
    .search-wrap { min-width: 100%; width: 100%; }
    .bot-controls,
    .pretest-actions,
    .mode-switch { width: 100%; }
    .btn-ctrl,
    .btn-claim,
    .btn-skip,
    .mc-btn { flex: 1; text-align: center; }
    table { display: block; overflow-x: auto; }
    .modal-backdrop { padding: 12px; }
  }
</style>
</head>
<body data-density="cozy" data-radius="rounded" data-surface="midnight" data-effects="on">
<div class="shell">
  <div class="header">
    <div>
      <div class="eyebrow">LOCAL CONTROL PANEL</div>
      <h1>NickBot</h1>
      <div class="tagline">Run the nick search in the background, manage Active and Passive profiles, and keep both NickBot and site preferences saved for the next restart.</div>
    </div>
    <div class="header-actions">
      <button class="pill-btn" onclick="openHelp()">HELP</button>
    </div>
  </div>

  <div class="tabs">
    <button id="tab-btn-settings" class="tab-btn active" onclick="showTab('settings')">SETTINGS</button>
    <button id="tab-btn-live" class="tab-btn" onclick="showTab('live')">LIVE</button>
  </div>

  <div id="tab-settings" class="tab-pane active">
    <div class="panel-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-icon">MD</div>
          <div class="card-title">Mode</div>
          <div class="card-note">Saved separately per profile</div>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="row-label">
              <div class="key">Current Mode</div>
              <div class="desc" id="mode-desc">Passive Mode keeps the normal behavior and can switch lobbies.</div>
            </div>
            <div class="row-ctrl mode-switch">
              <button id="btn-mode-active" class="mc-btn off" onclick="setMode('active')">ACTIVE</button>
              <button id="btn-mode-passive" class="mc-btn on" onclick="setMode('passive')">PASSIVE</button>
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">Enabled</div>
              <div class="desc">Turn NickBot on or off without touching your saved filters.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-enabled" onclick="toggleBool('enabled')">OFF</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-icon">GN</div>
          <div class="card-title">General Settings</div>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="row-label">
              <div class="key">Cooldown</div>
              <div class="desc">How often NickBot requests a new nickname book.</div>
            </div>
            <div class="row-ctrl">
              <span class="save-dot" id="si-cooldown"></span>
              <input class="mc-inp" id="inp-cooldown" type="number" min="0" max="60" oninput="debounceSave('cooldown',toNumber(this.value,1),'si-cooldown')">
            </div>
          </div>
          <div class="row" id="row-switchLobby">
            <div class="row-label">
              <div class="key">Switch Lobby</div>
              <div class="desc" id="switchLobby-desc">Switch to a random lobby every N rejected attempts (0 = off).</div>
            </div>
            <div class="row-ctrl">
              <span class="save-dot" id="si-switchLobby"></span>
              <input class="mc-inp" id="inp-switchLobby" type="number" min="0" max="500" oninput="debounceSave('switchLobby',toNumber(this.value,0),'si-switchLobby')">
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-icon">MT</div>
          <div class="card-title">Match Rules</div>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="row-label">
              <div class="key">Legacy Nicks</div>
              <div class="desc">Accept names from the built-in legacy list instantly.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-autoClaimLegacy" onclick="toggleBool('autoClaimLegacy')">OFF</button>
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">Legacy Regex</div>
              <div class="desc">Accept repeated-vowel legacy names using the fallback regex.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-legacyRegex" onclick="toggleBool('legacyRegex')">OFF</button>
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">4-Letter</div>
              <div class="desc">Accept any nickname with exactly 4 letters.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-allowFourLetter" onclick="toggleBool('allowFourLetter')">OFF</button>
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">5-Letter</div>
              <div class="desc">Accept any nickname with exactly 5 letters.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-allowFiveLetter" onclick="toggleBool('allowFiveLetter')">OFF</button>
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">Triple Vowel</div>
              <div class="desc">Accept names with repeated vowels like xoooz or bruuuh.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-requireTripleVowel" onclick="toggleBool('requireTripleVowel')">OFF</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-icon">AL</div>
          <div class="card-title">Custom Allowlist</div>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="row-label">
              <div class="key">Contains</div>
              <div class="desc">Accept nicks containing any of these comma-separated parts.</div>
            </div>
            <div class="row-ctrl">
              <span class="save-dot" id="si-contains"></span>
              <input class="mc-inp" id="inp-contains" type="text" placeholder="luna, qt, irl" oninput="debounceSave('contains',this.value,'si-contains')">
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">Starts With</div>
              <div class="desc">Accept nicks starting with any of these prefixes.</div>
            </div>
            <div class="row-ctrl">
              <span class="save-dot" id="si-startsWith"></span>
              <input class="mc-inp" id="inp-startsWith" type="text" placeholder="its, x, v" oninput="debounceSave('startsWith',this.value,'si-startsWith')">
            </div>
          </div>
          <div class="row">
            <div class="row-label">
              <div class="key">Ends With</div>
              <div class="desc">Accept nicks ending with any of these suffixes.</div>
            </div>
            <div class="row-ctrl">
              <span class="save-dot" id="si-endsWith"></span>
              <input class="mc-inp" id="inp-endsWith" type="text" placeholder="irl, qt, lol" oninput="debounceSave('endsWith',this.value,'si-endsWith')">
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-icon">PT</div>
          <div class="card-title">Pre-Test Mode</div>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="row-label">
              <div class="key">Pre-Test</div>
              <div class="desc">Pause on a good nickname and ask for YES or NO before claiming it.</div>
            </div>
            <div class="row-ctrl">
              <button class="mc-btn off" id="btn-preTest" onclick="toggleBool('preTest')">OFF</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="tab-live" class="tab-pane">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Status</div>
        <div class="stat-value" id="stat-enabled">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Current Nick</div>
        <div class="stat-value nick" id="stat-nick">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Attempts</div>
        <div class="stat-value num" id="stat-attempts">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Waiting Book</div>
        <div class="stat-value" id="stat-waiting">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">In Game</div>
        <div class="stat-value" id="stat-game">-</div>
      </div>
    </div>

    <div class="pretest-banner" id="pretest-banner">
      <div class="pretest-label">Nick Found - waiting for YES or NO</div>
      <div class="pretest-nick" id="pretest-nick">-</div>
      <div class="pretest-actions">
        <button class="btn-ctrl btn-claim" onclick="sendAction('claim')">YES</button>
        <button class="btn-ctrl btn-skip" onclick="sendAction('skip')">NO</button>
      </div>
    </div>

    <div class="bot-controls">
      <button class="btn-ctrl btn-enable" onclick="sendAction('on')">ENABLE</button>
      <button class="btn-ctrl btn-disable" onclick="sendAction('off')">DISABLE</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-icon">HS</div>
        <div class="card-title">Nick History</div>
      </div>
      <div class="card-body" style="padding: 16px 18px;">
        <div class="history-controls">
          <div class="search-wrap">
            <span class="search-ico">/</span>
            <input class="search-inp" id="hist-search" type="text" placeholder="Search nickname, status, reason..." oninput="histSearch()">
          </div>
          <div class="hist-meta" id="hist-count">0 entries</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nickname</th>
            <th>Result</th>
            <th>Reason</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody id="hist-body">
          <tr><td colspan="5" style="color: var(--muted); text-align: center; padding: 28px;">Loading...</td></tr>
        </tbody>
      </table>
      <div style="padding: 14px 18px; border-top: 1px solid rgba(255,255,255,0.05);">
        <div class="pager">
          <button class="pager-btn" id="pager-prev" onclick="histPage(-1)">PREV</button>
          <div class="pager-label" id="pager-label">Page 1</div>
          <button class="pager-btn" id="pager-next" onclick="histPage(1)">NEXT</button>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="modal-backdrop" id="help-modal" onclick="closeModal(event, 'help-modal')">
  <div class="modal-card" onclick="event.stopPropagation()">
    <div class="modal-head">
      <div>
        <div class="modal-title">NickBot Help</div>
        <div class="modal-subtitle">English explanations for modes, rules, history, and the pre-test workflow.</div>
      </div>
      <button class="modal-close" onclick="closeHelp()">CLOSE</button>
    </div>
    <div class="modal-body">
      <div class="help-block">
        <div class="help-heading">Overview</div>
        <div class="help-text">NickBot asks Hypixel for random nickname books, reads the generated nick in the background, checks it against your rules, and either claims it or keeps searching.</div>
      </div>
      <div class="help-block">
        <div class="help-heading">Active Mode</div>
        <div class="help-text">Active Mode is the background mode. The book stays hidden on your client and lobby switching is always disabled.</div>
      </div>
      <div class="help-block">
        <div class="help-heading">Passive Mode</div>
        <div class="help-text">Passive Mode keeps the normal flow. It can switch lobbies after the amount of rejected attempts you set.</div>
      </div>
      <div class="help-block">
        <div class="help-heading">Separate Profiles</div>
        <div class="help-text">Active and Passive settings are saved separately. Changing one profile does not overwrite the other one.</div>
      </div>
      <div class="help-block">
        <div class="help-heading">Match Rules</div>
        <div class="help-item"><strong>Legacy Nicks:</strong> Accepts names from the built-in legacy list.</div>
        <div class="help-item"><strong>Legacy Regex:</strong> Accepts names that match <strong>/^[A-Z][a-z]*([aeiou])\\1{2,}[a-z]*$/</strong>.</div>
        <div class="help-item"><strong>4-Letter / 5-Letter:</strong> Accepts exact nickname lengths.</div>
        <div class="help-item"><strong>Triple Vowel:</strong> Accepts repeated-vowel names like <strong>xoooz</strong>.</div>
        <div class="help-item"><strong>Contains / Starts With / Ends With:</strong> Custom allowlists for fast matching.</div>
      </div>
      <div class="help-block">
        <div class="help-heading">Pre-Test Mode</div>
        <div class="help-item"><strong>When enabled:</strong> NickBot stops on a good nick and waits for your decision.</div>
        <div class="help-item"><strong>YES:</strong> Claim the nick.</div>
        <div class="help-item"><strong>NO:</strong> Skip it and continue rolling.</div>
      </div>
    </div>
  </div>
</div>

<script>
let cfg = {};
let liveTimer = null;
let histPage_ = 0;
let histLimit = 100;
let histSearch_ = '';
let histTotal = 0;
const saveTimers = {};

loadConfig();

function showTab(id) {
  document.querySelectorAll('.tab-pane').forEach(node => node.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(node => node.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.getElementById('tab-btn-' + id).classList.add('active');
  if (id === 'live') {
    loadHistory();
    startLivePoll();
  } else {
    stopLivePoll();
  }
}

async function loadConfig() {
  try {
    cfg = await fetch('/api/config').then(response => response.json());
    renderConfig();
  } catch {}
}

function currentMode() {
  return cfg.nickBot && cfg.nickBot.mode === 'active' ? 'active' : 'passive';
}

function currentProfile() {
  const mode = currentMode();
  const profiles = (cfg.nickBot && cfg.nickBot.profiles) || {};
  return profiles[mode] || {};
}

function renderConfig() {
  const nickBot = cfg.nickBot || {};
  const mode = currentMode();
  const profile = currentProfile();

  setBtnBool('enabled', nickBot.enabled);
  setBtnBool('autoClaimLegacy', profile.autoClaimLegacy);
  setBtnBool('legacyRegex', profile.legacyRegex);
  setBtnBool('allowFourLetter', profile.allowFourLetter);
  setBtnBool('allowFiveLetter', profile.allowFiveLetter);
  setBtnBool('requireTripleVowel', profile.requireTripleVowel);
  setBtnBool('preTest', profile.preTest);
  setInp('cooldown', profile.cooldown ?? 1);
  setInp('switchLobby', profile.switchLobby ?? (mode === 'active' ? 0 : 10));
  setInp('contains', profile.contains ?? '');
  setInp('startsWith', profile.startsWith ?? '');
  setInp('endsWith', profile.endsWith ?? '');
  setModeButtons(mode);
  updateModeUi(mode);
}

function setBtnBool(key, value) {
  const btn = document.getElementById('btn-' + key);
  if (!btn) return;
  btn.textContent = value ? 'ON' : 'OFF';
  btn.className = 'mc-btn ' + (value ? 'on' : 'off');
}

function setInp(key, value) {
  const input = document.getElementById('inp-' + key);
  if (input) input.value = value ?? '';
}

function setModeButtons(mode) {
  const activeBtn = document.getElementById('btn-mode-active');
  const passiveBtn = document.getElementById('btn-mode-passive');
  if (activeBtn) activeBtn.className = 'mc-btn ' + (mode === 'active' ? 'on' : 'off');
  if (passiveBtn) passiveBtn.className = 'mc-btn ' + (mode === 'passive' ? 'on' : 'off');
}

function updateModeUi(mode) {
  const desc = document.getElementById('mode-desc');
  const row = document.getElementById('row-switchLobby');
  const input = document.getElementById('inp-switchLobby');
  const lobbyDesc = document.getElementById('switchLobby-desc');

  if (desc) {
    desc.textContent = mode === 'active'
      ? 'Active Mode hides the book and permanently disables lobby switching.'
      : 'Passive Mode keeps the normal behavior and can switch lobbies.';
  }

  if (row) row.classList.toggle('dim', mode === 'active');
  if (input) input.disabled = mode === 'active';

  if (lobbyDesc) {
    lobbyDesc.textContent = mode === 'active'
      ? 'Always disabled in Active Mode. No lobby switching.'
      : 'Switch to a random lobby every N rejected attempts (0 = off).';
  }
}

async function save(patch) {
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

async function toggleBool(key) {
  cfg.nickBot = cfg.nickBot || {};
  if (key === 'enabled') {
    cfg.nickBot.enabled = !cfg.nickBot.enabled;
    setBtnBool(key, cfg.nickBot.enabled);
    await save({ enabled: cfg.nickBot.enabled });
    return;
  }

  const mode = currentMode();
  cfg.nickBot.profiles = cfg.nickBot.profiles || {};
  const nextValue = !((cfg.nickBot.profiles[mode] || {})[key]);
  cfg.nickBot.profiles[mode] = Object.assign(cfg.nickBot.profiles[mode] || {}, { [key]: nextValue });
  setBtnBool(key, nextValue);
  await save({ profile: mode, settings: { [key]: nextValue } });
}

function debounceSave(key, value, dotId) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    const mode = currentMode();
    cfg.nickBot = cfg.nickBot || {};
    cfg.nickBot.profiles = cfg.nickBot.profiles || {};
    const nextValue = mode === 'active' && key === 'switchLobby' ? 0 : value;
    cfg.nickBot.profiles[mode] = Object.assign(cfg.nickBot.profiles[mode] || {}, { [key]: nextValue });
    await save({ profile: mode, settings: { [key]: nextValue } });
    flashDot(dotId);
  }, 500);
}

async function setMode(mode) {
  cfg.nickBot = cfg.nickBot || {};
  cfg.nickBot.mode = mode === 'active' ? 'active' : 'passive';
  renderConfig();
  await save({ mode: cfg.nickBot.mode });
}

function toNumber(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flashDot(id) {
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.classList.add('show');
  setTimeout(() => dot.classList.remove('show'), 1300);
}

function openHelp() {
  document.getElementById('help-modal').classList.add('visible');
}

function closeHelp() {
  document.getElementById('help-modal').classList.remove('visible');
}

function closeModal(event, id) {
  if (event && event.target && event.target.id !== id) return;
  document.getElementById(id).classList.remove('visible');
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeHelp();
  }
});

function startLivePoll() {
  if (!liveTimer) {
    fetchLive();
    liveTimer = setInterval(fetchLive, 1500);
  }
}

function stopLivePoll() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

async function fetchLive() {
  try {
    const data = await fetch('/api/live').then(response => response.json());
    renderLive(data);
  } catch {}
}

function renderLive(data) {
  const enabled = document.getElementById('stat-enabled');
  if (enabled) {
    enabled.textContent = data.enabled ? 'ENABLED' : 'DISABLED';
    enabled.className = 'stat-value ' + (data.enabled ? 'on' : 'off');
  }

  const nick = document.getElementById('stat-nick');
  if (nick) nick.textContent = data.currentNick || '-';

  const attempts = document.getElementById('stat-attempts');
  if (attempts) attempts.textContent = data.attempts ?? 0;

  const waiting = document.getElementById('stat-waiting');
  if (waiting) {
    waiting.textContent = data.waitingForBook ? 'YES' : 'NO';
    waiting.className = 'stat-value ' + (data.waitingForBook ? 'waiting' : '');
  }

  const game = document.getElementById('stat-game');
  if (game) {
    game.textContent = data.gameActive ? 'YES' : 'NO';
    game.className = 'stat-value ' + (data.gameActive ? 'on' : 'off');
  }

  const banner = document.getElementById('pretest-banner');
  const pretestNick = document.getElementById('pretest-nick');
  if (banner && pretestNick) {
    if (data.preTestPending) {
      banner.classList.add('visible');
      pretestNick.textContent = data.preTestPending;
    } else {
      banner.classList.remove('visible');
      pretestNick.textContent = '-';
    }
  }
}

async function sendAction(action) {
  try {
    await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    fetchLive();
    if (action === 'on' || action === 'off') loadConfig();
  } catch {}
}

async function loadHistory() {
  const qs = new URLSearchParams({ page: histPage_, limit: histLimit, search: histSearch_ });
  try {
    const data = await fetch('/api/history?' + qs).then(response => response.json());
    histTotal = data.filtered;
    renderHistory(data.entries, data.filtered, data.total);
  } catch {}
}

function renderHistory(entries, filtered, total) {
  const body = document.getElementById('hist-body');
  const count = document.getElementById('hist-count');
  if (count) count.textContent = filtered + ' / ' + total + ' entries';

  if (!body) return;
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="5" style="color: var(--muted); text-align: center; padding: 20px;">No entries</td></tr>';
    return;
  }

  const badgeClass = { accepted: 'badge badge-accept', rejected: 'badge badge-reject', claimed: 'badge badge-claim' };
  body.innerHTML = entries.map(entry => {
    const time = entry.time ? new Date(entry.time).toLocaleTimeString() : '-';
    const cls = badgeClass[entry.status] || 'badge';
    return '<tr>' +
      '<td class="att-cell">' + esc(entry.attempt || '-') + '</td>' +
      '<td class="nick-cell">' + esc(entry.nick || '') + '</td>' +
      '<td><span class="' + cls + '">' + esc(entry.status || '') + '</span></td>' +
      '<td class="reason-cell">' + esc(entry.reason || '') + '</td>' +
      '<td class="time-cell">' + esc(time) + '</td>' +
      '</tr>';
  }).join('');

  const totalPages = Math.ceil(filtered / histLimit) || 1;
  document.getElementById('pager-label').textContent = 'Page ' + (histPage_ + 1) + ' / ' + totalPages;
  document.getElementById('pager-prev').disabled = histPage_ === 0;
  document.getElementById('pager-next').disabled = (histPage_ + 1) * histLimit >= filtered;
}

function histPage(delta) {
  histPage_ = Math.max(0, histPage_ + delta);
  loadHistory();
}

let histSearchTimer = null;
function histSearch() {
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(() => {
    histSearch_ = document.getElementById('hist-search').value;
    histPage_ = 0;
    loadHistory();
  }, 250);
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
</script>
</body>
</html>`;

module.exports = NickBotWebServer;
