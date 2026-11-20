/**
 * Alert's Initiative Swap in a live combat: who may swap with whom, asking the ally, and the swap.
 *
 * The rules are pure (model/initiative-swap.mjs). As with group turns, only the active GM ever
 * writes: a player's request is a query to that GM (core's User#query, which tells the handler who
 * sent it), and the GM re-checks everything against the live combat. When the ally must agree, the
 * GM asks the ally's player with a second query, so the GM's client stays the one place that
 * decides, and the swap is a single update of both combatants.
 */

import { MODULE_ID, settings, t } from "../config.mjs";
import { canSwap, consentUser, swapAllies } from "../model/initiative-swap.mjs";
import { showsInitiative } from "../model/visibility.mjs";
import { adapterFor } from "../systems/adapter.mjs";
import { runSideOf } from "./facts.mjs";

export const SWAP_QUERY = `${MODULE_ID}.swapInitiative`;
export const CONSENT_QUERY = `${MODULE_ID}.swapConsent`;

/** How long the ally's player has to answer. No answer counts as no. */
export const CONSENT_TIMEOUT_MS = 60_000;

/** The requester waits for the GM, who may be waiting for the ally: longer than both. */
const REQUEST_TIMEOUT_MS = CONSENT_TIMEOUT_MS + 15_000;

/** The consent window closes this long before the GM stops waiting, so a late answer still lands. */
const CONSENT_MARGIN_MS = 2_000;

/** Combatants in a swap that is waiting for an answer (GM side). One swap at a time each. */
const waiting = new Set();

/** Register both query handlers. Called at init, on every client. */
export function registerSwapQueries() {
  CONFIG.queries[SWAP_QUERY] = (data, { user }) => handleSwapRequest(data, user);
  // Only a GM's client asks for consent; anyone else's question is ignored.
  CONFIG.queries[CONSENT_QUERY] = (data, { user, timeout }) => (user?.isGM ? showConsent(data, { timeout }) : false);
}

/**
 * The facts the swap rules need about one combatant.
 * @param {Combatant} combatant
 * @returns {import("../model/initiative-swap.mjs").SwapFacts}
 */
export function swapFacts(combatant) {
  const adapter = adapterFor(game.system.id);
  const actor = combatant.actor;
  return {
    id: combatant.id,
    side: runSideOf(combatant),
    initiative: combatant.initiative ?? null,
    alert: !!actor && !!adapter.initiativeSwap?.(actor),
    incapacitated: !!actor && !!adapter.incapacitated?.(actor),
    defeated: !!combatant.isDefeated
  };
}

/**
 * The allies this user could swap the combatant's initiative with now, in turn order. Empty when
 * the combatant can't swap, or isn't this user's to swap.
 * @param {Combatant} combatant
 * @param {User} [user]
 * @returns {Combatant[]}
 */
export function swapTargets(combatant, user = game.user) {
  const combat = combatant?.combat;
  if ( !combat || !(user.isGM || combatant.testUserPermission(user, "OWNER")) ) return [];
  const swapper = swapFacts(combatant);
  if ( !swapper.alert ) return [];
  const ids = new Set(swapAllies({ started: combat.started, swapper, others: combat.turns.map(swapFacts) })
    .map(f => f.id));
  // A player isn't offered an ally the GM is keeping off their bar.
  return combat.turns.filter(c => ids.has(c.id) && (user.isGM || !c.hidden));
}

/**
 * The menu label for swapping with this ally, with their initiative if this user may see it.
 * @param {Combatant} ally
 * @returns {string}
 */
export function swapLabel(ally) {
  const name = ally.name;
  if ( !seesInitiative(ally, game.user) ) return t("swap.swapWith", { name });
  return t("swap.swapWithInitiative", { name, initiative: formatInitiative(ally.initiative) });
}

/**
 * Ask the active GM to swap the two combatants' initiative.
 * @param {Combatant} swapper  The one with Alert.
 * @param {Combatant} ally
 * @returns {Promise<boolean>}  Whether they were swapped.
 */
export async function requestSwap(swapper, ally) {
  const gm = game.users.activeGM;
  if ( !gm ) {
    ui.notifications.warn(t("swap.noGM"));
    return false;
  }
  const data = { combatId: swapper.combat.id, swapperId: swapper.id, allyId: ally.id };
  let result;
  if ( gm.isSelf ) result = await handleSwapRequest(data, game.user);
  else {
    // The query throws if it times out, the GM drops, or this user's role may not query users.
    try {
      result = await gm.query(SWAP_QUERY, data, { timeout: REQUEST_TIMEOUT_MS });
    } catch ( err ) {
      console.warn(`${MODULE_ID} |`, err);
      ui.notifications.warn(t("swap.failed"));
      return false;
    }
  }
  switch ( result ) {
    case "done": return true;
    case "declined": ui.notifications.info(t("swap.declined", { ally: ally.name })); break;
    case "busy": ui.notifications.warn(t("swap.busy")); break;
    default: ui.notifications.warn(t("swap.unavailable"));
  }
  return false;
}

/**
 * The GM's side. Re-derives everything from the live combat rather than trusting the request,
 * and again after waiting for the ally, since anything may have changed meanwhile.
 * @param {{combatId: string, swapperId: string, allyId: string}} data
 * @param {User} user  Who asked (from core's query context, not from the payload).
 * @returns {Promise<"done"|"declined"|"busy"|"invalid">}
 */
