import { assert } from "chai";

/**
 * The copy rules, made executable (project/ui-design.md section 4).
 *
 * mindmap drifted six copy rules across ninety strings because nothing checked
 * them. These read the SHIPPED bundles rather than the sources: what a user
 * sees is what the build put in the profile, and a rule enforced against the
 * repo would miss a stale build entirely.
 *
 * Every locale the plugin ships is checked, not just the active one, so a rule
 * cannot hold in English and quietly fail in a translation. Today that is one
 * bundle set; the loop is written for however many there are.
 */
describe("locale copy rules", function () {
  this.timeout(30000);

  const PLUGIN_ID = "zoterotimeline@oekeur.github.io";

  type Bundle = { locale: string; file: string; text: string };
  const bundles: Bundle[] = [];

  before(async function () {
    // Zotero's own accessor, rather than a path guessed from the checkout: the
    // locale files are not chrome-registered, so chrome:// cannot reach them,
    // and the plugin's root is wherever the scaffold installed the build.
    const root = await (Zotero as any).Plugins.getRootURI(PLUGIN_ID);
    assert.ok(root, "could not resolve the plugin's root URI");

    const localeDir = `${root}locale/`.replace(/^file:\/\//, "");
    const locales = (await IOUtils.getChildren(decodeURIComponent(localeDir)))
      .map((p: string) => p.split("/").pop() as string)
      .filter((name: string) => name && !name.startsWith("."));
    assert.isNotEmpty(
      locales,
      "no locale directories found; this spec would pass vacuously",
    );

    for (const locale of locales) {
      const dir = decodeURIComponent(`${localeDir}${locale}`);
      for (const path of await IOUtils.getChildren(dir)) {
        if (!path.endsWith(".ftl")) {
          continue;
        }
        bundles.push({
          locale,
          file: path.split("/").pop() as string,
          text: (await Zotero.File.getContentsAsync(path)) as string,
        });
      }
    }
    assert.isNotEmpty(bundles, "no .ftl bundles were read");
  });

  /** Message values only: a comment explaining a string is not a string. */
  function values(bundle: Bundle): { id: string; value: string }[] {
    const out: { id: string; value: string }[] = [];
    let current: string | null = null;
    for (const line of bundle.text.split("\n")) {
      if (line.startsWith("#") || line.trim() === "") {
        continue;
      }
      const start = line.match(/^([A-Za-z][\w-]*)\s*=\s*(.*)$/);
      if (start) {
        current = start[1];
        if (start[2].trim() !== "") {
          out.push({ id: current, value: start[2].trim() });
        }
        continue;
      }
      const attr = line.match(/^\s+\.[\w-]+\s*=\s*(.*)$/);
      if (attr && current) {
        out.push({ id: current, value: attr[1].trim() });
      }
    }
    return out;
  }

  // TASK-56 AC #1 and #6
  it("names no spike and describes no hardcoded fixture", function () {
    for (const bundle of bundles) {
      for (const { id, value } of values(bundle)) {
        assert.notMatch(
          `${id} ${value}`,
          /\bspike\b|\bfixture\b|hardcoded/i,
          `${bundle.locale}/${bundle.file} still describes development scaffolding: ${id}`,
        );
      }
    }
  });

  // TASK-56 AC #3
  it("points no user-facing string at a debug channel", function () {
    for (const bundle of bundles) {
      for (const { id, value } of values(bundle)) {
        assert.notMatch(
          value,
          /debug output|debug console|error console/i,
          `${bundle.locale}/${bundle.file} sends the reader to a debug channel: ${id}`,
        );
      }
    }
  });

  // ui-design.md section 4, rule 3: no spaced hyphen standing in for
  // punctuation. An en dash or a comma is the fix, and both locales punctuate
  // the same sentence the same way.
  it("uses no spaced hyphen as punctuation", function () {
    for (const bundle of bundles) {
      for (const { id, value } of values(bundle)) {
        assert.notMatch(
          value,
          / - /,
          `${bundle.locale}/${bundle.file} uses a spaced hyphen for punctuation: ${id}`,
        );
      }
    }
  });

  // ui-design.md section 4, rule 4: plurals are Fluent selectors.
  it("writes no item(s) plural", function () {
    for (const bundle of bundles) {
      for (const { id, value } of values(bundle)) {
        assert.notMatch(
          value,
          /\(s\)/,
          `${bundle.locale}/${bundle.file} fakes a plural instead of using a selector: ${id}`,
        );
      }
    }
  });

  // TASK-56 AC #5's half that a bundle can hold: an empty state names the next
  // move (ui-design.md section 4, rule 5). Asserted on the strings rather than
  // on a rendered tab because the read-only-with-no-timelines case needs a
  // library nobody here can produce; timelineReadOnly.test.ts drives the
  // rendered half.
  //
  // The word for "sidebar" is locale-specific, so the rule takes a per-locale
  // term rather than one pattern for every bundle: en-US says "sidebar",
  // nl-NL says "zijbalk". A locale with no entry here fails rather than
  // passing vacuously, so adding a locale without updating this map is caught.
  it("gives the empty canvas a sentence that names the next move", function () {
    const wanted = "timeline-canvas-no-timelines";
    const termByLocale: Record<string, RegExp> = {
      "en-US": /sidebar/i,
      "nl-NL": /zijbalk/i,
    };
    const found = bundles.flatMap((b) =>
      values(b)
        .filter((v) => v.id.endsWith(wanted))
        .map((v) => ({ locale: b.locale, value: v.value })),
    );
    assert.isNotEmpty(
      found,
      `no ${wanted} message exists, so a library with no timelines renders a blank canvas with no explanation`,
    );
    for (const { locale, value } of found) {
      const term = termByLocale[locale];
      assert.isDefined(
        term,
        `${locale} has no expected term in this rule's map; add one before shipping the locale`,
      );
      assert.match(
        value,
        term,
        `${locale}'s empty-canvas message does not say where to go next: ${value}`,
      );
    }
  });

  // The flat rule: every key present in one locale is present in the others.
  // Vacuous with a single locale shipped, and correct the moment a second one
  // lands, which is when it starts mattering.
  it("has every key in every locale", function () {
    const byFile = new Map<string, Map<string, Set<string>>>();
    for (const bundle of bundles) {
      const perFile = byFile.get(bundle.file) ?? new Map();
      perFile.set(bundle.locale, new Set(values(bundle).map((v) => v.id)));
      byFile.set(bundle.file, perFile);
    }
    for (const [file, perLocale] of byFile) {
      const locales = [...perLocale.keys()];
      for (const a of locales) {
        for (const b of locales) {
          if (a === b) continue;
          for (const id of perLocale.get(a)!) {
            assert.isTrue(
              perLocale.get(b)!.has(id),
              `${file}: ${id} is in ${a} but missing from ${b}`,
            );
          }
        }
      }
    }
  });

  /**
   * The flat key-set rule above reads the id `values()` attaches to each
   * entry, and `values()` attaches an attribute's id to its PARENT message -
   * so a bundle that moves a `.label` value onto the message line instead of
   * keeping it as an attribute keeps the same id set while actually breaking
   * every `data-l10n-id` consumer that reads that attribute. Counting message
   * lines and attribute lines separately, straight off the raw text rather
   * than through `values()`, is what catches that: the two counts have to
   * match per locale per file, not just the ids.
   */
  it("has the same message and attribute count in every locale, per file", function () {
    const MESSAGE_LINE = /^[A-Za-z][\w-]*\s*=/;
    const ATTRIBUTE_LINE = /^\s+\.[\w-]+\s*=/;

    function counts(text: string): { messages: number; attributes: number } {
      const lines = text.split("\n");
      return {
        messages: lines.filter((l) => MESSAGE_LINE.test(l)).length,
        attributes: lines.filter((l) => ATTRIBUTE_LINE.test(l)).length,
      };
    }

    const byFile = new Map<
      string,
      Map<string, { messages: number; attributes: number }>
    >();
    for (const bundle of bundles) {
      const perLocale = byFile.get(bundle.file) ?? new Map();
      perLocale.set(bundle.locale, counts(bundle.text));
      byFile.set(bundle.file, perLocale);
    }

    for (const [file, perLocale] of byFile) {
      const locales = [...perLocale.keys()];
      const [first, ...rest] = locales;
      for (const locale of rest) {
        assert.deepEqual(
          perLocale.get(locale),
          perLocale.get(first),
          `${file}: ${locale}'s message/attribute count does not match ${first}'s, so a value moved between a message and an attribute`,
        );
      }
    }
  });
});
