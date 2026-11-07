const mc = require('minecraft-protocol');
const path = require('path');
const fs = require('fs');
const { PlayerSession } = require('./session');
const { CommandHandler } = require('./commands');
const PluginAPI = require('./plugin-api');
const { Storage } = require('./storage');
const { getBaseDir } = require('./utils/paths');

const packageJson = require('../package.json');
const KENWAY_VERSION = packageJson.version;

const MINECRAFT_VERSION = '1.8.9';
const PROXY_PORT = 25565;
const PROXY_PREFIX = '§5Ken§0way§r';

class MinecraftProxy {
    constructor() {
        this.PROXY_PREFIX = PROXY_PREFIX;
        this.storage = new Storage();
        this.config = this.storage.loadConfig();
        this.pluginAPI = new PluginAPI(this, null);
        this.commandHandler = new CommandHandler(this);

        this.server = null;
        this.currentPlayer = null;
        this.loginAttempts = new Map();
        
        this.initializeProxy().catch(console.error);
    }

    getBaseDir() {
        return getBaseDir();
    }

    getKenwayVersion() {
        return KENWAY_VERSION;
    }

    async initializeProxy() {
        this.registerProxyCommands();
        await this.pluginAPI.loadPlugins();
        this.createServer();
    }
    
    createServer() {
        this.server = mc.createServer({
            'online-mode': true,
            version: MINECRAFT_VERSION,
            port: this.config.proxyPort || PROXY_PORT,
            keepAlive: false,
            motd: this.generateMOTD(),
            maxPlayers: 1,
            beforeLogin: (client) => {
                if (client.protocolVersion !== 47) {
                    client.end(`§cPlease connect using ${MINECRAFT_VERSION}`);
                }
            }
        });
        
        this.server.on('login', (client) => this.handleLogin(client));
        this.server.on('listening', () => {
            console.log(`Proxy server listening on port ${this.config.proxyPort || PROXY_PORT}`);
            console.log(`Target server: ${this.getTargetDisplay()}`);
                });
    }
    
    handleLogin(client) {
        if (this.currentPlayer) {
            client.end('§cProxy is already in use.');
            return;
        }
        
        if (this.checkRateLimit(client.username)) {
            client.end('§cPlease wait 20 seconds before reconnecting (Microsoft rate limit).');
            return;
                    }
        
        client.on('end', () => {
            console.log(`${client.username} disconnected`);
            if (this.currentPlayer) {
                this.currentPlayer.disconnect('Client disconnected from proxy.');
                this.currentPlayer = null;
            }
        });
        
        client.on('error', (err) => {
            console.log(`Client ${client.username} error: ${err.message}`);
            if (this.currentPlayer) {
                this.currentPlayer.disconnect(`Client error: ${err.message}`);
                this.currentPlayer = null;
            }
        });
        
        this.currentPlayer = new PlayerSession(this, client);
    }

    checkRateLimit(username) {
        const now = Date.now();
        const attempts = this.loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
        
        if (now - attempts.lastAttempt > 20000) {
            attempts.count = 0;
        }
        
        if (attempts.count >= 2 && now - attempts.lastAttempt < 20000) {
            return true;
        }
        
        attempts.count++;
        attempts.lastAttempt = now;
        this.loginAttempts.set(username, attempts);
        
        for (const [user, data] of this.loginAttempts.entries()) {
            if (now - data.lastAttempt > 60000) {
                this.loginAttempts.delete(user);
            }
        }
        
        return false;
    }

    registerProxyCommands() {
        this.commandHandler.register('proxy', (registry) => {
            const { command } = registry;
            
            command('server')
                .description('List and switch servers')
                .argument('target', { optional: true })
                .handler((ctx) => this.handleServerCommand(ctx));
            
            command('addserver')
                .description('Add a server to the list')
                .argument('name')
                .argument('hostport')
                .handler((ctx) => this.handleAddServerCommand(ctx));
            
            command('removeserver')
                .description('Remove a server from the list')
                .argument('name')
                .handler((ctx) => this.handleRemoveServerCommand(ctx));
            
            command('reauth')
                .description('Force re-authentication')
                .handler((ctx) => this.handleReauthCommand(ctx));
            
            command('plugins')
                .description('List loaded plugins')
                .handler((ctx) => this.handlePluginsCommand(ctx));
        });
    }
    