export async function handleSwapRequest({ combatId, swapperId, allyId } = {}, user) {
  if ( !game.users.activeGM?.isSelf || !user ) return "invalid";
  const found = lookup({ combatId, swapperId, allyId });
  if ( !found ) return "invalid";
  if ( !user.isGM && !found.swapper.testUserPermission(user, "OWNER") ) return "invalid";
  if ( waiting.has(swapperId) || waiting.has(allyId) ) return "busy";

  const before = { swapper: found.swapper.initiative, ally: found.ally.initiative };
  waiting.add(swapperId);
  waiting.add(allyId);
  try {
    if ( settings().allySwapConsent && !(await allyAgrees(user, found.ally, { combatId, swapperId, allyId })) ) {
      return "declined";
    }
    const now = lookup({ combatId, swapperId, allyId });
    if ( !now || (now.swapper.initiative !== before.swapper) || (now.ally.initiative !== before.ally) ) return "invalid";
    await now.combat.updateEmbeddedDocuments("Combatant", [
      { _id: swapperId, initiative: before.ally },
      { _id: allyId, initiative: before.swapper }
    ]);
    await announce(now.swapper, now.ally);
    return "done";
  } finally {
    waiting.delete(swapperId);
    waiting.delete(allyId);
  }
}

/**
 * The two combatants, if they're still in the combat and may swap.
 * @returns {{combat: Combat, swapper: Combatant, ally: Combatant}|null}
 */
function lookup({ combatId, swapperId, allyId }) {
  const combat = game.combats.get(combatId);
  const swapper = combat?.combatants.get(swapperId);
  const ally = combat?.combatants.get(allyId);
  if ( !swapper || !ally ) return null;
  return canSwap({ started: combat.started, swapper: swapFacts(swapper), ally: swapFacts(ally) })
    ? { combat, swapper, ally } : null;
}

/**
 * Ask whoever answers for the ally: their player, or the GM when no player of theirs is connected.
 * A question that fails or goes unanswered is a no.
 * @param {User} requester
 * @param {Combatant} ally
 * @param {object} data  The ids, for the consent window.
 * @returns {Promise<boolean>}
 */
async function allyAgrees(requester, ally, data) {
  const owners = game.users.filter(u => !u.isGM && ally.testUserPermission(u, "OWNER")).map(u => ({
    id: u.id,
    active: !!u.active,
    isCharacter: !!ally.actor && (u.character?.id === ally.actor.id)
  }));
  const targetId = consentUser({ requesterId: requester.id, owners, gmId: game.users.activeGM?.id ?? null });
  if ( !targetId ) return true;
  const target = game.users.get(targetId);
  if ( !target ) return false;
  if ( target.isSelf ) return showConsent(data);
  try {
    return (await target.query(CONSENT_QUERY, data, { timeout: CONSENT_TIMEOUT_MS })) === true;
  } catch ( err ) {
    console.warn(`${MODULE_ID} |`, err);
    return false;
  }
}

/**
 * The ally's side: a Yes / No window. It closes itself just before the GM stops waiting, which
 * counts as no.
 * @param {{combatId: string, swapperId: string, allyId: string}} data
 * @param {{timeout?: number}} [options]  The asking GM's timeout, from core's query context.
 * @returns {Promise<boolean>}
 */
export async function showConsent({ combatId, swapperId, allyId } = {}, { timeout = CONSENT_TIMEOUT_MS } = {}) {
  const combat = game.combats.get(combatId);
  const swapper = combat?.combatants.get(swapperId);
  const ally = combat?.combatants.get(allyId);
  if ( !swapper || !ally ) return false;

  const esc = value => Handlebars.escapeExpression(String(value ?? ""));
  const names = { swapper: `<strong>${esc(swapper.name)}</strong>`, ally: `<strong>${esc(ally.name)}</strong>` };
  let content = `<p>${t("swap.consent", names)}</p>`;
  if ( seesInitiative(swapper, game.user) && seesInitiative(ally, game.user) ) {
    content += `<p>${t("swap.consentNumbers", { ...names,
      swapperInitiative: formatInitiative(swapper.initiative), allyInitiative: formatInitiative(ally.initiative) })}</p>`;
  }

  let dialog = null;
  const timer = setTimeout(() => dialog?.close(), Math.max((timeout ?? CONSENT_TIMEOUT_MS) - CONSENT_MARGIN_MS, 1000));
  try {
    const answer = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("swap.consentTitle"), icon: "fa-solid fa-right-left" },
      content,
      render: (_event, app) => { dialog = app; }
    });
    return answer === true;
  } finally {
    clearTimeout(timer);
  }
}

/** Tell the table, without the numbers: the bar shows those to whoever may see them. */
async function announce(swapper, ally) {
  const esc = value => Handlebars.escapeExpression(String(value ?? ""));
  await ChatMessage.create({
    content: `<p>${t("swap.done", { swapper: `<strong>${esc(swapper.name)}</strong>`,
      ally: `<strong>${esc(ally.name)}</strong>` })}</p>`,
    speaker: { alias: t("title") }
  });
}

/** Whether this user sees a combatant's initiative on the bar. */
function seesInitiative(combatant, user) {
  return showsInitiative(settings(), {
    isGM: user.isGM,
    isOwner: combatant.testUserPermission(user, "OWNER"),
    canObserve: !!combatant.actor?.testUserPermission(user, "OBSERVER")
  });
}

/** An initiative as the bar shows it: only the decimals it has. */
function formatInitiative(value) {
  return String(Number(Number(value).toFixed(CONFIG.Combat?.initiative?.decimals ?? 0)));
}
