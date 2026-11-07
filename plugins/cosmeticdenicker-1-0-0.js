// Cosmetic Denicker
// Denicks Bedwars players through TrickAPI (trickapi.duckdns.org/api/bw-denick),
// which searches players by their equipped cosmetics and stats and - unlike a
// plain cosmetics search - filters to players actually seen online recently.
//
// A nick hides the name and skin, not the Bedwars cosmetics. This plugin
// watches what each player's cosmetics produce in game:
//   kill_message      chat wording of their kills
//   kill_effect       particles/sounds where their FINAL kill victims die
//   death_cry         sounds where they die
//   bed_destroy       particles/sounds around them when they break a bed
//   projectile_trail  particles following their arrows/fireballs/eggs/snowballs
//   wood_type         the wood blocks they hold (wood skin)
//   starting_weapon   the sword they hold (golden starting sword)
// plus the lifetime final/bed counts that numbered kill and bed messages leak.
//
// Nothing is hard-coded: every "this sound/particle/wording means that
// cosmetic" link is learned from real players whose equipped cosmetics
// tabalign fetched from the Hypixel API (and from nicks this plugin resolved),
// and saved to data/cosmeticdenicker.data.json so it keeps improving.
// Vanilla effects everyone produces get votes from every cosmetic (including
// "none") and so never qualify; only features that point to one cosmetic do.
//
// For a nick, the cosmetics it is confidently showing plus its numbers are
// sent to TrickAPI's bw-denick; a result is accepted only when exactly one
// player fits, or one clearly fits best on finals/beds. Only the cosmetic
// slots bw-denick filters on (kill message, kill effect, bed destroy) are
// sent; the rest are still learned for the chat alerts. Results go through the
// denicker plugin (alert, tab suffix, tabalign).

const fs = require('fs');
const path = require('path');

const KENWAY_ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(KENWAY_ROOT, 'data', 'cosmeticdenicker.data.json');
// One-time import: the key can be dropped here instead of typed in chat.
const KEY_FILES = ['trick.key.txt', 'trick.key']
    .map((f) => path.join(KENWAY_ROOT, 'config', 'plugins', f));

const API_URL = 'https://trickapi.duckdns.org/api/bw-denick';
// Standard (Level 1) keys allow 30 requests / 5 min with a 10s per-request
// cooldown, so space queries out to stay under it.
const QUERY_SPACING_MS = 10000;
const RATE_LIMIT_BACKOFF_MS = 60000;
// Symmetric margin (kills/beds) bw-denick is told to allow when matching our
// observed numbers against its records.
const STATS_RANGE = 150;
// When several candidates come back, the closest on finals+beds must beat the
// runner-up by this much (summed stat gap) to be accepted.
const MIN_MARGIN = 30;

// Internal category <- prefix of the Hypixel cosmetic value.
const CATEGORY_PREFIXES = [
    ['kill_message', /^killmessages?_/],
    ['kill_effect', /^killeffect_/],
    ['death_cry', /^deathcry_/],
    ['bed_destroy', /^beddestroy_/],
    ['projectile_trail', /^projectiletrail_/],
    ['wood_type', /^woodskin_/],
    ['starting_weapon', /^starting_weapon_/],
];
const CATEGORIES = CATEGORY_PREFIXES.map(([c]) => c);
// What an unset cosmetic means (Hypixel's value names).
const NONE_VALUES = {
    kill_message: 'killmessage_none',
    kill_effect: 'killeffect_none',
    death_cry: 'deathcry_none',
    bed_destroy: 'beddestroy_none',
    projectile_trail: 'projectiletrail_none',
    wood_type: 'woodskin_none',
    starting_weapon: 'starting_weapon_wooden_sword',
};

// bw-denick cosmetic filter keys, for the slots we can both observe in game and
// send with a value that lines up with TrickAPI's namespace. death_cry,
// projectile_trail and starting_weapon aren't bw-denick filters; wood_type is,
// but TrickAPI's value spelling (woodSkin_oak) differs from Hypixel's
// (woodskin_oak_log), so it's kept for alerts only until confirmed.
const QUERY_SLOTS = {
    kill_message: 'kill_messages',
    kill_effect: 'kill_effect',
    bed_destroy: 'bed_destroy',
};
// Where each of those slots appears in a bw-denick result's `cosmetics` object,
// so a resolved match can teach us its real values.
const RESULT_COSMETIC_KEYS = {
    kill_message: 'killmessages',
    kill_effect: 'killeffect',
    bed_destroy: 'beddestroy',
};

