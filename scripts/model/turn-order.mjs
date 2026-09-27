/**
 * The bar's reading order — pure, no Foundry globals.
 *
 * BG3 reads left to right as "who's acting now, who's next, and then next round": the current
 * combatant (or group) first, the rest of this round after it, a "Round N+1" divider, then those
 * who already acted this round, since they're first again next round. Before combat starts
 * there's no current turn, so the bar shows plain initiative order with no divider.
 */

/** Sides that group together. Neutral and secret combatants never share a turn. */
export const GROUPABLE_SIDES = Object.freeze(new Set(["ally", "enemy"]));

/**
 * @typedef {object} TurnEntry
 * @property {string} id
 * @property {"ally"|"enemy"|"neutral"|"secret"} side
 * @property {boolean} [defeated]
 * @property {boolean} [shown=true]   Whether this user sees the combatant at all.
 * @property {string|null} [groupId]  dnd5e CombatantGroup id, kept together inside a run.
 */

/**
 * @typedef {object} BarCombatant
 * @property {"combatant"} type
 * @property {string} key
 * @property {string} id
 * @property {boolean} current
 * @property {boolean} acted     Already acted this round (sits after the divider).
 * @property {string|null} run   Key of the team run this combatant belongs to, if grouped.
 */

/**
 * @typedef {object} BarDivider
 * @property {"divider"} type
 * @property {string} key
 * @property {number} round
 */

/**
 * Split turns into team runs: maximal sequences of consecutive combatants on the same groupable
 * side. A combatant on a non-groupable side is a run of one. Defeated combatants inside a run
 * don't break it (BG3 keeps the frame while a member lies unconscious).
 * @param {TurnEntry[]} turns
 * @returns {Array<{key: string, side: string, start: number, end: number, ids: string[]}>}
 *          `end` is exclusive.
 */
export function teamRuns(turns) {
  const runs = [];
  let current = null;
  turns.forEach((entry, index) => {
    const groupable = GROUPABLE_SIDES.has(entry.side);
    if ( current && groupable && current.side === entry.side ) {
      current.end = index + 1;
      current.ids.push(entry.id);
      return;
    }
    current = { key: `run-${entry.id}`, side: entry.side, start: index, end: index + 1, ids: [entry.id] };
    runs.push(current);
    if ( !groupable ) current = null;
  });
  return runs;
}

/**
 * Where the round starts for display: the index of the first turn that's still to come. With
 * grouping on, that's the start of the run holding the current turn, since a group acts
 * together and the whole group is "now".
 * @param {TurnEntry[]} turns
 * @param {number} turn           Core's turn pointer.
 * @param {boolean} grouped
 * @returns {number}
 */
export function displayStart(turns, turn, grouped) {
  if ( !grouped ) return turn;
  const run = teamRuns(turns).find(r => (turn >= r.start) && (turn < r.end));
  return run ? run.start : turn;
}

/**
 * Build the bar's item list.
 * @param {object} input
 * @param {TurnEntry[]} input.turns     Core's `combat.turns` order.
 * @param {number|null} input.turn      Core's turn pointer (null before start).
 * @param {number} input.round
 * @param {boolean} input.started
 * @param {"off"|"visual"|"bg3"} [input.grouping="off"]
 * @param {boolean} [input.hideDefeated=false]
 * @returns {Array<BarCombatant|BarDivider>}
 */
export function buildOrder({ turns, turn, round, started, grouping = "off", hideDefeated = false }) {
  const grouped = grouping !== "off";
  const runOf = new Map();
  if ( grouped ) {
    for ( const run of teamRuns(turns) ) {
      if ( run.ids.length > 1 ) for ( const id of run.ids ) runOf.set(id, run.key);
    }
  }

  const include = entry => (entry.shown !== false) && !(hideDefeated && entry.defeated);
  const toItem = (entry, acted, current) => ({
    type: "combatant", key: entry.id, id: entry.id, current, acted, run: runOf.get(entry.id) ?? null
  });

  if ( !started || (turn === null) || (turn === undefined) || !turns.length ) {
    return turns.filter(include).map(e => toItem(e, false, false));
  }

  const start = displayStart(turns, turn, grouped);
  const currentRun = grouped ? runOf.get(turns[turn]?.id) : null;
  const isCurrent = (entry, index) => (index === turn) || ((currentRun != null) && (runOf.get(entry.id) === currentRun));

  const upcoming = [];
  for ( let i = start; i < turns.length; i++ ) {
    if ( include(turns[i]) ) upcoming.push(toItem(turns[i], false, isCurrent(turns[i], i)));
  }
  const acted = [];
  for ( let i = 0; i < start; i++ ) {
    if ( include(turns[i]) ) acted.push(toItem(turns[i], true, false));
  }

  const items = [...upcoming];
  if ( acted.length || upcoming.length ) {
    items.push({ type: "divider", key: "divider", round: round + 1 });
  }
  items.push(...acted);
  return items;
}
