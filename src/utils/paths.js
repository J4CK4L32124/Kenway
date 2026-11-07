const path = require('path');

function getBaseDir() {
    return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '../..');
}

function getPluginsDir() {
    return path.join(getBaseDir(), 'plugins');
}

function getConfigDir() {
    return path.join(getBaseDir(), 'config');
}

function getPluginConfigDir() {
    return path.join(getConfigDir(), 'plugins');
}

function getAuthCacheDir() {
    return path.join(getBaseDir(), 'auth_cache');
}

function getPluginDataDir() {
    return path.join(getBaseDir(), 'data');
}

module.exports = {
    getBaseDir,
    getPluginsDir,
    getConfigDir,
    getPluginConfigDir,
    getAuthCacheDir,
    getPluginDataDir
}; 