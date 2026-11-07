// Kenway Blacklist Plugin
// Bridges the proxy to Kenway's own externally-hosted blacklist API:
//   - auto-feeds every Urchin tag check into Kenway's database (no key
//     needed - the API server re-verifies against Urchin itself)
//   - lets admin-issued reporter keys submit direct Kenway reports
//     ("/kenway report <player> <reason...>"), reason required, no key = no
//     report, no corroboration threshold
// This plugin talks to the Kenway API over plain HTTP(S) fetch - it does not
// touch Urchin directly itself. It only listens for the 'urchin:tags_checked'
// event the urchin plugin emits, so it has no hard dependency on urchin
// being installed; if urchin isn't loaded, this plugin simply never syncs
// anything and the report/lookup commands still work on their own.

const https = require('https');

module.exports = (api) => {
    api.metadata({
        name: 'kenway',
        displayName: 'Kenway Blacklist',
        prefix: '§5KB',
        version: '1.0.0',
        author: 'Kenway',
        description: 'Syncs Urchin tag hits into Kenway\'s own blacklist and lets keyholders submit direct reports.',
    });

    const kenway = new KenwayBlacklistPlugin(api);

    const configSchema = [
        {
            label: 'Kenway API',
            description: 'The Kenway blacklist API this proxy talks to.',
            defaults: { apiUrl: '', reporterKey: '' },
            settings: [
                { type: 'text', key: 'apiUrl', description: 'Base URL of your hosted Kenway API (e.g. https://kenway.example.com).', placeholder: 'https://kenway.example.com' },
                { type: 'text', key: 'reporterKey', encrypted: true, description: 'Admin-issued reporter key. Required to submit reports with /kenway report - not required to read or auto-sync.', placeholder: 'rk_xxxxxxxx.xxxxxxxx' },
            ],
        },
        {
            label: 'Auto-Sync',
            description: 'Automatically feed Urchin tag checks into Kenway\'s blacklist.',
            defaults: { autoSync: true },
            settings: [
                { type: 'toggle', key: 'autoSync', text: ['OFF', 'ON'], description: 'Feed every player checked by Urchin into Kenway\'s own database.' },
            ],
        },
    ];

    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    api.commands((registry) => {
        registry.command('report')
            .description('Submit a direct report to Kenway\'s blacklist (requires a reporter key)')
            .argument('<player>', 'Player to report')
            .argument('<reason>', { type: 'greedy', description: 'Reason for the report (can be multiple words)' })
            .handler((ctx) => kenway.handleReportCommand(ctx.args.player, ctx.args.reason));

        registry.command('setkey')
            .description('Set your Kenway reporter key')
            .argument('<key>', 'Your admin-issued Kenway reporter key')
            .handler((ctx) => kenway.handleSetKeyCommand(ctx.args.key));

        registry.command('seturl')
            .description('Set the Kenway API base URL')
            .argument('<url>', 'Base URL of your hosted Kenway API')
            .handler((ctx) => kenway.handleSetUrlCommand(ctx.args.url));

        registry.command('lookup')
            .description('Look up what Kenway knows about a player')
            .argument('<player>', 'Player to look up')
            .handler((ctx) => kenway.handleLookupCommand(ctx.args.player));
    });

    kenway.registerHandlers();
    return kenway;
};

class KenwayBlacklistPlugin {
    constructor(api) {
        this.api = api;
        // uuid -> last-synced timestamp, purely to avoid hammering our own
        // API with a /v1/sync call every single time a plugin re-checks the
        // same player within the same lobby (e.g. after a respawn).
        this.recentlySynced = new Map();
        this.SYNC_TTL = 10 * 60 * 1000;
    }

    registerHandlers() {
        // Global event, not gated by `dependencies` - works whether or not
        // this plugin declares a dependency on urchin, and whether or not
        // urchin happens to load before or after this plugin.
        this.api.on('urchin:tags_checked', (event) => this.onUrchinTagsChecked(event));
    }

    getApiUrl() {
        const raw = (this.api.config.get('apiUrl') || '').trim();
        return raw.replace(/\/+$/, '');
    }

    getReporterKey() {
        return (this.api.config.get('reporterKey') || '').trim();
    }

    log(message) {
        this.api.log(message);
    }

    sendError(message) {
        this.api.chat(`${this.getPrefix()} §c${message}`);
    }

    sendSuccess(message) {
        this.api.chat(`${this.getPrefix()} §a${message}`);
    }

    sendInfo(message) {
        this.api.chat(`${this.getPrefix()} §7${message}`);
    }

    getPrefix() {
        return typeof this.api.getPrefix === 'function' ? this.api.getPrefix() : '§5KB';
    }

    // --- Urchin auto-sync -------------------------------------------------

    onUrchinTagsChecked({ uuids }) {
        if (this.api.config.get('autoSync') === false) return;
        const apiUrl = this.getApiUrl();
        if (!apiUrl || !uuids) return;

        const now = Date.now();
        for (const [username, uuid] of Object.entries(uuids)) {
            const last = this.recentlySynced.get(uuid);
            if (last && now - last < this.SYNC_TTL) continue;
            this.recentlySynced.set(uuid, now);

            this.postJson(`${apiUrl}/v1/sync`, { uuid, username }, null).catch((err) => {
                this.api.debugLog(`Kenway: sync failed for ${username}: ${err.message}`);
            });
        }
    }

    // --- Commands -----------------------------------------------------------

    handleSetKeyCommand(key) {
        this.api.config.set('reporterKey', key.trim());
        this.sendSuccess('Kenway reporter key saved.');
    }

