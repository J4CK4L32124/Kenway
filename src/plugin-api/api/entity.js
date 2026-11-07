class Entities {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    spawnPlayer(entityId, playerUUID, x, y, z, yaw, pitch, currentItem, metadata = []) {
        if (!this.core.isHypixelSafe('spawnPlayer')) {
            this.core.logHypixelBlock('spawnPlayer');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('named_entity_spawn', {
                entityId,
                playerUUID,
                x: Math.floor(x * 32),
                y: Math.floor(y * 32),
                z: Math.floor(z * 32),
                yaw,
                pitch,
                currentItem,
                metadata
            });
        } catch (error) {
            this.core.log(`Failed to spawn player entity: ${error.message}`);
            return false;
        }
    }
    
    spawnLiving(entityId, type, x, y, z, yaw, pitch, headPitch, velocityX = 0, velocityY = 0, velocityZ = 0, metadata = []) {
        if (!this.core.isHypixelSafe('spawnLiving')) {
            this.core.logHypixelBlock('spawnLiving');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('spawn_entity_living', {
                entityId,
                type,
                x: Math.floor(x * 32),
                y: Math.floor(y * 32),
                z: Math.floor(z * 32),
                yaw,
                pitch,
                headPitch,
                velocityX,
                velocityY,
                velocityZ,
                metadata
            });
        } catch (error) {
            this.core.log(`Failed to spawn living entity: ${error.message}`);
            return false;
        }
    }
    
    spawnObject(entityId, type, x, y, z, pitch, yaw, objectData, velocityX = 0, velocityY = 0, velocityZ = 0) {
        if (!this.core.isHypixelSafe('spawnObject')) {
            this.core.logHypixelBlock('spawnObject');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('spawn_entity', {
                entityId,
                type,
                x: Math.floor(x * 32),
                y: Math.floor(y * 32),
                z: Math.floor(z * 32),
                pitch,
                yaw,
                objectData,
                velocityX,
                velocityY,
                velocityZ
            });
        } catch (error) {
            this.core.log(`Failed to spawn object entity: ${error.message}`);
            return false;
        }
    }
    
    spawnExperienceOrb(entityId, x, y, z, count) {
        if (!this.core.isHypixelSafe('spawnExperienceOrb')) {
            this.core.logHypixelBlock('spawnExperienceOrb');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('spawn_entity_experience_orb', {
                entityId,
                x: Math.floor(x * 32),
                y: Math.floor(y * 32),
                z: Math.floor(z * 32),
                count
            });
        } catch (error) {
            this.core.log(`Failed to spawn experience orb: ${error.message}`);
            return false;
        }
    }
    
    setVelocity(entityId, velocityX, velocityY, velocityZ) {
        if (!this.core.isHypixelSafe('setEntityVelocity')) {
            this.core.logHypixelBlock('setEntityVelocity');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_velocity', {
                entityId,
                velocityX,
                velocityY,
                velocityZ
            });
        } catch (error) {
            this.core.log(`Failed to set entity velocity: ${error.message}`);
            return false;
        }
    }
    
    teleport(entityId, x, y, z, yaw, pitch, onGround = true) {
        if (!this.core.isHypixelSafe('teleportEntity')) {
            this.core.logHypixelBlock('teleportEntity');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_teleport', {
                entityId,
                x,
                y,
                z,
                yaw,
                pitch,
                onGround
            });
        } catch (error) {
            this.core.log(`Failed to teleport entity: ${error.message}`);
            return false;
        }
    }
    
    move(entityId, dX, dY, dZ, onGround = true) {
        if (!this.core.isHypixelSafe('moveEntity')) {
            this.core.logHypixelBlock('moveEntity');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('rel_entity_move', {
                entityId,
                dX: Math.floor(dX * 32),
                dY: Math.floor(dY * 32), 
                dZ: Math.floor(dZ * 32),
                onGround
            });
        } catch (error) {
            this.core.log(`Failed to move entity: ${error.message}`);
            return false;
        }
    }
    
    look(entityId, yaw, pitch, onGround = true) {
        if (!this.core.isHypixelSafe('setEntityLook')) {
            this.core.logHypixelBlock('setEntityLook');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_look', {
                entityId,
                yaw,
                pitch,
                onGround
            });
        } catch (error) {
            this.core.log(`Failed to set entity look: ${error.message}`);
            return false;
        }
    }
    
    lookAndMove(entityId, dX, dY, dZ, yaw, pitch, onGround = true) {
        if (!this.core.isHypixelSafe('setEntityLookAndMove')) {
            this.core.logHypixelBlock('setEntityLookAndMove');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_move_look', {
                entityId,
                dX: Math.floor(dX * 32),
                dY: Math.floor(dY * 32),
                dZ: Math.floor(dZ * 32),
                yaw,
                pitch,
                onGround
            });
        } catch (error) {
            this.core.log(`Failed to move and look entity: ${error.message}`);
            return false;
        }
    }
    
    setHeadRotation(entityId, headYaw) {
        if (!this.core.isHypixelSafe('setEntityHeadRotation')) {
            this.core.logHypixelBlock('setEntityHeadRotation');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_head_rotation', {
                entityId,
                headYaw
            });
        } catch (error) {
            this.core.log(`Failed to set entity head rotation: ${error.message}`);
            return false;
        }
    }
    
    setEquipment(entityId, slot, item) {
        if (!this.core.isHypixelSafe('setEntityEquipment')) {
            this.core.logHypixelBlock('setEntityEquipment');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_equipment', {
                entityId,
                slot,
                item
            });
        } catch (error) {
            this.core.log(`Failed to set entity equipment: ${error.message}`);
            return false;
        }
    }
    
    addEffect(entityId, effectId, amplifier, duration, hideParticles = false) {
        if (!this.core.isHypixelSafe('addEntityEffect')) {
            this.core.logHypixelBlock('addEntityEffect');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_effect', {
                entityId,
                effectId,
                amplifier,
                duration,
                hideParticles
            });
        } catch (error) {
            this.core.log(`Failed to add entity effect: ${error.message}`);
            return false;
        }
    }
    
    removeEffect(entityId, effectId) {
        if (!this.core.isHypixelSafe('removeEntityEffect')) {
            this.core.logHypixelBlock('removeEntityEffect');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('remove_entity_effect', {
                entityId,
                effectId
            });
        } catch (error) {
            this.core.log(`Failed to remove entity effect: ${error.message}`);
            return false;
        }
    }
    
    setStatus(entityId, entityStatus) {
        if (!this.core.isHypixelSafe('setEntityStatus')) {
            this.core.logHypixelBlock('setEntityStatus');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_status', {
                entityId,
                entityStatus
            });
        } catch (error) {
            this.core.log(`Failed to set entity status: ${error.message}`);
            return false;
        }
    }
    
    setMetadata(entityId, metadata) {
        if (!this.core.isHypixelSafe('setEntityMetadata')) {
            this.core.logHypixelBlock('setEntityMetadata');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('entity_metadata', {
                entityId,
                metadata
            });
        } catch (error) {
            this.core.log(`Failed to set entity metadata: ${error.message}`);
            return false;
        }
    }
    
    animate(entityId, animation) {
        if (!this.core.isHypixelSafe('animateEntity')) {
            this.core.logHypixelBlock('animateEntity');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('animation', {
                entityId,
                animation
            });
        } catch (error) {
            this.core.log(`Failed to animate entity: ${error.message}`);
            return false;
        }
    }
    
    collect(collectedEntityId, collectorEntityId) {
        if (!this.core.isHypixelSafe('collectEntity')) {
            this.core.logHypixelBlock('collectEntity');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('collect', {
                collectedEntityId,
                collectorEntityId
            });
        } catch (error) {
            this.core.log(`Failed to collect entity: ${error.message}`);
            return false;
        }
    }
    
    attach(entityId, vehicleId, leash = false) {
        if (!this.core.isHypixelSafe('attachEntity')) {
            this.core.logHypixelBlock('attachEntity');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('attach_entity', {
                entityId,
                vehicleId,
                leash
            });
        } catch (error) {
            this.core.log(`Failed to attach entity: ${error.message}`);
            return false;
        }
    }
}

module.exports = Entities; 