// NickBot - automatic Hypixel nickname roller
//
// Rebuilt from a screen-recording + a live packet capture of the real /nick
// wizard (2026-09), since the original "brain" plugin that drove
// nickbot-web-server.js was never provided - only the settings UI was.
//
// How Hypixel's /nick wizard actually works (confirmed via packet capture):
//   It is NOT a chest/anvil GUI. The server hands the client a written_book
//   (item id 387) in a hotbar slot via a `set_slot` packet, then immediately
//   sends a `custom_payload` packet on channel `MC|BOpen` to force it open.
//   Every "link" in the book (the underlined lines) is a text run with a
//   clickEvent {action: "run_command", value: "/nick ..."}. Clicking a link
//   in vanilla Minecraft just sends that command as a normal chat packet -
//   so "clicking" a link programmatically is just: send that exact chat
//   message to the server. No inventory-slot clicking involved anywhere.
//
// Observed step-by-step (page text -> the link we care about -> its command):
//   1. "Nicknames allow you to..."              -> "I understand..."   -> /nick help start
//   2. "...choose which RANK..."                -> e.g. MVP+           -> /nick help rank MVP_PLUS
//   3. "...which SKIN..."                       -> e.g. Random skin    -> /nick help skin random
//   4. "...choose the NAME to use..."           -> Use a random name  -> /nick help setrandom
//   5. "We've generated a random username..."   -> USE NAME            -> /nick actuallyset <name> respawn
//                                                   TRY AGAIN           -> /nick help setrandom (same as step 4)
//   6. "You have finished setting up..."        -> (no link, done)
//
// Rerolling (step 5's TRY AGAIN) does NOT restart the whole wizard - it just
// asks for another name on the same page. Hypixel also caps how many rolls
// you get per day; the "Use a random name" / "TRY AGAIN" link's hover text
// says how many rerolls are left ("You can do this Nx more in the next 24
// hours"), which we parse and expose so the bot doesn't hammer a dead end.
//
// Because every step is identified by matching the page's own text (not by
// assuming a fixed order), this keeps working even if Hypixel skips/reorders
// steps for a player who already has nickname history.

'use strict';

const fs = require('fs');
const path = require('path');
const NickBotWebServer = require('./nickbot/nickbot-web-server.js');

const KENWAY_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(KENWAY_ROOT, 'config', 'plugins', 'nickbot.config.json');
const HISTORY_FILE = path.join(KENWAY_ROOT, 'data', 'nickbot-history.jsonl');

// Hypixel doesn't expose a "preferred rank/skin" setting anywhere in the
// config UI that was provided, so these are fixed here instead of guessed
// into the shared config file. Change the tokens below if you want a
// different rank badge or skin while nicked.
//   Rank tokens seen live: NONE, VIP, VIP_PLUS, MVP, MVP_PLUS
//   Skin modes seen live: menu, random, actual, or a dynamic "reuse" link
const PREFERRED_RANK_TOKEN = 'NONE';   // NONE = no rank badge shown while nicked (least conspicuous)
const PREFERRED_SKIN_MODE = 'random';  // 'random' | 'actual' | 'reuse'

const WRITTEN_BOOK_ID = 387;
const LEGACY_REGEX = /^[A-Z][a-z]*([aeiou])\1{2,}[a-z]*$/;

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

function readRawConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function writeRawConfigPatch(patch) {
    const merged = deepMerge(readRawConfig(), patch);
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
    return merged;
}

