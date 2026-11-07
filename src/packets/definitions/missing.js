module.exports = {
    client: {
        update_sign: {
            safe: false,
            eventMapping: {
                name: 'client_update_sign',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    location: data.location,
                    text: data.text
                })
            }
        }
    },
    server: {
        update_sign: {
            safe: true,
            eventMapping: {
                name: 'world_update_sign',
                extractor: (data) => ({
                    location: data.location,
                    text: data.text
                })
            }
        },
        entity_effect: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_effect',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    return entity ? {
                        entity: entity,
                        effectId: data.effectId,
                        amplifier: data.amplifier,
                        duration: data.duration,
                        hideParticles: data.hideParticles
                    } : null;
                }
            }
        },
        remove_entity_effect: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_remove_effect',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    return entity ? {
                        entity: entity,
                        effectId: data.effectId
                    } : null;
                }
            }
        },
        entity_attach: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_attach',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    const vehicle = data.vehicleId !== -1 ? session.gameState.entities.get(data.vehicleId) : null;
                    return entity ? {
                        entity: entity,
                        vehicle: vehicle,
                        leash: data.leash
                    } : null;
                }
            }
        },
        set_experience: {
            safe: false,
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
        update_attributes: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'entity_update_attributes',
                extractor: (data, session) => {
                    const entity = session.gameState.entities.get(data.entityId);
                    return entity ? {
                        entity: entity,
                        properties: data.properties
                    } : null;
                }
            }
        },
        craft_recipe_response: {
            safe: true,
            eventMapping: {
                name: 'inventory_craft_recipe_response',
                extractor: (data) => ({
                    windowId: data.windowId,
                    recipe: data.recipe
                })
            }
        }
    }
};