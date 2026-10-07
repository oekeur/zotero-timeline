# How to edit a library's link types

You will add, rename or delete the link types that sources can carry, for one
library.

## Prerequisites

- The library can be written. In a read-only library the editor shows the list but
  every save fails with "This library can't be edited, so the change was not
  saved."
- You know that link types belong to a library: a group library can have a
  different list from My Library. See
  [Settings: Zotero Timeline](/user-guide/settings-reference).

## Open the editor

1. Open Zotero's Settings and choose the "Zotero Timeline" pane.

2. In the Link types group, pick the library in the Library select. It starts on
   My Library.

## Add a type

1. Click Add.
2. Type the name in the Label field.
3. Click Save.

The new type is at the end of the list and is offered wherever a source type is
chosen.

## Rename a type

1. Click the type's row, then click Edit.
2. Change the text in the Label field.
3. Click Save.

Existing links keep pointing at the type, so they show the new label. With an item
selected in the main window, the Timelines section in its item pane repaints with
the new label while the Settings window is still open.

## Delete a type

1. Click the type's row, then click Delete.
2. Read the confirmation titled "Delete link type". It says how many source links
   in this library use the type. If it says it could not check, the library's
   timeline data could not be read, and the count is unknown.
3. Confirm to delete, or cancel to keep the type.

Links that used the type are not removed. They show "(unknown type)" until you
change them in the event editor. Adding a type back does not restore them: it gets
a new id.

## Verification

The list in the editor shows the change. For a rename, a source that used the type
reads the new label in the item pane's Timelines section.

## Troubleshooting

- **"These are the default link types. They have not been saved for this library
  yet..."** Nothing is stored yet. Your first change creates the list.
- **"A library's link types can't be empty..."** You tried to delete the last
  type. Add another first.
- **"...can't be edited here. Update the plugin to edit them."** A newer plugin
  version saved this list. Update the plugin.
- **"Zotero Timeline could not read this library's link types..."** The stored
  note is damaged. The plugin will not overwrite it. Fix or restore the note from
  the trash. See [Recovering trashed plugin data](/user-guide/plugin-data-howto).
- **A form you typed in is gone.** Switching library discards an open form. A
  failed save keeps it.
