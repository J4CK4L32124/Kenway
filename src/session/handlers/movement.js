class MovementHandler {
    constructor(gameState) {
        this.gameState = gameState;
    }

    handleClientPosition(data) {
        this.gameState.lastPosition = { ...this.gameState.position };
        this.gameState.position.x = data.x;
        this.gameState.position.y = data.y;
        this.gameState.position.z = data.z;
        if (data.yaw !== undefined) this.gameState.position.yaw = data.yaw;
        if (data.pitch !== undefined) this.gameState.position.pitch = data.pitch;
    }

    handleRelEntityMove(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            entity.lastPosition = { ...entity.position };
            entity.position.x += data.dX / 32;
            entity.position.y += data.dY / 32;
            entity.position.z += data.dZ / 32;
            entity.onGround = data.onGround;
        }
    }

    handleEntityLook(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            entity.yaw = this.gameState.byteToYaw(data.yaw);
            entity.pitch = this.gameState.byteToPitch(data.pitch);
            entity.onGround = data.onGround;
        }
    }

    handleEntityMoveLook(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            entity.lastPosition = { ...entity.position };
            entity.position.x += data.dX / 32;
            entity.position.y += data.dY / 32;
            entity.position.z += data.dZ / 32;
            entity.yaw = this.gameState.byteToYaw(data.yaw);
            entity.pitch = this.gameState.byteToPitch(data.pitch);
            entity.onGround = data.onGround;
        }
    }

    handleEntityTeleport(data) {
        if (this.gameState.entities.has(data.entityId)) {
            const entity = this.gameState.entities.get(data.entityId);
            entity.lastPosition = { ...entity.position };
            entity.position = { x: data.x / 32, y: data.y / 32, z: data.z / 32 };
            entity.yaw = this.gameState.byteToYaw(data.yaw);
            entity.pitch = this.gameState.byteToPitch(data.pitch);
            entity.onGround = data.onGround;
        }
    }
}

module.exports = MovementHandler;