    handleServerCommand(ctx) {
        if (!ctx.args.target) {
            const chat = ctx.createChat();
            chat.text('--- Available Servers ---', ctx.THEME.primary).newline();
            chat.text('Current: ', ctx.THEME.secondary)
                .text(this.getTargetDisplay(), ctx.THEME.success).newline().newline();
            
            Object.entries(this.config.servers).forEach(([name, server]) => {
                chat.button(`[${name}]`, `/proxy server ${name}`, `Switch to ${name}`, 'run_command', ctx.THEME.accent)
                    .space()
                    .text(`${server.host}:${server.port}`, ctx.THEME.muted)
                    .newline();
            });
            chat.send();
        } else {
            this.switchServer(ctx.args.target, ctx);
        }
    }
    
    handleAddServerCommand(ctx) {
        const { name, hostport } = ctx.args;
        if (!name || !hostport) {
            return ctx.sendError('Invalid format. Use: /proxy addserver <name> <host>[:<port>]');
        }

        const [host, portStr] = hostport.split(':');
        if (!host || host.length < 1) {
            return ctx.sendError('Invalid hostname.');
        }

        const hostnameRegex = /^([a-zA-Z0-9.-]+|\d{1,3}(\.\d{1,3}){3})$/;
        if (!hostnameRegex.test(host)) {
            return ctx.sendError('Invalid hostname format.');
        }

        if (
            (host === 'localhost' || host === '127.0.0.1' || host === '::1') &&
            (portStr === undefined || parseInt(portStr, 10) === (this.config.proxyPort || PROXY_PORT))
        ) {
            return ctx.sendError('Cannot add the proxy\'s own address as a server.');
        }
        if (
            host === this.config.proxyHost &&
            (portStr === undefined || parseInt(portStr, 10) === (this.config.proxyPort || PROXY_PORT))
        ) {
            return ctx.sendError('Cannot add the proxy\'s own address as a server.');
        }

        let port = 25565;
        if (portStr !== undefined) {
            port = parseInt(portStr, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                return ctx.sendError('Invalid port. Must be a number between 1 and 65535.');
            }
        }

        this.config.servers[name] = { host, port };
        this.storage.saveConfig(this.config);
        ctx.sendSuccess(`Added server '${name}' (${host}:${port})`);
    }
    
    handleRemoveServerCommand(ctx) {
        const { name } = ctx.args;
        if (!this.config.servers[name]) {
            return ctx.sendError(`Server '${name}' not found`);
        }
        
        delete this.config.servers[name];
        this.storage.saveConfig(this.config);
        ctx.sendSuccess(`Removed server '${name}'`);
    }
    
    handleReauthCommand(ctx) {
        if (!this.currentPlayer) {
            return ctx.sendError('You are not connected to a server');
        }
        
        const authPath = path.join(this.storage.getAuthCacheDir(), this.currentPlayer.username);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
        
        this.currentPlayer.forceReauth = true;
        ctx.sendSuccess('Authentication cache cleared. Reconnect to re-authenticate.');
    }

