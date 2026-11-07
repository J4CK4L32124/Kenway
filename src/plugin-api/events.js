const EventEmitter = require('events');

class Events extends EventEmitter {
    constructor(proxy, core) {
        super();
        this.proxy = proxy;
        this.core = core;
        this.eventHandlers = new Map();
        this.eventChains = new Map();
        
        this.packetInterceptors = new Map();
        this.packetInterceptors.set('server', new Map());
        this.packetInterceptors.set('client', new Map());
        
        this.restrictedPackets = {
            client: new Set([
                'position',
                'position_look', 
                'look',
                'entity_action',
                
                'arm_animation',
                'use_entity',

                'block_place',
                'block_dig',
                'player_digging',

                'held_item_slot',
                'window_click',
                'creative_inventory_action',
                'enchant_item',

                'client_command',
                'spectate',
                'steer_vehicle',
                'flying',
                'abilities'
            ]),
            server: new Set([
                'entity_teleport',
                'rel_entity_move',
                'entity_look',
                'entity_move_look',
                'entity_velocity',
                'entity_head_rotation',
                
                'map_chunk',
                'block_change',
                'multi_block_change',
                'explosion',
                'world_border',
                'spawn_position',
                
                'position',
                'abilities',
                'game_state_change',
                'experience',
                'health',
                
                'entity_status',
                'entity_effect',
                'remove_entity_effect',
                
                'set_slot',
                'window_items',
                'entity_equipment',
                
                'login',
                'respawn',
                'keep_alive'
            ])
        };
    }
    
    on(event, handler) {
        if (event.startsWith('packet:')) {
            return this._handlePacketEvent(event, handler, false);
        }
        
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
        
        return () => {
            const handlers = this.eventHandlers.get(event);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.eventHandlers.delete(event);
                }
            }
        };
    }
    
    everyTick(callback) {
        if (typeof callback !== 'function') {
            throw new Error('everyTick callback must be a function');
        }
        
        const interval = setInterval(() => {
            if (!this.core.enabled) {
                clearInterval(interval);
                return;
            }
            
            try {
                callback();
            } catch (error) {
                this.core.log(`Error in tick handler: ${error.message}`);
                if (this.core.debug) {
                    console.error(error);
                }
            }
        }, 50);
        
        return () => {
            clearInterval(interval);
        };
    }
    
    intercept(event, handler) {
        if (event.startsWith('packet:')) {
            return this._handlePacketEvent(event, handler, true);
        }
        
        throw new Error('intercept() only supports packet events. Use format: packet:direction:packetName');
    }
    
    _handlePacketEvent(event, handler, canModify) {
        const parts = event.split(':');
        if (parts.length !== 3 || parts[0] !== 'packet') {
            throw new Error('Packet events must use format: packet:direction:packetName');
        }
        
        const [, direction, packetName] = parts;
        
        if (!['server', 'client'].includes(direction)) {
            throw new Error('Direction must be either "server" or "client"');
        }
        
        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }
        
        if (canModify && !this.canModifyPacket(direction, packetName)) {
            throw new Error(`Cannot intercept packet '${packetName}' - this packet is restricted by safe mode (read-only).`);
        }
        
        const wrappedHandler = (event) => {
            if (!canModify) {
                const readOnlyEvent = {
                    data: event.data,
                    meta: event.meta,
                    cancel: () => {
                        throw new Error(`Cannot cancel packet '${packetName}' - use api.intercept() instead of api.on() for packet modification.`);
                    },
                    modify: () => {
                        throw new Error(`Cannot modify packet '${packetName}' - use api.intercept() instead of api.on() for packet modification.`);
                    }
                };
                handler(readOnlyEvent);
            } else {
                handler(event);
            }
        };
        
        this.registerPacketInterceptor(direction, [packetName], wrappedHandler);
        
        return () => {
            this.unregisterPacketInterceptor(direction, [packetName], wrappedHandler);
        };
    }
    
    emit(event, data) {
        if (!this.core.enabled) return;
        
        if (!data || typeof data !== 'object') {
            this.core.log(`Warning: Event '${event}' emitted with invalid data: ${typeof data}`);
            return;
        }
        
        data.api = this.proxy.pluginAPI;
        
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                } catch (error) {
                    this.core.log(`Error in event handler for ${event}: ${error.message}`);
                    if (this.core.debug) {
                        console.error(error);
                    }
                }
            }
        }
        
        super.emit(event, data);
    }
    
    registerPacketInterceptor(direction, packetNames, handler) {
        if (!this.packetInterceptors.has(direction)) {
            throw new Error(`Invalid direction: ${direction}. Must be 'server' or 'client'`);
        }

        const directionMap = this.packetInterceptors.get(direction);
        
        for (const packetName of packetNames) {
            if (!directionMap.has(packetName)) {
                directionMap.set(packetName, new Set());
            }
            directionMap.get(packetName).add(handler);
        }
    }
    
    unregisterPacketInterceptor(direction, packetNames, handler) {
        if (!this.packetInterceptors.has(direction)) {
            return;
        }
        
        const directionMap = this.packetInterceptors.get(direction);
        
        for (const packetName of packetNames) {
            if (directionMap.has(packetName)) {
                directionMap.get(packetName).delete(handler);
                
                if (directionMap.get(packetName).size === 0) {
                    directionMap.delete(packetName);
                }
            }
        }
    }
    
    hasPacketInterceptors(direction, packetName) {
        const directionMap = this.packetInterceptors.get(direction);
        return directionMap && directionMap.has(packetName) && directionMap.get(packetName).size > 0;
    }
    
    getPacketInterceptors(direction, packetName) {
        const directionMap = this.packetInterceptors.get(direction);
        if (!directionMap || !directionMap.has(packetName)) {
            return [];
        }
        return Array.from(directionMap.get(packetName));
    }
    
    canModifyPacket(direction, packetName) {
        if (this.proxy.packetSystem && this.proxy.packetSystem.handler) {
            return this.proxy.packetSystem.handler.isSafePacket(direction, packetName);
        }   
        const restrictedSet = this.restrictedPackets[direction];
        return !restrictedSet.has(packetName);
    }
}

module.exports = Events; 