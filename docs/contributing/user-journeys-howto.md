# Walking the user journeys

The manual half of the verification protocol, written down. `scripts/verify.sh`
covers build, lint and whether the plugin initialized; the Mocha suite covers
storage, the schema, the editor's field logic and the parts of the UI that can
be driven from a spec. What neither covers is a sequence: make a timeline, put
an event on it, cite an item from it, find that item in the library, jump back
to the event, hide the timeline, rename the link type, delete the timeline. The
seams between the storage write queue, the item-pane section's render gates,
vis-timeline's DataView filtering and the sidebar's own state only misbehave in
that order, and every defect the merge gates found in September 2026 sat on one
of those seams while the suite was green.

So this is a checklist, not a test runner. It names the selector, what you
should see, and the probe that proves it rather than suggesting it. An agent
drives it through the MCP rig; a human drives it by hand and reads the same
expectations.

Run the journeys that touch what you changed. Running all seven takes roughly
half an hour and is the right call before a release, not before every commit.

Every step below except three has been walked against 10.0-beta.25 on
2026-09-14, in order, from the seeded fixture, through the rig. The three
that have not are marked: J2 step 5 (drag, not stageable from the rig), J4
step 2 (a split-library selection needs a second writable library) and J6
step 5 (a read-only library; the profile's one group library is editable).
The first walk corrected eleven expectations and filed four defects
(TASK-73 to TASK-76, all landed since, with TASK-71 and TASK-74 from the
same pass); expect the same rate again after any change to the files the
last section names.

## Before you start

Bring up a dev Zotero for this checkout, seeded and observable.

1. In a worktree, run `~/.claude/scripts/worktree-init.sh` first. Without it
   this checkout shares the one dev profile with every other, and two instances
   on one profile fail in ways that look like your bug.
2. `npm start` if you are watching the UI, `npm run start:headless` if you are
   not. Headless goes through `scripts/headless.mjs`, which is what makes it
   headless on a Wayland session and what reaps a stranded Xvfb from a killed
   run; see `CLAUDE.md`.
3. Seed the library. Cheapest from an agent is to let Zotero read the file
   itself rather than pushing it through the tool call:

   ```js
   const src = await Zotero.File.getContentsAsync(
     "<abs path>/scripts/seed-dev-profile.js",
   );
   return await eval(src);
   ```

   By hand: Tools → Developer → Run JavaScript, paste, tick "async", Run. It
   reports what it created, and re-running reports `created: 0` rather than
   duplicating.

4. Note which MCP client answers for this checkout. It is keyed by
   `ZOTERO_MCP_RDP_PORT` in your `.env`: the bare `zotero-dev` entry is the main
   checkout on 6100; a worktree is `zotero-dev-<port>`. zoteroMindmap's entries
   sit on 6106 and up and answer confidently about the wrong Zotero. Confirm
   with `zotero_ping` and read the data directory it reports.
5. `zotero_clear_logs`, so the error reads below start from a clean slate.

The fixture gives you five journal articles, one book and a standalone note in
a **Timeline Journeys** collection, all tagged `_zt-journey-fixture`. Journeys
refer to them by short name: _Bastille_, _Terror_, _Napoleon_ (the book),
_Lavoisier_, _Principia_, _Waterloo_, _Notes_.

## The item-pane section reads as empty for a moment

The Timelines section draws its body from `onRender`, which cannot be async,
so the read runs detached and the body is empty in the tick the selection
lands. Read it a moment later, or poll it. An empty body in the same tick is
not a failure, and the error console being clean is the tell.

The section sits below Related and needs `scrollIntoView()` before a
screenshot. Select it as
`item-pane-custom-section[data-pane*="citing-events"]`; the full `data-pane`
is the pane id namespaced by the addon id and CSS-escaped
(`zoterotimeline\@oekeur\.github\.io-zoterotimeline-citing-events`), not a
bare `citing-events`.

## Driving the rig: what will waste your time

All of these were paid for in September 2026 and are recorded with the
measurement in the project memory; the short form is here.

**A blocking native prompt hangs the whole bridge, not just the call.** The
discard-the-current-edit confirm and the delete-timeline confirm are
`Services.prompt` modals. While one is up `zotero_ping` still answers but
every `zotero_execute_js` and `zotero_screenshot` times out with
`Request timeout for listTabs to root`, so the enumerate-and-close recipe
cannot run. The way out is `xdotool` on the Xvfb display the instance was
launched on: read `DISPLAY` from `/proc/<zotero pid>/environ` and the
`Xauthority` path from the `Xvfb` process's `-auth` argument, list windows
with `xdotool search --onlyvisible --name "."`, and click the OK button by
coordinates derived from the dialog's own geometry. `xdotool key Return` did
not dismiss it. Better: install the test seam first
(`api.setCrossLibrarySwitchConfirmForTests`,
`api.setTimelineDeleteConfirmForTests`) when a journey step is going to raise
one, and say so in the step.

**A synthesized `command` event does nothing to a XUL menuitem.**
`dispatchEvent(new Event("command"))` returns `false` and reaches no listener.
Use `zotero_click_element`, which calls `element.click()` and fires the real
command even with the popup closed. Populate a submenu first by dispatching
`popupshowing` on `#zotero-itemmenu`; ztoolkit builds the entries in its
`isHidden` callback. Do not `openPopup()` a native menu under Xvfb; the next
eval returns `undefined` and then times out, the same signature as a modal.

**`getSelection()` lies about landing.** vis-timeline 8.5.4's
`ItemSet.setSelection` assigns the ids unconditionally, so a selected id whose
item the tag filter has removed from the view still comes back from
`getSelection()`. Proof that a jump landed is
`timeline.itemsData.get("<documentId>:<eventId>") != null`, where
`timeline = api.getCurrentTimeline()`.

**Two DataSets, one of them a view.** `timeline.groupsData` is a DataView
over the visible groups; `get()` on a hidden timeline's group returns `null`.
Reading visibility through it looks like the timeline does not exist. Read
`api.getVisibleTimelines()` for what is showing. It stays current through a
click-to-create since TASK-71 landed; reading back through a fresh
`listTimelines` is still the stronger check when a step has just written.

**Every `zoterotimeline-*` class is scoped, and the sidebar repeats them.**
`.zoterotimeline-sidebar-row-visible` is one checkbox per timeline;
`zotero_click_element` on it takes index 0. Find the row by its
`.zoterotimeline-sidebar-row-name` text and click the checkbox inside it
through `execute_js`.

**The plugin's pane loads on demand.** `zotero_open_preferences` with
`zoterotimeline@oekeur.github.io-pane` lands on the pane; the Settings window
is a separate window (`zotero:pref`), so find it through
`Services.wm.getEnumerator(null)` by `location.href` containing
`preferences.xhtml`. Its computed `min-width` is 800 CSS px; forcing it
narrower with `xdotool windowsize` clips Zotero's own controls too and proves
nothing.

**`serve` hot-reloads scripts, not static assets.** After a change to
`addon/content/preferences.xhtml` or a locale file lands, the running dev
Zotero still shows the old pane until `npm start` is restarted. A pane that
looks unchanged after a merge is usually this.

**The journeys are not independent.** J2 through J5 assume the tab is open
on the timeline J1 built; J3's item-pane steps assume J2's event cites
_Bastille_; J7's rename step assumes J3's source exists. Reopening the tab
after a close restores the sidebar's order, not your selection. Run J1 first.

## The rule that makes this worth doing

After every journey, run `zotero_read_errors`. A step whose UI looked right
and whose error log gained an entry is a **failed step**. Most failures in
this codebase are silent rather than thrown; three of the seven gate-confirmed
defects in September 2026 showed a correct-looking screen.

`zotero_read_errors` keeps the last 25 entries; read after each journey rather
than at the end. From a spec, `Zotero.getErrors(true).join("\n")` in an
assertion message gives the same list.

---

## J1 · First run: open the tab and make a timeline

Covers the Tools entry, the empty canvas prompt, the sidebar's create form,
and the container and storage notes everything else hangs off. Run this first
after any storage change.

Walked in full on 2026-09-14. Measured detail worth knowing: on a library
with no timelines `api.getActiveTimeline()` is `null` after the first create,
and stays `null` after the second; nothing is active until a selection or a
click-to-create.

1. **Do** Tools → Timeline (menuitem `#zotero-timeline-menuitem-open-timeline`),
   or press Shift+T with the library focused.
   **Expect** a tab titled "Timeline" of type `zoterotimeline-timeline`
   (`Zotero_Tabs.selectedType`), holding `.zoterotimeline-sidebar` with the
   heading "Timelines" and a `+` control
   (`.zoterotimeline-sidebar-create-button`), `.zoterotimeline-canvas`, and
   `#zoterotimeline-editor` on the right reading "Select an event to edit it,
   or click an empty spot on the canvas to create one there." On a library
   with no timelines the canvas shows `.zoterotimeline-canvas-empty-prompt`:
   "This library has no timelines yet. Use the plus control in the sidebar to
   make one." Unlike zoteroMindmap, nothing is created for you.
   **Probe** `zotero_get_dom_tree` rooted at `.zoterotimeline-tab-body`. Then
   `Zotero_Tabs.select("zotero-pane")` and Tools → Timeline again: the
   existing tab is selected, no second tab. One timeline tab per process.

2. **Do** Click `+`. Fill `.zoterotimeline-sidebar-create-name` with
   `Revolutions`, click `.zoterotimeline-sidebar-create-confirm`.
   **Expect** the form closes; a `.zoterotimeline-sidebar-row` appears with
   that name, its `.zoterotimeline-sidebar-row-visible` checkbox ticked, and
   the row carries reorder (`↑` `↓`), rename (`✎`) and delete (`×`) controls.
   The canvas gains one empty lane labelled "Revolutions"; the empty prompt is
   gone.
   **Probe** `zotero_db_query`:
   `SELECT COUNT(*) FROM itemTags JOIN tags USING (tagID) WHERE tags.name = '_zoterotimeline-storage-v1'`
   returns 1, and the same query for `_zoterotimeline-container-v1` returns 1.

3. **Do** Make a second timeline, `Scientific work`.
   **Expect** a second lane below the first; the storage-note count is 2, the
   container count still 1. `api.getActiveTimeline()` does **not** move to
   the new timeline: creating one never activates anything (`null` on a fresh
   library, unchanged on a populated one). Activation follows selection and
   the click-to-create gesture (J5 step 3), not creation.

4. **Do** Look at the library root for an item titled "Zotero Timeline data".
   **Expect** with the default preference it is hidden from the item tree.
   J7 turns the preference off and checks it appears, with the storage notes
   as its children.

5. **Do** Close the tab (`Zotero_Tabs.close(...)` or the tab's ×), then Tools
   → Timeline again.
   **Expect** both timelines back, in the same order, both visible; the
   editor panel back at its empty prompt.

**Then** `zotero_read_errors`.

---

## J2 · Author events: click, type, tags, duplicate, delete

Covers the click-to-create gesture, the editor's fields and EDTF feedback,
tags, the duplicate form and deletion. Walked on 2026-09-14 except step 5
(drag). This journey found three of the four defects the first walk filed;
read the expectations as they are now, not as the source suggests.

1. **Do** With _Revolutions_ visible, click an empty spot on its lane. From the
   rig: `api.getCurrentTimeline().emit("click", { item: null, group: "<documentId>", time: new Date("1789-07-14T12:00:00Z"), event: {} })`
   drives the same handler; a real click also works through
   `zotero_click_element` with `mouseEvents: true` on the lane's background.
   **Expect** the **standard editor**, not a separate create form: the
   `-create-*` classes belong to the context-menu path (J4). The draft shows
   `.zoterotimeline-event-title`, `.zoterotimeline-event-date` prefilled
   `1789-07-14`, `.zoterotimeline-event-date-feedback` reading
   `Plain 7/14/1789 – 7/15/1789`, and Save / Delete / Duplicate. The draft is
   already drawn on the lane (`itemsData.length` goes up by one) and the lane
   becomes active, but nothing is written: the storage note's `getNote()` is
   byte-for-byte unchanged until Save.
   The draft's title field reads `Untitled event` until it is edited.

2. **Do** Type `Bastille falls`, press Save.
   **Expect** the note now holds one event with that title and date; the box
   stays selected and drawn.
   **Probe** read the note directly: `(await Zotero.Items.getAsync(<noteItemID>)).getNote()`
   contains `"title":"Bastille falls"`. `api.getVisibleTimelines()` lists
   the event too (it used to report the pre-create document after a
   click-to-create; TASK-71 fixed that). The instance from
   `api.getCurrentTimeline()` is replaced by any rebuild; re-read it after
   every write rather than holding it across one.

3. **Do** Change the date to `1793?`, then `1793/1794`, then `not a date`,
   dispatching `input`, `change` and `blur` each time.
   **Expect** `Uncertain 1/1/1793 – 1/1/1794`, then
   `Interval 1/1/1793 – 1/1/1795`. For `not a date` the feedback element
   reads `Not a date this can read` (one line; the edtf grammar dump goes
   to the debug log only), Save stays enabled, the string is stored as
   typed and the event draws parked with edtf's own message as its hover
   title. A pair of readable dates in the wrong order, `1590/1580`, reads
   `The end must begin after the start begins` instead; edtf compares the
   two bounds' start instants, so `2001-01-01/2001` is refused the same way.
   Set the date back to `1789-07-14` before going on.

4. **Do** Add a tag `alpha` in `.zoterotimeline-event-tag-input` with an
   Enter `keydown`, then Save.
   **Expect** a `.zoterotimeline-event-tag` chip in the editor, and the note
   now carries `"tags":["alpha"]`. The sidebar's Tags section
   (`.zoterotimeline-sidebar-tags`) offers `alpha` after the save, for a
   click-created event as much as for one opened fresh (the chip bank read
   a stale snapshot before TASK-71).

5. **Not walked.** Drag the box a decade to the right. vis-timeline's drag
   needs real pointer events with movement between them; the rig cannot
   stage it. By hand: the date field updates on drop and
   `api.getLastMovePayload()` names the event and the new date. The suite's
   `timelineDrag.test.ts` covers it through Hammer.

6. **Do** Click Duplicate (`.zoterotimeline-event-duplicate`), pick
   _Scientific work_ in `.zoterotimeline-event-duplicate-target` (dispatch
   `change`), click `.zoterotimeline-event-duplicate-confirm`.
   **Expect** a second item drawn on the _Scientific work_ lane with its own
   id; the **editor stays on the original** and the selection does not move.
   The copy carries the title, tags and description **as last saved**,
   including for a click-created event titled and tagged in the same editor
   session (before TASK-74 it copied the event as it was when the editor
   opened). Unsaved edits are not copied: Duplicate reads the stored event.

7. **Do** Click Delete (`.zoterotimeline-event-delete`).
   **Expect** it deletes the event the editor holds, which after step 6 is
   the **original**, not the copy. The box disappears, the editor returns to
   the empty prompt, the selection is empty. To delete the copy, select it
   first.

**Then** `zotero_read_errors`.

---

## J3 · Sources: cite an item, find it, jump back

Covers the editor's source picker, the type select, "Show in library", the
item-pane Timelines section, and the jump from that section back to the event,
including the hidden-timeline reveal. Walked in full on 2026-09-14 (steps 4
to 7 also on 2026-09-10).

1. **Do** With _Bastille falls_ selected, click "Add source"
   (`.zoterotimeline-event-source-add`) and pick _Bastille_ in Zotero's own
   picker.
   **Expect** the picker is `selectItemsDialog.xhtml` in its own window
   (`zotero:item-selector`) and blocks `zotero_execute_js` against the main
   window until it closes. Drive it by `windowId` from `zotero_list_windows`:
   rows are `#item-tree-select-items-dialog-default-row-N` with
   `mouseEvents: true`; accept with `button[dlgtype="accept"]`. On this
   rig the picker also took the MCP bridge's console actor down
   (`Could not find Zotero console actor`) until it closed, so drive it with
   `xdotool` by coordinates if `windowId` addressing fails: the dialog opens
   at 0,0, 800x450, rows about 28 px apart from y≈110, Select at (742,420).
   On accept a `.zoterotimeline-event-source` row appears with the item's
   title, a type select (`.zoterotimeline-event-source-type`) defaulting to
   `cites`, a "Name (optional)" field, Show in library and Remove.
   **Expect** the source is **not yet stored**: sources are written on Save
   like every other field. Press Save.
   **Probe** the storage note's event now has one source
   `{kind: "item", libraryID, key, typeId: "cites"}`.

2. **Do** Add _Notes_ (the standalone note) as a second source.
   **Expect** the row's label is the note's title followed by a preview of
   its body ("Reading notes on 1789 A standalone note. It can be cited as…"),
   the same label the item pane uses. Save. The fixture has no attachment;
   if you add one, picking it is refused with a message naming why.

3. **Do** Click "Show in library" on the _Bastille_ row.
   **Expect** `Zotero_Tabs.selectedID` becomes `zotero-pane` and _Bastille_ is
   selected in the item tree.

4. **Do** Scroll the Timelines section into view.
   **Expect** a group headed "Revolutions" (`.zoterotimeline-citing-group-heading`)
   with one `.zoterotimeline-citing-row` carrying `data-timeline-id`,
   `data-event-id`, `data-note-item-id`, the title "Bastille falls" and a meta
   line `1789-07-14 · Bastille … — cites`. An item nothing cites shows
   `.zoterotimeline-citing-empty`: "Not cited by any event."
   **Probe** `zotero_screenshot` with `highlightSelector: ".zoterotimeline-citing-row"`.

5. **Do** Click the row.
   **Expect** the Timeline tab is selected, `timeline.getSelection()` is
   `["<documentId>:<eventId>"]`, `itemsData.get(...)` is non-null, the editor
   shows "Bastille falls", and `api.getActiveTimeline()` is _Revolutions_.
   This is the whole of TASK-49 #4 as walked.

6. **Do** Back on the Timeline tab, untick _Revolutions_ in the sidebar
   (click the checkbox inside its row). Return to the library, select
   _Bastille_, click the row again.
   **Expect** _Revolutions_ is visible again, the selection landed, and every
   timeline that was visible before is still visible. No entry in
   `zotero_read_errors` from the vis group path; the sidebar toggle used to
   throw `can't access property "hide", groups[groupId] is undefined` when any
   loaded timeline held a parked event, and that path is now coalesced.

7. **Do** Select _Waterloo_ (cited by nothing).
   **Expect** `.zoterotimeline-citing-empty`: "Not cited by any event."; the
   section is not `hidden`. For an attachment (add one to the fixture if you
   need this) the section is `hidden` and its body keeps the previous text,
   so read `hidden`, not the text. The container note cannot be selected
   while the hide preference is on.

**Then** `zotero_read_errors`.

---

## J4 · The library context menu

Covers "Add as Sources to…" and "Add to New Event on…", their flat versus
submenu shapes, the refusal on a split selection, the discard prompt, and the
partial-result message. Walked on 2026-09-14 except step 2 (needs a second
writable library).

1. **Do** In the library select _Terror_ and _Napoleon_, then open the item
   context menu. From the rig: dispatch `popupshowing` on `#zotero-itemmenu`,
   then read the two entries.
   **Expect** with two timelines in the library both entries are submenus
   (`#zotero-timeline-menuitem-add-sources-submenu`,
   `#zotero-timeline-menuitem-add-to-new-event-submenu`) listing both
   timelines, each label ending in an ellipsis; the flat forms are hidden.
   With exactly one timeline the flat forms show instead.

2. **Not walked.** Add an item from a second writable library to the
   selection, if you have one; otherwise skip.
   **Expect** the entries stay visible but disabled, with a tooltip naming the
   split library. Nothing is written.

3. **Do** Pick "Add to New Event on…" → _Scientific work_. From the rig use
   `zotero_click_element` on `#zotero-timeline-menuitem-add-to-new-event-submenu menupopup > menuitem`
   with the right `index`.
   **Expect** if the editor holds an event, a native confirm "Discard the
   current edit?" opens first, wording "This will replace what the editor is
   showing. Anything there that hasn't been saved will be lost." This is the
   prompt that hangs the bridge; see the traps section, or install
   `api.setCrossLibrarySwitchConfirmForTests(() => true)` beforehand. On OK
   the tab is selected, _Scientific work_ is made visible and active, the
   create form opens with Sources already listing the two items, title and
   date empty. The storage note is unchanged.

4. **Do** Type a title, leave the date empty, press Create.
   **Expect** nothing happens: no write, form still open. Date is required.

5. **Do** Fill the date `1777/1783`, press Create.
   **Expect** one event on _Scientific work_ with two sources, each carrying
   kind, libraryID and key; the new event selected. Back in the library, the
   Timelines section for _Terror_ lists it without any reselection, which is
   the storage-write signal reaching the section while its tab was hidden.

6. **Do** Select _Terror_ alone, "Add as Sources to…" → _Revolutions_.
   **Expect** a dialog window titled "Add as sources" with an event select
   (`.zoterotimeline-add-sources-event`), a type select and Attach. Pick
   _Bastille falls_, Attach.
   **Expect** the result (`.zoterotimeline-add-sources-result`) reads
   "Attached 1 source." and the Attach button hides itself: the dialog is
   one-shot, and a second click on it does nothing (do not read that as a
   missing refusal). Close it, **reopen** it for the same item and attach
   again: two lines, "Nothing attached: every selected item was already
   cited under this type." and "Already cited under this type, so not
   attached again: Terror …", and the dismiss button now reads Close. The
   stored sources hold the ref once.

7. **Do** `Zotero.openMainWindow()`, wait a few seconds, read the second
   window's document.
   **Expect** all four context entries and the Tools entry present exactly
   once in each window (`querySelectorAll('#<id>').length === 1` in both),
   and the first window's entries intact after the second closes. The
   entries act on the clicking window's selection. "Add to new event" from
   the second window with no tab open lands the tab in
   `Zotero.getMainWindow()` rather than the clicking window (TASK-72, open).

**Then** `zotero_read_errors`.

---

## J5 · Several timelines: visibility, order, tags, navigation

Covers the sidebar checkboxes, reorder, the active timeline, the tag filter
chips and their interaction with a jump, jump-to-date, zoom and fit. Steps 4
and 5 also on 2026-09-11; walked in full on 2026-09-14.

1. **Do** Untick _Scientific work_ (click the checkbox inside its row).
   **Expect** its lane disappears; `api.getVisibleTimelines()` no longer lists
   it; if it was active, `api.getActiveTimeline()` moves to the topmost
   visible timeline (measured). Tags only it carried leave the chip bank.

2. **Do** Tick it back, then press `↓` on _Revolutions_.
   **Expect** the lanes swap. Closing and reopening the tab **restores the
   original order**: order is vis `groupOrder` state for the session, and
   TASK-39 set no persistence criterion. Whether it should persist is an
   open product question, recorded in the last section, not a defect.

3. **Do** Click a box on _Scientific work_ while _Revolutions_ is active.
   **Expect** the active timeline follows the selection: the lane label gets
   the active styling and the editor edits that event. A click on an empty
   spot of a non-active lane both activates it and opens the create form
   there.

4. **Do** Give _Bastille falls_ the tag `alpha` and the _Scientific work_
   event the tag `beta`, if J2 did not. Click the `beta` chip.
   **Expect** `api.getSelectedTagFilter()` is `["beta"]`; the `alpha`-only
   event is no longer in `itemsData`; its lane stays (an emptied lane keeps
   its row). An event with no tags is hidden under any active filter: that is
   the defined behaviour, not a defect.

5. **Do** With `beta` still selected, go to the library, select _Bastille_,
   click its row.
   **Expect** the filter is cleared, the chips all unselected, the event
   drawn and selected, and one line under the Tags heading
   (`.zoterotimeline-tag-filter-notice`): "Tag filter cleared to show this
   event." Click any chip: the notice is gone. A jump onto an event the filter
   already admits leaves the filter untouched and shows no notice.

6. **Do** Type `1800` in `.zoterotimeline-jump-date`, press Go.
   **Expect** `timeline.getWindow()` now spans roughly 1796 to 1803; the
   error element is empty. Then `not a date`: `.zoterotimeline-jump-error`
   reads "Not a date this can read" and the window is unchanged.

7. **Do** Zoom in twice (`.zoterotimeline-zoom-in`), then Fit
   (`.zoterotimeline-fit`).
   **Expect** each zoom narrows `getWindow()`; Fit brings every visible
   event back with a margin (events at 1789 to 1794 gave 1788 to 1795);
   hidden timelines' events do not widen it.

**Then** `zotero_read_errors`.

---

## J6 · Rename, delete, recover

Covers the sidebar's rename and delete controls, the delete confirm, what the
item-pane section shows for a deleted timeline, the unreadable-note banner,
and a read-only library. Walked on 2026-09-14 except step 5 (this profile's
one group library is editable). Step 3 found TASK-76.

1. **Do** Click `✎` on _Scientific work_. The row swaps its name for
   `.zoterotimeline-sidebar-row-rename-name` with Rename
   (`.zoterotimeline-sidebar-row-rename-confirm`) and Cancel beside it. Type
   `Science` and click Rename: an Enter `keydown` on the input does **not**
   commit it.
   **Expect** the lane label and the row change; the Timelines section for
   _Terror_ (cited from that timeline in J4) shows the new group heading on
   its next render.

2. **Do** Click `×` on _Science_.
   **Expect** a native confirm titled "Delete timeline". Install
   `api.setTimelineDeleteConfirmForTests(() => true)` first from the rig, or
   be ready with `xdotool`. On confirm the lane and row are gone, the storage
   note is in the trash (not erased), the container remains, and _Terror_'s
   Timelines section no longer lists the event.
   **Probe** `zotero_db_query`:
   `SELECT COUNT(*) FROM deletedItems WHERE itemID IN (SELECT itemID FROM itemTags JOIN tags USING (tagID) WHERE tags.name = '_zoterotimeline-storage-v1')`
   went up by exactly one, and the live count (the same join with
   `itemID NOT IN (SELECT itemID FROM deletedItems)`) down by one. Count
   before and after; a dev library often already holds a trashed note from an
   earlier session.

3. **Do** Restore the note from the trash (`item.deleted = false; saveTx()`,
   or the library UI).
   **Expect** the open tab lists it again without a reopen, with its events
   and sources intact (before TASK-76 the observer only rebuilt on a
   `modify` of a note the tab already held). Trashing the plugin's
   container item instead hides every timeline at once, since Zotero's
   search excludes child notes of a trashed parent: the sidebar empties and
   the canvas prompt names the container in the trash; restoring the
   container relists them, and erasing it permanently returns the prompt to
   the no-timelines text. Trashing the last note with the container live
   keeps the no-timelines prompt, and the plus control still creates.

4. **Do** Corrupt a storage note by hand (`setNote()` with a character
   removed inside the JSON, `saveTx()`).
   **Expect** with the tab open, the previous render **stays**: the lane and
   its events remain drawn and no row turns unreadable, which is the
   "leaves the previous render standing when a note stops parsing" rule the
   suite asserts. The Timelines section for a cited item shows
   `.zoterotimeline-citing-unreadable-note` ("A timeline in this library
   could not be read; this list may be incomplete.") on its next render, and
   `zotero_read_errors` gains `[zoteroTimeline] skipping unreadable timeline
note <id> …` entries: **those two are the expected outcome of this step,
   not a failed step**. Reopening the tab shows
   `.zoterotimeline-sidebar-row-unreadable` for it. Nothing writes to the
   corrupt note. Put the character back and it comes back.

5. **Not walked** (needs a read-only library). If you have one, open the
   tab with it selected.
   **Expect** `.zoterotimeline-read-only-banner`, the create control absent,
   the canvas prompt "This library has no timelines." rather than the plus
   instruction, and the editor refusing edits.

**Then** `zotero_read_errors`.

---

## J7 · Preferences: hidden items, link types, feedback, Dutch

Covers the hide-notes preference, the vocabulary editor and its live effect
on the item pane, the two feedback buttons, and the nl-NL bundle. Steps 2 to
5 on 2026-09-12 and 2026-09-14, step 1 on 2026-09-14; walked in full.

1. **Do** Open Settings → Zotero Timeline. Untick "Hide Zotero Timeline's own
   items from my library".
   **Expect** "Zotero Timeline data" appears in the library root (the
   storage and vocabulary notes are its collapsed children); tick it back and
   it disappears. Both without a restart, measured: the pref is
   `extensions.zotero.zoterotimeline.hideTimelineNotes`.

2. **Do** In Link types, with _Bastille_ selected in the main window behind
   the Settings window and its row reading `— cites`: select the `cites` row
   (`.zoterotimeline-vocab-row`), Edit (`.zoterotimeline-vocab-edit`), type a
   new label in `.zoterotimeline-vocab-field-input`, Save
   (`.zoterotimeline-vocab-save`).
   **Expect** the row in the main window's Timelines section repaints to the
   new label without any click there; measured at 207 ms. Rename it back.
   Delete a type that links use: the confirm names how many.

3. **Do** In Feedback, click "Report a bug…" with `Zotero.launchURL` stubbed
   from the rig (`Zotero.launchURL = (u) => captured.push(u)`), then restore
   it.
   **Expect** `https://github.com/oekeur/zotero-timeline/issues/new?template=bug_report.yml&plugin-version=…&zotero-version=…&os=…`,
   with `debug-output` present only when the error buffer holds an entry
   carrying `[zoteroTimeline]` or naming the bundle script; 22 unrelated
   entries in the buffer contribute nothing. "Request a feature…" gives
   `template=feature_request.yml` alone. By hand, **read what is prefilled
   before submitting**: the entries carry the install path, which names your
   home directory.

4. **Do** Resize the Settings window to its minimum (800 CSS px wide).
   **Expect** the two buttons side by side, the help line wrapping, nothing
   clipped. Narrower than that is the window refusing, not the pane.

5. **Do** `Services.prefs.setCharPref("intl.locale.requested", "nl-NL")`,
   restart `npm start` (the pref is read at startup; `prestart` kills the
   instance, the rig reconnects after), reopen the pane.
   **Expect** "Een bug melden…", "Een functie voorstellen…", "Het eigen item
   van Zotero Timeline verbergen in mijn bibliotheek", and the JS-rendered
   editor labels "Bibliotheek", "Toevoegen", "Bewerken", "Verwijderen". The
   link-type names themselves stay English: they are stored vocabulary data
   seeded once, not UI strings. Clear the pref afterwards
   (`Services.prefs.clearUserPref("intl.locale.requested")`).

**Then** `zotero_read_errors`.

---

## What this does not cover

Group libraries beyond a single read-only check. The cross-library switch
("The timeline tab is open on … Switch it to …?") needs an item in a second
library while the tab shows the first; a group library needs a synced account,
which the seeder cannot make and the dev profile does not have. The suite
covers the switch through its confirm seam.

Sync conflicts. Two devices writing one storage note is an accepted risk
recorded in `project/PRODUCT.md`, not something a single profile can stage.

A storage note arriving from sync or from another window. Nothing local wrote
it, so no write signal fires and the item-pane section stays stale until the
next selection. Known, deferred, same shape as the timeline-created-elsewhere
note in `timelineTab.ts`.

Drag on the canvas from the rig. vis-timeline's drag wants real pointer events
with movement between them; `zotero_click_element` cannot produce them. The
suite's `timelineDrag.test.ts` stages it through Hammer; a human checks it by
hand.

Sidebar order persistence. Reordering lanes changes vis `groupOrder` for the
session and nothing writes it; TASK-39 set no criterion either way. A user
who arranges lanes and reopens the tab gets the stored order back. Open
product question, not filed.

Anything the Mocha suite already asserts. Storage semantics, the schema's
back-compat paths, the editor's field logic, EDTF parsing and the render
gates of the item-pane section are covered there, and a second, slower,
hand-driven copy of those assertions would cost maintenance and catch
nothing.

## Keeping this true

Selectors and strings drift. Element classes live in
`src/modules/timeline/*.ts` as exported module constants (`*_CLASS`), the two
menu ids in `src/hooks.ts` and `timelineTab.ts`, and the user-visible strings
in `addon/locale/en-US/*.ftl`; a rename in either makes a step here wrong.
`test/support-renderGates.ts` dumps the six item-pane render gates when a
section step will not update and you need to know which gate is holding it.
What actually goes stale is a renamed class or a reworded string, and only
walking the journey finds that; when a walk turns up a wrong expectation,
correct it here and say when it was walked.
