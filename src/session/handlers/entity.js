class EntityHandler {
    constructor(gameState) {
        this.gameState = gameState;
    }

    handleNamedEntitySpawn(data) {
        const newEntity = {
            type: 'player',
            uuid: data.playerUUID,
            name: null,
            position: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
            lastPosition: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
            yaw: this.gameState.byteToYaw(data.yaw),
            pitch: this.gameState.byteToPitch(data.pitch),
            onGround: true,
            isCrouching: false,
            isSprinting: false,
            isUsingItem: false,
            isOnFire: false,
            heldItem: null,
            equipment: {},
            metadata: data.metadata || [],
            effects: new Map(),
            lastDamaged: 0,
            health: 20
        };

        const initialFlags = newEntity.metadata.find(m => m.key === 0)?.value || 0;
        newEntity.isOnFire = (initialFlags & 0x01) !== 0;
        newEntity.isCrouching = (initialFlags & 0x02) !== 0;
        newEntity.isSprinting = (initialFlags & 0x08) !== 0;
        newEntity.isUsingItem = (initialFlags & 0x10) !== 0;
        
        const healthMeta = newEntity.metadata.find(m => m.key === 6);
        if (healthMeta) newEntity.health = healthMeta.value;

        this.gameState.uuidToEntityId.set(data.playerUUID, data.entityId);
        this.gameState.entities.set(data.entityId, newEntity);
        this.gameState.entityIdToUuid.set(data.entityId, data.playerUUID);
    }

    handleSpawnEntity(data) {
        this.gameState.entities.set(data.entityId, {
            type: data.type,
            position: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
            metadata: data.metadata || [],
            effects: new Map(),
        });
    }

    handleSpawnEntityLiving(data) {
        const newEntity = {
            type: data.type,
            uuid: data.entityUUID,
            position: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
            lastPosition: { x: data.x / 32, y: data.y / 32, z: data.z / 32 },
            yaw: this.gameState.byteToYaw(data.yaw),
            pitch: this.gameState.byteToPitch(data.pitch),
            headPitch: this.gameState.byteToPitch(data.headPitch),
            velocity: {
                x: data.velocityX / 8000,
                y: data.velocityY / 8000,
                z: data.velocityZ / 8000
            },
            onGround: false,
            isCrouching: false,
            isSprinting: false,
            isUsingItem: false,
            isOnFire: false,
            heldItem: null,
            equipment: {},
            metadata: data.metadata || [],
            effects: new Map(),
            lastDamaged: 0,
            health: 20
        };

        const initialFlags = newEntity.metadata.find(m => m.key === 0)?.value || 0;
        newEntity.isOnFire = (initialFlags & 0x01) !== 0;
        newEntity.isCrouching = (initialFlags & 0x02) !== 0;
        newEntity.isSprinting = (initialFlags & 0x08) !== 0;
        newEntity.isUsingItem = (initialFlags & 0x10) !== 0;
        
        const healthMeta = newEntity.metadata.find(m => m.key === 6);
        if (healthMeta) newEntity.health = healthMeta.value;

        this.gameState.entities.set(data.entityId, newEntity);
        
        if (data.entityUUID) {
            this.gameState.uuidToEntityId.set(data.entityUUID, data.entityId);
            this.gameState.entityIdToUuid.set(data.entityId, data.entityUUID);
        }
    }

    handleEntityDestroy(data) {
        if (Array.isArray(data.entityIds)) {
            data.entityIds.forEach(id => {
                const uuid = this.gameState.entityIdToUuid.get(id);
                if (uuid) {
                    this.gameState.uuidToEntityId.delete(uuid);
                }
                this.gameState.entities.delete(id);
                this.gameState.entityIdToUuid.delete(id);
            });
        }
    }

    handleEntityMetadata(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            if (!entity.metadata) entity.metadata = [];
            
            data.metadata.forEach(newMeta => {
                const index = entity.metadata.findIndex(m => m.key === newMeta.key);
                if (index !== -1) {
                    entity.metadata[index] = newMeta;
                } else {
                    entity.metadata.push(newMeta);
                }
                if (newMeta.key === 6) {
                    entity.health = newMeta.value;
                }
            });
            
            const flags = entity.metadata.find(m => m.key === 0)?.value || 0;
            entity.isOnFire = (flags & 0x01) !== 0;
            entity.isCrouching = (flags & 0x02) !== 0;
            entity.isSprinting = (flags & 0x08) !== 0;
            entity.isUsingItem = (flags & 0x10) !== 0;
        }
    }

    handleEntityEquipment(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            if (!entity.equipment) entity.equipment = {};
            entity.equipment[data.slot] = data.item;
            if (data.slot === 0) {
                entity.heldItem = data.item;
            }
        }
    }

    handleEntityEffect(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            if (!entity.effects) entity.effects = new Map();
            entity.effects.set(data.effectId, {
                amplifier: data.amplifier,
                duration: data.duration,
                hideParticles: data.hideParticles
            });
        }
    }

    handleRemoveEntityEffect(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            if (!entity.effects) entity.effects = new Map();
            entity.effects.delete(data.effectId);
        }
    }

    handleEntityStatus(data) {
        if (data.entityStatus === 2 && this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            entity.lastDamaged = Date.now();
        }
    }
}

module.exports = EntityHandler;