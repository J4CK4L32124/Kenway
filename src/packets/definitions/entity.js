module.exports = {
    client: {
        use_entity: {
            safe: false,
            eventMapping: {
                name: 'client_use_entity',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    targetEntity: data.target,
                    mouse: data.mouse,
                    position: data.x !== undefined ? { x: data.x, y: data.y, z: data.z } : undefined
                })
            }
        },
        animation: {
            safe: false
        },
        entity_action: {
            safe: false,
            eventMapping: {
                name: 'client_entity_action',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    actionId: data.actionId,
                    jumpBoost: data.jumpBoost
                })
            }
        }
    },
    server: {
        spawn_entity_living: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'spawn_entity_living',
                extractor: (data, session) => ({
                    entity: {
                        entityId: data.entityId,
                        entityUUID: data.entityUUID,
                        type: data.type,
                        position: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
                        yaw: session.gameState.byteToYaw(data.yaw),
                        pitch: session.gameState.byteToPitch(data.pitch),
                        headPitch: session.gameState.byteToPitch(data.headPitch),
                        metadata: data.metadata
                    }
                })
            }
        },
        named_entity_spawn: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'named_entity_spawn',
                extractor: (data, session) => ({
                    player: {
                        entityId: data.entityId,
                        playerUUID: data.playerUUID,
                        position: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
                        yaw: session.gameState.byteToYaw(data.yaw),
                        pitch: session.gameState.byteToPitch(data.pitch),
                        currentItem: data.currentItem,
                        metadata: data.metadata
                    }
                })
            }
        },
        entity_destroy: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_destroy',
                extractor: (data, session) => {
                    const entities = [];
                    const players = [];
                    
                    // The game state is updated before this extractor runs, so
                    // destroyed entities are normally already gone from it.
                    // Still report every id, or plugins never hear about the
                    // despawn at all (the list used to always arrive empty).
                    for (const entityId of data.entityIds) {
                        const entity = session.gameState.entities.get(entityId);
                        const entityWithId = Object.assign({}, entity || {});
                        entityWithId.entityId = entityId;

                        entities.push(entityWithId);
                        if (entity && entity.type === 'player') {
                            players.push(entityWithId);
                        }
                    }

                    return { entities, players, entityIds: data.entityIds };
                }
            }
        },
        entity_metadata: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'entity_metadata',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        metadata: data.metadata
                    };
                }
            }
        },
        entity_equipment: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'entity_equipment',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const isPlayer = entity && entity.type === 'player';
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        isPlayer: isPlayer,
                        slot: data.slot,
                        item: data.item
                    };
                }
            }
        },
        animation: {
            safe: true,
            eventMapping: {
                name: 'entity_animation',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const isPlayer = entity && entity.type === 'player';
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        isPlayer: isPlayer,
                        animation: data.animation
                    };
                }
            }
        },
        entity_status: {
            safe: true,
            eventMapping: {
                name: 'entity_status',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    if (!entity) return null;
                    
                    const entityWithId = Object.assign({}, entity);
                    entityWithId.entityId = data.entityId;
                    
                    return {
                        entity: entityWithId,
                        status: data.entityStatus
                    };
                }
            }
        }
    }
};