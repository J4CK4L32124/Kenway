// Quick Requeue Plugin
// Lets you type "/rq" in chat as a shortcut for Hypixel's own "/requeue"
// command, which re-queues you into whatever game mode you last played.
//
// Note: this plugin is deliberately NOT named "rq" internally. Kenway's
// command router intercepts any "/<pluginname> ..." chat message before it
// ever reaches a plugin's raw packet handlers - if this plugin were named
// "rq", typing "/rq" would always get swallowed by the router itself
// (showing a help message, since there's no subcommand) and this plugin's
// own logic below would never run. Naming it something else keeps "/rq"
// free to be intercepted as a raw chat packet instead.

module.exports = (api) => {
    api.metadata({
        name: 'quickrequeue',
        displayName: 'Quick Requeue',
        prefix: 'RQ',
        version: '1.0.0',
        author: 'Custom',
        minVersion: '0.1.7',
        description: 'Lets you type /rq as a shortcut that requeues you into the game mode you last played (same as Hypixel\'s own /requeue).'
    });

    const configSchema = [
        {
            label: 'Quick Requeue',
            description: 'Intercepts /rq and sends /requeue on your behalf.',
            defaults: {
                rq: {
                    enabled: true,
                    cooldownSeconds: 3
                }
            },
            settings: [
                { type: 'toggle', key: 'rq.enabled', text: ['OFF', 'ON'], description: 'Master switch - intercept /rq and turn it into /requeue.' },
                {
                    type: 'cycle',
                    key: 'rq.cooldownSeconds',
                    description: 'Minimum time between uses, to avoid accidentally double-tapping it.',
                    values: [
                        { text: 'Cooldown: none', value: 0 },
                        { text: 'Cooldown: 2s', value: 2 },
                        { text: 'Cooldown: 3s', value: 3 },
                        { text: 'Cooldown: 5s', value: 5 },
                    ],
                },
            ],
        },
    ];

    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    const plugin = new QuickRequeue(api);
    plugin.registerHandlers();
    return plugin;
};

class QuickRequeue {
    constructor(api) {
        this.api = api;
        this.PLUGIN_PREFIX = this.api.getPrefix();
        this.lastUse = 0;
    }

    registerHandlers() {
        this.unsubscribeChat = this.api.intercept('packet:client:chat', (event) => this.onClientChat(event));
    }

    onClientChat(event) {
        if (!this.api.config.get('rq.enabled')) return;

        const raw = event.data && event.data.message;
        if (typeof raw !== 'string') return;
        // Only the bare command, e.g. "/rq" or "/RQ" with stray whitespace -
        // not "/rqsomething" or "/rq <args>".
        if (!/^\/rq\s*$/i.test(raw.trim())) return;

        // This is our own shortcut, not a real Hypixel command - never let
        // it reach the server, or it would just show "Unknown command".
        event.cancel();

        const cooldownMs = (this.api.config.get('rq.cooldownSeconds') || 0) * 1000;
        const now = Date.now();
        if (cooldownMs && now - this.lastUse < cooldownMs) return;
        this.lastUse = now;

        this.api.chat(`${this.PLUGIN_PREFIX} §aRequeueing…`);
        this.api.sendChatToServer('/requeue');
    }
}
