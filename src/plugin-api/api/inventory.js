class Inventory {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    openWindow(windowId, inventoryType, windowTitle, slotCount) {
        if (!this.core.isHypixelSafe('openWindow')) {
            this.core.logHypixelBlock('openWindow');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('open_window', {
                windowId,
                inventoryType,
                windowTitle: JSON.stringify({ text: windowTitle }),
                slotCount
            });
        } catch (error) {
            this.core.log(`Failed to open window: ${error.message}`);
            return false;
        }
    }
    
    closeWindow(windowId) {
        if (!this.core.isHypixelSafe('closeWindow')) {
            this.core.logHypixelBlock('closeWindow');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('close_window', { windowId });
        } catch (error) {
            this.core.log(`Failed to close window: ${error.message}`);
            return false;
        }
    }
    
    setSlot(windowId, slot, item) {
        if (!this.core.isHypixelSafe('setSlot')) {
            this.core.logHypixelBlock('setSlot');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('set_slot', {
                windowId,
                slot,
                item
            });
        } catch (error) {
            this.core.log(`Failed to set slot: ${error.message}`);
            return false;
        }
    }
    
    setWindowItems(windowId, items) {
        if (!this.core.isHypixelSafe('setWindowItems')) {
            this.core.logHypixelBlock('setWindowItems');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('window_items', {
                windowId,
                items
            });
        } catch (error) {
            this.core.log(`Failed to set window items: ${error.message}`);
            return false;
        }
    }
    
    sendTransaction(windowId, action, accepted) {
        if (!this.core.isHypixelSafe('sendTransaction')) {
            this.core.logHypixelBlock('sendTransaction');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('transaction', {
                windowId,
                action,
                accepted
            });
        } catch (error) {
            this.core.log(`Failed to send transaction: ${error.message}`);
            return false;
        }
    }
    
    sendCraftProgress(windowId, property, value) {
        if (!this.core.isHypixelSafe('sendCraftProgress')) {
            this.core.logHypixelBlock('sendCraftProgress');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('craft_progress_bar', {
                windowId,
                property,
                value
            });
        } catch (error) {
            this.core.log(`Failed to send craft progress: ${error.message}`);
            return false;
        }
    }
    
    setHeldItemSlot(slot) {
        if (!this.core.isHypixelSafe('setHeldItemSlot')) {
            this.core.logHypixelBlock('setHeldItemSlot');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('held_item_slot', { slot });
        } catch (error) {
            this.core.log(`Failed to set held item slot: ${error.message}`);
            return false;
        }
    }
    
    creativeInventoryAction(slot, item) {
        if (!this.core.isHypixelSafe('creativeInventoryAction')) {
            this.core.logHypixelBlock('creativeInventoryAction');
            return false;
        }
        if (!this.proxy.currentPlayer?.targetClient) return false;
        
        try {
            return this.proxy.currentPlayer.targetClient.write('creative_inventory_action', {
                slot,
                item
            });
        } catch (error) {
            this.core.log(`Failed to send creative inventory action: ${error.message}`);
            return false;
        }
    }
    
    enchantItem(windowId, enchantment) {
        if (!this.core.isHypixelSafe('enchantItem')) {
            this.core.logHypixelBlock('enchantItem');
            return false;
        }
        if (!this.proxy.currentPlayer?.targetClient) return false;
        
        try {
            return this.proxy.currentPlayer.targetClient.write('enchant_item', {
                windowId,
                enchantment
            });
        } catch (error) {
            this.core.log(`Failed to enchant item: ${error.message}`);
            return false;
        }
    }
    
    createChest(title, size = 27) {
        if (!this.core.isHypixelSafe('createChest')) {
            this.core.logHypixelBlock('createChest');
            return false;
        }
        const windowId = Math.floor(Math.random() * 100) + 1;
        this.openWindow(windowId, 'minecraft:chest', title, size);
        return windowId;
    }
    
    createHopper(title) {
        if (!this.core.isHypixelSafe('createHopper')) {
            this.core.logHypixelBlock('createHopper');
            return false;
        }
        const windowId = Math.floor(Math.random() * 100) + 1;
        this.openWindow(windowId, 'minecraft:hopper', title, 5);
        return windowId;
    }
    
    createDispenser(title) {
        if (!this.core.isHypixelSafe('createDispenser')) {
            this.core.logHypixelBlock('createDispenser');
            return false;
        }
        const windowId = Math.floor(Math.random() * 100) + 1;
        this.openWindow(windowId, 'minecraft:dispenser', title, 9);
        return windowId;
    }
    
    fillWindow(windowId, item) {
        if (!this.core.isHypixelSafe('fillWindow')) {
            this.core.logHypixelBlock('fillWindow');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        const items = new Array(54).fill(item);
        return this.setWindowItems(windowId, items);
    }
    
    clearWindow(windowId) {
        if (!this.core.isHypixelSafe('clearWindow')) {
            this.core.logHypixelBlock('clearWindow');
            return false;
        }
        if (!this.proxy.currentPlayer?.client) return false;
        
        const items = new Array(54).fill(null);
        return this.setWindowItems(windowId, items);
    }
}

module.exports = Inventory; 