
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const https = require('https');

const PIXEL_PADDING_CHAR = '￰';
const DOUBLE_PIXEL_PADDING_CHAR = '￱';
const URCHIN_TAG_TYPES = [
    'account', 'blatant_cheater', 'caution', 'closet_cheater',
    'confirmed_cheater', 'info', 'legit_sniper', 'possible_sniper', 'sniper',
];
const URCHIN_TAG_GLYPHS = Object.fromEntries(URCHIN_TAG_TYPES.map((type, index) => [type, String.fromCharCode(0xffe0 + index)]));

// Cubelify's /v3/cubelify response has no plain "type"/"text" field on a tag -
// its actual shape is { icon, color, tooltip }, where tooltip's first line is
// the human-readable label followed by "(Added by <name> <time> ago)", e.g.
// "Blatant Cheater (Added by 1qmh 3d ago)\n- legit scaff + fastmine". The
// label has to be pulled out of that line so it slugifies back to one of the
// URCHIN_TAG_TYPES keys above (e.g. "blatant_cheater").
function urchinTagLabel(tag) {
    if (!tag) return null;
    const direct = tag.text || tag.type || tag.tag_type || tag.name || tag.label || tag.category;
    if (direct) return String(direct);
    const tooltip = Array.isArray(tag.tooltip) ? tag.tooltip[0] : tag.tooltip;
    if (typeof tooltip !== 'string' || !tooltip.trim()) return null;
    const firstLine = tooltip.split('\n')[0].trim();
    const match = /^(.*?)\s*\(Added by/i.exec(firstLine);
    return (match ? match[1] : firstLine).trim() || null;
}
const SPECIAL_ADVANCES = {
    [PIXEL_PADDING_CHAR]: 1,
    [DOUBLE_PIXEL_PADDING_CHAR]: 2,
    ...Object.fromEntries(Object.values(URCHIN_TAG_GLYPHS).map((glyph) => [glyph, 9])),
};

const ASSET_DIR = path.join(__dirname, 'tabalign');
const VALID_NAME = /^[A-Za-z0-9_]{1,16}$/;

class FontMetrics {
    constructor() {
        const raw = JSON.parse(fs.readFileSync(path.join(ASSET_DIR, 'font-widths.json'), 'utf8'));
        this.WIDTHS = raw.WIDTHS;
        this.UNICODE_ADVANCES = raw.UNICODE_ADVANCES;
    }

    getCharWidth(ch) {
        const w = this.WIDTHS[ch];
        if (w !== undefined) return w;
        return ch.codePointAt(0) > 127 ? 7 : 5;
    }

    getAdvanceWidth(ch) {
        const pad = SPECIAL_ADVANCES[ch];
        if (pad !== undefined) return pad;
        const u = this.UNICODE_ADVANCES[ch];
        if (u !== undefined) return u;
        return this.getCharWidth(ch) + 1;
    }

    getStringWidth(text) {
        if (!text) return 0;
        const chars = Array.from(text);
        let width = 0;
        let bold = false;
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (ch === '§' && i + 1 < chars.length) {
                const code = chars[i + 1].toLowerCase();
                if (code === 'l') bold = true;
                else if (code === 'r') bold = false;
                i++;
                continue;
            }
            const advance = this.getAdvanceWidth(ch);
            width += advance + (bold && advance > 0 ? 1 : 0);
        }
        return width;
    }

    paddingFor(missing) {
        if (missing <= 0) return '';
        return PIXEL_PADDING_CHAR.repeat(Math.max(0, Math.ceil(missing - 1e-9)));
    }

    padRight(text, targetWidth) {
        return text + this.paddingFor(targetWidth - this.getStringWidth(text));
    }

    padLeft(text, targetWidth) {
        return this.paddingFor(targetWidth - this.getStringWidth(text)) + text;
    }
}

class PixelTableLayout {
    constructor(font, rows, labels = [], gaps = [], alignments = []) {
        this.font = font;
        const columnCount = rows.length ? rows[0].length : 0;
        this.gaps = Array.from({ length: columnCount }, (_, column) => gaps[column] ?? '     ');
        this.alignments = Array.from({ length: columnCount }, (_, column) => alignments[column] || 'left');
        this.decimals = Array.from({ length: columnCount }, (_, column) => {
            if (this.alignments[column] !== 'decimal') return null;
            const metrics = rows.map((row) => this.decimalMetrics(row[column] || '')).filter((metric) => metric.numeric);
            return {
                left: Math.max(0, ...metrics.map((metric) => metric.left)),
                right: Math.max(0, ...metrics.map((metric) => metric.right)),
            };
        });
        this.widths = Array.from({ length: columnCount }, (_, column) =>
            Math.max(
                font.getStringWidth(labels[column] || ''),
                this.decimals[column] ? this.decimals[column].left + this.decimals[column].right : 0,
                ...rows.map((row) => font.getStringWidth(row[column] || '')),
            ));
    }

    decimalMetrics(value) {
        const plain = stripColors(value || '');
        const dot = plain.indexOf('.');
        if (dot < 0 || !/^-?\d+\.\d+$/.test(plain)) return { left: 0, right: 0, numeric: false };
        return {
            left: this.font.getStringWidth(plain.slice(0, dot)),
            right: this.font.getStringWidth(plain.slice(dot)),
            numeric: true,
        };
    }

    renderCell(value, column) {
        const width = this.font.getStringWidth(value);
        const missing = this.widths[column] - width;
        if (this.alignments[column] === 'right') {
            return this.font.paddingFor(missing) + value;
        }
        if (this.alignments[column] === 'decimal') {
            const metric = this.decimalMetrics(value);
            if (!metric.numeric) return this.font.paddingFor(missing) + value;
            const decimal = this.decimals[column];
            const extra = this.widths[column] - decimal.left - decimal.right;
            const left = extra + decimal.left - metric.left;
            const right = decimal.right - metric.right;
            return this.font.paddingFor(left) + value + this.font.paddingFor(right);
        }
        return value + this.font.paddingFor(missing);
    }

    leadingPadding(value, column) {
        if (this.alignments[column] === 'right') {
            return this.widths[column] - this.font.getStringWidth(value);
        }
        if (this.alignments[column] === 'decimal') {
            const metric = this.decimalMetrics(value);
            if (!metric.numeric) return this.widths[column] - this.font.getStringWidth(value);
            const decimal = this.decimals[column];
            return this.widths[column] - decimal.left - decimal.right + decimal.left - metric.left;
        }
        return 0;
    }

    include(column, values) {
        const width = Math.ceil(Math.max(0, ...values.map((value) => this.font.getStringWidth(value || ''))));
        this.widths[column] = Math.max(this.widths[column] || 0, width);
    }

    render(cells) {
        const rendered = [];
        for (let column = 0; column < cells.length; column++) {
            const value = cells[column] || '';
            const leadingWidth = this.leadingPadding(value, column);
            const valueWidth = this.font.getStringWidth(value);
            const trailingWidth = this.widths[column] - leadingWidth - valueWidth;
            rendered.push(
                '§r'
                + this.font.paddingFor(leadingWidth)
                + value
                + '§r'
                + this.font.paddingFor(trailingWidth)
                + this.gaps[column],
            );
        }
        return rendered.join('§r');
    }

    renderedStarts(cells) {
        const positions = [];
        let cursor = 0;
        for (let column = 0; column < cells.length; column++) {
            const value = cells[column] || '';
            const rendered = this.renderCell(value, column);
            positions.push(cursor + this.leadingPadding(value, column));
            cursor += this.font.getStringWidth(rendered);
            cursor += this.font.getStringWidth(this.gaps[column]);
        }
        return positions;
    }

    starts() {
        const positions = [];
        let x = 0;
        for (const width of this.widths) {
            positions.push(x);
            x += width + this.font.getStringWidth(this.gaps[positions.length - 1] || '');
        }
        return positions;
    }
}

