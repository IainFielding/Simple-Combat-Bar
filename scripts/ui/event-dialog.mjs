/**
 * The Add Event dialog: name, initiative, duration, arrival round, image, hidden, plus the GM's
 * recent events as one-click presets.
 */

import { MODULE_ID, t } from "../config.mjs";
import { DEFAULT_EVENT_IMG, normaliseEvent } from "../model/events.mjs";

/**
 * Ask for an event and add it to the bar's combat.
 * @param {import("./combat-bar.mjs").CombatBar} bar
 * @returns {Promise<Combatant|null>}
 */
export async function openEventDialog(bar) {
  if ( !game.user.isGM || !bar.combat ) return null;
  const recent = game.settings.get(MODULE_ID, "recentEvents") ?? [];
  const esc = value => Handlebars.escapeExpression(String(value ?? ""));
  const field = (label, input, hint = "") => `
    <div class="form-group">
      <label>${label}</label>
      <div class="form-fields">${input}</div>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
    </div>`;

  const chips = recent.length ? `
    <div class="scb-event-recent">
      <span class="scb-event-recent-label">${t("events.recent")}</span>
      <div class="scb-event-chips">${recent.map((e, i) => `
        <button type="button" class="scb-event-chip" data-index="${i}">
          <img src="${esc(e.img || DEFAULT_EVENT_IMG)}" alt=""><span>${esc(e.name)}</span>
        </button>`).join("")}
      </div>
    </div>` : "";

  const content = `
    <div class="scb-event-form">
      ${chips}
      ${field(t("events.fields.name"), `<input type="text" name="name" required autofocus>`)}
      ${field(t("events.fields.initiative"), `<input type="number" name="initiative" step="any" value="20" required>`,
    t("events.fields.initiativeHint"))}
      ${field(t("events.fields.duration"), `<input type="number" name="duration" min="0" step="1" placeholder="${
    esc(t("events.fields.untilRemoved"))}">`, t("events.fields.durationHint"))}
      ${field(t("events.fields.arrivesRound"), `<input type="number" name="arrivesRound" min="${
    Math.max(bar.combat.round, 1)}" step="1" placeholder="${esc(t("events.fields.now"))}">`, t("events.fields.arrivesRoundHint"))}
      ${field(t("events.fields.img"), `<file-picker name="img" type="image" value="${DEFAULT_EVENT_IMG}"></file-picker>`)}
      ${field(t("events.fields.hidden"), `<input type="checkbox" name="hidden">`, t("events.fields.hiddenHint"))}
    </div>`;

  const form = await foundry.applications.api.DialogV2.input({
    window: { title: t("events.title"), icon: "fa-solid fa-hourglass-half" },
    classes: ["scb-event-dialog"],
    position: { width: 440 },
    content,
    ok: { label: t("events.add"), icon: "fa-solid fa-plus" },
    render: (_event, dialog) => {
      // Listeners live on the dialog's own elements and go with it when it closes.
      dialog.element.querySelectorAll(".scb-event-chip").forEach(chip => chip.addEventListener("click", () => {
        const preset = recent[Number(chip.dataset.index)];
        if ( !preset ) return;
        const set = (name, value) => {
          const input = dialog.element.querySelector(`[name="${name}"]`);
          if ( input ) input.value = value ?? "";
        };
        set("name", preset.name);
        set("initiative", preset.initiative);
        set("duration", preset.duration ?? "");
        set("img", preset.img || DEFAULT_EVENT_IMG);
        const hidden = dialog.element.querySelector('[name="hidden"]');
        if ( hidden ) hidden.checked = !!preset.hidden;
      }));
    }
  });
  if ( !form ) return null;

  const { data, error } = normaliseEvent(form, bar.combat.round);
  if ( error ) {
    ui.notifications.error(t(`events.errors.${error}`));
    return null;
  }
  return bar.addEvent(data);
}
