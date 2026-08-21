import { initLocale } from "./utils/locale";
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

let containerObserverID: string | null = null;
let cacheObserverID: string | null = null;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerTimelineMenu();

  // Exposed so the live-Zotero suite can drive the same instance the plugin
  // registered, rather than a second copy bundled into the test.
  addon.api = {
    openTimelineTab,
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

  // Registered once rather than per window: the observer watches the database,
  // not a window. Leaving it registered across an unload would let the next
  // load stack a second one on the first.
  if (containerObserverID === null) {
    containerObserverID = registerContainerObserver();
  }
  if (cacheObserverID === null) {
    cacheObserverID = registerCacheObserver();
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  if (containerObserverID !== null) {
    unregisterContainerObserver(containerObserverID);
    containerObserverID = null;
  }
  if (cacheObserverID !== null) {
    unregisterCacheObserver(cacheObserverID);
    cacheObserverID = null;
  }
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  closeTimelineTab();
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
