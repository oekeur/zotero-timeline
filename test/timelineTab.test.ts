import { assert } from "chai";

// Diagnostic harness for "the tab opens but nothing is visible". Each stage
// reports what it actually found, so a failure names the layer that broke
// rather than just the end result.
describe("timeline tab", function () {
  it("builds a visible fixture into the tab container", async function () {
    this.timeout(60000);

    const win = Zotero.getMainWindows()[0] as any;
    assert.ok(win, "no main window");
    const Zotero_Tabs = win.Zotero_Tabs;
    assert.ok(Zotero_Tabs, "no Zotero_Tabs on the main window");

    let threw: unknown;
    try {
      await (Zotero as any).ZoteroTimeline.api.openTimelineTab();
    } catch (err) {
      threw = err;
    }
    if (threw) {
      Zotero.debug(
        `[ZoteroTimeline][diag] openTimelineTab threw: ${
          (threw as Error)?.stack ?? String(threw)
        }`,
      );
    }
    assert.isUndefined(
      threw,
      `openTimelineTab threw: ${(threw as Error)?.stack ?? String(threw)}`,
    );

    const tab = Zotero_Tabs._tabs.find(
      (t: any) => t.type === "zoterotimeline-timeline",
    );
    assert.ok(tab, "no tab of type zoterotimeline-timeline was added");

    // Let layout settle; vis-timeline measures asynchronously in places.
    await Zotero.Promise.delay(1500);

    const doc = win.document;
    const canvas = doc.getElementById("zoterotimeline-canvas");
    assert.ok(canvas, "the canvas div is not in the document");

    // Fluent: getString returns the raw message id when a bundle is missing,
    // so "resolved" means the text differs from the id, not merely non-empty.
    const heading = canvas.parentElement?.querySelector("div > div");
    const headingText = (heading as any)?.textContent ?? "";

    const report = {
      tabId: tab.id,
      tabType: tab.type,
      headingText,
      canvasChildren: canvas.children.length,
      canvasClientHeight: canvas.clientHeight,
      canvasClientWidth: canvas.clientWidth,
      canvasOffsetParent: String(canvas.offsetParent?.id ?? null),
      firstChildClass: canvas.firstElementChild?.className ?? null,
      visItemCount: canvas.querySelectorAll(".vis-item").length,
      visLabelCount: canvas.querySelectorAll(".vis-label").length,
      stylesheetLinked: !!doc.getElementById("zoterotimeline-vis-stylesheet"),
      docHasHead: !!doc.head,
    };
    Zotero.debug(`[ZoteroTimeline][diag] ${JSON.stringify(report)}`);

    assert.isAbove(
      report.canvasChildren,
      0,
      `canvas has no children; vis-timeline built nothing. ${JSON.stringify(report)}`,
    );
    assert.isAbove(
      report.canvasClientHeight,
      0,
      `canvas has zero height, so nothing can be seen. ${JSON.stringify(report)}`,
    );
    // The fixture is two groups and four events. Exact counts, so a
    // half-rendered timeline fails rather than passing on "something appeared".
    assert.equal(
      report.visItemCount,
      4,
      `expected the four fixture events. ${JSON.stringify(report)}`,
    );
    assert.equal(
      report.visLabelCount,
      2,
      `expected the two fixture timelines as groups. ${JSON.stringify(report)}`,
    );
    assert.equal(
      report.tabType,
      "zoterotimeline-timeline",
      `unexpected tab type. ${JSON.stringify(report)}`,
    );
    assert.notEqual(
      report.headingText,
      "timeline-spike-heading",
      `Fluent did not resolve; the raw message id is showing. ${JSON.stringify(report)}`,
    );
    assert.isNotEmpty(
      report.headingText,
      `heading rendered empty. ${JSON.stringify(report)}`,
    );
    assert.isTrue(
      report.stylesheetLinked,
      `the vendored vis-timeline stylesheet was not linked, so the timeline renders unstyled. ${JSON.stringify(report)}`,
    );
  });
});
