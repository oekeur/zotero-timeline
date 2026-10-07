# How the Timeline tab redraws

The Timeline tab draws timelines it does not own. The documents live in notes,
and other code writes to those notes while the tab is open: a second window, the
"Add as sources" dialog, the library context menu, the source-prune observer,
Zotero sync. The tab has to show those writes without a reopen, and without
destroying what the user is in the middle of. This page describes how
`timelineTab.ts` does that, and which behaviours follow from it that are easy to
mistake for bugs.

For where the documents are stored and why, see
[Storage design](/internals/storage-explanation).

## What triggers a rebuild

One thing does: a Zotero.Notifier `item` event that `notifyTimelineChanged`
judges relevant. The tab registers it through `registerNotifierObserver`
(`notifierRegistry.ts`) under the id `zoterotimeline-canvas-refresh-<tab id>`,
and releases it when the tab closes. The observer ignores every type except
`item`, then decides per event:

| Event    | Schedules a rebuild when                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `modify` | a notified id is a note the tab already holds, or an item that is a note carrying the storage tag, or any item carrying the container tag |
| `add`    | a notified id is a note carrying the storage tag, or an item carrying the container tag                                                   |
| `delete` | the tab believes the container is trashed, or an id is a note the tab holds, or an id is a note the tab listed as unreadable              |
| other    | never                                                                                                                                     |

The branches have different reasons behind them, and each is documented on
`notifyTimelineChanged`:

- A `modify` of a held note is the ordinary case, an edit made elsewhere.
- The storage-tag and container-tag checks catch a note restored from the trash
  directly, a note arriving by sync, and a restored container. Zotero hides a
  note whose parent is trashed without flagging the note, so restoring the
  container fires `modify` for the container alone, never for its notes.
- `delete` cannot check a tag because the item is gone, so it matches on ids the
  tab already knows.
- An edit to an item with nothing to do with the plugin matches no branch and
  redraws nothing.

### The storage write signal is not a trigger

`storage.ts` also has `onStorageWrite`, which fires after every write the
storage layer commits (`emitStorageWrite`). The tab does not subscribe to it.
Its only subscriber is the item pane section in `itemPaneSection.ts`. The signal
exists because a Notifier observer cannot tell a plugin write from any other item
change: at an `add` notification a new note's tags are not yet queryable.

### The observer returns void

`notifyTimelineChanged` awaits nothing and starts the rebuild detached
(`void scheduleRebuild()`). Zotero awaits every observer's return value inside
the commit of the transaction that fired the notification, and every storage
write ends in `saveTx()` on a serial queue (`enqueue` in `storage.ts`). An
observer that awaited a rebuild would park the write that triggered it behind
itself, and every later write in the session would hang with nothing thrown and
nothing in the debug log.

## Writes the tab skips

The tab does not keep a "currently writing" flag. `drawnMatches`, called inside
`rebuildCanvas`, compares the freshly read documents against the ones drawn:
same number of timelines, and for each, `serializeDocument` of the drawn
document equal to `serializeDocument` of the stored one. If they match, the pass
returns without touching the canvas.

The code comments give the reason for content over a flag: Zotero fires `modify`
twice per save, once inside the transaction and once a macrotask after commit,
so a flag cleared when the write resolves never covers the second notification.
Content identity has no such window.

This only works if the tab's own write paths keep `documents` current, and they
do. `onEditorChange` updates the event inside the stored document in place for a
save, create or delete. Click-to-create replaces the whole document, because
`addEvent` returns a new one, and reports it through `replaceDocument`, which
updates both `documents` and `readableTimelines`.

`drawnMatches` is deliberately not `matchesCached` from `documentCache.ts`.
`matchesCached` reads the cache entry, and the cache's own observer deletes that
entry on the same notification. Notifier observers have no defined order, so the
helper would answer differently depending on which observer ran first.

A pass that matches still does two small things before returning: it updates the
unreadable-notes list and the container-trashed flag, and re-renders the sidebar
if either changed.

