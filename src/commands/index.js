const { Command, Option } = require('commander');
const THEME = require('./theme');
const ChatBuilder = require('./chat-builder');
const { getProperty, setProperty, createPaginator } = require('./utils');
const { sendHelpMessage } = require('./help-ui');
const { createAutoConfig } = require('./config-ui');

class CommandHandler {
    constructor(proxy) {
        this.proxy = proxy;
        this.modules = new Map();
        this.THEME = THEME;
    }
    
    register(moduleName, registrationFunction) {
        const normalizedModuleName = moduleName.toLowerCase();
        const moduleCommand = new Command(normalizedModuleName)
            .exitOverride()
            .configureOutput({ writeOut: () => {}, writeErr: () => {} })
            .addHelpCommand(false);
        
        const registry = {
            command: (name) => this._createCommandBuilder(moduleCommand, name, normalizedModuleName),
            THEME: this.THEME
        };

        registrationFunction(registry);
        
        this._addAutoConfigCommand(moduleCommand, normalizedModuleName);
        
        moduleCommand.command('help [command]')
            .description('Show help for commands')
            .option('-p, --page <number>', 'Page number for command list', '1')
            .action((commandName, opts, cmd) => {
                 const page = parseInt(opts.page) || 1;
                 this._sendHelpMessage(normalizedModuleName, commandName, this._currentClient, page);
            });
            
        this.modules.set(normalizedModuleName, moduleCommand);
    }
    
    _addAutoConfigCommand(moduleCommand, moduleName) {
        const { Option } = require('commander');
        
        moduleCommand.command('config')
            .description(`Configure ${moduleName} settings`)
            .addOption(new Option('-p, --page <number>', 'Page number for the config list').default('1').hideHelp())
            .addOption(new Option('--set <key=value>', 'Set a configuration value').hideHelp())
            .addOption(new Option('--reset-setting <key>', 'Reset a specific setting to default').hideHelp())
            .addOption(new Option('--reset-all-confirm', 'Confirm resetting all settings').hideHelp())
            .addOption(new Option('--reset-all-execute', 'Execute resetting all settings').hideHelp())
            .addOption(new Option('--button <key>', 'Execute a button action').hideHelp())
            .action((options, cmd) => {
                createAutoConfig({
                    commandHandler: this,
                    moduleName,
                    options: cmd.opts(),
                    client: this._currentClient
                });
            });
    }
    
    _createCommandBuilder(moduleCommand, name, moduleName) {
        const cmd = moduleCommand.command(name);
        const commandMetadata = {
            name,
            description: '',
            arguments: []
        };
        
        cmd._metadata = commandMetadata;

        const builder = {
            description: (desc) => {
                cmd.description(desc);
                commandMetadata.description = desc;
                return builder;
            },
            
            argument: (argName, options = {}) => {
                const { type = 'string', description = '', optional = false, defaultValue = null, choices = null } = options;
                let usageString = optional ? `[${argName}]` : `<${argName}>`;
                if (type === 'greedy') {
                    usageString = optional ? `[${argName}...]` : `<${argName}...>`;
                }

                const argMeta = { name: argName, type, description, optional, defaultValue, choices, usage: usageString };
                commandMetadata.arguments.push(argMeta);
                
                if (optional) {
                    cmd.argument(usageString, description, defaultValue);
                } else {
                    cmd.argument(usageString, description);
                }

                if (choices) {
                    cmd.choices(choices);
                }

                return builder;
            },

            option: (flags, description, defaultValue) => {
                 cmd.option(flags, description, defaultValue);
                 return builder;
            },

            handler: (handlerFn) => {
                cmd.action((...args) => {
                    const commandObj = args.pop();
                    const options = commandObj.opts();
                    const rawArgs = args;

                    const parsedArgs = {};
                    commandMetadata.arguments.forEach((argMeta, i) => {
                        const cleanName = argMeta.name.replace(/^[<\[]/, '').replace(/[>\]]$/, '').replace(/\.\.\.$/, '');
                        parsedArgs[cleanName] = rawArgs[i];
                    });

                    const ctx = {
                        client: this._currentClient,
                        args: parsedArgs,
                        options,
                        THEME: this.THEME,
                        send: (message) => this.proxy.sendMessage(this._currentClient, message),
                        sendSuccess: (message) => this.proxy.sendMessage(this._currentClient, `${this.THEME.success}✓ ${message}`),
                        sendError: (message) => this.proxy.sendMessage(this._currentClient, `${this.THEME.error}✗ ${message}`),
                        createChat: () => new ChatBuilder(this, this._currentClient),
                        createPaginator: (items, title, lineRenderer, pageSize = 7) => {
                            const page = parseInt(options.page) || 1;
                            return this._createPaginator(this._currentClient, items, title, lineRenderer, pageSize, page);
                        },
                        createConfig: (opts) => {
                             const page = parseInt(options.page) || 1;
                             return this._createConfig({ ...opts, client: this._currentClient, moduleName, page });
                        },
                        setProperty: setProperty,
                        getProperty: getProperty
                    };

                    handlerFn(ctx);
                });
                return builder;
            }
        };
        return builder;
    }

