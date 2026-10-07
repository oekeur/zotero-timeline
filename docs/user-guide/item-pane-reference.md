# The Timelines section in the item pane

The Timelines section sits in Zotero's item pane, below the sections Zotero
ships. For the selected library item it lists every event, on every timeline in
the same library, that cites the item. It only reads: adding or changing a
citation happens in the event editor in the Timeline tab or through the
[library context menu](/user-guide/library-context-menu-reference).

To find an item's events and jump to one, see
[How to find which events cite an item](/user-guide/item-pane-howto).

## Where it appears

The section is titled "Timelines". Its icon is also in the item pane's side
navigation, where the tooltip reads "Timelines".

The section is disabled, and so hidden, for:

- attachments, because an attachment is cited through the item it belongs to,
  not on its own;
- the plugin's own items: the "Zotero Timeline (plugin data)" container and its
  storage and vocabulary notes.

Every other item gets the section, including standalone notes.

## What the section shows

Matching is by library and item key. An event matches when one of its sources
points at the selected item. Only timelines in the selected item's own library
are read; a timeline cannot cite an item from another library.

### Groups

Events are grouped by timeline. Each group has the timeline's name as a heading
and one row per matching event. A timeline with no matching event has no group.
Groups follow the order in which the plugin lists the library's timelines.

### Rows

A row has two lines.

| Line   | Content                                                                 |
| ------ | ----------------------------------------------------------------------- |
| First  | The event's title.                                                      |
| Second | The date, then `·`, then one entry per matching source, joined by `; `. |

The date is the event's date. An event with an end date shows `date – end date`.

Each source entry has the form

```text
<reference> — <type>
```

or `<reference> — <type>: <name>` when the source has a name. The reference is
the same label the event editor's source list uses. The type is the link type's
current label, or "(unknown type)" if the type was deleted from the library's
vocabulary. An event that cites the item twice, under two types, shows both
entries on one row.

Rows take keyboard focus. A click, or Enter or Space on a focused row, jumps to
the event in the Timeline tab. The jump is described in
[How to find which events cite an item](/user-guide/item-pane-howto).

## Empty and error states

| Situation                                                            | What the section shows                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| No event cites the item, and every timeline was readable             | "Not cited by any event."                                                                                 |
| No event cites the item, and at least one timeline could not be read | "A timeline in this library could not be read."                                                           |
| Events cite the item, and at least one timeline could not be read    | The groups, then below them: "A timeline in this library could not be read; this list may be incomplete." |

The second state replaces the empty text on purpose. A timeline that will not
parse is skipped, and from the section alone that would look the same as an item
no timeline cites. The plugin cannot claim that when it could not read every
document. See [what the plugin stores](/user-guide/plugin-data-reference) for how
a document can become unreadable.

## When it refreshes

The section reads when you select an item and again after any write to the
library's timeline data, including edits to the link-type vocabulary. A citation
added from the context menu appears without reselecting the item, and so does a
renamed link type.

The section reads a cache of the library's timeline documents. Selecting items
one after another in the same library does not parse the documents again until
one of them changes.

## Related

- [How to find which events cite an item](/user-guide/item-pane-howto)
- [The library item context menu](/user-guide/library-context-menu-reference)
- [Settings](/user-guide/settings-reference), for the link-type labels shown in each row