    handleSetUrlCommand(url) {
        this.api.config.set('apiUrl', url.trim());
        this.sendSuccess(`Kenway API URL set to ${url.trim()}`);
    }

    async handleReportCommand(player, reasonWords) {
        const apiUrl = this.getApiUrl();
        if (!apiUrl) {
            this.sendError('No Kenway API URL configured. Use "/kenway seturl <url>" first.');
            return;
        }

        const key = this.getReporterKey();
        if (!key) {
            this.sendError('You need a reporter key to submit a report. Ask a Kenway admin for one, then use "/kenway setkey <key>".');
            return;
        }

        const reason = Array.isArray(reasonWords) ? reasonWords.join(' ').trim() : String(reasonWords || '').trim();
        if (!reason) {
            this.sendError('Usage: /kenway report <player> <reason>');
            return;
        }

        this.sendInfo(`Resolving ${player}...`);
        let uuid;
        try {
            uuid = await this.resolveUuid(player);
        } catch (err) {
            this.sendError(`Could not resolve a uuid for ${player}: ${err.message}`);
            return;
        }

        try {
            const result = await this.postJson(`${apiUrl}/v1/report`, { uuid, username: player, reason }, key);
            this.sendSuccess(`Reported ${player} to Kenway's blacklist.`);
            this.api.debugLog(`Kenway: report accepted for ${player} (${uuid}): ${JSON.stringify(result)}`);
        } catch (err) {
            if (err.status === 401) {
                this.sendError('Your reporter key is missing, invalid, or has been revoked.');
            } else if (err.status === 429) {
                this.sendError('You\'re reporting too quickly - slow down and try again shortly.');
            } else {
                this.sendError(`Report failed: ${err.message}`);
            }
        }
    }

    async handleLookupCommand(player) {
        const apiUrl = this.getApiUrl();
        if (!apiUrl) {
            this.sendError('No Kenway API URL configured. Use "/kenway seturl <url>" first.');
            return;
        }

        let uuid;
        try {
            uuid = await this.resolveUuid(player);
        } catch (err) {
            this.sendError(`Could not resolve a uuid for ${player}: ${err.message}`);
            return;
        }

        try {
            const result = await this.getJson(`${apiUrl}/v1/lookup/${uuid}`);
            const urchinTags = Array.isArray(result.urchinTags) ? result.urchinTags : [];
            const reports = Array.isArray(result.kenwayReports) ? result.kenwayReports : [];

            if (urchinTags.length === 0 && reports.length === 0) {
                this.sendInfo(`Kenway has nothing on ${player}.`);
                return;
            }

            if (urchinTags.length > 0) {
                this.api.chat(`${this.getPrefix()} §d${player} §7- Urchin-synced: §f${urchinTags.join(', ')}`);
            }
            for (const report of reports) {
                this.api.chat(`${this.getPrefix()} §d${player} §7- Kenway report: §f${report.reason}`);
            }
        } catch (err) {
            this.sendError(`Lookup failed: ${err.message}`);
        }
    }

    // --- Networking helpers --------------------------------------------------

    async resolveUuid(username) {
        // Prefer the proxy's own live view of who's actually in the lobby -
        // this gets the real uuid even for a nicked player, with no extra
        // network round trip.
        const known = typeof this.api.getPlayerByName === 'function' ? this.api.getPlayerByName(username) : null;
        if (known && known.uuid) return known.uuid;

        // Fall back to Mojang for a player who isn't currently visible
        // (e.g. reporting someone from a previous game).
        return this.usernameToUuidViaMojang(username);
    }

    usernameToUuidViaMojang(username) {
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.mojang.com',
                path: `/users/profiles/minecraft/${encodeURIComponent(username)}`,
                method: 'GET',
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 204 || res.statusCode === 404) {
                        reject(new Error(`Player not found: ${username}`));
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`Mojang API error: ${res.statusCode}`));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && parsed.id) resolve(parsed.id);
                        else reject(new Error('Invalid response from Mojang API'));
                    } catch (err) {
                        reject(new Error(`Failed to parse Mojang response: ${err.message}`));
                    }
                });
            });
            req.on('error', (err) => reject(new Error(`Request failed: ${err.message}`)));
            req.end();
        });
    }

    postJson(url, body, reporterKey) {
        return this.httpRequest('POST', url, body, reporterKey);
    }

    getJson(url) {
        return this.httpRequest('GET', url, null, null);
    }

    httpRequest(method, url, body, reporterKey) {
        return new Promise((resolve, reject) => {
            let parsed;
            try {
                parsed = new URL(url);
            } catch (err) {
                reject(new Error(`Invalid Kenway API URL: ${url}`));
                return;
            }

            const isHttps = parsed.protocol === 'https:';
            const transport = isHttps ? https : require('http');
            const payload = body != null ? JSON.stringify(body) : null;
            const headers = { 'Accept': 'application/json' };
            if (payload) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (reporterKey) headers['X-Kenway-Key'] = reporterKey;

            const req = transport.request({
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                method,
                headers,
                timeout: 10000,
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    let json = null;
                    try { json = data ? JSON.parse(data) : null; } catch (err) { /* fall through with null json */ }

                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        const message = (json && json.error) || `HTTP ${res.statusCode}`;
                        const err = new Error(message);
                        err.status = res.statusCode;
                        reject(err);
                        return;
                    }
                    resolve(json);
                });
            });

            req.on('timeout', () => req.destroy(new Error('Request to Kenway API timed out')));
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }
}
