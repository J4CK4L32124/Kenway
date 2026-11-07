// Advanced Anticheat System
// Adapted from Pug's Custom Anticheat Raven script (github.com/PugrillaDev)
//
// AutoBlockA, NoSlowA, KeepSprintA and KillAuraA's eating / through-players
// patterns are ported from the hacker detector of MWE by Alexdoru
// (https://github.com/Alexdoru/MWE, fr.alexdoru.mwe.hackerdetector), as is the
// per-tick sampling they run on and Kenway's core attack detector that tells
// them who hit whom. Ported under this notice:
//
// --- MWE notice ---------------------------------------------------------------
// Copyright (c) [2026] [Alexdoru]
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to use,
// copy, modify, merge, publish, distribute, and sublicense the Software, subject
// to the following conditions:
//
// 1. Any use of the Software, or any portion thereof, for commercial purposes is prohibited.
//
// 2. Commercial purposes include, but are not limited to:
//
//     * Selling the Software or any portion of it;
//     * Charging for access to the Software or any portion of it;
//     * Using the Software, any portion of it, or any derivative work based upon it in a product or service for which
//       payment is received;
//     * Using the Software, any portion of it, or any derivative work based upon it to generate revenue directly or
//       indirectly;
//     * Incorporating any code, functionality, algorithms, components, modules, or substantial portions of the Software
//       into any commercial product, service, or business activity.
//
// 3. No portion of the Software may be copied, incorporated, adapted, modified, or redistributed for commercial purposes,
//    whether in its original form or as part of another work, product, or service.
//
// 4. This copyright notice and permission notice shall be included in all copies
//    or substantial portions of the Software.
//
// 5. Permission for commercial use may be granted only through prior written authorization from the copyright holder.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHOR BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// -------------------------------------------------------------------------------
//
// 2026-10 rework notes (read this before tuning numbers):
//
// 2026-10 (later) - NoSlowA, AutoBlockA, EagleA and ScaffoldA's detection
// logic were replaced with ports of the equivalent checks from Mellow
// (com.roxiun.mellow.anticheat, a client-side Forge mod for Hypixel -
// NoSlowCheck/AutoBlockCheck/EagleCheck/ScaffoldCheck), at the user's
// request, after decompiling the relevant classes to understand their exact
// trigger conditions and VL formulas. These are independent reimplementations
// of the same detection *logic* (conditions, thresholds, severity formulas),
// not copied source - and where Mellow's own code assumes things only true
// of a Forge mod running on the local client (a guaranteed 20Hz tick, exact
// per-tick position deltas), that assumption is called out and adapted
// below rather than carried over blindly. TowerA is disabled by default as
// of this change - see its own comment.
//
// This plugin only ever sees what Hypixel broadcasts to us about OTHER
// players - the same protocol visibility any client-side "legit anticheat"
// mod has. Two hard limits that shaped this rewrite:
//
//   1. Look-only rotation packets (entity_look, a player turning in place)
//      never reach plugins as events. Kenway's game state still applies
//      them, and the server only re-sends rotation when it changes, so
//      syncRotation copies the current rotation from the game state on
//      every movement/swing/metadata event. Checks that use facing
//      direction still require a recent sync before trusting it.
//   2. We never see another player's health, so we can't tell whether a
//      fall "should" have hurt them. That rules out an honest NoFall check.
//      We also can't see who the server credited an attack to (use_entity
//      packets are client->server and only visible for OUR OWN attacks) -
//      Reach/KillAura below work by correlating "who swung right before this
//      player's hurt animation + knockback fired", which is an inference,
//      not a certainty. Treat repeated flags as the real signal.
//
// Not included on purpose, and why:
//   - NoFall: no visibility into other players' health/fall damage.
//   - Timer: from a third-party observer the server still broadcasts
//     movement at its own tick rate regardless of the other client's local
//     timer - that's a server-side-only signal, not something visible here.
//   - Phase/NoClip: would need a full voxel world model built from chunk
//     data, which this plugin doesn't parse. Real project on its own if
//     wanted later.
//   - Fake criticals: in 1.8 the crit particle/sound is predicted locally by
//     the attacker's own client, not told to observers over the wire.
//
// Every numeric threshold below is a first-pass, deliberately-documented
// estimate - none of this has been tuned against a live game yet. Expect to
// adjust vl/cooldown/the raw constants after watching it run for real.

module.exports = (api) => {
    api.metadata({
        name: 'anticheat',
        displayName: 'Cheater Detector',
        prefix: '§cAC',
        version: '0.2.1',
        author: 'Hexze',
        description: 'Advanced cheater detector system (Inspired by github.com/PugrillaDev)',
    });

    const anticheat = new AnticheatSystem(api);

    const configSchema = [
        {
            label: 'General',
            defaults: { onlyInGames: true },
            settings: [
                {
                    type: 'toggle',
                    key: 'onlyInGames',
                    text: ['OFF', 'ON'],
                    description: 'Only run checks inside an actual game (detected via /locraw). Lobbies have flight, launch pads and double jumps that look like cheats. Turn off when testing on non-Hypixel servers.'
                }
            ]
        },
        {
            label: 'Report Button',
            defaults: { wdr: { enabled: true, command: '/wdr {player}' } },
            settings: [
                {
                    type: 'toggle',
                    key: 'wdr.enabled',
                    text: ['OFF', 'ON'],
                    description: 'Add a clickable [WDR] button to flag alerts that reports the player on Hypixel.'
                },
                {
                    type: 'text',
                    key: 'wdr.command',
                    description: 'Command run when the button is clicked. {player} becomes the flagged player\'s name.',
                    placeholder: '/wdr {player}'
                }
            ]
        }
    ];
    const checkDefinitions = getCheckDefinitions();

    for (const checkName in checkDefinitions) {
        const defaultCheckConfig = checkDefinitions[checkName];

        configSchema.push({
            label: checkName,
            defaults: { checks: { [checkName]: defaultCheckConfig } },
            settings: [
                {
                    type: 'toggle',
                    key: `checks.${checkName}.enabled`,
                    text: ['OFF', 'ON'],
                    description: defaultCheckConfig.description || `Enables or disables the ${checkName} check.`
                },
                {
                    type: 'soundToggle',
                    key: `checks.${checkName}.sound`,
                    condition: (cfg) => cfg.checks[checkName].enabled,
                    description: 'Toggles sound alerts for this check.'
                },
                {
                    type: 'cycle',
                    key: `checks.${checkName}.vl`,
                    values: [
                        { text: 'VL: 5', value: 5 },
                        { text: 'VL: 10', value: 10 },
                        { text: 'VL: 15', value: 15 },
                        { text: 'VL: 20', value: 20 },
                        { text: 'VL: 30', value: 30 }
                    ],
                    condition: (cfg) => cfg.checks[checkName].enabled,
                    description: 'Sets the violation level to trigger an alert.'
                },
                {
                    type: 'cycle',
                    key: `checks.${checkName}.cooldown`,
                    values: [
                        { text: 'CD: 0s', value: 0 },
                        { text: 'CD: 1s', value: 1000 },
                        { text: 'CD: 2s', value: 2000 },
                        { text: 'CD: 3s', value: 3000 }
                    ],
                    condition: (cfg) => cfg.checks[checkName].enabled,
                    description: 'Sets the cooldown between alerts for this check.'
                }
            ]
        });
    }

    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    anticheat.registerHandlers();

    return {
        enable: () => {
            anticheat.refreshConfigConstants();
            api.debugLog('[AC] Anticheat plugin enabled with debug logging');
        },
        disable: () => {
            anticheat.cleanup();
            api.debugLog('[AC] Anticheat plugin disabled');
        }
    };
};

// Approximate 1.8 standing eye height, and the point on a target we aim
// reach/facing math at (roughly chest height) - both constants, not measured
// per-player, since we don't get a precise bounding box over the wire.
const EYE_HEIGHT = 1.62;
const TARGET_CENTER_OFFSET = 0.9;

// How far back to look for a plausible attacker once a victim's hurt
// animation + knockback fires, and how far away a candidate can be and still
// be considered at all (broadcast positions are 1-2 ticks stale for both
// players by the time we see them, so this has to be generous).
const ATTACK_SWING_WINDOW_MS = 300;
const ATTACK_MAX_CANDIDATE_DIST = 8;

// Swords, axes, pickaxes, shovels, stick (knockback stick) and shears.
const MELEE_ITEM_IDS = new Set([
    267, 268, 272, 276, 283,
    258, 271, 275, 279, 286,
    257, 270, 274, 278, 285,
    256, 269, 273, 277, 284,
    280, 359,
]);

