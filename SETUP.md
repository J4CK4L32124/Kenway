# Kenway — install, distribution & auto-update

This repo builds a single Windows proxy exe plus plain-JS plugins, ships them
to friends via a small installer, and keeps every install worldwide up to date
through GitHub Releases.

## How it fits together

```
  you: npm version patch ; git push --tags
        │
        ▼
  GitHub Actions (.github/workflows/release.yml)
        │  builds kenway.exe, zips plugins, publishes a Release
        ▼
  GitHub Release  (kenway.exe, plugins.zip, launcher.ps1, manifest.json)
        │
        ▼
  every install's launcher.ps1 checks on startup → downloads if newer → runs
```

- **Launcher** (`updater/launcher.ps1`): the shortcut target. Checks the latest
  release, swaps in a newer exe/plugins if found, then starts `kenway.exe`.
  Never touches `config/`, `data/` or `auth_cache/`, so settings and the
  Microsoft login survive updates. Offline = just launches what's installed.
- **Repo setting** (`updater/update.config.json`): the ONE place the GitHub repo
  is named. Both the launcher and the installer read it.
- **Installer** (`installer/kenway.iss`): a tiny per-user installer
  (`%LOCALAPPDATA%\Kenway`, no admin). Ships only the launcher + config; the
  360 MB exe is downloaded on first launch, so the installer stays small and
  never goes stale.

Secrets never ship: `.gitignore` excludes `auth_cache/`, `config/`, `data/`,
key files, `build/`, and the separate `kenway-api/` backend.

## One-time setup

1. **Set your repo** in `updater/update.config.json` → `"repo": "yourname/Kenway"`.
2. **Create the GitHub repo and push** (public is simplest for worldwide updates):
   ```bash
   git init
   git add .
   git commit -m "Kenway"
   gh auth login
   gh repo create Kenway --public --source=. --remote=origin --push
   ```
3. **First release** (triggers the auto-build):
   ```bash
   npm version patch        # 1.0.0 -> 1.0.1, makes the git tag
   git push && git push --tags
   ```
   Watch it under the repo's **Actions** tab; when done, a Release with the
   assets appears.
4. **Build the installer**: install Inno Setup, then right-click
   `installer/kenway.iss` → **Compile**. Share `installer/Output/Kenway-Setup.exe`.

## Pushing an update later

```bash
npm version patch
git push && git push --tags
```
That's it — the Action rebuilds and republishes, and every install updates on
its next launch.

## Local dev (your machine)

Unchanged and instant, no GitHub round-trip:
- plugins: `npm run deploy`
- core: `npm run build`, then swap the exe into your install.
