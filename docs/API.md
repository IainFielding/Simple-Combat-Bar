# Simple Combat Bar — API

Everything here is available once Foundry's `init` hook has run:

```js
const api = game.modules.get("sogrom-simple-combat-bar")?.api;
```

## Properties and functions

| Member | Description |
| --- | --- |
| `api.bar` | The session's `CombatBar` instance, or `null` before `ready` (and if the bar is standing down because combat-tracker-dock is active). |
| `api.stats` | Render counters: `{ flushes, patches, creates, removes, moves }`. Handy for checking that your own module isn't causing extra renders. |
| `api.refresh()` | Ask the bar to re-derive every portrait on its next frame. You rarely need this: the bar listens to document updates itself. |
| `api.registerAdapter(adapter)` | Teach the bar about a game system. See *System adapters*. |
| `api.registerPortraitStyle(style)` | Add a portrait style that GMs can choose in the settings. See *Portrait styles*. |
| `api.HOOKS` | The hook names below, as constants. |

## Hooks

| Hook | Arguments | When |
| --- | --- | --- |
| `simpleCombatBar.init` | `api` | During Foundry's `init`, after settings are registered. Register adapters and portrait styles here; the bar reads your adapter's `defaultAttributes` straight after. |
| `simpleCombatBar.ready` | `api` | During Foundry's `ready`, after the bar is created and bound. |
| `simpleCombatBar.bind` | `bar, combat` | The bar starts showing a combat. |
| `simpleCombatBar.unbind` | `bar, combat` | The bar stops showing a combat. |
| `simpleCombatBar.renderPortrait` | `model, element, changed` | A portrait was created or patched. `changed` lists the model fields that changed. Add your own decorations to `element` here; patches never re-create it, so anything you add stays until the combatant leaves the bar, the portrait style changes, or the bar switches to another combat. |

Hook names are part of the API. Renaming one is a breaking change, which is why the test suite
asserts them literally.

## System adapters

An adapter tells the bar how to read a game system's actors. Any member you leave out falls back to
the generic adapter, which reads HP from the system's primary token bar.

```js
Hooks.once("simpleCombatBar.init", api => {
  api.registerAdapter({
    id: "my-system",
    describe: actor => `Rank ${actor.system.rank}`,
    hp: actor => ({ value: actor.system.health.value, max: actor.system.health.max, temp: null }),
    // Top-level `system` keys whose changes should refresh a portrait. Return null to refresh on
    // every actor update.
    watchedPaths: () => new Set(["health", "rank"]),
    // Optional: coarse health from data every user receives (statuses), for viewers who can't
    // observe the actor and so never receive its HP. "healthy" | "bloodied" | "down".
    healthState: actor => (actor.statuses.has("dead") ? "down" : "healthy"),
    // Optional: a readable name for an attribute path, used in Configure Trackers and tooltips.
    attributeLabel: path => null,
    // Optional: the tooltip values a new world starts with.
    defaultAttributes: () => [{ attr: "rank", label: "Rank", icon: "fa-solid fa-star" }],
    // Optional: show the system's initiative dialog and prepare the next initiative roll. Resolve
    // to options for Combat#rollInitiative (e.g. the dialog's { messageMode }), or false if the
    // user cancels. clearInitiative drops the prepared roll afterwards.
    configureInitiative: async (actor, event) => ({}),
    clearInitiative: actor => {},
    // Optional: legendary counters for the card's badges, and spending (+1) or giving back (-1)
    // one when a badge is clicked. Return null for a kind the creature doesn't have.
    legendary: actor => ({ actions: { value: 2, max: 3 }, resistances: null }),
    adjustLegendary: async (actor, kind, delta) => {},
    // Optional: the XP summary. xp returns what defeating this actor is worth (null for none);
    // awardCommand returns chat text the GM can use to hand out the total.
    xp: actor => actor.system.xp ?? null,
    awardCommand: total => `/award ${total}`
  });
});
```

## Portrait styles

A style supplies markup and CSS; the bar supplies the data. The markup must contain elements marked
`data-slot="img"`, `"initiative"`, `"hp"`, `"name"` and `"damage"`. It may also contain:

- `"bar2"`: the second tracker bar.
- `"rounds"`: an event's rounds left.
- `"arrives"`: the round a late arrival comes in, shown to the GM; the portrait also gets `is-waiting`.
- `"effects"`: an empty list the bar fills with status effect icons.
- `"pips"`: holding `.scb-pip` buttons with `data-action="togglePip"` and `data-pip="action"`,
  `"bonus"` or `"reaction"`.
- `"legendary"`: holding `.scb-leg` buttons with `data-action="legendary"`, `data-kind="actions"` or
  `"resistances"`, and a `<span>` for the count.
- A `data-action="rollInitiative"` button.

The bar skips any it doesn't find. The built-in styles' markup in `scripts/ui/portrait-styles.mjs` is
the reference for all of them. Scope your stylesheet under `.scb-root[data-style="<id>"]`.

```js
Hooks.once("simpleCombatBar.init", api => {
  api.registerPortraitStyle({
    id: "shield",
    label: "MYMODULE.ShieldStyle",
    aspect: 1.2,
    markup: `
      <div class="scb-frame">
        <img class="scb-img" data-slot="img" alt="">
        <div class="scb-damage" data-slot="damage"></div>
      </div>
      <span class="scb-init" data-slot="initiative"></span>
      <div class="scb-hp" data-slot="hp"><div class="scb-hp-fill"></div><div class="scb-hp-temp"></div></div>
      <span class="scb-name" data-slot="name"></span>`
  });
});
```
