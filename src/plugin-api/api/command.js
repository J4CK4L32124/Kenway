class Command {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    register(pluginName, commands) {
        if (!this.proxy.commandHandler) return;
        return this.proxy.commandHandler.register(pluginName, commands);
    }
}

module.exports = Command;