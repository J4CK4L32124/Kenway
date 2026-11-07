module.exports = {
    client: {
        block_place: {
            safe: false,
            eventMapping: {
                name: 'client_block_place',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    location: data.location,
                    direction: data.direction,
                    heldItem: data.heldItem,
                    cursorX: data.cursorX,
                    cursorY: data.cursorY,
                    cursorZ: data.cursorZ
                })
            }
        },
        block_dig: {
            safe: false,
            eventMapping: {
                name: 'client_block_dig',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    status: data.status,
                    location: data.location,
                    face: data.face
                })
            }
        }
    },
    server: {
        map_chunk: {
            safe: false,
            updatesState: true
        },
        map_chunk_bulk: {
            safe: false,
            updatesState: true
        },
        block_change: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'world_block_change',
                extractor: (data) => ({
                    location: data.location,
                    type: data.type
                })
            }
        },
        multi_block_change: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'world_multi_block_change',
                extractor: (data) => ({
                    chunkX: data.chunkX,
                    chunkZ: data.chunkZ,
                    records: data.records
                })
            }
        },
        explosion: {
            safe: true,
            eventMapping: {
                name: 'world_explosion',
                extractor: (data) => ({
                    x: data.x,
                    y: data.y,
                    z: data.z,
                    radius: data.radius,
                    records: data.records,
                    playerMotionX: data.playerMotionX,
                    playerMotionY: data.playerMotionY,
                    playerMotionZ: data.playerMotionZ
                })
            }
        },
        sound_effect: {
            safe: true,
            eventMapping: {
                name: 'world_sound',
                extractor: (data) => ({
                    soundName: data.soundName,
                    x: data.x / 8,
                    y: data.y / 8,
                    z: data.z / 8,
                    volume: data.volume,
                    pitch: data.pitch
                })
            }
        },
        named_sound_effect: {
            safe: true,
            eventMapping: {
                name: 'world_sound',
                extractor: (data) => ({
                    soundName: data.soundName,
                    x: data.x / 8,
                    y: data.y / 8,
                    z: data.z / 8,
                    volume: data.volume,
                    pitch: data.pitch
                })
            }
        },
        // 1.8's particle packet is named world_particles (not particle).
        world_particles: {
            safe: true,
            eventMapping: {
                name: 'world_particle',
                extractor: (data) => ({
                    particleId: data.particleId,
                    longDistance: data.longDistance,
                    x: data.x,
                    y: data.y,
                    z: data.z,
                    offsetX: data.offsetX,
                    offsetY: data.offsetY,
                    offsetZ: data.offsetZ,
                    particleData: data.particleData,
                    particles: data.particles,
                    data: data.data
                })
            }
        },
        game_state_change: {
            safe: false,
            eventMapping: {
                name: 'world_game_state_change',
                extractor: (data) => ({
                    reason: data.reason,
                    gameMode: data.gameMode
                })
            }
        },
        update_time: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'world_time',
                extractor: (data) => ({
                    age: data.age,
                    time: data.time
                })
            }
        }
    }
};