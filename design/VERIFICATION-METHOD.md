# Setlist — Design: Verification Methodology (Stage 1)

**Date:** 2026-09-20 · **Purpose:** satisfy K2 — a repeatable procedure a second agent could execute blind. If a step can't be written down, it isn't verification.

## Doctrine (from the operation that already works)

- **Link-first, scan-second.** The curator-provided playlist link arbitrates *which playlist* to check. A public scan failure is never a verdict on the placement — only on that scan.
- **Claim ≠ placement.** "It's added" (Flow 9/14, two scans empty; confirmed 9/16) stays UNVERIFIED until evidence lands. The tool never counts a claim.
- **Evidence is a file, not a sentence.** Every placement carries ≥1 receipt on disk.

## Procedure V-1: verify a claimed placement

**Inputs:** `playlist_url` (curator-provided preferred), `track_id` (Setlist track record).

1. **Resolve the playlist.** If the curator gave a link, use it verbatim. If only a playlist name exists, record `playlist_url=null` and STOP — outcome is UNVERIFIED, never "not found." (Do not scan-search a name and declare absence; names collide.)
2. **Fetch the playlist contents.**
   - Method `spotify-api` (when app credentials exist): `GET /playlists/{id}/tracks` with pagination, capture full JSON to `receipts/ver_<id>.json`.
   - Method `manual`: operator pastes the track list / positions into the CLI's guided prompt; the CLI writes the operator's attestation + pasted evidence to the receipt file. Slower, ToS-clean, always available.
3. **Match the track.** Compare Spotify track IDs exactly (never title/artist fuzzy-match — duplicates and re-uploads collide). Record `found`, `position` (1-based), `total_tracks`.
4. **Write the verification-event** (schema in DATA-MODEL.md) with `raw_log_path` pointing at the receipt.
5. **Promote or hold:**
   - found + curator link → placement (`verified_via`: `both` if link+scan, `link` if curator's reply is the evidence with a manual attestation).
   - found via our own scan only, no curator link → placement with `verified_via=scan`, flagged "curator link still owed" in the pitch notes.
   - not found → NO placement. Pitch note: "scanned <date>, not present; <scan|link> requested." If the curator previously claimed it, status stays UNVERIFIED and a follow-up is scheduled (polite re-check, never an accusation).

## Procedure V-2: hold re-scan (placement still live?)

**Cadence:** weekly for `live=true` placements, via the existing cron pattern (same family as the gear-ledger heartbeat — one small Node script, absolute paths, exits non-zero only on real failure).

1. For each `live=true` placement, re-run V-1 steps 2–4 (same `playlist_url`).
2. If found → update `position`/`total_tracks`/`observed_at`; append receipt. (Position drift is data, not an alarm — record it.)
3. If not found → set `live=false`, write verification-event with `found=false`, open a follow-up on the pitch: "placement dropped from <playlist> — confirm with curator?" No auto-nudge fires; the human decides.
4. A placement that drops and reappears keeps ONE placement record with the full event history — the hold record is the product.

## Procedure V-3: bot-vet signals (flag, never auto-accuse)

Run at curator-intake and monthly for live placements. Each signal is a **flag for human review**, never an automated accusation:

1. **"Discovered On" cross-check:** does the playlist appear in artists' "Discovered On" sections (i.e., does it genuinely drive streams)? Absence = flag.
2. **Follower velocity:** sudden follower spikes with no editorial event = flag. (Baseline: record follower_count at intake; the re-scan captures drift.)
3. **Track:listener plausibility:** a 50k-follower playlist whose tracks show near-zero listener counts = flag.
4. **Shell-game pattern:** playlist renamed / curator handle changed since intake = flag + re-verify all its placements.

A flagged curator gets `notes` appended ("bot-vet flag <date>: <signal>") and their pitches are held at `draft` until a human clears the flag. Flags are never published, never messaged to the curator.

## Procedure V-4: what counts as a placement (the binary gate — K6)

For the build checkpoint, the verifier must reproduce the three known-good placements exactly:

| placement | expected |
|---|---|
| Zooted Zone → Eric Alper "360°" | found, position 216, total 216, verified_via=link (curator reply 2026-09-17) |
| Flex My Flame → DJ 6Rings "It's Goin" | found, position 7, verified_via=link (curator's own link, free route) |
| 3 tracks → Audiartist "New Rap Hits" | Zooted Zone #30, Shaka Zulu #21, Doves & Diamonds #31, verified_via=scan |

Test fixtures will carry captured playlist snapshots (stored under `design/fixtures/`, committed as test data, no live API needed in CI). **Verifier accuracy on the knowns must be 3/3 — binary gate, no interval tolerated (K6).**

## Spotify API access plan (K8 compliance)

- Client-credentials flow against public playlist endpoints only — no user data, no write scopes, no automation of follows/saves.
- App registration is account creation → **queued to Black** (identity, not tool access). Until it exists, Method `manual` is the production path and the verifier is still fully testable via fixtures.
- Before the first automated scan, the ToS review: document which endpoints are hit, at what cadence, under which scopes. If the review flags the approach as prohibited automation → K8 re-scope to manual-evidence workflows; the product remains a CRM + manual verifier (still the gap — nobody else has the proof layer either).
