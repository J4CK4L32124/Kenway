class Chat {
    constructor(proxy, core) {
        this.proxy = proxy;
        this.core = core;
    }
    
    chat(message) {
        if (!this.proxy.currentPlayer?.client) return;
        
        try {
            let chatMessage;
            
            if (typeof message === 'object' && message !== null) {
                chatMessage = JSON.stringify(message);
            }
            else if (typeof message === 'string' && message.trim().startsWith('{') && message.trim().endsWith('}')) {
                try {
                    JSON.parse(message);
                    chatMessage = message;
                } catch (e) {
                    chatMessage = JSON.stringify({ text: message });
                }
            }
            else {
                chatMessage = JSON.stringify({ text: message });
            }
            
            this.proxy.currentPlayer.client.write('chat', {
                message: chatMessage,
                position: 0
            });
        } catch (error) {
            console.error('Failed to send chat message:', error.message);
        }
    }
    
    chatInteractive(components) {
        if (!this.proxy.currentPlayer?.client) return;
        
        try {
            let message;
            
            if (components.text !== undefined || components.extra !== undefined) {
                message = components;
            }
            else if (Array.isArray(components)) {
                message = { text: "", extra: components };
            }
            else {
                message = { text: "", extra: [components] };
            }
            
            this.chat(message);
        } catch (error) {
            console.error('Failed to send interactive chat message:', error.message);
        }
    }
    
    sendTitle(title, subtitle = '', fadeIn = 10, stay = 70, fadeOut = 20) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            const success = this.proxy.currentPlayer.client.write('title', {
                action: 0,
                text: JSON.stringify({ text: title })
            });
            
            if (subtitle) {
                this.proxy.currentPlayer.client.write('title', {
                    action: 1,
                    text: JSON.stringify({ text: subtitle })
                });
            }
            
            this.proxy.currentPlayer.client.write('title', {
                action: 2,
                fadeIn,
                stay,
                fadeOut
            });
            
            return success;
        } catch (error) {
            this.core.log(`Failed to send title: ${error.message}`);
            return false;
        }
    }
    
    sendActionBar(text) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('title', {
                action: 3,
                text: JSON.stringify({ text })
            });
        } catch (error) {
            this.core.log(`Failed to send actionbar: ${error.message}`);
            return false;
        }
    }
    
    sendTabComplete(text) {
        if (!this.proxy.currentPlayer?.client) return false;
        
        try {
            return this.proxy.currentPlayer.client.write('tab_complete', {
                text
            });
        } catch (error) {
            this.core.log(`Failed to send tab complete: ${error.message}`);
            return false;
        }
    }
    
    sendChatToServer(message) {
        if (!this.proxy.currentPlayer?.targetClient) return false;
        
        try {
            return this.proxy.currentPlayer.targetClient.write('chat', {
                message: message
            });
        } catch (error) {
            this.core.log(`Failed to send chat to server: ${error.message}`);
            return false;
        }
    }
}

module.exports = Chat;