/**
 * One of the few things a spec can assert about the RUNNING plugin rather than
 * about its own copy of a module: Zotero.PreferencePanes is Zotero's state, so
 * what the real plugin registered at startup is visible from here.
 *
 * Worth a test because the failure is silent and total. The pane is the only
 * way to reach the hide-plugin-items preference, that preference defaults to
 * on, and nothing else in Zotero reports that a plugin meant to have settings
 * and does not. It shipped unregistered once.
 */
import { assert } from "chai";
import { config } from "../package.json";

describe("the preferences pane", function () {
  function pluginPanes() {
    return (
      Zotero.PreferencePanes as unknown as {
        pluginPanes: { id: string; pluginID: string; src: string }[];
      }
    ).pluginPanes;
  }

  it("is registered by the plugin", function () {
    const ours = pluginPanes().filter(
      (pane) => pane.pluginID === config.addonID,
    );

    assert.lengthOf(
      ours,
      1,
      "the plugin registered no preferences pane, so its settings are unreachable",
    );
    assert.include(ours[0].src, "preferences.xhtml");
  });

  it("does not register the same pane twice", function () {
    const ids = pluginPanes()
      .filter((pane) => pane.pluginID === config.addonID)
      .map((pane) => pane.id);

    assert.deepEqual([...new Set(ids)], ids);
  });
});
