# The Timeline tab

::: warning Pre-release
Read from the 0.9.0 source and checked against a live Zotero 10.0-beta.25 walk
on 2026-10-07. Dragging an event and the read-only banner were not exercised in
that walk; those parts are read from the source only.
:::

The Timeline tab is where you author timelines. It draws every visible timeline
as one lane on a shared date axis, with a sidebar on the left that lists the
timelines and the tags, and an editor panel on the right for the selected event.

For task-oriented steps, see:

- [Manage timelines](/user-guide/manage-timelines-howto)
- [Create and edit an event](/user-guide/edit-events-howto)
- [Attach and manage source links](/user-guide/event-sources-howto)
- [Duplicate an event to another timeline](/user-guide/duplicate-event-howto)
- [Use sub-lanes](/user-guide/sub-lanes-howto)
- [Filter by tag](/user-guide/filter-by-tag-howto)
- [Navigate the axis](/user-guide/navigate-howto)

## Opening the tab

| Way in               | Detail                                                    |
| -------------------- | --------------------------------------------------------- |
| Tools > **Timeline** | The menu entry is added to every main window's Tools menu |
| Shift+T              | Ignored while the keyboard focus is in a text field       |

The tab is titled "Timeline". There is one per Zotero process: opening it again
selects the existing tab instead of making a second one.

The tab shows one library, the one selected in the Zotero pane when the tab
opened (the first one, if several are selected). With nothing selected it falls
back to your personal library.

### The default timeline

Opening the tab in a library that holds no timelines creates one named
"Timeline" and makes it the active timeline. This is the only time the plugin
creates a timeline without you asking for it.

It creates nothing in two cases:

- The library cannot be written. See [Read-only libraries](#read-only-libraries).
- The library's timeline data is in the trash. The plugin then shows "Timeline
  data for this library is in the trash. Nothing new was created; restore it to
  get your timelines back." See
  [Recovering trashed plugin data](/user-guide/plugin-data-howto).

## Layout

Left to right: the sidebar, the canvas with a control strip above it, and the
editor panel. A banner above all three appears only in a read-only library.

## The sidebar

The sidebar is headed "Timelines" and holds, top to bottom: the create control,
one row per timeline, one row per unreadable timeline, and the "Tags" section.

### Creating a timeline

The `+` control (tooltip "Create a timeline") opens an inline form with a name
field (placeholder "Timeline name"), **Create** and **Cancel**. Clicking `+`
again closes the form. **Create** stays disabled while the name is blank, and
pressing Enter in the field does not submit it. The new timeline is added at
the bottom of the list, visible. Creating it does not change the active
timeline.

### A timeline row

Each row holds, left to right:

| Control  | Tooltip                    | Effect                                                           |
| -------- | -------------------------- | ---------------------------------------------------------------- |
| Checkbox | Show or hide this timeline | Shows or hides the timeline's lane. Does not activate it.        |
| Name     |                            | Clicking it activates the timeline                               |
| `↑`      | Move up                    | Swaps the row with the one above. Disabled on the first row.     |
| `↓`      | Move down                  | Swaps the row with the one below. Disabled on the last row.      |
| `✎`      | Rename this timeline       | Replaces the row with a rename form                              |
| `×`      | Delete this timeline       | Asks for confirmation, then moves the timeline to Zotero's trash |

The row itself can take keyboard focus. Enter or Space on the focused row
activates the timeline.

Visibility and order last for the session only. Closing and reopening the tab
shows every timeline again, in the stored order.

**Rename.** The form has a name field (placeholder "Timeline name"),
**Rename** and **Cancel**. **Rename** is disabled while the name is blank. Enter
in the field does not commit it; click **Rename**.

**Delete.** The confirmation is titled "Delete timeline". It names the timeline
and says how many events go with it, for example: Delete "Revolutions"? It and
its 3 events will move to Zotero's trash, where they can be restored. Confirming
moves the timeline's note to the trash. It does not erase it. Cancelling changes
nothing.

### The active timeline

Exactly one visible timeline is active, and its lane is highlighted. Only the
active timeline accepts writes from the canvas: its events can be dragged, and a
click on empty space in it creates an event.

At open, the topmost timeline is active. A timeline becomes active when you:

- click its sidebar row (not its checkbox or buttons), or press Enter or Space
  on the focused row;
- click one of its events;
- click empty space in its lane. That first click only activates the lane. A
  second click creates an event.

Turning a lane on with its checkbox does not activate it. Turning the active
lane off moves activation to the topmost timeline that is still visible.

### Unreadable timelines

A timeline note that cannot be parsed gets a row labelled "Unreadable
timeline". It has no controls. Hover it to see why the note could not be read.
The plugin never writes to such a note.

If a timeline that is already drawn stops parsing while the tab is open, the
canvas keeps drawing its last readable state and the sidebar marks the note as
unreadable straight away.

### The Tags section

Headed "Tags". See [Tag filter](#tag-filter).

## The canvas

### Lanes

Each visible timeline is one lane, labelled with the timeline's name, in the
sidebar's order. Events draw on the lane at their date.

- An event with an end date, or whose date is an interval, season, one-of set
  or list, draws as a range. An event with a plain, uncertain or approximate
  date draws as a single box at its instant.
- The editor names which of these forms a date was read as. See
  [The event editor](#the-event-editor).
- Hovering an event shows its title and date.

### Sub-lanes

An event can name a sub-lane (its `track`). A timeline whose events name
sub-lanes draws one nested row per sub-lane under the timeline's own label.
Events that name a sub-lane draw in that row; the timeline's own row draws none.
No control in the editor sets or changes a sub-lane. See
[Use sub-lanes](/user-guide/sub-lanes-howto).

### Events the plugin cannot place

An event whose date does not parse still draws, so it does not vanish. It sits
at one shared position just after the timeline's latest readable date, carries a
distinct style, and shows the parser's message on hover. It cannot be dragged;
fix its date in the editor. An event whose end date does not parse draws at its
start as a single flagged box and keeps its date.

### Click and drag

| Gesture                                        | Effect                                                        |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Click an event                                 | Selects it, opens it in the editor and activates its timeline |
| Click empty space in the active lane           | Creates an event at the clicked date and selects it           |
| Click empty space in a lane that is not active | Activates that lane and creates nothing                       |
| Drag an event in the active lane               | Moves its date and writes it immediately                      |
| Drag an event's edge (a range)                 | Changes its date or end date and writes it immediately        |
| Ctrl+scroll                                    | Zooms the axis                                                |

A click-created event is written at once with the title "Untitled event". Its
date is the clicked point at a precision the current view allows: a year when
the view spans more than 20 years, a month when it spans more than 2 years, a
day otherwise. Clicking in a sub-lane's row puts the event in that sub-lane.

A drag needs no Save. The drop is the write. Events that cannot be placed (see
above) have no drag handle, and nothing is draggable in a read-only library.

### Empty states

| Situation                        | Canvas message                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Timelines exist, all hidden      | No timelines are visible. Toggle one on in the sidebar to see it here.                                                                        |
| No timelines, writable library   | This library has no timelines yet. Use the plus control in the sidebar to make one.                                                           |
| No timelines, read-only library  | This library has no timelines.                                                                                                                |
| Plugin data item is in the trash | This library's timeline container is in the trash. Restore it to get your timelines back; the plus control will not create a new one over it. |

### Read-only libraries

When the open library cannot be written, a banner reads "(library name) can't be
edited. You can browse every timeline here, but nothing can be created, changed,
or deleted." Then:

- The `+`, rename and delete controls are disabled.
- Visibility, reorder and activation still work, since they change nothing
  stored.
- Dragging and click-to-create do nothing.
- In the editor, **Save**, **Delete**, **Duplicate**, **Add source…**, each
  source's type select, name field and **Remove**, and the create form are
  disabled. You can still read every field, type into them without saving, and
  use **Show in library**.
- The empty editor reads "Select an event to see its details."

## The control strip

A row of controls above the canvas. See
[Navigate the axis](/user-guide/navigate-howto) for use.

| Control    | Label                                                              | Effect                                                   |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `-` button | Zoom out                                                           | Widens the visible span by a fixed step                  |
| `+` button | Zoom in                                                            | Narrows the visible span by a fixed step                 |
| Fit button | Fit every event in view                                            | Frames every event on the visible timelines              |
| Text field | Jump to a date (placeholder); "A year, or any EDTF date" (tooltip) | Takes a year or any EDTF date                            |
| **Go**     |                                                                    | Centres the view on the date in the field                |
| Message    | Not a date this can read                                           | Shown next to **Go** when the field's text is not a date |

Enter in the text field does the same as **Go**.

## The event editor

The panel on the right edits the selected event. Nothing is written until you
press **Save**, except for the actions that write at once: creating an event
by click, dragging one, **Create event** in the create form, **Delete**, and
**Copy** in the duplicate form (which writes to the target timeline).

### With an event selected

| Field or control | Label in the panel | Notes                                                                                              |
| ---------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| Title            | Title              | Free text                                                                                          |
| Date             | Date               | EDTF string. Live feedback beneath it.                                                             |
| End date         | End date           | Optional EDTF string. Same feedback. Cleared when left blank.                                      |
| Description      | Description        | Optional free text. Cleared when blank.                                                            |
| Tags             | Tags               | One chip per tag, each with **Remove**. The field "Add a tag and press Enter" adds a tag on Enter. |
| Sources          | Sources            | One row per link, then **Add source…**. See below.                                                 |
| Save             | Save               | Writes every field, including source changes. A save that changes nothing writes nothing.          |
| Delete           | Delete             | Deletes the event the editor holds, at once, with no confirmation                                  |
| Duplicate        | Duplicate          | Opens the copy form. See [Duplicate an event](/user-guide/duplicate-event-howto).                  |

**Date feedback.** Under each date field the panel names the EDTF form the text
was read as and the range it resolves to, for example "Plain 7/14/1789 –
7/15/1789". The form is one of Plain, Uncertain, Approximate, Interval, One of,
Season or List. The dates are shown in your system's date format. Blank input
shows nothing.

When the text does not parse, the feedback reads "Not a date this can read".
When it parses as two dates but the end does not begin after the start begins,
it reads "The end must begin after the start begins". That check compares the
two start instants, so a pair such as 2001-01-01/2001 is refused too.

Neither message blocks **Save**. The text is stored as typed, and the event
draws as one the plugin cannot place.

**Tags.** A tag is free text, and a tag containing a comma is stored intact.
Case is kept as typed: "Alpha" and "alpha" are two tags.

**Sources.** Each row shows the cited item's label, then **Show in library**, a
type select (tooltip "Type"), a name field (placeholder "Name (optional)") and
**Remove**. The label of a regular item is its title, or "(untitled item)". The
label of a note is a preview of its text, and for a child note the parent's
title follows after a dash. An item that no longer resolves reads "(missing
item)" and has no **Show in library** button. A link whose type no longer
exists reads "(unknown type)" in the select and keeps its stored type until you
choose another. Source changes are written on **Save**. See
[Attach and manage source links](/user-guide/event-sources-howto).

**Duplicate form.** A timeline select (tooltip "The timeline to copy this event
onto"), **Copy** and **Cancel**.

### With nothing selected

The panel reads "Select an event to edit it, or click an empty spot on the
canvas to create one there." Below it sits a create form:

| Field or control | Label        | Notes                                                                       |
| ---------------- | ------------ | --------------------------------------------------------------------------- |
| Timeline         | Timeline     | A select of every loaded timeline, shown only when there is more than one   |
| Title            | Title        | Blank falls back to "Untitled event"                                        |
| Date             | Date         | Required. With it blank, **Create event** does nothing. Same live feedback. |
| Create event     | Create event | Writes the event at once and selects it                                     |

The form has no end date, description, tag or sub-lane field. Add those after
creating the event.

The library's context menu entries "Add to New Event on Timeline…" and "Add to
New Event on…" open this same form with a **Sources** list already filled from
the selected items.

## Tag filter

The "Tags" section lists every tag used by an event on a visible timeline, as
one chip per tag, sorted by character code (capitals before lowercase). Tags on a hidden timeline are not
offered. Tags compare as written, with no case folding.

- Clicking a chip selects it. Clicking it again clears it.
- With several chips selected, an event shows when it carries any of them.
- With any chip selected, an event with no tags is hidden.
- A lane emptied by the filter keeps its row.
- A selected tag that stops being offered (its timeline was hidden, or its last
  event lost it) is dropped from the selection.
- If the filter hides the selected event, the editor goes back to its empty
  state.
- With no tags on the visible timelines, the section reads "No tags on the
  visible timelines yet. Add one from the event editor to filter by it here."

The filter lasts for the session and is not stored.

**The cleared-filter notice.** When you jump to an event from the item pane's
Timelines section and the active filter would hide that event, the plugin clears
the filter so the event can be shown, and a line under "Tags" reads "Tag filter
cleared to show this event." The line disappears the next time the sidebar
redraws, for example when you click a chip. A jump to an event the filter
already shows leaves the filter alone and shows no notice.

## Related

- [What the plugin stores](/user-guide/plugin-data-reference)
- [Getting started](/user-guide/getting-started)