// How sure a learned link must be before it counts. Chat wording is clean;
// sounds and particles are noisy, so they need more players behind them.
const LEARN_RULES = {
    kill_message:     { seen: 3, players: 2, share: 0.8 },
    wood_type:        { seen: 3, players: 2, share: 0.8 },
    starting_weapon:  { seen: 3, players: 2, share: 0.8 },
    kill_effect:      { seen: 4, players: 3, share: 0.8 },
    death_cry:        { seen: 4, players: 3, share: 0.8 },
    bed_destroy:      { seen: 4, players: 3, share: 0.8 },
    projectile_trail: { seen: 4, players: 3, share: 0.8 },
};

// Where to look for effects, relative to the chat message (ms) and the spot (blocks).
const CAPTURE = {
    death_cry:   { before: 300, after: 1000, radius: 5, sounds: true, particles: false },
    kill_effect: { before: 300, after: 2500, radius: 6, sounds: true, particles: true },
    bed_destroy: { before: 300, after: 3000, radius: 10, sounds: true, particles: true },
};
const BUFFER_MS = 6000;
const BUFFER_MAX = 6000;

// Projectiles (1.8 object types): arrow, snowball, egg, fireball, small fireball, ender pearl.
const PROJECTILE_TYPES = new Set([60, 61, 62, 63, 64, 65]);
const PROJECTILE_MAX_MS = 6000;
const TRAIL_RADIUS = 1.5;

const WOOD_IDS = new Set([5, 17, 162]);
const SWORD_IDS = new Set([268, 283]); // wooden, golden

// How each category reads in chat.
const CATEGORY_LABELS = {
    kill_message: 'kill message',
    kill_effect: 'final kill effect',
    death_cry: 'death cry',
    bed_destroy: 'bed destroy effect',
    projectile_trail: 'projectile trail',
    wood_type: 'wood skin',
    starting_weapon: 'starting weapon',
};
const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const RANDOM_VALUES = new Set(['random_cosmetic', 'random_favorite_cosmetic']);
// Defaults: everyone has them, so they never narrow a search down.
const isNone = (id) => /_none$/.test(id || '') || id === 'starting_weapon_wooden_sword';

const stripColors = (s) => (s || '').replace(/§[0-9a-fk-or]/gi, '');
const isNickUuid = (uuid) => typeof uuid === 'string' && uuid.replace(/-/g, '')[12] === '1';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const prettyId = (id) => (id || '?').replace(/^(killmessages?|killeffect|deathcry|beddestroy|projectiletrail|woodskin|starting_weapon)_/, '');

// Distance from p to the segment a-b (a projectile's last movement).
function distToSegment(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return dist(p, { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t });
}

function categoryOf(value) {
    for (const [category, re] of CATEGORY_PREFIXES) if (re.test(value)) return category;
    return null;
}

module.exports = (api) => {
    api.metadata({
        name: 'cosmeticdenicker',
        displayName: 'Cosmetic Denicker',
        prefix: '§dCD',
        version: '1.2.0',
        author: 'Kenway',
        description: 'Denicks Bedwars players by their cosmetics (kill messages, final kill effects, bed destroys) and final/bed numbers, via TrickAPI bw-denick.',
        dependencies: [
            { name: 'denicker', minVersion: '1.1.0' }
        ],
    });

    const configSchema = [
        {
            label: 'TrickAPI Key',
            description: 'Your trickapi.duckdns.org key (needs bw-denick access).',
            defaults: { api: { apikey: '' } },
            settings: [
                { type: 'text', key: 'api.apikey', encrypted: true, description: 'Your TrickAPI key.', placeholder: 'API key' }
            ]
        },
        {
            label: 'Cosmetic Alerts',
            description: 'Say in chat which cosmetics a nick is using as they are recognised.',
            defaults: { cosmeticAlerts: { enabled: true } },
            settings: [
                { type: 'toggle', key: 'cosmeticAlerts.enabled', description: 'e.g. "NickName has the TNT final kill effect".' }
            ]
        },
    ];
    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    const plugin = new CosmeticDenicker(api);

    api.commands((registry) => {
        registry.command('setkey')
            .description('Set your TrickAPI key.')
            .argument('<apikey>', 'Your TrickAPI key')
            .handler((ctx) => plugin.setKey(ctx.args.apikey));
        registry.command('status')
            .description('Show what has been learned and the nicks seen this game.')
            .handler(() => plugin.showStatus());
    });

    plugin.registerHandlers();
    plugin.importKeyFile();
    return plugin;
};

