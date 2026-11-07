const THEME = require('./theme');

function getProperty(obj, path) {
    if (obj === undefined || obj === null) return undefined;

    if (typeof obj.get === 'function') {
        const direct = obj.get(path);
        if (direct !== undefined) return direct;

        const full = obj.get();
        return path.split('.').reduce((o, i) => (o === undefined || o === null) ? o : o[i], full);
    }

    return path.split('.').reduce((o, i) => (o === undefined || o === null) ? o : o[i], obj);
}

function setProperty(obj, path, value) {
    if (obj && typeof obj.set === 'function') {
        obj.set(path, value);
        return;
    }

    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((o, i) => (o[i] = o[i] || {}), obj);
    if (target) {
        target[lastKey] = value;
    }
}

function createPaginator(commandHandler, chat, page, totalPages, baseCommand) {
    if (totalPages <= 1) return;

    chat.text('[', THEME.text);
    if (page > 1) {
        chat.runButton('«', `${baseCommand} --page 1`, 'Go to first page', THEME.primary);
    } else {
        chat.text('«', THEME.muted);
    }
    chat.text('] [', THEME.text);
    
    if (page > 1) {
        chat.runButton('<', `${baseCommand} --page ${page - 1}`, `Go to page ${page - 1}`, THEME.primary);
    } else {
        chat.text('<', THEME.muted);
    }
    
    chat.text('] ', THEME.text);
    chat.text(`Page ${page}/${totalPages}`, THEME.secondary);
    chat.text(' [', THEME.text);
    
    if (page < totalPages) {
        chat.runButton('>', `${baseCommand} --page ${page + 1}`, `Go to page ${page + 1}`, THEME.primary);
    } else {
        chat.text('>', THEME.muted);
    }
    
    chat.text('] [', THEME.text);
    if (page < totalPages) {
        chat.runButton('»', `${baseCommand} --page ${totalPages}`, 'Go to last page', THEME.primary);
    } else {
        chat.text('»', THEME.muted);
    }
    chat.text(']', THEME.text);
    chat.newline();
}

module.exports = { getProperty, setProperty, createPaginator }; 