# How to cite library items from the context menu

You will attach one or more library items to a timeline, either as sources on an
existing event or as the sources of a new event.

## Prerequisites

- The library holds at least one timeline.
- The items you select are all from one library. Attachments in the selection are
  ignored.
- For "Add as Sources to…", the timeline has at least one event.

The entries, their forms and the result messages are listed in
[The library item context menu](/user-guide/library-context-menu-reference).

## Add items as sources to an existing event

1. Select the items in the library. Use Ctrl or Shift to select several.

2. Right-click the selection and choose "Add as Sources to Timeline…". If the
   library has several timelines, choose "Add as Sources to…" and then the
   timeline.

3. In the "Add as sources" window, pick the event in the Event select.

4. Pick the link type in the Type select. It starts on the library's first type.

5. Click Attach.

6. Read the result, then click Close.

### Verification

The window reads "Attached N sources." Select one of the items and open its
Timelines section in the item pane: the event is listed there without reselecting
the item. See [How to find which events cite an item](/user-guide/item-pane-howto).

If the window reads "Nothing attached: every selected item was already cited
under this type.", the event already holds an identical, nameless source for
each of them under that type. Choose another type if you want a second
citation.

## Add items to a new event

1. Select the items in the library.

2. Right-click and choose "Add to New Event on Timeline…", or "Add to New Event
   on…" and then the timeline.

3. If a confirmation titled "Switch to a different library?" appears, the
   Timeline tab is open on another library. Confirm to switch; this discards the
   current view and any unsaved editor changes.

4. If a confirmation titled "Discard the current edit?" appears, an event is
   selected in the editor. Confirm to replace it. Cancel to keep
   it and stop.

5. In the create form, check that Sources lists your items.

6. Type a title. Leave it blank to get "Untitled event".

7. Type a date. The form requires one and does nothing without it. Examples:
   `1789-07-14`, `1777/1783`.

8. Click "Create event".

### Verification

The new event is selected in the editor and drawn on the timeline, and its source
list shows your items under the library's first link type.

## Troubleshooting

- **No entries in the menu.** Either the selection holds only attachments or
  plugin items, or the library has no timeline. Create one in the Timeline tab
  first.
- **The entry is greyed out, with a tooltip about more than one library.** The
  selection spans libraries. Select items from one library at a time.
- **Only the flat entry shows, greyed out, although the library has several
  timelines.** Same cause: a split selection never shows the submenu.
- **"Create event" does nothing.** The date is blank. A date the plugin cannot read shows "Not a date this can read" under
  the field. In a library that cannot be written, the button is disabled.
- **A source has the wrong type.** Both actions let you pick the type only in
  "Add as Sources to…". After "Add to New Event on…", change it in the event
  editor.
