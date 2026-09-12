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
original sheet. Nothing can verify that transcription except the source file.
(An earlier `tests/seed.test.js` is referenced in older notes but does not
exist; the library is covered by `tests/library.test.js`.)

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

## Stage 4: analysis, and why it is drill-first

**The unit of this screen is the drill and the day, not the session.** This was
the coach's own redirect. Offered three versions of a week-and-players screen,
he asked instead for "drill load and analysis of the drills" — which is how he
actually works: he plans a week by choosing drills, and he decides what a day
two days out from a game should look like. A list of sessions answers neither
question. The week/player/ACWR material from the original stage-4 scope is
still there, underneath, rather than first.

**The game-week label is set by hand, not derived.** The first version worked
GD-1 / GD-2 out from recorded games plus a list of upcoming fixtures. The coach
replaced it: a dropdown on Start a practice, options GD, GD-1 … GD-5, GD-X.

He was right, and the reason is worth keeping. Deriving it could only ever
label the *past* — labelling today needed a second list of fixtures nobody
would maintain — and it created two sources of truth for a fact he already
knows before he walks into the gym. One dropdown removed the fixtures list, the
derivation, and the ambiguity together.

Three distinct answers, and they must stay distinct:
- **GD … GD-5** — in the game week, and compared.
- **GD-X** — more than five days out. Explicitly excluded from the game-week
  comparisons at his request, because there is no game week to compare it
  against. It still counts in every load, drill and weekly total.
- **unset** — he has not said. NOT the same as GD-X. `gameDayCoverage()`
  reports it and the panel says how many practices are missing from the
  averages. Sixth place this rule now appears, after untimed clocks, untagged
  movement, unrated drills and missing RPE.

Editable after the fact from the session summary and from the live practice
header, which is also how the practices recorded before the field existed get
labelled. No migration: the field is simply absent on older sessions and reads
as unset.

**What the game-week analysis answers**, in the order he asked for it:

1. **Every GD-1 against every other GD-1** — `gameWeekComparison()`. Average
   practice length, the range behind that average, average load, average live
   density, drills per practice, and `n`. Averaged **per practice**, not per
   day: two sessions on one day are two practices.
2. **What a game day is made of** — `categoryByGameDay()`. For a chosen GD, the
   average minutes and live density of each drill category. Minutes are divided
   by **every practice in the bucket**, not just the ones that used the
   category: a category skipped on two GD-1s out of four averages half, which
   is the honest answer to "how much of this do I actually do". A test asserts
   this and catches the other divisor.
3. **The same drill over three timescales** — `drillWindowAverages()`. Week,
   month and season side by side rather than behind a selector, because the
   comparison is the point: a drill that ran 12 minutes in October and runs 20
   now is a different drill, and the season average hides it. A drill not run
   in a window shows an empty row, never last month's figures standing in.

**Live density is pooled, never averaged across sessions.** Averaging the
per-session percentages would let a 4-minute drill weigh the same as a
40-minute one. Coverage travels beside every density figure, as always — a
bucket's density covers only the drills he ran the second stopwatch on.

**Practice length is clocked drill time, not wall clock.** It is the sum of the
stopwatches, and when practice splits into groups two clocks run at once, so it
can exceed how long he was in the gym. Wall clock is recorded alongside where
`startedAt`/`endedAt` allow, and the screen says which is which.

**A game day shows 0 AU, and that had to be said out loud.** Nobody runs a
stopwatch on a game, so the app genuinely does not know what one cost — almost
certainly the heaviest day of the week. Sitting a 0 next to a 384 AU Monday
would read as "games are free", and it also means weekly totals, monotony and
ACWR all exclude games entirely. The panel states this whenever the GD row is
empty rather than letting the row speak for itself.

**The provisional ACWR was asked for, against a recommendation, and is
guarded.** The concern (a ratio off a few days is noise wearing a decimal
point) was put in front of the coach and he chose it anyway, so it ships.
What makes it safe:
- It divides by the days that **actually exist**, not by 28. Dividing a 10-day
  total by four understates chronic load and invents a spike out of nothing —
  sabotaging this exact line turns steady load into a false 1.87.
