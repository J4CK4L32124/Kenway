const mcData = require('minecraft-data')('1.8');
const lodash = require('lodash');

const NULL_ITEM = Object.freeze({ blockId: -1 });

class InventoryHandler {
    constructor(gameState) {
        this.gameState = gameState;
        this.containerSizes = new Map(
            [[0, 0]]
        );
        this.pendingActions = new Map();
        this.currentContainerId = 0;
        this.currentContainer = null;
        this.dragState = -1;
        this.dragSlots = new Array();

        setInterval(() => {
            this._pruneStaleActions();
        }, 5000);
    }

    handleHeldItemSlot(data) {
        this.gameState.inventory.heldItemSlot = data.slotId;
    }

    handleWindowClick(data) {
        if (data.windowId !== this.currentContainerId) {
            return;
        }

        if (data.slot === -1) {
            return; // invalid packet, only sent when client is out of sync with itself, can be safely ignored
        }

        const windowId = data.windowId;
        const actionNumber = data.action;
        const slot = data.slot;
        const item = data.item;
        const cursorItem = lodash.cloneDeep(this.gameState.inventory.cursorItem);
        const button = data.mouseButton;
        let action;

        switch (data.mode) {
        case 0: // Normal click
            switch (data.mouseButton) {
            case 0: // Left click
                // Create an action for rollback in case of rejected transaction
                action = this._createAction(windowId, actionNumber, { [slot]: this._getItem(slot), cursor: lodash.cloneDeep(cursorItem) });
                this._addAction(action);

                if (slot === -999) { // Left click outside inventory
                    this._setCursorItem(NULL_ITEM);
                    return;
                }

                if (this._isEmpty(cursorItem) || this._isEmpty(item)) { // Left click, empty slot or cursor
                    this._swapWithCursor(slot);
                    return;
                }

                if (this._areSameItem(cursorItem, item)) { // Left click, same item in cursor and slot
                    this._fillSlotFromCursor(slot);
                    return;
                }

                // Only option left is a left click with different items in cursor and slot
                this._swapWithCursor(slot);
                return;

            case 1: // Right click
                // Create an action for rollback in case of rejected transaction
                action = this._createAction(windowId, actionNumber, { [slot]: this._getItem(slot), cursor: lodash.cloneDeep(cursorItem) });
                this._addAction(action);

                if (slot === -999) { // Right click outside inventory
                    this._incrementCursorItem(-1);
                    return;
                }

                if (this._isEmpty(cursorItem)) { // Right click, empty cursor
                    this._moveHalfToCursor(slot);
                    return;
                }

                if (this._isEmpty(item) || this._areSameItem(item, cursorItem)) { // Right click, empty slot or same item
                    this._moveOneToSlot(slot);
                    return;
                }

                // Only option left is a right click with different items in cursor and slot
                this._swapWithCursor(slot);
                return;
            }

        case 1: // Shift-click
            // Create an action for rollback in case of rejected transaction
            action = this._createAction(windowId, actionNumber, null, this._getFullSnapshot());
            this._addAction(action);

            if (windowId === 0) { // No container open
                if (this._isInHotbar(slot)) { // Shift-click in hotbar, no container open
                    this._setSlot(slot, this._distributeItems(this._getItem(slot), ['inventory']));
                    return;
                }

                if (this._isInInventory(slot)) { // Shift-click in inventory, no container open
                    this._setSlot(slot, this._distributeItems(this._getItem(slot), ['hotbar']));
                    return;
                }

                // Only option left is a shift-click in crafting grid with no container open
                this._setSlot(slot, this._distributeItems(this._getItem(slot), ['inventory', 'hotbar']));
                return;
            }

            // Shift-click with a container open
            if (this._isInContainer(slot)) { // Shift-click in a container
                this._setSlot(slot, this._distributeItems(this._getItem(slot), ['hotbar', 'inventory']));
                return;
            }

            // Only option left is a shift-click in inventory or hotbar with a container open
            this._setSlot(slot, this._distributeItems(this._getItem(slot), ['container']));
            return;

        case 2: // Number key
            // Create an action for rollback in case of rejected transaction
            action = this._createAction(windowId, actionNumber, null, this._getFullSnapshot());
            this._addAction(action);

            const numberSlot = this._getSlotFromNumberKey(data.button);
            if (this._isInContainer(slot)) { // Number key pressed while hovering a container slot
                if (this._isEmpty(slot)) { // The container slot is empty
                    this._moveItem(numberSlot, slot);
                    return;
                }

                if (this._isFull('inventory')) { // The inventory is full, nowhere to move the item
                    return;
                }

                // Number key pressed while hovering a non-empty container slot, room in inventory
                this._distributeItems(this._moveItem(slot, numberSlot), ['hotbar', 'inventory']);
                return;
            }

            // Number key pressed while hovering an inventory or hotbar slot
            this._swapSlots(slot, numberSlot);
            return;

        case 3: // Middle click
            // Only in creative mode, not implemented
            return;

        case 4: // Drop
            // Create an action for rollback in case of rejected transaction
            action = this._createAction(windowId, actionNumber, { [slot]: this._getItem(slot), cursor: lodash.cloneDeep(cursorItem) });
            this._addAction(action);

            if (slot === -999) { // Clicking outside inventory
                if (this._isEmpty(cursorItem)) {
                    return;
                }
                switch (button) {
                case 0: // Left click
                    this._incrementCursorItem(-1);
                    return;

                case 1: // Right click
                    this._setCursorItem(NULL_ITEM);
                    return;
                }
            }

            switch (data.button) {
            case 0: // Q
                this._incrementSlot(slot, -1);
                return;

            case 1: // Ctrl + Q
                this._setSlot(slot, NULL_ITEM);
                return;
            }

        case 5: // Drag
            // Create an action for rollback in case of rejected transaction
            action = this._createAction(windowId, actionNumber, null, this._getFullSnapshot());
            this._addAction(action);

            if (this.dragState === -1) { // Not currently dragging, start drag
                if (slot === -999) {
                    this.dragState = button;
                }
                return;
            }

            if (slot !== -999) { // Attempt to add a slot to a drag
                if (button - 1 === this.dragState && !this.dragSlots.includes(slot)) { // Valid drag slot
                    this.dragSlots.push(slot);
                }
                return;
            }

            // Only option left is to end and apply the drag
            if (button - 2 === this.dragState) { // Make sure the drag state is correct
                switch (this.dragState) {
                case 0: // Left click drag
                    this._applyLeftDrag(cursorItem, this.dragSlots);
                    return;

                case 4: // Right click drag
                    this._applyRightDrag(cursorItem, this.dragSlots);
                    return;
                }
            }

        case 6: // Double click
            // Create an action for rollback in case of rejected transaction
            action = this._createAction(windowId, actionNumber, null, this._getFullSnapshot());
            this._addAction(action);

            this._gatherToCursor(cursorItem, slot);
            return;
        }
    }

