# Recovering trashed plugin data

::: warning Pre-release
The plugin does not create these items yet. This page records the recovery
procedure the storage design implies, so it exists before the failure can.
:::

Your timelines are stored as Zotero note items under one container item per
library. If that container or a note ends up in the trash, the plugin stops
finding the data and the timeline list looks empty. Nothing is lost; Zotero's
trash keeps the items until it is emptied.

## Symptom

The timeline list is empty, or one timeline you know exists is missing, and you
did not delete anything from inside the plugin.

## Restore it

1. Click **Trash** in the left-hand pane of your Zotero library.
2. Sort by **Date Modified** so recently trashed items come first.
3. Look for an item named after this plugin. It is the container, and the
   timeline notes are its children.
4. Right-click it and choose **Restore to Library**.
5. Restart Zotero, or reopen the timeline tab.

If you only lost one timeline, restore the individual note rather than the
container.

## If the trash has already been emptied

Emptying the trash is permanent locally. Two routes remain:

- **You sync.** Another synced machine that has not yet pulled the deletion
  still holds the items. Disconnect it from the network before opening Zotero,
  export the container and its children, then reconnect.
- **You have a Zotero data directory backup.** Zotero keeps `zotero.sqlite.bak`
  beside `zotero.sqlite` in your data directory. Restoring it rolls the whole
  library back, not just the plugin's items, so copy the directory aside first.

## Why this can happen at all

The plugin's data is ordinary library items, which is what makes it sync
without any configuration. The cost is that ordinary library operations,
including a stray delete, apply to it too. See
[Why data lives in a note](/user-guide/plugin-data-explanation).
