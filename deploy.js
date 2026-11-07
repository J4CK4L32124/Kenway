const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Copies plugins/ from this project into the packaged Kenway install you play
// on. kenway.exe loads plugins from its own folder, so edits made here only
// take effect there after a deploy (and a restart of kenway.exe).
//
//   npm run deploy                         copy changed plugin files
//   npm run deploy -- --dry-run            show what would change, copy nothing
//   npm run deploy -- --force              also overwrite files changed in the install itself
//   npm run deploy -- "D:\other\Kenway"    deploy to a different install
//
// Only plugins/ is copied - config, data and auth_cache in the install are
// never touched, and nothing there is ever deleted.

const DEFAULT_TARGET = path.join(
  process.env.LOCALAPPDATA || 'C:\\Users\\Gebruiker\\AppData\\Local',
  'Kenway'
);
// Hashes of what was last deployed, kept in the install. Lets us tell "the
// project changed" (safe to copy) apart from "the install changed since the
// last deploy" (BWU's auto-updater, or an edit made there directly), which
// would otherwise be silently overwritten.
const MANIFEST_NAME = '.kenway-deploy.json';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const target = path.resolve(args.find(arg => !arg.startsWith('--')) || DEFAULT_TARGET);

const sourcePlugins = path.join(__dirname, 'plugins');
const targetPlugins = path.join(target, 'plugins');
const manifestPath = path.join(target, MANIFEST_NAME);

function listFiles(dir, base = dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(full, base));
        } else {
            files.push(path.relative(base, full).split(path.sep).join('/'));
        }
    }
    return files;
}

function hashFile(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Some plugin files in the install are read-only; keep them that way.
    const readOnly = fs.existsSync(dest) && (fs.statSync(dest).mode & 0o200) === 0;
    if (readOnly) fs.chmodSync(dest, 0o666);
    fs.copyFileSync(src, dest);
    if (readOnly) fs.chmodSync(dest, 0o444);
}

if (!fs.existsSync(path.join(target, 'kenway.exe')) || !fs.existsSync(targetPlugins)) {
    console.error(`Not a Kenway install (expected kenway.exe and plugins/ in ${target}).`);
    process.exit(1);
}

let manifest = { files: {} };
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
    // First deploy to this install - no record yet.
}
const lastDeployed = manifest.files || {};

console.log(`${dryRun ? '[dry run] ' : ''}Deploying plugins to ${target}`);

const sourceFiles = listFiles(sourcePlugins);
const deployed = {};
const copied = [];
const conflicts = [];
let unchanged = 0;

for (const file of sourceFiles) {
    const src = path.join(sourcePlugins, file);
    const dest = path.join(targetPlugins, file);
    const srcHash = hashFile(src);

    if (fs.existsSync(dest)) {
        const destHash = hashFile(dest);
        if (destHash === srcHash) {
            deployed[file] = srcHash;
            unchanged++;
            continue;
        }
        if (destHash !== lastDeployed[file] && !force) {
            conflicts.push(file);
            if (lastDeployed[file]) deployed[file] = lastDeployed[file];
            continue;
        }
    }

    console.log(`  ${fs.existsSync(dest) ? 'updated' : 'added  '}  ${file}`);
    if (!dryRun) copyFile(src, dest);
    copied.push(file);
    deployed[file] = srcHash;
}

for (const file of conflicts) {
    console.log(`  SKIPPED  ${file}  (changed in the install since the last deploy - check it, then re-run with --force to overwrite)`);
}

const sourceSet = new Set(sourceFiles);
const extras = listFiles(targetPlugins).filter(file => !sourceSet.has(file));
if (extras.length > 0) {
    console.log(`  Only in the install, left alone: ${extras.join(', ')}`);
}

// Core code (src/) is compiled into kenway.exe, so a deploy can't update it.
// Remember which src/ contents the installed exe was built from - reset
// whenever the exe itself is replaced, i.e. rebuilt from this project - and
// point out core changes it doesn't have yet. (File dates can't be used:
// unpacking the project gave every file a date newer than the exe.)
const exeStat = fs.statSync(path.join(target, 'kenway.exe'));
const exeId = `${exeStat.size}-${Math.round(exeStat.mtimeMs)}`;
const srcDir = path.join(__dirname, 'src');
const srcHashes = Object.fromEntries(listFiles(srcDir).map(file => [file, hashFile(path.join(srcDir, file))]));
const core = manifest.core && manifest.core.exe === exeId
    ? manifest.core
    : { exe: exeId, files: srcHashes };
const coreChanges = Object.keys({ ...core.files, ...srcHashes })
    .filter(file => core.files[file] !== srcHashes[file]);

if (!dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify({ deployedAt: new Date().toISOString(), files: deployed, core }, null, 2));
}

console.log(`${copied.length} ${dryRun ? 'would be copied' : 'copied'}, ${conflicts.length} skipped, ${unchanged} already up to date.`);
if (copied.length > 0 && !dryRun) {
    console.log('Restart kenway.exe to load the changes.');
}
if (coreChanges.length > 0) {
    console.log(`Note: kenway.exe doesn't include these core changes yet: src/${coreChanges.join(', src/')}. Those need a new kenway.exe build - deploy only copies plugins.`);
}