    _createConfig(options) {
        return createConfig({ ...options, commandHandler: this });
    }
    
    _createPaginator(client, items, title, lineRenderer, pageSize = 7, page = 1) {
        return createPaginator(this, client, items, title, lineRenderer, pageSize, page);
    }

    _sendHelpMessage(moduleName, commandName, client, page = 1) {
        sendHelpMessage(this, moduleName, commandName, client, page);
    }

    handleCommand(message, client) {
        if (!message.startsWith('/')) return false;
        
        const parts = message.slice(1).split(' ').filter(Boolean);
        const moduleName = parts.shift()?.toLowerCase();
        const args = parts;

        const moduleCommand = this.modules.get(moduleName);
        if (!moduleCommand) return false;

        if (args.length === 0) {
            this._sendHelpMessage(moduleName, null, client);
            return true;
        }

        try {
            this._currentClient = client;
            const argv = [process.execPath, __filename, ...args];
            moduleCommand.parse(argv);
        } catch (error) {
            this._handleCommandError(error, client, moduleName, args);
        }
        
        return true;
    }
    
    _handleCommandError(error, client, moduleName, args) {
        const commandName = args[0] || '';
        
        switch (error.code) {
            case 'commander.unknownCommand':
                this.proxy.sendMessage(client, `${THEME.error}Unknown command '${commandName}'. Use '/${moduleName} help'`);
                break;
                
            case 'commander.excessArguments':
                this.proxy.sendMessage(client, `${THEME.error}Too many arguments for '${commandName}' command`);
                this.proxy.sendMessage(client, `${THEME.info}Use '/${moduleName} help ${commandName}' for usage`);
                break;
                
            case 'commander.missingArgument':
                const missingArg = this._extractMissingArgument(error.message);
                if (missingArg) {
                    this.proxy.sendMessage(client, `${THEME.error}Missing required argument: ${missingArg}`);
                } else {
                    this.proxy.sendMessage(client, `${THEME.error}Missing required arguments for '${commandName}' command`);
                }
                this.proxy.sendMessage(client, `${THEME.info}Use '/${moduleName} help ${commandName}' for usage`);
                break;
                
            case 'commander.invalidArgument':
                this.proxy.sendMessage(client, `${THEME.error}Invalid argument for '${commandName}' command`);
                this.proxy.sendMessage(client, `${THEME.info}Use '/${moduleName} help ${commandName}' for usage`);
                break;
                
            case 'commander.optionMissingArgument':
                const optionName = this._extractOptionName(error.message);
                if (optionName) {
                    this.proxy.sendMessage(client, `${THEME.error}Option '${optionName}' requires a value`);
                } else {
                    this.proxy.sendMessage(client, `${THEME.error}Option requires a value`);
                }
                break;
                
            case 'commander.unknownOption':
                const unknownOption = this._extractOptionName(error.message);
                if (unknownOption) {
                    this.proxy.sendMessage(client, `${THEME.error}Unknown option '${unknownOption}'`);
                } else {
                    this.proxy.sendMessage(client, `${THEME.error}Unknown option`);
                }
                this.proxy.sendMessage(client, `${THEME.info}Use '/${moduleName} help ${commandName}' for available options`);
                break;
                
            default:
                this.proxy.sendMessage(client, `${THEME.error}Invalid command usage`);
                this.proxy.sendMessage(client, `${THEME.info}Use '/${moduleName} help${commandName ? ` ${commandName}` : ''}' for help`);
                
                console.error('Command error:', error.message);
                break;
        }
    }
    
    _extractMissingArgument(message) {
        const match = message.match(/missing required argument ['"]?([^'"]+)['"]?/i);
        return match ? match[1] : null;
    }
    
    _extractOptionName(message) {
        const match = message.match(/option ['"]?([^'"]+)['"]?/i);
        return match ? match[1] : null;
    }
}

module.exports = { CommandHandler }; 