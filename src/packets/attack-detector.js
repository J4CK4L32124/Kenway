// Who-hit-whom detection for other players' melee hits. Ported from MWE's
// AttackDetector (https://github.com/Alexdoru/MWE,
// fr.alexdoru.mwe.hackerdetector.AttackDetector) under the notice below.
//
// The protocol never tells a third party who attacked whom, but when the
// server processes a hit it writes the attacker's arm swing and the victim's
// hurt status + hurt sound (or crit / sharpness particles) back to back, in
// the same burst. A swing immediately followed by those packets pins the
// attacker exactly, with no guessing from distance or timing.
//
// --- MWE notice -------------------------------------------------------------
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
// -----------------------------------------------------------------------------

// Packets written for one hit arrive in the same burst.
const SAME_BURST_MS = 2;
// Beyond this the attacker may not be loaded for us (MWE: 56 blocks).
const MAX_DISTANCE_FROM_US = 56;
const MAX_ATTACK_DISTANCE_SQ = 64;

class AttackDetector {
    constructor() {
        this.lastPacketWasSwing = false;
        this.lastSwingTime = 0;
        this.attackerId = null;
        this.lastPacketWasHurt = false;
        this.lastHurtTime = 0;
        this.lastHurtId = null;
        this.consecutiveSwingHurt = false;
    }

    // Must see every server->client packet, in arrival order. Returns
    // { attackerId, targetId, type, soundPos } when a hit was recognised.
    onServerPacket(name, data, now = Date.now()) {
        let attack = null;

        if (name === 'animation') {
            if (data.animation === 0) { // arm swing
                this.lastPacketWasHurt = false;
                this.consecutiveSwingHurt = false;
                this.lastPacketWasSwing = true;
                this.lastSwingTime = now;
                this.attackerId = data.entityId;
                return null;
            }
            if ((data.animation === 4 || data.animation === 5) && now - this.lastSwingTime < SAME_BURST_MS) {
                // 4 = critical hit particles, 5 = sharpness particles
                attack = {
                    attackerId: this.attackerId,
                    targetId: data.entityId,
                    type: (this.lastPacketWasSwing ? 'DIRECT_' : '') + (data.animation === 4 ? 'CRITICAL' : 'SHARPNESS'),
                };
            }
        } else if (name === 'entity_status') {
            if (data.entityStatus === 2) { // hurt
                if (this.lastPacketWasSwing) this.consecutiveSwingHurt = true;
                this.lastPacketWasSwing = false;
                this.lastPacketWasHurt = true;
                this.lastHurtTime = now;
                this.lastHurtId = data.entityId;
                return null;
            }
        } else if (name === 'named_sound_effect') {
            const isHurtSound = data.soundName === 'game.player.hurt' || data.soundName === 'game.player.die';
            if (isHurtSound && this.lastPacketWasHurt &&
                now - this.lastSwingTime < SAME_BURST_MS && now - this.lastHurtTime < SAME_BURST_MS) {
                attack = {
                    attackerId: this.attackerId,
                    targetId: this.lastHurtId,
                    type: (this.consecutiveSwingHurt ? 'DIRECT_' : '') + (data.soundName === 'game.player.die' ? 'DEATHSOUND' : 'HURTSOUND'),
                    soundPos: { x: data.x / 8, y: data.y / 8, z: data.z / 8 },
                };
            }
        }

        this.lastPacketWasHurt = false;
        this.lastPacketWasSwing = false;
        this.consecutiveSwingHurt = false;
        return attack;
    }
}

// MWE's sanity checks on a recognised hit, against Kenway's game state.
// Returns { attacker, target } entity copies, or null to discard it.
function validateAttack(attack, gameState) {
    if (attack.attackerId === attack.targetId) return null;
    const attacker = gameState.entities.get(attack.attackerId);
    const target = gameState.entities.get(attack.targetId);
    if (!attacker || !target || attacker.type !== 'player' || target.type !== 'player') return null;

    const us = gameState.position;
    if (Math.abs(us.x - target.position.x) > MAX_DISTANCE_FROM_US || Math.abs(us.z - target.position.z) > MAX_DISTANCE_FROM_US) {
        return null;
    }
    const dx = attacker.position.x - target.position.x;
    const dy = attacker.position.y - target.position.y;
    const dz = attacker.position.z - target.position.z;
    if (dx * dx + dy * dy + dz * dz > MAX_ATTACK_DISTANCE_SQ) return null;

    if (attack.soundPos) {
        const s = attack.soundPos;
        if (Math.abs(s.x - target.position.x) >= 1 || Math.abs(s.y - target.position.y) >= 1 || Math.abs(s.z - target.position.z) >= 1) {
            return null;
        }
    }

    return {
        attacker: Object.assign({}, attacker, { entityId: attack.attackerId }),
        target: Object.assign({}, target, { entityId: attack.targetId }),
    };
}

module.exports = { AttackDetector, validateAttack };
