/**
 * Initiative rules — pure.
 */

/**
 * Whether pressing a portrait's d20 should open the system's roll dialog (advantage, bonuses)
 * rather than rolling straight away.
 * @param {"none"|"npcs"|"players"|"all"} mode  Setting `initiativeDialog`.
 * @param {boolean} isPlayerCharacter           The combatant's actor has a player owner.
 * @returns {boolean}
 */
export function wantsInitiativeDialog(mode, isPlayerCharacter) {
  switch ( mode ) {
    case "all": return true;
    case "players": return isPlayerCharacter;
    case "npcs": return !isPlayerCharacter;
    default: return false;
  }
}
