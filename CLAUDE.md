# Load Tracker — project notes

An app for one person: the S&C coach. It tracks how much work players are asked
to do in practice, so that a dangerous build-up shows up as a number before it
shows up as an injury.

There is no WIMU and no Catapult. This app is the substitute.

## What the app actually measures

**Prescribed load, not measured load.**

`load = intensity (1-10) x duration (minutes)`

The intensity comes from the coach's standing rating of the drill. The duration
comes from a stopwatch. This is the session-RPE method (Foster et al., 1998 /
2001), applied per drill and summed, rather than once per session.

What it can answer:
- Is this week much heavier than the last three?
- Which players are carrying the most, and who is carrying nothing?
- Is every day starting to look the same (monotony)?
- Does what the coach prescribed match what the players felt?

What it **cannot** answer, and must never pretend to:
- What an individual body actually did. Two players in the same drill get the
  same number even if one took twelve possessions and the other took three.
- Anything in real physiological units. AU are arbitrary; they only mean
  something next to other AU from the same coach on the same scale.

This honesty is a product requirement, not a disclaimer. It is written into
`js/load.js`, restated on the Settings screen, and every interpretation helper
is worded as a prompt to look ("worth a conversation"), never as a diagnosis.

## Decisions and why

**Who gets a load number — team default, mark exceptions.**
Every player on the active roster is assumed to be in every drill. The coach
only taps the ones who sat out or were limited. This gives per-player numbers
(which is where injury prevention lives) at roughly two taps per drill. The
full alternative — tapping every player for every drill — is more accurate on
paper and gets abandoned by week three in practice.

**Limited = 0.5.** A judgement call, not a measurement. Labelled as such in the
UI so nobody mistakes it for precision.

**Windows tablet running Microsoft Edge, offline-first.** Confirmed with a
compatibility check (`compat.html`) opened on the actual device. Edge is
Chromium-based, so modern JavaScript, IndexedDB, service workers and CSS
variables are all available and nothing needs polyfilling.

Worth recording because it nearly went the other way: the device was first
described as running Internet Explorer. IE was retired in June 2022 and
disabled in February 2023, and its icon (blue "e" with a gold ring) is easily
confused with Edge's (blue-green swirl). Had it been real IE11 the app would
have needed a full ES5 rewrite *and* would have lost offline mode entirely,
since service workers do not exist there. Keep `compat.html` around — check the
device before assuming the browser.

Installing on Windows: browser menu -> Apps -> "Install this site as an app",
not iOS's "Add to Home Screen".

All data lives in IndexedDB on the device; nothing is sent anywhere; there is no
server and no account. The cost of that choice is that a lost tablet loses the
season, which is why Backup on the Settings screen is prominent and nags after
three weeks.

**Practice can split into groups.** Bigs in the post while guards work the
perimeter is how practice actually runs, so blocks carry a `group` label and
more than one clock can run at once.

**No build tooling.** Plain HTML/CSS/ES modules. No npm, no bundler, no
framework. This machine has no Node installed, but more importantly: this app
will still open and run years from now with nothing to update or repair. The
app is not complex enough to need React.

**The coach writes his own vocabulary.** Context tags and drill categories ship
with a starter set, but he adds his own and those are kept and offered every
session after. The presets are a first guess by someone who is not in that gym;
the tags that end up mattering are his. Removing one from the list never
alters a practice already recorded — the session keeps the tag it was given.

**Team is the default group, and the picker hides.** Practice runs as a whole
squad most of the time, so the group selector in "Start a drill" is collapsed
behind a Change control. Group splits are supported but must cost zero taps
when they are not happening.

**Snapshots over references.** A recorded drill run stores its own copy of the
drill name and intensity. Re-rating a drill in the library must never silently
rewrite what last November's practices meant.

**Intensity comes from an objective grid, not a gut feeling.** Adopted from
the coach's own framework (see the two source images discussed 2026-08-18).
Three facts about a drill, none of them a matter of opinion:

| Level | Court | Situation | Rhythm |
|---|---|---|---|
| 5 | Full court | 1v1 (or 1v0) | Non-stop |
| 4 | Three-quarter court | 2v2 (2v1) | 3 lengths, then stop |
| 3 | Half court | 3v3 (3v2, 3v1) | 2 lengths, then stop |
| 2 | Inside the arc | 4v4 | 1 length, then stop |
| 1 | Stationary | 5v5 | Half-court action, then stop |

Plus a fourth input, **live defence**, which is smaller than it looks (below).

`intensity = ((court + situation' + rhythm) / 3) x 2`, giving 2-10,
where `situation'` is one level lower when there is no live defence.