    handleCloseWindow(data) {
        this.currentContainerId = 0;
        this.currentContainer = null;
        this.containerSizes.delete(data.windowId);
    }

    handleSetSlot(data) {
        if (data.slot === -1) {
            this._setCursorItem(data.item);
            return;
        }
        if (data.windowId === 0 && data.slot >= 0 && data.slot < 45) { // No container open
            this.gameState.inventory.slots[data.slot] = data.item;
        } else { // Container open
            if (data.windowId !== this.currentContainerId) {
                    return; // Ignore slots not in the current container
            }
            if (data.slot < this.containerSizes.get(data.windowId)) { // Slot not in inventory
                this.currentContainer[data.slot] = data.item;
            } else { // Slot in inventory
                this.gameState.inventory.slots[data.slot - this.containerSizes.get(data.windowId) + 9] = data.item;
            }
        }
    }

    handleWindowItems(data) {
        if (data.windowId === 0) {
            this.gameState.inventory.slots = data.items.slice(0, 45);
        } else {
            const inventoryData = data.items.slice(-36);
            for (let i = 0; i < 36; i++) {
                this.gameState.inventory.slots[i + 9] = inventoryData[i] || lodash.cloneDeep(NULL_ITEM);
            }
            if (data.windowId !== this.currentContainerId) {
                return; // Ignore items not in the current container
            }
            this.currentContainer = data.items.slice(0, this.containerSizes.get(data.windowId));
        }
    }