// Angle helpers for EagleA/ScaffoldA, ported alongside those checks from
// Mellow (net.minecraft.util.MathHelper.wrapAngleTo180_double/_float in
// vanilla terms). Both checks only trust these once lastRotationUpdateTime
// is fresh - see the file header on rotation-packet visibility.
function wrapDegrees(deg) {
    let d = deg % 360;
    if (d >= 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

// Mellow's EagleCheck.getRelativeMoveAngle: angle of travel relative to where
// the player is looking, 0 = moving exactly where they're facing, ±180 =
// moving exactly backwards.
function getRelativeMoveAngle(dx, dz, yaw) {
    const moveAngle = Math.atan2(-dx, dz) * (180 / Math.PI);
    return wrapDegrees(moveAngle - yaw);
}

// Mellow's ScaffoldCheck.getMoveLookAngleDiff: same idea, different axis
// convention (kept exactly as the mod computes it rather than unified with
// getRelativeMoveAngle above, since the two checks' thresholds were tuned
// against these specific formulas).
function getMoveLookAngleDiff(dx, dz, yaw) {
    const moveAngle = Math.atan2(dz, dx) * (180 / Math.PI) - 90;
    const lookAngle = wrapDegrees(yaw);
    let diff = (moveAngle - lookAngle + 360) % 360;
    if (diff > 180) diff -= 360;
    return diff;
}

// SpeedA: how long after being hit, receiving a velocity packet, or
// teleporting a player's movement is unreliable (fireball/TNT jumps don't
// send observers a velocity packet, but they do send the hurt status).
const MOVEMENT_EXEMPT_MS = 2500;
const TELEPORT_EXEMPT_MS = 1000;
// A gap this long between two movement samples means the player (or our
// connection) lagged; the catch-up packets that follow look like a burst.
const LAG_GAP_MS = 300;
// entity_teleport jumps bigger than this are real teleports (pearls,
// respawns, server corrections), not movement.
const TELEPORT_DISTANCE = 4;

// Hypixel only gives real accounts version-4 UUIDs and nicked players
// version-1 (same rule tabalign/denicker use). Everything else - lobby and
// shop NPCs, Watchdog's invisible orbiting bots - is a fake entity whose
// scripted movement looks like Fly/Speed. Those were most of the old spam.
function isRealPlayerUuid(uuid) {
    const hex = typeof uuid === 'string' ? uuid.replace(/-/g, '') : '';
    if (hex.length !== 32) return false;
    return hex[12] === '4' || hex[12] === '1';
}

function isMovementExempt(player) {
    const now = Date.now();
    return now - player.lastDamaged < MOVEMENT_EXEMPT_MS ||
        now - player.lastVelocityTime < MOVEMENT_EXEMPT_MS ||
        now - player.lastTeleportTime < TELEPORT_EXEMPT_MS ||
        player.isInvisible; // Hypixel spectators are invisible and can fly
}

// First and last positionHistory samples within the last `windowMs`,
// or null if the window is too short or contains a lag gap.
function getMovementWindow(player, windowMs, minSpanMs) {
    const now = Date.now();
    const samples = player.positionHistory.filter(s => now - s.t <= windowMs);
    if (samples.length < 3) return null;

    for (let i = 1; i < samples.length; i++) {
        if (samples[i].t - samples[i - 1].t > LAG_GAP_MS) return null;
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const spanMs = last.t - first.t;
    if (spanMs < minSpanMs) return null;

    return { first, last, samples, seconds: spanMs / 1000 };
}

// EagleA's double-shift pattern, built from a Hypixel replay of a diagonal
// scaffolder (cheater.mp4, 2026-10-04): at each diagonal step the player
// crouched, let go of shift for only 1-2 ticks, and crouched again while
// placing blocks - 3 times in about 5 seconds. A human double-tapping shift
// leaves a longer gap, and a legit bridger either holds shift through both
// blocks or walks between taps. The crouches were 100-250ms, longer than the
// quick-crouch pattern's 50-100ms, so that pattern alone missed it.
const DOUBLE_SHIFT_MAX_GAP_MS = 60;       // released for one server tick (a fast human re-tap takes ~2)
const DOUBLE_SHIFT_MAX_CROUCH_MS = 400;   // the first crouch was a tap, not a hold
const DOUBLE_SHIFT_WINDOW_MS = 8000;
const DOUBLE_SHIFT_COUNT = 2;

// Mellow's quick-crouch patterns (short shift taps timed with the placement)
// match legit ninja bridging too, so they only write to the debug log.
const EAGLE_MELLOW_ALERTS = false;

// Moving roughly diagonally to the block grid (between ~22 and ~68 degrees)
// over the last `windowMs` - the zig-zag bridge needs a block at each edge
// per step, which is where the double shift comes from.
function bridgeDirection(player, windowMs) {
    const now = Date.now();
    const recent = player.positionHistory.filter(s => now - s.t <= windowMs);
    if (recent.length < 2) return null;
    const dx = Math.abs(recent[recent.length - 1].x - recent[0].x);
    const dz = Math.abs(recent[recent.length - 1].z - recent[0].z);
    if (Math.hypot(dx, dz) < 0.5) return null;
    const ratio = dx / Math.max(dz, 1e-6);
    return ratio >= 0.4 && ratio <= 2.5 ? 'diagonal' : 'straight';
}

function isMovingDiagonally(player, windowMs) {
    return bridgeDirection(player, windowMs) === 'diagonal';
}

// EagleA's two-blocks-in-one-shift pattern: bridging straight, a legit
// bridger needs one sneak per block (or, holding shift, sneak-walks a whole
// block - ~0.75s - between placements). Two blocks placed under the player
// within one crouch and less than this far apart means the blocks were
// placed for them.
const TWO_BLOCKS_MAX_INTERVAL_MS = 450;

// TowerA: legit jump-towering tops out around 2.0-2.2 blocks/s.
const TOWER_BLOCKS = 4;
const TOWER_MAX_BLOCKS_PER_SECOND = 2.8;

// EagleA's release-timing pattern: eagle modules let go of sneak a set time
// after the block is placed (Vape's "Sneak Delay"; others a narrow random
// band like 100-150ms). We see both moments at server-tick resolution, so a
// fixed delay or a narrow band shows up as delays within one 50ms window.
// A human hand varies more than that over 8 blocks in a row.
const RELEASE_STREAK_BLOCKS = 10;
// Placement and release arrive in 50ms server ticks, so a spread under half
// a tick means every release landed in the same tick after its block. (50ms
// let two neighbouring ticks pass, which a steady human bridger manages.)
const RELEASE_MAX_SPREAD_MS = 25;

// Bridging up: the player rose at least 0.8 blocks over the last `windowMs`.
function isBridgingUp(player, windowMs) {
    const now = Date.now();
    const recent = player.positionHistory.filter(sample => now - sample.t <= windowMs);
    if (recent.length < 2) return false;
    return recent[recent.length - 1].y - Math.min(...recent.map(sample => sample.y)) >= 0.8;
}

// Called when a crouch ends. Returns true when the last RELEASE_STREAK_BLOCKS
// crouches, each with a block placed under the player, released sneak within
// RELEASE_MAX_SPREAD_MS of the same delay after the placement - all on a flat
// bridge, or all while bridging up. A module's delay doesn't change when
// climbing, while a human gets less regular, so climbing gets its own streak;
// switching between flat and up, a crouch without a block, or not bridging
// starts the streak over.
function detectFixedReleaseDelay(player) {
    const release = player.lastStopCrouchTime;
    const crouchStart = player.lastCrouchTime; // the crouch that just ended
    const placed = player.underPlacements.filter(p => p.t >= crouchStart - 50 && p.t <= release);
    const delay = placed.length > 0 ? release - placed[placed.length - 1].t : -1;
    let kind = null;
    if (player.isHoldingBlock()) {
        if (isBridgingUp(player, 1500)) kind = 'up';
        else if (bridgeDirection(player, 1500) !== null && isBridgingFlat(player, 1000)) kind = 'flat';
    }
    if (!kind || delay < 0 || delay > 500 || kind !== player.releaseKind) {
        player.releaseDelays = [];
        player.releaseKind = kind;
        if (!kind || delay < 0 || delay > 500) return false;
    }

    player.releaseDelays = (player.releaseDelays || []).concat(delay).slice(-RELEASE_STREAK_BLOCKS);
    if (player.releaseDelays.length < RELEASE_STREAK_BLOCKS) return false;
    const spread = Math.max(...player.releaseDelays) - Math.min(...player.releaseDelays);
    if (spread > RELEASE_MAX_SPREAD_MS) return false;

    player.releaseDelays = [];
    return true;
}

// Called when a block appears under the player. Returns true (once per
// crouch) when two different blocks went under them during one crouch,
// quickly, while bridging straight.
// Bridging flat: the player's height varied less than 0.3 blocks over the
// last `windowMs`. Bridging up, towering and jumping legitimately place
// blocks fast and break shifting up, so EagleA only judges flat bridges.
function isBridgingFlat(player, windowMs) {
    const now = Date.now();
    const recent = player.positionHistory.filter(sample => now - sample.t <= windowMs);
    if (recent.length < 2) return false;
    let min = Infinity;
    let max = -Infinity;
    for (const sample of recent) {
        min = Math.min(min, sample.y);
        max = Math.max(max, sample.y);
    }
    return max - min < 0.3;
}

function detectTwoBlocksInOneShift(player) {
    const crouchStart = player.lastCrouchTime;
    if (!crouchStart || player.eagleTwoBlockCrouch === crouchStart) return false;
    const crouchEnd = player.isCrouching ? Infinity : player.lastStopCrouchTime + 100;

    const firstTimes = new Map(); // block position -> when it was placed
    for (const placement of player.underPlacements) {
        if (placement.t < crouchStart - 50 || placement.t > crouchEnd) continue;
        if (!firstTimes.has(placement.key)) firstTimes.set(placement.key, placement.t);
    }
    const placed = [...firstTimes.entries()];
    if (placed.length < 2) return false;
    const [lastKey, lastTime] = placed[placed.length - 1];
    const [prevKey, prevTime] = placed[placed.length - 2];
    if (lastTime - prevTime > TWO_BLOCKS_MAX_INTERVAL_MS) return false;
    // The second block must continue the bridge: next to the first along one
    // axis. Widening the bridge or placing a block beside you is legit.
    const [lx, , lz] = lastKey.split(',').map(Number);
    const [px, , pz] = prevKey.split(',').map(Number);
    if (Math.abs(lx - px) + Math.abs(lz - pz) !== 1) return false;
    // ...and the player must have moved most of a block between the two while
    // crouched - sneaking covers ~0.6 blocks in 450ms, so a module did it.
    const atPrev = [...player.positionHistory].reverse().find(sample => sample.t <= prevTime);
    const atLast = [...player.positionHistory].reverse().find(sample => sample.t <= lastTime + 100);
    if (!atPrev || !atLast || Math.hypot(atLast.x - atPrev.x, atLast.z - atPrev.z) < 0.7) return false;
    // Both blocks at the same height, on a flat bridge: bridging up places a
    // block under you every jump, legitimately.
    if (lastKey.split(',')[1] !== prevKey.split(',')[1] || !isBridgingFlat(player, 1000)) return false;
    if (!player.isHoldingBlock() || bridgeDirection(player, 1500) !== 'straight') return false;

    player.eagleTwoBlockCrouch = crouchStart;
    return true;
}

// Called when a crouch starts. Returns true once DOUBLE_SHIFT_COUNT double
// shifts happened within DOUBLE_SHIFT_WINDOW_MS while bridging diagonally.
function detectDoubleShift(system, player) {
    const now = Date.now();
    player.doubleShifts = (player.doubleShifts || []).filter(t => now - t <= DOUBLE_SHIFT_WINDOW_MS);

    const events = player.shiftEvents;
    if (events.length < 3) return false;
    const [start1, stop1, start2] = events.slice(-3);
    if (start1.type !== 'start' || stop1.type !== 'stop' || start2.type !== 'start') return false;

    const gap = start2.timestamp - stop1.timestamp;
    const firstCrouch = stop1.timestamp - start1.timestamp;
    if (gap > DOUBLE_SHIFT_MAX_GAP_MS || firstCrouch > DOUBLE_SHIFT_MAX_CROUCH_MS) return false;

    // Only while bridging diagonally: block in hand, looking down, a block
    // placed during the first crouch, and moving diagonally - not someone
    // spamming shift over a kill.
    const placedBlock = player.lastSwingTime >= start1.timestamp - 50;
    const bridging = player.isHoldingBlock() && player.pitch >= 45 && placedBlock &&
        isMovingDiagonally(player, 1500) && isBridgingFlat(player, 1000);
    if (!bridging) return false;

    player.doubleShifts.push(now);
    system.api.debugLog(`[EagleA] ${player.username} double-shift: crouched ${firstCrouch}ms, released ${gap}ms - ${player.doubleShifts.length} in ${DOUBLE_SHIFT_WINDOW_MS / 1000}s`);
    if (player.doubleShifts.length < DOUBLE_SHIFT_COUNT) return false;

    player.doubleShifts = [];
    return true;
}

// KBDisplaceA (autodisplace / hitflick)
const DISPLACE_MAX_HIT_DIST = 4.0;      // 3-block reach plus broadcast staleness
const DISPLACE_SWING_WINDOW_MS = 100;   // a real hit's swing and hurt land in the same tick
const DISPLACE_EVAL_DELAY_MS = 250;     // wait for the knockback and the rotations after the hit
const DISPLACE_KB_ANGLE = 40;           // knockback this far off the attacker->victim line is displaced
const DISPLACE_KB_ANGLE_FROM_MOVEMENT = 50; // looser when only the victim's movement is known
const DISPLACE_LOOK_TOLERANCE = 30;     // "visibly looking at the victim"
const DISPLACE_SPIKE_MIN = 60;          // one-update flick: jump at least this far...
const DISPLACE_SPIKE_RETURN = 10;       // ...and come back within this
const DISPLACE_SPIKE_SPAN_MS = 100;     // ...within ~2 ticks
const DISPLACE_WINDOW_HITS = 8;
const DISPLACE_WINDOW_MS = 15000;
const DISPLACE_FLAG_COUNT = 3;
// Judging hits by knockback direction alone (no visible flick) needs the
// knockback packet; from the victim's movement it was mostly their strafing.
const DISPLACE_USE_MOVEMENT_KB = false;

// Minecraft yaw of a horizontal direction (0 = +Z, 90 = -X).
function yawOfVector(x, z) {
    return Math.atan2(-x, z) * 180 / Math.PI;
}

function angleBetween(a, b) {
    return Math.abs(wrapDegrees(a - b));
}

// Horizontal knockback direction of a hit: the velocity packet if Hypixel
// sent one around the hit, otherwise the victim's first movement after it.
function knockbackDirection(hit) {
    const kb = hit.victim.knockbacks.find(k => Math.abs(k.t - hit.t) <= 150);
    if (kb && Math.hypot(kb.velocity.x, kb.velocity.z) > 0.05) {
        return { x: kb.velocity.x, z: kb.velocity.z, fromMovement: false };
    }
    const after = hit.victim.positionHistory.filter(p => p.t > hit.t && p.t <= hit.t + 150);
    if (after.length === 0) return null;
    const last = after[after.length - 1];
    const dx = last.x - hit.victimPos.x;
    const dz = last.z - hit.victimPos.z;
    if (Math.hypot(dx, dz) < 0.2) return null;
    return { x: dx, z: dz, fromMovement: true };
}

// One rotation update within 100ms of the hit that jumps far out and is
// followed within ~3 ticks by an update back where it started. The update
// before it can be old: a player holding their aim still sends none.
function findFlickSpike(samples, t) {
    for (let i = 1; i < samples.length - 1; i++) {
        const sample = samples[i];
        if (Math.abs(sample.t - t) > 100) continue;
        const prev = samples[i - 1];
        const next = samples[i + 1];
        if (next.t - sample.t > DISPLACE_SPIKE_SPAN_MS) continue;
        const out = angleBetween(sample.yaw, prev.yaw);
        if (out >= DISPLACE_SPIKE_MIN && angleBetween(next.yaw, prev.yaw) <= DISPLACE_SPIKE_RETURN) {
            return Math.round(out);
        }
    }
    return null;
}

function evaluateDisplacedHit(attacker, hit) {
    const towardVictim = yawOfVector(hit.victimPos.x - hit.attackerPos.x, hit.victimPos.z - hit.attackerPos.z);
    const samples = attacker.rotationHistory;

    const spike = findFlickSpike(samples, hit.t);
    if (spike !== null) {
        return { displaced: true, reason: `${spike}deg one-update flick`, detail: 'rotation' };
    }

    const kb = knockbackDirection(hit);
    if (!kb || (kb.fromMovement && !DISPLACE_USE_MOVEMENT_KB)) return null;
    const kbOff = angleBetween(yawOfVector(kb.x, kb.z), towardVictim);
    const detail = `knockback ${Math.round(kbOff)}deg off the line${kb.fromMovement ? ', from movement' : ''}`;
    const limit = kb.fromMovement ? DISPLACE_KB_ANGLE_FROM_MOVEMENT : DISPLACE_KB_ANGLE;
    if (kbOff <= limit) return { displaced: false, detail };

    // Sideways knockback: legit if we saw the attacker look away for it.
    const lastBefore = [...samples].reverse().find(sample => sample.t <= hit.t - 200);
    const around = samples.filter(sample => sample.t > hit.t - 200 && sample.t <= hit.t + 150);
    const seen = (lastBefore ? [lastBefore] : []).concat(around);
    if (seen.length === 0) return null;
    const neverLookedAway = seen.every(sample => angleBetween(sample.yaw, towardVictim) <= DISPLACE_LOOK_TOLERANCE);
    if (!neverLookedAway) return { displaced: false, detail: detail + ', visible flick' };
    return { displaced: true, reason: 'sideways knockback with no visible flick', detail };
}

// ---- Ported from MWE's hacker detector (see the notice in the file header) ----

// MWE's ViolationLevelTracker: a failed check adds `fail`, a passed one
// subtracts `pass` (never below 0); reaching `flagAt` flags and resets.
// Checks may also adjust the level by hand with add() (negative to lower it).
class MweTracker {
    constructor(fail, pass, flagAt) {
        this.fail = fail;
        this.pass = pass;
        this.flagAt = flagAt;
        this.level = 0;
    }

    add(amount) {
        this.level += amount;
    }

    // Returns true when this result makes the player flag.
    record(failed) {
        if (!failed) {
            this.level = Math.max(0, this.level - this.pass);
            return false;
        }
        this.level += this.fail;
        if (this.level >= this.flagAt) {
            this.level = 0;
            return true;
        }
        return false;
    }
}

const MOVING_SPEED_SQ = 0.04; // under 0.2 blocks/s counts as standing still
const DEG = Math.PI / 180;

// Horizontal speed (blocks/s)^2 from the smoothed velocity, or 0 when no
// movement update arrived recently (standing still sends none).
function currentSpeedSq(player) {
    const last = player.positionHistory[player.positionHistory.length - 1];
    if (!last || Date.now() - last.t > 200) return 0;
    return player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z;
}

// Angle between where the player moves and where their head looks.
function moveLookAngleDiff(player) {
    return wrapDegrees(yawOfVector(player.velocity.x, player.velocity.z) - (player.headYaw ?? player.yaw));
}

function isInsideHitbox(px, py, pz, x, y, z) {
    return x > px - 0.3 && x < px + 0.3 && y > py - 0.1 && y < py + 1.9 && z > pz - 0.3 && z < pz + 0.3;
}

// Minecraft's Entity#getVectorForRotation.
function lookVector(pitch, yaw) {
    const f = Math.cos(-yaw * DEG - Math.PI);
    const f1 = Math.sin(-yaw * DEG - Math.PI);
    const f2 = -Math.cos(-pitch * DEG);
    const f3 = Math.sin(-pitch * DEG);
    return { x: f1 * f2, y: f3, z: f * f2 };
}

// Vec3#getIntermediateWithX/Y/ZValue: where segment a->b crosses the plane
// axis = value, or null if it doesn't within the segment.
function intermediate(a, b, axis, value) {
    const d = b[axis] - a[axis];
    if (d * d < 1.0000000116860974e-7) return null;
    const t = (value - a[axis]) / d;
    if (t < 0 || t > 1) return null;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Where the ray a->b first enters the hitbox of a player at (px, py, pz).
function hitVectOnPlayer(px, py, pz, a, b) {
    const box = { x: [px - 0.3, px + 0.3], y: [py - 0.1, py + 1.9], z: [pz - 0.3, pz + 0.3] };
    let best = null;
    let bestDist = Infinity;
    for (const axis of ['x', 'y', 'z']) {
        for (const value of box[axis]) {
            const p = intermediate(a, b, axis, value);
            if (!p) continue;
            const inside = ['x', 'y', 'z'].every(other => other === axis || (p[other] >= box[other][0] && p[other] <= box[other][1]));
            if (!inside) continue;
            const dist = (p.x - a.x) ** 2 + (p.y - a.y) ** 2 + (p.z - a.z) ** 2;
            if (dist < bestDist) {
                best = p;
                bestDist = dist;
            }
        }
    }
    return best;
}

// MWE KillAura A, without its "through blocks" half (Kenway keeps no copy of
// the world's blocks): could the attacker only have reached the target
// through other players? Tries every target position from the last 9 ticks
// (latency) and returns the fewest 0.1-block steps the hit ray had to spend
// inside other players - 0 if any position was hittable cleanly - plus how
// many players were around, or null when it can't be judged.
function stepsThroughPlayers(system, attacker, target) {
    const MAX_TICK_DELAY = 10;
    const STEP = 0.1;
    const MAX_REACH = 3.15;
    if (target.tickPositions.length < MAX_TICK_DELAY || attacker.rotationHistory.length === 0) return null;

    const eye = { x: attacker.position.x, y: attacker.position.y + (attacker.isCrouching ? 1.54 : 1.62), z: attacker.position.z };
    const look = lookVector(attacker.pitch, attacker.headYaw ?? attacker.yaw);
    const end = { x: eye.x + look.x * MAX_REACH, y: eye.y + look.y * MAX_REACH, z: eye.z + look.z * MAX_REACH };

    const hitDistances = [];
    for (let i = 1; i < MAX_TICK_DELAY; i++) {
        const p = target.tickPositions[i];
        if (isInsideHitbox(p.x, p.y, p.z, eye.x, eye.y, eye.z)) return { steps: 0, nearby: 0 };
        const hit = hitVectOnPlayer(p.x, p.y, p.z, eye, end);
        hitDistances[i] = hit ? Math.hypot(hit.x - eye.x, hit.y - eye.y, hit.z - eye.z) : null;
    }
    if (hitDistances.every(d => d == null)) return null;

    const others = [...system.playersByUuid.values()].filter(other =>
        other !== attacker && other !== target && !other.isInvisible && other.tickPositions.length >= MAX_TICK_DELAY);
    if (others.length === 0 || others.length >= 15) return { steps: 0, nearby: others.length };

    let fewest = Infinity;
    for (let i = 1; i < MAX_TICK_DELAY; i++) {
        if (hitDistances[i] == null) continue;
        let inside = 0;
        const steps = Math.floor(hitDistances[i] / STEP);
        for (let j = 0; j <= steps; j++) {
            const x = eye.x + j * STEP * look.x;
            const y = eye.y + j * STEP * look.y;
            const z = eye.z + j * STEP * look.z;
            if (others.some(o => isInsideHitbox(o.tickPositions[i].x, o.tickPositions[i].y, o.tickPositions[i].z, x, y, z))) inside++;
        }
        fewest = Math.min(fewest, inside);
        if (fewest === 0) break;
    }
    return { steps: fewest, nearby: others.length };
}

// Shared by NoSlowA and KeepSprintA (MWE NoSlowdown / KeepSprint A): has
// the player kept sprinting longer than using this item allows?
function sprintsWhileUsingItem(player) {
    if (player.usedItemIsConsumable) {
        if (player.useItemTime > 32) return null;
        if (player.sprintTime > 32) return true;
        if (player.sprintTime === player.useItemTime && player.useItemTime < 12) return null;
        return player.sprintTime > player.useItemTime + 3 || (player.lastEatTime > 32 && player.sprintTime > 5);
    }
    return player.sprintTime > 5;
}

const CHECKS = {
    // MWE NoSlowdown (see the file header): moving at running speed while
    // eating, drinking, drawing a bow or blocking, judged per tick from how
    // long the item has been in use versus how long the player has sprinted.
    NoSlowA: {
        config: {
            enabled: true, sound: true, vl: 10, cooldown: 2000,
            description: "Detects running at full speed while eating, drinking, drawing a bow or blocking (MWE's NoSlowdown check)."
        },
        evidence: (player, system) => system.tickCount,

        check: function(player, config) {
            const tracker = player.mwe.noSlowdown;
            let failed = false;
            const speedSq = currentSpeedSq(player);
            if (speedSq >= MOVING_SPEED_SQ && player.rotationHistory.length > 0) {
                if (player.useItemTime > 5 && player.sprintTime > 0) {
                    if (Math.abs(moveLookAngleDiff(player)) > 135) {
                        tracker.add(-3); // rubber band
                    } else {
                        const invalidSprint = sprintsWhileUsingItem(player);
                        if (invalidSprint && (speedSq >= 6.25 || player.isHoldingSword())) {
                            tracker.add(2);
                            failed = true;
                        }
                    }
                } else if (player.useItemTime > 5 && player.sprintTime === 0) {
                    tracker.add(-3);
                }
            }
            if (tracker.record(failed)) this.mweFlag(player, 'NoSlowA', config, `sprint ${player.sprintTime}t, item ${player.useItemTime}t`);
        }
    },

    // MWE Autoblock (see the file header): swinging while the sword has been
    // blocking for more than 5 ticks.
    AutoBlockA: {
        config: {
            enabled: true, sound: true, vl: 10, cooldown: 2000,
            description: "Detects attacking while blocking with a sword (MWE's Autoblock check)."
        },
        evidence: (player, system) => system.tickCount,

        check: function(player, config) {
            const tracker = player.mwe.autoblock;
            let failed = false;
            if (player.swungThisTick && player.isHoldingSword()) {
                if (player.useItemTime > 5) {
                    tracker.add(5);
                    failed = true;
                } else if (player.useItemTime === 0) {
                    tracker.add(-2);
                }
            }
            if (tracker.record(failed)) this.mweFlag(player, 'AutoBlockA', config, `blocking ${player.useItemTime}t`);
        }
    },

    // Full port of Mellow's EagleCheck. Mellow runs this every client tick
    // (20/sec, guaranteed) against data it reads directly off the local
    // EntityPlayer; this proxy only runs it when a movement/swing/metadata
    // packet actually arrives for that player, and ticks aren't a concept
    // this proxy has for a third party. Every tick-count constant in
    // Mellow's source (quickCrouch 1-2 ticks, the 15-tick pattern-gap reset,
    // the variance/4.0 consistency formula) is carried over by converting
    // ms to tick-equivalents at 1 tick = 50ms, so the same numeric
    // thresholds stay meaningful against real elapsed time instead of being
    // re-tuned from scratch.
    EagleA: {
        config: {
            enabled: true, sound: true, vl: 10, cooldown: 2000,
            description: "Detects mechanical eagle-bridging: double-shifting - letting go of sneak for a single tick between two crouches while bridging diagonally, twice within 8 seconds - placing the next bridge block within one shift while bridging straight (moving faster than sneaking allows), and releasing sneak in the same tick after placing, 10 blocks in a row (flat, or 10 in a row bridging up)."
        },
        evidence: (player) => `${player.lastCrouchTime}|${player.lastStopCrouchTime}|${player.lastSwingTime}|${player.placeSeq}`,

        check: function(player, config) {
            const now = Date.now();

            // Crouch starts feed the double-shift pattern and block placements
            // the two-blocks-in-one-shift pattern; both alert straight away.
            // Releases and swings drive the quick-crouch pattern below, and
            // must not also be judged (or decayed) on the other events.
            const seen = player.eagleSeen || {};
            const newCrouchStart = player.lastCrouchTime !== seen.crouchStart;
            const newPlacement = player.placeSeq !== seen.placeSeq;
            const newRelease = player.lastStopCrouchTime !== seen.crouchStop;
            const newReleaseOrSwing = newRelease || player.lastSwingTime !== seen.swing;
            player.eagleSeen = { crouchStart: player.lastCrouchTime, crouchStop: player.lastStopCrouchTime, swing: player.lastSwingTime, placeSeq: player.placeSeq };

            const doubleShift = newCrouchStart && detectDoubleShift(this, player);
            const twoBlocks = newPlacement && detectTwoBlocksInOneShift(player);
            if (twoBlocks) this.api.debugLog(`[EagleA] ${player.username} placed two blocks in one shift while bridging straight`);
            const fixedRelease = newRelease && detectFixedReleaseDelay(player);
            if (fixedRelease) this.api.debugLog(`[EagleA] ${player.username} released sneak the same delay after placing, ${RELEASE_STREAK_BLOCKS} ${player.releaseKind} blocks in a row`);
            if (doubleShift || twoBlocks || fixedRelease) {
                player.violations.EagleA = Math.max(player.violations.EagleA, config.vl);
                if (this.shouldAlert(player, 'EagleA', config)) {
                    const pattern = doubleShift ? 'double shift (diagonal)' : (twoBlocks ? 'two blocks in one shift' : `same release timing, ${RELEASE_STREAK_BLOCKS} blocks`);
                    this.flag(player, 'EagleA', player.violations.EagleA.toFixed(1), pattern);
                    this.markAlert(player, 'EagleA');
                }
            }
            if (!newReleaseOrSwing) return;

            // Stale yaw makes the move-vs-look angle math meaningless - see
            // the file header on rotation-packet visibility.
            if (now - player.lastRotationUpdateTime > 300) {
                this.reduceViolation(player, 'EagleA');
                return;
            }

            const deltaX = player.position.x - player.lastPosition.x;
            const deltaZ = player.position.z - player.lastPosition.z;
            const moveYaw = getRelativeMoveAngle(deltaX, deltaZ, player.yaw);

            const lastCrouchDurationMs = player.crouchDurations.length > 0 ? player.crouchDurations[0] : null;
            const crouchJustEnded = player.lastStopCrouchTime > 0 && now - player.lastStopCrouchTime <= 50;
            const quickCrouch = crouchJustEnded && lastCrouchDurationMs !== null && lastCrouchDurationMs >= 50 && lastCrouchDurationMs <= 100;
            const swingOnCrouch = player.lastStopCrouchTime > 0 && Math.abs(player.lastSwingTime - player.lastStopCrouchTime) <= 50;

            // One tap is one crouch release. Once counted, a second swing in
            // the same 50ms window must not count it again - that used to let
            // a single tap satisfy the "two patterns" requirement below.
            if (crouchJustEnded && player.eagleCountedRelease === player.lastStopCrouchTime) return;

            const holdingBlock = player.isHoldingBlock();
            const lookingDown = player.pitch >= 70;
            const extremelyLookingDown = player.pitch >= 85;
            const movingBackwards = Math.abs(moveYaw) >= 90;
            const movingDirectlyBackwards = Math.abs(moveYaw) >= 160;

            let flagged = false;

            if (lookingDown && holdingBlock && isBridgingFlat(player, 1000)) {
                if (quickCrouch && swingOnCrouch) {
                    player.eagleCountedRelease = player.lastStopCrouchTime;
                    // Last 3 crouch durations, converted to tick-equivalents
                    // so Mellow's variance/4.0 consistency formula applies
                    // unchanged.
                    const recentTicks = player.crouchDurations.slice(0, 3).map(ms => ms / 50);
                    const hasConsistentPattern = recentTicks.length >= 3 && recentTicks.every(d => d <= 2);

                    let consistencyScore = 0;
                    if (recentTicks.length >= 3) {
                        const mean = recentTicks.reduce((a, b) => a + b, 0) / recentTicks.length;
                        const variance = recentTicks.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentTicks.length;
                        consistencyScore = Math.max(0, Math.min(1, 1 - variance / 4));
                    }

                    if (now - player.lastEaglePatternTime > 750) {
                        player.eaglePatternCount = 0;
                    }
                    player.eaglePatternCount++;
                    player.lastEaglePatternTime = now;

                    if (player.eaglePatternCount >= 2) {
                        player.eagleConsecutiveViolations++;

                        const vlAmount = 2.0;
                        const pitchMultiplier = extremelyLookingDown ? 1.5 : 1.0;
                        const swingTimingMultiplier = Math.abs(player.lastSwingTime - player.lastStopCrouchTime) <= 10 ? 1.4 : 1.0;
                        const movementMultiplier = movingDirectlyBackwards ? 1.8 : (movingBackwards ? 1.5 : 1.0);
                        const consistencyMultiplier = 1.0 + consistencyScore * 0.5;
                        const consecutiveMultiplier = 1.0 + Math.min(player.eagleConsecutiveViolations, 5) * 0.15;
                        const finalVL = vlAmount * pitchMultiplier * swingTimingMultiplier * movementMultiplier * consistencyMultiplier * consecutiveMultiplier;

                        const checkType = movingBackwards ? 'backwards-bridging' : (hasConsistentPattern ? 'consistent-pattern' : 'mechanical-pattern');

                        if (EAGLE_MELLOW_ALERTS) this.addViolation(player, 'EagleA', finalVL);
                        this.api.debugLog(`[EagleA] ${player.displayName} type: ${checkType}, angle: ${moveYaw.toFixed(1)}, crouch: ${lastCrouchDurationMs}ms, consistency: ${consistencyScore.toFixed(2)}, vl+=${finalVL.toFixed(2)}`);

                        if (EAGLE_MELLOW_ALERTS && this.shouldAlert(player, 'EagleA', config)) {
                            this.flag(player, 'EagleA', player.violations.EagleA.toFixed(1), checkType);
                            this.markAlert(player, 'EagleA');
                        }
                        flagged = true;
                        player.eaglePatternCount = 0;
                    }
                } else if (
                    Math.abs(now - player.lastSwingTime) <= 50 &&
                    crouchJustEnded &&
                    lastCrouchDurationMs !== null && lastCrouchDurationMs <= 50
                ) {
                    player.eagleCountedRelease = player.lastStopCrouchTime;
                    // "instant-sequence" - swing and crouch-release land
                    // within the same ~tick, after a crouch that barely
                    // registered at all.
                    const pitchMultiplier = extremelyLookingDown ? 1.6 : (player.pitch >= 80 ? 1.3 : 1.0);
                    const movementMultiplier = movingDirectlyBackwards ? 1.5 : (movingBackwards ? 1.2 : 1.0);
                    player.eagleConsecutiveViolations++;
                    const consecutiveMultiplier = 1.0 + Math.min(player.eagleConsecutiveViolations, 5) * 0.15;
                    const finalVL = 3.5 * pitchMultiplier * movementMultiplier * consecutiveMultiplier;

                    if (EAGLE_MELLOW_ALERTS) this.addViolation(player, 'EagleA', finalVL);
                    this.api.debugLog(`[EagleA] ${player.displayName} type: instant-sequence, angle: ${moveYaw.toFixed(1)}, pitch: ${player.pitch.toFixed(1)}, vl+=${finalVL.toFixed(2)}`);

                    if (EAGLE_MELLOW_ALERTS && this.shouldAlert(player, 'EagleA', config)) {
                        this.flag(player, 'EagleA', player.violations.EagleA.toFixed(1), 'instant-sequence');
                        this.markAlert(player, 'EagleA');
                    }
                    flagged = true;
                    player.eaglePatternCount = 0;
                }
            }

            if (!flagged) {
                if (now - player.lastEaglePatternTime > 750) {
                    player.eaglePatternCount = 0;
                }
                if (player.eagleConsecutiveViolations > 0) {
                    player.eagleConsecutiveViolations--;
                }
                this.reduceViolation(player, 'EagleA');
            }
        }
    },

    // Three patterns: hitting two players faster than anyone can re-aim
    // (ours), and from MWE (see the file header) hitting while eating or
    // drinking, and hitting a player who could only be reached through
    // other players.
    KillAuraA: {
        config: {
            enabled: true, sound: true, vl: 12, cooldown: 2000,
            description: "Detects hitting two players faster than a human can re-aim, hitting while eating or drinking, and hitting through other players (the last two from MWE's KillAura checks)."
        },
        evidence: (player, system) => `${system.tickCount}|${player.attackSeq}`,

        check: function(player, config) {
            // Ticks drive MWE's per-tick patterns; new hits drive the
            // multi-target pattern below. Neither may run on the other's
            // evidence.
            const seen = player.killAuraSeen || {};
            const newTick = this.tickCount !== seen.tick;
            const newHit = player.attackSeq !== seen.attackSeq;
            player.killAuraSeen = { tick: this.tickCount, attackSeq: player.attackSeq };

            if (newTick) {
                const attacked = player.hasAttackedThisTick();
                const eating = attacked && player.useItemTime > 6 && player.timeEating < 33 &&
                    player.usedItemIsConsumable && player.lastEatTime > 32;
                if (player.mwe.killAuraEating.record(eating)) {
                    this.mweFlag(player, 'KillAuraA', config, `hit while eating (item ${player.useItemTime}t)`);
                }

                let through = false;
                if (attacked && player.attackTargetThisTick) {
                    const result = stepsThroughPlayers(this, player, player.attackTargetThisTick);
                    if (result && result.steps > 0) {
                        const vlp = Math.min(8, result.steps);
                        player.mwe.killAuraThroughPlayers.add(Math.min(15, result.nearby > 8 ? Math.floor(vlp / 2) : vlp) * 25);
                        through = true;
                        this.api.debugLog(`[KillAuraA] ${player.username} hit ${player.attackTargetThisTick.username} through ${result.steps / 10} blocks of players`);
                    }
                }
                if (player.mwe.killAuraThroughPlayers.record(through)) {
                    this.mweFlag(player, 'KillAuraA', config, 'hit through other players');
                }
            }
            if (!newHit) return;

            if (!player.recentAttacks || player.recentAttacks.length < 2) {
                this.reduceViolation(player, 'KillAuraA');
                return;
            }

            const now = Date.now();
            const recent = player.recentAttacks.filter(a => now - a.time < 400);
            const distinctTargets = new Set(recent.map(a => a.targetUuid));

            if (distinctTargets.size >= 2) {
                this.addViolation(player, 'KillAuraA', 4);

                if (this.shouldAlert(player, 'KillAuraA', config)) {
                    this.flag(player, 'KillAuraA', player.violations.KillAuraA);
                    this.markAlert(player, 'KillAuraA');
                }
            } else {
                this.reduceViolation(player, 'KillAuraA');
            }
        }
    },
};

const getCheckDefinitions = () => {
    const definitions = {};
    for (const [checkName, checkData] of Object.entries(CHECKS)) {
        definitions[checkName] = checkData.config;
    }
    return definitions;
};

class PlayerData {
    constructor(username, uuid, entityId) {
        this.username = username;
        this.uuid = uuid;
        this.entityId = entityId;
        this.displayName = username;

        this.position = { x: 0, y: 0, z: 0 };
        this.lastPosition = { x: 0, y: 0, z: 0 };
        this.onGround = true;
        this.lastOnGround = true;

        this.yaw = 0;
        this.pitch = 0;
        this.lastRotationUpdateTime = 0;

        this.isCrouching = false;
        this.lastCrouching = false;
        this.isSprinting = false;
        this.isUsingItem = false;
        this.swingProgress = 0;

        this.lastSwingTime = 0;
        this.lastCrouchTime = 0;
        this.lastStopCrouchTime = 0;

        this.velocity = { x: 0, y: 0, z: 0 };

        this.violations = {};
        this.lastAlerts = {};

        for (const checkName of Object.keys(CHECKS)) {
            this.violations[checkName] = 0;
            this.lastAlerts[checkName] = 0;
        }

        this.lastSwingItem = null;
        this.hasJumpBoost = false;
        this.speedAmplifier = -1; // -1 = no Speed potion active

        this.shiftEvents = [];
        this.currentShiftStart = null;

        this.heldItem = null;

        this.lastSprinting = false;
        this.lastUsing = false;
        this.lastDamaged = 0;

        this.isBlocking = false;
        this.blockingStartTime = 0;

        // VelocityA
        this.pendingKnockback = null;

        // AutoClutchA
        this.fallStartY = null;
        this.fallDistance = 0;
        this.pendingClutchCheck = null;

        // LegitScaffoldA
        this.scaffoldPlacements = [];

        // Blocks placed right under this player (EagleA), and a counter that
        // is its evidence key.
        this.underPlacements = [];
        this.placeSeq = 0;

        // KBDisplaceA: every rotation update seen, knockback received, and
        // this player's hits waiting to be judged / already judged.
        this.rotationHistory = [];
        this.knockbacks = [];
        this.displacePending = [];
        this.displaceResults = [];

        // Per-tick samples (MWE's PlayerDataSamples), updated by sampleTick()
        // at the start of every tick and cleared by endTick() after checks.
        this.headYaw = null;
        this.tickPositions = [];     // newest first, one per tick
        this.sprintTime = 0;         // ticks spent sprinting
        this.useItemTime = 0;        // ticks spent using an item
        this.usedItemIsConsumable = false;
        this.timeEating = 0;
        this.lastEatTime = 50;       // ticks since finishing eating or drinking
        this.swungThisTick = false;
        this.attackedThisTick = null; // target uuid, or 'multi'
        this.attackTargetThisTick = null;
        this.mwe = {
            autoblock: new MweTracker(0, 0, 30),
            noSlowdown: new MweTracker(0, 0, 48),
            keepSprintItems: new MweTracker(0, 0, 48),
            killAuraEating: new MweTracker(100, 1, 110),
            killAuraThroughPlayers: new MweTracker(0, 1, 500),
        };

        // Evidence keys (see runChecks). moveSeq increments once per real
        // movement sample, attackSeq once per hit attributed to this player.
        this.moveSeq = 0;
        this.attackSeq = 0;
        this.lastEvidence = {};
        this.lastTeleportTime = 0;
        this.lastVelocityTime = 0;
        this.isInvisible = false;
        this.hasPotionParticles = false;

        // Combat attack-attribution pipeline (Reach/KillAura/AutoClicker/BlindHit)
        this.combatSwings = [];   // this player's own recent swings, as a possible attacker
        this.recentAttacks = [];  // attacks attributed TO this player as the attacker
        this.lastReachSample = null;
        this.lastFacingDiff = null;

        // EagleA / ScaffoldA (ported from Mellow) ---------------------------
        // Rolling position samples with timestamps, for ScaffoldA's
        // acceleration estimate - mirrors Mellow's ACPlayerData.positionHistory.
        this.positionHistory = [];
        // Completed crouch durations in ms, most recent first, capped at 10 -
        // mirrors Mellow's crouchDurations (there in ticks; here in ms).
        this.crouchDurations = [];
        this.eaglePatternCount = 0;
        this.lastEaglePatternTime = 0;
        this.eagleConsecutiveViolations = 0;
        this.scaffoldConsecutiveViolations = 0;
        this.lastScaffoldViolationType = null;
        this.lastScaffoldViolationTime = 0;
    }

    updatePosition(x, y, z, onGround, yaw = null, pitch = null) {
        this.lastPosition = { ...this.position };
        this.position = { x, y, z };
        this.onGround = onGround;

        if (yaw !== null) { this.yaw = yaw; this.lastRotationUpdateTime = Date.now(); }
        if (pitch !== null) this.pitch = pitch;
        if (yaw !== null && pitch !== null) this.recordRotation(yaw, pitch);

        const currentTime = Date.now();
        this.moveSeq++;

        // ScaffoldA (ported from Mellow) needs the last several raw samples,
        // not just the latest velocity, to estimate acceleration; SpeedA
        // measure displacement over ~1s of it. Capped at 40 (Mellow uses 20)
        // so a 1s window still fits at Hypixel's broadcast rate.
        this.positionHistory.push({ x, y, z, t: currentTime });
        if (this.positionHistory.length > 40) {
            this.positionHistory.shift();
        }

        // Velocity over the newest sample that's at least VELOCITY_SPAN_MS
        // old. Using only the previous packet made this explode whenever two
        // packets arrived in the same TCP read (1ms apart = 100s of b/s).
        // Too-short spans keep the previous estimate instead.
        const VELOCITY_SPAN_MS = 150;
        let reference = null;
        for (let i = this.positionHistory.length - 2; i >= 0; i--) {
            if (currentTime - this.positionHistory[i].t >= VELOCITY_SPAN_MS) {
                reference = this.positionHistory[i];
                break;
            }
        }
        if (reference) {
            const timeDelta = (currentTime - reference.t) / 1000;
            this.velocity = {
                x: (x - reference.x) / timeDelta,
                y: (y - reference.y) / timeDelta,
                z: (z - reference.z) / timeDelta
            };
        }


        this.lastOnGround = onGround;

        // Track how deep the current fall is, for AutoClutchA. Reset the moment
        // they touch ground; otherwise keep the deepest point reached this fall.
        if (onGround) {
            this.fallStartY = null;
            this.fallDistance = 0;
        } else {
            if (this.fallStartY === null) {
                this.fallStartY = y;
            }
            this.fallDistance = Math.max(this.fallDistance, this.fallStartY - y);
        }
    }

    // Pearls, respawns and server corrections: drop movement history so the
    // jump isn't read as speed, and let the next sample start fresh.
    markTeleport() {
        this.positionHistory = [];
        this.velocity = { x: 0, y: 0, z: 0 };
        this.lastTeleportTime = Date.now();
    }

    // MWE PlayerDataSamples#onTick.
    sampleTick() {
        this.tickPositions.unshift({ ...this.position });
        if (this.tickPositions.length > 10) this.tickPositions.pop();

        this.sprintTime = this.isSprinting ? this.sprintTime + 1 : 0;
        const useDuration = this.getItemUseDuration();
        const usingItem = this.isUsingItem && useDuration > 0;
        if (!usingItem && this.usedItemIsConsumable && this.useItemTime > 25) this.lastEatTime = 0;
        this.lastEatTime++;
        if (usingItem) {
            this.usedItemIsConsumable = useDuration === 32;
            this.useItemTime++;
            this.timeEating = this.usedItemIsConsumable ? this.timeEating + 1 : 0;
        } else {
            this.useItemTime = 0;
            this.timeEating = 0;
        }
    }

    endTick() {
        this.swungThisTick = false;
        this.attackedThisTick = null;
        this.attackTargetThisTick = null;
    }

    hasAttackedThisTick() {
        return this.attackedThisTick !== null && this.attackedThisTick !== 'multi';
    }

    // Item#getMaxItemUseDuration for what this player holds.
    getItemUseDuration() {
        if (this.isHoldingConsumable()) return 32;
        if (this.isHoldingSword() || this.isHoldingBow()) return 72000;
        return 0;
    }

    recordRotation(yaw, pitch) {
        const last = this.rotationHistory[this.rotationHistory.length - 1];
        if (last && last.yaw === yaw && last.pitch === pitch) return;
        this.rotationHistory.push({ t: Date.now(), yaw, pitch });
        if (this.rotationHistory.length > 40) this.rotationHistory.shift();
    }

    getItemId() {
        if (!this.heldItem) return null;
        return this.heldItem.blockId || this.heldItem.itemId || this.heldItem.id || null;
    }

    isHoldingBlock() {
        const itemId = this.getItemId();
        return itemId && itemId < 256;
    }

    isHoldingSword() {
        const itemId = this.getItemId();
        if (!itemId) return false;
        const swordIds = [267, 268, 272, 276, 283]; // wood, stone, iron, diamond, gold swords
        return swordIds.includes(itemId);
    }

    // Arm swings are also how block placements, fireball throws and other
    // item uses show up, so only someone empty-handed or holding something
    // people actually fight with can be credited with a hit.
    isHoldingMeleeItem() {
        const itemId = this.getItemId();
        if (itemId == null || itemId <= 0) return true; // empty hand, or not known yet
        return MELEE_ITEM_IDS.has(itemId);
    }

    isHoldingBow() {
        const itemId = this.getItemId();
        return itemId === 261;
    }

    isHoldingConsumable() {
        const itemId = this.getItemId();
        if (!itemId) return false;
        const consumableIds = [
            260, // apple
            297, // bread
            319, // porkchop
            320, // cooked_porkchop
            322, // golden_apple
            335, // milk_bucket
            349, // fish
            350, // cooked_fish
            354, // cake (item)
            357, // cookie
            360, // melon_slice
            363, // beef
            364, // cooked_beef
            365, // chicken
            366, // cooked_chicken
            367, // rotten_flesh
            373, // potion
            391, // carrot
            392, // potato
            393, // baked_potato
            394, // poisonous_potato
            396, // golden_carrot
            400, // pumpkin_pie
            411, // rabbit
            412, // cooked_rabbit
            413, // rabbit_stew
            423, // mutton
            424  // cooked_mutton
        ];
        return consumableIds.includes(itemId);
    }
}

class AnticheatSystem {
    constructor(api) {
        this.api = api;
        this.players = new Map();
        this.playersByUuid = new Map();
        this.entityToPlayer = new Map();
        this.uuidToName = new Map();
        this.uuidToDisplayName = new Map();
        this.userPosition = null;

        // Game-location gating (see handleLocationChat). inGame stays false
        // until a /locraw response says we're on a game server.
        this.inGame = false;
        this.locrawSeenAt = 0;
        this.awaitingOwnLocraw = false;
        this.locrawFallbackTimer = null;
        this.ownLocrawTimeout = null;
        this.ticksSinceConfigRefresh = 0;
        this.tickCount = 0;

        // Hits reported exactly by Kenway's core attack detector. Once any
        // arrive, the swing/hurt timing inference is no longer used.
        this.hasPreciseAttacks = false;

        // Watching a Hypixel replay (sidebar titled REPLAY or ATLAS): recorded
        // players have fake version-2 UUIDs there, so those are the ones to
        // check (as MWE does).
        this.scoreboardTitles = new Map();
        this.sidebarObjective = null;
        this.replayMode = false;

        this.CONFIG = {};
        this.refreshConfigConstants();
    }

    reset() {
        this.players.clear();
        this.playersByUuid.clear();
        this.entityToPlayer.clear();
        this.uuidToName.clear();
        this.uuidToDisplayName.clear();
        this.api.debugLog('Cleared all tracked player data.');
    }

    refreshConfigConstants() {
        this.CONFIG = {};
        this.onlyInGames = this.api.config.get('onlyInGames') !== false;
        for (const checkName of Object.keys(CHECKS)) {
            this.CONFIG[checkName] = {
                enabled: this.api.config.get(`checks.${checkName}.enabled`),
                vl: this.api.config.get(`checks.${checkName}.vl`),
                cooldown: this.api.config.get(`checks.${checkName}.cooldown`),
                sound: this.api.config.get(`checks.${checkName}.sound`)
            };
        }
    }

    registerHandlers() {
        this.unsubscribeTick = this.api.everyTick(() => {
            this.tickCount++;
            // CONFIG is a cache; the loader never calls the returned
            // enable(), so re-read it every 2s for config UI changes to apply.
            if (++this.ticksSinceConfigRefresh >= 40) {
                this.ticksSinceConfigRefresh = 0;
                this.refreshConfigConstants();
            }
            for (const [uuid, player] of this.playersByUuid) {
                if (player.swingProgress > 0) {
                    player.swingProgress = Math.max(0, player.swingProgress - 1);
                }
                // Drives the time-based checks (VelocityA's eval window,
                // AutoClutchA's land-after-place window, MWE's per-tick checks)
                // even when no new packet arrives for a tick.
                player.sampleTick();
                this.runChecks(player);
                player.endTick();
            }
        });

        this.unsubscribePluginRestored = this.api.on('plugin_restored', (event) => {
            if (event.pluginName === 'anticheat') {
                this.reset();
            }
        });


        this.unsubscribeEntityMove = this.api.on('entity_move', (event) => {
            if (event.isPlayer && event.entity) {
                this.handleEntityMove(event);
            }
        });

        this.unsubscribeEntityAnimation = this.api.on('entity_animation', (event) => {
            if (event.isPlayer && event.entity) {
                this.handleEntityAnimation(event);
            }
        });

        this.unsubscribePlayerJoin = this.api.on('player_join', (event) => {
            this.handlePlayerJoin(event);
            this.resetLocation();
        });

        this.unsubscribeEntityRotation = this.api.on('entity_rotation', (event) => {
            this.handleEntityRotation(event);
        });

        this.unsubscribeHeadRotation = this.api.on('entity_head_rotation', (event) => {
            const player = event.entity && this.entityToPlayer.get(event.entity.entityId);
            if (player && typeof event.headYaw === 'number') player.headYaw = event.headYaw;
        });

        this.unsubscribePlayerAttack = this.api.on('player_attack', (event) => {
            this.handlePlayerAttack(event);
        });

        this.unsubscribeScoreboardObjective = this.api.on('scoreboard_objective', (event) => {
            if (event.action === 1) this.scoreboardTitles.delete(event.name);
            else this.scoreboardTitles.set(event.name, event.displayText || '');
            this.updateReplayMode();
        });

        this.unsubscribeScoreboardDisplay = this.api.on('scoreboard_display_objective', (event) => {
            if (event.position !== 1) return; // 1 = sidebar
            this.sidebarObjective = event.name;
            this.updateReplayMode();
        });

        this.unsubscribeChat = this.api.on('chat', (event) => {
            this.handleLocationChat(event);
        });

        this.unsubscribeChatIntercept = this.api.intercept('packet:server:chat', (event) => {
            this.hideOwnLocrawResponse(event);
        });

        this.unsubscribePlayerLeave = this.api.on('player_leave', (event) => {
            this.handlePlayerLeave(event);
        });

        this.unsubscribeRespawn = this.api.on('respawn', () => {
            this.reset();
            this.resetLocation();
        });

        this.unsubscribePlayerInfo = this.api.on('player_info', (event) => {
            this.handlePlayerListUpdate(event);
        });

        this.unsubscribeEntitySpawn = this.api.on('named_entity_spawn', (event) => {
            this.handlePlayerSpawn(event);
        });

        this.unsubscribeEntityDestroy = this.api.on('entity_destroy', (event) => {
            this.handleEntityRemove(event);
        });

        this.unsubscribeEntityMetadata = this.api.on('entity_metadata', (event) => {
            this.handleEntityMetadataFromEvent(event);
        });

        this.unsubscribeEntityEquipment = this.api.on('entity_equipment', (event) => {
            this.handleEntityEquipmentFromEvent(event);
        });

        this.unsubscribeEntityStatus = this.api.on('entity_status', (event) => {
            this.handleEntityStatusFromEvent(event);
        });

        this.unsubscribePosition = this.api.on('player_move', (event) => {
            if (event.player && event.player.isCurrentPlayer) {
                this.userPosition = event.position;
            }
        });

        this.unsubscribeEntityVelocity = this.api.on('entity_velocity', (event) => {
            this.handleEntityVelocity(event);
        });

        this.unsubscribeEntityEffect = this.api.on('entity_effect', (event) => {
            this.handleEntityEffectFromEvent(event);
        });

        this.unsubscribeRemoveEntityEffect = this.api.on('entity_remove_effect', (event) => {
            this.handleRemoveEntityEffectFromEvent(event);
        });

        this.unsubscribeWorldBlockChange = this.api.on('world_block_change', (event) => {
            this.handleWorldBlockChange(event);
        });
    }

    // The proxy's game state applies every rotation packet, including the
    // look-only ones (entity_look) that never reach plugins as events, and the
    // server only re-sends rotation when it changes - so the entity copy on
    // any event carries the player's current rotation as far as we know it.
    syncRotation(player, entity) {
        if (!entity || typeof entity.yaw !== 'number' || typeof entity.pitch !== 'number') return;
        player.yaw = entity.yaw;
        player.pitch = entity.pitch;
        player.lastRotationUpdateTime = Date.now();
        player.recordRotation(entity.yaw, entity.pitch);
    }

    // Look-only rotation updates (a player turning in place). Needs a Kenway
    // build that forwards entity_look as 'entity_rotation'.
    handleEntityRotation(event) {
        if (!event.entity || !event.rotation) return;
        const player = this.entityToPlayer.get(event.entity.entityId);
        if (!player) return;
        player.yaw = event.rotation.yaw;
        player.pitch = event.rotation.pitch;
        player.lastRotationUpdateTime = Date.now();
        player.recordRotation(event.rotation.yaw, event.rotation.pitch);
    }

    handleEntityMove(event) {
        if (!event.entity || event.entity.type !== 'player' || !event.entity.uuid) return;

        const playerInfo = this.api.getPlayerInfo(event.entity.uuid);
        const playerName = playerInfo?.name || this.uuidToName.get(event.entity.uuid) || 'Unknown';
        const displayName = this.uuidToDisplayName.get(event.entity.uuid) || playerName;

        const playerData = {
            name: playerName,
            uuid: event.entity.uuid,
            entityId: event.entity.entityId,
            displayName: displayName
        };

        const player = this.getOrCreatePlayer(playerData);
        if (!player) {
            return;
        }

        if (event.newPosition) {
            const jx = event.newPosition.x - player.position.x;
            const jy = event.newPosition.y - player.position.y;
            const jz = event.newPosition.z - player.position.z;
            if (Math.sqrt(jx * jx + jy * jy + jz * jz) > TELEPORT_DISTANCE) {
                player.markTeleport();
            }
            player.updatePosition(
                event.newPosition.x,
                event.newPosition.y,
                event.newPosition.z,
                event.onGround !== undefined ? event.onGround : player.onGround,
                event.rotation?.yaw,
                event.rotation?.pitch
            );
        } else if (event.delta) {
            const newX = player.position.x + event.delta.x;
            const newY = player.position.y + event.delta.y;
            const newZ = player.position.z + event.delta.z;

            player.updatePosition(
                newX,
                newY,
                newZ,
                event.onGround !== undefined ? event.onGround : player.onGround,
                event.rotation?.yaw,
                event.rotation?.pitch
            );
        }

        this.syncRotation(player, event.entity);

        this.runChecks(player);
    }

    handleEntityAnimation(event) {
        if (!event.entity || event.entity.type !== 'player' || !event.entity.uuid) return;

        const playerInfo = this.api.getPlayerInfo(event.entity.uuid);
        const playerName = playerInfo?.name || this.uuidToName.get(event.entity.uuid) || 'Unknown';
        const displayName = this.uuidToDisplayName.get(event.entity.uuid) || playerName;

        const playerData = {
            name: playerName,
            uuid: event.entity.uuid,
            entityId: event.entity.entityId,
            displayName: displayName
        };

        const player = this.getOrCreatePlayer(playerData);
        if (!player) return;

        this.syncRotation(player, event.entity);

        if (event.animation === 0) {
            const now = Date.now();
            player.swingProgress = 6;
            player.swungThisTick = true;
            player.lastSwingTime = now;
            player.lastSwingItem = player.heldItem;

            // Feeds the combat attack-attribution pipeline (see
            // AnticheatSystem.attributeAttack): every swing is a candidate
            // "this is who hit someone" sample for whenever a hurt+knockback
            // fires on some nearby player shortly after.
            if (!player.combatSwings) player.combatSwings = [];
            player.combatSwings.push({ time: now, position: { ...player.position } });
            if (player.combatSwings.length > 10) player.combatSwings.shift();

            // LegitScaffoldA sample collection: only counts a placement toward the
            // "suspiciously consistent rhythm" pattern while it looks like active,
            // no-look bridging. Anything else (looking down, standing still, not
            // holding a block) breaks the streak rather than polluting it.
            const horizontalSpeed = Math.sqrt(
                player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z
            );
            const looksLikeNoLookBridging =
                player.isHoldingBlock() && player.pitch < 15 && player.onGround && horizontalSpeed > 2.5;

            if (looksLikeNoLookBridging) {
                if (player.scaffoldPlacements.length > 0 &&
                    now - player.scaffoldPlacements[player.scaffoldPlacements.length - 1] > 1200) {
                    player.scaffoldPlacements = [];
                }
                player.scaffoldPlacements.push(now);
                if (player.scaffoldPlacements.length > 10) {
                    player.scaffoldPlacements.shift();
                }
            } else {
                player.scaffoldPlacements = [];
            }
        }

        this.runChecks(player);
    }

    handlePlayerJoin(event) {
        this.api.debugLog(`Player joined: ${event.player.name}`);
    }

    handlePlayerLeave(event) {
        if (event.player && event.player.uuid) {
            this.removePlayerByUuid(event.player.uuid);
        }
    }

    getOrCreatePlayer(playerData) {
        if (!this.isTrackedUuid(playerData.uuid)) return null;

        let player = this.playersByUuid.get(playerData.uuid);

        if (!player) {
            player = new PlayerData(playerData.name, playerData.uuid, playerData.entityId || -1);
            player.displayName = playerData.displayName || playerData.name;
            this.players.set(playerData.name, player);
            this.playersByUuid.set(playerData.uuid, player);
            if (playerData.entityId) {
                this.entityToPlayer.set(playerData.entityId, player);
            }
        } else {
            if (playerData.entityId && player.entityId !== playerData.entityId) {
                if (player.entityId !== -1) {
                    this.entityToPlayer.delete(player.entityId);
                }
                player.entityId = playerData.entityId;
                this.entityToPlayer.set(playerData.entityId, player);
            }
        }

        return player;
    }

    removePlayerByUuid(uuid) {
        const player = this.playersByUuid.get(uuid);
        if (player) {
            this.players.delete(player.username);
            this.playersByUuid.delete(uuid);

            for (const [entityId, p] of this.entityToPlayer) {
                if (p.uuid === uuid) {
                    this.entityToPlayer.delete(entityId);
                    break;
                }
            }
        }
    }

    handlePlayerListUpdate(event) {
        if (event.players) {
            event.players.forEach(update => {
                if (update.name && update.uuid) {
                    this.uuidToName.set(update.uuid, update.name);
                    this.uuidToDisplayName.set(update.uuid, update.displayName || update.name);
                }
            });
        }
    }

    handlePlayerInfo(data) {
        if (data.action === 0) {
            data.data.forEach(player => {
                if (player.name && player.UUID) {
                    this.uuidToName.set(player.UUID, player.name);
                    let displayName = player.name;
                    if (player.displayName) {
                        try {
                            const parsed = JSON.parse(player.displayName);
                            displayName = this.extractTextFromJSON(parsed);
                        } catch (e) {
                            displayName = player.displayName;
                        }
                    }
                    this.uuidToDisplayName.set(player.UUID, displayName);
                }
            });
        }
    }

    handlePlayerSpawn(event) {
        const data = event.player;
        if (!data || !this.isTrackedUuid(data.playerUUID)) return;

        const playerName = this.uuidToName.get(data.playerUUID) || 'Unknown';
        const displayName = this.uuidToDisplayName.get(data.playerUUID) || playerName;
        const player = new PlayerData(playerName, data.playerUUID, data.entityId);

        player.displayName = displayName;

        player.updatePosition(
            data.position.x,
            data.position.y,
            data.position.z,
            false
        );

        player.yaw = data.yaw;
        player.pitch = data.pitch;
        player.lastRotationUpdateTime = Date.now();
        player.recordRotation(data.yaw, data.pitch);

        this.players.set(playerName, player);
        this.playersByUuid.set(data.playerUUID, player);
        this.entityToPlayer.set(data.entityId, player);
    }

    handleEntityRemove(event) {
        (event.entities || []).forEach(entity => {
            const player = this.entityToPlayer.get(entity.entityId);
            if (player) {
                this.players.delete(player.username);
                this.playersByUuid.delete(player.uuid);
                this.entityToPlayer.delete(entity.entityId);
            }
        });

        this.pruneDespawnedPlayers();
    }

    // Kenway applies a packet to its game state before building the plugin
    // event, so by the time an entity_destroy event's list is built the
    // destroyed entities are already gone and it arrives empty (fixed in
    // core, but older builds still do this). Without this, players who died
    // or left stayed tracked for the rest of the game. api.players only has
    // an entityId for entities that still exist, so drop everyone else.
    pruneDespawnedPlayers() {
        const liveEntityIds = new Set();
        for (const p of this.api.players) {
            if (p.entityId != null) liveEntityIds.add(p.entityId);
        }

        for (const [uuid, player] of this.playersByUuid) {
            if (liveEntityIds.has(player.entityId)) continue;
            this.playersByUuid.delete(uuid);
            if (this.players.get(player.username) === player) this.players.delete(player.username);
            if (this.entityToPlayer.get(player.entityId) === player) this.entityToPlayer.delete(player.entityId);
        }
    }

    handleEntityMetadataFromEvent(event) {
        if (!event.entity || event.entity.type !== 'player') return;

        let player = this.entityToPlayer.get(event.entity.entityId);

        if (!player && event.entity.uuid) {
            const playerInfo = this.api.getPlayerInfo(event.entity.uuid);
            const playerName = playerInfo?.name || this.uuidToName.get(event.entity.uuid) || 'Unknown';
            const displayName = this.uuidToDisplayName.get(event.entity.uuid) || playerName;

            const playerData = {
                name: playerName,
                uuid: event.entity.uuid,
                entityId: event.entity.entityId,
                displayName: displayName
            };
            player = this.getOrCreatePlayer(playerData);
        }

        if (!player) return;

        this.syncRotation(player, event.entity);

        if (event.metadata && Array.isArray(event.metadata)) {
            event.metadata.forEach(meta => {
                if (meta.key === 0 && meta.type === 0) {
                    const flags = meta.value;
                    const currentTime = Date.now();

                    const wasCrouching = player.isCrouching;
                    player.isCrouching = !!(flags & 0x02);

                    if (player.isCrouching && !wasCrouching) {
                        player.lastCrouchTime = currentTime;
                        player.currentShiftStart = currentTime;
                        player.shiftEvents.push({
                            type: 'start',
                            timestamp: currentTime,
                            position: { ...player.position }
                        });

                        if (player.shiftEvents.length > 50) {
                            player.shiftEvents.shift();
                        }
                    } else if (!player.isCrouching && wasCrouching) {
                        player.lastStopCrouchTime = currentTime;
                        const duration = player.currentShiftStart ? currentTime - player.currentShiftStart : 0;
                        player.shiftEvents.push({
                            type: 'stop',
                            timestamp: currentTime,
                            position: { ...player.position },
                            duration: duration
                        });
                        player.currentShiftStart = null;

                        if (player.shiftEvents.length > 50) {
                            player.shiftEvents.shift();
                        }

                        // EagleA (ported from Mellow) - most-recent-first,
                        // capped at 10, mirrors Mellow's crouchDurations.
                        player.crouchDurations.unshift(duration);
                        if (player.crouchDurations.length > 10) {
                            player.crouchDurations.pop();
                        }
                    }

                    player.isSprinting = !!(flags & 0x08);
                    player.isInvisible = !!(flags & 0x20);

                    const wasUsingItem = player.isUsingItem;
                    player.isUsingItem = !!(flags & 0x10);

                    if (player.isUsingItem && !wasUsingItem && player.isHoldingSword()) {
                        player.isBlocking = true;
                        player.blockingStartTime = currentTime;
                    } else if (!player.isUsingItem && wasUsingItem) {
                        player.isBlocking = false;
                    }

                    if (player.isUsingItem !== player.lastUsing) {
                        player.lastUsing = player.isUsingItem;
                    }
                } else if (meta.key === 7) {
                    // Potion particle color - nonzero while any effect is
                    // active. Broadcast reliably, unlike entity_effect for
                    // players already in view.
                    player.hasPotionParticles = meta.value !== 0;
                }
            });
        }

        this.runChecks(player);
    }

    handleEntityEquipmentFromEvent(event) {
        if (!event.entity || !event.isPlayer) return;

        const player = this.entityToPlayer.get(event.entity.entityId);
        if (!player) return;

        if (event.slot === 0) {
            player.heldItem = event.item;
        }
    }

    handleEntityStatusFromEvent(event) {
        if (!event.entity) return;

        const player = this.entityToPlayer.get(event.entity.entityId);
        if (!player) return;

        if (event.status === 2) {
            player.lastDamaged = Date.now();
            // Status 2 (hurt animation) fires for ANY damage source - fall,
            // fire, void, not just being hit - so attribution below has to
            // gate hard on also having a fresh knockback sample before it
            // even looks for a nearby attacker.
            if (!this.hasPreciseAttacks) {
                this.attributeAttack(player);
                this.recordDisplaceHit(player);
            }
        }
    }

    // KBDisplaceA: the game never says who hit whom, but a hit is
    // unambiguous when exactly one player swung a weapon in the same moment
    // the victim got hurt and was within striking distance. With two or more
    // such players the hit is skipped rather than guessed. Unlike
    // attributeAttack this does not need a knockback packet, since Hypixel may
    // not send those for other players.
    recordDisplaceHit(victim) {
        const now = Date.now();
        const candidates = [];
        for (const candidate of this.playersByUuid.values()) {
            if (candidate === victim || !candidate.combatSwings || !candidate.combatSwings.length) continue;
            if (!candidate.isHoldingMeleeItem()) continue;
            const sinceSwing = now - candidate.combatSwings[candidate.combatSwings.length - 1].time;
            if (sinceSwing < 0 || sinceSwing > DISPLACE_SWING_WINDOW_MS) continue;
            const dist = Math.hypot(candidate.position.x - victim.position.x, candidate.position.z - victim.position.z);
            if (dist <= DISPLACE_MAX_HIT_DIST) candidates.push(candidate);
        }
        if (candidates.length !== 1) return;
        const attacker = candidates[0];

        this.pushDisplaceHit(attacker, victim);
    }

    pushDisplaceHit(attacker, victim) {
        const now = Date.now();
        attacker.displacePending.push({
            t: now,
            victim,
            attackerPos: { ...attacker.position },
            victimPos: { ...victim.position }
        });
        if (attacker.displacePending.length > 10) attacker.displacePending.shift();
    }

    // Best-effort "who probably just hit this player" inference - see the
    // file header for why this can't be exact. Populates the attacker's
    // state (not the victim's); Reach/KillAura/AutoClicker/BlindHit all read
    // from there during the normal runChecks pass.
    attributeAttack(victim) {
        const now = Date.now();

        const kb = victim.pendingKnockback;
        if (!kb || now - kb.startTime > 200) return; // no recent knockback = probably not melee

        let best = null;
        let bestScore = -Infinity;

        for (const [uuid, candidate] of this.playersByUuid) {
            if (candidate === victim) continue;
            if (!candidate.combatSwings || !candidate.combatSwings.length) continue;
            if (!candidate.isHoldingMeleeItem()) continue;

            const lastSwing = candidate.combatSwings[candidate.combatSwings.length - 1];
            const sinceSwing = now - lastSwing.time;
            if (sinceSwing < 0 || sinceSwing > ATTACK_SWING_WINDOW_MS) continue;

            const dx = candidate.position.x - victim.position.x;
            const dy = (candidate.position.y + EYE_HEIGHT) - (victim.position.y + TARGET_CENTER_OFFSET);
            const dz = candidate.position.z - victim.position.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > ATTACK_MAX_CANDIDATE_DIST) continue;

            // Prefer close + recent. Both broadcast positions are already a
            // tick or two stale by the time we see them, so this is "most
            // plausible candidate", not a certain identification.
            const score = -dist - sinceSwing / 150;
            if (score > bestScore) {
                bestScore = score;
                best = { candidate, dist };
            }
        }

        if (!best) return;
        this.creditHit(best.candidate, victim, best.dist);
    }

    // Records a hit by `attacker` on `victim` for ReachA, KillAuraA,
    // AutoClickerA and BlindHitA.
    creditHit(attacker, victim, dist) {
        const now = Date.now();
        if (!attacker.recentAttacks) attacker.recentAttacks = [];
        attacker.recentAttacks.push({ time: now, targetUuid: victim.uuid, reachDistance: dist });
        if (attacker.recentAttacks.length > 20) attacker.recentAttacks.shift();
        attacker.attackSeq++;

        attacker.lastReachSample = dist;

        // Facing-angle sanity for BlindHitA. The attacker's rotation is
        // synced from the game state on their swing (syncRotation), so this
        // is normally fresh; skip it if no sync happened recently.
        if (now - attacker.lastRotationUpdateTime <= 300) {
            const dx = victim.position.x - attacker.position.x;
            const dz = victim.position.z - attacker.position.z;
            // Minecraft yaw convention: 0 deg faces +Z (south), 90 west, 180
            // north, 270 east, increasing clockwise viewed from above.
            // Sandbox-verified against that convention; still worth a live
            // sanity check against an obvious no-aim clip before trusting it.
            const angleToTarget = Math.atan2(-dx, dz) * 180 / Math.PI;
            const rawDiff = ((angleToTarget - attacker.yaw) % 360 + 540) % 360 - 180;
            attacker.lastFacingDiff = Math.abs(rawDiff);
        } else {
            attacker.lastFacingDiff = null;
        }
    }

    handleEntityVelocity(event) {
        if (!event.entity || event.entity.type !== 'player') return;

        const player = this.entityToPlayer.get(event.entity.entityId) ||
            (event.entity.uuid ? this.playersByUuid.get(event.entity.uuid) : null);
        if (!player) return;

        player.lastVelocityTime = Date.now();
        player.knockbacks.push({ t: Date.now(), velocity: { ...event.velocity } });
        if (player.knockbacks.length > 5) player.knockbacks.shift();

        const horizontalMag = Math.sqrt(
            event.velocity.x * event.velocity.x + event.velocity.z * event.velocity.z
        );
        if (horizontalMag < 0.35) return; // too small to judge reliably, ignore

        player.pendingKnockback = {
            velocity: { ...event.velocity },
            startPos: { ...player.position },
            startTime: Date.now()
        };
    }

    handleEntityEffectFromEvent(event) {
        if (!event.entity || !event.entity.uuid) return;
        const player = this.playersByUuid.get(event.entity.uuid);
        if (!player) return;

        if (event.effectId === 8) { // Jump Boost
            player.hasJumpBoost = true;
        } else if (event.effectId === 1) { // Speed
            player.speedAmplifier = event.amplifier ?? 0;
        }
    }

    handleRemoveEntityEffectFromEvent(event) {
        if (!event.entity || !event.entity.uuid) return;
        const player = this.playersByUuid.get(event.entity.uuid);
        if (!player) return;

        if (event.effectId === 8) { // Jump Boost
            player.hasJumpBoost = false;
        } else if (event.effectId === 1) { // Speed
            player.speedAmplifier = -1;
        }
    }

    handleWorldBlockChange(event) {
        if (!event.location || event.type === undefined || event.type === 0) return;

        const loc = event.location;
        this.recordUnderFeetPlacement(loc);
        let candidate = null;
        let bestDist = Infinity;

        // Block-change packets don't say who placed the block - approximate by
        // picking the nearest currently-airborne, deep-falling tracked player
        // whose feet are right around this block. Best-effort by nature.
        for (const [uuid, player] of this.playersByUuid) {
            if (player.onGround) continue;
            if (player.fallDistance < 10) continue;

            const dx = player.position.x - (loc.x + 0.5);
            const dy = player.position.y - loc.y;
            const dz = player.position.z - (loc.z + 0.5);
            if (Math.abs(dx) > 2 || Math.abs(dz) > 2) continue;
            if (dy < -1 || dy > 3) continue;

            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < bestDist) {
                bestDist = dist;
                candidate = player;
            }
        }

        if (candidate) {
            candidate.pendingClutchCheck = { time: Date.now(), location: loc };
        }
    }

    // Every server switch (lobby -> game, game -> lobby) is a respawn. Pause
    // checks until a /locraw response tells us where we are. tabalign and
    // bw-utilities already send /locraw on every switch and we read their
    // responses too (the chat event fires even when they hide the message),
    // so we only send our own if nobody else has within 2.5s.
    resetLocation() {
        this.inGame = false;
        this.locrawSeenAt = 0;
        clearTimeout(this.locrawFallbackTimer);
        this.locrawFallbackTimer = setTimeout(() => {
            if (!this.locrawSeenAt) this.requestOwnLocraw();
        }, 2500);
    }

    requestOwnLocraw() {
        this.awaitingOwnLocraw = true;
        clearTimeout(this.ownLocrawTimeout);
        this.ownLocrawTimeout = setTimeout(() => { this.awaitingOwnLocraw = false; }, 5000);
        this.api.sendChatToServer('/locraw');
    }

    parseLocraw(text) {
        if (typeof text !== 'string') return null;
        const trimmed = text.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
        try {
            const data = JSON.parse(trimmed);
            if (!('server' in data) && !('gametype' in data) && !('lobbyname' in data)) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    handleLocationChat(event) {
        const text = event.message || '';
        const location = this.parseLocraw(text);

        if (location) {
            // Limbo answers are transient; whoever asked will retry.
            if (location.server === 'limbo') return;
            this.locrawSeenAt = Date.now();
            this.inGame = !!location.mode &&
                !location.lobbyname &&
                String(location.mode).toLowerCase() !== 'lobby';
            this.api.debugLog(`Location: server=${location.server} mode=${location.mode || '-'} -> checks ${this.inGame ? 'active' : 'paused'}`);
            return;
        }

        // End-of-game summary (Bedwars, Skywars, ...). Post-game players
        // celebrate/fly around; stop until the next server switch.
        if (this.inGame && /^\s*1st Killer\b/.test(text.replace(/§./g, ''))) {
            this.inGame = false;
            this.api.debugLog('Game ended - checks paused');
        }
    }

    hideOwnLocrawResponse(event) {
        if (!this.awaitingOwnLocraw || !event.data?.message) return;
        let text;
        try {
            text = this.extractTextFromJSON(JSON.parse(event.data.message));
        } catch (e) {
            return;
        }
        if (!this.parseLocraw(text)) return;
        event.cancel();
        this.awaitingOwnLocraw = false;
        clearTimeout(this.ownLocrawTimeout);
    }

    // A block appearing right under a player's feet - the block they stand on
    // or the next one along their bridge - is almost certainly theirs.
    recordUnderFeetPlacement(loc) {
        let owner = null;
        let bestDist = Infinity;
        for (const player of this.playersByUuid.values()) {
            if (Math.abs(player.position.y - (loc.y + 1)) > 0.6) continue;
            const dist = Math.hypot(player.position.x - (loc.x + 0.5), player.position.z - (loc.z + 0.5));
            if (dist > 1.6 || dist >= bestDist) continue;
            owner = player;
            bestDist = dist;
        }
        if (!owner) return;

        owner.underPlacements.push({ t: Date.now(), key: `${loc.x},${loc.y},${loc.z}` });
        if (owner.underPlacements.length > 10) owner.underPlacements.shift();
        owner.placeSeq++;
        this.runChecks(owner);
    }

    isTrackedUuid(uuid) {
        if (!this.replayMode) return isRealPlayerUuid(uuid);
        const hex = typeof uuid === 'string' ? uuid.replace(/-/g, '') : '';
        return hex.length === 32 && hex[12] === '2';
    }

    updateReplayMode() {
        const title = (this.scoreboardTitles.get(this.sidebarObjective) || '').replace(/§./g, '').toUpperCase();
        const replayMode = title.includes('REPLAY') || title.includes('ATLAS');
        if (replayMode === this.replayMode) return;
        this.replayMode = replayMode;
        this.reset();
        this.api.debugLog(`Replay mode ${replayMode ? 'on - checking replay players' : 'off'}`);
    }

    // Exact hits from Kenway's core attack detector (src/packets/attack-detector.js).
    handlePlayerAttack(event) {
        if (!event.attacker || !event.target) return;
        const attacker = this.entityToPlayer.get(event.attacker.entityId);
        const victim = this.entityToPlayer.get(event.target.entityId);
        if (!attacker || !victim || attacker === victim) return;
        this.hasPreciseAttacks = true;

        const dx = attacker.position.x - victim.position.x;
        const dy = (attacker.position.y + EYE_HEIGHT) - (victim.position.y + TARGET_CENTER_OFFSET);
        const dz = attacker.position.z - victim.position.z;
        this.creditHit(attacker, victim, Math.sqrt(dx * dx + dy * dy + dz * dz));
        this.pushDisplaceHit(attacker, victim);

        attacker.attackedThisTick = attacker.attackedThisTick && attacker.attackedThisTick !== victim.uuid ? 'multi' : victim.uuid;
        attacker.attackTargetThisTick = victim;
        this.runChecks(attacker);
    }

    runChecks(player) {
        if (this.onlyInGames && !this.inGame && !this.replayMode) return;

        for (const checkName of Object.keys(CHECKS)) {
            const checkConfig = this.CONFIG[checkName];
            if (!checkConfig || !checkConfig.enabled) continue;

            // runChecks is called from the tick loop and from every packet
            // event, so the same evidence used to be scored several times -
            // inflating some checks (one placement adding VL six times) and
            // decaying others ~20x/sec while idle, so sparse checks like
            // ReachA could never reach their VL. Each check now only runs
            // when its own evidence changed: a new movement sample, swing,
            // crouch, attributed hit, or tick (for timed checks).
            const checkDefinition = CHECKS[checkName];
            const evidence = checkDefinition.evidence(player, this);
            if (player.lastEvidence[checkName] === evidence) continue;
            player.lastEvidence[checkName] = evidence;

            checkDefinition.check.call(this, player, checkConfig);
        }
    }

    // MWE-style checks keep their own violation trackers; when one flags, the
    // Kenway check alerts.
    mweFlag(player, checkName, config, detail) {
        this.api.debugLog(`[${checkName}] ${player.username}: ${detail}`);
        player.violations[checkName] = Math.max(player.violations[checkName], config.vl);
        if (this.shouldAlert(player, checkName, config)) {
            this.flag(player, checkName, player.violations[checkName], detail);
            this.markAlert(player, checkName);
        }
    }

    isSpectator(player) {
        return this.api.getPlayerInfo(player.uuid)?.gamemode === 3;
    }

    // `detail` (optional) says what was seen, e.g. which EagleA pattern.
    flag(player, checkName, vl, detail) {
        this.api.debugLog(`[FLAG DEBUG] Player object:`, {
            username: player.username,
            name: player.name,
            displayName: player.displayName,
            uuid: player.uuid
        });
        const cleanName = player.username || player.name || player.displayName?.replace(/§./g, '') || 'Unknown';

        const team = this.api.getPlayerTeam(cleanName);
        const prefix = team?.prefix || '';
        const suffix = team?.suffix || '';
        const displayName = prefix + cleanName + suffix;

        this.api.debugLog(`Flagging ${displayName} for ${checkName} (VL: ${vl})`);

        const alertsEnabled = this.api.config.get(`checks.${checkName}.enabled`);
        if (alertsEnabled) {
            const base = `${this.api.getPrefix()} ${displayName} §7flagged §5${checkName} §8(§7VL: ${vl}§8)${detail ? ` §8- §7${detail}` : ''}`;
            if (this.api.config.get('wdr.enabled') !== false) {
                // Clickable [WDR] button: runs the configured report command on Hypixel.
                const template = this.api.config.get('wdr.command') || '/wdr {player}';
                const command = template.replace(/\{player\}/g, cleanName);
                this.api.chat(JSON.stringify({
                    text: base + ' ',
                    extra: [{
                        text: '§8[§c§lWDR§8]',
                        clickEvent: { action: 'run_command', value: command },
                        hoverEvent: { action: 'show_text', value: { text: `§7Report §f${cleanName}§7 for cheating\n§8${command}` } }
                    }]
                }));
            } else {
                this.api.chat(base);
            }
        }

        const soundEnabled = this.api.config.get(`checks.${checkName}.sound`);
        if (soundEnabled) {
            this.api.sound('note.pling');
        }

        this.api.emit('anticheat:flagged', {
            uuid: player.uuid,
            name: cleanName,
            displayName,
            checkName,
            vl
        });
    }

    cleanup() {
        if (this.unsubscribeTick) {
            this.unsubscribeTick();
        }
        if (this.unsubscribePluginRestored) {
            this.unsubscribePluginRestored();
        }
        if (this.unsubscribeEntityMove) {
            this.unsubscribeEntityMove();
        }
        if (this.unsubscribeEntityAnimation) {
            this.unsubscribeEntityAnimation();
        }
        if (this.unsubscribePlayerJoin) {
            this.unsubscribePlayerJoin();
        }
        if (this.unsubscribePlayerLeave) {
            this.unsubscribePlayerLeave();
        }
        if (this.unsubscribeRespawn) {
            this.unsubscribeRespawn();
        }
        if (this.unsubscribePlayerInfo) {
            this.unsubscribePlayerInfo();
        }
        if (this.unsubscribeEntitySpawn) {
            this.unsubscribeEntitySpawn();
        }
        if (this.unsubscribeEntityDestroy) {
            this.unsubscribeEntityDestroy();
        }
        if (this.unsubscribeEntityMetadata) {
            this.unsubscribeEntityMetadata();
        }
        if (this.unsubscribeEntityEquipment) {
            this.unsubscribeEntityEquipment();
        }
        if (this.unsubscribeEntityEffect) {
            this.unsubscribeEntityEffect();
        }
        if (this.unsubscribeRemoveEntityEffect) {
            this.unsubscribeRemoveEntityEffect();
        }
        if (this.unsubscribeEntityStatus) {
            this.unsubscribeEntityStatus();
        }
        if (this.unsubscribePosition) {
            this.unsubscribePosition();
        }
        if (this.unsubscribeEntityVelocity) {
            this.unsubscribeEntityVelocity();
        }
        for (const unsubscribe of [this.unsubscribeHeadRotation, this.unsubscribePlayerAttack, this.unsubscribeScoreboardObjective, this.unsubscribeScoreboardDisplay]) {
            if (unsubscribe) unsubscribe();
        }
        if (this.unsubscribeEntityRotation) {
            this.unsubscribeEntityRotation();
        }
        if (this.unsubscribeWorldBlockChange) {
            this.unsubscribeWorldBlockChange();
        }
        if (this.unsubscribeChat) {
            this.unsubscribeChat();
        }
        if (this.unsubscribeChatIntercept) {
            this.unsubscribeChatIntercept();
        }
        clearTimeout(this.locrawFallbackTimer);
        clearTimeout(this.ownLocrawTimeout);
        this.reset();
    }

    extractTextFromJSON(jsonText) {
        if (typeof jsonText === 'string') {
            return jsonText;
        }

        let result = '';

        if (jsonText.text) {
            result += jsonText.text;
        }

        if (jsonText.extra && Array.isArray(jsonText.extra)) {
            for (const extra of jsonText.extra) {
                if (typeof extra === 'string') {
                    result += extra;
                } else if (extra.text) {
                    result += extra.text;
                }
            }
        }

        return result || 'Unknown';
    }

    addViolation(player, checkName, amount = 1) {
        if (player.violations[checkName] !== undefined) {
            player.violations[checkName] += amount;
        }
    }

    reduceViolation(player, checkName, amount = 1) {
        if (player.violations[checkName] !== undefined) {
            player.violations[checkName] = Math.max(0, player.violations[checkName] - amount);
        }
    }

    shouldAlert(player, checkName, config) {
        const hasViolations = player.violations[checkName] >= config.vl;
        const timeSinceLastAlert = Date.now() - player.lastAlerts[checkName];
        const cooldownPassed = timeSinceLastAlert > config.cooldown;

        return hasViolations && cooldownPassed;
    }

    markAlert(player, checkName) {
        if (player.lastAlerts[checkName] !== undefined) {
            player.lastAlerts[checkName] = Date.now();
        }
    }
}

module.exports.__test = { CHECKS, PlayerData, AnticheatSystem, getRelativeMoveAngle, getMoveLookAngleDiff, wrapDegrees };
