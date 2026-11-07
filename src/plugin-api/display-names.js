class DisplayNames {
    constructor(proxy, core, events) {
        this.proxy = proxy;
        this.core = core;
        this.events = events;
        this.prefixes = new Map();
        this.suffixes = new Map();
        this.originalDisplayNames = new Map();
        
        this.events.on('player_info', (data) => this._onPlayerListUpdate(data));
        this.events.on('scoreboard_team', (data) => this._handleTeamUpdate(data));
    }
    
    setPrefix(pluginName, uuid, prefix) {
        if (!this.prefixes.has(uuid)) {
            this.prefixes.set(uuid, new Map());
        }
        this.prefixes.get(uuid).set(pluginName, prefix);
        
        if (this.proxy.currentPlayer?.gameState) {
            const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
            if (playerInfo && !this.originalDisplayNames.has(uuid)) {
                this._storeOriginalDisplayName(uuid, playerInfo);
            }
            this._updatePlayerDisplayName(uuid);
        }
    }
    
    appendPrefix(pluginName, uuid, prefix) {
        const currentPrefix = this.getPrefix(uuid);
        this.setPrefix(pluginName, uuid, currentPrefix + prefix);
    }
    
    prependPrefix(pluginName, uuid, prefix) {
        const currentPrefix = this.getPrefix(uuid);
        this.setPrefix(pluginName, uuid, prefix + currentPrefix);
    }
    
    setSuffix(pluginName, uuid, suffix) {
        if (!this.suffixes.has(uuid)) {
            this.suffixes.set(uuid, new Map());
        }
        this.suffixes.get(uuid).set(pluginName, suffix);
        
        if (this.proxy.currentPlayer?.gameState) {
            const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
            if (playerInfo && !this.originalDisplayNames.has(uuid)) {
                this._storeOriginalDisplayName(uuid, playerInfo);
            }
            this._updatePlayerDisplayName(uuid);
        }
    }
    
    appendSuffix(pluginName, uuid, suffix) {
        if (!this.suffixes.has(uuid)) {
            this.suffixes.set(uuid, new Map());
        }
        this.suffixes.get(uuid).set(pluginName, suffix);
        
        if (this.proxy.currentPlayer?.gameState) {
            const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
            if (playerInfo && !this.originalDisplayNames.has(uuid)) {
                this._storeOriginalDisplayName(uuid, playerInfo);
            }
            this._updatePlayerDisplayName(uuid);
        }
    }
    
    prependSuffix(pluginName, uuid, suffix) {
        if (!this.suffixes.has(uuid)) {
            this.suffixes.set(uuid, new Map());
        }
        
        const suffixMap = this.suffixes.get(uuid);
        const existingSuffixes = new Map(suffixMap);
        
        suffixMap.clear();
        suffixMap.set(pluginName, suffix);
        
        for (const [plugin, existingSuffix] of existingSuffixes) {
            if (plugin !== pluginName) {
                suffixMap.set(plugin, existingSuffix);
            }
        }
        
        if (this.proxy.currentPlayer?.gameState) {
            const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
            if (playerInfo && !this.originalDisplayNames.has(uuid)) {
                this._storeOriginalDisplayName(uuid, playerInfo);
            }
            this._updatePlayerDisplayName(uuid);
        }
    }
    
    getPrefix(uuid) {
        const prefixMap = this.prefixes.get(uuid);
        if (!prefixMap || prefixMap.size === 0) return '';
        return Array.from(prefixMap.values()).join('');
    }
    
    getSuffix(uuid) {
        const suffixMap = this.suffixes.get(uuid);
        if (!suffixMap || suffixMap.size === 0) return '';
        return Array.from(suffixMap.values()).join('');
    }
    
    clearPrefix(pluginName, uuid) {
        const prefixMap = this.prefixes.get(uuid);
        if (prefixMap) {
            prefixMap.delete(pluginName);
            if (prefixMap.size === 0) {
                this.prefixes.delete(uuid);
            }
        }
        this._updatePlayerDisplayName(uuid);
    }
    
    clearSuffix(pluginName, uuid) {
        const suffixMap = this.suffixes.get(uuid);
        if (suffixMap) {
            suffixMap.delete(pluginName);
            if (suffixMap.size === 0) {
                this.suffixes.delete(uuid);
            }
        }
        this._updatePlayerDisplayName(uuid);
    }
    
    clearAll(pluginName) {
        for (const [uuid, prefixMap] of this.prefixes) {
            prefixMap.delete(pluginName);
            if (prefixMap.size === 0) {
                this.prefixes.delete(uuid);
            }
        }
        
        for (const [uuid, suffixMap] of this.suffixes) {
            suffixMap.delete(pluginName);
            if (suffixMap.size === 0) {
                this.suffixes.delete(uuid);
            }
        }
        
        this.updatePlayerList();
    }
    
    updatePlayerList() {
        if (!this.proxy.currentPlayer?.client || !this.proxy.currentPlayer?.gameState) return;
        
        const allUuids = new Set([...this.prefixes.keys(), ...this.suffixes.keys()]);
        for (const uuid of allUuids) {
            this._updatePlayerDisplayName(uuid);
        }
    }
    
    _storeOriginalDisplayName(uuid, playerInfo) {
        let originalName = playerInfo.displayName || playerInfo.name;
        if (originalName && typeof originalName === 'string' && originalName.startsWith('{')) {
            try {
                const parsed = JSON.parse(originalName);
                originalName = this.proxy.currentPlayer.gameState.extractText(parsed);
            } catch (e) {
            }
        }
        this.originalDisplayNames.set(uuid, originalName);
    }
    
    _onPlayerListUpdate(data) {
        if (data.action === 0) {
            for (const player of data.players) {
                const hasPrefix = this.prefixes.has(player.uuid);
                const hasSuffix = this.suffixes.has(player.uuid);
                if (hasPrefix || hasSuffix) {
                    this._updatePlayerDisplayName(player.uuid);
                }
            }
        }
    }
    
    _updatePlayerDisplayName(uuid) {
        if (!this.proxy.currentPlayer?.client || !this.proxy.currentPlayer?.gameState) return;
        
        const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
        if (!playerInfo) return;
        
        const originalName = this.originalDisplayNames.get(uuid) || playerInfo.name;
        const prefix = this.getPrefix(uuid);
        const suffix = this.getSuffix(uuid);
        
        const hasCustomization = prefix || suffix;
        if (!hasCustomization) {
            if (this.originalDisplayNames.has(uuid)) {
                this._restoreOriginalDisplayName(uuid);
                this.originalDisplayNames.delete(uuid);
            }
            return;
        }
        
        const customName = prefix + originalName + suffix;
        const displayName = this._formatDisplayName(customName, playerInfo.name);
        this._sendDisplayNameUpdate(uuid, displayName);
    }
    
    _restoreOriginalDisplayName(uuid) {
        if (!this.proxy.currentPlayer?.client || !this.proxy.currentPlayer?.gameState) return;
        
        const originalName = this.originalDisplayNames.get(uuid);
        if (!originalName) return;
        
        const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
        if (!playerInfo) return;
        
        const displayName = this._formatDisplayName(originalName, playerInfo.name);
        this._sendDisplayNameUpdate(uuid, displayName);
    }
    
    _formatDisplayName(displayName, playerName) {
        const team = this.proxy.currentPlayer.gameState.getPlayerTeam(playerName);
        if (team) {
            return team.prefix + displayName + team.suffix;
        }
        return displayName;
    }
    
    _sendDisplayNameUpdate(uuid, displayName) {
        const displayNameJSON = JSON.stringify({ text: displayName });
        this.proxy.currentPlayer.client.write('player_info', {
            action: 3,
            data: [{ UUID: uuid, displayName: displayNameJSON }]
        });
    }
    
    _handleTeamUpdate(event) {
        if (!this.proxy.currentPlayer?.client || !this.proxy.currentPlayer?.gameState) return;
        
        const { name: teamName, mode } = event;
        if (!teamName || mode === undefined) return;
        
        setImmediate(() => {
            if (!this.proxy.currentPlayer?.gameState) return;
            
            switch (mode) {
                case 0:
                case 2:
                    this._updatePlayersInTeam(teamName);
                    break;
                case 1:
                    this._updateAllPlayers();
                    break;
                case 3:
                    if (event.players) {
                        this._updateSpecificPlayers(event.players);
                    }
                    break;
            }
        });
    }
    
    _updatePlayersInTeam(teamName) {
        const team = this.proxy.currentPlayer.gameState.teams.get(teamName);
        if (!team) return;
        
        const allUuids = new Set([...this.prefixes.keys(), ...this.suffixes.keys()]);
        for (const uuid of allUuids) {
            const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
            if (playerInfo && team.players.has(playerInfo.name)) {
                this._updatePlayerDisplayName(uuid);
            }
        }
    }
    
    _updateAllPlayers() {
        const allUuids = new Set([...this.prefixes.keys(), ...this.suffixes.keys()]);
        for (const uuid of allUuids) {
            this._updatePlayerDisplayName(uuid);
        }
    }
    
    _updateSpecificPlayers(playerNames) {
        const namesToUpdate = new Set(playerNames);
        
        const allUuids = new Set([...this.prefixes.keys(), ...this.suffixes.keys()]);
        for (const uuid of allUuids) {
            const playerInfo = this.proxy.currentPlayer.gameState.playerInfo.get(uuid);
            if (playerInfo && namesToUpdate.has(playerInfo.name)) {
                this._updatePlayerDisplayName(uuid);
            }
        }
    }
}

module.exports = DisplayNames;