    handleOpenWindow(data) {
        this.currentContainerId = data.windowId;
        // Same shared-reference footgun as the old inventory.slots init
        // (Array.fill() with a single object instance, not a factory) -
        // every mutation site here happens to be guarded by _isEmpty()
        // first so it isn't an active bug today, but a fresh empty-slot
        // array of truly independent objects is one line and removes the
        // risk for good.
        this.currentContainer = Array.from({ length: data.slotCount }, () => lodash.cloneDeep(NULL_ITEM));
        this.containerSizes.set(data.windowId, data.slotCount);
    }

    handleTransaction(data) {
        const windowActions = this.pendingActions.get(data.windowId);
        if (!windowActions) return;

        const action = windowActions.get(data.action);
        if (!action) return;

        if (data.accepted) {
            // Transaction accepted, remove the action
            windowActions.delete(data.action);
        } else { // Transaction rejected, rollback
            if (action.fullSnapshot) {
                if (action.windowId !== this.currentContainerId) {
                    return; // Ignore rollbacks not in the current container
                }
                this.currentContainer = lodash.cloneDeep(action.fullSnapshot.container);
                this.gameState.inventory = lodash.cloneDeep(action.fullSnapshot.inventory);
            } else {
                for (const [slot, item] of Object.entries(action.rollbackData)) {
                    if (slot === 'cursor') {
                        this._setCursorItem(item);
                    } else if (Number(slot) !== -999) {
                        // NOTE: Object.entries() keys are always strings, so
                        // the original `slot !== -999` (string !== number)
                        // was always true - the -999 ("clicked outside the
                        // inventory") guard never actually fired, and
                        // _setSlot('-999', item) would run and tack a stray
                        // non-numeric '-999' property onto the slots/container
                        // array. Harmless in practice (array iteration and
                        // indexed access by number ignore it), but not what
                        // the guard was meant to do.
                        this._setSlot(Number(slot), item);
                    }
                }
            }
            windowActions.delete(data.action);
        }
        if (windowActions.size === 0) {
            this.pendingActions.delete(data.windowId);
        }
    }

    _pruneStaleActions() {
        const now = Date.now();
        for (const [windowId, actionMap] of this.pendingActions) {
            for (const [actionNumber, action] of actionMap) {
                if (now - action.timestamp > 5000) {
                    actionMap.delete(actionNumber);
                }
            }
            if (actionMap.size === 0) {
                this.pendingActions.delete(windowId);
            }
        }
    }

    _createAction(windowId, actionNumber, rollbackData, fullSnapshot = null) {
        return {
            windowId: windowId,
            actionNumber: actionNumber,
            timestamp: Date.now(),
            rollbackData: rollbackData,
            fullSnapshot: fullSnapshot,
        };
    }

    _addAction(action) {
        if (!this.pendingActions.has(action.windowId)) {
            this.pendingActions.set(action.windowId, new Map());
        }
        this.pendingActions.get(action.windowId).set(action.actionNumber, action);
    }

    _getFullSnapshot() {
        return {
            inventory: this.gameState.inventory,
            container: this.currentContainer ? lodash.cloneDeep(this.currentContainer) : null
        };
    }

    _setSlot(slot, item) {
        const safeItem = (item && item.itemCount <= 0) ? lodash.cloneDeep(NULL_ITEM) : lodash.cloneDeep(item);
        if (this.currentContainerId === 0) {
            this.gameState.inventory.slots[slot] = safeItem;
        } else if (slot < this.containerSizes.get(this.currentContainerId)) {
            this.currentContainer[slot] = safeItem;
        } else {
            const inventoryIndex = slot - this.containerSizes.get(this.currentContainerId) + 9;
            this.gameState.inventory.slots[inventoryIndex] = safeItem;
        }
    }

