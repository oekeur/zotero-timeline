import { getString, initLocale } from "./utils/locale";
import {
  closeTimelineTab,
  getCurrentTimeline,
  getLastMovePayload,
  getModuleEvalEnv,
  openTimelineTab,
  registerTimelineMenu,
} from "./modules/timeline/timelineTab";
import { createZToolkit } from "./utils/ztoolkit";
import {
  registerContainerObserver,
  unregisterContainerObserver,
} from "./modules/timeline/containerGuard";

import {
  registerCacheObserver,
  unregisterCacheObserver,
} from "./modules/timeline/documentCache";
import {
  registerSourcePruneObserver,
  unregisterSourcePruneObserver,
} from "./modules/timeline/sourcePrune";
import {
  registerLibraryFilter,
  unregisterLibraryFilter,
} from "./modules/timeline/libraryFilter";
import { ensureStylesheet, removeStylesheet } from "./utils/stylesheet";

let containerObserverID: string | null = null;
let cacheObserverID: string | null = null;
let sourcePruneObserverID: string | null = null;

// The plugin's own main-window sheet: the tab shell and the event editor, and
// whatever m-6's item-pane section adds. Per window, because a link belongs to
// one document and Zotero can have several main windows open.
const PANE_STYLESHEET_ID = "zoterotimeline-pane-stylesheet";
const PANE_STYLESHEET_URL = "chrome://zoterotimeline/content/zoteroPane.css";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerTimelineMenu();

  // Without this the preferences.xhtml in addon/content is never shown, and
  // the hide-plugin-items preference has no way to be turned off: it defaults
  // to on, so the rows it hides would be unreachable.
  await Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    id: `${addon.data.config.addonRef}-pane`,
    src: `${rootURI}content/preferences.xhtml`,
    label: getString("pref-title"),
    image: `${rootURI}content/icons/favicon.png`,
    // The preferences window is not a main window, so the sheet
    // onMainWindowLoad injects never reaches it. A pane gets its styles only
    // through this option.
    stylesheets: [`${rootURI}content/preferences.css`],
  });

  // Exposed so the live-Zotero suite can drive the same instance the plugin
  // registered, rather than a second copy bundled into the test.
  addon.api = {
    openTimelineTab,
    closeTimelineTab,
    getLastMovePayload,
    getCurrentTimeline,
    getModuleEvalEnv,
  };

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // Straight onto documentElement, and deliberately WITHOUT shimming a <head>
  // first. Calling ensureDocumentHead here breaks Fluent: it defines an XHTML
  // <head> on the XUL document, and the localization links that
  // insertFTLIfNeeded and Zotero's own panes add afterwards land inside it
  // where DOMLocalization does not find them, so every data-l10n-id in the
  // window renders empty. Measured: six tests fail that way with the call in
  // and pass with it out. The tab still shims a head at open, which is late
  // enough not to matter, and which vis-timeline genuinely needs.
  ensureStylesheet(win.document, PANE_STYLESHEET_ID, PANE_STYLESHEET_URL);

  // Registered once rather than per window: the observer watches the database,
  // not a window. Leaving it registered across an unload would let the next
  // load stack a second one on the first.
  if (containerObserverID === null) {
    containerObserverID = registerContainerObserver();
  }
  if (cacheObserverID === null) {
    cacheObserverID = registerCacheObserver();
  }
  if (sourcePruneObserverID === null) {
    sourcePruneObserverID = registerSourcePruneObserver();
  }
  registerLibraryFilter();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  removeStylesheet(win.document, PANE_STYLESHEET_ID);
  if (containerObserverID !== null) {
    unregisterContainerObserver(containerObserverID);
    containerObserverID = null;
  }
  if (cacheObserverID !== null) {
    unregisterCacheObserver(cacheObserverID);
    cacheObserverID = null;
  }
  if (sourcePruneObserverID !== null) {
    unregisterSourcePruneObserver(sourcePruneObserverID);
    sourcePruneObserverID = null;
  }
  unregisterLibraryFilter();
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  closeTimelineTab();
  // Every window, not just one: onMainWindowUnload does not fire for a window
  // that is still open when the plugin is disabled, and a link left behind
  // outlives the plugin that owns the file it points at.
  for (const win of Zotero.getMainWindows()) {
    removeStylesheet(win.document, PANE_STYLESHEET_ID);
  }
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
