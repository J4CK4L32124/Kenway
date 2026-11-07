const THEME = require('./theme');

class ChatBuilder {
    constructor(commandHandler, client) {
        this.commandHandler = commandHandler;
        this.client = client;
        this._components = [{ text: '' }];
    }

    _current() {
        return this._components[this._components.length - 1];
    }

    text(text, color = THEME.text, style = null) {
        const component = { text: `${color}${text}` };
        if (style) {
            component[style] = true;
        }
        this._components.push(component);
        return this;
    }

    button(text, command, hoverText = null, action = 'suggest_command', color = THEME.text) {
        const component = {
            text: `${color}${text}`,
            clickEvent: {
                action: action,
                value: command
            }
        };
        if (hoverText) {
            if (Array.isArray(hoverText)) {
                component.hoverEvent = {
                    action: 'show_text',
                    value: { text: '', extra: hoverText }
                };
            } else {
                component.hoverEvent = {
                    action: 'show_text',
                    value: { text: `${THEME.muted}${hoverText}` }
                };
            }
        }
        this._components.push(component);
        return this;
    }

    suggestButton(text, command, hoverText = null, color = THEME.accent) {
        return this.button(text, command, hoverText, 'suggest_command', color);
    }

    runButton(text, command, hoverText = null, color = THEME.accent) {
        return this.button(text, command, hoverText, 'run_command', color);
    }

    hover(text) {
        if (!this._current().hoverEvent) {
             this._current().hoverEvent = { action: 'show_text', value: { text: '' } };
        }
        this._current().hoverEvent.value.text += text;
        return this;
    }

    newline() {
        return this.text('\n');
    }

    space() {
        return this.text(' ');
    }

    send() {
        const message = JSON.stringify({
            text: '',
            extra: this._components
        });
        this.commandHandler.proxy.sendMessage(this.client, message);
    }
}

module.exports = ChatBuilder; 