const GLYPH_ADVANCE_BYTES = {
    [PIXEL_PADDING_CHAR.charCodeAt(0)]: 0x10,
    [DOUBLE_PIXEL_PADDING_CHAR.charCodeAt(0)]: 0x01,
    ...Object.fromEntries(Object.values(URCHIN_TAG_GLYPHS).map((glyph) => [glyph.charCodeAt(0), 0x0f])),
};
const PACK_MCMETA = Buffer.from(
    '{\n  "pack": {\n    "pack_format": 1,\n    "description": "Kenway tab alignment glyphs"\n  }\n}\n'
);
const UNICODE_PAGE_MCMETA = Buffer.from('{"texture":{"blur":false,"clamp":true}}\n');

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function buildZip(entries) {
    const chunks = [], central = [];
    let offset = 0;
    const DOS_TIME = 0, DOS_DATE = 0x0021;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
        chunks.push(local, nameBuf, data);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8);
        cd.writeUInt16LE(0, 10); cd.writeUInt16LE(DOS_TIME, 12); cd.writeUInt16LE(DOS_DATE, 14);
        cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
        cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
        central.push(Buffer.concat([cd, nameBuf]));
        offset += local.length + nameBuf.length + data.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...chunks, centralBuf, eocd]);
}
function buildPackBytes() {
    const patched = Buffer.from(fs.readFileSync(path.join(ASSET_DIR, 'glyph_sizes.bin')));
    for (const [cp, value] of Object.entries(GLYPH_ADVANCE_BYTES)) {
        const idx = Number(cp);
        if (idx >= 0 && idx < patched.length) patched[idx] = value;
    }
    const unicodePage = fs.readFileSync(path.join(ASSET_DIR, 'unicode_page_ff.png'));
    return buildZip([
        { name: 'pack.mcmeta', data: PACK_MCMETA },
        { name: 'assets/minecraft/font/glyph_sizes.bin', data: patched },
        { name: 'assets/minecraft/textures/font/unicode_page_ff.png', data: unicodePage },
        { name: 'assets/minecraft/textures/font/unicode_page_ff.png.mcmeta', data: UNICODE_PAGE_MCMETA },
    ]);
}
class ResourcePackServer {
    constructor() {
        this.packBytes = buildPackBytes();
        this.sha1 = crypto.createHash('sha1').update(this.packBytes).digest('hex');
        this.server = null; this.port = null; this.starting = null;
    }
    static instance() {
        if (!ResourcePackServer._inst) ResourcePackServer._inst = new ResourcePackServer();
        return ResourcePackServer._inst;
    }
    ensureStarted() {
        if (this.server) return Promise.resolve();
        if (this.starting) return this.starting;
        this.starting = new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                res.writeHead(200, {
                    'Content-Type': 'application/zip',
                    'Content-Length': this.packBytes.length,
                    'Content-Disposition': 'attachment; filename="kenway.zip"',
                    'Connection': 'close',
                });
                res.end(this.packBytes);
            });
            server.on('error', reject);
            server.listen(0, '127.0.0.1', () => {
                this.server = server; this.port = server.address().port; resolve();
            });
        });
        return this.starting;
    }
    async url() { await this.ensureStarted(); return `http://127.0.0.1:${this.port}/kenway.zip`; }
}

class StatsProvider {
    constructor(api) {
        this.api = api;
        this.cache = new Map();
        this.inflight = new Map();
        this.TTL = 10 * 60 * 1000;
    }
    getApiKey() { return (this.api.config.get('apiKey') || '').trim(); }

    get(uuid, name, onUpdate) {
        const cached = this.cache.get(uuid);
        if (cached && Date.now() - cached.ts < this.TTL) return cached;
        if (!this.getApiKey()) return cached;
        this.request(uuid).then((res) => {
            if (res && res.ok) {
                this.cache.set(uuid, { ...res.stats, ts: Date.now() });
                // Shared for the cosmetic denicker, which learns kill message
                // wording from real players' equipped cosmetics.
                if (res.stats.cosmetics) this.api.emit('tabalign:player_cosmetics', { uuid, name, cosmetics: res.stats.cosmetics });
                onUpdate && onUpdate();
            }
        }).catch(() => {});
        return cached;
    }

    request(uuid) {
        if (this.inflight.has(uuid)) return this.inflight.get(uuid);
        const key = this.getApiKey();
        if (!key) return Promise.resolve({ ok: false, error: 'no-key' });
        const p = new Promise((resolve) => {
            const req = https.request({
                hostname: 'api.hypixel.net',
                path: `/v2/player?uuid=${uuid.replace(/-/g, '')}`,
                method: 'GET',
                headers: { 'API-Key': key },
            }, (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(body); } catch (e) {}
                    if (res.statusCode === 403) return resolve({ ok: false, error: 'invalid-key', status: 403 });
                    if (res.statusCode === 429) return resolve({ ok: false, error: 'rate-limited', status: 429 });
                    if (!json) return resolve({ ok: false, error: `bad-response (${res.statusCode})` });
                    if (!json.success) return resolve({ ok: false, error: json.cause || 'api-error' });
                    if (!json.player) return resolve({ ok: true, stats: { star: null, fkdr: null, rankColor: '§7', nicked: true } });
                    return resolve({ ok: true, stats: this.extract(json.player) });
                });
            });
            req.on('error', (e) => resolve({ ok: false, error: e.message }));
            req.setTimeout(6000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
            req.end();
        }).finally(() => this.inflight.delete(uuid));
        this.inflight.set(uuid, p);
        return p;
    }

    extract(player) {
        const star = (player.achievements && player.achievements.bedwars_level) || 0;
        const bw = (player.stats && player.stats.Bedwars) || {};
        const fk = bw.final_kills_bedwars || 0;
        const fd = bw.final_deaths_bedwars || 0;
        const fkdr = fd === 0 ? fk : fk / fd;
        const cosmetics = {};
        for (const [k, v] of Object.entries(bw)) {
            if (/^active[A-Z]/.test(k) && typeof v === 'string') cosmetics[k] = v.toLowerCase();
        }
        return { star, fkdr, rankColor: rankColor(player), nicked: false, cosmetics };
    }
}

class BordicProvider {
    constructor(api) {
        this.api = api;
        this.cache = new Map();
        this.inflight = new Map();
        this.TTL = 5 * 60 * 1000;
    }

    getApiKey() { return (this.api.config.get('bordicApiKey') || '').trim(); }

    get(uuid, name, onUpdate) {
        const cached = this.cache.get(uuid);
        if (cached && Date.now() - cached.ts < this.TTL) return cached;
        if (!this.getApiKey()) return cached;
        this.request(uuid).then((res) => {
            if (res && res.ok) {
                this.cache.set(uuid, { ...res.stats, ts: Date.now() });
                onUpdate && onUpdate();
            }
        }).catch(() => {});
        return cached;
    }

