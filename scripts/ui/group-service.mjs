/**
 * BG3 group turns in a live combat: who may step in, who ends, and where the pointer goes.
 *
 * The decisions are pure (model/group-turns.mjs). What this adds is the one writer: the combat's
 * turn and the group-turn flag are only ever changed by the active GM (spec R11). A player's click
 * becomes a query to that GM (core's User#query, which tells the handler who sent it), and the GM
 * checks the player owns the combatant before acting.
 */

import { MODULE_ID, settings, t } from "../config.mjs";
import { activeRun, afterEnd, canActivate, groupState } from "../model/group-turns.mjs";
import { runSideOf } from "./facts.mjs";

export const GROUP_QUERY = `${MODULE_ID}.groupTurn`;

/** Register the GM-side handler. Called at init. */
export function registerGroupQuery() {
  CONFIG.queries[GROUP_QUERY] = (data, { user }) => handleGroupRequest(data, user);
}

/**
 * The group turn in progress, if grouping is set to BG3 and the pointer is in a team run.
 * @param {Combat} combat
 * @returns {{run: object, state: object, defeated: Set<string>}|null}
 */
export function groupContext(combat) {
  if ( (settings().groupTeams !== "bg3") || !combat?.started ) return null;
  const turns = combat.turns.map(c => ({ id: c.id, side: runSideOf(c) }));
  const run = activeRun(turns, combat.turn);
  if ( !run ) return null;
  return {
    run,
    state: groupState(combat.getFlag(MODULE_ID, "groupTurn"), run, combat.round),
    defeated: new Set(combat.turns.filter(c => c.isDefeated).map(c => c.id))
  };
}

/**
 * Ask the active GM to let a member step in ("activate") or end their part ("end").
 * @param {"activate"|"end"} action
 * @param {Combatant} combatant
 * @returns {Promise<boolean>}
 */
export async function requestGroupTurn(action, combatant) {
  const gm = game.users.activeGM;
  if ( !gm ) {
    ui.notifications.warn(t("groupTurns.noGM"));
    return false;
  }
  const data = { action, combatId: combatant.combat.id, combatantId: combatant.id };
  if ( gm.isSelf ) return handleGroupRequest(data, game.user);
  // The query throws if it times out, the GM drops, or this user's role may not query users.
  try {
    return await gm.query(GROUP_QUERY, data, { timeout: 10_000 });
  } catch ( err ) {
    console.warn(`${MODULE_ID} |`, err);
    ui.notifications.warn(t("groupTurns.failed"));
    return false;
  }
}

/**
 * The GM's side. Re-derives everything from the live combat rather than trusting the request.
 * @param {{action: string, combatId: string, combatantId: string}} data
 * @param {User} user  Who asked (from core's query context, not from the payload).
 * @returns {Promise<boolean>}
 */
export async function handleGroupRequest({ action, combatId, combatantId }, user) {
  if ( !game.users.activeGM?.isSelf ) return false;
  const combat = game.combats.get(combatId);
  const ctx = groupContext(combat);
  const combatant = combat?.combatants.get(combatantId);
  if ( !ctx || !combatant ) return false;
  if ( !user.isGM && !combatant.testUserPermission(user, "OWNER") ) return false;

  const currentId = combat.combatant?.id;
  const indexOf = id => combat.turns.findIndex(c => c.id === id);
  const flag = `flags.${MODULE_ID}.groupTurn`;

  if ( action === "activate" ) {
    if ( !canActivate({ ...ctx, id: combatantId, currentId }) ) return false;
    await combat.update({ turn: indexOf(combatantId), [flag]: ctx.state });
    return true;
  }

  if ( action === "end" ) {
    if ( combatantId !== currentId ) return false;
    const { ended, next } = afterEnd({ run: ctx.run, state: ctx.state, endedId: combatantId, defeated: ctx.defeated });
    const state = { ...ctx.state, ended };
    if ( "member" in next ) {
      await combat.update({ turn: indexOf(next.member), [flag]: state });
      return true;
    }
    // Everyone in the run is done. The stored state is left behind: it names this run and round,
    // so it's recognised as stale everywhere else.
    await combat.setFlag(MODULE_ID, "groupTurn", state);
    if ( next.leave >= combat.turns.length ) await combat.nextRound();
    else await combat.update({ turn: next.leave });
    return true;
  }
  return false;
}
