# Changelog

All notable changes to Simple Combat Bar.

## 0.4.0

### New

- **Show or hide the bar from the keyboard.** A new **Toggle Combat Bar** keybinding switches the
  *Show the Combat Bar* setting for you alone. It has no key by default; pick one in Configure
  Controls.

### Fixed

- **The initiative roll window's roll mode is kept.** Choosing *Private GM Roll* (or any other mode)
  in the roll window now posts the roll that way, instead of in the default mode.
- **Reroll Initiative from the right-click menu** opens the roll window too, when the *Initiative
  Roll Window* setting asks for one.
- **Portrait styles from other modules** now appear in the *Portrait Style* setting.
- **Grouped turns update when a late arrival comes in**, even if the arrival stays hidden.
- **Pressing Enter on a button inside a portrait** presses the button, rather than panning to the
  token.
- **A group turn change that doesn't reach the GM** now tells the player so, instead of silently doing
  nothing.
- **Pan To** is only offered in the right-click menu when it works: for combatants you can observe.
- **Saving Configure Trackers keeps D&D 5e's labels translatable.** An unedited label such as
  *Armor Class* is stored as its translation key again, not as fixed English text.
- **Action pips are spent even when the bar is hidden.** A player who turned the bar off, or a GM
  looking at another encounter in the sidebar, used to stop their abilities spending pips.
- **Arrives in Round… hides the creature's token** until it arrives, so players don't see on the map
  what the bar keeps from them. It's revealed again when it arrives, as before.
- **Shift- or Ctrl-clicking Reroll Initiative** in the right-click menu skips the roll window, like
  the d20 does.
- **Shift+M and Shift+N only act when there's a turn to change.** Outside combat (or, for Shift+M,
  when it isn't your turn) the keys are left for other modules' shortcuts instead of being swallowed.
- **An initiative roll still lands if the bar moves to another encounter** while the roll window is
  open.
- **Screen readers** now name the action pips (and say whether each is spent), the legendary
  counters and the d20.
- The *Fill Portraits With Damage* hint said the fill rises from the top; it rises from the bottom.
- No more Foundry v14 deprecation warnings from the right-click menu.

## 0.3.0

### New

- **XP summary when combat ends.** Turn on *XP Summary When Combat Ends* and ending a combat
  whispers the GM a card listing the defeated enemies and their total XP, with D&D 5e's Award
  button to hand it out (the same as typing `/award`). The players' own creatures and friendly NPCs
  aren't counted. Off by default.

### Changed

- **Observers see names.** A player with Observer permission on a creature now sees its name on the
  bar, whatever the name setting, just as its owner does.

## 0.2.0

### New

- **Late arrivals.** Right-click a portrait and choose **Arrives in Round…** to have a combatant
  join a fight part-way through, such as a monster erupting on count 0 of round 2. Until then its
  turns are skipped and players don't see it. When its turn comes in that round, it and its token are
  revealed, and the GM gets a whisper. Add Event takes an arrival round too.

### Changed

- **D&D 5e's calendar always steps aside** while the bar shows a combat, from rolling initiative
  until the combat ends. It's no longer a setting.

## 0.1.0 — First Release

### New

- **A turn-order bar across the top of the screen**, in the style of Baldur's Gate 3. The combatant
  acting now comes first, then everyone still to act this round, a divider for the next round, and
  then those who have already acted. The bar hangs from the top edge, with the round and an **End
  Turn** button in a tab beneath it.
- **Portrait cards or medallions.** Tall cards by default, or round medallions, chosen in the
  settings. The acting combatant's card is larger, and portraits fill with red from the bottom as
  hit points are lost.
- **What players see.** Players see the bar as soon as a combat exists, so they can roll
  initiative before it starts. Names follow each token's own name setting. Players see exact hit
  points for their own characters; for enemies they see only how wounded they are, taken from
  D&D 5e's Bloodied and Dead conditions, because Foundry doesn't send players an unlinked token's
  hit points. Enemy initiative can be hidden, and enemies can be revealed only once they've acted.
- **Action pips.** The acting combatant's card shows their Action, Bonus Action and Reaction, and
  every other card its Reaction. Using an ability spends the pip it needs, the owner or GM can click
  one to flip it, and they come back at the start of the combatant's turn. midi-qol, when active,
  keeps track instead and the pips follow it; with BG3 Inspired HUD and no midi-qol, used Bonus
  Actions and Reactions are marked the way midi-qol marks them, so the HUD greys them out too.
- **Initiative roll window.** Choose who gets D&D 5e's roll window, with advantage and
  disadvantage, when they press their card's d20: nobody, NPCs, players, or everyone.
- **Group turns.** Optional and off by default: allies or enemies next to each other in the order
  share one turn, as in Baldur's Gate 3. Any of them can act, in any order, by clicking their
  portrait; each ends their own part, and the turn moves on when all of them are done.
- **Add Event.** Put timed events into the initiative order, with a duration in rounds. They count
  down on their card and are removed when their time is up, with a whisper to the GM. Recent events
  are kept as one-click presets.
- **Status effect icons** on each card, the same ones the token shows, each in a ring that drains
  as its duration runs out. The owner or GM can right-click one to remove it.
- **Legendary badges.** Legendary actions and resistances left, on legendary creatures' cards. Click
  to spend one, Shift-click to give it back.
- **Configure Trackers.** A second bar under the hit points for any resource with a maximum, and
  your choice of values in the hover tooltip. D&D 5e worlds start with armor class, speed, spell DC
  and passive Perception.
- **The hover tooltip** shows hit points, the chosen values, and every effect with its time left
  and its description, with links and embedded content shown as they read on the effect's sheet.
- **GM controls** as tabs on either end of the bar, drawn like the D&D 5e sheet's, and a right-click
  menu on every portrait.
- **Keeps out of the way.** The sidebar can collapse when combat starts, and D&D 5e's calendar hides
  while a combat is running. Both are settings.
- **Fits the window.** Portraits shrink to fit a crowded fight, then the bar scrolls sideways.
- **Light over a long session.** One bar for the whole session; portraits are updated rather than
  rebuilt, and nothing is left in memory when a combat ends.

### Requirements

- Foundry VTT v14 and D&D 5e 6.0 or later. Verified on Foundry 14.368 and D&D 5e 6.0.5.
- Can't be used alongside Carousel Combat Tracker, which draws the same bar in the same place.
