/**
 * Alert's Initiative Swap (2024 rules) — pure.
 *
 * "Immediately after you roll Initiative, you can swap your Initiative with the Initiative of one
 * willing ally in the same combat. You can't make this swap if you or the ally has the
 * Incapacitated condition." The bar offers it until the combat starts, between allies only.
 */

/**
 * @typedef {object} SwapFacts
 * @property {string} id
 * @property {string} side               "ally", "enemy", "neutral" or "secret" (events and late arrivals are neutral).
 * @property {number|null} initiative
 * @property {boolean} alert             Has Alert's Initiative Swap.
 * @property {boolean} incapacitated
 * @property {boolean} defeated
 */

/**
 * Whether a combatant can take part in a swap, on either end.
 * @param {SwapFacts} f
 * @returns {boolean}
 */
function canTakePart(f) {
  return !!f && (f.side === "ally") && (f.initiative !== null) && (f.initiative !== undefined)
    && !f.incapacitated && !f.defeated;
}

/**
 * Whether these two may swap now.
 * @param {object} input
 * @param {boolean} input.started   The combat has started.
 * @param {SwapFacts} input.swapper The one with Alert.
 * @param {SwapFacts} input.ally
 * @returns {boolean}
 */
export function canSwap({ started, swapper, ally }) {
  return !started && !!swapper?.alert && canTakePart(swapper) && canTakePart(ally) && (ally.id !== swapper.id);
}

/**
 * The allies a swapper could swap with now, in the order given.
 * @param {object} input
 * @param {boolean} input.started
 * @param {SwapFacts} input.swapper
 * @param {SwapFacts[]} input.others  Everyone in the combat (the swapper may be among them).
 * @returns {SwapFacts[]}
 */
export function swapAllies({ started, swapper, others }) {
  return (others ?? []).filter(ally => canSwap({ started, swapper, ally }));
}

/**
 * Who should agree to a swap for the ally, or null if nobody needs asking.
 *
 * The ally's player, preferring the one whose assigned character it is, then any other owner who
 * is connected. With none connected, the GM answers in their place. Nobody is asked when the one
 * asking would be the one who requested the swap: their request is their agreement.
 * @param {object} input
 * @param {string} input.requesterId  The user who asked for the swap.
 * @param {Array<{id: string, active: boolean, isCharacter: boolean}>} input.owners
 *        The ally's non-GM owners. `isCharacter`: the ally is this user's assigned character.
 * @param {string|null} input.gmId    The active GM.
 * @returns {string|null}
 */
export function consentUser({ requesterId, owners, gmId }) {
  if ( owners.some(o => o.id === requesterId) ) return null;
  const online = owners.filter(o => o.active);
  const target = (online.find(o => o.isCharacter) ?? online[0])?.id ?? gmId ?? null;
  return target === requesterId ? null : target;
}
