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

## Stage 3: what the players said

The coach's rating is what he ASKED for. RPE is what the body on the receiving
end actually felt. A standing gap between them means his intensity ratings and
his players disagree, and the players are the ones who get injured.

**The comparison is in intensity points, not AU.** Both sides are (1-10) x the
same minutes, so the AU gap just scales with how long practice was. The number
a coach can act on is "you called it a 6, he felt an 8" — the language he
already rates drills in. `feltVsPrescribed()` returns the prescribed intensity
(his load spread over his own minutes) beside the player's single answer.

**The session's number is the median, not the mean.** One player having a rough
night must not drag the squad's figure with him; that is exactly what the
per-player rows are for. The test for this deliberately uses three answers,
because with an even split the mean and median coincide and the test proves
nothing — it passed a sabotage run before that was fixed.

**A missing rating is null, never 0.** Fourth place this rule now appears, with
untimed clocks, untagged movement and unrated drills. `rpeCoverage()` reports
who did not answer, and the summary says so out loud: a comparison drawn on
half the squad is not the squad's comparison.

**`gapFlag()` stays quiet below a full intensity point.** The coach's own drills
vary by +/-0.64 between runs, and a 1-10 answer given in a corridor is not a
precise instrument either. Wording is always a prompt to look — "worth asking
what made it heavy" — never a diagnosis. A test asserts no wording in there
contains injury or overtraining language, and it catches a deliberate breach.

**Its own 1-10 scale, worded from the player's side** (`RPE_SCALE`). The drill
anchors describe what a drill IS ("half-court shell, controlled 3v0"); a player
rating his own afternoon against a list of drills would just hand the coach his
own answer back. Blunt and short, because it gets asked in a corridor, often in
a second language, sometimes while someone is putting his shoes on.

**Asked about 30 minutes after practice** (Foster et al.). Asked on the floor,
the last drill drowns out the rest of the session. The app says so on the
screen, and nudges from the Practice tab while the answer is still worth having
— memory of how hard a session felt does not survive a week.