**Averaged, not multiplied** — this matters. Multiplying over-separates the
extremes badly; averaging matched the measured data. The three factors trade
off against each other rather than compounding.

**Court dimension was moved from the volume axis to the intensity axis.** In
the original framework court size is a volume input, alongside an *estimated*
practice duration. Intensity here is a rate, and court size is what sets how
much ground gets covered per minute; the stopwatch then supplies real minutes.
Multiply back together and you land in the same place, with a measured duration
instead of a guessed one.

**Contact is NOT a meaningful intensity driver — this was tested, not assumed.**
The matched pairs in the club's own contact/non-contact table say so directly:

Matched pairs — the same court and the same number of players, with and
without live defence — move intensity by **less than the grid's own error**,
and at half court the contested version measured *lower*. (Figures in
`private/measured-drills.json`; see "Club data" below.) What the data
*does* show is a one-sided bias: unopposed work sits about 0.7 below what the
grid predicts (mean residual -0.71 across 9 drills, versus +0.01 across 13
contested ones). Dropping the situation one level when there is no defence
absorbs that inside the existing framework rather than bolting on a constant —
a 3v0 behaves like a 4v4. Four candidate corrections were compared; a flat
offset and a 0.9 multiplier fit fractionally better, and were rejected for
being unprincipled fudge factors on n=27.

**This was validated, not assumed.** Checked against 27 measured drill values
spanning all three source images: R-squared 0.934, mean error 0.47 on a 1-10
scale, worst single miss 1.20. `tests/intensity.test.js`
asserts the fit, asserts that the defence adjustment earns its place by beating
the un-adjusted version, and asserts that nobody later inflates contact into a
large intensity effect. Those tests are the formula's only justification — keep
them.

**Caveat on all of the above:** n=27, with several candidate models compared
against the same data and no held-out set. The direction of the contact finding
is solid (four different corrections all improve the fit by similar amounts,
which is what a real effect looks like); the exact coefficient is not. Treat
0.93 as flattering.

Three sources of intensity are supported, and which one was used is recorded so
the analysis can be honest about confidence:
1. `measured` — a real tracked number. Most trustworthy.
2. `derived` — the grid. Repeatable, and the same in March as in November.
3. `manual` — a 1-10 judgement, for what the grid does not describe (lifting,
   rehab, individual skill work).

The old subjective 1-10 Borg-style anchors survive as the `manual` mode and as
the labels attached to a resolved number.

**Movement demands are tracked separately from load.** One intensity number
cannot say what KIND of work a drill was, and the kind is what predicts the
injury: jumping loads Achilles and patellar tendon, sprinting loads hamstrings,
change of direction loads ankles and groin. Two drills can both be a 7 and
damage completely different tissue.

**Contact is tracked as exposure, not as load.** Since it barely moves
intensity, folding it in would invent an effect that is not in the data. But
contact is where collisions, contested rebounds and landing on someone's foot
come from — the most common ankle sprain mechanism in the sport — so contact
minutes are counted in their own right. "His contact minutes are up 80% this
week" is a different warning from "his load is up 20%", and often the more
useful one.

Each drill carries three movement tags (none / low / moderate / high) set
**once, in the library** — never during practice. Score is `level x minutes`, same shape as
load. Units are arbitrary and NOT comparable between tissues or to AU; each is
only ever compared against itself over time.

Untagged drills score `null`, never `0`, and `tissueCoverage()` reports what
fraction of a session is missing. A coach who does not know that half his
session went uncounted will read a real spike as a quiet week.

**Live density is the one genuinely measured number here.**

    live density = time the ball was live / total drill time

The coach times live action on a second stopwatch and types it in when he stops
the drill. Everything else in the app is rated or derived; this is observed.

It measures the same property the `rhythm` grid level *estimates*. They are
kept separate deliberately: rhythm is a prediction, density is an observation,
and collapsing them would throw away the ability to check one against the other.
Once there are a few weeks of both, measured density can be used to calibrate —
or replace — the rhythm levels. Do not wire it into the load formula before
then; there is no data yet to justify a coefficient.

Rules that must not be softened:
- An untimed drill is `null`, never `0`. Zero live time is a real, different
  measurement from "he didn't run the second watch".
- Session density is computed over the timed drills **only**, and `coverage`
  travels with it. A 70% density measured on two of six drills is not the
  session's density, and the UI says so.
- Live time exceeding the drill's duration is rejected at input and capped in
  the maths. Density above 1 is impossible.
- The prompt on Stop is skippable in one tap, and can be turned off entirely
  (Settings -> During practice). Friction courtside is how data collection dies.