    _getItem(slot) {
        if (slot === -999) {
            return null;
        }
        if (this.currentContainerId === 0) {
            return this.gameState.inventory.slots[slot];
        }
        if (slot < this.containerSizes.get(this.currentContainerId)) {
            return this.currentContainer[slot];
        }
        const inventoryIndex = slot - this.containerSizes.get(this.currentContainerId) + 9;
        return this.gameState.inventory.slots[inventoryIndex];
    }

    _isEmpty(item) {
        return item.blockId === -1;
    }

    _setCursorItem(item) {
        this.gameState.inventory.cursorItem = (item && item.itemCount <= 0) ? lodash.cloneDeep(NULL_ITEM) : lodash.cloneDeep(item);
    }

    _swapWithCursor(slot) {
        const cursorItem = lodash.cloneDeep(this.gameState.inventory.cursorItem);
        this._setCursorItem(this._getItem(slot));
        this._setSlot(slot, cursorItem);
    }

    _areSameItem(item1, item2) {
        return lodash.isEqual(
            lodash.omit(item1, 'itemCount'),
            lodash.omit(item2, 'itemCount')
        );
    }

    _incrementCursorItem(int) {
        if (this._isEmpty(this.gameState.inventory.cursorItem)) {
            return;
        }
        this.gameState.inventory.cursorItem.itemCount += int;
        if (this.gameState.inventory.cursorItem.itemCount <= 0) {
            this._setCursorItem(NULL_ITEM);
        }
    }

    _isInHotbar(slot) {
        if (this.currentContainerId === 0) {
            return slot >= 36 && slot < 45;
        }
        inventoryIndex = slot - this.containerSizes.get(this.currentContainerId) + 9;
        return inventoryIndex >= 36 && inventoryIndex < 45;
    }

    _isInInventory(slot) {
        if (this.currentContainerId === 0) {
            return slot >= 9 && slot < 36;
        }
        inventoryIndex = slot - this.containerSizes.get(this.currentContainerId) + 9;
        return inventoryIndex >= 9 && inventoryIndex < 36;
    }

    _isInContainer(slot) {
        if (this.currentContainerId === 0) {
            return false;
        }
        return slot >= 0 && slot < this.containerSizes.get(this.currentContainerId);
    }

    _swapSlots(slot1, slot2) {
        const temp = this._getItem(slot1);
        this._setSlot(slot1, this._getItem(slot2));
        this._setSlot(slot2, temp);
    }

    _incrementSlot(slot, int) {
        if (this._isEmpty(this._getItem(slot))) {
            return;
        }
        const item = this._getItem(slot);
        item.itemCount += int;
        if (item.itemCount <= 0) {
            this._setSlot(slot, NULL_ITEM);
        } else {
            this._setSlot(slot, item);
        }
    }

    _setSlotCount(slot, count) {
        if (this._isEmpty(this._getItem(slot))) {
            return;
        }
        const item = this._getItem(slot);
        item.itemCount = count;
        if (item.itemCount <= 0) {
            this._setSlot(slot, NULL_ITEM);
        } else {
            this._setSlot(slot, item);
        }
    }

    _fillSlotFromCursor(slot) {
        let count = this.gameState.inventory.cursorItem.itemCount + this._getItem(slot).itemCount;
        const maxStackSize = this._getStackSize(this._getItem(slot).blockId);
        if (count > maxStackSize) {
            this._setSlotCount(slot, maxStackSize);
            this._setCursorItem({...lodash.omit(this.gameState.inventory.cursorItem, 'itemCount'), itemCount: count - maxStackSize});
        } else {
            this._setSlotCount(slot, count);
            this._setCursorItem(NULL_ITEM);
        }
    }

    _moveHalfToCursor(slot) {
        if (this._isEmpty(this._getItem(slot))) {
            return;
        }
        const item = this._getItem(slot);
        const halfCount = Math.ceil(item.itemCount / 2);
        this._setCursorItem({...lodash.omit(item, 'itemCount'), itemCount: halfCount});
        this._incrementSlot(slot, -halfCount);
        if (this._getItem(slot).itemCount <= 0) {
            this._setSlot(slot, NULL_ITEM);
        }
    }

