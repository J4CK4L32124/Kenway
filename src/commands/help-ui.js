const THEME = require('./theme');
const ChatBuilder = require('./chat-builder');
const { createPaginator } = require('./utils');

function sendHelpMessage(commandHandler, moduleName, commandName, client, page = 1) {
    const moduleCommand = commandHandler.modules.get(moduleName);
    const chat = new ChatBuilder(commandHandler, client);

    let displayName;
    if (moduleName === 'proxy') {
        displayName = 'Proxy';
    } else {
        displayName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    }

    if (commandName) {
        const cmd = moduleCommand.commands.find(c => c.name() === commandName);
        if (!cmd) {
            commandHandler.proxy.sendMessage(client, `${THEME.error}Unknown command: ${commandName}`);
            return;
        }

        chat.text('§m-----------------------------------------------------§r', THEME.muted).newline();
        chat.text(`Help: ${displayName}`, THEME.primary).text(` - `, THEME.muted)
            .text(`/${moduleName} ${cmd.name()}`, THEME.primary).newline().newline();

        chat.text(cmd.description() || 'No description available.', THEME.info).newline().newline();

        let usage = `/${moduleName} ${cmd.name()}`;
        if (cmd._metadata) {
            cmd._metadata.arguments.forEach(arg => {
                usage += ` ${arg.usage}`;
            });
        }

        const hoverComponents = [];
        hoverComponents.push({ text: `${THEME.accent}/${moduleName} ${cmd.name()}\n` });
        hoverComponents.push({ text: `${THEME.muted}§m--------------------------§r\n` });
        hoverComponents.push({ text: `${THEME.info}${cmd.description() || 'No description available.'}\n\n` });
        hoverComponents.push({ text: `${THEME.secondary}Usage: ${THEME.text}${usage}\n` });
        
        if (cmd._metadata && cmd._metadata.arguments.length > 0) {
            hoverComponents.push({ text: `\n${THEME.secondary}Arguments:\n` });
            cmd._metadata.arguments.forEach(arg => {
                const argType = arg.optional ? 'Optional' : 'Required';
                hoverComponents.push({ text: `${THEME.muted}• ${THEME.primary}${arg.usage} ${THEME.muted}(${argType})` });
                if (arg.description) hoverComponents.push({ text: `${THEME.muted} - ${THEME.text}${arg.description}` });
                hoverComponents.push({ text: '\n' });
            });
        }
        
        if (cmd.options && cmd.options.length > 0) {
            hoverComponents.push({ text: `\n${THEME.secondary}Options:\n` });
            cmd.options.forEach(opt => {
                hoverComponents.push({ text: `${THEME.muted}• ${THEME.primary}${opt.flags} ${THEME.muted}- ${THEME.info}${opt.description}\n` });
            });
        }

        chat.text('Usage: ', THEME.secondary);
        chat.suggestButton(usage, usage, hoverComponents, THEME.primary);
        chat.newline().newline();

        if (cmd._metadata && cmd._metadata.arguments.length > 0) {
            chat.text('Arguments:', THEME.secondary).newline();
            cmd._metadata.arguments.forEach(arg => {
                const argType = arg.optional ? 'Optional' : 'Required';

                chat.text(arg.usage, THEME.primary)
                    .text(` (${argType})`, THEME.info);

                if (arg.description) {
                    chat.text(' - ', THEME.muted).text(arg.description, THEME.text);
                }

                chat.newline();
            });
            chat.newline();
        }

        if (cmd.options.length > 0) {
            chat.text('Options:', THEME.secondary).newline();
            cmd.options.forEach(opt => {
                chat.text(opt.flags, THEME.primary)
                    .text(' - ', THEME.muted)
                    .text(opt.description, THEME.text)
                    .newline();
            });
            chat.newline();
        }

    } else {
        const baseCommands = moduleCommand.commands.filter(c => c.name() !== 'help');

        const commands = baseCommands;
        const pageSize = 5;
        const totalPages = Math.ceil(commands.length / pageSize);
        page = Math.max(1, Math.min(page, totalPages));

        const startIndex = (page - 1) * pageSize;
        const pageCommands = commands.slice(startIndex, startIndex + pageSize);

        chat.text('§m-----------------------------------------------------§r', THEME.muted).newline();
        chat.text(`${displayName} Commands`, THEME.primary).newline();

        pageCommands.forEach((cmd, index) => {
            let usage = `/${moduleName} ${cmd.name()}`;
            let argsText = '';
            if (cmd._metadata) {
                cmd._metadata.arguments.forEach(arg => {
                    usage += ` ${arg.usage}`;
                    if (argsText) argsText += ' ';
                    argsText += arg.usage;
                });
            }

            const listHoverComponents = [];
            listHoverComponents.push({ text: `${THEME.accent}/${moduleName} ${cmd.name()}\n` });
            listHoverComponents.push({ text: `${THEME.muted}§m--------------------------§r\n` });
            listHoverComponents.push({ text: `${THEME.info}${cmd.description() || 'No description available.'}\n\n` });
            listHoverComponents.push({ text: `${THEME.secondary}Usage: ${THEME.text}${usage}\n` });

            if (cmd._metadata && cmd._metadata.arguments.length > 0) {
                listHoverComponents.push({ text: `\n${THEME.secondary}Arguments:\n` });
                cmd._metadata.arguments.forEach(arg => {
                    const argType = arg.optional ? 'Optional' : 'Required';
                    listHoverComponents.push({ text: `${THEME.muted}• ${THEME.primary}${arg.usage} ${THEME.muted}(${argType})` });
                    if (arg.description) listHoverComponents.push({ text: `${THEME.muted} - ${THEME.text}${arg.description}` });
                    listHoverComponents.push({ text: '\n' });
                });
            }

            if (cmd.options && cmd.options.length > 0) {
                listHoverComponents.push({ text: `\n${THEME.secondary}Options:\n` });
                cmd.options.forEach(opt => {
                    listHoverComponents.push({ text: `${THEME.muted}• ${THEME.primary}${opt.flags} ${THEME.muted}- ${THEME.info}${opt.description}\n` });
                });
            }

            listHoverComponents.push({ text: `\n${THEME.text}Click to paste command` });

            if (argsText) {
                chat.suggestButton(`/${moduleName} ${cmd.name()}`, usage, listHoverComponents, THEME.secondary);
                chat.space().text(argsText, THEME.text);
            } else {
                chat.suggestButton(`/${moduleName} ${cmd.name()}`, usage, listHoverComponents, THEME.secondary);
            }
            chat.newline();
        });

        createPaginator(commandHandler, chat, page, totalPages, `/${moduleName} help`);
    }

    chat.text('§m-----------------------------------------------------§r', THEME.muted);
    chat.send();
}

module.exports = { sendHelpMessage }; 