    requestJson(resource, uuid) {
        const key = this.getApiKey();
        if (!key) return Promise.resolve({ ok: false, error: 'no-bordic-key' });
        const normalized = uuid.replace(/-/g, '');
        const path = `/api/v2/resources/${resource}?key=${encodeURIComponent(key)}&uuid=${encodeURIComponent(normalized)}`;
        return new Promise((resolve) => {
            const req = https.request({ hostname: 'bordic.xyz', path, method: 'GET' }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    let json;
                    try { json = JSON.parse(body); } catch (err) {
                        return resolve({ ok: false, error: `bad-response (${res.statusCode})` });
                    }
                    if (res.statusCode !== 200 || !json.success) {
                        return resolve({ ok: false, error: json.error || json.message || `http-${res.statusCode}` });
                    }
                    resolve({ ok: true, json });
                });
            });
            req.on('error', (err) => resolve({ ok: false, error: err.message }));
            req.setTimeout(6000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
            req.end();
        });
    }

    request(uuid) {
        if (this.inflight.has(uuid)) return this.inflight.get(uuid);
        const request = Promise.all([
            this.requestJson('cache/hypixel', uuid),
            this.requestJson('winstreak', uuid),
            this.requestJson('ping', uuid),
        ]).then(([hypixel, winstreak, ping]) => {
            if (!hypixel.ok && !winstreak.ok && !ping.ok) {
                return { ok: false, error: hypixel.error || winstreak.error || ping.error };
            }
            const player = hypixel.ok ? hypixel.json.player : null;
            const wsData = winstreak.ok ? winstreak.json.data : null;
            const pingData = ping.ok ? ping.json.data : null;
            return {
                ok: true,
                stats: {
                    ...(player ? this.extractPlayer(player) : { star: null, fkdr: null, rankColor: '§7', nicked: true }),
                    winstreak: wsData ? (wsData.accurate_winstreak ?? wsData.winstreak ?? null) : null,
                    ping: averageRecentPing(pingData),
                },
            };
        }).finally(() => this.inflight.delete(uuid));
        this.inflight.set(uuid, request);
        return request;
    }

    extractPlayer(player) {
        const star = (player.achievements && player.achievements.bedwars_level) || 0;
        const bw = (player.stats && player.stats.Bedwars) || {};
        const fk = bw.final_kills_bedwars || 0;
        const fd = bw.final_deaths_bedwars || 0;
        return {
            star,
            fkdr: fd === 0 ? fk : fk / fd,
            rankColor: rankColor(player),
            nicked: false,
        };
    }
}

class UrchinProvider {
    constructor(api) {
        this.api = api;
        this.cache = new Map();
        this.inflight = new Map();
        this.TTL = 10 * 60 * 1000;
    }

    getApiKey() { return (this.api.config.get('urchinApiKey') || '').trim(); }

    get(uuid, name, onUpdate) {
        const cacheKey = uuid || (name && name.toLowerCase());
        if (!cacheKey) return null;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < this.TTL) return cached.tags;
        if (!this.getApiKey()) return cached ? cached.tags : null;
        this.request(uuid, name).then((result) => {
            if (result.ok) {
                this.cache.set(cacheKey, { tags: result.tags, ts: Date.now() });
                onUpdate && onUpdate();
            }
        }).catch(() => {});
        return cached ? cached.tags : null;
    }

    // Urchin's old lookup-by-name endpoint (urchin.ws/player/<name>) is dead;
    // the working endpoint is Cubelify's uuid-based /v3/cubelify, which
    // returns its generic overlay schema (icon/text/tooltip/color/textColor)
    // rather than raw type/reason fields. "text" is the human-readable tag
    // name (e.g. "Confirmed Cheater"), which slugifies back to the same
    // type keys this plugin's glyph table already knows (e.g.
    // "confirmed_cheater") - see URCHIN_TAG_TYPES above.
    request(uuid, name) {
        const cacheKey = uuid || (name && name.toLowerCase());
        if (!cacheKey) return Promise.resolve({ ok: false, error: 'no-uuid' });
        if (this.inflight.has(cacheKey)) return this.inflight.get(cacheKey);
        const key = this.getApiKey();
        if (!key) return Promise.resolve({ ok: false, error: 'no-urchin-key' });
        if (!uuid) return Promise.resolve({ ok: false, error: 'no-uuid' });
        const request = new Promise((resolve) => {
            const req = https.request({
                hostname: 'api.urchin.gg',
                path: `/v3/cubelify?uuid=${encodeURIComponent(uuid)}&key=${encodeURIComponent(key)}`,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 KenwayProxy-Tabalign/1.1.0'
                },
            }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    if (body === 'Invalid Key' || res.statusCode === 401 || res.statusCode === 403) {
                        return resolve({ ok: false, error: 'invalid-key' });
                    }
                    let json;
                    try { json = JSON.parse(body); } catch (err) {
                        return resolve({ ok: false, error: `bad-response (${res.statusCode})` });
                    }
                    if (res.statusCode !== 200) {
                        return resolve({ ok: false, error: (json && (json.error || json.message)) || `http-${res.statusCode}` });
                    }
                    const rawTags = Array.isArray(json.tags) ? json.tags : [];
                    const tags = rawTags
                        .map((t) => {
                            const label = urchinTagLabel(t);
                            return label
                                ? String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                                : null;
                        })
                        .filter((type) => type && URCHIN_TAG_GLYPHS[type]);
                    resolve({ ok: true, tags: [...new Set(tags)] });
                });
            });
            req.on('error', (err) => resolve({ ok: false, error: err.message }));
            req.setTimeout(6000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
            req.end();
        }).finally(() => this.inflight.delete(cacheKey));
        this.inflight.set(cacheKey, request);
        return request;
    }
}

// Reads from the Kenway blacklist API (a separate, externally-hosted
// service - see kenway-api/) rather than Urchin directly. Deliberately kept
// as a distinct provider/column from UrchinProvider above: Kenway's data is
// either mirrored from Urchin (synced server-side, not re-verified here) or
// a direct community report made through a Kenway reporter key, and neither
// tier should be visually confused with Urchin's own verified tag icons.
class KenwayProvider {
    constructor(api) {
        this.api = api;
        this.cache = new Map();
        this.inflight = new Map();
        this.TTL = 5 * 60 * 1000;
    }

    getApiUrl() { return (this.api.config.get('kenwayApiUrl') || '').trim().replace(/\/+$/, ''); }

    // Returns { urchinTags: [...], kenwayReports: [...] } or null if nothing
    // is cached yet / the feature isn't configured.
    get(uuid, onUpdate) {
        if (!uuid) return null;
        const cached = this.cache.get(uuid);
        if (cached && Date.now() - cached.ts < this.TTL) return cached.data;
        if (!this.getApiUrl()) return cached ? cached.data : null;
        this.request(uuid).then((result) => {
            if (result.ok) {
                this.cache.set(uuid, { data: result.data, ts: Date.now() });
                onUpdate && onUpdate();
            }
        }).catch(() => {});
        return cached ? cached.data : null;
    }

    request(uuid) {
        if (this.inflight.has(uuid)) return this.inflight.get(uuid);
        const apiUrl = this.getApiUrl();
        if (!apiUrl) return Promise.resolve({ ok: false, error: 'no-api-url' });

        let parsed;
        try {
            parsed = new URL(`${apiUrl}/v1/lookup/${uuid}`);
        } catch (err) {
            return Promise.resolve({ ok: false, error: 'bad-api-url' });
        }
        const transport = parsed.protocol === 'https:' ? https : http;

        const request = new Promise((resolve) => {
            const req = transport.request({
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    if (res.statusCode !== 200) return resolve({ ok: false, error: `http-${res.statusCode}` });
                    try {
                        const json = JSON.parse(body);
                        resolve({
                            ok: true,
                            data: {
                                urchinTags: Array.isArray(json.urchinTags) ? json.urchinTags : [],
                                kenwayReports: Array.isArray(json.kenwayReports) ? json.kenwayReports : [],
                            },
                        });
                    } catch (err) {
                        resolve({ ok: false, error: 'bad-response' });
                    }
                });
            });
            req.on('error', (err) => resolve({ ok: false, error: err.message }));
            req.setTimeout(6000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
            req.end();
        }).finally(() => this.inflight.delete(uuid));
        this.inflight.set(uuid, request);
        return request;
    }
}

// Plain color + bracket markers, not resource-pack glyphs - Kenway's tiers
// deliberately don't reuse Urchin's custom icon imagery (URCHIN_TAG_GLYPHS
// above), so a player can tell at a glance which system flagged someone even
// without the resource pack applied.
function formatKenwayTags(data) {
    if (!data) return '';
    const urchinCount = Array.isArray(data.urchinTags) ? data.urchinTags.length : 0;
    const reportCount = Array.isArray(data.kenwayReports) ? data.kenwayReports.length : 0;
    if (urchinCount === 0 && reportCount === 0) return '';
    let cell = '';
    if (urchinCount > 0) cell += '§5[U]';
    if (reportCount > 0) cell += `§d[K${reportCount > 1 ? `×${reportCount}` : ''}]`;
    return cell;
}