## What a rebuild replaces and what it restores

When the documents differ, `rebuildCanvas` does a full teardown and re-render,
not an in-place update. Its comment gives the reason: the documents can differ
by more than event positions (a timeline can appear, vanish or stop parsing),
and reconciling that against live data sets would be a second implementation of
the read path.

Order of operations:

1. `captureCanvasState` reads the active timeline, the selection, the viewport
   window and each lane's `visible` flag and order off the live instance.
2. `timeline.destroy()` drops the vis instance.
3. `readableTimelines` is replaced, and the `documents` map is cleared and
   refilled from the fresh read.
4. `renderCanvas` (`canvas.ts`) builds a new instance, new `items` and `groups`
   data sets, and a new `activateDocument`. The tab reassigns the bindings its
   closures use (`timeline`, `items`, `groups`, and so on), so a rebuild swaps
   the instance without rewriting each call site.
5. `restoreCanvasState` puts state back, lanes first, since selecting into a lane
   that is not drawn yet lands nowhere.
6. `renderSidebar` re-applies the tag filter and refreshes the chips.

| State                               | Where it lives                    | Across a rebuild                                                                              |
| ----------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| The vis instance, `items`, `groups` | `renderCanvas`                    | Replaced                                                                                      |
| The `documents` map                 | the tab closure                   | Cleared and refilled from storage                                                             |
| Active timeline                     | `activeDocumentId` in `canvas.ts` | Restored by `activateTimeline`, if that lane is still present                                 |
| Selection                           | vis instance                      | Restored by `setSelection`, filtered to ids whose timeline is still present                   |
| Visibility and order of lanes       | `groups` data set                 | Restored for lanes the tab already knew; a new lane takes the position `renderCanvas` gave it |
| Viewport                            | vis instance                      | Restored with `setWindow`, no animation                                                       |
| Tag filter                          | module-level `selectedTagFilter`  | Never captured, never reset by a rebuild; re-applied by `renderSidebar`                       |

Some details of the restore:

- `restoreCanvasState` renumbers every present lane densely. `renderCanvas`
  assigns each lane's order from its index in the fresh list, so restoring a
  known lane to its old index could put two lanes on the same number.
- Selection is filtered by timeline, not by event. An id whose event was deleted
  stays in the list and reaches `showEditorFor`, which does not find the event
  and renders the editor's empty state.
- `renderSidebar` drops any tag from `selectedTagFilter` that is no longer
  offered by the visible timelines, then calls `setTagFilter`. So a filter on a
  tag whose last event was deleted elsewhere is cleared by the rebuild. If the
  filter hides the restored selection, `setTagFilter` blanks the editor.
- The tag filter is view state. It does not sync, is not written to a document,
  and is reset on tab close.

If a note the tab drew stops parsing, the rebuild does not drop its lane.
`rebuildCanvas` pushes the previously drawn document into the fresh list in its
place, so a corrupt or half-synced write does not look like data loss. Every
other timeline still goes through the normal rebuild.

## Scheduling: one in flight, one dirty bit

`scheduleRebuild` keeps two booleans, `rebuilding` and `rebuildRequested`. A
call while a rebuild is running sets `rebuildRequested` and returns. The running
call loops (`do { rebuildRequested = false; await rebuildCanvas(); } while
(rebuildRequested)`) so that at most one rebuild is in flight, and exactly one
more runs if anything arrived meanwhile, however many notifications that was.

The comment names the two alternatives rejected. Dropping notifications that
arrive mid-rebuild loses them: a prune landing mid-rebuild would leave a removed
source on screen until the tab was reopened. A queue rebuilds once per
notification for a burst that one redraw settles.

`rebuildCanvas` can also return early on its own: if the read throws, or if the
tab was closed while it awaited (`id !== timelineTabID`), nothing is redrawn.

## Consequences