- It stays blank for the first **seven** days, and that is arithmetic, not
  caution: until there is more history than the acute window, both windows are
  the same days and the answer can only be 1.00. A number that can only be 1.00
  is not an early reading of anything. The screen explains that instead.
- It is marked `provisional` on the tile every time, not once in a footnote,
  and the wording states how many days it stands on.
- The real 28-day figure is untouched and still withheld until day 28.

**ACWR and monotony are computed over the whole season, then sliced.** Both
count backwards from a day, so computing them on a 4-week view would make the
season look like it started a month ago.

**Coverage travels with every total, again.** An unrated drill contributes no
load, so a window that is 30% unrated is incomplete, not light — stated at
window level, per day (striped bars), per drill row, and per movement panel.
The movement panel used to *replace* its "units are not comparable between
tissues" caveat with the coverage warning, which removed the caveat exactly
when the totals deserved it least; a test caught that and both now show.

**Drill runs now snapshot their `category`.** Re-filing a drill in the library
must not rewrite what last November's practices were made of — the same reason
name, intensity and movement tags are already snapshots. Runs recorded before
this fall back to a library lookup and are labelled "Not in the library" if the
drill is gone, so the fallback shrinks over time rather than growing. No
migration and no schema bump; the tablet is carrying real data.

**Charts are flexbox divs, not SVG and not a library.** They scale to any
tablet width without distorting text, work in dark mode off the same CSS
variables, and add nothing to maintain. Bars switch from per-day to per-week
past 70 days. A striped bar means that day contains unrated drills, so a short
bar is not mistaken for an easy day.

`tests/history.test.js` covers the aggregation. Three sabotage runs were
checked to fail before the green run was trusted: making an unrated drill count
as zero, dropping rest days from the game-day buckets, and dividing the
provisional ACWR by 28 days that do not exist. All three were caught.

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
js/history.js         aggregation across many practices: days, drills,
                      categories, game-day buckets, per-player series
js/sync.js            runs that follow the library until their drill is set
                      up; the start-up repair; splitting Live / scrimmage
