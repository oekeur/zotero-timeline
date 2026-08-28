timeline-tab-label = Timeline

# Shown in the Timeline tab when the open library can't be written. This is
# the reason in words the read-only rule requires: every control that would
# change a timeline is disabled at the same time, but a disabled control on
# its own does not say why.
timeline-read-only-banner = { $library } can't be edited. You can browse every timeline here, but nothing can be created, changed, or deleted.

# Shown when the plugin's own container item is moved to the trash. Trashing it
# hides every timeline in the library at once, and nothing in Zotero says so.
container-trashed-now = Zotero Timeline's data item was moved to the trash, so every timeline in this library is now hidden. Restore it from the trash to get them back.

timeline-trashed-now = The timeline "{ $name }" was moved to the trash. Restore it from the trash to get it back.

timeline-trashed-now-unnamed = A timeline was moved to the trash. Restore it from the trash to get it back.

# Shown instead of creating a library's first timeline when the tab opens.
# The library's storage note or container is only in the trash, so it looks
# empty rather than actually being empty; creating here would hand the user a
# blank timeline while the one they had sat unreachable.
timeline-data-trashed-open = Timeline data for this library is in the trash. Nothing new was created; restore it to get your timelines back.

# Shown after the link-type list was rebuilt from the defaults because the
# library had none. Naming the trash is what makes it actionable: the labels
# come back if the old note is restored, because links store type ids.
vocabulary-recovered = Zotero Timeline rebuilt this library's link types from the defaults, because it could not find the list. If you deleted it, the previous list is in the trash; restoring it brings your own labels back.

# Shown once per timeline per session as a document approaches the largest note
# Zotero's sync server will accept. Names the timeline and says what to do,
# because a number alone is not something the user can act on.
timeline-approaching-size-limit = The timeline "{ $name }" is getting close to the largest note Zotero will sync. Split it into two timelines to be safe.

# Shown before a timeline is deleted, naming it and how many events go with
# it. The erase goes through Zotero's trash rather than being permanent,
# which is worth saying here rather than leaving the user to hope.
timeline-delete-confirm-title = Delete timeline
timeline-delete-confirm-message =
    { $count ->
        [0] Delete "{ $name }"? It has no events. It will move to Zotero's trash, where it can be restored.
        [one] Delete "{ $name }"? It and its { $count } event will move to Zotero's trash, where they can be restored.
       *[other] Delete "{ $name }"? It and its { $count } events will move to Zotero's trash, where they can be restored.
    }

# The vocabulary editor in the preference pane. Its container is rebuilt from
# scratch on every state change, so its text is read through getString rather
# than data-l10n-id - see vocabularySettings.ts's top-of-file comment.
vocabulary-loading = Loading…
vocabulary-library-label = Library
vocabulary-not-yet-stored = These are the default link types. They have not been saved for this library yet; the first change you make here creates the list.
vocabulary-version-unsupported = This library's link types were saved by a newer version of Zotero Timeline and can't be edited here. Update the plugin to edit them.
vocabulary-unreadable = Zotero Timeline could not read this library's link types ({ $message }). It will not overwrite them; fix or restore the note from the trash.
vocabulary-add-button = Add
vocabulary-edit-button = Edit
vocabulary-delete-button = Delete
vocabulary-save-button = Save
vocabulary-cancel-button = Cancel
vocabulary-field-label = Label
vocabulary-delete-confirm-title = Delete link type
vocabulary-delete-confirm-used =
    { $count ->
        [0] Delete this link type? No source links use it.
        [one] Delete this link type? { $count } source link uses it and will show as "(unknown type)" there.
       *[other] Delete this link type? { $count } source links use it and will show as "(unknown type)" there.
    }
vocabulary-delete-confirm-unknown = Could not check how many source links use this type: the library's timeline data could not be read. Delete anyway?
vocabulary-error-not-writable = This library can't be edited, so the change was not saved.
vocabulary-error-empty = A library's link types can't be empty. Add another type before deleting the last one.
vocabulary-error-generic = Zotero Timeline could not save this change: { $message }

