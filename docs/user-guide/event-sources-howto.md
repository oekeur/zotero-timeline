# How to attach and manage source links

Cite library items from an event, set how each one relates to the event, find it
in your library and remove it.

## Prerequisites

- The Timeline tab is open on a library you can edit, with an event selected.
- The item you want to cite is in the same library as the timeline. A timeline
  cannot cite items from another library.

## Attach a source

1. In the editor's "Sources" section, click **Add source…**.
2. Pick the item in Zotero's own item selector, which opens in its own window.
   The selector is limited to the timeline's library and offers one item at a
   time.
3. A row appears with the item's label, a type select, a "Name (optional)" field,
   **Show in library** and **Remove**. The type starts as the first link type in
   your list, "cites" with the default list.
4. Click **Save**. Nothing about a source is written before that.

You can cite a regular item or a standalone or child note. A note's label is a
preview of its first 60 characters, followed by its parent's title for a child
note.

## Set the link type and name

- Choose the type in the row's select (tooltip "Type"). The choices are the
  library's link types: cites, supports, contradicts, primary source for and
  related to, unless you changed them in the plugin's preferences.
- Type a name in "Name (optional)" to tell apart two links to the same item
  under the same type, such as two different pages. A blank name stores no name.
- Click **Save**.

## Find the cited item in your library

Click **Show in library** on the row. Zotero switches from the Timeline tab to
the library pane and selects the item. The button is a read: it needs no **Save**
and changes nothing stored. A row for an item that no longer exists reads
"(missing item)" and has no such button.

## Remove a source

Click **Remove** on the row, then **Save**. The row disappears at once, but the
link stays in storage until you save.

## Verification

- After **Save**, reselect the event: the rows are still there with the types and
  names you set.
- In the library, select the cited item. The item pane's "Timelines" section
  lists the event.

## Troubleshooting

The picker refuses some items, and the reason shows under the Sources list:

- An attachment is refused: `"<label>" is an attachment; cite the item it belongs to instead.`
  Pick the parent item.
- One of the plugin's own items is refused: `"<label>" is one of this plugin's own items; it can't be a source.`
- An item from another library is refused: `"<label>" is in another library; a source has to be from this one.`
- A duplicate is refused: `"<label>" is already a source on this event with the same type and no name.`
  The same item is allowed again under a different type, or with a name.

The editor's source controls are greyed out in a read-only library.

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
- [What the plugin stores](/user-guide/plugin-data-reference)
