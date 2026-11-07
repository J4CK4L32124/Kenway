module.exports = {
    client: {
        client_settings: {
            safe: false,
            eventMapping: {
                name: 'client_settings',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    locale: data.locale,
                    viewDistance: data.viewDistance,
                    chatFlags: data.chatFlags,
                    chatColors: data.chatColors,
                    skinParts: data.skinParts
                })
            }
        },
        client_command: {
            modifiable: false,
            interceptable: false
        },
        spectate: {
            safe: false
        },
        abilities: {
            safe: false
        }
    },
    server: {
        player_info: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'player_info',
                extractor: (data, session) => {
                    const updates = [];
                    
                    for (const player of data.data) {
                        let update = {
                            uuid: player.UUID,
                            action: data.action
                        };
                        
                        switch(data.action) {
                            case 0:
                                update = {
                                    ...update,
                                    name: player.name,
                                    properties: player.properties,
                                    gamemode: player.gamemode,
                                    ping: player.ping
                                };
                                break;
                            case 1:
                                update.gamemode = player.gamemode;
                                break;
                            case 2:
                                update.ping = player.ping;
                                break;
                            case 3:
                                update.displayName = player.displayName;
                                break;
                            case 4:
                                break;
                        }
                        
                        updates.push(update);
                    }
                    
                    return { action: data.action, players: updates };
                }
            }
        },
        spawn_position: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'spawn_position',
                extractor: (data) => ({
                    location: data.location
                })
            }
        },
        respawn: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'respawn',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    dimension: data.dimension,
                    difficulty: data.difficulty,
                    gamemode: data.gamemode,
                    levelType: data.levelType
                })
            }
        },
        experience: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'player_experience',
                extractor: (data) => ({
                    experienceBar: data.experienceBar,
                    level: data.level,
                    totalExperience: data.totalExperience
                })
            }
        },
        update_health: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'update_health',
                extractor: (data) => ({
                    health: data.health,
                    food: data.food,
                    foodSaturation: data.foodSaturation
                })
            }
        },
        abilities: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'abilities',
                extractor: (data) => ({
                    flags: data.flags,
                    flyingSpeed: data.flyingSpeed,
                    walkingSpeed: data.walkingSpeed
                })
            }
        },
        position: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'position',
                extractor: (data) => ({
                    x: data.x,
                    y: data.y,
                    z: data.z,
                    yaw: data.yaw,
                    pitch: data.pitch,
                    flags: data.flags
                })
            }
        }
    }
};