// Same shape/merge behavior as nickbot-web-server.js's private _readView(),
// duplicated here (rather than reaching into that file) so this plugin
// works against the exact same config file without modifying the UI file.
function readConfig() {
    const raw = readRawConfig();
    const nickBot = raw.nickBot || {};
    const player = raw.player || {};
    const profiles = nickBot.profiles || {};
    const active = deepMerge(DEFAULTS.nickBot.profiles.active, profiles.active || {});
    const passive = deepMerge(DEFAULTS.nickBot.profiles.passive, profiles.passive || {});
    active.switchLobby = 0;

    return {
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

function stripColor(text) {
    return String(text == null ? '' : text).replace(/§./g, '');
}

function runText(run) {
    if (typeof run === 'string') return run;
    if (run && typeof run === 'object') return run.text || '';
    return '';
}

function getBookPageRuns(item) {
    try {
        const pagesNode = item && item.nbtData && item.nbtData.value && item.nbtData.value.pages;
        const rawPages = pagesNode && pagesNode.value && pagesNode.value.value;
        if (!Array.isArray(rawPages) || rawPages.length === 0) return null;
        const parsed = JSON.parse(rawPages[0]);
        return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
}

function pageToPlainText(pageRuns) {
    return stripColor(pageRuns.map(runText).join(''));
}

function collectLinks(pageRuns) {
    const links = [];
    for (const run of pageRuns) {
        if (run && typeof run === 'object' && run.clickEvent && run.clickEvent.action === 'run_command') {
            const hoverValue = run.hoverEvent && run.hoverEvent.value;
            const hoverText = hoverValue && typeof hoverValue === 'object' ? hoverValue.text : hoverValue;
            links.push({
                text: stripColor(runText(run)),
                hover: stripColor(hoverText),
                command: run.clickEvent.value
            });
        }
    }
    return links;
}

function extractGeneratedName(pageRuns) {
    for (const run of pageRuns) {
        if (typeof run === 'string') {
            const m = /^§l(.+?)§r$/.exec(run);
            if (m) return m[1];
        }
    }
    const plains = pageRuns.filter((r) => typeof r === 'string' && r.trim() && r.trim() !== ' ');
    return plains[1] ? stripColor(plains[1]) : null;
}

function extractRerollsRemaining(links) {
    const link = links.find((l) => /randomly generated name/i.test(l.hover));
    if (!link) return null;
    const m = /this (\d+)x more/i.exec(link.hover);
    return m ? parseInt(m[1], 10) : null;
}

function nameMatchesFilters(name, profile) {
    const reasons = [];
    let matched = false;

    const listParts = (value) => String(value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    const anyFilterActive = profile.allowFourLetter || profile.allowFiveLetter || profile.requireTripleVowel
        || profile.legacyRegex
        || listParts(profile.contains).length || listParts(profile.startsWith).length || listParts(profile.endsWith).length;

    if (!anyFilterActive) {
        return { matched: true, reason: 'no filters configured - accepting any name' };
    }

    if (profile.allowFourLetter && name.length === 4) { matched = true; reasons.push('4-letter'); }
    if (profile.allowFiveLetter && name.length === 5) { matched = true; reasons.push('5-letter'); }
    if (profile.requireTripleVowel && /([aeiouAEIOU])\1{2,}/.test(name)) { matched = true; reasons.push('triple vowel'); }
    if (profile.legacyRegex && LEGACY_REGEX.test(name)) { matched = true; reasons.push('legacy regex'); }
    // Note: autoClaimLegacy ("accept names from the built-in legacy list")
    // has no source list anywhere in the files this was rebuilt from, so it
    // is intentionally a no-op here rather than a guessed-at list.

    const lower = name.toLowerCase();
    for (const part of listParts(profile.contains)) if (lower.includes(part)) { matched = true; reasons.push(`contains "${part}"`); }
    for (const part of listParts(profile.startsWith)) if (lower.startsWith(part)) { matched = true; reasons.push(`starts with "${part}"`); }
    for (const part of listParts(profile.endsWith)) if (lower.endsWith(part)) { matched = true; reasons.push(`ends with "${part}"`); }

    return { matched, reason: matched ? reasons.join(', ') : 'no configured filter matched' };
}

class NickBotCore {
    constructor(api) {
        this.api = api;
        this.running = false;
        this.waitingForBook = false;
        this.currentNick = null;
        this.attempts = 0;
        this.rejectStreak = 0;
        this.rerollsRemaining = null;
        this.preTestPending = null;
        this.lastNameLinks = null;
        this.unsub = [];
    }

    registerHandlers() {
        this.unsub.push(this.api.on('inventory_set_slot', (event) => this.handleSlot(event)));

        this.unsub.push(this.api.on('respawn', () => {
            // Dimension change (lobby<->game). If we were mid-wizard, don't
            // leave the bot stuck waiting for a book that's never coming.
            if (this.running || this.waitingForBook) {
                this.api.log('[NickBot] respawn/dimension change - resetting mid-wizard state');
            }
            this.running = false;
            this.waitingForBook = false;
        }));

        // Active mode's "hide the book from your screen" trick needs to
        // cancel these two packets. Some Kenway builds restrict raw
        // interception of certain packets (set_slot has been seen refused as
        // "safe mode read-only" even though it's readable via api.on above) -
        // register each independently and degrade gracefully instead of
        // taking the whole plugin down if one (or both) is refused.
        this.tryIntercept('packet:server:set_slot', (event) => this.maybeHideBook(event));
        this.tryIntercept('packet:server:custom_payload', (event) => this.maybeHideBOpen(event));
    }

    tryIntercept(channel, handler) {
        try {
            this.unsub.push(this.api.intercept(channel, handler));
        } catch (e) {
            this.api.log(`[NickBot] Can't intercept ${channel} on this Kenway build (${e.message}) - Active mode's book-hiding will be partial or unavailable; everything else still works.`);
        }
    }

    cleanup() {
        this.unsub.forEach((fn) => { if (fn) fn(); });
        this.unsub = [];
    }

    // -- config plumbing -----------------------------------------------

    getConfig() {
        return readConfig();
    }

    getActiveProfile(cfg) {
        cfg = cfg || this.getConfig();
        return cfg.nickBot.profiles[cfg.nickBot.mode];
    }

    setEnabled(value) {
        writeRawConfigPatch({ nickBot: { enabled: !!value } });
    }

    persistPlayerNick(nick) {
        try {
            writeRawConfigPatch({ player: { Nick: nick } });
        } catch (e) {
            this.api.log(`[NickBot] Failed to persist nick: ${e.message}`);
        }
    }

    logHistory(entry) {
        try {
            fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
            fs.appendFileSync(HISTORY_FILE, JSON.stringify(Object.assign({ time: Date.now() }, entry)) + '\n');
        } catch (e) {
            this.api.log(`[NickBot] Failed to log history: ${e.message}`);
        }
    }

    getLiveState() {
        const cfg = this.getConfig();
        return {
            enabled: cfg.nickBot.enabled,
            currentNick: this.currentNick,
            attempts: this.attempts,
            waitingForBook: this.waitingForBook,
            gameActive: false, // not reliably detectable from what's exposed - informational only
            preTestPending: this.preTestPending,
            rerollsRemaining: this.rerollsRemaining
        };
    }

    // -- hiding the book in Active mode ---------------------------------

    maybeHideBook(event) {
        const cfg = this.getConfig();
        if (cfg.nickBot.mode !== 'active') return;
        const item = event.data && event.data.item;
        if (item && item.blockId === WRITTEN_BOOK_ID) {
            event.cancel();
        }
    }

    maybeHideBOpen(event) {
        const cfg = this.getConfig();
        if (cfg.nickBot.mode !== 'active') return;
        if (event.data && event.data.channel === 'MC|BOpen') {
            event.cancel();
        }
    }

    // -- driving the wizard ----------------------------------------------

    startCycle() {
        if (this.running) {
            this.api.log('[NickBot] startCycle() called but a cycle is already running - ignoring');
            return;
        }
        this.running = true;
        this.attempts = 0;
        this.rejectStreak = 0;
        this.preTestPending = null;
        this.waitingForBook = true;
        this.api.log('[NickBot] starting cycle - sending /nick');
        const sent = this.api.sendChatToServer('/nick');
        this.api.log(`[NickBot] sendChatToServer('/nick') returned: ${sent}`);
    }

    sendNow(command, extraDelayMs) {
        if (!command) {
            this.api.log('[NickBot] No matching link found on the current page - stuck, cannot proceed');
            return;
        }
        this.waitingForBook = true;
        this.api.log(`[NickBot] will send in ${extraDelayMs || 300}ms: ${command}`);
        setTimeout(() => {
            const sent = this.api.sendChatToServer(command);
            this.api.log(`[NickBot] sent "${command}" -> sendChatToServer returned: ${sent}`);
        }, extraDelayMs || 300);
    }

    sendAfterCooldown(command, profile) {
        const delay = Math.max(250, (profile && profile.cooldown ? profile.cooldown : 1) * 1000);
        this.sendNow(command, delay);
    }

    // The "you can do this Nx more in the next 24 hours" text (only ever
    // shown on the name-source page's link) is about CLAIMING a nickname,
    // not generating one - confirmed with the person who ran this capture:
    // rerolling (TRY AGAIN) is unlimited, only actually claiming (USE NAME)
    // counts against the ~5/day cap. So this counter is purely informational
    // and only decrements when we actually claim, never on a reroll.
    decrementClaimsRemaining() {
        if (typeof this.rerollsRemaining === 'number' && this.rerollsRemaining > 0) {
            this.rerollsRemaining -= 1;
        }
    }

    handleSlot(event) {
        const item = event.item;
        if (!item || item.blockId !== WRITTEN_BOOK_ID) return;
        this.api.log(`[NickBot] got a written-book slot update (slot item blockId=${item.blockId})`);
        const pageRuns = getBookPageRuns(item);
        if (!pageRuns) {
            this.api.log('[NickBot] written book slot arrived but its pages could not be parsed - see raw event in debug log if enabled');
            return;
        }

        this.waitingForBook = false;
        const text = pageToPlainText(pageRuns);
        const links = collectLinks(pageRuns);
        this.api.log(`[NickBot] book page text: "${text.slice(0, 80)}" (${links.length} link(s))`);

        if (text.includes('Nicknames allow you to play with a different username')) {
            this.api.log('[NickBot] -> intro page');
            this.onIntroPage(links);
        } else if (text.includes('which RANK you would like')) {
            this.api.log('[NickBot] -> rank page');
            this.onRankPage(links);
        } else if (text.includes('which SKIN would you like')) {
            this.api.log('[NickBot] -> skin page');
            this.onSkinPage(links);
        } else if (text.includes('choose the NAME to use')) {
            this.api.log('[NickBot] -> name-source page');
            this.onNameSourcePage(links);
        } else if (text.includes("We've generated a random username for you")) {
            this.api.log('[NickBot] -> generated-name page');
            this.onGeneratedNamePage(pageRuns, links);
        } else if (text.includes('You have finished setting up your nickname')) {
            this.api.log('[NickBot] -> finished page');
            this.onFinishedPage(text);
        } else {
            this.api.log(`[NickBot] Unrecognized /nick page - stopping here: ${text.slice(0, 100)}`);
        }
    }

    onIntroPage(links) {
        const link = links.find((l) => /proceed/i.test(l.hover)) || links[0];
        this.sendNow(link && link.command);
    }

    onRankPage(links) {
        const link = links.find((l) => l.command && l.command.trim().endsWith(' ' + PREFERRED_RANK_TOKEN)) || links[0];
        this.sendNow(link && link.command);
    }

    onSkinPage(links) {
        let link = null;
        if (PREFERRED_SKIN_MODE === 'reuse') {
            link = links.find((l) => /^reuse/i.test(l.text));
        }
        if (!link) {
            link = links.find((l) => l.command && l.command.trim().endsWith(' ' + PREFERRED_SKIN_MODE));
        }
        if (!link) link = links[0];
        this.sendNow(link && link.command);
    }

    onNameSourcePage(links) {
        // This is the only page that ever reports the daily claim quota.
        this.rerollsRemaining = extractRerollsRemaining(links);
        const link = links.find((l) => /randomly generated name/i.test(l.hover))
            || links.find((l) => /random/i.test(l.text))
            || links[0];
        this.sendNow(link && link.command);
    }

    onGeneratedNamePage(pageRuns, links) {
        const name = extractGeneratedName(pageRuns);
        const useLink = links.find((l) => /use this name/i.test(l.hover)) || links.find((l) => /USE NAME/i.test(l.text));
        const tryAgainLink = links.find((l) => /generate another name/i.test(l.hover)) || links.find((l) => /TRY AGAIN/i.test(l.text));
        this.lastNameLinks = { useCommand: useLink && useLink.command, tryAgainCommand: tryAgainLink && tryAgainLink.command };
        // Note: this page's own TRY AGAIN link never carries the "Nx more"
        // quota text (confirmed via packet capture) - rerollsRemaining stays
        // whatever onNameSourcePage last captured, decremented locally.

        if (!name) {
            this.api.debugLog('[NickBot] Could not read the generated name from the book page');
            return;
        }

        this.attempts += 1;
        const cfg = this.getConfig();
        const profile = this.getActiveProfile(cfg);

        if (profile.preTest) {
            this.preTestPending = name;
            this.logHistory({ attempt: this.attempts, nick: name, status: 'accepted', reason: 'awaiting manual confirmation (pre-test)' });
            return;
        }

        const { matched, reason } = nameMatchesFilters(name, profile);
        if (matched) {
            this.logHistory({ attempt: this.attempts, nick: name, status: 'accepted', reason });
            this.decrementClaimsRemaining();
            this.sendAfterCooldown(this.lastNameLinks.useCommand, profile);
            return;
        }

        // Rejected - reroll. Retrying is unlimited, so no quota check here.
        this.rejectStreak += 1;
        this.logHistory({ attempt: this.attempts, nick: name, status: 'rejected', reason });
        this.maybeSwitchLobby(profile);
        this.sendAfterCooldown(this.lastNameLinks.tryAgainCommand, profile);
    }

    onFinishedPage(text) {
        const m = /nicked as (.+?)\./.exec(text);
        let nick = null;
        if (m) {
            const tokens = m[1].trim().split(/\s+/);
            nick = tokens[tokens.length - 1];
        }
        this.currentNick = nick;
        this.running = false;
        this.preTestPending = null;
        if (nick) {
            this.logHistory({ attempt: this.attempts, nick, status: 'claimed', reason: 'nickname active' });
            this.persistPlayerNick(nick);
        }
    }

    maybeSwitchLobby(profile) {
        if (!profile.switchLobby || profile.switchLobby <= 0) return;
        if (this.rejectStreak >= profile.switchLobby) {
            this.rejectStreak = 0;
            setTimeout(() => this.api.sendChatToServer('/lobby'), 500);
        }
    }

    // -- actions from the web UI / chat commands -------------------------

    handleAction(action) {
        const cfg = this.getConfig();
        const profile = this.getActiveProfile(cfg);

        if (action === 'on') {
            this.setEnabled(true);
            this.startCycle();
        } else if (action === 'off') {
            this.setEnabled(false);
        } else if (action === 'claim') {
            if (this.preTestPending && this.lastNameLinks && this.lastNameLinks.useCommand) {
                this.logHistory({ attempt: this.attempts, nick: this.preTestPending, status: 'accepted', reason: 'manually confirmed' });
                this.decrementClaimsRemaining();
                this.sendAfterCooldown(this.lastNameLinks.useCommand, profile);
                this.preTestPending = null;
            }
        } else if (action === 'skip') {
            if (this.preTestPending && this.lastNameLinks && this.lastNameLinks.tryAgainCommand) {
                this.logHistory({ attempt: this.attempts, nick: this.preTestPending, status: 'rejected', reason: 'manually skipped' });
                this.sendAfterCooldown(this.lastNameLinks.tryAgainCommand, profile);
                this.preTestPending = null;
            }
        }
    }
}

// Evidence from a live console dump: "[NickBot] Settings UI -> ..." followed
// immediately by "[NickBot] Port 7236 busy - settings UI unavailable" in the
// SAME process run. start() already refuses to bind twice on one object
// (`if (this.server) return;`), so the only way to get a real EADDRINUSE is
// two independent NickBotWebServer objects both calling .listen() - meaning
// this plugin's factory function itself is being invoked more than once in
// one Kenway process (root cause still unconfirmed - maybe a reconnect
// hook, maybe something else - but the fix below is correct either way).
// Keeping the core/web server at module scope (outside the exported
// function) makes them a true singleton: the first factory call creates
// them and binds the port once; every later call just re-points the
// existing core at the newest `api` (so sendChatToServer always targets
// whichever connection is actually alive right now) instead of spinning up
// a second, port-losing, disconnected-from-the-UI instance.
let sharedCore = null;
let sharedWebServer = null;

module.exports = (api) => {
    api.metadata({
        name: 'nickbot',
        displayName: 'NickBot',
        prefix: '§dNB',
        version: '1.0.0',
        author: 'Hexze',
        description: 'Automatically rolls Hypixel nicknames against your filters. Settings UI at http://localhost:7236',
    });

    if (sharedCore) {
        // Re-init: drop the old api's event subscriptions (that connection
        // is gone) and re-register against the new one, reusing the same
        // core state and the same already-bound web server/settings UI.
        sharedCore.cleanup();
        sharedCore.api = api;
        registerCommands(api, sharedCore);
        sharedCore.registerHandlers();
        api.log('[NickBot] plugin re-initialized for a (re)connection - reusing the existing settings UI at http://localhost:7236');
        return { enable: () => {}, disable: () => {} };
    }

    const core = new NickBotCore(api);
    const webServer = new NickBotWebServer();
    sharedCore = core;
    sharedWebServer = webServer;

    webServer.setLiveProvider(() => core.getLiveState());
    webServer.onConfigChange((merged) => {
        const enabled = !!(merged && merged.nickBot && merged.nickBot.enabled);
        api.log(`[NickBot] settings UI: config saved (enabled=${enabled}, bot running=${core.running})`);
        if (enabled && !core.running) {
            core.startCycle();
        }
    });
    webServer.onNickBotAction((action) => {
        api.log(`[NickBot] settings UI: action "${action}"`);
        core.handleAction(action);
    });

    registerCommands(api, core);
    core.registerHandlers();

    // This Kenway build never calls the enable()/disable() lifecycle
    // methods below (checked: nothing in its plugin loader invokes them on
    // any plugin) - every other plugin here only works because its real
    // setup runs directly at load time, so the web server has to start here
    // too rather than waiting for an enable() that will never come.
    webServer.start();
    api.log('[NickBot] settings UI at http://localhost:7236');

    return {
        enable: () => {
            webServer.start();
            api.debugLog('[NickBot] enabled - settings UI at http://localhost:7236');
        },
        disable: () => {
            webServer.stop();
            core.cleanup();
            api.debugLog('[NickBot] disabled');
        }
    };
};

function registerCommands(api, core) {
    api.commands((registry) => {
        registry.command('nickbot')
            .description('Control NickBot: on, off, status, claim, skip')
            .argument('<action>', { type: 'string', description: 'on | off | status | claim | skip' })
            .handler((ctx) => {
                const action = String(ctx.args.action || '').toLowerCase();
                if (action === 'status') {
                    const state = core.getLiveState();
                    api.chat(`§dNB §7enabled: ${state.enabled ? '§ayes' : '§cno'} §8| nick: §f${state.currentNick || '-'} §8| attempts: §f${state.attempts} §8| rerolls left: §f${state.rerollsRemaining == null ? '?' : state.rerollsRemaining}`);
                    return;
                }
                if (!['on', 'off', 'claim', 'skip'].includes(action)) {
                    api.chat('§dNB §cUsage: /nickbot on|off|status|claim|skip');
                    return;
                }
                core.handleAction(action);
            });
    });
}