### An open editor is re-rendered by any rebuild the tab did not cause

The rebuild does not treat the editor as a thing to preserve. What it does is
restore the selection, and `restoreCanvasState` calls the wrapped
`timeline.setSelection` from `canvas.ts`. The wrapper calls
`handleSelectionChange`, which calls `onSelect`, which is `showEditorFor`. That
re-renders the editor panel from the stored event in `documents`. Anything typed
into the editor and not saved is gone, and there is no prompt.

"Not caused by the tab" is the operative phrase. An own-write whose result
matches the drawn documents returns early and leaves the editor alone. A write
that changes what is stored does not.

TASK-99 is one case, and is still open (status "To Do" in the tracker). Confirming Duplicate in the editor writes the target timeline
through `updateTimelineDocument`, not through the canvas, so the tab sees a
document that differs from what it drew and rebuilds. The rebuild re-selects the
original event and the editor re-renders from the stored copy, dropping unsaved
edits. The copy itself reads the stored event on purpose (`readTimelineDocument`
in the confirm handler), so what Duplicate copies and what survives in the editor
are the same thing: the last saved state. The editor has no dirty flag, so
neither Duplicate nor `showEditorFor` can check for unsaved edits first. By
contrast `openCreateEventLocally` asks "Discard the current edit?" before
clearing a selection.

The same applies to a write from another window, from "Add as sources", or a
remote edit arriving by sync, whenever it changes a timeline the tab has drawn
while an event is selected.

When nothing is selected there is no selection to restore, and `restoreCanvasState`
does not call `setSelection`. As far as the rebuild path in `timelineTab.ts` goes,
nothing else re-renders the panel, so an in-progress create form without a
selection is left in place. That is read from the code, not measured.

### Lane order is session state

There is no order field in the stored document (`schema.ts`). When the tab opens,
lanes follow `searchStorageNotes`, which sorts by note item id, and item ids are
local to one device. After that, order is whatever the sidebar's reorder controls
wrote to the `groups` data set. A rebuild carries it forward through
`captureCanvasState` and `restoreCanvasState`. Closing the tab discards it, and the
next open starts from note item id order again. Visibility and the active lane are session state in the same way.

### The item pane reads a cache, not the tab

The Timelines section in `itemPaneSection.ts` never asks the tab for anything.
`findCitingEvents` calls `listTimelinesCached`, which re-runs the tag search on
every call and parses only the notes whose entry in `documentCache.ts` is missing.
The item pane therefore works with no tab open; per selection it pays for the
search, and parses nothing until a document changes.

The cache is invalidated by its own observer (`registerCacheObserver`, started in
`hooks.ts`) which deletes the entry for each id in a `modify` notification. It
deletes only the notified ids, and returns void for the same reason the tab's
observer does. Erased and added notes need no invalidation: an erased note is no
longer returned by the search, and a new one is a miss.

The tab reads through the same cache. `rebuildCanvas` calls `listTimelinesCached`
as well, so a rebuild's parse is the same parse the item pane would use.

Two things keep the section current. The cache invalidation covers the data. The
`onStorageWrite` subscriber in `itemPaneSection.ts` covers the render: for every
live section instance showing an item in the written library it calls the
section's `refresh`, because Zotero does not reselect the item after a write, so
`onRender` never runs again by itself.

The one place the item pane does reach into the tab is jump-to-event, which calls
`revealHiddenTimeline`, `admitEventThroughTagFilter` and `isEventLoaded`,
exported from `timelineTab.ts`. Those only navigate. They are how a click on a
row can turn a hidden timeline back on or clear a tag filter that hid the event.
`isEventLoaded` reads the `items` data set of the current instance, since
`documents` can lag it for the width of an `await` during a delete.

## Related

- [Storage design](/internals/storage-explanation)
- [Your first timeline](/user-guide/first-timeline)
- [User journeys](/contributing/user-journeys-howto), which records the
  behaviours above as measured in a live Zotero.
