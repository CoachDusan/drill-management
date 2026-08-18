# Load Tracker

Practice load tracking for a strength & conditioning coach working without
GPS or heart-rate hardware. Define your drills and their intensity, run a
stopwatch on each one during practice, then look at how the week is stacking up.

Runs entirely on the device — no server, no account, works with the wifi off.

To run it locally:

```sh
python3 -m http.server 8765
```

then open <http://127.0.0.1:8765/>.

See [CLAUDE.md](CLAUDE.md) for what the numbers mean, what they cannot mean,
and why the app is built the way it is.
