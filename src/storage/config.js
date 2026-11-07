const DEFAULT_CONFIG = {
    proxyPort: 25565,
    targetHost: 'mc.hypixel.net',
    targetPort: 25565,
    servers: {
        'hypixel': { host: 'mc.hypixel.net', port: 25565 },
        'ac-test': { host: 'anticheat-test.com', port: 25565 }
    }
};

module.exports = { DEFAULT_CONFIG }; 