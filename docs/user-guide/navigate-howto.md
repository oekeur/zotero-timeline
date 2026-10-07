# How to navigate the axis

Move the view to a date, zoom in and out, frame everything, and change an
event's date by dragging.

## Prerequisites

- The Timeline tab is open with at least one visible timeline.

## Jump to a date

1. Type a year or any EDTF date in the field marked "Jump to a date", such as
   `1800` or `1789-07-14`.
2. Click **Go**, or press Enter.

The view centres on the start of that date and keeps its current zoom, so a jump
changes where you are and not how much you see. It selects nothing and writes
nothing. A blank field does nothing.

If the text is not a date, "Not a date this can read" appears beside **Go** and
the view does not move.

## Zoom

- Click the `-` button ("Zoom out") to widen the view, or the `+` button ("Zoom
  in") to narrow it. Each click is a fixed step.
- Hold Ctrl and scroll on the canvas.

Zoom also decides the precision of an event you create by clicking: a year
beyond a 20-year view, a month beyond a 2-year view, a day below that.

## Fit every event

Click the button labelled "Fit every event in view". The view frames every event
on the visible timelines, with a small margin. Events on hidden timelines do not
widen it.

## Change a date by dragging

Drag an event sideways in the active lane. For a range, drag an edge to change
its date or end date. The date is written on the drop, with no **Save**. A year
date stays on January 1 and a day date keeps the day you dropped it on.

Dragging does nothing for:

- an event in a lane that is not active (click its name or one of its events
  first);
- an event whose date the plugin cannot read, which sits parked after the
  timeline's latest readable date;
- any event in a read-only library.

## Verification

- After a jump, the date you typed sits in the middle of the axis.
- After a drag, select the event: the "Date" field shows the written date.

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
- [Create and edit an event](/user-guide/edit-events-howto)