**One screen, one tap per player.** No modal per player, no scrolling back and
forth; tapping the same number again clears a mistap. A squad is about fifteen
taps. Anything slower does not get collected in February.

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
js/views/*.js         one file per tab, plus rpe.js (a flow, not a tab)
tests/load.test.js    unit tests for the maths
tests/intensity.test.js  the grid, the movement tags, and the fit to real data
tests/library.test.js importing a drill library without destroying practices
tests/harness.js      fake DOM + IndexedDB so views can run headlessly
tests/views.test.js   smoke tests that every screen renders and saves correctly,
                      and that the offline cache lists every module
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

## What the coach asked for after using it (2026-08-24)

First real feedback from the S&C coach, after a week on the tablet. Most of it
was UI. One item looked like a maths complaint and was not.

**"5v5 and 5v0 score the same, around 7.3."** He is right, and it is deliberate.
The situation scale bottoms out at 5v5, so the no-defence adjustment has
nowhere to drop. Checked against the club's own matched pair — 5v5 FC 5.75 vs
5v0 FC 5.50, same court and rhythm — the real gap is **0.25**, inside the grid's
own error (0.46) and well inside the +/-0.64 the same drill varies by between
runs. Letting the adjusted situation reach 0 made the fit *worse*
(R-squared 0.937 -> 0.926). The flat spot stays; the UI now says so out loud
instead of letting him find it and assume the app is broken.
`tests/intensity.test.js` asserts it, so nobody "fixes" it later.

**What he actually needed was the rhythm axis, which he could not reach.** His
real example — continuous Spanish 5v5 versus a whistle-heavy scrimmage — is
already a 3-point spread in the club's own measurements:

| Rhythm | Drill | Measured |
|---|---|---|
| Non-stop | 5v5 scrimmage | 8.50 |
| 3 lengths | 5v5 FC (+2-3tr.) | 6.50 |
| 2 lengths | 5v5 FC (+1-2 trans) | 5.75 |
| 1 length | 5v4+1 (1tr.) | 5.50 |

He was rating both at non-stop because the labels were written in court lengths
("three lengths, then stop"), which describe a rep-based drill and say nothing
about live play stopped by a whistle. **Only the labels changed** — the levels
and the formula are untouched, and the original court-length anchors are kept
in the notes so the 43 imported drills still mean what they meant.

He also asked for game format, contact, continuity, stoppages and work-to-rest
as separate new inputs. Declined, for the reason already recorded under "Stop
refining the intensity formula": his own contact/non-contact pairs move by less
than the noise, and adding factors on n=27 with no held-out set would be
inventing effects the measurements do not support. The escape hatch remains
per-run intensity adjustment, and live density is the measured check on exactly
the property he is describing.

The rest, and why:

- **Nv0 is its own option** (1v0 ... 5v0), instead of "5v5" plus a separate
  defence toggle. Same two fields underneath, same maths — he now picks the
  matchup the way he says it out loud.
- **Two groups, not three.** He splits smalls against bigs. Guards / wings /
  bigs was a guess by someone not in that gym, so groups became coach-defined
  in Settings like tags and categories. Default is Team / Bigs / Smalls.
- **"Typical length" said "just a default"**, which left him unsure whether to
  enter live-ball time or total time. Now says total, start to stop, and that
  it only pre-fills a manual entry.
- **A drill can be created courtside** by typing a name that is not in the
  library. Another coach springs drills on him that were never entered, and
  making him stop and rate one is how data collection dies. It starts on one
  tap and is rated after practice.
- **A late rating travels back to the practice.** He rates a courtside drill
  during or after that session, so the run has to pick the number up —
  otherwise the session stays permanently incomplete and "rate it later" is a
  dead end. Saving a rating fills in every run of that drill still flagged
  `unrated`, and says how many it touched.

  This does **not** contradict *snapshots over references*. A snapshot protects
  what a practice meant; a run that was never rated has nothing to protect —
  the field is blank, not different. Runs that already carry a number, including
  one the coach adjusted by hand for that day, are never touched.
  `tests/views.test.js` asserts both halves, and both were checked to fail when
  deliberately broken.

  Done with an in-memory scan rather than a `drillId` index: an index means a
  schema version bump, and the tablet is already carrying real data.

- **Unrated therefore had to mean `null`, not `0`.** `blockLoad()` returns null
  for a drill with no intensity and `loadCoverage()` reports what fraction of a
  session is missing — same rule as an untimed clock and an untagged movement
  profile. A zero would shrink the day and make a real spike read as a quiet
  week.
- **Notes per drill run** ("till 7", "stopped early, tight hamstring"). The
  `note` field was already on the block record and had simply never been shown.
  That is the fourth time the answer was "already recorded, not displayed" —
  check before proposing a field.
- **Change drill on a run**, for when the wrong one was tapped. Re-snapshots
  name, intensity and movement tags together; timings, notes and participation
  survive.
- **A finished session is editable.** Ending a practice claimed "you can still
  open it and correct anything afterwards" and that was not true — the summary
  was read-only apart from Delete. Drill rows are now tappable and the roster
  can be corrected.

## Hosting

Served by GitHub Pages from `main` / root:

    https://coachdusan.github.io/drill-management/

Pages requires the repo to be public, which is the reason `private/` exists at
all. Source is **Deploy from a branch**, not GitHub Actions — there is no build
step and nothing to run.

Every path in the app is relative (`./`). It has to stay that way: Pages serves
this from a *subfolder*, so a single leading `/` would 404 every file on the
tablet while still working locally.

Two pages exist for checking a device, and they are separate on purpose —
each answers a different question, and both must keep working if the app
itself is broken (no modules, no imports):

- `compat.html` — can this browser run the app at all?
- `offline-check.html` — is the app *genuinely stored* on this device? Lists
  any file that failed to save, and can wipe and re-save.

`offline-check.html` was written after offline failed on the tablet: the app
opened online, not with the wifi off. The service worker logic was correct.
The fault was that it installed *silently* — `cache.add().catch(() => null)`
tolerated a failed file and still reported success, so a half-empty cache was
indistinguishable from a working one. The worker now records what it saved and
what it didn't (`__cache-report.json` inside its own cache), and registration
moved ahead of the database open and the first render, because offline must not
depend on either of those succeeding. Bump `VERSION` in `sw.js` to force a
clean reinstall on the device.

Green checks are not the test. **Wifi off, open from the icon** is the test.

Installing on Windows: open the app URL (not `offline-check.html` — it carries
no manifest, so Edge will not offer to install it), then `•••` -> Apps ->
"Install this site as an app".

The app ships with no drills. The library is club data and must be carried to
the tablet by hand (`private/drill-library.json`, Settings -> Import a drill
library). An empty Drill library on a fresh device is correct, not a bug.

**Pushing from this Mac does not work.** `~/.gitconfig` had a credential helper
pointing at a `gh` binary in a since-deleted temp folder, which also blanked the
Keychain fallback — it broke every repo on the machine, not just this one. The
stale entries were removed (backup: `~/.gitconfig.backup-20260818`), but the
Keychain holds no GitHub credential, so command-line pushes still fail. Dusan
pushes via GitHub Desktop or VS Code. Commit locally and ask; do not burn time
retrying the push.

## Build stages

1. **Done** — shell, roster, drill library, backup/restore, offline install.
2. **Done** — live practice: concurrent stopwatches, group splits, three-state
   participation, pause/resume that survives a reload, manual entry for drills
   run before the app was open, context tags and notes, session summary.
3. **Done** — post-practice per-player RPE, compared against prescribed load.
4. Analysis: weekly load, per-player trends, ACWR, monotony/strain.
5. Custom fields the coach defines himself, folded into the comparisons.
