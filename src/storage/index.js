const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG } = require('./config');
const PluginStore = require('./plugin-store');
const { getConfigDir, getPluginConfigDir, getPluginDataDir, getAuthCacheDir } = require('../utils/paths');

class Storage {
    constructor(dataDir) {
        this.configDir = getConfigDir();
        this.pluginConfigDir = getPluginConfigDir();
        this.pluginDataDir = getPluginDataDir();
        this.authCacheDir = getAuthCacheDir();
        
        this.ensureDirectories();
    }
    
    ensureDirectories() {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
        if (!fs.existsSync(this.pluginConfigDir)) {
            fs.mkdirSync(this.pluginConfigDir, { recursive: true });
        }
        if (!fs.existsSync(this.pluginDataDir)) {
            fs.mkdirSync(this.pluginDataDir, { recursive: true });
        }
        if (!fs.existsSync(this.authCacheDir)) {
            fs.mkdirSync(this.authCacheDir, { recursive: true });
        }
    }
    
    loadConfig() {
        const configFile = path.join(this.configDir, 'kenway-config.json');
        let config = { ...DEFAULT_CONFIG };
        if (fs.existsSync(configFile)) {
            try {
                const loadedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                Object.assign(config, loadedConfig);
            } catch (err) {
                console.error('Failed to load config:', err.message);
            }
        } else {
            this.saveConfig(config);
        }
        return config;
    }
    
    saveConfig(config) {
        const configFile = path.join(this.configDir, 'kenway-config.json');
        try {
            fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        } catch (err) {
            console.error('Failed to save config:', err.message);
        }
    }
    
    loadPluginData(pluginName) {
        const file = path.join(this.pluginDataDir, `${pluginName}.data.json`);
        if (fs.existsSync(file)) {
            try {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (err) {
                console.error(`Failed to load data for plugin ${pluginName}:`, err.message);
            }
        }
        return {};
    }
    
    savePluginData(pluginName, data) {
        const file = path.join(this.pluginDataDir, `${pluginName}.data.json`);
        try {
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(`Failed to save data for plugin ${pluginName}:`, err.message);
        }
    }
    
    loadPluginConfig(pluginName) {
        const data = this.loadPluginData(pluginName);
        return data.config || {};
    }
    
    savePluginConfig(pluginName, config) {
        const data = this.loadPluginData(pluginName);
        data.config = config;
        this.savePluginData(pluginName, data);
    }
    
    getPluginStore(pluginName) {
        const data = this.loadPluginData(pluginName);
        return new PluginStore(pluginName, this, data.store || {});
    }
    
    getAuthCacheDir() {
        return this.authCacheDir;
    }
}

module.exports = { Storage }; 