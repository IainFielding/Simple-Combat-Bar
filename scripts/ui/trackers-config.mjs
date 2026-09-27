/**
 * "Configure Trackers": the optional second bar under each portrait, and the values shown in a
 * portrait's hover tooltip. Opened from the module's settings.
 */

import { MODULE_ID, invalidateSettings, t } from "../config.mjs";
import { normaliseAttributes, safeColor } from "../model/trackers.mjs";
import { adapterFor } from "../systems/adapter.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class TrackersConfig extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id: "scb-trackers-config",
    tag: "form",
    classes: ["scb-trackers-config"],
    window: {
      title: "sogrom-simple-combat-bar.trackers.title",
      icon: "fa-solid fa-bars-progress",
      contentClasses: ["standard-form"]
    },
    position: { width: 600, height: "auto" },
    form: { handler: TrackersConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      addRow: TrackersConfig.#onAddRow,
      removeRow: TrackersConfig.#onRemoveRow
    }
  };

  /**
   * Everything being edited — the second bar, its colour and the tooltip rows — kept across
   * re-renders, so adding or removing a row doesn't throw away unsaved choices.
   */
  #draft = null;

  /** @override */
  async _prepareContext() {
    this.#draft ??= {
      rows: foundry.utils.deepClone(game.settings.get(MODULE_ID, "tooltipAttributes") ?? []),
      secondary: game.settings.get(MODULE_ID, "secondaryResource"),
      color: game.settings.get(MODULE_ID, "secondaryColor")
    };
    const tracked = TokenDocument.implementation.getTrackedAttributes();
    const bars = new Set(tracked.bar.map(p => p.join(".")));
    // Core labels these with their paths; the system adapter knows their names.
    const adapter = adapterFor(game.system.id);
    const choices = TokenDocument.implementation.getTrackedAttributeChoices(tracked).map(c => {
      const name = adapter.attributeLabel?.(c.value);
      return { ...c, label: name ? `${name} (${c.value})` : c.value };
    }).sort((a, b) => a.label.localeCompare(b.label));
    return {
      rows: this.#draft.rows,
      barChoices: choices.filter(c => bars.has(c.value)),
      allChoices: choices,
      secondary: this.#draft.secondary,
      color: this.#draft.color
    };
  }

  /** @override */
  async _renderHTML(context) {
    const esc = value => Handlebars.escapeExpression(String(value ?? ""));
    const barOptions = [`<option value="">${esc(t("trackers.none"))}</option>`,
      ...context.barChoices.map(c => `<option value="${esc(c.value)}"${c.value === context.secondary ? " selected" : ""}>${
        esc(c.label)}</option>`)].join("");
    const datalist = context.allChoices.map(c => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join("");
    const rows = context.rows.map((r, i) => `
      <li class="scb-tracker-row" data-index="${i}">
        <input type="text" name="rows.${i}.attr" value="${esc(r.attr)}" list="scb-tracker-paths"
          placeholder="${esc(t("trackers.attr"))}" aria-label="${esc(t("trackers.attr"))}">
        <input type="text" name="rows.${i}.label" value="${esc(game.i18n.localize(r.label ?? ""))}"
          placeholder="${esc(t("trackers.label"))}" aria-label="${esc(t("trackers.label"))}">
        <input type="text" name="rows.${i}.icon" value="${esc(r.icon)}"
          placeholder="fa-solid fa-shield" aria-label="${esc(t("trackers.icon"))}">
        <i class="scb-tracker-preview ${esc(r.icon || "fa-solid fa-circle-info")}" aria-hidden="true"></i>
        <button type="button" class="icon fa-solid fa-trash" data-action="removeRow" data-index="${i}"
          data-tooltip="${esc(t("trackers.remove"))}" aria-label="${esc(t("trackers.remove"))}"></button>
      </li>`).join("");

    return `
      <fieldset>
        <legend>${esc(t("trackers.secondary"))}</legend>
        <p class="hint">${esc(t("trackers.secondaryHint"))}</p>
        <div class="form-group">
          <label for="scb-secondary">${esc(t("trackers.attr"))}</label>
          <div class="form-fields"><select id="scb-secondary" name="secondaryResource">${barOptions}</select></div>
        </div>
        <div class="form-group">
          <label for="scb-secondary-color">${esc(t("trackers.color"))}</label>
          <div class="form-fields">
            <color-picker id="scb-secondary-color" name="secondaryColor" value="${esc(context.color)}"></color-picker>
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>${esc(t("trackers.tooltip"))}</legend>
        <p class="hint">${esc(t("trackers.tooltipHint"))}</p>
        <datalist id="scb-tracker-paths">${datalist}</datalist>
        <ol class="scb-tracker-rows">${rows}</ol>
        <button type="button" data-action="addRow"><i class="fa-solid fa-plus"></i> ${esc(t("trackers.add"))}</button>
      </fieldset>
      <footer class="form-footer">
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(game.i18n.localize("SETTINGS.Save"))}</button>
      </footer>`;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** Capture the form as currently filled in, so a re-render doesn't lose unsaved edits. */
  #readForm() {
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    this.#draft = {
      rows: Object.values(data.rows ?? {}),
      secondary: data.secondaryResource ?? "",
      color: data.secondaryColor ?? this.#draft?.color
    };
    return this.#draft;
  }

  static #onAddRow() {
    this.#readForm().rows.push({ attr: "", label: "", icon: "" });
    this.render();
  }

  static #onRemoveRow(_event, target) {
    this.#readForm().rows.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await game.settings.set(MODULE_ID, "tooltipAttributes", normaliseAttributes(Object.values(data.rows ?? {})));
    await game.settings.set(MODULE_ID, "secondaryResource", data.secondaryResource ?? "");
    await game.settings.set(MODULE_ID, "secondaryColor", safeColor(data.secondaryColor, "#5aa9e6"));
    invalidateSettings();
  }
}
