# How to manage timelines

Create, rename, reorder, hide, activate and delete the timelines in a library,
from the Timeline tab's sidebar.

## Prerequisites

- The Timeline tab is open on a library you can edit (Tools > **Timeline**, or
  Shift+T). A read-only library lets you hide, show and reorder lanes, and
  nothing else.
- Opening the tab in an empty library has already created a timeline named
  "Timeline".

## Create a timeline

1. Click the `+` control next to the "Timelines" heading.
2. Type a name in the "Timeline name" field.
3. Click **Create**. Enter does not submit the form, and **Create** stays
   disabled while the name is blank.

The new timeline appears at the bottom of the sidebar and as a lane on the
canvas. It does not become the active timeline.

## Rename a timeline

1. Click `✎` ("Rename this timeline") on its row.
2. Edit the name.
3. Click **Rename**. Enter does not commit it. **Cancel** keeps the old name.

## Hide or show a timeline

Untick or tick the checkbox on its row ("Show or hide this timeline"). A hidden
timeline's lane leaves the canvas, and its tags leave the "Tags" section.
Hiding does not delete anything, and it is forgotten when you close the tab.

## Reorder timelines

Click `↑` ("Move up") or `↓` ("Move down") on a row. The lane order on the canvas
follows the sidebar. Order is not stored: reopening the tab restores the stored
order.

## Choose which timeline you are writing to

Click a timeline's name in the sidebar, or press Enter or Space while its row has
keyboard focus. The active lane is highlighted. Only the active timeline's
events can be dragged, and a click on its empty space creates an event. Clicking
an event or the empty space of another lane also activates that lane.

If you hide the active timeline, the topmost visible one becomes active.

## Delete a timeline

1. Click `×` ("Delete this timeline") on its row.
2. Read the "Delete timeline" confirmation. It names the timeline and its event
   count.
3. Confirm.

The timeline's lane and row disappear. The note that holds it moves to Zotero's
trash. Nothing is erased, so the events and their sources come back if you
restore the note: the open tab lists it again without a reopen. See
[Recovering trashed plugin data](/user-guide/plugin-data-howto).

## Verification

- A created timeline shows as a row and a lane. After a rename, both show the new
  name.
- A deleted timeline appears in Zotero's trash as a child note of the item
  "Zotero Timeline (plugin data)". The preference that hides plugin items from
  your item list does not hide them in the trash.

## Troubleshooting

- **The `+`, `✎` and `×` controls are greyed out.** The library cannot be
  written. The banner above the tab names it.
- **A row reads "Unreadable timeline".** Its note no longer parses. Hover the row
  for the reason. The plugin does not write to it. If the note was edited by
  hand, undo the edit.
- **Every timeline is gone and the canvas says the container is in the trash.**
  Restore "Zotero Timeline (plugin data)" from the trash.

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