function averageRecentPing(entries) {
    if (!Array.isArray(entries)) return null;
    const recent = entries
        .filter((entry) => entry && Number.isFinite(Number(entry.avg)))
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, 30);
    if (!recent.length) return null;
    return Math.round(recent.reduce((sum, entry) => sum + Number(entry.avg), 0) / recent.length);
}

function formatUrchinTags(tags) {
    if (!Array.isArray(tags)) return '§8…';
    if (!tags.length) return '';
    return `§f${tags.map((type) => URCHIN_TAG_GLYPHS[type] || '').join('')}`;
}

const PRESTIGE_COLORS = ['7', 'f', '6', 'b', '2', '3', '4', 'd', '9', '5'];
function starSymbol(star) {
    if (star < 1000) return '✫';
    if (star < 2000) return '✪';
    if (star < 3000) return '⚝';
    return '✥';
}
function formatStar(star) {
    const color = PRESTIGE_COLORS[Math.floor(star / 100)] || 'c';
    return `§7[§${color}${star}${starSymbol(star)}§7]`;
}
function fkdrColor(fkdr) {
    if (fkdr < 1) return '7';
    if (fkdr < 3) return 'f';
    if (fkdr < 5) return 'e';
    if (fkdr < 10) return '6';
    if (fkdr < 25) return 'c';
    return '4';
}
function formatFkdr(fkdr) {
    return `§${fkdrColor(fkdr)}${(Math.round(fkdr * 100) / 100).toFixed(2)}`;
}
function leadingFormatting(text) {
    const match = /^((?:§.)*)/.exec(text || '');
    return match ? match[1] : '';
}
function fkdrParts(text) {
    const plain = stripColors(text);
    const match = /^(\d+)\.(\d+)$/.exec(plain);
    return match ? { formatting: leadingFormatting(text), integer: match[1], fraction: match[2] } : null;
}
function alignFkdr(text, font, integerWidth, fractionWidth, fallbackWidth) {
    const parts = fkdrParts(text);
    if (!parts) return font.padLeft(text, fallbackWidth);
    const left = font.paddingFor(integerWidth - font.getStringWidth(parts.integer));
    const right = font.paddingFor(fractionWidth - font.getStringWidth(parts.fraction));
    return `${left}${parts.formatting}${parts.integer}.${parts.fraction}${right}`;
}
function formatWinstreak(value) {
    if (!Number.isFinite(Number(value))) return '§7-';
    const winstreak = Math.trunc(Number(value));
    if (winstreak === 0) return '';
    const color = winstreak <= 10 ? '7' : winstreak < 30 ? 'e' : 'c';
    return `§${color}${winstreak}`;
}
function pingColor(value) {
    if (value <= 100) return 'a';
    if (value <= 180) return 'e';
    return 'c';
}
function formatHistoricalPing(value) {
    if (!Number.isFinite(Number(value))) return '§7-';
    const ping = Math.round(Number(value));
    return ping === 0 ? '' : `§${pingColor(ping)}${ping}`;
}
function rankColor(player) {
    const r = player.rank && player.rank !== 'NORMAL' ? player.rank : null;
    if (r === 'ADMIN' || r === 'OWNER') return '§c';
    if (r === 'GAME_MASTER' || r === 'MODERATOR') return '§2';
    if (r === 'HELPER') return '§9';
    if (r === 'YOUTUBER') return '§c';
    if (player.monthlyPackageRank === 'SUPERSTAR') return '§6';
    const pkg = player.newPackageRank || player.packageRank;
    if (pkg === 'MVP_PLUS' || pkg === 'MVP') return '§b';
    if (pkg === 'VIP_PLUS' || pkg === 'VIP') return '§a';
    return '§7';
}
function stripColors(str) {
    return typeof str === 'string' ? str.replace(/§./g, '') : '';
}
function teamColor(prefix) {
    const matches = typeof prefix === 'string' ? prefix.match(/§[0-9a-f]/gi) : null;
    return matches && matches.length ? matches[matches.length - 1] : '§7';
}
function componentText(component) {
    if (typeof component === 'string') return component;
    if (Array.isArray(component)) return component.map(componentText).join('');
    if (!component) return '';
    return (component.text || '') + (Array.isArray(component.extra) ? component.extra.map(componentText).join('') : '');
}

function compactTabFooter(raw) {
    let text = '';
    try { text = stripColors(componentText(JSON.parse(raw))); } catch (err) { return JSON.stringify({ text: '' }); }
    const match = /Kills:\s*(\d+)\s+Final Kills:\s*(\d+)\s+Beds Broken:\s*(\d+)/i.exec(text.replace(/\s+/g, ' '));
    if (!match) return JSON.stringify({ text: '' });
    return JSON.stringify({ text: `§bKills: §e${match[1]} §bFinal Kills: §e${match[2]} §bBeds Broken: §e${match[3]}` });
}