    _moveOneToSlot(slot) {
        if (this._isEmpty(this._getItem(slot))) {
            this._setSlot(slot, {...lodash.omit(this.gameState.inventory.cursorItem, 'itemCount'), itemCount: 1});
            this._incrementCursorItem(-1);
            return;
        }
        const maxStackSize = this._getStackSize(this._getItem(slot).blockId);
        if (this._getItem(slot).itemCount >= maxStackSize) {
            return;
        }
        this._incrementSlot(slot, 1);
        this._incrementCursorItem(-1);
    }

    _distributeItems(item, locations) {
        if (this._isEmpty(item)) {
            return NULL_ITEM;
        }
        const maxStackSize = this._getStackSize(item.blockId);
        let remainingCount = item.itemCount;
        for (const location of locations) {
            if (remainingCount <= 0) {
                return NULL_ITEM;
            }
            switch (location) {
            case 'hotbar':
                for (let i = 36; i < 45; i++) {
                    if (this._areSameItem(this.gameState.inventory.slots[i], item)) {
                        const availableSpace = maxStackSize - this.gameState.inventory.slots[i].itemCount;
                        if (availableSpace > 0) {
                            const toAdd = Math.min(remainingCount, availableSpace);
                            this.gameState.inventory.slots[i].itemCount += toAdd;
                            remainingCount -= toAdd;
                            if (remainingCount <= 0) {
                                return NULL_ITEM;
                            }
                        }
                    }
                }
                break;
            case 'inventory':
                for (let i = 9; i < 36; i++) {
                    if (this._areSameItem(this.gameState.inventory.slots[i], item)) {
                        const availableSpace = maxStackSize - this.gameState.inventory.slots[i].itemCount;
                        if (availableSpace > 0) {
                            const toAdd = Math.min(remainingCount, availableSpace);
                            this.gameState.inventory.slots[i].itemCount += toAdd;
                            remainingCount -= toAdd;
                            if (remainingCount <= 0) {
                                return NULL_ITEM;
                            }
                        }
                    }
                }
                break;
            case 'container':
                for (let i = 0; i < this.containerSizes.get(this.currentContainerId); i++) {
                    if (this._areSameItem(this.currentContainer[i], item)) {
                        const availableSpace = maxStackSize - this.currentContainer[i].itemCount;
                        if (availableSpace > 0) {
                            const toAdd = Math.min(remainingCount, availableSpace);
                            this.currentContainer[i].itemCount += toAdd;
                            remainingCount -= toAdd;
                            if (remainingCount <= 0) {
                                return NULL_ITEM;
                            }
                        }
                    }
                }
                break;
            }
        }
        for (const location of locations) {
            if (remainingCount <= 0) {
                return NULL_ITEM;
            }
            switch (location) {
            case 'hotbar':
                for (let i = 36; i < 45; i++) {
                    if (this._isEmpty(this.gameState.inventory.slots[i])) {
                        const toAdd = Math.min(remainingCount, maxStackSize);
                        this.gameState.inventory.slots[i] = {...lodash.omit(item, 'itemCount'), itemCount: toAdd};
                        remainingCount -= toAdd;
                        if (remainingCount <= 0) {
                            return NULL_ITEM;
                        }
                    }
                }
                break;
            case 'inventory':
                for (let i = 9; i < 36; i++) {
                    if (this._isEmpty(this.gameState.inventory.slots[i])) {
                        const toAdd = Math.min(remainingCount, maxStackSize);
                        this.gameState.inventory.slots[i] = {...lodash.omit(item, 'itemCount'), itemCount: toAdd};
                        remainingCount -= toAdd;
                        if (remainingCount <= 0) {
                            return NULL_ITEM;
                        }
                    }
                }
                break;
            case 'container':
                for (let i = 0; i < this.containerSizes.get(this.currentContainerId); i++) {
                    if (this._isEmpty(this.currentContainer[i])) {
                        const toAdd = Math.min(remainingCount, maxStackSize);
                        this.currentContainer[i] = {...lodash.omit(item, 'itemCount'), itemCount: toAdd};
                        remainingCount -= toAdd;
                        if (remainingCount <= 0) {
                            return NULL_ITEM;
                        }
                    }
                }
                break;
            }
        }
    }

