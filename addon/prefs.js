pref("enable", true);
pref("input", "This is input");
// Defaults to hidden: the plugin's bookkeeping is not the user's library.
// The preference exists so anyone who wants to see where their data lives can
// ask for it. Accepted tradeoff: the container row was also the only thing
// announcing that the plugin stores anything in the library at all.
pref("hideTimelineNotes", true);
