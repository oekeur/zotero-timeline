# How to find which events cite an item

You will find the events that cite a library item and open one of them on the
timeline canvas.

## Prerequisites

- The item is a regular item or a standalone note in a library that has at least
  one timeline. Attachments and the plugin's own items have no Timelines section.
- You know the section's layout. See
  [The Timelines section in the item pane](/user-guide/item-pane-reference).

## Steps

1. Select the item in the library.

2. Scroll the item pane to the section titled "Timelines", or click its icon in
   the item pane's side navigation. It sits below Zotero's own sections, so on an
   item with many fields it is below the fold.

   The section can read as empty for an instant after you select an item, while
   the timelines are read. Wait a moment before concluding it is empty.

3. Read the groups. Each heading is a timeline; each row is an event that cites
   the item, with its date and how it cites the item.

4. Click the row, or focus it and press Enter or Space.

   The Timeline tab opens, or comes to the front if it was already open. The
   event is selected and its editor is shown. The timeline holding the event
   becomes the active one.

### What the jump does for you

- **Hidden timeline.** If the timeline holding the event is switched off in the
  tab's sidebar, it is switched back on. No other timeline changes visibility.
- **Tag filter.** If a tag filter is set and the event does not carry any of the
  selected tags, the filter is cleared and the sidebar's tag section shows "Tag
  filter cleared to show this event." A filter that already admits the event is
  left alone.
- **Tab open on another library.** The tab shows one library at a time. If it is
  open on a different one, a confirmation titled "Switch to a different
  library?" names both libraries and warns that the current view, and any unsaved
  changes in the editor, will be lost. Confirm to switch. If you decline, nothing
  happens.

## Verification

The Timeline tab is selected, the event's title is in the editor panel, and the
event is highlighted on the canvas.

## Troubleshooting

- **"Not cited by any event."** No timeline in this library has a source pointing
  at this item. Sources are matched by library and item key, so a different copy
  of the same work in another library does not count.
- **"A timeline in this library could not be read."** One or more timeline notes
  would not parse, so the answer may be incomplete. See
  [Recovering trashed plugin data](/user-guide/plugin-data-howto) if timelines
  are missing.
- **No Timelines section at all.** The selected item is an attachment or one of
  the plugin's own items. Select the parent item instead.
- **A click does nothing.** The tab could not show the event, for example because
  the timeline was deleted after the section drew. The section reads again after
  the next write to the library's timeline data; reselect the item.