class CosmeticDenicker {
    constructor(api) {
        this.api = api;
        this.denicker = this.api.getPluginInstance('denicker');
        this.cosmeticsByName = new Map(); // lowercase name -> { category: value }
        this.nicks = new Map();           // nick name -> evidence for this game
        this.positions = new Map();       // uuid -> [{ t, x, y, z }] recent positions
        this.effects = [];                // recent sounds/particles { t, key, sound, x, y, z }
        this.projectiles = new Map();     // entityId -> { shooter, last, prev, features, t }
        this.heldSeen = new Set();        // `${game}|${name}|${feature}` already counted
        this.queue = [];
        this.queueTimer = null;
        this.blockedUntil = 0;
        this.gameId = 0;
        this.warned = new Set();
        this.data = this.loadData();
        this.saveTimer = null;
    }

    registerHandlers() {
        this.api.on('chat', (e) => this.onChat(e));
        this.api.on('respawn', () => this.resetGame());
        this.api.on('tabalign:player_cosmetics', (e) => this.onPlayerCosmetics(e));
        this.api.on('world_sound', (e) => this.onEffect(e, true));
        // Raw packet: the installed exe's 'world_particle' event never fires
        // (its definition used the wrong 1.8 packet name).
        this.api.on('packet:server:world_particles', (e) => this.onEffect(e && e.data, false));
        this.api.on('entity_move', (e) => this.onEntityMove(e));
        this.api.on('entity_destroy', (e) => this.onEntityDestroy(e));
        this.api.on('packet:server:spawn_entity', (e) => this.onSpawnEntity(e && e.data));
        this.heldTimer = setInterval(() => { try { this.scanHeldItems(); } catch (err) {} }, 1000);
    }

    enabled() { return this.api.config.get('enabled') !== false; }

    // ---- key ---------------------------------------------------------------

    getKey() { return (this.api.config.get('api.apikey') || '').trim(); }

    setKey(key) {
        if (!key || !key.trim()) {
            this.api.chat(`${this.api.getPrefix()} §7Usage: /cosmeticdenicker setkey <your-api-key>`);
            return;
        }
        this.api.config.set('api.apikey', key.trim());
        this.warned.delete('nokey');
        this.warned.delete('badkey');
        this.api.chat(`${this.api.getPrefix()} §aTrickAPI key set.`);
    }

    // Moves a key dropped in config/plugins/trick.key(.txt) into the
    // (encrypted) plugin config, then removes the plain-text file.
    importKeyFile() {
        for (const file of KEY_FILES) {
            let key;
            try { key = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim(); } catch (e) { continue; }
            if (!key) continue;
            this.api.config.set('api.apikey', key);
            if (this.getKey() === key) {
                try { fs.unlinkSync(file); } catch (e) {}
                this.api.log(`Imported the TrickAPI key from ${path.basename(file)} and removed the file.`);
            }
            return;
        }
    }

    // ---- learned data ------------------------------------------------------

