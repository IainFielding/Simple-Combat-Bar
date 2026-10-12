/**
 * The settings submenus: one small window per group in config.mjs's SETTING_GROUPS, opened from the
 * module's settings. Each row is drawn from the setting's own registration, so a setting moves
 * between the list and a window by changing the table alone.
 */

import { MODULE_ID, SETTING_GROUPS } from "../config.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * The window for one group. `registerMenu` takes a class, so each group gets its own.
 * @param {string} groupId  A key of SETTING_GROUPS.
 * @returns {typeof ApplicationV2}
 */
export function settingsGroupApp(groupId) {
  const group = SETTING_GROUPS[groupId];

  return class SettingsGroupConfig extends ApplicationV2 {

    static DEFAULT_OPTIONS = {
      id: `scb-settings-${groupId}`,
      tag: "form",
      classes: ["scb-settings-group"],
      window: {
        title: `${MODULE_ID}.settings.groups.${groupId}.title`,
        icon: group.icon,
        contentClasses: ["standard-form"]
      },
      position: { width: 560, height: "auto" },
      form: { handler: SettingsGroupConfig.#onSubmit, closeOnSubmit: true }
    };

    /** The group's settings this user may change, as registered. */
    static #settings() {
      return group.keys.map(key => game.settings.settings.get(`${MODULE_ID}.${key}`))
        .filter(s => s && ((s.scope !== "world") || game.user.isGM));
    }

    /** @override */
    async _prepareContext() {
      return {
        rows: SettingsGroupConfig.#settings().map(s => ({
          key: s.key,
          name: game.i18n.localize(s.name),
          hint: game.i18n.localize(s.hint),
          type: s.type,
          range: s.range ?? null,
          choices: s.choices ? Object.entries(s.choices).map(([value, label]) =>
            ({ value, label: game.i18n.localize(label) })) : null,
          value: game.settings.get(MODULE_ID, s.key)
        }))
      };
    }

    /** @override */
    async _renderHTML(context) {
      const esc = value => Handlebars.escapeExpression(String(value ?? ""));
      const input = row => {
        const id = `scb-setting-${row.key}`;
        if ( row.choices ) {
          return `<select id="${id}" name="${row.key}">${row.choices.map(c =>
            `<option value="${esc(c.value)}"${c.value === String(row.value) ? " selected" : ""}>${esc(c.label)}</option>`)
            .join("")}</select>`;
        }
        if ( row.type === Boolean ) {
          return `<input type="checkbox" id="${id}" name="${row.key}"${row.value ? " checked" : ""}>`;
        }
        const range = row.range ? ` min="${row.range.min}" max="${row.range.max}" step="${row.range.step}"` : "";
        return `<input type="${row.type === Number ? "number" : "text"}" id="${id}" name="${row.key}"`
          + ` value="${esc(row.value)}"${range}>`;
      };
      const rows = context.rows.map(row => `
        <div class="form-group" data-setting="${row.key}">
          <label for="scb-setting-${row.key}">${esc(row.name)}</label>
          <div class="form-fields">${input(row)}</div>
          <p class="hint">${esc(row.hint)}</p>
        </div>`).join("");
      return `${rows}
        <footer class="form-footer">
          <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(game.i18n.localize("SETTINGS.Save"))}</button>
        </footer>`;
    }

    /** @override */
    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    /** @override */
    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#syncRequired();
    }

    /** @override */
    _onChangeForm(formConfig, event) {
      super._onChangeForm(formConfig, event);
      this.#syncRequired();
    }

    /** Disable each row that depends on a setting which is switched off in this form. */
    #syncRequired() {
      for ( const [key, needs] of Object.entries(group.requires ?? {}) ) {
        const field = this.element.querySelector(`[name="${key}"]`);
        const needed = this.element.querySelector(`[name="${needs}"]`);
        if ( field && needed ) field.disabled = !needed.checked;
      }
    }

    /** Save what changed. Each setting's own onChange refreshes the bar. A disabled row isn't submitted. */
    static async #onSubmit(_event, _form, formData) {
      const data = formData.object;
      for ( const setting of SettingsGroupConfig.#settings() ) {
        if ( !(setting.key in data) ) continue;
        const value = setting.type === Number ? Number(data[setting.key]) : data[setting.key];
        if ( value !== game.settings.get(MODULE_ID, setting.key) ) await game.settings.set(MODULE_ID, setting.key, value);
      }
    }
  };
}
