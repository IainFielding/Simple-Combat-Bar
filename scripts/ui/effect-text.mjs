/**
 * Effect descriptions for the tooltip, enriched the way the effect's own sheet shows them.
 *
 * A description holds enricher syntax (`@Embed[...]`, `@UUID[...]{…}`, `[[/r 1d4]]`), so it goes
 * through core's enrichHTML, relative to the effect, before being reduced to plain text. That only
 * happens when a tooltip actually opens, for that combatant's effects, and the result is kept until
 * the effect changes (spec R7): hovering the same portrait twice enriches nothing the second time.
 */

import { plainText } from "../model/effects.mjs";

/** Enriched texts by effect uuid and modified time. */
const cache = new Map();

/** Entries kept before the oldest are dropped. */
const CACHE_LIMIT = 200;

/**
 * Plain-text descriptions for the given effects, enriched.
 * @param {import("../model/effects.mjs").EffectInfo[]} effects
 * @returns {Promise<Map<string, string>>}  Keyed by effect uuid.
 */
export async function effectDescriptions(effects) {
  const texts = new Map();
  await Promise.all(effects.map(async e => {
    if ( !e.description ) return;
    const key = `${e.uuid}|${e.modified ?? ""}`;
    let text = cache.get(key);
    if ( text === undefined ) {
      text = await enrich(e);
      cache.set(key, text);
      if ( cache.size > CACHE_LIMIT ) cache.delete(cache.keys().next().value);
    }
    texts.set(e.uuid, text);
  }));
  return texts;
}

/** One description, enriched then flattened. Falls back to the raw text, tidied, if enrichment fails. */
async function enrich(effect) {
  try {
    const relativeTo = fromUuidSync(effect.uuid) ?? undefined;
    const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(effect.description, {
      relativeTo, secrets: false, rollData: relativeTo?.parent?.getRollData?.()
    });
    return plainText(html);
  } catch ( err ) {
    console.warn(err);
    return plainText(effect.description);
  }
}
