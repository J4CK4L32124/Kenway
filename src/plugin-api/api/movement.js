class Movement {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    sendPosition(x, y, z, yaw, pitch, flags = 0) {
        if (!this.core.isHypixelSafe('sendPosition')) {
            this.core.logHypixelBlock('sendPosition');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('position', {
                x,
                y,
                z,
                yaw,
                pitch,
                flags,
                teleportId: Math.floor(Math.random() * 1000000)
            });
        } catch (error) {
            this.core.log(`Failed to send position: ${error.message}`);
            return false;
        }
    }
}

module.exports = Movement;