function offlineUuid(name) {
    const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidVersion(uuid) {
    const hex = typeof uuid === 'string' ? uuid.replace(/-/g, '').toLowerCase() : '';
    if (!/^[0-9a-f]{32}$/.test(hex)) return null;
    return Number.parseInt(hex[12], 16);
}

function respawnUuid(name) {
    const bytes = crypto.createHash('md5').update(`KenwayRespawn:${name}`, 'utf8').digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isVisiblePlayerUuid(uuid) {
    const version = uuidVersion(uuid);
    return version === 1 || version === 4;
}

function killVictim(message, knownPlayers) {
    if (!message || message.includes('FINAL KILL!') || message.endsWith(' disconnected.') || message.endsWith(' reconnected.')) return null;
    const match = /^([A-Za-z0-9_]{1,16}) (?:was |fell |died |slipped |tripped |got |lost |met |walked |howled |caught |played |stepped |didn't |'s heart )/.exec(message);
    return match && knownPlayers.has(match[1]) ? match[1] : null;
}

class TabAlign {
    constructor(api) {
        this.api = api;
        this.font = new FontMetrics();
        this.packServer = ResourcePackServer.instance();
        this.stats = new StatsProvider(api);
        this.bordic = new BordicProvider(api);
        this.urchin = new UrchinProvider(api);
        this.kenway = new KenwayProvider(api);

        this.proxy = null;
        this.sentPack = false;
        this.inBedwars = false;
        this.inPregame = false;
        this.gameStarted = false;
        this.sawInGameMessage = false;
        this.overridden = new Set();
        this.knownPlayers = new Map();
        this.playerGamemodes = new Map();
        this.hiddenPlayerEntries = new Map();
        this.lastTeamPrefixes = new Map();
        this.denicks = new Map(); // nick -> real name, from denicker / numdenicker
        this.recentlyRespawned = new Map();
        this.respawns = new Map();
        this.renderTimer = null;
        this.lastTabFooter = JSON.stringify({ text: '' });

        this.game = {};
        this.awaitingLocraw = false;
        this.locrawRetries = 0;
        this._locrawTimeout = null;
    }

    registerHandlers() {
        this.api.on('player_join', (e) => this.onPlayerJoin(e));
        this.api.on('player_info', (e) => this.onPlayerInfo(e));
        this.api.on('respawn', (e) => this.onRespawn(e));
        this.api.on('denicker:nick_resolved', (e) => this.onNickResolved(e));
        this.api.intercept('packet:server:player_info', (e) => this.onRawPlayerInfo(e));
        this.api.intercept('packet:server:named_entity_spawn', (e) => this.onNamedEntitySpawn(e));
        this.api.intercept('packet:server:playerlist_header', (e) => this.onPlayerlistHeader(e));
        this.api.intercept('packet:server:chat', (e) => this.onServerChat(e));
        this.packServer.ensureStarted().catch((err) =>
            this.api.log(`Resource pack server failed to start: ${err.message}`));
    }

    captureProxy(e) { if (e && e.api && e.api.proxy) this.proxy = e.api.proxy; }

    onPlayerJoin(e) {
        this.captureProxy(e);
        this.inBedwars = false;
        this.inPregame = false;
        this.gameStarted = false;
        this.sawInGameMessage = false;
        this.clearRespawns();
        this.overridden.clear();
        this.knownPlayers.clear();
        this.playerGamemodes.clear();
        this.hiddenPlayerEntries.clear();
        this.lastTeamPrefixes.clear();
        this.denicks.clear();
        this.recentlyRespawned.clear();
        this.game = {};
        this.locrawRetries = 0;
        if (this.api.config.get('resourcePack') !== false) {
            setTimeout(() => this.sendResourcePack(true), 2500);
        }
        setTimeout(() => this.sendLocraw(), 1500);
    }

    // Denicked players show as "Nick (RealName)" with the real name in purple.
    onNickResolved(e) {
        if (!e || !e.nickName || !e.realName) return;
        this.denicks.set(e.nickName, e.realName);
        if (this.inBedwars || this.inPregame) this.scheduleRender();
    }

    onRespawn(e) {
        this.captureProxy(e);
        this.overridden.clear();
        this.inBedwars = false;
        this.inPregame = false;
        this.gameStarted = false;
        this.sawInGameMessage = false;
        this.clearRespawns();
        this.knownPlayers.clear();
        this.playerGamemodes.clear();
        this.hiddenPlayerEntries.clear();
        this.lastTeamPrefixes.clear();
        this.denicks.clear();
        this.recentlyRespawned.clear();
        this.locrawRetries = 0;
        setTimeout(() => this.sendLocraw(), 300);
    }

    sendLocraw() {
        if (!this.proxy || !this.proxy.currentPlayer || !this.proxy.currentPlayer.targetClient) return;
        this.awaitingLocraw = true;
        clearTimeout(this._locrawTimeout);
        this._locrawTimeout = setTimeout(() => { this.awaitingLocraw = false; }, 5000);
        this.api.sendChatToServer('/locraw');
    }

    onServerChat(e) {
        const raw = e.data && e.data.message;
        if (!raw) return;
        let text;
        try { text = componentText(JSON.parse(raw)).trim(); } catch (err) { return; }

        const plain = stripColors(text).trim();
        const provesInGame = (
            plain.includes('Protect your bed and destroy the enemy bed') ||
            plain === 'You will respawn in 10 seconds!' ||
            plain === 'Your bed was destroyed so you are a spectator!' ||
            /^([A-Za-z0-9_]{1,16}) reconnected\.$/.test(plain)
        );
        if (provesInGame) this.sawInGameMessage = true;
        if (this.isBedwarsMode() && !this.gameStarted && provesInGame) {
            this.gameStarted = true;
            this.setActive(true, `Bedwars game-start message mode=${this.game.mode}`);
        }
        this.updatePregame();
        if (this.inBedwars) {
            const victim = killVictim(plain, this.knownPlayers);
            if (victim) this.startRespawn(victim, 5);
            const reconnect = /^([A-Za-z0-9_]{1,16}) reconnected\.$/.exec(plain);
            if (reconnect && this.knownPlayers.has(reconnect[1])) this.startRespawn(reconnect[1], 10);
        }

        if (!text.startsWith('{') || !text.endsWith('}')) return;
        let game;
        try { game = JSON.parse(text); } catch (err) { return; }
        if (!('server' in game) && !('gametype' in game) && !('lobbyname' in game)) return;

        // Always hide raw locraw-shaped JSON from chat, even if we weren't
        // the one awaiting it. Other bundled plugins (bw-utilities-core)
        // independently poll /locraw on every world change too, and since
        // packet interceptors don't consume events from each other, each
        // plugin only clears its own awaiting-flag - without this, a second
        // /locraw response (triggered by the other plugin) would sail
        // through uncancelled and show up as raw JSON garbage in chat.
        e.cancel();

        if (!this.awaitingLocraw) return;

        if (game.server === 'limbo' || text.includes('limbo')) {
            if (this.locrawRetries < 5) { this.locrawRetries++; setTimeout(() => this.sendLocraw(), 200); }
            return;
        }

        clearTimeout(this._locrawTimeout);
        this.awaitingLocraw = false;
        this.locrawRetries = 0;
        this.game = game;
        this.gameStarted = this.isBedwarsMode() && this.sawInGameMessage;
        this.setActive(this.gameStarted, `locraw gametype=${game.gametype || '?'} mode=${game.mode || '?'} started=${this.gameStarted}`);
        this.updatePregame();
    }

    // The pre-game waiting lobby is a Bedwars game server before the start
    // message (isBedwarsMode but not gameStarted). Render the overlay there
    // too when enabled, without marking the game active (no respawn timers,
    // no bedwars:active for other plugins).
    updatePregame() {
        const want = this.api.config.get('pregameLobby') !== false
            && this.isBedwarsMode() && !this.gameStarted;
        if (want === this.inPregame) return;
        this.inPregame = want;
        if (want) this.scheduleRender();
        else if (!this.inBedwars) this.restoreAll();
    }

    onPlayerInfo(e) {
        this.captureProxy(e);
        for (const player of e.players || []) {
            if (e.action === 0 && player.name && VALID_NAME.test(player.name)) {
                this.knownPlayers.set(player.name, { uuid: player.uuid, name: player.name });
                this.finishRespawn(player.name);
            }
        }
        if (this.inBedwars || this.inPregame) this.scheduleRender();
    }

    onRawPlayerInfo(e) {
        const packet = e.data;
        if (!packet || !Array.isArray(packet.data)) return;
        if (packet.action === 3 && (this.inBedwars || this.inPregame)) {
            e.cancel();
            this.scheduleRender();
        }
        if (packet.action === 0 || packet.action === 1) {
            for (const player of packet.data) {
                if (player.UUID && Number.isInteger(player.gamemode)) {
                    this.playerGamemodes.set(player.UUID, player.gamemode);
                }
            }
        }

        for (const player of packet.data) {
            const uuid = player.UUID;
            if (!uuid) continue;
            if (packet.action === 0 && !isVisiblePlayerUuid(uuid)) {
                this.hiddenPlayerEntries.set(uuid, { ...player });
                setTimeout(() => this.hidePlayerFromTab(uuid), 50);
            } else if (this.hiddenPlayerEntries.has(uuid) && packet.action >= 1 && packet.action <= 3) {
                const cached = this.hiddenPlayerEntries.get(uuid);
                if (packet.action === 1) cached.gamemode = player.gamemode;
                if (packet.action === 2) cached.ping = player.ping;
                if (packet.action === 3) cached.displayName = player.displayName;
            } else if (packet.action === 4) {
                this.playerGamemodes.delete(uuid);
                this.hiddenPlayerEntries.delete(uuid);
            }
        }
    }

    hidePlayerFromTab(uuid) {
        if (this.hiddenPlayerEntries.has(uuid)) this.api.sendPlayerInfo(4, [{ UUID: uuid }]);
    }

    onNamedEntitySpawn(e) {
        const uuid = e.data && e.data.playerUUID;
        const cached = uuid && this.hiddenPlayerEntries.get(uuid);
        if (!cached) return;
        this.api.sendPlayerInfo(0, [{ ...cached }]);
        setTimeout(() => this.hidePlayerFromTab(uuid), 50);
    }

    onPlayerlistHeader(e) {
        if (!e.data) return;
        this.lastTabFooter = e.data.footer;
        if (!this.inBedwars) return;
        e.modify({
            ...e.data,
            header: JSON.stringify({ text: '' }),
            footer: compactTabFooter(e.data.footer),
        });
    }

    isBedwarsMode() {
        return this.game.gametype === 'BEDWARS'
            && typeof this.game.mode === 'string'
            && this.game.mode.length > 0
            && this.game.mode !== '?'
            && !this.game.lobbyname;
    }

    setActive(active, reason) {
        active = Boolean(active && this.isBedwarsMode() && this.gameStarted);
        const changed = active !== this.inBedwars;
        this.inBedwars = active;
        if (changed) this.api.debugLog(`tabalign ${active ? 'ACTIVE' : 'inactive'} (${reason})`);

        // Broadcast this globally (not gated by any plugin's `dependencies`)
        // so other plugins can tell whether we're in an active Bedwars game
        // without reimplementing /locraw tracking. (anticheat used to listen
        // for this; it now tracks /locraw itself so it works without
        // tabalign.) Deliberately emitted EVERY call, not just on change:
        // the very first /locraw result after connecting arrives while
        // inBedwars is still at its initial `false`, so emitting only on
        // change would leave listeners with no answer at all until a first
        // real game. Always emitting means a listener always gets a real,
        // current answer rather than depending on a prior transition.
        try {
            this.api.emit('bedwars:active', { active, reason });
        } catch (err) {
            this.api.debugLog(`tabalign: bedwars:active listener threw: ${err.message}`);
        }

        if (active) {
            if (changed) this.sendCompactHeader();
            this.scheduleRender();
        } else if (changed) {
            this.restoreAll();
        }
    }

    sendCompactHeader() {
        const client = this.proxy && this.proxy.currentPlayer && this.proxy.currentPlayer.client;
        if (!client) return;
        client.write('playerlist_header', {
            header: JSON.stringify({ text: '' }),
            footer: compactTabFooter(this.lastTabFooter),
        });
    }

    startRespawn(name, duration) {
        if (!this.inBedwars || !this.knownPlayers.has(name)) return;
        const currentTeam = this.api.getPlayerTeam(name);
        if (currentTeam && currentTeam.prefix) this.lastTeamPrefixes.set(name, currentTeam.prefix);
        this.finishRespawn(name);
        const real = this.knownPlayers.get(name);
        const syntheticUuid = respawnUuid(name);
        const state = { syntheticUuid, seconds: duration, timer: null };
        this.respawns.set(name, state);

        this.api.sendPlayerInfo(4, [{ UUID: real.uuid }]);
        this.api.sendPlayerInfo(0, [{
            UUID: syntheticUuid,
            name,
            properties: [],
            gamemode: 3,
            ping: 0,
            displayName: JSON.stringify({ text: `§6§l${duration}s §7${name}` }),
        }]);
        this.scheduleRender();
        state.timer = setInterval(() => {
            if (!this.inBedwars || !this.respawns.has(name)) return this.finishRespawn(name);
            state.seconds--;
            if (state.seconds <= 0) return this.finishRespawn(name);
            this.scheduleRender();
        }, 1000);
    }

    finishRespawn(name) {
        const state = this.respawns.get(name);
        if (!state) return;
        clearInterval(state.timer);
        this.api.sendPlayerInfo(4, [{ UUID: state.syntheticUuid }]);
        this.overridden.delete(state.syntheticUuid);
        this.respawns.delete(name);
        const expiry = Date.now() + 3000;
        this.recentlyRespawned.set(name, expiry);
        setTimeout(() => {
            if (this.recentlyRespawned.get(name) === expiry) {
                this.recentlyRespawned.delete(name);
                this.scheduleRender();
            }
        }, 3000);
        this.scheduleRender();
    }

    clearRespawns() {
        for (const name of Array.from(this.respawns.keys())) this.finishRespawn(name);
    }

    async sendResourcePack(auto) {
        if (auto && this.sentPack) return false;
        if (this.api.config.get('resourcePack') === false) return false;
        const client = this.proxy && this.proxy.currentPlayer && this.proxy.currentPlayer.client;
        if (!client) return false;
        try {
            const url = await this.packServer.url();
            client.write('resource_pack_send', { url, hash: this.packServer.sha1 });
            this.sentPack = true;
            return true;
        } catch (err) {
            this.api.log(`Failed to send resource pack: ${err.message}`);
            return false;
        }
    }

    scheduleRender() {
        if (this.renderTimer) return;
        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            try { this.render(); } catch (e) { this.api.log(`render error: ${e.message}`); }
        }, 150);
    }

    tabPlayers() {
        const players = (this.api.players || []).filter((p) =>
            p && p.uuid && p.name && VALID_NAME.test(p.name) && isVisiblePlayerUuid(p.uuid));
        const byName = new Map(players.map((p) => [p.name, p]));
        for (const [name, state] of this.respawns) {
            const known = this.knownPlayers.get(name);
            byName.set(name, { uuid: state.syntheticUuid, name, respawning: true, realUuid: known && known.uuid });
        }
        return Array.from(byName.values());
    }

    render() {
        if (!this.inBedwars && !this.inPregame && !this.forceRender) return;

        const showStar = this.api.config.get('showStar') !== false;
        const showFkdr = this.api.config.get('showFkdr') !== false;
        const showWinstreak = this.api.config.get('showWinstreak') !== false;
        const showHistoricalPing = this.api.config.get('showHistoricalPing') !== false;
        const showUrchinTags = this.api.config.get('showUrchinTags') !== false;
        const showKenwayTags = this.api.config.get('showKenwayTags') !== false;
        const useBordicStats = this.api.config.get('useBordicStats') === true;
        const align = this.api.config.get('alignColumns') !== false;
        const players = this.tabPlayers();
        if (players.length === 0) return;

        const onUpdate = () => this.scheduleRender();
        const rows = players.map((p) => {
            const statsProvider = useBordicStats ? this.bordic : this.stats;
            const s = statsProvider.get(p.realUuid || p.uuid, p.name, onUpdate);
            const bordic = this.bordic.get(p.realUuid || p.uuid, p.name, onUpdate);
            const urchinTags = showUrchinTags ? this.urchin.get(p.realUuid || p.uuid, p.name, onUpdate) : [];
            const kenwayData = showKenwayTags ? this.kenway.get(p.realUuid || p.uuid, onUpdate) : null;
            const team = this.api.getPlayerTeam(p.name);
            const inRespawnGrace = (this.recentlyRespawned.get(p.name) || 0) > Date.now();
            const livePrefix = team ? team.prefix : '';
            const prefix = (p.respawning || inRespawnGrace) && this.lastTeamPrefixes.has(p.name)
                ? this.lastTeamPrefixes.get(p.name)
                : livePrefix;
            const nameColor = teamColor(prefix);
            const realUuid = p.realUuid || p.uuid;
            const info = this.api.getPlayerInfo(realUuid);
            const gamemode = this.playerGamemodes.get(realUuid) ?? (info && info.gamemode);
            const spectator = !p.respawning && !inRespawnGrace && gamemode === 3;
            if (!p.respawning && !spectator && livePrefix) this.lastTeamPrefixes.set(p.name, livePrefix);
            const starCell = showStar
                ? (spectator
                    ? '§9[SPEC]'
                    : uuidVersion(realUuid) === 1
                    ? '§c[NICK]'
                    : (s ? (s.star != null ? formatStar(s.star) : '§7[§7?§7]') : '§7[§8…§7]'))
                : '';
            const respawn = p.respawning && this.respawns.get(p.name);
            const renderedStarCell = respawn ? `§6§l${respawn.seconds}s§r` : starCell;
            const fkdrCell = showFkdr
                ? (s ? (s.fkdr != null ? formatFkdr(s.fkdr) : '§7-') : '§8…')
                : '';
            const winstreakCell = showWinstreak
                ? (bordic ? formatWinstreak(bordic.winstreak) : '§8…')
                : '';
            const historicalPingCell = showHistoricalPing
                ? (bordic ? formatHistoricalPing(bordic.ping) : '§8…')
                : '';
            const urchinCell = showUrchinTags ? formatUrchinTags(urchinTags) : '';
            const kenwayCell = showKenwayTags ? formatKenwayTags(kenwayData) : '';
            return {
                uuid: p.uuid,
                teamPrefix: prefix,
                star: renderedStarCell,
                starWidthBasis: starCell,
                name: this.denicks.has(p.name)
                    ? `${nameColor}${p.name} §5(${this.denicks.get(p.name)})`
                    : `${nameColor}${p.name}`,
                fkdr: fkdrCell,
                winstreak: winstreakCell,
                historicalPing: historicalPingCell,
                urchin: urchinCell,
                kenway: kenwayCell,
            };
        });

        const columns = [];
        columns.push('teamPrefix');
        if (showStar) columns.push('star');
        columns.push('name');
        if (showFkdr) columns.push('fkdr');
        if (showWinstreak) columns.push('winstreak');
        if (showHistoricalPing) columns.push('historicalPing');
        if (showUrchinTags) columns.push('urchin');
        if (showKenwayTags) columns.push('kenway');

        const cellRows = rows.map((row) => columns.map((column) => row[column]));
        const gaps = {
            teamPrefix: ' ',
            star: '  ',
            name: '  ',
            fkdr: '     ',
            winstreak: '     ',
            historicalPing: '     ',
            urchin: '',
            kenway: ' ',
        };
        const alignments = {
            teamPrefix: 'left',
            star: 'left',
            name: 'left',
            fkdr: 'decimal',
            winstreak: 'right',
            historicalPing: 'right',
            urchin: 'left',
            kenway: 'left',
        };
        const layout = align
            ? new PixelTableLayout(
                this.font,
                cellRows,
                columns.map(() => ''),
                columns.map((column) => gaps[column]),
                columns.map((column) => alignments[column]),
            )
            : null;
        const starColumn = columns.indexOf('star');
        if (layout && starColumn >= 0) layout.include(starColumn, rows.map((row) => row.starWidthBasis));

        const updates = [];
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const cells = cellRows[index];
            const display = layout
                ? layout.render(cells)
                : cells.map((cell) => `§r${cell || ''}§r`).join(' ');
            updates.push({ UUID: row.uuid, displayName: JSON.stringify({ text: display }) });
            this.overridden.add(row.uuid);
        }
        if (updates.length) this.api.sendPlayerInfo(3, updates);
        return updates.length;
    }

    restoreAll() {
        this.clearRespawns();
        const updates = [];
        for (const uuid of this.overridden) {
            const info = this.api.getPlayerInfo(uuid);
            updates.push({ UUID: uuid, displayName: info && info.displayName ? info.displayName : null });
        }
        if (updates.length) this.api.sendPlayerInfo(3, updates);
        this.overridden.clear();
    }
}