# The library context menu entries that attach the selection to an event that
# already exists. The flat form is generic because the library holds only one
# timeline when it shows, so nothing else needs naming; the submenu form
# completes with a timeline's own name, one per row.
context-add-sources-flat = Add as Sources to Timeline…
context-add-sources-submenu = Add as Sources to…

# The library context menu entries that open the editor panel on a new,
# unsaved event with the selection already attached as sources. The ellipsis
# is what says a further surface opens rather than the click itself writing
# anything - see event-editor-create-sources-skipped below for what happens
# on Save.
context-add-to-new-event-flat = Add to New Event on Timeline…
context-add-to-new-event-submenu = Add to New Event on…

# Shown when the timeline tab is already open on a document other than the one
# a jump or an "add to new event" targets - either a different library, or the
# same library's document created since the tab opened. Confirming closes
# whatever is on screen, including any unsaved editor state, and reopens the
# tab on the target's own library - naming both is what makes that a choice
# rather than a surprise.
timeline-cross-library-switch-title = Switch to a different library?
timeline-cross-library-switch-message = The timeline tab is open on "{ $currentLibrary }". Switch it to "{ $targetLibrary }"? The current view, and any unsaved changes in the editor, will be lost.
timeline-cross-library-switch-message-unknown-current = The timeline tab is open on another library. Switch it to "{ $targetLibrary }"? The current view, and any unsaved changes in the editor, will be lost.

# Shown by the same prompt as above, through the same seam, when opening a new
# event on an already-open tab would replace an event currently being edited -
# no library switch to name here, so its own wording rather than the two above.
timeline-discard-edit-confirm-title = Discard the current edit?
timeline-discard-edit-confirm-message = This will replace what the editor is showing. Anything there that hasn't been saved will be lost.

# The standalone "Add as sources" window opened from that menu. Its own text
# is read through getString rather than data-l10n-id, the same choice
# vocabularySettings.ts makes: the whole form is rebuilt from scratch once its
# data has loaded, so there is nothing for a static <linkset> to translate in
# place.
add-sources-dialog-title = Add as sources
add-sources-dialog-context =
    { $count ->
        [one] Add { $count } item as sources to an event in "{ $timeline }"
       *[other] Add { $count } items as sources to an event in "{ $timeline }"
    }
add-sources-dialog-empty = This timeline has no events yet.
add-sources-dialog-event-label = Event
add-sources-dialog-type-label = Type
add-sources-dialog-attach-button = Attach
add-sources-dialog-cancel-button = Cancel
add-sources-dialog-close-button = Close
add-sources-dialog-result-success =
    { $count ->
        [0] Nothing attached: every selected item was already cited under this type.
        [one] Attached { $count } source.
       *[other] Attached { $count } sources.
    }
add-sources-dialog-result-skipped = Already cited under this type, so not attached again: { $names }.

# Read through getString, not data-l10n-id, so these must live in addon.ftl:
# initLocale only loads addon.ftl and preferences.ftl, and a key outside that
# list resolves to the key itself with nothing logged. They are read from a
# click handler rather than during render, which is what makes getString safe
# here, and they are shown in a ProgressWindow because the write rebuilds the
# panel that raised them.
event-editor-duplicate-done = Copied to { $timeline }.

event-editor-duplicate-done-without-sources =
    Copied to { $timeline }, without { $count ->
        [one] its one source
       *[other] its { $count } sources
    }. A timeline cannot cite items from another library.

# Shown after Create when one or more of the preset items could not become a
# source - each would have exactly duplicated a ref already added earlier in
# the same batch. The event and every other source were still written; this
# names which were skipped rather than reporting a plain success.
event-editor-create-sources-skipped = Not added, already among the sources above: { $names }.
