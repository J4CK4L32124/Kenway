const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building executable...');

// @yao-pkg/pkg (maintained fork of the archived vercel/pkg) is a dev
// dependency, so `npm install` provides it.
try {
    execSync('npx --no-install pkg --version', { stdio: 'ignore' });
} catch (err) {
    console.error('pkg is missing. Run: npm install');
    process.exit(1);
}

const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

const pluginsSource = path.join(__dirname, 'plugins');
const pluginsDest = path.join(buildDir, 'plugins');

if (fs.existsSync(pluginsSource)) {
    if (fs.existsSync(pluginsDest)) {
        fs.rmSync(pluginsDest, { recursive: true, force: true });
    }
    fs.cpSync(pluginsSource, pluginsDest, { recursive: true });
}

try {
    execSync('npx --no-install pkg src/proxy.js --target node22-win-x64 --output build/kenway.exe', { stdio: 'inherit' });
    console.log('Build completed: build/kenway.exe');
} catch (err) {
    console.error('Build failed:', err.message);
    process.exit(1);
} 