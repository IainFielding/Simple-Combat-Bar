import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS, HOOKS, MODULE_ID } from "../scripts/config.mjs";

/** Every file under a directory, recursively. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Split a selector list on its top-level commas only (not those inside `:is(…)`). */
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let current = "";
  for ( const ch of list ) {
    if ( ch === "(" ) depth++;
    else if ( ch === ")" ) depth--;
    if ( (ch === ",") && !depth ) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

const lang = JSON.parse(readFileSync("lang/en.json", "utf8"))[MODULE_ID];
const has = key => key.split(".").reduce((node, part) => node?.[part], lang) !== undefined;
const manifest = JSON.parse(readFileSync("module.json", "utf8"));

/**
 * lang/en.json and the code agree. A missing key doesn't throw in Foundry; it shows the raw key
 * to the player. Keys are found literally in the scripts: `t("…")` calls and full
 * `sogrom-simple-combat-bar.…` strings.
 */
describe("lang/en.json", () => {
  const scripts = walk("scripts").map(f => [f, readFileSync(f, "utf8")]);

  it("has every key the scripts use", () => {
    const missing = [];
    const full = new RegExp(`${MODULE_ID}\\.([\\w.]+[\\w])`, "g");
    for ( const [file, text] of scripts ) {
      for ( const [, key] of text.matchAll(/\bt\(\s*["`]([\w.]+)["`]/g) ) if ( !has(key) ) missing.push(`${file}: ${key}`);
      for ( const [, key] of text.matchAll(full) ) if ( !has(key) ) missing.push(`${file}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("has a name and hint for every setting, and a label for every choice", () => {
    const text = readFileSync("scripts/settings.mjs", "utf8");
    const missing = [];
    for ( const [, key] of text.matchAll(/register\("(\w+)"/g) ) {
      for ( const leaf of ["name", "hint"] ) if ( !has(`settings.${key}.${leaf}`) ) missing.push(`${key}.${leaf}`);
    }
    for ( const [, key, list] of text.matchAll(/choices\("(\w+)", \[([^\]]+)\]\)/g) ) {
      for ( const [, v] of list.matchAll(/"(\w+)"/g) ) {
        if ( !has(`settings.${key}.choices.${v}`) ) missing.push(`${key}.choices.${v}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("covers every registered setting with a default", () => {
    const text = readFileSync("scripts/settings.mjs", "utf8");
    const registered = [...text.matchAll(/register\("(\w+)"/g)].map(m => m[1]);
    expect(registered.filter(k => !(k in DEFAULTS))).toEqual([]);
  });

  it("covers every health state the model can produce", () => {
    for ( const state of ["healthy", "bloodied", "critical", "down"] ) expect(has(`health.${state}`)).toBe(true);
  });
});

/**
 * module.json loads the numbered bar files in number order (the cascade order), then the portrait
 * styles. A file that exists but isn't listed is never loaded, and nothing on screen says why.
 */
describe("module.json styles", () => {
  const listed = manifest.styles;

  it("lists every bar stylesheet, in number order, after the fonts", () => {
    const onDisk = readdirSync("styles/bar").filter(f => f.endsWith(".css")).sort().map(f => `styles/bar/${f}`);
    expect(listed[0]).toBe("styles/fonts.css");
    expect(listed.filter(f => f.startsWith("styles/bar/"))).toEqual(onDisk);
  });

  it("lists every portrait style stylesheet", () => {
    const onDisk = readdirSync("styles/portrait").filter(f => f.endsWith(".css")).map(f => `styles/portrait/${f}`);
    expect(listed.filter(f => f.startsWith("styles/portrait/")).sort()).toEqual(onDisk.sort());
  });

  it("scopes every rule under .scb-root, the tooltip or the event dialog (spec R10)", () => {
    const bad = [];
    for ( const file of listed.filter(f => f !== "styles/fonts.css") ) {
      const css = stripComments(readFileSync(file, "utf8"));
      for ( const [, selectors] of css.matchAll(/(?:^|})\s*([^{}@]+?)\s*\{/g) ) {
        for ( const sel of splitSelectors(selectors) ) {
          if ( !sel || /^(from|to|\d+%)$/.test(sel) ) continue;
          const scoped = [".scb-root", "#tooltip.scb-tooltip", ".scb-event-dialog", ".scb-trackers-config",
            "body.scb-hide-calendar"]
            .some(p => sel.startsWith(p));
          if ( !scoped ) bad.push(`${file}: ${sel}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("never sets variables on :root (spec R10)", () => {
    for ( const file of listed ) expect(stripComments(readFileSync(file, "utf8"))).not.toMatch(/:root\b/);
  });

  it("resolves every relative url inside the Data folder", () => {
    const base = `http://host/modules/${MODULE_ID}/`;
    const bad = [];
    for ( const file of listed ) {
      for ( const [, raw] of readFileSync(file, "utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g) ) {
        if ( /^(data:|https?:|\/|#)/.test(raw) ) continue;
        const path = new URL(raw, base + file).pathname;
        if ( !path.startsWith(`/modules/${MODULE_ID}/`) ) bad.push(`${raw} → ${path}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** Hook names are public API: renaming one breaks every module listening. Asserted literally. */
describe("public hooks", () => {
  it("keeps its names", () => {
    expect(HOOKS).toEqual({
      init: "simpleCombatBar.init",
      ready: "simpleCombatBar.ready",
      bind: "simpleCombatBar.bind",
      unbind: "simpleCombatBar.unbind",
      renderPortrait: "simpleCombatBar.renderPortrait"
    });
  });

  it("are documented in docs/API.md", () => {
    const doc = readFileSync("docs/API.md", "utf8");
    for ( const name of Object.values(HOOKS) ) expect(doc).toContain(name);
  });
});

describe("module.json", () => {
  it("declares the combat-tracker-dock conflict", () => {
    expect(manifest.relationships.conflicts.map(c => c.id)).toContain("combat-tracker-dock");
  });

  it("doesn't require a game system (the generic adapter covers others)", () => {
    expect(manifest.relationships.systems).toBeUndefined();
  });
});
