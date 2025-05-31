/**
 * Aethelspark Magic Mechanics for Foundry VTT
 *
 * This script implements custom magic rules for the Aethelspark setting, including:
 * - Unreliable Magic: Spell Success Checks (d100) based on spell level.
 * - Bonuses: From actor flags, spellcasting foci, and a specific feat.
 * - Pushing the Weave: Options for Grit (bonus before roll, costs exhaustion) and
 * Desperation (reroll after fizzle, costs exhaustion).
 *
 * TO USE:
 * 1. Save this code as a .js file (e.g., aethelspark-magic.js) in your world's `scripts` folder
 * or within a custom module.
 * 2. If using a module, ensure your module.json includes this script.
 * 3. If as a world script, add it via Game Settings -> Configure World Scripts.
 *
 * IMPORTANT NOTES ON RUNESTONES:
 * The Player's Guide states spells from Runestones are 100% successful and bypass these checks.
 * This script primarily targets spells cast directly (e.g., from a character's spellbook).
 * - If your Runestones are implemented as 'consumable' type items that cast a spell, this script
 * attempts to detect and bypass them.
 * - If Runestones are implemented differently (e.g., spells with a special flag, or cast via macros
 * that should not trigger these rules), you may need to adjust the initial check in the
 * `preUseItem` hook to correctly identify and ignore Runestone-based spellcasting.
 * One way is to pass an option like `options.aethelsparkIsRunestone = true;` when a Runestone casts a spell.
 */

Hooks.once('init', () => {
    console.log("Aethelspark Magic | Initializing custom magic mechanics.");
});

Hooks.once('ready', () => {
    if (!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
        ui.notifications.warn("Aethelspark Magic: 'libWrapper' module is not active. It is recommended for compatibility, but the script will attempt to function without it for some hooks if necessary. Direct hooking is used here.");
    }
    console.log("Aethelspark Magic | Ready to apply custom magic rules.");
});

const AETHELSPARK_CONFIG = {
    SPELL_SUCCESS_THRESHOLDS: {
        0: 5,   // Cantrip (95% success)
        1: 10,  // 1st Level (90% success)
        2: 20,  // 2nd Level (80% success)
        3: 30,  // 3rd Level (70% success)
        4: 40,  // 4th Level (60% success)
        5: 50,  // 5th Level (50% success)
        6: 60,  // 6th Level (40% success)
        7: 70,  // 7th Level (30% success)
        8: 80,  // 8th Level (20% success)
        9: 90   // 9th Level (10% success)
    },
    FOCUS_BONUSES: { // Case-insensitive partial match for item names
        WAND: 3,
        ORB: 5,
        STAFF: 7
    },
    WELLSPRING_FEAT_NAME: "Wellspring of Power", // Case-insensitive
    WELLSPRING_FEAT_BONUS: 5,
    SPELL_SUCCESS_BONUS_FLAG: "flags.world.aethelspark.spellSuccessBonus" // As specified by user
};

/**
 * Hook into the item usage workflow, before a spell is cast.
 * Returns `true` to allow the spell to proceed as normal.
 * Returns `false` to prevent the spell from casting (e.g., if it fizzles).
 */