    loadData() {
        let d = null;
        try { d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
        if (!d || typeof d !== 'object') d = {};
        if (!d.features) d.features = {};
        // v1 kept only kill message wording, under `templates`.
        if (d.templates) {
            d.features.kill_message = Object.assign(d.features.kill_message || {}, d.templates);
            delete d.templates;
        }
        for (const c of CATEGORIES) if (!d.features[c]) d.features[c] = {};
        d.version = 2;
        return d;
    }

    saveData() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            try {
                fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
                fs.writeFileSync(DATA_FILE, JSON.stringify(this.data));
            } catch (e) {
                this.api.log(`Could not save learned cosmetics: ${e.message}`);
            }
        }, 5000);
    }

    onPlayerCosmetics(e) {
        if (!e || !e.name || !e.cosmetics) return;
        const byCategory = {};
        for (const value of Object.values(e.cosmetics)) {
            if (typeof value !== 'string') continue;
            const category = categoryOf(value);
            if (category) byCategory[category] = value;
        }
        // Hypixel leaves a cosmetic out when nothing is equipped. Counting
        // those players as "none" is what keeps vanilla effects from ever
        // being learned as a cosmetic.
        for (const [category, none] of Object.entries(NONE_VALUES)) {
            if (!byCategory[category]) byCategory[category] = none;
        }
        if (this.cosmeticsByName.size > 5000) this.cosmeticsByName.clear();
        this.cosmeticsByName.set(e.name.toLowerCase(), byCategory);
    }

    // `features` were produced by a player whose `category` cosmetic is `value`.
    learn(category, features, value, playerName) {
        if (!value || RANDOM_VALUES.has(value) || categoryOf(value) !== category) return;
        const table = this.data.features[category];
        const who = playerName.toLowerCase();
        for (const feature of features) {
            const f = table[feature] || (table[feature] = { counts: {}, players: [] });
            f.counts[value] = (f.counts[value] || 0) + 1;
            if (!f.players.includes(who) && f.players.length < 8) f.players.push(who);
        }
        this.saveData();
        for (const [name, nick] of this.nicks) {
            if (nick.done || !nick.features[category]) continue;
            this.announceClues(name, nick);
            this.enqueue(name);
        }
    }

    // The cosmetic a feature points to, once learned confidently.
    decide(category, feature) {
        const f = this.data.features[category][feature];
        const rule = LEARN_RULES[category];
        if (!f || f.players.length < rule.players) return null;
        let total = 0, best = null, bestCount = 0;
        for (const [id, count] of Object.entries(f.counts)) {
            total += count;
            if (count > bestCount) { best = id; bestCount = count; }
        }
        if (total < rule.seen || bestCount / total < rule.share) return null;
        return best;
    }

    // Who produced these features: a real player teaches, a nick collects evidence.
    observe(category, features, playerName, uuid) {
        if (!this.enabled() || !playerName || features.length === 0) return;
        if (!isNickUuid(uuid)) {
            const known = this.cosmeticsByName.get(playerName.toLowerCase());
            if (known && known[category]) this.learn(category, features, known[category], playerName);
            return;
        }
        if (this.denicker.resolvedNicks && this.denicker.resolvedNicks.has(playerName)) return;
        const nick = this.nickEntry(playerName, uuid);
        if (nick.done) return;
        const set = nick.features[category] || (nick.features[category] = new Set());
        const before = set.size;
        for (const f of features) set.add(f);
        if (set.size !== before) {
            this.announceClues(playerName, nick);
            this.enqueue(playerName);
        }
    }

    // "[CD] NickName has the TNT final kill effect" - once per cosmetic per nick per game.
    announceClues(name, nick) {
        if (nick.done || this.api.config.get('cosmeticAlerts.enabled') === false) return;
        const team = this.api.getPlayerTeam(name);
        const shown = (team?.prefix || '§f') + name + '§r';
        for (const [category, id] of Object.entries(this.nickClues(nick))) {
            const key = `${category}:${id}`;
            if (nick.announced.has(key)) continue;
            nick.announced.add(key);
            this.api.chat(`${this.api.getPrefix()} ${shown} §7has the §d${titleCase(prettyId(id))} §7${CATEGORY_LABELS[category]}`);
        }
    }

    nickEntry(name, uuid) {
        let nick = this.nicks.get(name);
        if (!nick) {
            nick = { uuid, features: {}, finals: null, beds: null, lastQuery: null, done: false, announced: new Set() };
            this.nicks.set(name, nick);
        }
        return nick;
    }

    // Cosmetics the nick is confidently showing: one non-"none" answer per category.
    nickClues(nick) {
        const clues = {};
        for (const [category, set] of Object.entries(nick.features)) {
            const ids = new Set();
            for (const feature of set) {
                const id = this.decide(category, feature);
                if (id && !isNone(id)) ids.add(id);
            }
            if (ids.size === 1) clues[category] = [...ids][0];
        }
        return clues;
    }

    // ---- positions, effects, projectiles -----------------------------------

    playerByName(name) { return (this.api.players || []).find((p) => p && p.name === name); }

    onEntityMove(e) {
        if (!e || !e.entity || !e.entity.position) return;
        const now = Date.now();
        const pos = { t: now, x: e.entity.position.x, y: e.entity.position.y, z: e.entity.position.z };
        if (e.isPlayer && e.entity.uuid) {
            const list = this.positions.get(e.entity.uuid) || [];
            list.push(pos);
            while (list.length > 0 && now - list[0].t > 3000) list.shift();
            this.positions.set(e.entity.uuid, list);
            return;
        }
        const proj = this.projectiles.get(e.entity.entityId);
        if (proj) { proj.prev = proj.last; proj.last = pos; }
    }

    // Where a player was just before `t` (their death/teleport comes after).
    positionAt(player, t) {
        const list = (player && this.positions.get(player.uuid)) || [];
        for (let i = list.length - 1; i >= 0; i--) if (list[i].t <= t) return list[i];
        if (list.length) return list[0];
        return player && player.position ? player.position : null;
    }

    onEffect(e, sound) {
        if (!e || !this.enabled()) return;
        const now = Date.now();
        let key;
        if (sound) {
            if (!e.soundName) return;
            key = `s:${e.soundName}`;
        } else {
            key = `p:${e.particleId}`;
            if (Array.isArray(e.data) && e.data.length) key += `#${e.data.join(',')}`;
            // Count 0 means the offsets carry a colour/direction, e.g. coloured dust.
            if (!e.particles) key += `@${[e.offsetX, e.offsetY, e.offsetZ].map((v) => Math.round((v || 0) * 10) / 10).join(',')}`;
        }
        const effect = { t: now, key, sound, x: e.x, y: e.y, z: e.z };
        this.effects.push(effect);
        if (this.effects.length > BUFFER_MAX) this.effects.splice(0, this.effects.length - BUFFER_MAX);
        while (this.effects.length && now - this.effects[0].t > BUFFER_MS) this.effects.shift();

        if (!sound && this.projectiles.size) {
            for (const proj of this.projectiles.values()) {
                if (!proj.last) continue;
                const d = proj.prev ? distToSegment(effect, proj.prev, proj.last) : dist(effect, proj.last);
                if (d <= TRAIL_RADIUS) proj.features.add(key);
            }
        }
    }

    // Collect sounds/particles around `pos` in a window around `t`, once the window has passed.
    captureAround(kind, t, pos, done) {
        const c = CAPTURE[kind];
        if (!pos) return;
        setTimeout(() => {
            const features = new Set();
            for (const e of this.effects) {
                if (e.t < t - c.before || e.t > t + c.after) continue;
                if (e.sound ? !c.sounds : !c.particles) continue;
                if (dist(e, pos) <= c.radius) features.add(e.key);
            }
            done([...features]);
        }, c.after + 50);
    }

    onSpawnEntity(data) {
        if (!data || !PROJECTILE_TYPES.has(data.type) || !this.enabled()) return;
        const pos = { t: Date.now(), x: data.x / 32, y: data.y / 32, z: data.z / 32 };
        // The shooter is the player it spawned next to.
        let shooter = null, best = 3;
        for (const p of this.api.players || []) {
            if (!p || !p.position || p.isCurrentPlayer) continue;
            const d = dist(pos, { x: p.position.x, y: p.position.y + 1.5, z: p.position.z });
            if (d < best) { best = d; shooter = p; }
        }
        if (!shooter) return;
        this.projectiles.set(data.entityId, { shooter: shooter.name, uuid: shooter.uuid, last: pos, prev: null, features: new Set(), t: pos.t });
        setTimeout(() => this.finishProjectile(data.entityId), PROJECTILE_MAX_MS);
    }

    onEntityDestroy(e) {
        const ids = (e && (e.entityIds || (e.entity ? [e.entity.entityId] : []))) || [];
        for (const id of ids) if (this.projectiles.has(id)) this.finishProjectile(id);
    }

    finishProjectile(id) {
        const proj = this.projectiles.get(id);
        if (!proj) return;
        this.projectiles.delete(id);
        this.observe('projectile_trail', [...proj.features], proj.shooter, proj.uuid);
    }

    // Wood skin and starting sword: what each player holds.
    scanHeldItems() {
        if (!this.enabled()) return;
        for (const p of this.api.players || []) {
            const item = p && p.heldItem;
            if (!item || item.blockId == null) continue;
            let category = null;
            if (WOOD_IDS.has(item.blockId)) category = 'wood_type';
            else if (SWORD_IDS.has(item.blockId)) category = 'starting_weapon';
            if (!category) continue;
            const feature = `i:${item.blockId}:${item.itemDamage || 0}`;
            const seenKey = `${this.gameId}|${p.name}|${feature}`;
            if (this.heldSeen.has(seenKey)) continue;
            this.heldSeen.add(seenKey);
            this.observe(category, [feature], p.name, p.uuid);
        }
    }

    // ---- chat --------------------------------------------------------------

    // Turns a kill/death/bed message into a name-free template, e.g.
    // "{P} was squeaked by {P}." / "{P} was {P}'s final #N. [FINAL]".
    parseMessage(raw) {
        let text = stripColors(raw).trim();
        if (!text || text.includes(':')) return null; // player chat, scoreboard lines
        const final = / FINAL KILL!$/.test(text);
        if (final) text = text.replace(/ FINAL KILL!$/, '').trim();

        const names = [...new Set((this.api.players || []).filter((p) => p && p.name).map((p) => p.name))]
            .sort((a, b) => b.length - a.length);
        const spans = [];
        for (const name of names) {
            const re = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g');
            let m;
            while ((m = re.exec(text))) {
                const start = m.index, end = start + name.length;
                if (!spans.some((s) => start < s.end && end > s.start)) spans.push({ start, end, name });
            }
        }
        if (spans.length === 0) return null;
        spans.sort((a, b) => a.start - b.start);

        let template = '';
        let last = 0;
        for (const s of spans) { template += text.slice(last, s.start) + '{P}'; last = s.end; }
        template += text.slice(last);
        const numberMatch = template.match(/#([\d,]+)/);
        const number = numberMatch ? Number(numberMatch[1].replace(/,/g, '')) : null;
        template = template.replace(/#[\d,]+/g, '#N');
        if (final) template += ' [FINAL]';

        const isBed = /\bbed\b/i.test(template) && spans.length === 1;
        if (isBed) return { template, isBed, breaker: spans[0].name, number };
        // Kill messages name the victim then the killer. A one-name message
        // ending in a full stop is a death without a killer ("{P} fell into the void.").
        // Kill messages are sentences; team lists like "Green - A, B" are not.
        if (spans.length >= 2 && !/[.!]$/.test(text)) return null;
        if (spans.length >= 2) return { template, final, victim: spans[0].name, killer: spans[spans.length - 1].name, number };
        if (spans[0].start === 0 && /[.!]$/.test(text) && !/\b(joined|quit|left|reconnected|disconnected)\b/i.test(text)) {
            return { template, final, victim: spans[0].name, killer: null, number };
        }
        return null;
    }

    onChat(event) {
        if (!this.enabled()) return;
        const parsed = this.parseMessage(event.message);
        if (!parsed) return;
        const now = Date.now();

        if (parsed.isBed) {
            const breaker = this.playerByName(parsed.breaker);
            if (!breaker) return;
            if (isNickUuid(breaker.uuid) && parsed.number != null) this.addNumber(breaker, 'beds', parsed.number);
            this.captureAround('bed_destroy', now, this.positionAt(breaker, now),
                (features) => this.observe('bed_destroy', features, breaker.name, breaker.uuid));
            return;
        }

        const victim = this.playerByName(parsed.victim);
        if (victim) {
            const at = this.positionAt(victim, now);
            this.captureAround('death_cry', now, at,
                (features) => this.observe('death_cry', features, victim.name, victim.uuid));
            const killer = parsed.killer && this.playerByName(parsed.killer);
            if (killer && parsed.final) {
                this.captureAround('kill_effect', now, at,
                    (features) => this.observe('kill_effect', features, killer.name, killer.uuid));
            }
        }

        const killer = parsed.killer && this.playerByName(parsed.killer);
        if (!killer) return;
        if (isNickUuid(killer.uuid) && parsed.number != null && parsed.final) this.addNumber(killer, 'finals', parsed.number);
        this.observe('kill_message', [parsed.template], killer.name, killer.uuid);
    }

    addNumber(player, field, value) {
        if (this.denicker.resolvedNicks && this.denicker.resolvedNicks.has(player.name)) return;
        const nick = this.nickEntry(player.name, player.uuid);
        if (nick.done) return;
        if (nick[field] == null || value > nick[field]) {
            const first = nick[field] == null;
            nick[field] = value;
            if (first && this.api.config.get('cosmeticAlerts.enabled') !== false) {
                const team = this.api.getPlayerTeam(player.name);
                this.api.chat(`${this.api.getPrefix()} ${(team?.prefix || '§f') + player.name}§r §7has §d${value.toLocaleString('en-US')} ${field === 'finals' ? 'final kills' : 'beds broken'}`);
            }
            this.enqueue(player.name);
        }
    }

    // ---- querying ----------------------------------------------------------

    enqueue(nickName) {
        if (!this.queue.includes(nickName)) this.queue.push(nickName);
        this.pump();
    }

    pump() {
        if (this.queueTimer || this.queue.length === 0) return;
        const wait = Math.max(0, this.blockedUntil - Date.now());
        this.queueTimer = setTimeout(async () => {
            const nickName = this.queue.shift();
            let queried = false;
            try { queried = await this.tryResolve(nickName); } catch (e) { this.api.debugLog(`Lookup failed for ${nickName}: ${e.message}`); }
            if (queried) this.blockedUntil = Math.max(this.blockedUntil, Date.now() + QUERY_SPACING_MS);
            this.queueTimer = null;
            this.pump();
        }, wait);
    }

    // Returns true when a request was sent.
    async tryResolve(nickName) {
        const nick = this.nicks.get(nickName);
        if (!nick || nick.done) return false;
        const gameId = this.gameId;

        const clues = this.nickClues(nick);
        // Only the cosmetic slots bw-denick actually filters on.
        const params = {};
        let cosmeticCount = 0;
        for (const [category, value] of Object.entries(clues)) {
            const slot = QUERY_SLOTS[category];
            if (!slot) continue;
            params[slot] = value;
            cosmeticCount++;
        }
        let statCount = 0;
        if (nick.finals != null) { params.final_kills = nick.finals; statCount++; }
        if (nick.beds != null) { params.beds_broken = nick.beds; statCount++; }

        // recently-online plus one weak signal still matches far too many
        // players; require at least two independent discriminators.
        if (cosmeticCount + statCount < 2) return false;
        if (statCount > 0) params.stats_range = STATS_RANGE;

        const queryKey = JSON.stringify(params);
        if (queryKey === nick.lastQuery) return false;

        if (!this.getKey()) {
            this.warnOnce('nokey', '§cTrickAPI key not set. Use /cosmeticdenicker setkey <key>');
            return false;
        }
        nick.lastQuery = queryKey;
        const results = await this.query(params);
        if (!results || gameId !== this.gameId || nick.done) return true;

        const match = this.pickCandidate(results, nick);
        this.api.debugLog(`${nickName}: ${queryKey} -> ${results.length} results, ${match ? 'match ' + match.player_name : 'no clear match'}`);
        if (match) this.resolve(nickName, nick, match, clues);
        return true;
    }

    // Exactly one fitting player, or one clearly closest on finals/beds.
    pickCandidate(results, nick) {
        if (!Array.isArray(results)) return null;
        const valid = results.filter((r) => r && r.player_name);
        if (valid.length === 0) return null;
        if (valid.length === 1) return valid[0];

        // Several came back: only disambiguate if we have numbers to rank by.
        if (nick.finals == null && nick.beds == null) return null;
        const scored = valid.map((r) => {
            let gap = 0;
            if (nick.finals != null && typeof r.finals === 'number') gap += Math.abs(nick.finals - r.finals);
            if (nick.beds != null && typeof r.beds === 'number') gap += Math.abs(nick.beds - r.beds);
            return { r, gap };
        }).sort((a, b) => a.gap - b.gap);
        if (scored[1].gap - scored[0].gap < MIN_MARGIN) return null;
        return scored[0].r;
    }

    async query(params) {
        const key = this.getKey();
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
        let res, body;
        try {
            // TrickAPI authenticates with the API-Key header (keeps the key out of the URL).
            res = await fetch(`${API_URL}?${qs}`, {
                headers: { 'API-Key': key, 'User-Agent': 'Kenway-Proxy-Cosmetic-Denick/1.2.0' },
                signal: AbortSignal.timeout(8000)
            });
            body = await res.json().catch(() => null);
        } catch (e) {
            this.api.debugLog(`TrickAPI request failed: ${e.message}`);
            return null;
        }
        if (res.status === 401 || res.status === 403) {
            this.warnOnce('badkey', '§cTrickAPI rejected the key (invalid, or no bw-denick access). Use /cosmeticdenicker setkey <key>');
            return null;
        }
        if (res.status === 429) { this.blockedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS; this.api.debugLog('TrickAPI rate limit hit, pausing'); return null; }
        if (!res.ok || !body || !Array.isArray(body.players)) {
            // Surface the error body: if a cosmetic value's format is wrong, this says so.
            const err = body && (body.error || body.message);
            const msg = err && err.message ? err.message : (err || 'bad response');
            this.api.debugLog(`TrickAPI error ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
            return null;
        }
        return body.players;
    }

    resolve(nickName, nick, match, clues) {
        nick.done = true;
        const realName = match.player_name;
        // The match's real cosmetics teach us everything this nick showed, for
        // the slots whose value namespace lines up with what we learn locally.
        const cos = match.cosmetics || {};
        for (const [category, set] of Object.entries(nick.features)) {
            const key = RESULT_COSMETIC_KEYS[category];
            const value = key && cos[key];
            if (value) this.learn(category, [...set], value, realName);
        }

        const team = this.api.getPlayerTeam(nickName);
        const teamFormattedName = (team?.prefix || '') + nickName + (team?.suffix || '');
        this.denicker.resolvedNicks.set(nickName, realName);
        this.api.emit('denicker:nick_resolved', { nickName, realName, uuid: nick.uuid });
        this.denicker.sendCubelifyMessage(realName);
        this.denicker.sendAlert(teamFormattedName, realName);
        this.denicker.setNickDisplayName(nick.uuid, nickName, realName);
        this.api.debugLog(`Resolved ${nickName} -> ${realName} using ${Object.keys(clues).join(', ') || 'numbers'}`);
    }

    // ---- misc --------------------------------------------------------------

    resetGame() {
        this.gameId++;
        this.nicks.clear();
        this.queue = [];
        this.projectiles.clear();
        this.positions.clear();
        this.heldSeen.clear();
    }

    warnOnce(id, message) {
        if (this.warned.has(id)) return;
        this.warned.add(id);
        this.api.chat(`${this.api.getPrefix()} ${message}`);
    }

    showStatus() {
        const P = this.api.getPrefix();
        this.api.chat(`${P} §7TrickAPI key: ${this.getKey() ? '§aset' : '§cnot set'}`);
        for (const category of CATEGORIES) {
            const table = this.data.features[category];
            const learned = new Set();
            let links = 0;
            for (const feature of Object.keys(table)) {
                const id = this.decide(category, feature);
                if (id && !isNone(id)) { learned.add(id); links++; }
            }
            this.api.chat(`${P} §f${category}§7: §f${learned.size}§7 cosmetics learned (§f${links}§7 signs, §f${Object.keys(table).length}§7 seen)`);
        }
        if (this.nicks.size === 0) this.api.chat(`${P} §7No nicks seen in action this game.`);
        for (const [name, n] of this.nicks) {
            const clues = this.nickClues(n);
            const parts = Object.entries(clues).map(([c, id]) => `${c.replace(/_/g, ' ')} §f${prettyId(id)}§7`);
            if (n.finals != null) parts.push(`finals §f${n.finals}§7`);
            if (n.beds != null) parts.push(`beds §f${n.beds}§7`);
            this.api.chat(`${P} §f${name}§7: ${parts.length ? parts.join(', ') : 'nothing identified yet'}${n.done ? ' §a(resolved)' : ''}`);
        }
    }
}

module.exports.__test = { CosmeticDenicker, isNickUuid, stripColors, distToSegment };
