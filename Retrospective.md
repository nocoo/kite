# Retrospective

## 2026-09-25: Version and fixture assumptions during Pi research

The upstream checkout and installed CLI both declared version 0.87.1, so an early research update treated `provider_stream_event` as available locally. A loopback-provider probe disproved this: the event exists only in upstream `main` after the release. The changelog lists it under Unreleased and release tag `v0.87.1` predates its merge. Future capability inventories must compare release tags, installed declarations, and runtime behavior; a development branch's package version does not establish released availability.

The first invalid-argument fixture used a number for a string field. Pi coerced it and executed the inert tool. The fixture now omits the required field, which reliably exercises validation failure. Use demonstrably invalid inputs when testing validation paths rather than assuming a schema mismatch cannot be coerced.

## 2026-09-25: Bound both data volume and delegated work

The first query implementation limited row count but could exceed the client's response-byte limit when records were large. Queries now iterate rows and stop at a byte boundary, and a regression test checks cursor continuity across that boundary. Every bounded transport needs compatible producer, storage-query and consumer limits.

A redaction test initially searched for `private` anywhere in serialized output; adding the retained field name `private_key` produced a false failure. Assertions now distinguish secret values from field names. Use distinct canary values and verify the redaction structure.

Broad delegated implementation twice consumed time planning without writing files. The coordinator took over the product and reduced the worker's assignment to the independent index-check script, which was delivered and verified. Future delegation should have a small executable first deliverable and a concrete checkpoint before expanding scope.

## 2026-09-25 — Overlapping dependency installs

Two npm installs were accidentally started against the same manifest before the
first process completed. The second manifest write dropped the runtime dependency
entries while artifacts existed on disk. A sequential runtime install restored
the manifest and lockfile; npm dependency validation and a clean build verify the
result. Independent reads may run concurrently; package mutations must finish and
be inspected before another installation starts.

## 2026-09-25 — Recording cursors and replay cancellation

Independent review found that subtracting a fixed window from the global SQLite
cursor omitted a quiet recording's earlier events when other producers occupied
the intervening positions. The live loader now requests the last bounded page
inside the recording's own filters. A sparse 1, 2, 1000 regression fixture prevents
confusing storage order with a per-recording sequence again.

A second review finding showed an in-flight live response could overwrite a step
selected for replay. Seeking now aborts the pending detail request before changing
mode and clears its loading state. The regression resolves the obsolete request
after selection and verifies that the chosen event and replay mode remain intact.

The same review exercised true page boundaries. Rebased page clocks skipped long
waits, so recorded replay now holds the previous frame while a bounded next page
waits for its original time. A 59.501-second boundary gap is tested explicitly.
Summary pagination now uses the immutable first cursor rather than activity order;
otherwise a recording updated between pages could vanish and be falsely marked
expired. Live reconnects fetch a bounded tail rather than traversing data that the
UI would immediately discard. Truncated capture objects and absent tool starts
also have explicit rendering contracts and regression tests.

## Mobile replay control clipping

Document-level overflow checks missed controls clipped by a local card. The mobile
replay options flex item shrank to the remaining row width despite its children's
minimum widths. Give the options their own wrapped row and verify each control's
bounds and real interaction, in addition to the document scroll width.

## Replay pacing transitions

Recorded playback accumulated elapsed time in the step counter. Switching to step
pacing then consumed the entire elapsed interval and skipped observations. Reset
the step accumulator when changing pacing and test the transition after sustained
playback, including the full first step interval and switching back.

## Mobile navigation Escape handling

The first Sheet composition put a Tooltip around the initially focused close
button. The tooltip consumed Escape before the drawer could close. Use the
standard Button directly for the visible close control. Browser verification
now sends one Escape, waits for the dialog to unmount, and checks focus returns
to the menu trigger and the body scroll lock is released. A screenshot or an
unasserted keypress does not establish working dismissal.

Independent review also reproduced focus returning to the menu after selecting
a recording, overriding the view's content focus, and falling to the body when a
viewport change removed that trigger. The Sheet close-autofocus handler now
distinguishes navigation from dismissal and uses the main landmark when the
trigger has unmounted. Both transitions have browser focus assertions.

The expanded brand initially exposed both the image's "Kite" alternative and
the adjacent wordmark. Independent accessibility inspection caught the duplicate
name. Use empty alternative text beside the wordmark and retain the image name
in the collapsed rail; browser assertions now verify both accessible trees.

## Bounded execution map typography

The first fixed-viewport graph kept every node inside the canvas, but percentage
heights allowed flex children to shrink and clip labels at 1366×768. Bounding-box
assertions alone passed while the screenshot exposed unreadable text. Preserve
text height, reduce optional captions on short screens and size session pages
from measured available height. Verify actual node content in screenshots as
well as the page's scroll and geometry metrics.

## Latest fleet phase and remembered work

The first global map reused `lastActivity` from the prior card layout. That field
intentionally remembers selected work hooks, so a closed recording could still
be counted under Response or Tools. The global map promises the latest observed
module and must use `lastEvent` for counts, filters and session markers. Keep
lifecycle status separate, and test an old work hook followed by shutdown.

## Tool paging and live follow

Filling the final tool group from preceding attempts made manual pages overlap.
Keep manual pages disjoint and label the actual visible range. Follow is a
separate view: anchor it on the latest observed tool event so updates from an
earlier long-running attempt are not hidden by newer, already-finished calls.
Tests now check uniqueness across manual pages, pinned groups on append and
follow movement when an earlier attempt emits a new event.


## Replay animation is not live process status

Independent review found the stage status dot reused the diagram's animation
flag. Playing a closed recording therefore produced a green running beacon next
to a fleet with zero running sessions. Keep live lifecycle state separate from
playback: use a labeled replay badge and a distinct replay indicator, while the
map continues animating captured events. Browser checks assert both indicators.

The 320px telemetry row also overflowed inside the non-scrolling island even
though document width stayed bounded. Remove decorative metric icons at that
width and assert the island's horizontal scroll extent, not just the document's.

## Light diagram contrast and settled screenshots

The diagram reused pastel chart swatches for small text on white. Combined with
low-opacity paths, this made labels and connections difficult to read in light
mode despite acceptable dark screenshots. Derive darker diagram colors from
the existing Basalt hues and measure text and graphic contrast against their
actual backgrounds, including active and hover tints.

The original light acceptance screenshot also captured unfinished theme
transitions, producing gray nodes and a dark rail that were not stable theme
surfaces. Finish transitions when capturing theme screenshots and compare
settled computed styles before diagnosing or changing the surface system.

## Session priority and keyboard focus

Moving a recording between Live and Recordings creates a new React parent even
when its recording key is stable. A keyboard-focused row then disappeared and
focus fell to the document body. Preserve the focused recording identity during
navigation updates and restore it only if focus was lost to the body. Clear that
identity on an intentional blur so polling cannot steal focus from another control.
Browser acceptance covers promotion, demotion and deliberate focus departure.

Independent review also found that expanding the rail through Find sessions
removed its trigger without moving focus to the revealed search field. Remember
that explicit search action and focus the mounted Input after expansion; an
ordinary sidebar expansion must not unexpectedly focus search.
