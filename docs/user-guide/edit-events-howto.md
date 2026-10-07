# How to create and edit an event

Put an event on a timeline, change its fields and delete it.

## Prerequisites

- The Timeline tab is open on a library you can edit.
- At least one visible timeline.

## Create an event by clicking

1. Click empty space in the lane of the active timeline, at the date you want.
   The active lane is the highlighted one.

   If the lane is not active, the first click only activates it and creates
   nothing. Click the same spot again.

2. The editor opens on the new event. It is already written, titled "Untitled
   event", with the date you clicked. The date's precision follows the zoom: a
   year when the view spans more than 20 years, a month when it spans more than
   2 years, a day otherwise.
3. Edit the fields and click **Save**. Save writes your edits on top of the event
   that already exists.

An event created by clicking inside a sub-lane's row is created in that
sub-lane. See [Use sub-lanes](/user-guide/sub-lanes-howto).

## Create an event from the form

Use this when you want to type the date instead of clicking for it.

1. Get to the editor's empty state: it is what you see when the tab first
   opens, and after you delete the selected event. The panel reads "Select an
   event to edit it, or click an empty spot on the canvas to create one there."
   The create form sits below that line.
2. Pick the timeline in the "Timeline" select. It appears only when the library
   has more than one timeline.
3. Type a "Title". Blank becomes "Untitled event".
4. Type a "Date". It is required. With it blank, **Create event** does nothing.
5. Click **Create event**. The event is written at once and selected.

The form has no end date, description, tag or sub-lane field. Set those in the
editor that opens.

## Edit an event

1. Click the event on the canvas. Clicking it also makes its timeline active.
2. Change any of these fields:

   - "Title".
   - "Date", an EDTF string such as `1789-07-14`, `1793?` or `1793/1794`. The
     line under the field names how the text was read (Plain, Uncertain,
     Approximate, Interval, One of, Season or List) and the range it covers.
   - "End date", optional. Use it to make the event a range.
   - "Description", optional.
   - "Tags". Type a tag in "Add a tag and press Enter" and press Enter. Click
     **Remove** on a chip to drop it.

3. Click **Save**.

The event redraws at once. Tags you added appear in the sidebar's "Tags"
section.

## Change a date by dragging

Drag an event sideways on the active lane, or drag a range's edge. The drop
writes the new date, and no **Save** is needed. Drag does not work on an event
whose date cannot be read, in a lane that is not active, or in a read-only
library. Type the date instead.

## Delete an event

Select the event and click **Delete**. It is deleted at once, with no
confirmation, and the editor returns to its empty state. If you have just
duplicated an event, the editor still holds the original, so **Delete** removes
the original and not the copy.

## Verification

- After **Save**, the event on the canvas shows the new title, and hovering it
  shows the title and date.
- Unsaved edits are not stored: select another event or close the tab and they
  are gone.

## Troubleshooting

- **The date line reads "Not a date this can read".** The text is not EDTF the
  plugin can parse. **Save** still stores it as typed, and the event draws parked
  after the timeline's latest readable date with the parser's message on hover.
  Correct the date to bring it back.
- **The date line reads "The end must begin after the start begins".** The two
  dates of an interval are in the wrong order, or are mixed precision such as
  `2001-01-01/2001`. Fix the order, or use "End date".
- **Save, Delete and Duplicate are greyed out.** The library is read-only.

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
- [Attach and manage source links](/user-guide/event-sources-howto)
- [Duplicate an event to another timeline](/user-guide/duplicate-event-howto)