    _moveItem(slot1, slot2) {
        if (this._isEmpty(this._getItem(slot1))) {
            return NULL_ITEM;
        }
        if (this._isEmpty(this._getItem(slot2))) {
            this._setSlot(slot2, this._getItem(slot1));
            this._setSlot(slot1, NULL_ITEM);
            return NULL_ITEM;
        }
        if (this._areSameItem(this._getItem(slot1), this._getItem(slot2))) {
            const sum = this._getItem(slot1).itemCount + this._getItem(slot2).itemCount;
            const maxStackSize = this._getStackSize(this._getItem(slot1).blockId);
            if (sum <= maxStackSize) {
                this._setSlot(slot2, {...lodash.omit(this._getItem(slot1), 'itemCount'), itemCount: sum});
                this._setSlot(slot1, NULL_ITEM);
                return NULL_ITEM;
            }
            this._setSlot(slot2, {...lodash.omit(this._getItem(slot1), 'itemCount'), itemCount: maxStackSize});
            remainder = lodash.cloneDeep({...lodash.omit(this._getItem(slot1), 'itemCount'), itemCount: sum - maxStackSize});
            this._setSlot(slot1, NULL_ITEM);
            return remainder;
        }
        remainder = lodash.cloneDeep(this._getItem(slot2));
        this._setSlot(slot2, this._getItem(slot1));
        this._setSlot(slot1, NULL_ITEM);
        return remainder;
    }

    _getSlotFromNumberKey(numberKey) {
        if (this.currentContainerId === 0) {
            return numberKey + 36;
        }
        return numberKey + 27 + this.containerSizes.get(this.currentContainerId);
    }

