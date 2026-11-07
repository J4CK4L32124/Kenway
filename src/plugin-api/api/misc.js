class Misc {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    kick(reason = 'Disconnected') {
        if (!this.core.isHypixelSafe('kick')) {
            this.core.logHypixelBlock('kick');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('kick_disconnect', {
                reason: JSON.stringify({ text: reason })
            });
        } catch (error) {
            this.core.log(`Failed to kick: ${error.message}`);
            return false;
        }
    }
    
    sendKeepAlive(keepAliveId) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('keep_alive', {
                keepAliveId
            });
        } catch (error) {
            this.core.log(`Failed to send keep alive: ${error.message}`);
            return false;
        }
    }
    
    sendCustomPayload(channel, data) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('custom_payload', {
                channel,
                data
            });
        } catch (error) {
            this.core.log(`Failed to send custom payload: ${error.message}`);
            return false;
        }
    }
    
    sendLogin(entityId, gameMode, dimension, difficulty, maxPlayers, levelType, reducedDebugInfo = false) {
        if (!this.core.isHypixelSafe('sendLogin')) {
            this.core.logHypixelBlock('sendLogin');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('login', {
                entityId,
                gameMode,
                dimension,
                difficulty,
                maxPlayers,
                levelType,
                reducedDebugInfo
            });
        } catch (error) {
            this.core.log(`Failed to send login: ${error.message}`);
            return false;
        }
    }
    
    sendScoreboardObjective(objectiveName, mode, objectiveValue = '', type = 'integer') {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('scoreboard_objective', {
                objectiveName,
                mode,
                objectiveValue,
                type
            });
        } catch (error) {
            this.core.log(`Failed to send scoreboard objective: ${error.message}`);
            return false;
        }
    }
    
    sendScoreboardScore(itemName, action, scoreName, value = 0) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('scoreboard_score', {
                itemName,
                action,
                scoreName,
                value
            });
        } catch (error) {
            this.core.log(`Failed to send scoreboard score: ${error.message}`);
            return false;
        }
    }
    
    sendScoreboardDisplay(position, scoreName) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('scoreboard_display_objective', {
                position,
                scoreName
            });
        } catch (error) {
            this.core.log(`Failed to send scoreboard display: ${error.message}`);
            return false;
        }
    }
    
    sendScoreboardTeam(team, mode, name = '', prefix = '', suffix = '', friendlyFire = 0, nameTagVisibility = 'always', color = -1, players = []) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('scoreboard_team', {
                team,
                mode,
                name,
                prefix,
                suffix,
                friendlyFire,
                nameTagVisibility,
                color,
                players
            });
        } catch (error) {
            this.core.log(`Failed to send scoreboard team: ${error.message}`);
            return false;
        }
    }
}

module.exports = Misc;