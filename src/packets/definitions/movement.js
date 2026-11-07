module.exports = {
    client: {
        position: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'player_move',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    position: { x: data.x, y: data.y, z: data.z },
                    onGround: data.onGround,
                    rotation: undefined
                })
            }
        },
        position_look: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'player_move',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    position: { x: data.x, y: data.y, z: data.z },
                    onGround: data.onGround,
                    rotation: { yaw: data.yaw, pitch: data.pitch }
                })
            }
        },
        look: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'player_move',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    position: { ...session.gameState.position },
                    onGround: data.onGround,
                    rotation: { yaw: data.yaw, pitch: data.pitch }
                })
            }
        },
        flying: {
            safe: false,
            updatesState: true
        },
        entity_action: {
            safe: false,
            updatesState: true
        }
    },
    server: {
        entity_teleport: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_move',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const isPlayer = entity && entity.type === 'player';
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        isPlayer: isPlayer,
                        newPosition: { 
                            x: data.x / 32, 
                            y: data.y / 32, 
                            z: data.z / 32
                        },
                        onGround: data.onGround,
                        teleport: true
                    };
                }
            }
        },
        rel_entity_move: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_move',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const isPlayer = entity && entity.type === 'player';
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        isPlayer: isPlayer,
                        delta: {
                            x: data.dX / 32,
                            y: data.dY / 32,
                            z: data.dZ / 32
                        },
                        onGround: data.onGround
                    };
                }
            }
        },
        entity_look: {
            safe: false,
            updatesState: true,
            // Look-only turns (no movement). Without this, plugins never saw a
            // player turning in place - e.g. a one-tick hit flick.
            eventMapping: {
                name: 'entity_rotation',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;

                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;

                    return {
                        entity: entityWithId,
                        isPlayer: entity.type === 'player',
                        rotation: {
                            yaw: session.gameState.byteToYaw(data.yaw),
                            pitch: session.gameState.byteToPitch(data.pitch)
                        },
                        onGround: data.onGround
                    };
                }
            }
        },
        entity_move_look: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_move',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const isPlayer = entity && entity.type === 'player';
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        isPlayer: isPlayer,
                        delta: {
                            x: data.dX / 32,
                            y: data.dY / 32,
                            z: data.dZ / 32
                        },
                        rotation: {
                            yaw: session.gameState.byteToYaw(data.yaw),
                            pitch: session.gameState.byteToPitch(data.pitch)
                        },
                        onGround: data.onGround
                    };
                }
            }
        },
        entity_velocity: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_velocity',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        velocity: {
                            x: data.velocityX / 8000,
                            y: data.velocityY / 8000,
                            z: data.velocityZ / 8000
                        }
                    };
                }
            }
        },
        entity_head_rotation: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_head_rotation',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;

                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;

                    return {
                        entity: entityWithId,
                        isPlayer: entity.type === 'player',
                        headYaw: session.gameState.byteToYaw(data.headYaw)
                    };
                }
            }
        }
    }
};