# Setlist — Design: Anti-Spam Governor (Stage 1)

**Date:** 2026-09-20 · **Purpose:** satisfy K3 and TWENTY-MINDS mind #13 (risk underwriter). The tail risk — Setlist becoming a bulk-outreach machine that burns curator relationships and gets CWI's artists flagged as spammers — is not negotiable. One spam incident costs more than the tool ever earns.

## Core architectural decision

**Setlist is a CRM, not a mail-merge.** The tool tracks, reminds, and verifies. It does not send bulk messages. There is no "send to N curators" command, no template blast, no Auto-Pitch. Every outbound touch is individually composed (or individually approved) and individually logged. If a future user wants bulk outreach, that is a different product with a different name — not this lane.

## Enforced limits (data layer, not policy prose)

| # | rule | enforcement |
|---|---|---|
| G1 | One initial pitch per (curator, track) pair — duplicates rejected | V-rule in code: pitch creation checks existing non-closed pitches for same curator+track |
| G2 | Max 2 follow-ups per pitch, ≥7 days apart | `nudges_used` cap + `last_nudge_at` check; 3rd nudge rejected, pitch must close with `retired_reason` |
| G3 | Do-not-contact is absolute | `do_not_contact=true` → pitch creation rejected, follow-up scheduling rejected |
| G4 | Payola-flagged curators are unpitchable | pitch creation rejected; existing drafts frozen |
| G5 | Personal-identity sends need exact-copy approval | status cannot leave `awaiting-approval` without `approval_ref` |
| G6 | Daily action budget | ≤20 outreach actions/day across all pitches (configurable down, never up without a design change); the queue command refuses to list more — the operator does tomorrow's work tomorrow |
| G7 | No automated DMs, form fills, or email sends in v0.1 | the CLI records *evidence of sends the human made* (`setlist pitch sent <id> --evidence "..."`); it never performs the send. Automation of the send path requires a new design review + Black's explicit approval |
| G8 | Every touch logged with actor + timestamp | `messages[]` entries carry date, direction, exact text; anonymous or backdated entries rejected |

## The polite-touch protocol (encoded)

1. First contact: value-first, short, one ask. Templates in `design/templates/` carry the explicit-content disclosure and never promise what doesn't exist.
2. Follow-up 1 (≥7 days, only if no reply): one polite check-in referencing the original thread. Never re-send the full pitch unprompted.
3. Follow-up 2 (≥7 days after #1, final): short close-out — "no worries if it's not a fit, closing the loop on my end." Leaves the door open without pressure.
4. After 2: `closed` with `retired_reason` ("no reply after 2 touches", "declined", "placed", ...). The curator stays in the CRM with full history — the relationship compounds across releases even when this pitch didn't convert.

## Incident response (K11)

- **Any** spam complaint, curator block, or platform warning traceable to Setlist-assisted outreach → immediate feature freeze on outreach (verification-only mode), governor redesign, incident logged.
- **Second incident** → outreach feature killed permanently; the tool becomes verification + CRM history only.
- The freeze/kill is a code path (`config.outreach_enabled=false`), not a promise.

## Templates (shipped in `design/templates/`)

- `first-pitch-email.md` — with explicit-content disclosure block and a "never claim" checklist (no clean version, no guaranteed anything).
- `followup-1.md`, `followup-2-final.md` — the two-touch ladder above.
- `verification-request.md` — "could you drop the direct playlist link so I can confirm the add?" (the DJ 6Rings lesson: the link is the product).
- Every template ends with the approval gate note: personal-identity sends need Black's exact copy; CWI-account sends log under fire-always.

## Why this is the moat, not the handicap

The incumbents' Auto-Pitch direction (PlaylistSupply) optimizes for send volume — which is exactly what trains curators to ignore pitches and platforms to flag senders. Setlist's governor optimizes for *reply rate per touch* and *relationship longevity*: fewer, better touches, every placement verified, every curator's history compounding. The constraint is the feature.
