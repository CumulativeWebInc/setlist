# Setlist — Design: Data Model (Stage 1)

**Date:** 2026-09-20 · **Working name:** Setlist (pending Black's call; "Marquee" never appears product-facing — see TRADEMARK.md)
**Rule:** no placeholder fields. Every field has a type and a meaning. Schemas enforced in code, not in prose.

Storage: flat JSON files under `data/` (`curators.json`, `pitches.json`, `placements.json`, `verifications.json`, `followups.json`, `tracks.json`), each a `{ "version": 1, "records": [...] }` envelope. Zero-dep, human-readable, git-diffable. (Trade-off table in TRADEOFFS.md.)

## 1. track

| field | type | required | notes |
|---|---|---|---|
| id | string (slug) | yes | e.g. `zooted-zone` |
| title | string | yes | |
| artist | string | yes | e.g. `That Boy Hi Hat` |
| spotify_url | string (URL) | yes | verified track URL only; must match `^https://open\.spotify\.com/track/[A-Za-z0-9]+$`; the invalid `1sY0hpRVAYMVgTEeDxZgFA` pattern is rejected at write time |
| isrc | string | no | from the verified catalog index when known |
| explicit | bool | yes | |
| fcc_safe | bool | yes | never imply a clean version exists when it doesn't |
| release_date | string (YYYY-MM-DD) | no | |

## 2. curator

| field | type | required | notes |
|---|---|---|---|
| id | string (slug) | yes | e.g. `flow-no-label-needed` |
| name | string | yes | person or brand name |
| handles | string[] | no | e.g. `["@flowdigonthetrack"]` with platform noted in notes |
| platform | enum | yes | `spotify-playlist` \| `radio-fm` \| `radio-internet` \| `blog` \| `influencer` \| `other` |
| playlist_urls | string[] (URL) | no | curator-provided preferred; empty until they give one |
| genres | string[] | no | lowercase tags, e.g. `["hip-hop","alt-rap"]` |
| follower_count | int \| null | no | with `followers_observed_at` (ISO date) when set; null = unknown, never 0-as-unknown |
| submission_path | object | yes | `{ type: "form-url"\|"email"\|"dm"\|"physical-mail"\|"unknown", value: string }` |
| account_needed | bool | yes | default false |
| payola_flag | bool | yes | default false; **true = any fee charged for placement** |
| payola_evidence | string | iff payola_flag | verbatim evidence, e.g. "rapsushiplaylist.com sells $25 playlist adds" |
| do_not_contact | bool | yes | default false |
| dnc_reason | string | iff do_not_contact | |
| stats | object | yes | `{ pitches: int, replies: int, placements_verified: int }` — maintained by the tool, never hand-edited |
| notes | string | no | free text |
| created_at / updated_at | ISO datetime | yes | |

## 3. pitch (outreach thread)

| field | type | required | notes |
|---|---|---|---|
| id | string | yes | `pch_YYYYMMDD_NNN` |
| curator_id | string | yes | FK → curator.id |
| track_ids | string[] | yes | FKs → track.id, ≥1 |
| channel | enum | yes | `email` \| `form` \| `ig-dm` \| `x-dm` \| `physical-mail` \| `other` |
| status | enum | yes | `draft` \| `awaiting-approval` \| `sent` \| `acknowledged` \| `replied` \| `placed` \| `unplaced` \| `closed` |
| messages | object[] | yes | each `{ date: ISO, direction: "out"\|"in", text: string (exact), approval_ref: string\|null }` — approval_ref required when `direction=out` AND sent under Black's personal identity |
| next_action_date | string (YYYY-MM-DD) \| null | no | the follow-up scheduler reads this |
| next_action | string \| null | no | plain-language, e.g. "polite check-in if no reply" |
| nudges_used | int | yes | default 0; **hard cap 2** |
| last_nudge_at | ISO date \| null | no | |
| retired_reason | string \| null | no | set when status → closed/unplaced |
| created_at / closed_at | ISO datetime | yes | closed_at null until closed |

## 4. placement

| field | type | required | notes |
|---|---|---|---|
| id | string | yes | `plc_YYYYMMDD_NNN` |
| pitch_id | string | yes | FK → pitch.id |
| curator_id | string | yes | FK → curator.id |
| track_id | string | yes | FK → track.id |
| playlist_url | string (URL) | **yes** | **a placement without a playlist URL is rejected at write time** |
| position | int | yes | 1-based position at verification time |
| total_tracks | int | yes | playlist length at verification time |
| verified_via | enum | yes | `link` \| `scan` \| `both` |
| observed_at | ISO datetime | yes | when the evidence was captured |
| live | bool | yes | true = last check found it; false = dropped |
| receipts | string[] | yes | paths to evidence files (scan logs, snapshots), ≥1 |

## 5. verification-event

| field | type | required | notes |
|---|---|---|---|
| id | string | yes | `ver_YYYYMMDDHHMMSS` |
| placement_id | string \| null | no | null for discovery scans not yet tied to a placement |
| playlist_url | string (URL) | yes | **always the curator-provided URL when one exists** |
| track_id | string | yes | |
| observed_at | ISO datetime | yes | |
| found | bool | yes | |
| position | int \| null | iff found | |
| total_tracks | int | yes | |
| method | enum | yes | `spotify-api` \| `manual` |
| raw_log_path | string | yes | path to the raw response / evidence file |

## 6. follow-up

| field | type | required | notes |
|---|---|---|---|
| id | string | yes | `fup_YYYYMMDD_NNN` |
| pitch_id | string | yes | FK |
| due_date | string (YYYY-MM-DD) | yes | |
| action | string | yes | e.g. "one polite check-in via site contact — do NOT resubmit the form" |
| done | bool | yes | default false |
| done_at | ISO datetime \| null | no | |
| result | string \| null | no | what happened |

## Validation rules (enforced in code — K-blockers)

1. **V1 payola:** `curator.payola_flag=true` → pitch creation for that curator is rejected; existing drafts are frozen. (K: L1 standing rule.)
2. **V2 evidence:** `placement` write requires non-empty `playlist_url` AND ≥1 receipt AND `verified_via` in {link, scan, both}. A claimed add with no link and no scan = UNVERIFIED — it stays a pitch note, never a placement.
3. **V3 do-not-contact:** `curator.do_not_contact=true` → new pitch creation rejected with the reason surfaced.
4. **V4 nudge cap:** `nudges_used ≥ 2` → further follow-up scheduling rejected; pitch must move to `closed` with `retired_reason`. Minimum 7 days between `last_nudge_at` and any new nudge.
5. **V5 approval:** outbound message under Black's personal identity requires `approval_ref` (his exact-copy approval); missing ref → status cannot leave `awaiting-approval`.
6. **V6 track URL:** `track.spotify_url` must match the Spotify track URL pattern; the known-invalid link is rejected by explicit denylist.
7. **V7 referential integrity:** every FK must resolve; deleting a curator with live pitches/placements is rejected (archive instead).

## Seed data (dogfood corpus, import at build)

- 10 threads from `radio/followup-plan.md` → pitches + follow-ups (statuses mapped; the DJ 6Rings payola note becomes `payola_flag=true` on his curator record with evidence).
- 25 opportunities from `radio/submission-opportunities.md` → curator records (submission_path populated, account_needed flags).
- Verified placements: Eric Alper "360°" (Zooted Zone #216/216, verified_via=link — curator reply), Audiartist "New Rap Hits" (3 tracks, verified_via=scan), DJ 6Rings "It's Goin" (Flex My Flame #7, verified_via=link, curator's own link, free route).
- WATCH THA GAP: pitch, status=replied, do NOT mark placed (waiting-on-reply).
