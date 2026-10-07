# The library item context menu

Right-clicking items in the library adds two entries that attach the selection
to a timeline: "Add as Sources to…" cites the items on an event that already
exists, and "Add to New Event on…" opens a create form with the items already
listed as sources.

For step-by-step use, see
[How to cite library items from the context menu](/user-guide/library-context-menu-howto).

## The entries

Each action has two forms. Which form shows depends on how many timelines the
library holds.

| Action                              | Flat form (one timeline)        | Submenu form (two or more timelines) |
| ----------------------------------- | ------------------------------- | ------------------------------------ |
| Cite the items on an existing event | "Add as Sources to Timeline…"   | "Add as Sources to…"                 |
| Cite the items on a new event       | "Add to New Event on Timeline…" | "Add to New Event on…"               |

"Add as Sources to…" comes first in the menu. In the submenu form, each row is a
timeline's name followed by an ellipsis. The ellipsis marks that a further
window or form opens: clicking the entry does not write anything itself.

The flat form acts directly on the library's only timeline. The submenu is
rebuilt every time the menu opens, so a timeline you created or renamed a moment
ago is listed.

## When the entries show

The plugin reads the selection when the menu opens.

1. Attachments and the plugin's own items (the "Zotero Timeline (plugin data)"
   container and its notes) are dropped from the selection. They are not
   reported; a selection of only such items shows no entries.
2. If the remaining items come from more than one library, the flat form of each
   entry shows but is disabled. Its tooltip reads "The selection spans more than
   one library; choose items from a single library." Nothing is written. The
   submenu form does not show in this case, even if the libraries hold several
   timelines.
3. If the library holds no timelines, the entries do not show.
4. Otherwise one timeline gives the flat form and several give the submenu.

The library an action writes to is the timeline's own library, never one
inferred from the selection.

## "Add as Sources to…"

Opens a separate window titled "Add as sources".

| Element      | Content                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Context line | "Add 1 item as sources to an event in "&lt;timeline&gt;"", or "Add N items as sources to an event in "&lt;timeline&gt;"". |
| Event        | A select listing every event in the timeline as `title — date`.                                                           |
| Type         | A select listing the library's link types, with the first one chosen.                                                     |
| Attach       | Writes the sources.                                                                                                       |
| Cancel       | Closes the window.                                                                                                        |

A timeline with no events shows "This timeline has no events yet." and a Close
button instead of the form.

Attach adds one source per selected item to the chosen event, under the chosen
type, in a single write. An item the event already cites with an identical
source (same item, same type, no name) is not added again; one cited under the
same type with a name is not a duplicate, so a nameless source is added
beside it. After Attach the form is replaced by the result, and Cancel
becomes Close. The window is one-shot: to attach again, close it and reopen it
from the menu.

### Result messages

| Message                                                                    | When                                                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "Attached 1 source." / "Attached N sources."                               | At least one item was added.                                                                                      |
| "Nothing attached: every selected item was already cited under this type." | Every selected item was a duplicate.                                                                              |
| "Already cited under this type, so not attached again: &lt;names&gt;."     | Shown under the line above whenever any item was a duplicate, including when all were. Names are comma-separated. |

If the write fails, Attach is enabled again and no message appears; the failure
goes to Zotero's error log.

A source added this way has no name. Give it one afterwards in the event editor.

## "Add to New Event on…"

Brings the Timeline tab to the front on the chosen timeline and opens the create
form there. Nothing is written until you click "Create event".

Before the form opens, up to two confirmations can appear:

| Confirmation                     | When                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Switch to a different library?" | The tab is open on another library. Confirming closes what is on screen, including unsaved editor changes. It names both libraries, or says "another library" if it cannot name the current one. |
| "Discard the current edit?"      | An event is selected in the editor. The message reads "This will replace what the editor is showing. Anything there that hasn't been saved will be lost."                                        |

Declining either one leaves the tab as it was. If the target timeline was
switched off in the sidebar, it is switched back on and made active.

### The create form

| Field        | Behavior                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Sources      | The selected items, listed read-only. There is no timeline picker, because the menu already chose the timeline.                |
| Title        | Optional. A blank title is stored as "Untitled event".                                                                         |
| Date         | Required. An EDTF date. Clicking "Create event" with a blank date does nothing: no write, no message, and the form stays open. |
| Create event | Writes the event and its sources in one step and selects the new event.                                                        |

Under the date field, a value that cannot be read shows "Not a date this can
read". The form has no default date because it has no canvas position to take
one from.

Every source is stored under the library's first link type. Change the type, or
add a name, in the event editor after creating the event. If two selected items
would produce the identical source, the extra one is skipped and a notice reads
"Not added, already among the sources above: &lt;names&gt;."

In a library that cannot be written, every control in the form is disabled.

## Related

- [How to cite library items from the context menu](/user-guide/library-context-menu-howto)
- [The Timelines section in the item pane](/user-guide/item-pane-reference), which lists the citations these actions create
- [Settings](/user-guide/settings-reference), for the link types offered in the Type select
