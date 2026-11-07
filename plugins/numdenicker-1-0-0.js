// Number Denicker
// Automatically denicks players by their finals & beds.
//
// Uses the built-in fetch (not axios): the packaged kenway.exe loads plugins
// from an external folder with no node_modules, so a `require('axios')` threw
// at load time and silently killed the whole plugin (its /numdenicker command
// never registered). fetch is a Node built-in, so it always resolves.

module.exports = (api) => {
    api.metadata({
        name: 'numdenicker',
        displayName: 'Number Denicker',
        prefix: '§4ND',
        version: '1.0.1',
        author: 'Awesomeguy',
        description: 'Denick players by their numbers.',
        dependencies: [
            { name: 'denicker', minVersion: '1.1.0' }
        ],
    });

    const numberDenicker = new NumberDenicker(api);
    
    const configSchema = [
        {
            label: 'Aurora API Key',
            description: 'Set your Aurora API key',
            defaults: {
                api: {
                    apikey: ''
                }
            },
            settings: [
                {
                    type: 'text',
                    key: 'api.apikey',
                    description: 'Enter your Aurora API key.',
                    placeholder: 'API key'
                }
            ]
        },
        {
            label: 'Finals',
            description: 'API settings for finals endpoint',
            defaults: {
                finals: {
                    range: 200,
                    max: 5

                }
            },
            settings: [
                {
                    type: 'cycle',
                    key: `finals.range`,
                    values: [
                        { text: 'R: 100', value: 100 },
                        { text: 'R: 200', value: 200 },
                        { text: 'R: 500', value: 500 },
                        { text: 'R: 1000', value: 1000 },
                    ],
                    description: 'Sets the range for finals to check.'
                },
                {
                    type: 'cycle',
                    key: `finals.max`,
                    values: [
                        { text: 'R: 5', value: 5 },
                        { text: 'R: 10', value: 10 },
                        { text: 'R: 20', value: 20 },
                    ],
                    description: 'Number of returned players.'
                }
            ]
        },
        {
            label: 'Beds',
            description: 'API settings for beds endpoint',
            defaults: {
                beds: {
                    range: 200,
                    max: 5

                }
            },
            settings: [
                {
                    type: 'cycle',
                    key: `beds.range`,
                    values: [
                        { text: 'R: 100', value: 100 },
                        { text: 'R: 200', value: 200 },
                        { text: 'R: 500', value: 500 },
                        { text: 'R: 1000', value: 1000 },
                    ],
                    description: 'Range for beds to check.'
                },
                {
                    type: 'cycle',
                    key: `beds.max`,
                    values: [
                        { text: 'M: 5', value: 5 },
                        { text: 'M: 10', value: 10 },
                        { text: 'M: 20', value: 20 },
                    ],
                    description: 'Max number of returned players.'
                }
            ]
        },
    ];

    api.initializeConfig(configSchema);

    api.configSchema(configSchema);

    api.commands((registry) => {
        registry.command('setkey')
            .description('Set your Aurora API key.')
            .argument('<apikey>', 'Your Aurora API key')
            .handler((ctx) => numberDenicker.handleSetKeyCommand(ctx.args.apikey));
    });

    
    numberDenicker.registerHandlers();
    return numberDenicker;
};

class NumberDenicker {
    constructor(api) {
        this.api = api;
        this.gameStarted = false;
        this.denickerPlugin = this.api.getPluginInstance('denicker');
        this.nickToPotentials = new Map();
        this.finalsChecked = new Set();
        this.bedsChecked = new Set();
        this.pendingLookups = new Set(); // 'finals:Nick' while a lookup is in flight
        this.gameId = 0; // bumped per game so late responses from an old game are dropped
        this.missingKeyWarned = false;

        this.base_url = 'https://bordic.xyz/api/v2/resources/lookup/';
    }

    async handleSetKeyCommand(apiKey) {
        if (!apiKey || apiKey.trim() === '') {
            this.api.chat(`${this.api.getPrefix()} §7Usage: /numdenicker setkey <your-api-key>`);
            return;
        }
        this.api.config.set('api.apikey', apiKey.trim());
        this.api.chat(`${this.api.getPrefix()} §aAurora API key set successfully.`);
    }

    registerHandlers() {
        this.api.on('chat', this.onChat.bind(this));
        this.api.on('respawn', this.onWorldChange.bind(this));
    }

    onWorldChange(event) {
        this.gameStarted = false;
        this.resetGame();
    }

    // Nicks are reused by different people, so nothing carries over between games.
    resetGame() {
        this.gameId++;
        this.nickToPotentials.clear();
        this.finalsChecked.clear();
        this.bedsChecked.clear();
        this.pendingLookups.clear();
    }

    onChat(event) {
        if (!this.api.config.get('enabled')) {
            return;
        }

        const message = event.message;

        if (this.isNumberFinalsMessage(message)) {
            const { nickName, finalNumber } = this.isNumberFinalsMessage(message);
            if (this.finalsChecked.has(nickName)) {
                return;
            }
            this.processNumbers('finals', nickName, finalNumber);
        }

        if (this.isNumberBedsMessage(message)) {
            const { nickName, bedNumber } = this.isNumberBedsMessage(message);
            this.api.debugLog(`Processing bed number for ${nickName}: ${bedNumber}`);
            if (this.bedsChecked.has(nickName)) {
                return;
            }
            this.processNumbers('beds', nickName, bedNumber);
        }

        if (this.isBedwarsStartMessage(message)) {
            if (this.gameStarted) {
                return;
            }
            this.api.debugLog(`Game start message detected: ${message}`);
            this.gameStarted = true;
            this.resetGame();
        }
    }