    _isFull(locations) {
        for (const location of locations) {
            switch (location) {
            case 'hotbar':
                for (let i = 36; i < 45; i++) {
                    if (this._isEmpty(this.gameState.inventory.slots[i])) {
                        return false;
                    }
                }
            case 'inventory':
                for (let i = 9; i < 36; i++) {
                    if (this._isEmpty(this.gameState.inventory.slots[i])) {
                        return false;
                    }
                }
            case 'container':
                for (let i = 0; i < this.containerSizes.get(this.currentContainerId); i++) {
                    if (this._isEmpty(this.currentContainer[i])) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    _applyLeftDrag(cursorItem, dragSlots) {
        let count = cursorItem.itemCount;
        const maxStackSize = this._getStackSize(cursorItem.blockId);
        const maxItemsPerSlot = Math.floor(count / dragSlots.length);
        for (const dragSlot of dragSlots) {
            if (count <= 0) break;
            let countToAdd;
            if (this._isEmpty(this._getItem(dragSlot))) {
                countToAdd = Math.min(count, maxItemsPerSlot, maxStackSize);
                this._setSlot(dragSlot, {...lodash.omit(cursorItem, 'itemCount'), itemCount: countToAdd});
            } else {
                countToAdd = Math.min(count, maxItemsPerSlot, maxStackSize - this._getItem(dragSlot).itemCount);
                this._incrementSlot(dragSlot, countToAdd);
            }
            count -= countToAdd;
        }
        if (count <= 0) {
            this._setCursorItem(NULL_ITEM);
        } else {
            this._setCursorItem({...lodash.omit(cursorItem, 'itemCount'), itemCount: count});
        }
        this.dragSlots = new Array();
        this.dragState = -1;
    }

    _applyRightDrag(cursorItem, dragSlots) {
        let count = cursorItem.itemCount;
        const maxStackSize = this._getStackSize(cursorItem.blockId);
        for (const dragSlot of dragSlots) {
            if (count <= 0) break;
            if (this._isEmpty(this._getItem(dragSlot))) {
                this._setSlot(dragSlot, {...lodash.omit(cursorItem, 'itemCount'), itemCount: 1});
                count -= 1;
            } else if (this._getItem(dragSlot).itemCount < maxStackSize) {
                this._incrementSlot(dragSlot, 1);
                count -= 1;
            }
        }
        if (count <= 0) {
            this._setCursorItem(NULL_ITEM);
        } else {
            this._setCursorItem({...lodash.omit(cursorItem, 'itemCount'), itemCount: count});
        }
        this.dragSlots = new Array();
        this.dragState = -1;
    }

    _gatherToCursor(cursorItem, slot) {
        if (this._isEmpty(cursorItem) && this._isEmpty(this._getItem(slot))) {
            return;
        }

        const inventorySlots = [
            ...Array.from({ length: 4 }, (_, i) => i + 1), // Crafting grid slots (1-4)
            ...Array.from({ length: 36 }, (_, i) => i + 9) // Inventory slots (9-44)
        ];

        if (this._isEmpty(cursorItem)) {
            this._setCursorItem(this._getItem(slot));
            this._setSlot(slot, NULL_ITEM);
            cursorItem = this.gameState.inventory.cursorItem;
        }

        const maxStackSize = this._getStackSize(cursorItem.blockId);
        let count = cursorItem.itemCount;
        if (this.currentContainerId !== 0) {
            for (let i = 0; i < this.containerSizes.get(this.currentContainerId); i++) { // First pass through container, only snag partial slots
                const item = this.currentContainer[i];
                if (!this._isEmpty(item) && this._areSameItem(item, cursorItem) && item.itemCount < maxStackSize) {
                    const toAdd = Math.min(item.itemCount, maxStackSize - count);
                    count += toAdd;
                    this._incrementSlot(i, -toAdd);
                    if (count >= maxStackSize) {
                        break;
                    }
                }
            }
        }
        
        for (const i of inventorySlots) { // First pass through inventory, only snag partial slots
            if (count >= maxStackSize) {
                break;
            }
            const item = this.gameState.inventory.slots[i];
            if (!this._isEmpty(item) && this._areSameItem(item, cursorItem) && item.itemCount < maxStackSize) {
                const toAdd = Math.min(item.itemCount, maxStackSize - count);
                count += toAdd;
                this.gameState.inventory.slots[i].itemCount -= toAdd;
                if (this.gameState.inventory.slots[i].itemCount <= 0) {
                    this.gameState.inventory.slots[i] = lodash.cloneDeep(NULL_ITEM);
                }
            }
        }

        if (this.currentContainerId !== 0) {
            for (let i = 0; i < this.containerSizes.get(this.currentContainerId); i++) { // Second pass through container, snag full stacks
                if (count >= maxStackSize) {
                    break;
                }
                const item = this.currentContainer[i];
                if (!this._isEmpty(item) && this._areSameItem(item, cursorItem) && item.itemCount === maxStackSize) {
                    const toAdd = Math.min(item.itemCount, maxStackSize - count);
                    count += toAdd;
                    this._incrementSlot(i, -toAdd);
                }
            }
        }

        for (const i of inventorySlots) { // Second pass through inventory, snag full stacks
            if (count >= maxStackSize) {
                break;
            }
            const item = this.gameState.inventory.slots[i];
            if (!this._isEmpty(item) && this._areSameItem(item, cursorItem) && item.itemCount === maxStackSize) {
                const toAdd = Math.min(item.itemCount, maxStackSize - count);
                count += toAdd;
                this.gameState.inventory.slots[i].itemCount -= toAdd;
                if (this.gameState.inventory.slots[i].itemCount <= 0) {
                    this.gameState.inventory.slots[i] = lodash.cloneDeep(NULL_ITEM);
                }
            }
        }

        this._setCursorItem({...lodash.omit(cursorItem, 'itemCount'), itemCount: count});
    }

    _getStackSize(itemId) {
        const stackSize = mcData.items[itemId]?.stackSize;
        if (stackSize === undefined) {
            return null;
        }
        return stackSize;
    }
}

module.exports = InventoryHandler;