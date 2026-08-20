# Roadmap

Where the work stands and which version each feature is expected in. This is
the high-level view of what is built, what is planned, and in what order. The
product charter, the numbered requirements and the data model live in the
project's own tracker, which is not published; the milestone and task ids below
are labels from it. Written 2026-08-20.

The charter and the milestone descriptions say "v1". That is this release,
**0.1.0**. The package has been at 0.1.0 since the scaffold and no release has
been cut, so the first published version is the one the v1 scope describes.

## Status

m-0 is done. The plugin loads into Zotero 7 through 10 and registers as
`Zotero.ZoteroTimeline`, the build produces an .xpi plus update JSON, the test
suite runs against a live Zotero, CI covers four Zotero majors, and the docs
site deploys. Nothing user-visible exists yet.

TASK-17 is next, ahead of m-1. It is a spike on the
`introfini/mcp-server-zotero-dev` observability rig, and it comes first because
of what it would unblock rather than what it delivers: `zotero-plugin-scaffold`
discards Zotero's stdout and never passes `-ZoteroDebugText`, so today the only
signal from a running dev instance is Help > Debug Output, read by eye. The
server drives a running Zotero over the Firefox Remote Debugging Protocol and
exposes `Zotero.debug` output, error-console reads, screenshots, the DOM tree
and computed styles. Every one of those is something m-1 through m-5 will need
repeatedly, and most failure modes in this codebase are silent rather than
thrown.

The comparison is not against a good status quo, it is against having no log
stream at all. If the trial works, every milestone after it is cheaper to
verify. If it does not, the answer is recorded and m-1 starts having lost a
day.

m-1, the storage layer, follows it.

## Milestone map

|         | Milestone                   | Expected in      | State                             |
| ------- | --------------------------- | ---------------- | --------------------------------- |
| m-0     | Scaffolding                 | n/a, pre-release | Done                              |
| TASK-17 | Observability rig spike     | n/a, dev tooling | Next up                           |
| m-1     | Storage layer               | 0.1.0            | Planned                           |
| m-2     | Event authoring             | 0.1.0            | Planned                           |
| m-3     | Source links                | 0.1.0            | Planned                           |
| m-4     | Combined view               | 0.1.0            | Planned                           |
| m-5     | Timeline management         | 0.1.0            | Planned                           |
| TASK-16 | Cross-timeline editing      | 0.2.0            | Deferred                          |
| m-6     | Item pane section           | 0.2.0            | Deferred                          |
| m-8     | Library context menu        | 0.3.0            | Deferred                          |
| m-7     | Tags and filtering          | 0.3.0            | Deferred, tags written from 0.1.0 |
| TASK-15 | Sub-lanes within a timeline | unscheduled      | Deferred                          |

Versions past 0.1.0 are an ordering and a rough grouping, not a commitment.

## 0.1.0: m-1 through m-5

Storage, event authoring with EDTF dates, source links, the combined view, and
timeline management. One canvas that renders every open timeline, accepting
edits while exactly one is toggled on and going read-only with the reason shown
when a second joins it.

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
own bar, is an open requirement not yet placed under a milestone. It belongs to
m-2 or m-4 and is expected in 0.1.0 either way.

## 0.2.0: finish the combined view

TASK-16, cross-timeline editing, is the deferred half of the headline feature,
and the charter puts it after v1 deliberately: it is the one place where an
error writes an edit into the wrong timeline and looks like it worked, so it
lands against a real chronology rather than a fixture. The 0.1.0 cycle is what
produces that chronology, which is why this is the first release after it and
not the last.

m-6, the item pane section, rides along because it is small. It adds a reader
over the parse cache that m-1 already ships, not an index, so the cost is the
section chrome and the read timing.

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
