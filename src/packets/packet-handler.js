const mc = require('minecraft-protocol');
const fs = require('fs');
const path = require('path');

const chatDefinitions = require('./definitions/chat');
const entityDefinitions = require('./definitions/entity');
const inventoryDefinitions = require('./definitions/inventory');
const miscDefinitions = require('./definitions/misc');
const missingDefinitions = require('./definitions/missing');
const movementDefinitions = require('./definitions/movement');
const playerDefinitions = require('./definitions/player');
const worldDefinitions = require('./definitions/world');
const { AttackDetector, validateAttack } = require('./attack-detector');

class PacketHandler {
    constructor() {
        this.definitions = new Map();
        this.definitions.set('client', new Map());
        this.definitions.set('server', new Map());
        
        this.safePackets = new Map();
        this.safePackets.set('client', new Set());
        this.safePackets.set('server', new Set());
        
        this.loaded = false;
    }

    initialize() {
        if (this.loaded) return;
        
        const definitionModules = [
            chatDefinitions,
            entityDefinitions,
            inventoryDefinitions,
            miscDefinitions,
            missingDefinitions,
            movementDefinitions,
            playerDefinitions,
            worldDefinitions
        ];
        
        for (const definitions of definitionModules) {
            this.loadDefinitions(definitions);
        }
        
        this.loaded = true;
        console.log(`Loaded ${this.definitions.get('client').size} client packets, ${this.definitions.get('server').size} server packets`);
    }

    loadDefinitions(definitions) {
        for (const direction of ['client', 'server']) {
            if (!definitions[direction]) continue;
            
            for (const [packetName, definition] of Object.entries(definitions[direction])) {
                const packet = {
                    name: packetName,
                    safe: definition.safe || false,
                    updatesState: definition.updatesState || false,
                    eventMapping: definition.eventMapping || null
                };
                
                this.definitions.get(direction).set(packetName, packet);
                
                if (packet.safe) {
                    this.safePackets.get(direction).add(packetName);
                }
            }
        }
    }

    async processPacket(session, direction, data, meta) {
        if (!this.loaded) this.initialize();

        // Must run first, synchronously, for every server packet: it relies
        // on packet order to tell who hit whom.
        if (direction === 'server') this.detectAttack(session, meta.name, data);
        
        const definition = this.definitions.get(direction)?.get(meta.name);
        const isSafe = this.safePackets.get(direction)?.has(meta.name) || false;
        
        if (direction === 'client' && meta.name === 'chat' && data.message.startsWith('/')) {
            const handled = session.proxy.commandHandler.handleCommand(data.message, session.client);
            if (handled) return;
        }

        let shouldForward = true;
        let finalData = data;

        if (isSafe && session.proxy.pluginAPI.events.hasPacketInterceptors(direction, meta.name)) {
            const result = await this.handleInterceptors(session, direction, data, meta, isSafe);
            shouldForward = !result.cancelled;
            finalData = result.data;
        }

        if (shouldForward) {
            this.forwardPacket(session, direction, meta.name, finalData);
        }

        if (definition?.updatesState) {
            try {
                session.gameState.updateFromPacket(meta, data, direction === 'server');
            } catch (error) {
                console.error(`Error updating game state for ${direction} packet ${meta.name}:`, error.message);
                if (process.env.DEBUG) {
                    console.error(error.stack);
                }
            }
        }

        if (definition?.eventMapping && session.connected && session.proxy.currentPlayer === session) {
            setImmediate(() => {
                try {
                    this.emitPacketEvent(session, definition.eventMapping, data);
                } catch (error) {
                    console.error(`Error emitting event ${definition.eventMapping.name} for packet ${meta.name}:`, error.message);
                    console.error('Packet data:', JSON.stringify(data, null, 2));
                    console.error(error.stack);
                }
            });
        }
    }

    forwardPacket(session, direction, packetName, data) {
        const target = direction === 'client' ? session.targetClient : session.client;
        
        if (target?.state === mc.states.PLAY) {
            try {
                target.write(packetName, data);
            } catch (error) {
                console.error(`Error forwarding ${direction} packet ${packetName}:`, error.message);
            }
        }
    }

    async handleInterceptors(session, direction, data, meta, canModify) {
        const event = {
            data: { ...data },
            meta: { ...meta },
            cancelled: false,
            modified: false,
            modifiedData: null
        };

        if (canModify) {
            event.modify = (newData) => {
                event.modified = true;
                event.modifiedData = newData;
            };

            event.cancel = () => {
                event.cancelled = true;
            };
        }

        const interceptors = session.proxy.pluginAPI.events.getPacketInterceptors(direction, meta.name);
        for (const handler of interceptors) {
            try {
                await handler(event);
            } catch (error) {
                console.error(`Error in ${direction} packet interceptor for ${meta.name}:`, error.message);
            }
        }

        return {
            cancelled: event.cancelled,
            data: event.modified ? event.modifiedData : event.data
        };
    }

    // Emits 'player_attack' { attacker, target, type } when another player's
    // melee hit is recognised (see attack-detector.js).
    detectAttack(session, packetName, data) {
        if (!session.attackDetector) session.attackDetector = new AttackDetector();
        const attack = session.attackDetector.onServerPacket(packetName, data);
        if (!attack) return;

        // Validate after this burst's state updates have been applied.
        setImmediate(() => {
            if (!session.connected || session.proxy.currentPlayer !== session) return;
            try {
                const players = validateAttack(attack, session.gameState);
                if (!players) return;
                session.proxy.pluginAPI.emit('player_attack', {
                    attacker: players.attacker,
                    target: players.target,
                    type: attack.type
                });
            } catch (error) {
                console.error('Error emitting player_attack:', error.message);
            }
        });
    }

    emitPacketEvent(session, eventMapping, data) {
        try {
            let eventData = null;
            
            if (eventMapping.extractor) {
                eventData = eventMapping.extractor(data, session);
                if (eventData === null) return;
            } else {
                eventData = data;
            }

            session.proxy.pluginAPI.emit(eventMapping.name, eventData);
        } catch (error) {
            console.error(`Error emitting event ${eventMapping.name}:`, error.message);
        }
    }

    isSafePacket(direction, packetName) {
        if (!this.loaded) this.initialize();
        return this.safePackets.get(direction)?.has(packetName) || false;
    }
}

module.exports = PacketHandler;