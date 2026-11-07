function stripColorCodes(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/§./g, '');
}

class PlayerHandler {
    constructor(gameState) {
        this.gameState = gameState;
    }

    handlePlayerInfo(data) {
        if (!data.data || !Array.isArray(data.data)) return;
        
        for (const player of data.data) {
            switch (data.action) {
                case 0:
                    this.gameState.playerInfo.set(player.UUID, {
                        name: stripColorCodes(player.name),
                        properties: player.properties || [],
                        gamemode: player.gamemode,
                        ping: player.ping,
                        displayName: player.displayName
                    });
                    break;
                case 1:
                    const existing = this.gameState.playerInfo.get(player.UUID);
                    if (existing) existing.gamemode = player.gamemode;
                    break;
                case 2:
                    const info = this.gameState.playerInfo.get(player.UUID);
                    if (info) info.ping = player.ping;
                    break;
                case 3:
                    const p = this.gameState.playerInfo.get(player.UUID);
                    if (p) p.displayName = player.displayName;
                    break;
                case 4:
                    this.gameState.playerInfo.delete(player.UUID);
                    break;
            }
        }
    }

    handleLogin(data) {
        this.gameState.loginPacket = data;
        this.gameState.gameMode = data.gameMode;
    }

    handleRespawn(data) {
        const loginData = this.gameState.loginPacket;
        this.gameState.reset();
        this.gameState.loginPacket = loginData;
        this.gameState.gameMode = data.gameMode;
    }

    handleUpdateHealth(data) {
        this.gameState.health = data.health;
        this.gameState.food = data.food;
        this.gameState.saturation = data.foodSaturation;
    }

    handleExperience(data) {
        this.gameState.experience = {
            progress: data.experienceBar,
            level: data.level,
            total: data.totalExperience
        };
    }

    handleGameStateChange(data) {
        if (data.reason === 3) {
            this.gameState.gameMode = data.gameMode;
        }
    }
}

module.exports = PlayerHandler;