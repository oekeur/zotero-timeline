timeline-tab-label = Tijdlijn

# Shown in the Timeline tab when the open library can't be written. This is
# the reason in words the read-only rule requires: every control that would
# change a timeline is disabled at the same time, but a disabled control on
# its own does not say why.
timeline-read-only-banner = { $library } kan niet worden bewerkt. Je kunt hier elke tijdlijn bekijken, maar er kan niets worden aangemaakt, gewijzigd of verwijderd.

# Shown when the plugin's own container item is moved to the trash. Trashing it
# hides every timeline in the library at once, and nothing in Zotero says so.
container-trashed-now = Het gegevensitem van Zotero Timeline is naar de prullenbak verplaatst, waardoor elke tijdlijn in deze bibliotheek nu verborgen is. Herstel het uit de prullenbak om ze terug te krijgen.

timeline-trashed-now = De tijdlijn "{ $name }" is naar de prullenbak verplaatst. Herstel deze uit de prullenbak om hem terug te krijgen.

timeline-trashed-now-unnamed = Een tijdlijn is naar de prullenbak verplaatst. Herstel deze uit de prullenbak om hem terug te krijgen.

# Shown instead of creating a library's first timeline when the tab opens.
# The library's storage note or container is only in the trash, so it looks
# empty rather than actually being empty; creating here would hand the user a
# blank timeline while the one they had sat unreachable.
timeline-data-trashed-open = De tijdlijngegevens voor deze bibliotheek staan in de prullenbak. Er is niets nieuws aangemaakt; herstel ze om je tijdlijnen terug te krijgen.

# Shown after the link-type list was rebuilt from the defaults because the
# library had none. Naming the trash is what makes it actionable: the labels
# come back if the old note is restored, because links store type ids.
vocabulary-recovered = Zotero Timeline heeft de linktypes van deze bibliotheek opnieuw opgebouwd vanuit de standaardwaarden, omdat de lijst niet kon worden gevonden. Als je die hebt verwijderd, staat de vorige lijst in de prullenbak; deze herstellen brengt je eigen labels terug.

# Shown once per timeline per session as a document approaches the largest note
# Zotero's sync server will accept. Names the timeline and says what to do,
# because a number alone is not something the user can act on.
timeline-approaching-size-limit = De tijdlijn "{ $name }" nadert de grootste notitie die Zotero kan synchroniseren. Splits hem in twee tijdlijnen om problemen te voorkomen.

# Shown before a timeline is deleted, naming it and how many events go with
# it. The erase goes through Zotero's trash rather than being permanent,
# which is worth saying here rather than leaving the user to hope.
timeline-delete-confirm-title = Tijdlijn verwijderen
timeline-delete-confirm-message =
    { $count ->
        [0] "{ $name }" verwijderen? Deze heeft geen gebeurtenissen. Hij verhuist naar de prullenbak van Zotero, waar hij kan worden hersteld.
        [one] "{ $name }" verwijderen? Deze en zijn { $count } gebeurtenis verhuizen naar de prullenbak van Zotero, waar ze kunnen worden hersteld.
       *[other] "{ $name }" verwijderen? Deze en zijn { $count } gebeurtenissen verhuizen naar de prullenbak van Zotero, waar ze kunnen worden hersteld.
    }

# The vocabulary editor in the preference pane. Its container is rebuilt from
# scratch on every state change, so its text is read through getString rather
# than data-l10n-id - see vocabularySettings.ts's top-of-file comment.
vocabulary-loading = Bezig met laden…
vocabulary-library-label = Bibliotheek
vocabulary-not-yet-stored = Dit zijn de standaard linktypes. Ze zijn nog niet opgeslagen voor deze bibliotheek; de eerste wijziging die je hier maakt, maakt de lijst aan.
vocabulary-version-unsupported = De linktypes van deze bibliotheek zijn opgeslagen door een nieuwere versie van Zotero Timeline en kunnen hier niet worden bewerkt. Werk de plugin bij om ze te bewerken.
vocabulary-unreadable = Zotero Timeline kon de linktypes van deze bibliotheek niet lezen ({ $message }). Ze worden niet overschreven; herstel de notitie of zet deze terug uit de prullenbak.
vocabulary-add-button = Toevoegen
vocabulary-edit-button = Bewerken
vocabulary-delete-button = Verwijderen
vocabulary-save-button = Opslaan
vocabulary-cancel-button = Annuleren
vocabulary-field-label = Label
vocabulary-delete-confirm-title = Linktype verwijderen
vocabulary-delete-confirm-used =
    { $count ->
        [0] Dit linktype verwijderen? Geen enkele bronkoppeling gebruikt het.
        [one] Dit linktype verwijderen? { $count } bronkoppeling gebruikt het en toont daar "(onbekend type)".
       *[other] Dit linktype verwijderen? { $count } bronkoppelingen gebruiken het en tonen daar "(onbekend type)".
    }
