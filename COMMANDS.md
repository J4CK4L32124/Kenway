# Kenway — Command Reference

Every command is typed in Minecraft chat while connected through the proxy
(`localhost:25565`). Plugin commands are `/<plugin> <subcommand>`.

---

## 🚀 First-time setup

Most stats features need a **Hypixel API key**. Get one (free) at
**[developer.hypixel.net](https://developer.hypixel.net)** (sign in with Discord),
then set it everywhere at once:

```
/kenway setallkey <your-hypixel-key>
```

That fills in the key for **both** the chat-stats plugin (bwu) and the tab-list
stats plugin (tabalign). It takes effect immediately — no restart. (You can
still set them individually with `/bwu setkey` and `/tabalign setkey`.)

| What you want | Command | Key needed |
|---|---|---|
| Stats in **chat** + **tab**, one shot | `/kenway setallkey <key>` | Hypixel |
| Stats in **chat** only | `/bwu setkey <key>` | Hypixel |
| Stats in the **tab list** only | `/tabalign setkey <key>` | Hypixel |

---

## Universal commands (work on every plugin)

| Command | Description |
|---|---|
| `/<plugin> help` | Show that plugin's help and command list |
| `/<plugin> config` | Open the plugin's settings UI |
| `/<plugin> enable` | Turn the plugin on |
| `/<plugin> disable` | Turn the plugin off |

Example: `/anticheat config`, `/partycounter help`, `/quickrequeue disable`.

---

## `/proxy` — core proxy

| Command | Description |
|---|---|
| `/proxy help` | Show proxy help |
| `/proxy plugins` | List loaded plugins |
| `/proxy server <name>` | Switch to a configured server |
| `/proxy addserver <name> <host:port>` | Add a server target |
| `/proxy removeserver <name>` | Remove a server target |
| `/proxy reauth` | Force Microsoft re-authentication |

---

## `/kenway` — Kenway Blacklist & key setup

| Command | Description |
|---|---|
| `/kenway setallkey <key>` | **Set your Hypixel API key for every plugin that uses one** |
| `/kenway lookup <player>` | Look up what Kenway's blacklist knows about a player |
| `/kenway report <player> <reason>` | Submit a report (needs a reporter key) |
| `/kenway setkey <key>` | Set your Kenway **reporter** key (for reports) |
| `/kenway seturl <url>` | Set the Kenway blacklist API URL |

---

## `/bwu` — BedWars Utilities (chat stats)

| Command | Description |
|---|---|
| `/bwu setkey <key>` | Set your Hypixel API key (chat stats) |
| `/bwu stats <player>` | Show a player's BedWars stats |
| `/bwu allstats` | Show stats for everyone in the lobby |
| `/bwu setthreshold <fkdr>` | FKDR threshold for auto-requeue |
| `/bwu setaurora <key>` | Set an Aurora (bordic) key for ping display (optional) |
| `/bwu m <text>` / `/bwu setmacro` / `/bwu macros` | Chat macros |
| `/bwu setqdmsg <slot> <msg>` | Queue-dodge messages |

(Chat/tab stats for nicked players are resolved automatically — see "Denicking".)

## `/tabalign` — Tablist Alignment (tab stats)

| Command | Description |
|---|---|
| `/tabalign setkey <key>` | Set your Hypixel API key (tab stats) |
| `/tabalign teststats` | Test your Hypixel key against the API |
| `/tabalign status` | Show key/render status |
| `/tabalign refresh` / `/tabalign force` | Re-render the tab list |
| `/tabalign setbordickey <key>` | Bordic key for extra stats (optional) |
| `/tabalign seturchinkey <key>` | Urchin key for cheater tags in tab (optional) |
| `/tabalign pack` | Resource-pack helper (tab alignment) |

---

## Denicking

| Plugin | Command | Notes |
|---|---|---|
| `/denicker` | `/denicker findskin <player>` | Auto-denicks from skin data — **no key needed** |
| `/numdenicker` | `/numdenicker setkey <key>` | Finals/beds-based denick (needs an Aurora/bordic key) |
| `/cosmeticdenicker` | `/cosmeticdenicker setkey <key>` · `/cosmeticdenicker status` | Cosmetic-based denick (needs a TrickAPI key) |

`denicker` (Nick Alerts) resolves nicks automatically from each player's skin
and feeds the result to bwu/tabalign, so denicked players show real stats with
no extra key.

---

## `/anticheat` — Cheater Detector

Runs automatically; flags show in chat with a clickable `[WDR]` button. Use
`/anticheat config` to tune checks and `/anticheat enable|disable`.

## `/urchin` — Urchin Blacklist Integration

| Command | Description |
|---|---|
| `/urchin setkey <key>` | Set your Urchin API key |
| `/urchin testapi` | Test the Urchin key |
| `/urchin tag <player>` / `/urchin forcetag <player>` | Show/force a player's Urchin tags |

## Other plugins

| Plugin | Purpose | Main commands |
|---|---|---|
| `/partycounter` | Announces party join/leave counts | `config`, `enable`, `disable` |
| `/quickrequeue` | Fast re-queue helpers | `config`, `enable`, `disable` |
| `/nickbot` | Nick tooling + web UI | `/nickbot` |

---

## API keys at a glance

| Key | Where to get it | Used by |
|---|---|---|
| **Hypixel** | developer.hypixel.net | bwu, tabalign (set both with `/kenway setallkey`) |
| **Aurora / bordic** (optional) | bordic.xyz | numdenicker, `/bwu setaurora`, `/tabalign setbordickey` |
| **Urchin** (optional) | urchin.gg | urchin, `/tabalign seturchinkey` |
| **TrickAPI** (optional) | trickapi.duckdns.org | cosmeticdenicker |
| **Kenway reporter** (optional) | your Kenway admin | `/kenway report` |

> Tip: run `/<plugin> help` in-game for the most up-to-date list — this file is a
> curated overview of the commands most people need.
