/**
 * The portrait right-click menu: make current, pan, ping, target, initiative, late arrival,
 * hide, defeat, edit and remove.
 *
 * Each entry looks the combatant up from the clicked portrait when the menu opens, in whatever
 * combat the bar is showing then: the menu is built once per session, not per combat.
 */

import { arrive, isWaiting, openArrivalDialog } from "./arrival-service.mjs";

/**
 * The menu's entries, for core's ContextMenu.
 * @param {import("./combat-bar.mjs").CombatBar} bar
 * @param {object} actions  The bar's own behaviour, shared with clicks on the portrait itself.
 * @param {(combatant: Combatant) => Promise<void>} actions.selectAndPan
 * @param {(combatant: Combatant, event: Event) => Promise<void>} actions.rollInitiative
 * @returns {object[]}
 */
export function portraitMenuOptions(bar, { selectAndPan, rollInitiative }) {
  const combatantOf = li => bar.combat?.combatants.get(li.dataset.combatantId);
  const gm = () => game.user.isGM;
  return [
    {
      label: "sogrom-simple-combat-bar.context.setCurrent",
      icon: '<i class="fa-solid fa-hourglass-start"></i>',
      // One that hasn't arrived would only be stepped straight past: bring it in first.
      visible: li => gm() && bar.combat?.started && (combatantOf(li) !== bar.combat.combatant)
        && !isWaiting(combatantOf(li)),
      onClick: (_event, li) => {
        const index = bar.combat.turns.findIndex(c => c.id === li.dataset.combatantId);
        if ( index >= 0 ) bar.combat.update({ turn: index });
      }
    },
    {
      label: "COMBATANT.PanTo",
      icon: '<i class="fa-solid fa-location-crosshairs"></i>',
      visible: li => canPanTo(combatantOf(li)),
      onClick: (_event, li) => selectAndPan(combatantOf(li))
    },
    {
      label: "COMBATANT.Ping",
      icon: '<i class="fa-solid fa-bullseye-arrow"></i>',
      visible: li => canvas.ready && (combatantOf(li)?.sceneId === canvas.scene?.id)
        && game.user.hasPermission("PING_CANVAS"),
      onClick: (_event, li) => {
        const token = combatantOf(li)?.token?.object;
        if ( token?.visible ) canvas.ping(token.center);
      }
    },
    {
      label: "sogrom-simple-combat-bar.context.target",
      icon: '<i class="fa-solid fa-crosshairs"></i>',
      visible: li => canTarget(combatantOf(li)) && !combatantOf(li).token.object.isTargeted,
      // Shift adds to the targets already chosen, as with core's Target key.
      onClick: (event, li) => canTarget(combatantOf(li))
        && combatantOf(li).token.object.setTarget(true, { releaseOthers: !event.shiftKey })
    },
    {
      label: "sogrom-simple-combat-bar.context.untarget",
      icon: '<i class="fa-solid fa-crosshairs"></i>',
      visible: li => canTarget(combatantOf(li)) && combatantOf(li).token.object.isTargeted,
      onClick: (_event, li) => canTarget(combatantOf(li)) && combatantOf(li).token.object.setTarget(false)
    },
    {
      label: "COMBATANT.ACTIONS.Reroll",
      icon: '<i class="fa-solid fa-dice-d20"></i>',
      visible: li => gm() || !!combatantOf(li)?.isOwner,
      // The click event carries Shift / Ctrl, which skip the roll window as on the d20.
      onClick: (event, li) => combatantOf(li) && rollInitiative(combatantOf(li), event)
    },
    {
      label: "COMBATANT.ACTIONS.Clear",
      icon: '<i class="fa-solid fa-eraser"></i>',
      visible: li => gm() && (combatantOf(li)?.initiative !== null),
      onClick: (_event, li) => combatantOf(li)?.update({ initiative: null })
    },
    {
      label: "sogrom-simple-combat-bar.context.arrivesLater",
      icon: '<i class="fa-solid fa-door-open"></i>',
      visible: li => gm() && !!combatantOf(li) && (combatantOf(li) !== bar.combat?.combatant),
      onClick: (_event, li) => openArrivalDialog(combatantOf(li))
    },
    {
      label: "sogrom-simple-combat-bar.context.arriveNow",
      icon: '<i class="fa-solid fa-person-walking-arrow-right"></i>',
      visible: li => gm() && isWaiting(combatantOf(li)),
      onClick: (_event, li) => arrive(combatantOf(li))
    },
    {
      label: "COMBATANT.Hide",
      icon: '<i class="fa-solid fa-eye-slash"></i>',
      visible: li => gm() && !combatantOf(li)?.hidden,
      onClick: (_event, li) => combatantOf(li)?.update({ hidden: true })
    },
    {
      label: "COMBATANT.Show",
      icon: '<i class="fa-solid fa-eye"></i>',
      visible: li => gm() && !!combatantOf(li)?.hidden,
      onClick: (_event, li) => combatantOf(li)?.update({ hidden: false })
    },
    {
      label: "COMBATANT.MarkDefeated",
      icon: '<i class="fa-solid fa-skull"></i>',
      visible: li => gm() && !combatantOf(li)?.isDefeated,
      onClick: (_event, li) => toggleDefeated(combatantOf(li))
    },
    {
      label: "COMBATANT.UnmarkDefeated",
      icon: '<i class="fa-solid fa-heart-pulse"></i>',
      visible: li => gm() && !!combatantOf(li)?.isDefeated,
      onClick: (_event, li) => toggleDefeated(combatantOf(li))
    },
    {
      label: "COMBATANT.ACTIONS.Update",
      icon: '<i class="fa-solid fa-pen-to-square"></i>',
      visible: gm,
      onClick: (_event, li) => combatantOf(li)?.sheet.render(true)
    },
    {
      label: "COMBATANT.ACTIONS.Remove",
      icon: '<i class="fa-solid fa-trash"></i>',
      visible: gm,
      onClick: (_event, li) => combatantOf(li)?.delete()
    }
  ];
}

/** Whether this user may select and pan to a combatant's token: it's on the canvas, and they observe it. */
export function canPanTo(combatant) {
  return !!combatant?.token?.object && !!combatant.actor?.testUserPermission(game.user, "OBSERVER");
}

/** Whether this user may target a combatant's token from the bar: it's on the canvas, and they can see it. */
function canTarget(combatant) {
  return canvas.ready && !!combatant?.token?.object?.visible;
}

/**
 * Core's own defeat toggle, re-implemented on public API so it doesn't depend on the combat
 * tracker's private methods.
 */
async function toggleDefeated(combatant) {
  if ( !combatant ) return;
  const defeated = !combatant.isDefeated;
  await combatant.update({ defeated });
  await combatant.actor?.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { overlay: true, active: defeated });
}
