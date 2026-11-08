# Kenway

A Minecraft 1.8.9 proxy for Hypixel with an advanced plugin system, packet modification capabilities, and built-in security features. Designed to provide an alternative to Forge mods or scripting APIs, but for legit players and on any client.

Kenway is a continuation of the legacy Starfish Proxy codebase (originally by Hexze), revamped and maintained independently, with a standard set of bundled plugins (anticheat, nick detection, tab utilities, Bedwars utilities, and more) included by default.

## Quick Start

### For Users

1. Extract the release ZIP and run `kenway.exe`
2. Connect with Minecraft 1.8.9:
   - Add server: `localhost`
   - Complete Microsoft authentication on first connect
   - Reconnect after authentication

### For Developers

1. Install dependencies:

```bash
npm install
```

2. Start the proxy:

```bash
npm start
```

3. Connect with Minecraft 1.8.9 to `localhost`

## Commands

All commands use the format `/module command [args]`. Use `/proxy help` to get started.

**📖 See [COMMANDS.md](COMMANDS.md) for the full, friend-friendly command reference** (key setup, stats, denicking, and every plugin's commands).

### Core Proxy Commands

- `/proxy help` - Show all proxy commands
- `/proxy server` - List available servers
- `/proxy server <name|host:port>` - Switch server target
- `/proxy addserver <name> <host:port>` - Save a server
- `/proxy removeserver <name>` - Remove saved server
- `/proxy reauth` - Force re-authentication
- `/proxy plugins` - List loaded plugins

### Plugin Commands

Each plugin includes these commands by default:

- `/<plugin> help` - Show plugin-provided commands
- `/<plugin> config` - Open configuration UI

## Standard Plugins

Kenway ships with the following plugins enabled by default (in `plugins/`):

- **anticheat** - Clientside cheat detection: AutoBlock, NoSlowdown, KillAura and Legit Scaffold (EagleA), with a clickable WDR report button on alerts
- **nickbot** (+ web server UI) - Automated nickname rolling
- **denicker** / **numdenicker** / **cosmeticdenicker** - Nick detection (skin data, numbered kill/bed messages, and Bedwars cosmetics - kill messages, final kill effects, death cries, bed destroys, projectile trails, wood skins - via the Frosty API)
- **tabalign** - Tab list icons/alignment for cheater & sniper indicators
- **urchin** - Cheater detection UI
- **quickrequeue** - Fast game requeueing
- **bw-utilities-core** (+ src) - Bedwars player stats (chat and tab) and party finder

## Configuration

Configuration files are stored in:

- `config/kenway-config.json` - Main proxy settings
- `config/plugins/*.config.json` - Plugin configurations
- `data/*.data.json` - Plugin persistent data

### Main Configuration

```json
{
  "proxyPort": 25565,
  "targetHost": "mc.hypixel.net",
  "targetPort": 25565,
  "servers": {
    "hypixel": { "host": "mc.hypixel.net", "port": 25565 }
  }
}
```

## Creating Plugins

Plugins are JavaScript files placed in the `plugins/` directory. Look at the bundled plugins in this project for advanced usage, but here's a minimal example:

```javascript
module.exports = (api) => {
  // Plugin metadata
  api.metadata({
    name: "example",
    displayName: "Example Plugin",
    prefix: "§cEX", // [Kenway-EX]
    version: "1.0.0",
    author: "Your Name",
    description: "A simple example plugin",
  });

  // Configuration schema
  api.configSchema([
    {
      label: "Settings",
      settings: [
        {
          key: "enabled",
          type: "toggle",
          description: "Enable the plugin",
        },
      ],
      defaults: { enabled: true },
    },
  ]);

  // Register commands
  api.commands((registry) => {
    registry
      .command("test")
      .description("Test command")
      .handler((ctx) => {
        ctx.send("§aHello");
      });
  });

  // Listen to events
  api.on("chat", (event) => {
    if (event.message.includes("Hello")) {
      api.chat("§eHi");
    }
  });
};
```

### Plugin API Reference

#### Core Methods

- `api.metadata(config)` - Define plugin metadata
- `api.configSchema(schema)` - Define configuration options
- `api.commands(callback)` - Register commands
- `api.on(event, handler)` - Listen to events
- `api.intercept(event, handler)` - Intercept and modify packets

#### Communication

- `api.chat(message)` - Send chat message
- `api.sound(name, x?, y?, z?)` - Play sound
- `api.sendTitle(title, subtitle?)` - Display title
- `api.sendActionBar(text)` - Show action bar text

#### Player Information

- `api.getPlayers()` - Get all players
- `api.getPlayerByName(name)` - Find player by name
- `api.getCurrentPlayer()` - Get the proxy user
- `api.getPlayerTeam(name)` - Get player's team

#### Hypixel API

- `api.getPartyInfo(callback, timeout?)` - Get current party information
- `api.getPartyInfoAsync(timeout?)` - Get party info with Promise support
- `api.isInParty(callback, timeout?)` - Check if player is in a party
- `api.getPlayerRole(callback, timeout?)` - Get player's party role (LEADER, MOD, MEMBER)
- `api.getPing(callback, timeout?)` - Test Hypixel API ping with latency measurement
- `api.getPingAsync(timeout?)` - Get ping info with Promise support

#### Display Names

- `api.setDisplayNamePrefix(uuid, prefix)` - Set a prefix before player name
- `api.appendDisplayNamePrefix(uuid, prefix)` - Add to existing prefix
- `api.prependDisplayNamePrefix(uuid, prefix)` - Add before existing prefix
- `api.setDisplayNameSuffix(uuid, suffix)` - Set a suffix after player name
- `api.appendDisplayNameSuffix(uuid, suffix)` - Add to existing suffix
- `api.prependDisplayNameSuffix(uuid, suffix)` - Add before existing suffix
- `api.clearDisplayNamePrefix(uuid)` - Remove prefix for player
- `api.clearDisplayNameSuffix(uuid)` - Remove suffix for player
- `api.clearAllDisplayNames()` - Clear all custom prefixes/suffixes
- `api.getDisplayNamePrefix(uuid)` - Get current prefix for player
- `api.getDisplayNameSuffix(uuid)` - Get current suffix for player

### Available Events

- `chat` - Chat messages received
- `player_join` - Player joins the game
- `player_leave` - Player leaves the game
- `respawn` - Player respawns or changes servers
- `player_move` - Player movement
- `entity_spawn` - Entity spawns
- `plugin_restored` - Plugin re-enabled

### Packet Events

For advanced usage, you can intercept packets:

```javascript
api.intercept("packet:server:chat", (event) => {
  // read packet data
  console.log(event.data);

  // cancel packet (safe packets only)
  event.cancel();

  // modify packet (safe packets only)
  event.modify({ ...event.data, message: "Modified!" });
});
```

## Hypixel Integration

The proxy includes built-in support for Hypixel's custom packet APIs:

### Party Information API

```javascript
// get party information
api.getPartyInfo((result) => {
  if (result.success) {
    console.log(`In party: ${result.inParty}`);
    console.log(`Members: ${result.members.length}`);
    result.members.forEach((member) => {
      console.log(`${member.uuid}: ${member.role}`);
    });
  }
});

// check if someone is party leader
api.getPlayerRole((role) => {
  if (role === "LEADER") {
    console.log("You are the party leader!");
  }
});
```

### Ping API

```javascript
// get hypixel ping
api.getPing((result) => {
  if (result.success) {
    console.log(`Latency: ${result.latency}ms`);
  }
});
```

## Security & Safety

The proxy enforces packet safety to maintain compatibility with Hypixel:

**Safe to Modify:**

- Chat messages, sounds, titles, particles
- Tab list display names
- Scoreboard data

**Read-Only:**

- Player movement and rotation
- Combat actions
- Block interactions
- Inventory actions

## Credits

- Based on the legacy Starfish Proxy codebase, originally created by Hexze (with J0nahG, Desiyn, and nilsraccoon contributing to the original project). Starfish's legacy branch has been discontinued; Kenway continues and revamps it independently.
- The anticheat's attack detection (who hit whom) and its Autoblock, NoSlowdown, KeepSprint and KillAura (eating / through players) checks are ported from the hacker detector of [MWE](https://github.com/Alexdoru/MWE) by Alexdoru, under its non-commercial license (full notice in `src/packets/attack-detector.js` and the anticheat plugin). Because of that license, Kenway must not be sold or used commercially.