Hooks.on('dnd5e.preUseItem', async (item, config, options) => {
    // Only apply to spells cast by player characters (or NPCs if desired, remove check then)
    if (!item.actor || !item.actor.hasPlayerOwner) return true;
    if (item.type !== 'spell') return true;

    const actor = item.actor;
    const spellLevel = item.system.level;

    // --- Runestone Check ---
    // If spells from Runestones are 'consumable' items that cast a spell.
    if (item.type === 'consumable' && item.system.spell) {
        console.log(`Aethelspark Magic | Consumable spell item ${item.name} used. Assuming Runestone. Bypassing success check.`);
        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `${actor.name} casts ${item.name} from a Runestone (assumed). Spell is automatically successful.`
        });
        return true;
    }
    // If you pass a custom option when casting from a Runestone item/macro
    if (options.aethelsparkIsRunestone === true) {
        console.log(`Aethelspark Magic | Spell ${item.name} flagged as Runestone cast. Bypassing success check.`);
         ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `${actor.name} casts ${item.name} from a Runestone. Spell is automatically successful.`
        });
        return true;
    }
    // If the spell is a cantrip imbued in a runestone (special rule: no depletion, 100% success)
    // This requires a way to identify such runestones. For now, assume direct cantrip casts are subject to checks.
    // The user's guide: "Cantrips and Runestones (Special Exception): If you imbue a cantrip into a Runestone... that Runestone allows you to cast that specific cantrip with 100% success... does NOT deplete"
    // This hook might not be the place for that specific Runestone rule; that might be on the Runestone item itself.

    let spellSuccessBonus = actor.getFlag('world', 'aethelspark.spellSuccessBonus') || 0;
    if (isNaN(spellSuccessBonus)) spellSuccessBonus = 0;


    // --- Calculate Bonuses ---
    let totalBonus = spellSuccessBonus;
    let bonusSources = [];
    if (spellSuccessBonus !== 0) bonusSources.push(`Base Spell Success Bonus (${spellSuccessBonus > 0 ? '+' : ''}${spellSuccessBonus})`);


    // Spellcasting Focus Bonus
    let focusBonus = 0;
    const equippedItems = actor.items.filter(i => i.system.equipped && i.system.properties?.has('foc'));
    for (const eqItem of equippedItems) {
        const itemNameLower = eqItem.name.toLowerCase();
        const itemType = eqItem.system.type?.value;

        if (itemType === 'wand' || itemNameLower.includes('wand')) focusBonus = Math.max(focusBonus, AETHELSPARK_CONFIG.FOCUS_BONUSES.WAND);
        else if (itemNameLower.includes('orb')) focusBonus = Math.max(focusBonus, AETHELSPARK_CONFIG.FOCUS_BONUSES.ORB); // Orb is not a standard type, rely on name
        else if (itemType === 'staff' || itemNameLower.includes('staff')) focusBonus = Math.max(focusBonus, AETHELSPARK_CONFIG.FOCUS_BONUSES.STAFF);
    }
    if (focusBonus > 0) {
        totalBonus += focusBonus;
        bonusSources.push(`Spellcasting Focus (${focusBonus > 0 ? '+' : ''}${focusBonus})`);
    }

    // Wellspring of Power Feat Bonus
    const wellspringFeat = actor.items.find(i => i.type === 'feat' && i.name.toLowerCase() === AETHELSPARK_CONFIG.WELLSPRING_FEAT_NAME.toLowerCase());
    if (wellspringFeat) {
        totalBonus += AETHELSPARK_CONFIG.WELLSPRING_FEAT_BONUS;
        bonusSources.push(`${AETHELSPARK_CONFIG.WELLSPRING_FEAT_NAME} (${AETHELSPARK_CONFIG.WELLSPRING_FEAT_BONUS > 0 ? '+' : ''}${AETHELSPARK_CONFIG.WELLSPRING_FEAT_BONUS})`);
    }

    const d100CheckNeeded = AETHELSPARK_CONFIG.SPELL_SUCCESS_THRESHOLDS[spellLevel];
    if (d100CheckNeeded === undefined) {
        console.warn(`Aethelspark Magic | Unknown spell level ${spellLevel} for spell ${item.name}. Allowing cast.`);
        return true; // Failsafe for unknown spell levels
    }

    let usedGrit = false;
    let gritExhaustionCost = 0;

    // --- Grit Option (Before Roll) ---
    const currentExhaustion = actor.system.attributes.exhaustion || 0;
    let gritDialogButtons = {
        none: { label: "No Grit", callback: () => null, icon: `<i class="fas fa-times"></i>` }
    };
    if (currentExhaustion < 5) { // Can take at least 1 level
        gritDialogButtons.one = { label: "+10 (1 Exhaustion)", callback: () => ({ bonus: 10, exhaustion: 1 }), icon: `<i class="fas fa-tint"></i>` };
    }
    if (currentExhaustion < 4) { // Can take 2 levels
        gritDialogButtons.two = { label: "+20 (2 Exhaustion)", callback: () => ({ bonus: 20, exhaustion: 2 }), icon: `<i class="fas fa-tint-slash"></i>` };
    }

    const gritChoice = await Dialog.prompt({
        title: "Push the Weave: Grit",
        content: `<p>You are attempting to cast <strong>${item.name}</strong> (Level ${spellLevel}).</p>
                  <p>The d100 target is <strong>${d100CheckNeeded}</strong> (roll >=). Your current bonus is <strong>${totalBonus > 0 ? '+' : ''}${totalBonus}</strong>.</p>
                  <p>Use Grit to improve your chances? (Current Exhaustion: ${currentExhaustion})</p>`,
        buttons: gritDialogButtons,
        default: "none",
        rejectClose: false
    });

    if (gritChoice && gritChoice.bonus > 0) {
        const newExhaustion = currentExhaustion + gritChoice.exhaustion;
        if (newExhaustion <= 5) { // Max effective exhaustion before death is 5 (6 is death)
            totalBonus += gritChoice.bonus;
            gritExhaustionCost = gritChoice.exhaustion;
            usedGrit = true;
            bonusSources.push(`Grit (${gritChoice.bonus > 0 ? '+' : ''}${gritChoice.bonus}, ${gritChoice.exhaustion} Exhaustion)`);
        } else {
            ui.notifications.warn("Aethelspark Magic | Cannot use Grit: Resulting exhaustion would be too high.");
        }
    }

    // Perform the d100 roll
    const roll = await new Roll('1d100').roll({ async: true });
    const finalRollValue = roll.total + totalBonus;

    let messageContent = `
        <p><strong>${actor.name}</strong> attempts to cast <strong>${item.name}</strong> (Level ${spellLevel}).</p>
        <p>d100 Target: <strong>${d100CheckNeeded}</strong> or higher.</p>
        <p>Bonuses: ${bonusSources.join(', ') || 'None'} (Total: ${totalBonus > 0 ? '+' : ''}${totalBonus}).</p>
        <p>d100 Roll: ${roll.result} + ${totalBonus} = <strong>${finalRollValue}</strong>.</p>
    `;

    if (finalRollValue >= d100CheckNeeded) {
        // SUCCESS
        if (gritExhaustionCost > 0) {
            await actor.update({ 'system.attributes.exhaustion': currentExhaustion + gritExhaustionCost });
            messageContent += `<p><strong>Success!</strong> The spell manifests! (Gained ${gritExhaustionCost} exhaustion from Grit).</p>`;
        } else {
            messageContent += `<p><strong>Success!</strong> The spell manifests!</p>`;
        }
        ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content: messageContent, rollMode: CONST.CHAT_MESSAGE_TYPES.ROLL, roll:roll });
        return true; // Allow spell to cast
    } else {
        // FIZZLE
        messageContent += `<p><strong>Fizzled!</strong> The magic fails to coalesce.</p>`;

        // Consume spell slot for leveled spells if not already handled by config (preUseItem returning false stops normal consumption)
        if (spellLevel > 0 && config.consumeSlot !== false) { // config.consumeSlot might be false if "always prepared" etc.
            const spellcastingEntry = item.getSheetSpells(); // Get the spell's entry (e.g., 'spells', 'pact')
            if (spellcastingEntry) {
                const slotPath = spellcastingEntry.levelPath(spellLevel); // e.g., system.spells.spell3.value
                 if (actor.system.spells[spellcastingEntry.id]?.[`spell${spellLevel}`]?.value > 0) {
                    await actor.update({ [slotPath]: actor.system.spells[spellcastingEntry.id][`spell${spellLevel}`].value - 1 });
                    messageContent += `<p><em>A spell slot was consumed.</em></p>`;
                } else if (spellcastingEntry.id === 'pact' && actor.system.spells.pact.value > 0) {
                     await actor.update({ 'system.spells.pact.value': actor.system.spells.pact.value - 1 });
                     messageContent += `<p><em>A pact magic spell slot was consumed.</em></p>`;
                }
            }
        }
        // Apply Grit exhaustion now if initial roll failed
        if (gritExhaustionCost > 0) {
             await actor.update({ 'system.attributes.exhaustion': currentExhaustion + gritExhaustionCost });
             messageContent += `<p>(Gained ${gritExhaustionCost} exhaustion from Grit).</p>`;
        }


        if (usedGrit) {
            // Grit was used, no Desperation allowed
            ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content: messageContent, rollMode: CONST.CHAT_MESSAGE_TYPES.ROLL, roll:roll });
            return false; // Spell fizzles
        }

        // --- Desperation Option (After Fizzle, if Grit wasn't used) ---
        const currentExhaustionAfterGritAttempt = actor.system.attributes.exhaustion || 0; // Re-fetch in case Grit was applied.
        if (currentExhaustionAfterGritAttempt < 5) { // Can take 1 more level
            const desperationChoice = await Dialog.confirm({
                title: "Push the Weave: Desperation",
                content: messageContent + `<hr><p>Use Desperation to reroll the Spell Success Check? (This will inflict 1 Exhaustion. Current Exhaustion: ${currentExhaustionAfterGritAttempt})</p>`,
                yes: { label: "Reroll (1 Exhaustion)", icon: `<i class="fas fa-redo"></i>` },
                no: { label: "Accept Fizzle", icon: `<i class="fas fa-times"></i>` },
                defaultYes: false
            });

            if (desperationChoice) {
                await actor.update({ 'system.attributes.exhaustion': currentExhaustionAfterGritAttempt + 1 });

                const reroll = await new Roll('1d100').roll({ async: true });
                const finalRerollValue = reroll.total + totalBonus; // totalBonus does not include Grit here

                let rerollMessage = `<p><strong>${actor.name} uses Desperation!</strong> (Gained 1 Exhaustion).</p>
                                     <p>Rerolling d100 Target: ${d100CheckNeeded} or higher.</p>
                                     <p>Bonuses: ${bonusSources.filter(s => !s.includes("Grit")).join(', ') || 'None'} (Total: ${totalBonus > 0 ? '+' : ''}${totalBonus}).</p>
                                     <p>d100 Reroll: ${reroll.result} + ${totalBonus} = <strong>${finalRerollValue}</strong>.</p>`;

                if (finalRerollValue >= d100CheckNeeded) {
                    // SUCCESS ON REROLL
                    rerollMessage += `<p><strong>Success on Reroll!</strong> The spell manifests!</p>`;
                    ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content: messageContent + rerollMessage, rollMode: CONST.CHAT_MESSAGE_TYPES.ROLL, roll:reroll });
                    return true; // Allow spell to cast
                } else {
                    // FIZZLE ON REROLL
                    rerollMessage += `<p><strong>Fizzled Again!</strong> The magic dissipates completely.</p>`;
                    ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content: messageContent + rerollMessage, rollMode: CONST.CHAT_MESSAGE_TYPES.ROLL, roll:reroll });
                    return false; // Spell fizzles
                }
            }
        }

        // No Desperation chosen or couldn't use it
        ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content: messageContent, rollMode: CONST.CHAT_MESSAGE_TYPES.ROLL, roll:roll });
        return false; // Spell fizzles
    }
});

// Helper to get spellcasting entry for slot consumption (simplified)
// dnd5e item.getSheetSpells() is more robust if available and item is on an actor sheet
if (!CONFIG.Item.documentClass.prototype.getSheetSpells) {
    CONFIG.Item.documentClass.prototype.getSheetSpells = function() {
        if (this.type !== "spell" || !this.actor) return null;
        const prep = this.system.preparation;
        if (prep?.mode === "pact") return { id: "pact", label: "Pact Magic", levelPath: (l) => `system.spells.pact.slots${l}.value` }; // Pact slots are single level
        if (prep?.mode === "prepared" || prep?.mode === "always" || prep?.mode === "innate") return { id: "spells", label: "Spells", levelPath: (l) => `system.spells.spell${l}.value`};
        return null; // Add other types like atwill if they consume slots in your system
    };
}