module.exports = (api) => {
    api.metadata({
        name: 'tabalign',
        displayName: 'Tablist Alignment',
        prefix: '§bTA',
        version: '2.4.1',
        author: 'cow',
        description: 'In-game Bedwars tab stats with aligned columns and Proxhy-style respawn timers',
    });

    const configSchema = [
        {
            label: 'Hypixel API Key',
            description: 'Required to fetch Bedwars stats. Get one at developer.hypixel.net.',
            defaults: { apiKey: '' },
            settings: [
                { type: 'text', key: 'apiKey', encrypted: true, description: 'Your Hypixel API key.', placeholder: 'Enter your Hypixel API key' },
            ],
        },
        {
            label: 'Pre-game Lobby',
            description: 'Show the stats overlay in the pre-game waiting lobby, before the game starts.',
            defaults: { pregameLobby: true },
            settings: [
                { type: 'toggle', key: 'pregameLobby', text: ['OFF', 'ON'], description: 'Render the tab overlay while waiting for a Bedwars game to start.' },
            ],
        },
        {
            label: 'Bordic API',
            description: 'Used for winstreak, 30-day average ping, and optionally cached Hypixel stats.',
            defaults: { bordicApiKey: '', useBordicStats: false },
            settings: [
                { type: 'text', key: 'bordicApiKey', encrypted: true, description: 'Your Bordic API key.', placeholder: 'Enter your Bordic API key' },
                { type: 'toggle', key: 'useBordicStats', text: ['HYPIXEL', 'BORDIC'], description: 'Use Bordic cache instead of the official Hypixel API for star and FKDR.' },
            ],
        },
        {
            label: 'Urchin Tags',
            description: 'Shows Urchin player-tag icons in the rightmost tab column.',
            defaults: { urchinApiKey: '', showUrchinTags: true },
            settings: [
                { type: 'text', key: 'urchinApiKey', encrypted: true, description: 'Your Urchin API key.', placeholder: 'Enter your Urchin API key' },
                { type: 'toggle', key: 'showUrchinTags', text: ['OFF', 'ON'], description: 'Request and render Urchin tag icons for every tab player.' },
            ],
        },
        {
            label: 'Kenway Blacklist',
            description: 'Shows Kenway\'s own blacklist tags (Urchin-synced and direct community reports) in tab, distinct from the Urchin column above.',
            defaults: { kenwayApiUrl: '', showKenwayTags: true },
            settings: [
                { type: 'text', key: 'kenwayApiUrl', description: 'Base URL of your hosted Kenway API (e.g. https://kenway.example.com). Set this to the same URL as the kenway plugin\'s "apiUrl" - they are configured separately but should point at the same server.', placeholder: 'https://kenway.example.com' },
                { type: 'toggle', key: 'showKenwayTags', text: ['OFF', 'ON'], description: 'Request and render Kenway blacklist tags for every tab player.' },
            ],
        },
        {
            label: 'Columns',
            description: 'Which stat columns are shown and aligned in tab.',
            defaults: { showStar: true, showFkdr: true, showWinstreak: true, showHistoricalPing: true, alignColumns: true },
            settings: [
                { type: 'toggle', key: 'showStar', text: ['OFF', 'ON'], description: 'Show the Bedwars star before each name.' },
                { type: 'toggle', key: 'showFkdr', text: ['OFF', 'ON'], description: 'Show FKDR after each name.' },
                { type: 'toggle', key: 'showWinstreak', text: ['OFF', 'ON'], description: 'Show Bordic winstreak after FKDR.' },
                { type: 'toggle', key: 'showHistoricalPing', text: ['OFF', 'ON'], description: 'Show the rounded average of the newest 30 Bordic ping days.' },
                { type: 'toggle', key: 'alignColumns', text: ['OFF', 'ON'], description: 'Pad columns with invisible glyphs so they line up (needs the resource pack).' },
            ],
        },
        {
            label: 'Resource Pack',
            description: 'Serves the invisible padding glyphs to your client on join.',
            defaults: { resourcePack: true },
            settings: [
                { type: 'toggle', key: 'resourcePack', text: ['OFF', 'ON'], description: 'Offer the tab-alignment resource pack automatically on join.' },
            ],
        },
    ];
    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    const plugin = new TabAlign(api);
    const P = () => api.getPrefix();

    api.commands((registry) => {
        registry.command('setkey')
            .description('Set your Hypixel API key (and validate it)')
            .argument('<apikey>', 'Your Hypixel API key')
            .handler(async (ctx) => {
                api.config.set('apiKey', ctx.args.apikey);
                plugin.stats.cache.clear();
                api.chat(`${P()} §aKey saved. §7Validating…`);
                const uuid = (plugin.proxy && plugin.proxy.currentPlayer && plugin.proxy.currentPlayer.uuid)
                    || '869c2a8943b041b199a6 b03485f47f01'.replace(/\s/g, '');
                const res = await plugin.stats.request(uuid);
                if (res.ok) api.chat(`${P()} §aAPI key is valid. §7Join a Bedwars game to see stats.`);
                else api.chat(`${P()} §cKey check failed: §e${res.error}`);
            });

        registry.command('pack')
            .description('Re-offer the tab-alignment resource pack to your client')
            .handler(async () => {
                const ok = await plugin.sendResourcePack(false);
                if (ok) api.chat(`${P()} §aResource pack offered. §7If your client shows "declined", enable "Server Resource Packs" in your client settings, then run §e/tabalign pack §7again.`);
                else api.chat(`${P()} §cCould not send the resource pack (not connected, or pack disabled in config).`);
            });

        registry.command('setbordickey')
            .description('Set your Bordic API key')
            .argument('<apikey>', 'Your Bordic API key')
            .handler((ctx) => {
                api.config.set('bordicApiKey', ctx.args.apikey);
                plugin.bordic.cache.clear();
                api.chat(`${P()} §aBordic API key saved. §7Winstreak and ping will refresh now.`);
                plugin.scheduleRender();
            });

        registry.command('seturchinkey')
            .description('Set your Urchin API key')
            .argument('<apikey>', 'Your Urchin API key')
            .handler((ctx) => {
                api.config.set('urchinApiKey', ctx.args.apikey);
                plugin.urchin.cache.clear();
                api.chat(`${P()} §aUrchin API key saved. §7Player tags will refresh now.`);
                plugin.scheduleRender();
            });

        registry.command('force')
            .description('Force-render stats into the tab list right now')
            .handler(() => {
                plugin.forceRender = true;
                const n = plugin.render();
                plugin.forceRender = false;
                api.chat(`${P()} §aForced render for §e${n || 0}§a player(s). ${plugin.stats.getApiKey() ? '' : '§cNo API key set — run /tabalign setkey <key>.'}`);
            });

        registry.command('status')
            .description('Show plugin status for troubleshooting')
            .handler(() => {
                const key = plugin.stats.getApiKey();
                const srv = plugin.packServer;
                const players = plugin.tabPlayers();
                const lines = [
                    `${P()} §bStatus`,
                    `§7API key: ${key ? `§aset (${key.length} chars)` : '§cnot set'}`,
                    `§7Bordic key: ${plugin.bordic.getApiKey() ? '§aset' : '§cnot set'} §8| source: ${plugin.api.config.get('useBordicStats') === true ? '§bBordic cache' : '§aHypixel API'} §8| cached: §f${plugin.bordic.cache.size}`,
                    `§7Urchin key: ${plugin.urchin.getApiKey() ? '§aset' : '§cnot set'} §8| cached tags: §f${plugin.urchin.cache.size}`,
                    `§7Resource pack: ${srv.server ? `§aserving on 127.0.0.1:${srv.port}` : '§enot started'} §8| sha1 ${srv.sha1.slice(0, 8)}… §8| sent this session: ${plugin.sentPack ? '§ayes' : '§7no'}`,
                    `§7Game (locraw): §f${plugin.game.gametype || '?'}§7/§f${plugin.game.mode || '?'} §8| started: ${plugin.gameStarted ? '§ayes' : '§cno'} §8| tab active: ${plugin.inBedwars ? '§ayes' : '§cno'} §8| awaiting locraw: ${plugin.awaitingLocraw ? '§eyes' : '§7no'}`,
                    `§7Tab players: §f${players.length} §8| overridden: §f${plugin.overridden.size} §8| cached stats: §f${plugin.stats.cache.size}`,
                ];
                api.chat(lines.join('\n'));
                if (players.length) {
                    const p = players[0];
                    const team = api.getPlayerTeam(p.name);
                    const info = api.getPlayerInfo(p.uuid);
                    api.chat(`§7Sample §f${p.name}§7: team prefix ${JSON.stringify(team ? team.prefix : '')}, displayName ${info && info.displayName ? '§aset' : '§7none'}`);
                }
                if (!plugin.inBedwars) api.chat(`§7Not detected as Bedwars — use §e/tabalign force §7to render anyway, or §e/tabalign locraw §7to re-detect.`);
            });

        registry.command('refresh')
            .description('Re-fetch stats and re-render')
            .handler(() => {
                plugin.stats.cache.clear();
                plugin.bordic.cache.clear();
                plugin.urchin.cache.clear();
                plugin.scheduleRender();
                api.chat(`${P()} §aRefreshing…`);
            });

        registry.command('locraw')
            .description('Re-run /locraw to re-detect the current game')
            .handler(() => {
                plugin.locrawRetries = 0;
                plugin.sendLocraw();
                api.chat(`${P()} §7Sent /locraw — re-detecting game…`);
            });

        registry.command('testurchin')
            .description('Run a live Urchin/Cubelify lookup for a player in your tab list and show the raw result')
            .argument('<player>', 'Player name (must be visible in your tab list right now)')
            .handler(async (ctx) => {
                const target = ctx.args.player;
                const match = plugin.tabPlayers().find((p) => p.name.toLowerCase() === target.toLowerCase());
                if (!match) {
                    api.chat(`${P()} §c${target} isn't in your current tab list — run this while they're visible in a game.`);
                    return;
                }
                if (!plugin.urchin.getApiKey()) {
                    api.chat(`${P()} §cNo Urchin key set — run §e/tabalign seturchinkey <key>`);
                    return;
                }
                const uuid = match.realUuid || match.uuid;
                api.chat(`${P()} §7Querying Urchin for §f${match.name}§7 (${uuid})…`);
                const result = await plugin.urchin.request(uuid, match.name);
                if (result.ok) {
                    api.chat(`${P()} §aOK §7— matched tags: §f${result.tags.length ? result.tags.join(', ') : '(none)'}`);
                } else {
                    api.chat(`${P()} §cRequest failed: §e${result.error}`);
                }
            });

        registry.command('teststats')
            .description('Run a live Hypixel stats lookup for a player in your tab list and show the raw result')
            .argument('<player>', 'Player name (must be visible in your tab list right now)')
            .handler(async (ctx) => {
                const target = ctx.args.player;
                const match = plugin.tabPlayers().find((p) => p.name.toLowerCase() === target.toLowerCase());
                if (!match) {
                    api.chat(`${P()} §c${target} isn't in your current tab list — run this while they're visible in a game.`);
                    return;
                }
                if (!plugin.stats.getApiKey()) {
                    api.chat(`${P()} §cNo Hypixel API key set — run §e/tabalign setkey <key>`);
                    return;
                }
                const uuid = match.realUuid || match.uuid;
                api.chat(`${P()} §7Querying Hypixel for §f${match.name}§7 (${uuid})…`);
                const result = await plugin.stats.request(uuid);
                if (result.ok) {
                    const s = result.stats;
                    api.chat(`${P()} §aOK §7— star: §f${s.star ?? 'null'} §7fkdr: §f${s.fkdr != null ? s.fkdr.toFixed(2) : 'null'} §7nicked: §f${s.nicked}`);
                } else {
                    api.chat(`${P()} §cRequest failed: §e${result.error}`);
                }
            });
    });

    plugin.registerHandlers();
    return plugin;
};

module.exports.__test = { TabAlign, StatsProvider, BordicProvider, UrchinProvider, KenwayProvider, FontMetrics, PixelTableLayout, buildZip, buildPackBytes, ResourcePackServer, formatStar, formatFkdr, formatWinstreak, formatHistoricalPing, formatUrchinTags, formatKenwayTags, averageRecentPing, fkdrParts, alignFkdr, crc32, componentText, compactTabFooter, offlineUuid, respawnUuid, uuidVersion, isVisiblePlayerUuid, killVictim, teamColor, URCHIN_TAG_GLYPHS, PIXEL_PADDING_CHAR, DOUBLE_PIXEL_PADDING_CHAR };
