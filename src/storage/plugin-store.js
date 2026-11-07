class PluginStore {
    constructor(pluginName, storage, initialData = {}) {
        this.pluginName = pluginName;
        this.storage = storage;
        this.data = { ...initialData };
    }
    
    get(key, defaultValue = undefined) {
        return this.data[key] !== undefined ? this.data[key] : defaultValue;
    }
    
    set(key, value) {
        this.data[key] = value;
        this.save();
    }
    
    delete(key) {
        delete this.data[key];
        this.save();
    }
    
    clear() {
        this.data = {};
        this.save();
    }
    
    has(key) {
        return key in this.data;
    }
    
    keys() {
        return Object.keys(this.data);
    }
    
    values() {
        return Object.values(this.data);
    }
    
    entries() {
        return Object.entries(this.data);
    }
    
    save() {
        const fullData = this.storage.loadPluginData(this.pluginName);
        fullData.store = this.data;
        this.storage.savePluginData(this.pluginName, fullData);
    }
}

module.exports = PluginStore; 