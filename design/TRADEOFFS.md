# Setlist — Design: Trade-off Tables (Stage 1)

**Date:** 2026-09-20 · Per the business-lifecycle playbook: multi-path decisions ship the trade-off table (option / evidence / cost / risk / time-to-result / fallback) before commitment.

## T1 — Storage

| option | evidence | cost | risk | time-to-result | fallback |
|---|---|---|---|---|---|
| **Flat JSON files** (chosen) | gear-line pattern: intelligence store, ledger, and catalog index all run flat JSON at this scale; human-readable, git-diffable, zero-dep | $0 | query speed degrades past ~10k records; concurrent writes need file locking | immediate | migrate to SQLite when corpus >10k records or queries need indexes |
| SQLite | single-file, indexed, transactional | $0 (node:sqlite in Node 22+) | binary file opaque in git; schema migrations heavier; overkill for <10k records | +2 days | — |
| Postgres/Supabase | hosted, concurrent | free tier exists but = vendor dependency + account | violates $0-no-new-accounts posture; unnecessary at this scale | +1 week | — |

**Decision:** flat JSON, `data/*.json` envelopes with `version: 1`. A `store.js` module owns all reads/writes with a write-ahead temp-file + rename for crash safety. Migration trigger written into the code comments: >10,000 records in any one file.

## T2 — Playlist scanning: Spotify Web API vs manual evidence

| option | evidence | cost | risk | time-to-result | fallback |
|---|---|---|---|---|---|
| **Spotify Web API, client-credentials** (chosen for automation) | public playlist endpoints are the documented free path; read-only, no user data | $0 | needs app registration (Black's tap — queued); ToS review required (K8); rate limits on aggressive scanning | after Black's tap | manual |
| **Manual evidence entry** (chosen as day-one path) | operator pastes positions / attaches screenshots; the DJ 6Rings and Eric Alper verifications were effectively manual | $0 | labor per verification; human error | immediate | — |
| Unofficial scraping of open.spotify.com | no API key needed | $0 | ToS-hostile; brittle; the Fastly/TLS lesson says our VM's fingerprint already struggles with some endpoints | fast but fragile | abandoned |

**Decision:** ship manual-evidence verification first (fully testable via fixtures, ToS-clean); add Spotify API as the automated lane after Black's app-registration tap + the K8 ToS review. Both write identical `verification-event` records — the method field is the only difference.

## T3 — Scan scheduler

| option | evidence | cost | risk | time-to-result | fallback |
|---|---|---|---|---|---|
| **Cron-driven re-scan script** (chosen) | gear-ledger heartbeat cron is the proven pattern: small Node script, absolute paths, single purpose, exits non-zero only on real failure | $0 | cron owns the cadence, not the tool | immediate | on-demand |
| On-demand only | simplest; operator runs `setlist rescan` | $0 | placements silently drop between manual runs — the hold record is the product, so this weakens it | immediate | — |
| Daemon/watcher | continuous | $0 | persistent process = operational burden, VM restarts | +3 days | — |

**Decision:** weekly cron (`setlist-rescan`, Sundays) + on-demand `setlist rescan` command. The cron is the hold-monitor; the command is the operator's tool.

## T4 — Scope: what v0.1 is NOT

| excluded | why | when it returns |
|---|---|---|
| Automated sending (DMs, forms, email) | the anti-spam governor (G7); automation of sends needs its own design review | never without Black's explicit approval + new governor review |
| Paid-pitching support | payola flag; L1 standing kill rule | never |
| Multi-artist seats / team workspaces | productization-gate feature, post-10-20 | only if the gate clears |
| Bot-vet auto-accusation | flags are human-reviewed by design (V-3) | never automated |
| Public free tier / SKU | gated to 2026-10-20 decision | only if the gate clears |

## T5 — Name (from TRADEMARK.md)

"Marquee" fails decisively (Spotify Marquee, same industry — fatal). Ranked alternates: **Setlist** (recommended), Pitch Pipe, Stagehand. **Working lock: Setlist**, pending Black's call; "Marquee" appears nowhere product-facing (code, README, UI, marketing). Rename loop max 1 cycle (K4) — if Black rejects all three, the lane pauses for a fresh screen, not a debate.
