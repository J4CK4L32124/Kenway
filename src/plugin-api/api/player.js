class Players {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    getPlayers() {
        if (!this.proxy.currentPlayer?.gameState) return [];
        
        const gameState = this.proxy.currentPlayer.gameState;
        const players = [];
        
        if (gameState.loginPacket) {
            players.push({
                uuid: this.proxy.currentPlayer.uuid,
                name: this.proxy.currentPlayer.username,
                displayName: this.proxy.currentPlayer.username,
                position: { ...gameState.position },
                rotation: {
                    yaw: gameState.position.yaw,
                    pitch: gameState.position.pitch
                },
                health: gameState.health,
                entityId: gameState.loginPacket.entityId,
                isCurrentPlayer: true,
                isCrouching: false,
                isSprinting: false,
                isUsingItem: false,
                isOnFire: false,
                heldItem: gameState.inventory?.slots?.[gameState.inventory.heldItemSlot + 36] || null,
                equipment: {},
                effects: new Map(),
                withinRenderDistance: true
            });
        }
        
        const entitiesWithinRender = new Set();
        
        for (const [entityId, entity] of gameState.entities) {
            if (entity.type === 'player' && entity.uuid) {
                const playerInfo = gameState.playerInfo.get(entity.uuid);
                if (playerInfo) {
                    entitiesWithinRender.add(entity.uuid);
                    players.push({
                        uuid: entity.uuid,
                        name: playerInfo.name,
                        displayName: gameState.getFormattedName(entity.uuid) || playerInfo.name,
                        position: { ...entity.position },
                        rotation: {
                            yaw: entity.yaw || 0,
                            pitch: entity.pitch || 0
                        },
                        health: entity.health || 20,
                        entityId: entityId,
                        isCurrentPlayer: false,
                        isCrouching: entity.isCrouching || false,
                        isSprinting: entity.isSprinting || false,
                        isUsingItem: entity.isUsingItem || false,
                        isOnFire: entity.isOnFire || false,
                        heldItem: entity.heldItem,
                        equipment: entity.equipment || {},
                        effects: entity.effects || new Map(),
                        withinRenderDistance: true
                    });
                }
            }
        }
        
        for (const [uuid, playerInfo] of gameState.playerInfo) {
            if (entitiesWithinRender.has(uuid) || uuid === this.proxy.currentPlayer?.uuid) {
                continue;
            }
            
            players.push({
                uuid: uuid,
                name: playerInfo.name,
                displayName: gameState.getFormattedName(uuid) || playerInfo.name,
                position: null,
                rotation: null,
                health: null,
                entityId: null,
                isCurrentPlayer: false,
                isCrouching: false,
                isSprinting: false,
                isUsingItem: false,
                isOnFire: false,
                heldItem: null,
                equipment: {},
                effects: new Map(),
                withinRenderDistance: false
            });
        }
        
        return players;
    }
    
    getPlayer(uuid) {
        return this.getPlayers().find(p => p.uuid === uuid);
    }
    
    getPlayerByName(name) {
        return this.getPlayers().find(p => p.name === name);
    }
    
    getCurrentPlayer() {
        return this.getPlayers().find(p => p.isCurrentPlayer);
    }
    
    calculateDistance(pos1, pos2) {
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const dz = pos1.z - pos2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    getPlayersWithinDistance(position, distance) {
        return this.getPlayers().filter(player => 
            this.calculateDistance(player.position, position) <= distance
        );
    }
    
    getPlayersInTeam(teamName) {
        if (!this.proxy.currentPlayer?.gameState) return [];
        
        const team = this.proxy.currentPlayer.gameState.teams.get(teamName);
        if (!team) return [];
        
        return this.getPlayers().filter(player => 
            team.players.has(player.name)
        );
    }
    
    getPlayerInfo(uuid) {
        if (!this.proxy.currentPlayer?.gameState) return null;
        
        return this.proxy.currentPlayer.gameState.playerInfo.get(uuid) || null;
    }
    
    
    sendHealth(health, food, foodSaturation) {
        if (!this.core.isHypixelSafe('sendHealth')) {
            this.core.logHypixelBlock('sendHealth');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('health', {
                health,
                food,
                foodSaturation
            });
        } catch (error) {
            this.core.log(`Failed to send health: ${error.message}`);
            return false;
        }
    }
    
    sendExperience(experienceBar, level, totalExperience) {
        if (!this.core.isHypixelSafe('sendExperience')) {
            this.core.logHypixelBlock('sendExperience');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('experience', {
                experienceBar,
                level,
                totalExperience
            });
        } catch (error) {
            this.core.log(`Failed to send experience: ${error.message}`);
            return false;
        }
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
    

    
    sendAbilities(flags, flyingSpeed = 0.05, walkingSpeed = 0.1) {
        if (!this.core.isHypixelSafe('sendAbilities')) {
            this.core.logHypixelBlock('sendAbilities');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('abilities', {
                flags,
                flyingSpeed,
                walkingSpeed
            });
        } catch (error) {
            this.core.log(`Failed to send abilities: ${error.message}`);
            return false;
        }
    }
    
    sendPlayerInfo(action, data) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('player_info', {
                action,
                data
            });
        } catch (error) {
            this.core.log(`Failed to send player info: ${error.message}`);
            return false;
        }
    }
    

}

module.exports = Players; 