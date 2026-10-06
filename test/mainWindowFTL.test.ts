/**
 * mainWindow.ftl's link in the main window (TASK-97).
 *
 * Left linked after the plugin shut down, it made every Fluent translation in
 * the window reject, and with it Zotero's item context menu. And inserted
 * through MozXULElement.insertFTLIfNeeded after the timeline tab had shimmed
 * a <head>, it landed there, where DOMLocalization never reads it, beside the
 * original in <linkset>.
 *
 * The removal is reached through api.removeMainWindowFTLForTests, the
 * function onShutdown runs per window: calling onShutdown itself would shut
 * the plugin down under the rest of the suite.
 */
import { assert } from "chai";

const HREF = "zoterotimeline-mainWindow.ftl";

describe("the main window's Fluent file", function () {
  this.timeout(30000);

  let win: any;
  let api: any;

  before(function () {
    win = Zotero.getMainWindows()[0];
    api = (Zotero as any).ZoteroTimeline.api;
  });

  after(async function () {
    api.closeTimelineTab();
    // Whatever a failed spec left, put the window back the way startup does.
    await (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(win);
  });

  function links(): Element[] {
    return Array.from(
      win.document.querySelectorAll('link[rel="localization"]'),
    ).filter((link: any) => link.getAttribute("href") === HREF) as Element[];
  }

  it("is linked once, into <linkset>, even after the tab has added a <head> and the load hook runs again", async function () {
    await api.openTimelineTab(win);
    assert.ok(win.document.head, "positive control: the tab shims a <head>");

    await (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(win);

    const found = links();
    assert.lengthOf(found, 1, "the window does not hold exactly one link");
    assert.equal(found[0].parentElement?.localName, "linkset");
  });

  it("is unlinked from the window on shutdown, and linked once again by the next load", async function () {
    assert.lengthOf(links(), 1, "positive control: linked at start");

    api.removeMainWindowFTLForTests(win.document);
    assert.lengthOf(links(), 0, "a link survived the removal");

    await (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(win);
    assert.lengthOf(links(), 1, "the next load did not link it exactly once");

    // The re-inserted link is one Fluent reads: a message only this file
    // holds resolves.
    const [message] = await win.document.l10n.formatMessages([
      { id: "zoterotimeline-menu-tools-timeline" },
    ]);
    assert.ok(
      message?.attributes?.find((attr: any) => attr.name === "label")?.value,
      "zoterotimeline-menu-tools-timeline does not resolve",
    );
  });
});
