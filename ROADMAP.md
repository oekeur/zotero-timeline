# Roadmap

Which version each feature is expected in, and why the groupings are what they
are. Direction rather than status: what is built is read from the tracker and
from git, never from here. The product charter, the numbered requirements and
the data model live in the project's own tracker, which is not published; the
milestone and task ids below are labels from it. Written 2026-08-20, revised
2026-08-23.

The charter and the milestone descriptions say "v1". That is this release,
**0.1.0**. The package has been at 0.1.0 since the scaffold and no release has
been cut, so the first published version is the one the v1 scope describes.

## What has been built, and where to read it

Not here. What is done and what is open is read from
`scripts/backlog.sh task list --plain`, from `git tag` and the GitHub releases,
and from `src/`. A hand-maintained status column in this file drifts the moment
a task lands, and the one that used to sit in the table below said m-4 was next
up and m-2 unstarted two days after m-2 merged. `CLAUDE.md` makes the same rule
for the same reason.

What belongs here is direction and the reasoning behind the grouping, which does
not go stale, plus one piece of history that explains the shape of the work.

**The planned build order was m-1, m-4, m-2, m-3, m-5, and that is not what
happened.** m-2 was built against TASK-4's rendering spike rather than waiting
for m-4, and in doing so it shipped a real part of m-4: the tab, the canvas with
one lane per timeline, drag write-back through the namespaced id, and
click-empty-canvas to create. So m-4 is half built and out of order.

What is left of m-4 is therefore smaller and differently shaped than its
milestone description implies: telling the EDTF forms apart on the canvas,
parking an unreadable date, the visibility and ordering sidebar, the active
timeline that makes an edit's target legible, permission-based read-only,
navigation chrome, the Tools entry and its shortcut, live refresh, and R13.
`project/backlog/plans/2026-08-22-m-4-combined-view.md` lists what already
exists so none of it is rebuilt.

Milestone numbers are identifiers, not a sequence, and the table below is sorted
by number rather than by the order the work happens in.

## Milestone map

|         | Milestone                   | Expected in      |
| ------- | --------------------------- | ---------------- |
| m-0     | Scaffolding                 | n/a, pre-release |
| TASK-17 | Observability rig spike     | n/a, dev tooling |
| m-1     | Storage layer               | 0.1.0            |
| m-2     | Event authoring             | 0.1.0            |
| m-3     | Source links                | 0.1.0            |
| m-4     | Combined view               | 0.1.0            |
| m-5     | Timeline management         | 0.1.0            |
| m-6     | Item pane section           | 0.2.0            |
| m-8     | Library context menu        | 0.3.0            |
| m-7     | Tags and filtering          | 0.3.0            |
| TASK-15 | Sub-lanes within a timeline | unscheduled      |

Versions past 0.1.0 are an ordering and a rough grouping, not a commitment.
Which of these are done is a tracker question, not a roadmap one.

## 0.1.0: m-1 through m-5

Storage, event authoring with EDTF dates, source links, the combined view, and
timeline management. One canvas that renders every open timeline and accepts
edits on any of them, with one lane active at a time so a gesture's target is
on screen before it is made. Read-only is left for the one case that earns it,
a library the user cannot write, with the reason shown.

### m-1, the storage layer

TASK-9 comes first and nothing else can start without it: the per-library
container item is what every note hangs off. From there the graph opens up.

1. TASK-9 create and guard the per-library container item
2. TASK-6 tell the two note kinds apart by tag, TASK-10 document schema and validation
3. TASK-7 refuse a document versioned above the code, TASK-11 read path, TASK-14 warn when a plugin item is trashed
4. TASK-8 recover a missing vocabulary note, TASK-12 write path, TASK-13 parse cache
5. TASK-18 warn before a document outgrows the note ceiling

TASK-18 exists because the ceiling was measured on 2026-08-20 and Zotero
enforces it server-side only: 500,000 UTF-16 units, roughly 1,100 events per
document, with no client-side check. An oversized document saves locally and
fails at sync. The plugin warns first.

R13, an event title staying readable rather than clipping to the width of its
own bar, belongs to m-4, as TASK-44. The clipping is a property of the render
path rather than of authoring: TASK-4 traced it to `white-space: nowrap` and
`overflow: hidden` in vis-timeline's own stylesheet, so whatever draws an event
has to solve it deliberately, by drawing the label outside the bar or letting it
overflow.

The original plan was that m-4 landed before m-2, so titles would be readable as
soon as anything was drawn at all. The build order went the other way, so the
canvas draws today with the clipping unaddressed. R13 is an open defect on a
live surface rather than a property guaranteed by ordering.

## 0.2.0: the item pane section

Cross-timeline editing used to sit here, as the deferred half of the headline
feature. It moved into 0.1.0 on 2026-08-26, once reading `canvas.ts` showed the
hazard it was deferred for was already closed: every write derives its target
document from the namespaced id, so attributing an edit never depended on how
many timelines were drawn. What was left was making the target legible, which
is the active timeline, and that belongs beside the canvas it acts on.

m-6, the item pane section, is what is left here. It adds a reader over the
parse cache that m-1 already ships, not an index, so the cost is the section
chrome and the read timing. It answers "which events cite this item" from the
item pane, which is the question a reading session asks and the tab cannot.

## 0.3.0: more ways in

m-8 puts two actions on the Zotero item context menu, which is the gesture from
a reading session: the source is what you have and the event is what you are
about to write. Without it, attaching a source means opening the timeline tab
first.

m-7 filters every open timeline by tag, which surfaces the same moment recorded
on two timelines. Events carry `tags` from 0.1.0 onward, so this is a read
feature rather than a document migration, and nothing authored in the meantime
is lost.

Neither changes the stored shapes. That is why they pair.

## 1.0.0

No new scope of its own. It is the marker for the project's success signal
holding up: the primary user has built a real chronology and put
two timelines side by side to defend a claim, and the storage has survived
months of edits and syncs without a shape change. Cut it when that is true, not
on a feature count.

## Unscheduled

TASK-15 adds sub-lanes within one timeline via `nestedGroups`. A timeline is
exactly one lane by decision, and the merge does not change when sub-lanes
arrive, so nothing forecloses it and nothing forces it either.

Three drafts claim no slot: export as an image and as a note outline (draft-2),
search across events (draft-3), and a list view of a timeline's events
(draft-4). All three are wanted. Search is the strongest candidate to be pulled
in, since the storage model makes events invisible to Zotero's own search and
tag filtering only covers part of that.

No dates anywhere here. Nothing has shipped yet, so there is no velocity to
project from, and a schedule invented now would be a guess dressed as a plan.
