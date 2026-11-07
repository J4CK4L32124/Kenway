module.exports = {
    client: {
        window_click: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'client_window_click',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    windowId: data.windowId,
                    slot: data.slot,
                    mouseButton: data.mouseButton,
                    action: data.action,
                    mode: data.mode,
                    item: data.item
                })
            }
        },
        close_window: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'client_close_window',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    windowId: data.windowId
                })
            }
        },
        held_item_slot: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'client_held_item_change',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    slot: data.slotId
                })
            }
        },
        creative_inventory_action: {
            safe: false
        },
        enchant_item: {
            safe: false
        }
    },
    server: {
        set_slot: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'inventory_set_slot',
                extractor: (data) => ({
                    windowId: data.windowId,
                    slot: data.slot,
                    item: data.item
                })
            }
        },
        window_items: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'inventory_set_items',
                extractor: (data) => ({
                    windowId: data.windowId,
                    items: data.items
                })
            }
        },
        open_window: {
            safe: true,
            updatesState: true,
            eventMapping: {
                name: 'inventory_open',
                extractor: (data) => ({
                    windowId: data.windowId,
                    windowType: data.inventoryType,
                    windowTitle: data.windowTitle,
                    slotCount: data.slotCount
                })
            }
        },
        close_window: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'inventory_close',
                extractor: (data) => ({
                    windowId: data.windowId
                })
            }
        },
        transaction: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'inventory_transaction',
                extractor: (data) => ({
                    windowId: data.windowId,
                    action: data.action,
                    accepted: data.accepted
                })
            }
        },
        held_item_slot: {
            safe: false,
            updatesState: true,
            eventMapping: {
                name: 'server_held_item_change',
                extractor: (data) => ({
                    slot: data.slot
                })
            }
        }
    }
};