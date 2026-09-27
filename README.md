# Simple Combat Bar

A Baldur's Gate 3 style turn-order bar for Foundry VTT, built for D&D 5e.

The current combatant sits first on the bar, followed by everyone still to act this round, a
"next round" divider, and then those who have already acted. Allies and enemies who act one after
another share a frame, as in BG3. Portraits fill red as hit points are lost, and players only ever
see as much of an enemy's health as the GM allows.

It is a from-scratch replacement for
[Carousel Combat Tracker](https://github.com/theripper93/combat-tracker-dock), written to stay light
over a long session: one bar for the whole session, no rebuilt portraits, and nothing left behind
when a combat ends. The two modules conflict; enable one or the other.

## Requirements

- Foundry VTT v14
- D&D 5e 6.x for the full feature set. Other systems get a working bar through a generic adapter.

## Settings

Everything is under **Game Settings → Configure Settings → Simple Combat Bar**: portrait style
(round medallion or tall card), portrait size, how much players see of names, hit points and
initiative, the red damage fill, group turns, and whether the sidebar collapses when combat starts.

## For developers

See [docs/API.md](docs/API.md) for hooks, system adapters and portrait styles, and
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and commit conventions.

```sh
npm install
npm run check        # JSON validation, lint, unit tests
cd test-e2e && npm install && npm run provision && npm test   # local end-to-end, needs Foundry
```

## Licence

Free for personal use; see [LICENSE](LICENSE). Dungeons & Dragons is a trademark of Wizards of the
Coast; this is an unofficial fan-made module.