js/ui.js              DOM builder, modal, toast, file download/pick
js/components.js      intensity picker/badge, status dot
js/app.js             hash router and nav
js/views/*.js         one file per tab, plus rpe.js (a flow, not a tab)
js/views/reports.js   minutes by category and by drill, over chosen dates
tests/load.test.js    unit tests for the maths
tests/history.test.js the aggregation layer, and the honesty rules in it
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
$JSC -m tests/history.test.js   # days, drills, game-day buckets
$JSC -m tests/library.test.js   # importing a library without destroying practices
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

## What the coach asked for after two weeks (2026-08-30)

Second round of feedback. Most of it was reporting. One item was a real hole
in the intensity grid, and one was a request that had already been declined
once and needed answering properly rather than repeating "no".

### The intensity grid had a hole, and it was extrapolation

**Free throws, entered as Stationary + 1v0, came out at 6.7 — and 4.0 even
with the rhythm all the way down.** He said it should not be above 1.0. He was
right that it was nonsense, and the cause is worth writing down because it is
the kind of fault a good fit statistic hides.

Check the club's 27 measured drills: **not one of them puts the adjusted
situation above the court level.** Nobody runs 1v1 in a phone booth, so
few-players-on-a-small-court is a corner the data has never visited. The grid
kept climbing there anyway, because `situation` is a proxy for how much of the
court's ground falls to each player, and it was being applied where there is
no ground to fall to anybody. R-squared 0.934 says nothing about a region with
no measurements in it.

**Fix: at Stationary the matchup axis drops to its floor.** 1v0 and 5v5 come
out the same on the spot — a free-throw line does not get harder because fewer
people are standing on it. Free throws land on 2.0, and the club's own two
measured stationary drills came in at 1.50 and 1.62, so 2.0 is about right for
spot work.

The fit is **identical** with and without it — R-squared 0.934, mean error
0.471, worst 1.20 — because nothing measured is in the corner it touches. That
is the justification, and `tests/intensity.test.js` asserts it directly
(`no measured drill sits in the corner the stationary floor touches`) rather
than leaving it in prose. If a measured drill ever lands there, the test fails
and the rule has to be re-argued against real numbers.

**The more general version was offered and he chose against it.** "The matchup
can never beat the court" would also fix inside-the-arc shooting, but it drags
two drills he actually uses: 1 on 1 HC 6.7 → 4.7 and 2 on 2 HC 6.0 → 5.3. His
own measured half-court series (5v5 4.0, 4v4 4.5, 3v3 4.6) extrapolates to
about 5.3 for 1v1 HC, so the general rule undershoots there by as much as the
old grid overshot. Both costs were put in front of him with the numbers; he
took the narrow fix. Tests pin all three of those values so nobody widens it
later by accident.

**The grid's floor is 2.0 by construction** — (1+1+1)/3 x 2. For anything
genuinely lighter, the grid is the wrong tool and `manual` mode is the right
one. The picker says so on screen when Stationary is selected.

### Transitions: same dial, two wordings

He asked again for the court-lengths input back alongside Rhythm — "put into
account both things". The honest answer is that they are **one dial**, not two:
Rhythm IS the old lengths dial, relabelled in the last round, and the levels
and maths never changed. Court is what says how far a "length" runs, so court
x rhythm already spans the transition question:

| | Non-stop | Stop-start |
|---|---|---|
| Full court 5v5 | 7.3 | 4.7 |
| Half court 5v5 | 6.0 | 3.3 |

A fourth input would count the same fact a third time, with no column in the 27
measured drills to set its weight from — the same reason game format, contact,
continuity and work-to-rest were declined last round.

**So every rhythm level now carries both wordings** ("Rare stops — 3 lengths,
then stop"), and he sets it whichever way suits the drill. The lengths wording
is also the one the 43 imported library drills were rated against, so keeping
it visible is not only a convenience. `tests/intensity.test.js` asserts every
level has both, and asserts `deriveIntensity` still takes exactly three
factors — that test is what fails if someone adds a fourth.

### Reports: its own tab, and calendar periods

`js/views/reports.js`, a fifth tab. It is separate from Analysis because it
answers a different question. **Analysis asks about the last 28 days; Reports
asks about October.** One is a training-load window that has to roll; the other
is a planning period with edges he chose. Mixing them into one range selector
would make "Month" quietly mean "28 days" and he would never know.

Day / Week / Month / Year, stepped with ‹ ›, plus **from … till** for anything
else ("26.10. till 22.12."). A week runs Monday to Sunday.

**The column unit follows the period rather than being a second choice.** A
week is read day by day (his first table: 8.12. GD-3, 9.12. GD-2, 10.12. GD-1);
a month week by week (his second: Week1 6.10.-13.10.); a year month by month.
He drew both tables; neither needed him to pick a granularity.

**Empty day columns are dropped, empty week columns are kept.** A week has
seven days and he trains four; five blank columns push the ones that matter off
the side of a tablet. An empty week inside a month is different — a week off is
a fact about the month.

**The contact rows come from the grid, not from the categories.** His table has
rows the category list cannot produce:

    Contact 1on1/2on2,..    contested, small-sided
    Contact 5on5            contested, whole squad on the floor
    Whole contact           the two above, added

Categories are his own vocabulary and are about what a drill is FOR (defence,
transition). Who is in it comes from `contact` and `situation`. So the table is
**two cuts of the same runs, not a hierarchy**: a contested transition drill is
counted under Transition and inside Whole contact, and unopposed shooting is in
neither contact row. That is the one thing on the screen that can be misread,
so it is stated in a footnote under the table and asserted in a test.

**Drill runs now snapshot `situation` too.** Same pattern as `category` — old
runs fall back to a library lookup, so the fallback shrinks over time. No
migration and no schema bump; the tablet is carrying real data.

**A run that cannot be classified is a fourth answer, not a bucket to hide it
in.** A run recorded before the snapshot whose drill has since been deleted
from the library genuinely cannot be placed. Folding it into Contact 5on5 would
produce a contact total he would trust and should not, so it is left out of the
contact rows, still counted in its category and in the totals, and named on
screen with its minutes. Seventh place this rule now appears, after untimed
clocks, untagged movement, unrated drills, missing RPE and unset game days.

**Every live figure is over the drills he timed, and says so.** He runs the
second stopwatch mainly on live and scrimmage work, which is exactly the work
he wants reported — so most report cells have a live figure and some do not. A
cell whose live coverage is short prints `timed on 15:00` under it; a cell with
nothing timed prints `not timed` rather than a 0%. Density is pooled inside a
cell, never an average of percentages.

**Per drill, the spread is the point.** His worked example — "5on5, HC+2: 5
times, longest 25/12.5, shortest 15/8, average 20/10, then GD-1: 3 times…" — is
built as-is, and the game-day split is what turns a spread into a plan. A drill
that runs 25 minutes before one game and 10 before the next is being used two
different ways and the mean hides it.

**Live min/max/average are computed over the TIMED runs only, with the count
beside them.** Counting an untimed run as zero live minutes would report a
"shortest live time" of 0:00 for a drill he simply did not put a second watch
on — a lie the same shape as a real number. `spreadOf()` returns null for every
live figure when nothing was timed.

### The rest, and why

- **Live time in minutes as well as per cent, everywhere.** The percentage is
  what makes a 40-minute scrimmage comparable with a 10-minute one; the minutes
  are what he plans with. `fmtLive()` prints both in that order, and the session
  summary has them in two columns.

- **Drag to reorder drill runs.** Pointer events, not HTML5 drag-and-drop,
  which does not fire from a finger. The drag starts from a `≡` grip so that
  tapping a row still opens it — a whole-row drag would swallow every tap. New
  `order` field on the block, absent on every run recorded before this, and
  those keep sorting by `createdAt` exactly as they did. No migration.

  **The Done list flipped from newest-first to the order it ran.** Dragging a
  drill "before another one" only means something in a list that is the practice
  as it happened, and it now matches the summary he gets when he ends practice —
  which is what he asked for in the next item anyway.

  The harness got a synthetic 50px-per-row geometry so the drag can be driven
  headlessly. It proves the gesture reaches the database. It proves nothing
  about how it feels under a thumb.

- **Notes on screen, in three places, on the lines he wrote them on.** Under a
  running drill, under a finished one, and in the drill library list beside the
  intensity and the movement tags. One class does it — `.run-note`, which
  carries `white-space: pre-line`. Rendering a note with `.tiny` again silently
  joins line two onto line one, so a test asserts the class and asserts the
  newline survives into the DOM.

- **Change drill can now create one.** "Change drill" only offered drills
  already in the library, which meant a wrong tap noticed after practice could
  not be corrected without leaving, adding the drill and coming back. Typing a
  name that is not in the library now creates it unrated, exactly as starting a
  drill courtside does.

- **The views suite was date-pinned and rotting.** Fixtures used literal dates
  ('2026-08-18'), so the ACWR assertions changed answer every day the calendar
  moved and the suite went red without anything in the app changing. Fixtures
  are now relative to today.

### Not built, and why

- **No CSV or PDF export of a report.** He did not ask for one. Worth offering
  before building — a report he can hand to the head coach is a different
  feature from a report he reads on the tablet, and the second is what was
  asked for.

## What the coach asked for after three weeks (2026-09-12)

A long list. Agreed order, his choice: **(1) bugs and small items, (2) seasons
and phases, (3) Reports game-day filter, (4) PDF reports.** Stage 1 is below;
the rest is recorded so the decisions are not re-asked.

### A courtside drill kept its guessed details forever — fixed at the source

He typed a new 5on5 drill in during practice, set it up afterwards in Drills
(Defense, 5v5 live), and the report still filed that practice's run under the
old values. **Reproduced exactly for category:** every courtside path copied a
brand-new drill's *defaults* into the run — `Skill development`, which he never
chose — and a snapshot is never rewritten. The old late-rating backfill copied
intensity, matchup and tags but not category, and only while the run was still
`unrated`, so rating the run on the practice screen first shut it out entirely.

**His "no D" tag did not reproduce.** That chip only shows for `contact ===
false`, and no courtside path in any version wrote that. The fix covers it
regardless; if he still sees it, it needs his real data.

The fix is not "copy more fields later". It is: **a drill that has never been
set up gives a run no details at all.** `drillSnapshot()` in `models.js` is now
the only place a run copies a drill — there were five hand-written copies — and
for an `unrated` drill it writes `null` category, matchup, tags and intensity
plus `detailsPending: true`. Such a run follows the library (reports say
"Drill not set up yet" and count it as matchup-unknown) until the drill is
saved once; `followLibrary()` then fills it in and it becomes an ordinary
snapshot. An intensity he set by hand on the run is kept — that was a decision
about that day. Eighth place the null-not-a-guess rule appears.

This also closed a quieter version of the same bug: starting a still-unrated
drill from the library list snapshotted an invented 3.3 intensity.

**Runs already on the tablet are repaired once at start-up**
(`repairCourtsideRuns()`), recognised by what the old code wrote: the drill did
not exist until a minute before the run (or was created by a swap after it),
and the run carries the default category or none, with no movement tags. A
drill genuinely picked from the library was there before the run, so a real
snapshot cannot match — a test proves a re-filed library drill's old run is
left alone. Idempotent; it marks every run it touches.

Tests prove four deliberate breaks fail: copying defaults again, the repair
dropping the "drill existed first" check, overwriting a hand rating, and the
search box below.

### Smaller items

- **Reports "By drill" search jumped to the top on every letter.** Each
  keystroke re-rendered the whole screen and destroyed the box being typed in,
  closing the keyboard. It now repaints only the list; so does opening a drill.
- **GD-6.** Added; GD-X now means more than six days out. GD-5 already existed.
- **Game day on Recent sessions**, only when set — unset prints nothing rather
  than a placeholder that reads like an answer.

### "Live / scrimmage" split into four — his names

20 of the 43 library drills sat in that one category. Offered two, three or
four names; **he chose four**: `5on5 live`, `Small-sided live`,
`Advantage games`, `Continuous games`.

Only the first two can be worked out from recorded data (situation + contact),
so Settings offers a one-tap split when anything still carries the old name.
The library splits 10 / 10. The other two must be filed by hand, and the dialog
says why: the grid stores 4v3 identically to 4v4, and has no concept of three
teams rotating.

**The split includes recorded runs, by each run's own snapshotted matchup.**
This looks like it breaks "snapshots over references" and does not: nothing
about what a practice was changes, only how finely it is named, and the answer
comes from the run's own record rather than the library today. Without it,
this season's reports would show the old category until the split date and
the new ones after. Unopposed or matchup-unknown records stay under the old
name and are counted, not guessed.

### Decided, not yet built

- **Seasons and phases.** A season picker (2026/2027) with Preseason /
  Inseason / Offseason set as editable date ranges; reports show the chosen
  season and phase only. It is a filter over one database, not a separate
  database per season — nothing is lost when he switches. Unlike game day, the
  phase *is* derived from the date: it is one boundary he sets once, not a
  fact about each practice. His current season: preseason until 20.9.2026.
- **Reports game-day filter.** A row GD-1 … GD-6 under Day / Week / Month /
  Year / dates, combined with a from–till range, always showing how many
  practices it stands on.
- **PDF, built inside the app — his choice over Print → Save as PDF.** Offered
  both with costs: print needs a "Background graphics" tick every time; in-app
  means a PDF library carried in the app and every layout change is code. He
  chose one tap and guaranteed colours. The library must be vendored into the
  repo (no CDN — offline) and added to `sw.js`. Logo stored on the device.
  Templates he specified: daily (by category); weekly (each practice or all
  together, by category, by drill with count / min / max / average); monthly
  (by week and whole month, by drill); yearly (by month); any dates.
  **Drill order in every PDF: contested 5on5 first, then other contested, then
  non-contact — within each, most-used first.** Contact first because that is
  where live time is, and live time is what he reads.

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
4. **Done** — analysis: drill and category totals, game-day (GD-n) buckets,
   weekly load, per-player trends, ACWR, monotony.
4b. **Done** — reports: day / week / month / year / any two dates, by category
   and by drill, full time beside live time, and his own weekly grid.
5. Custom fields the coach defines himself, folded into the comparisons.