vocabulary-delete-confirm-unknown = Kon niet nagaan hoeveel bronkoppelingen dit type gebruiken: de tijdlijngegevens van de bibliotheek konden niet worden gelezen. Toch verwijderen?
vocabulary-error-not-writable = Deze bibliotheek kan niet worden bewerkt, dus de wijziging is niet opgeslagen.
vocabulary-error-empty = De linktypes van een bibliotheek mogen niet leeg zijn. Voeg een ander type toe voordat je de laatste verwijdert.
vocabulary-error-generic = Zotero Timeline kon deze wijziging niet opslaan: { $message }

# The library context menu entries that attach the selection to an event that
# already exists. The flat form is generic because the library holds only one
# timeline when it shows, so nothing else needs naming; the submenu form
# completes with a timeline's own name, one per row.
context-add-sources-flat = Toevoegen als bronnen aan tijdlijn…
context-add-sources-submenu = Toevoegen als bronnen aan…

# The library context menu entries that open the editor panel on a new,
# unsaved event with the selection already attached as sources. The ellipsis
# is what says a further surface opens rather than the click itself writing
# anything - see event-editor-create-sources-skipped below for what happens
# on Save.
context-add-to-new-event-flat = Toevoegen aan nieuwe gebeurtenis op tijdlijn…
context-add-to-new-event-submenu = Toevoegen aan nieuwe gebeurtenis op…

# Shown when the timeline tab is already open on a document other than the one
# a jump or an "add to new event" targets - either a different library, or the
# same library's document created since the tab opened. Confirming closes
# whatever is on screen, including any unsaved editor state, and reopens the
# tab on the target's own library - naming both is what makes that a choice
# rather than a surprise.
timeline-cross-library-switch-title = Overschakelen naar een andere bibliotheek?
timeline-cross-library-switch-message = Het tijdlijntabblad staat open op "{ $currentLibrary }". Overschakelen naar "{ $targetLibrary }"? Het huidige beeld en eventuele niet-opgeslagen wijzigingen in de editor gaan verloren.
timeline-cross-library-switch-message-unknown-current = Het tijdlijntabblad staat open op een andere bibliotheek. Overschakelen naar "{ $targetLibrary }"? Het huidige beeld en eventuele niet-opgeslagen wijzigingen in de editor gaan verloren.

# Shown by the same prompt as above, through the same seam, when opening a new
# event on an already-open tab would replace an event currently being edited -
# no library switch to name here, so its own wording rather than the two above.
timeline-discard-edit-confirm-title = De huidige bewerking verwerpen?
timeline-discard-edit-confirm-message = Dit vervangt wat de editor nu toont. Alles daarin dat nog niet is opgeslagen, gaat verloren.

# The standalone "Add as sources" window opened from that menu. Its own text
# is read through getString rather than data-l10n-id, the same choice
# vocabularySettings.ts makes: the whole form is rebuilt from scratch once its
# data has loaded, so there is nothing for a static <linkset> to translate in
# place.
add-sources-dialog-title = Toevoegen als bronnen
add-sources-dialog-context =
    { $count ->
        [one] { $count } item toevoegen als bron aan een gebeurtenis in "{ $timeline }"
       *[other] { $count } items toevoegen als bronnen aan een gebeurtenis in "{ $timeline }"
    }
add-sources-dialog-empty = Deze tijdlijn heeft nog geen gebeurtenissen.
add-sources-dialog-event-label = Gebeurtenis
add-sources-dialog-type-label = Type
add-sources-dialog-attach-button = Koppelen
add-sources-dialog-cancel-button = Annuleren
add-sources-dialog-close-button = Sluiten
add-sources-dialog-result-success =
    { $count ->
        [0] Niets gekoppeld: elk geselecteerd item was al onder dit type geciteerd.
        [one] { $count } bron gekoppeld.
       *[other] { $count } bronnen gekoppeld.
    }
add-sources-dialog-result-skipped = Al onder dit type geciteerd, dus niet opnieuw gekoppeld: { $names }.

# Read through getString, not data-l10n-id, so these must live in addon.ftl:
# initLocale only loads addon.ftl and preferences.ftl, and a key outside that
# list resolves to the key itself with nothing logged. They are read from a
# click handler rather than during render, which is what makes getString safe
# here, and they are shown in a ProgressWindow because the write rebuilds the
# panel that raised them.
event-editor-untitled-title = Naamloze gebeurtenis

event-editor-duplicate-done = Gekopieerd naar { $timeline }.

event-editor-duplicate-done-without-sources =
    Gekopieerd naar { $timeline }, zonder { $count ->
        [one] zijn ene bron
       *[other] zijn { $count } bronnen
    }. Een tijdlijn kan geen items uit een andere bibliotheek citeren.

# Shown after Create when one or more of the preset items could not become a
# source - each would have exactly duplicated a ref already added earlier in
# the same batch. The event and every other source were still written; this
# names which were skipped rather than reporting a plain success.
event-editor-create-sources-skipped = Niet toegevoegd, al onder de bronnen hierboven: { $names }.

# Shown in the sidebar's tag section after a jump clears the active tag
# filter because it hid the jumped-to event. Read through getString, not
# data-l10n-id, for the same reason as the block above: the sidebar is
# rebuilt from scratch on every renderSidebar() call, this one included.
timeline-tag-filter-cleared-for-jump = Tagfilter gewist om deze gebeurtenis te tonen.