    handlePluginsCommand(ctx) {
        const plugins = this.pluginAPI.getLoadedPlugins();
        if (plugins.length === 0) {
            return ctx.send('§7No plugins loaded.');
        }
        
        const chat = ctx.createChat();
        chat.text('§m-----------------------------------------------------§r', ctx.THEME.muted).newline();
        chat.text('Loaded Plugins', ctx.THEME.primary).newline();
        
        plugins.forEach(plugin => {
            const status = plugin.enabled ? '§aEnabled' : '§cDisabled';
            const version = plugin.version ? ` §7v${plugin.version}` : '';
            const compatibility = plugin.compatible === false ? ' §c[Incompatible]' : '';
            
            const hoverComponents = [];
            hoverComponents.push({ text: `${ctx.THEME.accent}${plugin.displayName}\n` });
            hoverComponents.push({ text: `${ctx.THEME.muted}§m--------------------------§r\n` });
            hoverComponents.push({ text: `${ctx.THEME.info}${plugin.metadata.description || 'No description available.'}\n\n` });
            
            if (plugin.metadata.author) {
                hoverComponents.push({ text: `${ctx.THEME.secondary}Author: ${ctx.THEME.text}${plugin.metadata.author}\n` });
            }
            
            hoverComponents.push({ text: `${ctx.THEME.secondary}Version: ${ctx.THEME.text}${plugin.version}\n` });
            hoverComponents.push({ text: `${ctx.THEME.secondary}Status: ${status}\n` });
            
            if (plugin.metadata.minVersion || plugin.metadata.maxVersion) {
                hoverComponents.push({ text: `${ctx.THEME.secondary}Proxy Requirements: ` });
                if (plugin.metadata.minVersion && plugin.metadata.maxVersion) {
                    hoverComponents.push({ text: `${ctx.THEME.text}>= ${plugin.metadata.minVersion} and <= ${plugin.metadata.maxVersion}` });
                } else if (plugin.metadata.minVersion) {
                    hoverComponents.push({ text: `${ctx.THEME.text}>= ${plugin.metadata.minVersion}` });
                } else if (plugin.metadata.maxVersion) {
                    hoverComponents.push({ text: `${ctx.THEME.text}<= ${plugin.metadata.maxVersion}` });
                }
                hoverComponents.push({ text: '\n' });
            }
            
            const deps = plugin.dependencies || [];
            const optDeps = plugin.optionalDependencies || [];
            
            if (deps.length > 0) {
                hoverComponents.push({ text: `${ctx.THEME.secondary}Dependencies: ` });
                const depNames = deps.map(d => {
                    if (typeof d === 'string') return d;
                    let name = d.name;
                    if (d.minVersion || d.maxVersion || d.version) {
                        name += ' (';
                        if (d.version) name += `=${d.version}`;
                        else {
                            if (d.minVersion) name += `>=${d.minVersion}`;
                            if (d.maxVersion) name += `<=${d.maxVersion}`;
                        }
                        name += ')';
                    }
                    return name;
                });
                hoverComponents.push({ text: `${ctx.THEME.text}${depNames.join(', ')}\n` });
            }
            
            if (optDeps.length > 0) {
                hoverComponents.push({ text: `${ctx.THEME.secondary}Optional Dependencies: ` });
                const optDepNames = optDeps.map(d => typeof d === 'string' ? d : d.name);
                hoverComponents.push({ text: `${ctx.THEME.text}${optDepNames.join(', ')}\n` });
            }
            
            hoverComponents.push({ text: `\n${ctx.THEME.text}Click to open help` });
            
            chat.suggestButton(plugin.displayName, `/${plugin.name} help`, hoverComponents, ctx.THEME.secondary);
            chat.text(version, ctx.THEME.muted);
            chat.text(' ');
            chat.text(status);
            if (compatibility) {
                chat.text(compatibility);
            }
            chat.newline();
        });
        
        chat.text('§m-----------------------------------------------------§r', ctx.THEME.muted);
        chat.send();
    }

    switchServer(target, ctx = null) {
        const serverInfo = this.parseServerTarget(target);
        if (!serverInfo) {
            if (ctx) {
                ctx.sendError('Invalid server target');
            } else {
                this.sendMessage(this.currentPlayer?.client, '§cInvalid server target');
            }
            return;
        }

        this.config.targetHost = serverInfo.host;
        this.config.targetPort = serverInfo.port;
        this.storage.saveConfig(this.config);
        this.server.motd = this.generateMOTD();
        
        if (ctx) {
            ctx.sendSuccess(`Switched to ${target}. Please reconnect.`);
        }
        
        this.kickPlayer(`§aSwitched to ${target}. Please reconnect.`);
    }

    parseServerTarget(target) {
        if (this.config.servers[target]) {
            return this.config.servers[target];
        }
        const [host, port] = target.split(':');
        return { host, port: parseInt(port) || 25565 };
    }

    generateMOTD() {
        const pluginCount = this.pluginAPI.getLoadedPlugins().length;
        const pluginText = pluginCount > 0 ? `${pluginCount} Plugin${pluginCount > 1 ? 's' : ''}` : 'No Plugins';
        return `${PROXY_PREFIX} §5Proxy §7v${KENWAY_VERSION}§r §8| ${pluginText}\n§7Target: §e${this.getTargetDisplay()}`;
    }

    getTargetDisplay() {
        const port = this.config.targetPort || 25565;
        return port === 25565 ? this.config.targetHost : `${this.config.targetHost}:${port}`;
    }
    
    sendMessage(client, message) {
        if (!client || client.state !== mc.states.PLAY) return;

        try {
            const trimmed = typeof message === 'string' ? message.trim() : '';
            const isJsonComponent = trimmed.startsWith('{') && trimmed.endsWith('}');
            const finalMessage = isJsonComponent ? trimmed : JSON.stringify({ text: message });

            client.write('chat', {
                message: finalMessage,
                position: 0,
                sender: '0'
            });
        } catch (error) {
            console.error('Failed to send message:', error.message);
        }
    }

    kickPlayer(reason) {
        if (this.currentPlayer) {
            this.currentPlayer.disconnect(reason);
        }
    }
    
    clearSession() {
        this.currentPlayer = null;
    }
}

const proxy = new MinecraftProxy();