    processNumbers(type, nickName, number) {
        const lookupKey = `${type}:${nickName}`;
        if (this.pendingLookups.has(lookupKey)) {
            return;
        }
        this.pendingLookups.add(lookupKey);
        const gameId = this.gameId;
        const range = this.api.config.get(`${type}.range`);
        const max = this.api.config.get(`${type}.max`);
        this.queryStats(type, number, range, max).then((response) => {
            if (gameId !== this.gameId) {
                return;
            }
            this.pendingLookups.delete(lookupKey);
            if (response && response.success) {
                let potentialNames = response.data
                    .filter(player => player.distance <= 0)
                    .map(player => player.name);
                if (potentialNames.length === 0) {
                    // can't definitively find a player if there is no available data for either finals/beds
                    this.finalsChecked.add(nickName);
                    this.bedsChecked.add(nickName);
                    this.nickToPotentials.set(nickName, []);
                    return;
                }
                let currentNames = this.nickToPotentials.get(nickName) || [];
                // find intersection
                if (currentNames.length > 0) {
                    potentialNames = potentialNames.filter(name => currentNames.includes(name));
                }
                this.api.debugLog(`Potential names for ${nickName}: ${JSON.stringify(potentialNames)}`);
                                    
                this.nickToPotentials.set(nickName, potentialNames);
                if (type === 'finals') {
                    this.finalsChecked.add(nickName);
                } else if (type === 'beds') {
                    this.bedsChecked.add(nickName);
                }

                if(this.bedsChecked.has(nickName) && this.finalsChecked.has(nickName)) {
                    const potentialNames = this.nickToPotentials.get(nickName);
                    if (potentialNames.length > 0) {
                        const realName = potentialNames[0]; // probably first name (usually only one anyway)
                        const team = this.api.getPlayerTeam(nickName);
                        const prefix = team?.prefix || '';
                        const suffix = team?.suffix || '';
                        const teamFormattedName = prefix + nickName + suffix;

                        this.denickerPlugin.resolvedNicks.set(nickName, realName);
                        this.api.emit('denicker:nick_resolved', { nickName, realName });
                        this.denickerPlugin.sendCubelifyMessage(realName);
                        this.denickerPlugin.sendAlert(teamFormattedName, realName);
                        this.setNickDisplayname(nickName, realName);

                        this.api.debugLog(`Set nick display name for ${nickName} to ${realName}`);
                    } else {
                        this.api.debugLog(`No potential names found for ${nickName}`);
                    }
                }
            }
        });
    }
    
    async queryStats(type, value, range, max) {
        if (!this.api.config.get('api.apikey')) {
            if (!this.missingKeyWarned) {
                this.missingKeyWarned = true;
                this.api.chat(`${this.api.getPrefix()} §cAurora API key not set. Please set it using /numdenicker setkey <your-api-key>`);
            }
            return;
        }
        const apiKey = this.api.config.get('api.apikey');
        const url = `${this.base_url}${type}?key=${encodeURIComponent(apiKey)}&value=${encodeURIComponent(value)}&range=${encodeURIComponent(range)}&max=${encodeURIComponent(max)}`;

        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Kenway-Proxy-Numbers-Denick/1.0.0' },
                signal: AbortSignal.timeout(8000)
            });
            return await response.json();
        } catch (error) {
            console.error('error fetching', error);
            this.api.chat(`${this.api.getPrefix()} §cError fetching data from Aurora API. Please check your API key and try again.`);
            return false;
        }
    }

    isBedwarsStartMessage(message) {
        const cleanMessage = message.replace(/§[0-9a-fk-or]/g, '').trim();
        const startText1 = 'Protect your bed and destroy the enemy beds.';
        const startText2 = 'You will respawn because you still have a bed!';

        return cleanMessage === startText1 || cleanMessage === startText2;
    }

    isNumberFinalsMessage(message) {
        const cleanMessage = message.replace(/§[0-9a-fk-or]/g, '').trim();
        const playerRegex = /^(.+?) was ([\w-]+)'s final #([\d,]+)\. FINAL KILL!$/;

        let match;
        if ((match = cleanMessage.match(playerRegex))) {
            let nickName = match[2];
            let finalNumber = match[3].replace(/,/g, '');
            this.api.debugLog(`Player ${nickName} has final number ${finalNumber}`);
            return { nickName, finalNumber };
        }
        return false;
    }

    isNumberBedsMessage(message) {
        const cleanMessage = message.replace(/§[0-9a-fk-or]/g, '').trim();
        const bedRegex = /^(.+?) was bed #([\d,]+) destroyed by ([\w-]+)!$/;

        let match;
        if ((match = cleanMessage.match(bedRegex))) {
            let nickName = match[3];
            let bedNumber = match[2].replace(/,/g, '');
            this.api.debugLog(`Player ${nickName} destroyed bed ${bedNumber}`);
            return { nickName, bedNumber };
        }
        return false;
    }

    getNickEntry(nickName) {
        const nickDisplayNames = this.denickerPlugin.nickDisplayNames;

        for (const [uuid, { nickName: currentNickName }] of nickDisplayNames) {
            if (currentNickName.toLowerCase() === nickName) {
                return { uuid, nickName: currentNickName };
            }
        }
        return null;
    }

    setNickDisplayname(nickName, realName) {
        const entry = this.getNickEntry(nickName.toLowerCase());
        const uuid = entry && entry.uuid;
        if (uuid) {
            this.denickerPlugin.setNickDisplayName(uuid, entry.nickName, realName);
            this.api.debugLog(`Found UUID for ${nickName}: ${uuid}`);
        } else {
            this.api.debugLog(`UUID for ${nickName} not found.`);
            return;
        }
    }
}