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
| `simpleCombatBar.init` | `api` | During Foundry's `init`, after settings are registered. Register adapters and portrait styles here. |
| `simpleCombatBar.ready` | `api` | During Foundry's `ready`, after the bar is created and bound. |
| `simpleCombatBar.bind` | `bar, combat` | The bar starts showing a combat. |
| `simpleCombatBar.unbind` | `bar, combat` | The bar stops showing a combat. |
| `simpleCombatBar.renderPortrait` | `model, element, changed` | A portrait was created or patched. `changed` lists the model fields that changed. Add your own decorations to `element` here; the bar never re-creates it, so anything you add stays until the combatant leaves the bar. |

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
    watchedPaths: () => new Set(["health", "rank"])
  });
});
```

## Portrait styles

A style supplies markup and CSS; the bar supplies the data. The markup must contain elements marked
`data-slot="img"`, `"initiative"`, `"hp"`, `"name"` and `"damage"`, and may contain a
`data-action="rollInitiative"` button. Scope your stylesheet under `.scb-root[data-style="<id>"]`.

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
