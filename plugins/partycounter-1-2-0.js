module.exports = (api) => {
    api.metadata({
        name: 'partycounter',
        displayName: 'Party Counter',
        prefix: '§bPC',
        version: '1.2.0',
        author: 'kevquit',
        description: 'Detects parties joining/leaving the lobby by grouping join/quit messages.'
    });

    // --- Detection notes -------------------------------------------------
    // A proxy can't *know* two players are partied; it infers it from the
    // fact that Hypixel broadcasts a party's join/quit messages in the same
    // server batch (sub-tick), while unrelated solo players trickle in
    // seconds apart. So the quality of detection is almost entirely about:
    //   1. a tight grouping window (same-batch, not "within 200ms of noise")
    //   2. a sensible minimum size (a "party of 2" is indistinguishable from
    //      two coincidental solo joins, so it's opt-in via minSize)
    //   3. never mixing joins and quits into one count (separate buffers)
    // ---------------------------------------------------------------------

    const configSchema = [
        {
            label: 'Join Notifications',
            description: 'Announce when a party joins the lobby.',
            defaults: { joinEnabled: true },
            settings: [{ type: 'toggle', key: 'joinEnabled', text: ['OFF', 'ON'], description: 'Enable join notifications.' }]
        },
        {
            label: 'Leave Notifications',
            description: 'Announce when a party leaves the lobby.',
            defaults: { leaveEnabled: true },
            settings: [{ type: 'toggle', key: 'leaveEnabled', text: ['OFF', 'ON'], description: 'Enable leave notifications.' }]
        },
        {
            label: 'Minimum Party Size',
            description: 'Smallest group to report. 2 catches doubles queues (slightly noisier); 3+ cuts coincidental solo joins.',
            defaults: { minSize: 2 },
            settings: [{ type: 'cycle', key: 'minSize', displayLabel: 'Min Size', description: 'Minimum players to count as a party.', values: [2, 3, 4].map(v => ({ text: String(v), value: v })) }]
        },
        {
            label: 'Show Names',
            description: 'List the players in the party.',
            defaults: { showNames: true },
            settings: [{ type: 'toggle', key: 'showNames', text: ['OFF', 'ON'], description: 'List party member names.' }]
        },
        {
            label: 'Grouping Window',
            description: 'How long after the last join/quit to wait before deciding. Lower = fewer false positives.',
            defaults: { delay: 150 },
            settings: [{ type: 'cycle', key: 'delay', displayLabel: 'Window', description: 'Window for grouping joins/quits.', values: [50, 100, 150, 200, 250, 300].map(v => ({ text: v + 'ms', value: v })) }]
        }
    ];

    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    let lastMaxPlayers = 0;

    // Separate buffers so a join cluster and a quit cluster never merge or
    // get mislabeled as each other.
    const buffers = {
        join: { names: new Set(), timer: null },
        leave: { names: new Set(), timer: null }
    };

    const JOIN_RE = /(\w{1,16}) has joined \((\d+)\/(\d+)\)!$/;
    const QUIT_RE = /(\w{1,16}) has quit!$/;

    api.on('chat', e => {
        const msg = e.message.replace(/§./g, '');

        const joinMatch = JOIN_RE.exec(msg);
        if (joinMatch) {
            lastMaxPlayers = parseInt(joinMatch[2]); // group 2 = max (e.g. 16 in "(5/16)")
            if (api.config.get('joinEnabled')) add('join', joinMatch[1]);
            return;
        }

        const quitMatch = QUIT_RE.exec(msg);
        if (quitMatch && api.config.get('leaveEnabled')) {
            add('leave', quitMatch[1]);
        }
    });

    function add(kind, name) {
        const buf = buffers[kind];
        buf.names.add(name);
        clearTimeout(buf.timer);
        buf.timer = setTimeout(() => flush(kind), api.config.get('delay'));
    }

    function flush(kind) {
        const buf = buffers[kind];
        const names = [...buf.names];
        buf.names = new Set();
        buf.timer = null;

        const count = names.length;
        if (!shouldPrint(count)) return;

        const joined = kind === 'join';
        const arrow = joined ? '»' : '«';
        const color = joined ? '§b' : '§3';
        let line = `${api.getPrefix()} §8${arrow} §7Party of ${color}${count} §7${joined ? 'joined' : 'left'}`;
        if (api.config.get('showNames')) {
            line += `§7: §f${names.join('§7, §f')}`;
        } else {
            line += '§7.';
        }
        api.chat(line);
    }

    function shouldPrint(count) {
        const minSize = api.config.get('minSize') || 3;
        if (count < minSize) return false;
        // A real party can't exceed the lobby capacity; cap there (fall back
        // to a sane max if capacity was never seen, e.g. leaves before any join).
        const cap = lastMaxPlayers > 0 ? lastMaxPlayers : 16;
        return count <= cap;
    }
};
