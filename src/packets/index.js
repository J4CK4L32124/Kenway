const PacketHandler = require('./packet-handler');

class PacketSystem {
    constructor() {
        this.handler = new PacketHandler();
    }

    initialize() {
    }

    getProcessor() {
        return this.handler;
    }

    getHandler() {
        return this.handler;
    }
}

module.exports = { PacketSystem };