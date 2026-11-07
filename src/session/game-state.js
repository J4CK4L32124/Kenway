const PlayerHandler = require('./handlers/player');
const EntityHandler = require('./handlers/entity');
const MovementHandler = require('./handlers/movement');
const InventoryHandler = require('./handlers/inventory');
const MiscHandler = require('./handlers/misc');

function stripColorCodes(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/§./g, '');
}

class GameState {
    constructor() {
        this.reset();

        this.playerHandler = new PlayerHandler(this);
        this.entityHandler = new EntityHandler(this);
        this.movementHandler = new MovementHandler(this);
        this.inventoryHandler = new InventoryHandler(this);
        this.miscHandler = new MiscHandler(this);
    }

    byteToYaw(byte) {
        return (byte / 256) * 360;
    }
    
    byteToPitch(byte) {
        const signed = byte > 127 ? byte - 256 : byte;
        return signed * (90 / 128);
    }

    reset() {
        this.loginPacket = null;
        this.playerInfo = new Map();
        this.teams = new Map();
        this.entities = new Map();
        this.entityIdToUuid = new Map();
        this.uuidToEntityId = new Map();
        this.scoreboards = new Map();
        this.position = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
        this.lastPosition = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
        this.health = 20;
        // NOTE: must not use Array(45).fill({...}) - fill() shares a single
        // object reference across every slot, so any future in-place mutation
        // of one unwritten slot would silently corrupt all 45 of them.
        this.inventory = { slots: Array.from({ length: 45 }, () => ({ blockId: -1 })), cursorItem: { blockId: -1 }, heldItemSlot: 0 };
    }

    updateFromPacket(meta, data, fromServer) {
        if (!fromServer) {
            this._handleClientPacket(meta, data);
            return;
        }
        
        this._handleServerPacket(meta, data);
    }

    _handleClientPacket(meta, data) {
        switch (meta.name) {
            case 'held_item_slot':
                this.inventoryHandler.handleHeldItemSlot(data);
                break;
            case 'window_click':
                this.inventoryHandler.handleWindowClick(data);
                break;
            case 'close_window':
                this.inventoryHandler.handleCloseWindow(data);
                break;
            case 'position':
            case 'position_look':
                this.movementHandler.handleClientPosition(data);
                break;
        }
    }

    _handleServerPacket(meta, data) {
        switch (meta.name) {
            

            case 'login':
                this.playerHandler.handleLogin(data);
                break;
            case 'respawn':
                this.playerHandler.handleRespawn(data);
                break;
            case 'player_info':
                this.playerHandler.handlePlayerInfo(data);
                break;
            case 'update_health':
                this.playerHandler.handleUpdateHealth(data);
                break;
            case 'experience':
                this.playerHandler.handleExperience(data);
                break;
            case 'game_state_change':
                this.playerHandler.handleGameStateChange(data);
                break;


            case 'named_entity_spawn':
                this.entityHandler.handleNamedEntitySpawn(data);
                break;
            case 'spawn_entity':
                this.entityHandler.handleSpawnEntity(data);
                break;
            case 'spawn_entity_living':
                this.entityHandler.handleSpawnEntityLiving(data);
                break;
            case 'entity_destroy':
                this.entityHandler.handleEntityDestroy(data);
                break;
            case 'entity_metadata':
                this.entityHandler.handleEntityMetadata(data);
                break;
            case 'entity_equipment':
                this.entityHandler.handleEntityEquipment(data);
                break;
            case 'entity_effect':
                this.entityHandler.handleEntityEffect(data);
                break;
            case 'remove_entity_effect':
                this.entityHandler.handleRemoveEntityEffect(data);
                break;
            case 'entity_status':
                this.entityHandler.handleEntityStatus(data);
                break;


            case 'rel_entity_move':
                this.movementHandler.handleRelEntityMove(data);
                break;
            case 'entity_look':
                this.movementHandler.handleEntityLook(data);
                break;
            case 'entity_move_look':
                this.movementHandler.handleEntityMoveLook(data);
                break;
            case 'entity_teleport':
                this.movementHandler.handleEntityTeleport(data);
                break;


            case 'set_slot':
                this.inventoryHandler.handleSetSlot(data);
                break;
            case 'window_items':
                this.inventoryHandler.handleWindowItems(data);
                break;
            case 'open_window':
                this.inventoryHandler.handleOpenWindow(data);
                break;
            case 'close_window':
                this.inventoryHandler.handleCloseWindow(data);
                break;
            case 'transaction':
                this.inventoryHandler.handleTransaction(data);
                break;
            case 'scoreboard_team':
                this.miscHandler.handleTeam(data);
                break;
            case 'scoreboard_objective':
                this.miscHandler.handleScoreboard(data);
                break;
            case 'scoreboard_score':
                this.miscHandler.handleScore(data);
                break;
        }
    }

    getPlayerByName(name) {
        for (const [uuid, info] of this.playerInfo) {
            if (info.name === name) {
                return { uuid, ...info };
            }
        }
        return null;
    }

    getPlayerTeam(playerName) {
        for (const [teamName, team] of this.teams) {
            if (team.players.has(playerName)) {
                return { name: teamName, ...team };
            }
        }
        return null;
    }

    getFormattedName(uuid) {
        const info = this.playerInfo.get(uuid);
        if (!info) return null;

        let name = info.name;
        if (info.displayName) {
            try {
                const parsed = JSON.parse(info.displayName);
                name = this.extractText(parsed);
            } catch (e) {
                name = info.displayName;
            }
        }

        const team = this.getPlayerTeam(info.name);
        if (team) {
            return `${team.prefix}${name}${team.suffix}`;
        }

        return name;
    }

    extractText(component) {
        if (typeof component === 'string') return component;
        if (!component) return '';
        
        let text = component.text || '';
        if (component.extra && Array.isArray(component.extra)) {
            for (const extra of component.extra) {
                text += this.extractText(extra);
            }
        }
        return text;
    }

    getPlayerByEntityId(entityId) {
        const uuid = this.entityIdToUuid.get(entityId);
        if (!uuid) return null;
        
        const info = this.playerInfo.get(uuid);
        if (!info) return null;

        return {
            uuid,
            name: info.name,
            entityId,
            ...info
        };
    }
}

module.exports = GameState;