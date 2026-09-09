import { getString, initLocale } from "./utils/locale";
import { logFailure } from "./utils/logging";
import {
  closeTimelineTab,
  getActiveTimeline,
  getAvailableTags,
  getCurrentTimeline,
  getLastMovePayload,
  getModuleEvalEnv,
  getSelectedTagFilter,
  getVisibleTimelines,
  openCreateEventOnTimeline,
  openTimelineTab,
  rebuildPassesSoFar,
  rebuildsSoFar,
  refreshObserverForTesting,
  registerTimelineMenu,
  registerTimelineShortcut,
  setCrossLibrarySwitchConfirmForTests,
  setTimelineDeleteConfirmForTests,
} from "./modules/timeline/timelineTab";
import {
  registerContainerObserver,
  unregisterContainerObserver,
} from "./modules/timeline/containerGuard";
import {
  registerTimelineContextAction,
  resolveSelection,
} from "./modules/timeline/libraryContextMenu";
import { openAddSourcesDialog } from "./modules/timeline/addSourcesDialog";

import {
  parsesSoFar,
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
import {
  renderVocabularySettings,
  setConfirmDeleteForTests,
} from "./modules/timeline/vocabularySettings";
import {
  registerItemPaneSection,
  unregisterItemPaneSection,
} from "./modules/timeline/itemPaneSection";
import {
  buildNoteHtml,
  createTaggedNote,
  STORAGE_TAG,
  StorageError,
} from "./modules/timeline/storage";
import type { TimelineDocument } from "./modules/timeline/schema";
import { ensureStylesheet, removeStylesheet } from "./utils/stylesheet";

let containerObserverID: string | null = null;
let cacheObserverID: string | null = null;
let sourcePruneObserverID: string | null = null;
// Guards registerTimelineContextAction the same way the observer ids above
// guard their own registration: onMainWindowLoad runs once per main window,
// but a menuitem id is registered once for the process, not once per window.
let addSourcesActionRegistered = false;
let addToNewEventActionRegistered = false;

// The plugin's own main-window sheet: the tab shell and the event editor, and
// whatever m-6's item-pane section adds. Per window, because a link belongs to
// one document and Zotero can have several main windows open.
const PANE_STYLESHEET_ID = "zoterotimeline-pane-stylesheet";
const PANE_STYLESHEET_URL = "chrome://zoterotimeline/content/zoteroPane.css";

/**
 * Writes a timeline document note through the plugin's own storage module,
 * so a spec can produce the post-commit write signal onStorageWrite fires.
 * The scaffold bundles a full second copy of src/ into every spec file, so a
 * spec that imported storage.ts directly and called its write functions
 * would be talking to a different module instance than the one this plugin's
 * registered listeners subscribe to; going through addon.api instead reaches
 * the instance that is actually running.
 *
 * Refuses before the write reaches the queue when the library is not
 * writable or the document has no name, the same two refusals createTimeline
 * makes - without them a doomed write reached saveTx and rejected from
 * inside the queue instead of being refused up front.
 */
async function createDocumentNoteForTests(
  libraryID: number,
  doc: TimelineDocument,
): Promise<Zotero.Item> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    throw new StorageError(
      "not-writable",
      `library ${libraryID} is not writable`,
    );
  }
  if (doc.name.trim() === "") {
    throw new StorageError("invalid-schema", "a timeline needs a name");
  }
  return createTaggedNote(libraryID, STORAGE_TAG, buildNoteHtml(doc));
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // The Tools entry is registered per window from onMainWindowLoad, not here.
  // The shortcut is not: ztoolkit's KeyboardManager attaches its keydown and
  // keyup listeners to every main window itself, through a Services.wm
  // listener it installs when the first callback is registered, so one
  // registration covers windows opened later as well.
  registerTimelineShortcut();
  registerItemPaneSection();

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
  // renderVocabularySettings doubles as the preferences pane's own wiring:
  // preferences.xhtml's onload calls it directly, since the pane is not a
  // main window and hooks.ts's four lifecycle hooks never reach it.
  addon.api = {
    openTimelineTab,
    closeTimelineTab,
    getLastMovePayload,
    getCurrentTimeline,
    getModuleEvalEnv,
    renderVocabularySettings,
    setConfirmDeleteForTests,
    setTimelineDeleteConfirmForTests,
    setCrossLibrarySwitchConfirmForTests,
    getVisibleTimelines,
    getActiveTimeline,
    getAvailableTags,
    getSelectedTagFilter,
    parsesSoFar,
    rebuildPassesSoFar,
    rebuildsSoFar,
    refreshObserverForTesting,
    openAddSourcesDialog,
    openCreateEventOnTimeline,
    createDocumentNoteForTests,
    registerItemPaneSection,
    unregisterItemPaneSection,
  };

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
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
  registerTimelineMenu(win);

  if (!addSourcesActionRegistered) {
    addSourcesActionRegistered = true;
    registerTimelineContextAction(
      win,
      "zotero-timeline-menuitem-add-sources",
      {
        flat: getString("context-add-sources-flat"),
        submenu: getString("context-add-sources-submenu"),
      },
      "chrome://zotero/skin/16/universal/link.svg",
      "…",
      (entry) => {
        const selection = resolveSelection(win.ZoteroPane.getSelectedItems());
        if (!selection.ok) {
          return;
        }
        void openAddSourcesDialog(entry, selection.items).catch((err) => {
          logFailure(
            `[zoteroTimeline] failed to open the add-as-sources dialog: ${
              (err as Error).message
            }`,
            err,
          );
        });
      },
    );
  }

  if (!addToNewEventActionRegistered) {
    addToNewEventActionRegistered = true;
    registerTimelineContextAction(
      win,
      "zotero-timeline-menuitem-add-to-new-event",
      {
        flat: getString("context-add-to-new-event-flat"),
        submenu: getString("context-add-to-new-event-submenu"),
      },
      "chrome://zotero/skin/16/universal/plus.svg",
      "…",
      (entry) => {
        const selection = resolveSelection(win.ZoteroPane.getSelectedItems());
        if (!selection.ok) {
          return;
        }
        void openCreateEventOnTimeline(
          win,
          entry.documentId,
          entry.libraryID,
          selection.items,
        ).catch((err) => {
          logFailure(
            `[zoteroTimeline] failed to open the add-to-new-event form: ${
              (err as Error).message
            }`,
            err,
          );
        });
      },
    );
  }
}

/**
 * Releases what this window's load claimed, which is the stylesheet and
 * nothing else.
 *
 * Everything the load hook registers besides that is process-wide, not
 * per-window: the three observers watch the database, the library filter
 * patches CollectionTreeRow's prototype, and ztoolkit.unregisterAll() removes
 * every element the toolkit ever made in every window. Releasing any of it
 * here means closing one main window disarms the plugin in the ones still
 * open. Measured 2026-09-07 against a second window: closing it left the
 * cache observer unregistered, so listTimelinesCached kept serving stale
 * documents and the surviving window's canvas stopped redrawing on a note
 * write. onShutdown is where that teardown belongs, and it does it now.
 */
async function onMainWindowUnload(win: Window): Promise<void> {
  removeStylesheet(win.document, PANE_STYLESHEET_ID);
}

function onShutdown(): void {
  closeTimelineTab();
  unregisterItemPaneSection();
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
