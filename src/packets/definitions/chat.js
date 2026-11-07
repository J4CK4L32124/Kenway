module.exports = {
    client: {
        chat: {
            safe: true,
            eventMapping: {
                name: 'client_chat',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    message: data.message
                })
            }
        },
        tab_complete: {
            safe: true,
            eventMapping: {
                name: 'client_tab_complete',
                extractor: (data, session) => ({
                    player: session._createCurrentPlayerObject(),
                    text: data.text
                })
            }
        }
    },
    server: {
        chat: {
            safe: true,
            eventMapping: {
                name: 'chat',
                extractor: (data, session) => {
                    const message = JSON.parse(data.message);
                    const text = session.gameState.extractText(message);
                    return {
                        message: text,
                        json: message,
                        position: data.position
                    };
                }
            }
        },
        tab_complete: {
            safe: true,
            eventMapping: {
                name: 'server_tab_complete',
                extractor: (data) => ({
                    matches: data.matches
                })
            }
        },
        title: {
            safe: true,
            eventMapping: {
                name: 'title',
                extractor: (data) => {
                    if (data.action === 0 || data.action === 1) {
                        return {
                            action: data.action === 0 ? 'title' : 'subtitle',
                            text: data.text ? JSON.parse(data.text) : null
                        };
                    } else if (data.action === 2) {
                        return {
                            action: 'times',
                            fadeIn: data.fadeIn,
                            stay: data.stay,
                            fadeOut: data.fadeOut
                        };
                    }
                    return { action: data.action };
                }
            }
        },
        disconnect: {
            safe: false,
            eventMapping: {
                name: 'server_disconnect',
                extractor: (data) => ({
                    reason: data.reason
                })
            }
        },
        kick_disconnect: {
            safe: false,
            eventMapping: {
                name: 'server_disconnect',
                extractor: (data) => ({
                    reason: data.reason
                })
            }
        }
    }
};