**Stop refining the intensity formula.** The club's own repeated measurements
show the *same drill* varies by +/-0.64 (mean sd across 19 drills run more than
once; the widest spread was a full-court passing drill measured across nearly
4 points on the 10-point scale). The grid's error is 0.47. The model is
already more precise than the thing it measures — further tuning is fitting
noise. The escape hatch for a genuinely unusual run is per-run intensity
adjustment during practice, which does not touch the library.

**The drill library is club data and is NOT in this repository.** It lives in
`private/drill-library.json` — 43 drills transcribed from two spreadsheet
images, 36 with measured values and 7 set from the grid. The coach loads it via
Settings -> Import a drill library.

That import is deliberately separate from "Restore from backup": a restore
*replaces* the database and would wipe every recorded practice, whereas a
library import only ever ADDS drills and skips names that already exist. Never
merge the two. `tests/library.test.js` asserts a roster, sessions, blocks and
settings all survive an import; it is the most important test in that file.

Movement tags are deliberately left **unset** in the seed. Guessing the jump /
sprint / change-of-direction profile of drills nobody here has watched would be
inventing exactly the kind of data this project refuses to invent. The library
flags untagged drills and offers a one-at-a-time run through them instead.

The seeded numbers were read off images and have never been checked against the
original sheet. `tests/seed.test.js` verifies internal consistency and
spot-checks values, but cannot verify the transcription — only the source file
can.

## Club data: what must never be committed

The repository is public so that GitHub Pages can serve it for free. Everything
club-specific is therefore kept out of it, under `private/` (gitignored):

| File | What it is |
|---|---|
| `private/drill-library.json` | The 43-drill library with measured values. Imported on the tablet. |
| `private/measured-drills.json` | The 27 measured values the intensity grid was validated against. |
| `private/source-data/*.png` | The original spreadsheet images. |

Rules:
- Player names, rosters and practice history never leave the device at all —
  they live only in the tablet's IndexedDB. Nothing in this repo touches them.
- Aggregate statistics ABOUT the method (R-squared, mean error, the +/-0.64
  run-to-run figure) are fine to keep here: they describe how well the formula
  works, not how the team trains. Raw per-drill values are not.
- `tests/intensity.test.js` and `tests/library.test.js` read from `private/` if
  it is there and **skip cleanly** if it is not, so a fresh clone still runs
  green. Check the skip lines when a suite looks suspiciously short.
- Before committing, `git status` should never show anything under `private/`.

## Layout

```
index.html            shell
manifest.webmanifest  home-screen install
sw.js                 offline cache (app files only; data is in IndexedDB)
css/app.css           all styling; 52px minimum tap targets
compat.html           standalone browser check; open it on a new device first
js/db.js              IndexedDB wrapper, backup export/import
js/models.js          domain vocabulary: intensity scale, factories, dates
js/load.js            the maths + the honesty about its limits
js/ui.js              DOM builder, modal, toast, file download/pick
js/components.js      intensity picker/badge, status dot
js/app.js             hash router and nav
js/views/*.js         one file per tab
tests/load.test.js    unit tests for the maths
tests/intensity.test.js  the grid, the movement tags, and the fit to real data
tests/library.test.js importing a drill library without destroying practices
tests/harness.js      fake DOM + IndexedDB so views can run headlessly
tests/views.test.js   smoke tests thatevery screen renders and saves correctly
```

## Running and testing it

No install step. Serve the folder and open it:

```sh
python3 -m http.server 8765
# then open http://127.0.0.1:8765/
```

Run the tests (no Node required — macOS ships JavaScriptCore):

```sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
$JSC -m tests/load.test.js       # the maths
$JSC -m tests/intensity.test.js # the intensity grid + its fit to measured data
$JSC -m tests/seed.test.js      # the starter drill library
$JSC -m tests/views.test.js     # every screen renders, saves, and restores
```

`tests/harness.js` fakes just enough DOM and IndexedDB to run the views in a
terminal. It proves render paths execute and the right records get written. It
proves **nothing** about layout, styling or touch targets — those need the real
tablet. When adding a view, add a smoke test; when changing the maths, prove
the suite catches a deliberately broken formula before trusting a green run.

Syntax-check any module the same way: `jsc -m js/whatever.js`. A clean run means
it parses and its imports resolve. `js/app.js` and `sw.js` will report a missing
`window` / `self` — that is expected, and means they parsed fine.

## Build stages

1. **Done** — shell, roster, drill library, backup/restore, offline install.
2. **Done** — live practice: concurrent stopwatches, group splits, three-state
   participation, pause/resume that survives a reload, manual entry for drills
   run before the app was open, context tags and notes, session summary.
3. Post-practice: per-player RPE, compared against prescribed load.
4. Analysis: weekly load, per-player trends, ACWR, monotony/strain.
5. Custom fields the coach defines himself, folded into the comparisons.
