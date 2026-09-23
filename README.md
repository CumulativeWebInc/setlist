# Setlist

**Playlist-pitching CRM + scan-verified placement tracker.** Zero dependencies, Node ≥ 20.

The doctrine, in one line: **the tool tracks, reminds, and verifies — it never auto-sends.**

- Pitches, curators, tracks, placements, verification events, and follow-ups live in flat JSON envelopes (`data/*.json`), written tmp-file → fsync → atomic rename. A corrupt file fails closed, loudly — never silent garbage.
- **Validation rules V1–V7** are enforced in the data layer: payola-flagged curators freeze (flag needs verbatim evidence), placements need a playlist URL + receipt file, do-not-contact blocks outreach and surfaces the reason, max **2 nudges** with **7-day** spacing, personal-identity sends park at `awaiting-approval` without Black's exact-copy `approval_ref`, track URLs are Spotify-ID validated against a known-invalid denylist, every foreign key resolves.
- **Anti-spam governor G1–G8**: one pitch per (curator, track) until honestly closed, **20 outbound actions/day** cap (the queue shows 20 and defers the rest), every touch logged with actor + exact text + timestamp, and **G7** — sends are *recorded with evidence*, never performed.
- **Verification (V-1…V-4)**: exact Spotify track-ID matching against a snapshot, link-first/scan-second, receipt file on every run. The K6 verifier gate reproduces the known placements exactly (5/5) from `design/fixtures/`.
- `rescan.js` is cron-shaped: re-scan live placements weekly/on-demand; drops flip `live=false` and open a follow-up for the human — no auto-nudge ever fires.

## Quick start

```bash
node seed.js                 # seed the dogfood corpus (the real radio + playlist threads)
node setlist.js report       # pitches, placements, curator reply stats, budget
node setlist.js queue        # today's follow-ups, capped at 20 (G6)
node setlist.js verify <playlist_url> <track_id> --file snapshot.json
node rescan.js               # weekly re-scan (reads data/snapshots/ if present)
npm test                     # 84 tests, node:test, zero deps
```

Use `--dir <store-root>` to point at a different store (default `./data`), `--json` for machine output.

## Layout

| File | What it is |
|---|---|
| `setlist.js` | CLI surface |
| `store.js` | atomic JSON store |
| `rules.js` | V1–V7 + G1–G8 enforcement |
| `verify.js` | V-1/V-2 verification, pluggable methods |
| `rescan.js` | V-2 weekly/on-demand scan runner |
| `seed.js` | dogfood seed: the real 2026-09-14/15 corpus |
| `design/fixtures/` | K6 verifier fixtures + manifest |
| `tests/` | poison tests, K6 gate, round-trip, crash-safety, CLI flows |

Design docs live in `design/` (`DATA-MODEL.md`, `VERIFICATION-METHOD.md`, `ANTI-SPAM-GOVERNOR.md`, `TRADEOFFS.md`, `templates/`).

---
Built by **Cumulative Web Inc.** · Contact: hp@cumulativeweb.com
