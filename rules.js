#!/usr/bin/env node
// Setlist — rules.js
// Every validation rule from DATA-MODEL.md (V1–V7) and ANTI-SPAM-GOVERNOR.md (G1–G8)
// enforced as code. Every rejection throws a RuleError naming the rule.
//
// The CLI (setlist.js) and the seed importer (seed.js) both validate through here.
// There is no bypass path for operator actions. The single exception is
// validatePitchNew(..., { historical: true }), used ONLY by seed.js for threads
// that predate a payola/DNC flag — the historical record is preserved and frozen,
// never re-pitched. CLI never passes { historical: true }.

import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class RuleError extends Error {
  constructor(rule, message) {
    super(`[${rule}] ${message}`);
    this.name = 'RuleError';
    this.rule = rule;
  }
}

// ---- URL patterns -----------------------------------------------------------
export const TRACK_URL_RE = /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/;
export const PLAYLIST_URL_RE = /^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+$/;
// Known-invalid link from the operation's history — explicit denylist (V6).
export const INVALID_TRACK_IDS = new Set(['1sY0hpRVAYMVgTEeDxZgFA']);

export function spotifyTrackId(url) {
  const m = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)$/.exec(url || '');
  return m ? m[1] : null;
}

// ---- enums ------------------------------------------------------------------
export const PLATFORMS = ['spotify-playlist', 'radio-fm', 'radio-internet', 'blog', 'influencer', 'other'];
export const SUBMISSION_TYPES = ['form-url', 'email', 'dm', 'physical-mail', 'unknown'];
export const CHANNELS = ['email', 'form', 'ig-dm', 'x-dm', 'physical-mail', 'other'];
export const PITCH_STATUSES = ['draft', 'awaiting-approval', 'sent', 'acknowledged', 'replied', 'placed', 'unplaced', 'closed'];
export const TERMINAL_STATUSES = ['closed', 'unplaced'];
export const VERIFIED_VIA = ['link', 'scan', 'both'];
export const VERIFY_METHODS = ['manual', 'spotify-api'];

export const NUDGE_CAP = 2;          // G2/V4: max follow-ups per pitch
export const NUDGE_MIN_DAYS = 7;     // G2/V4: minimum spacing
export const DAILY_ACTION_BUDGET = 20; // G6: max outreach actions/day (down-only)

// ---- small helpers -----------------------------------------------------------
function reqStr(obj, field, what) {
  const v = obj[field];
  if (typeof v !== 'string' || v.trim() === '') throw new RuleError('SCHEMA', `${what}.${field} is required (non-empty string)`);
  return v;
}
function reqEnum(obj, field, allowed, what) {
  const v = obj[field];
  if (!allowed.includes(v)) throw new RuleError('SCHEMA', `${what}.${field} must be one of ${allowed.join('|')} (got ${JSON.stringify(v)})`);
  return v;
}
function isoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
export function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}

// ---- V6: track ---------------------------------------------------------------
export function validateTrack(t) {
  reqStr(t, 'id', 'track');
  reqStr(t, 'title', 'track');
  reqStr(t, 'artist', 'track');
  const url = reqStr(t, 'spotify_url', 'track');
  if (!TRACK_URL_RE.test(url)) {
    throw new RuleError('V6', `track.spotify_url must match ^https://open.spotify.com/track/<id> (got ${JSON.stringify(url)})`);
  }
  const id = spotifyTrackId(url);
  if (INVALID_TRACK_IDS.has(id)) {
    throw new RuleError('V6', `track.spotify_url uses the known-invalid Spotify ID ${id} — rejected by denylist`);
  }
  if (typeof t.explicit !== 'boolean') throw new RuleError('SCHEMA', 'track.explicit must be boolean');
  if (typeof t.fcc_safe !== 'boolean') throw new RuleError('SCHEMA', 'track.fcc_safe must be boolean');
  if (t.isrc !== undefined && t.isrc !== null && typeof t.isrc !== 'string') throw new RuleError('SCHEMA', 'track.isrc must be string|null');
  if (t.release_date !== undefined && t.release_date !== null && !isoDate(t.release_date)) {
    throw new RuleError('SCHEMA', 'track.release_date must be YYYY-MM-DD|null');
  }
  return true;
}

// ---- curator ------------------------------------------------------------------
export function validateCurator(c) {
  reqStr(c, 'id', 'curator');
  reqStr(c, 'name', 'curator');
  reqEnum(c, 'platform', PLATFORMS, 'curator');
  if (!c.submission_path || typeof c.submission_path !== 'object') {
    throw new RuleError('SCHEMA', 'curator.submission_path is required {type, value}');
  }
  reqEnum(c.submission_path, 'type', SUBMISSION_TYPES, 'curator.submission_path');
  if (typeof c.submission_path.value !== 'string' || c.submission_path.value.trim() === '') {
    throw new RuleError('SCHEMA', 'curator.submission_path.value is required (non-empty string)');
  }
  if (typeof c.account_needed !== 'boolean') throw new RuleError('SCHEMA', 'curator.account_needed must be boolean');
  if (typeof c.payola_flag !== 'boolean') throw new RuleError('SCHEMA', 'curator.payola_flag must be boolean');
  // V1: payola flag requires verbatim evidence.
  if (c.payola_flag && (typeof c.payola_evidence !== 'string' || c.payola_evidence.trim() === '')) {
    throw new RuleError('V1', 'curator.payola_flag=true requires payola_evidence (verbatim evidence string)');
  }
  if (!c.payola_flag && c.payola_evidence) {
    throw new RuleError('V1', 'curator.payola_evidence set without payola_flag=true — clear the evidence or set the flag');
  }
  if (typeof c.do_not_contact !== 'boolean') throw new RuleError('SCHEMA', 'curator.do_not_contact must be boolean');
  // V3: do-not-contact requires the reason.
  if (c.do_not_contact && (typeof c.dnc_reason !== 'string' || c.dnc_reason.trim() === '')) {
    throw new RuleError('V3', 'curator.do_not_contact=true requires dnc_reason');
  }
  if (c.handles !== undefined && !Array.isArray(c.handles)) throw new RuleError('SCHEMA', 'curator.handles must be string[]');
  if (c.playlist_urls !== undefined) {
    if (!Array.isArray(c.playlist_urls)) throw new RuleError('SCHEMA', 'curator.playlist_urls must be string[]');
    for (const u of c.playlist_urls) {
      if (!PLAYLIST_URL_RE.test(u)) throw new RuleError('SCHEMA', `curator.playlist_urls entry is not a Spotify playlist URL: ${JSON.stringify(u)}`);
    }
  }
  if (c.follower_count !== undefined && c.follower_count !== null) {
    if (!Number.isInteger(c.follower_count) || c.follower_count < 0) {
      throw new RuleError('SCHEMA', 'curator.follower_count must be int >= 0 or null (null = unknown, never 0-as-unknown)');
    }
    if (!isoDate(c.followers_observed_at)) {
      throw new RuleError('SCHEMA', 'curator.follower_count requires followers_observed_at (YYYY-MM-DD)');
    }
  }
  if (!c.stats || typeof c.stats !== 'object') throw new RuleError('SCHEMA', 'curator.stats {pitches, replies, placements_verified} is required');
  for (const k of ['pitches', 'replies', 'placements_verified']) {
    if (!Number.isInteger(c.stats[k]) || c.stats[k] < 0) throw new RuleError('SCHEMA', `curator.stats.${k} must be int >= 0`);
  }
  return true;
}

// Bot-vet hold (V-3): an uncleared "[BOT-VET FLAG ...]" marker in notes holds
// pitches at draft until a "[BOT-VET CLEARED ...]" marker supersedes it.
export function botVetHold(curator) {
  const notes = curator.notes || '';
  const flags = [...notes.matchAll(/\[BOT-VET FLAG ([^\]]+)\]/g)];
  if (flags.length === 0) return null;
  const clears = [...notes.matchAll(/\[BOT-VET CLEARED ([^\]]+)\]/g)];
  if (clears.length >= flags.length) return null;
  return flags[flags.length - 1][0];
}

// ---- pitch --------------------------------------------------------------------
export function validatePitchNew(store, { curator_id, track_ids, channel }, opts = {}) {
  reqStr({ curator_id }, 'curator_id', 'pitch');
  if (!Array.isArray(track_ids) || track_ids.length < 1) {
    throw new RuleError('SCHEMA', 'pitch.track_ids must be a non-empty array');
  }
  reqEnum({ channel }, 'channel', CHANNELS, 'pitch');

  const curator = store.find('curators', curator_id);
  if (!curator) throw new RuleError('V7', `pitch.curator_id ${JSON.stringify(curator_id)} does not resolve to a curator`);
  for (const tid of track_ids) {
    if (!store.find('tracks', tid)) throw new RuleError('V7', `pitch.track_ids entry ${JSON.stringify(tid)} does not resolve to a track`);
  }
  // V3: do-not-contact is absolute.
  if (curator.do_not_contact && !opts.historical) {
    throw new RuleError('V3', `curator ${curator_id} is do-not-contact (${curator.dnc_reason}) — pitch creation rejected`);
  }
  // V1: payola-flagged curators are unpitchable.
  if (curator.payola_flag && !opts.historical) {
    throw new RuleError('V1', `curator ${curator_id} is payola-flagged — pitch creation rejected`);
  }
  // G1: one initial pitch per (curator, track) pair (non-closed threads).
  const existing = store.records('pitches').filter(p =>
    p.curator_id === curator_id &&
    !TERMINAL_STATUSES.includes(p.status) &&
    p.track_ids.some(t => track_ids.includes(t))
  );
  if (existing.length > 0) {
    const dup = existing[0];
    const overlap = dup.track_ids.filter(t => track_ids.includes(t));
    throw new RuleError('G1', `duplicate pitch: curator ${curator_id} already has non-closed pitch ${dup.id} for track(s) ${overlap.join(', ')}`);
  }
  return true;
}

// G8: every touch logged with actor + timestamp; anonymous or backdated rejected.
export function validateMessage(msg, pitch, now = new Date()) {
  reqEnum(msg, 'direction', ['in', 'out'], 'message');
  reqStr(msg, 'text', 'message');
  // G8: no anonymous entries — every touch has an actor.
  if (!msg.actor || typeof msg.actor !== 'string' || !msg.actor.trim()) {
    throw new RuleError('G8', 'message.actor is required — anonymous entries rejected (G8)');
  }
  if (typeof msg.date !== 'string') throw new RuleError('G8', 'message.date is required (ISO datetime)');
  const d = new Date(msg.date);
  if (isNaN(d.getTime())) throw new RuleError('G8', `message.date ${JSON.stringify(msg.date)} is not a valid datetime`);
  if (d.getTime() > now.getTime() + 60000) {
    throw new RuleError('G8', `message.date ${msg.date} is in the future — backdated/future-dated entries rejected`);
  }
  if (pitch && pitch.created_at) {
    const created = new Date(pitch.created_at);
    if (!isNaN(created.getTime()) && d.getTime() < created.getTime() - 60000) {
      throw new RuleError('G8', `message.date ${msg.date} predates the pitch's creation — backdated entries rejected`);
    }
  }
  if (msg.direction === 'out' && msg.approval_ref !== undefined && msg.approval_ref !== null && typeof msg.approval_ref !== 'string') {
    throw new RuleError('SCHEMA', 'message.approval_ref must be string|null');
  }
  return true;
}

// V5: outbound message under Black's personal identity requires approval_ref;
// without it the pitch status cannot leave awaiting-approval.
export function validateSend(store, pitch, { personal, approval_ref, actor, evidence }, now = new Date()) {
  const curator = store.find('curators', pitch.curator_id);
  // V1: a payola curator's thread cannot reach sent — existing drafts are frozen.
  if (curator && curator.payola_flag) {
    throw new RuleError('V1', `curator ${pitch.curator_id} is payola-flagged — pitch ${pitch.id} is frozen, cannot reach sent`);
  }
  // V3: do-not-contact threads cannot be sent.
  if (curator && curator.do_not_contact) {
    throw new RuleError('V3', `curator ${pitch.curator_id} is do-not-contact — pitch ${pitch.id} cannot be sent`);
  }
  // V-3 bot-vet: flagged curators hold pitches at draft.
  if (curator) {
    const hold = botVetHold(curator);
    if (hold) throw new RuleError('V3-HOLD', `curator ${pitch.curator_id} has an uncleared bot-vet flag (${hold}) — pitch held at draft until a human clears it`);
  }
  if (TERMINAL_STATUSES.includes(pitch.status)) {
    throw new RuleError('V4', `pitch ${pitch.id} is ${pitch.status} — closed threads cannot be re-sent`);
  }
  if (personal && !approval_ref) {
    throw new RuleError('V5', `personal-identity send requires approval_ref (Black's exact-copy approval); pitch ${pitch.id} stays at awaiting-approval`);
  }
  if (typeof evidence !== 'string' || evidence.trim() === '') {
    throw new RuleError('G7', 'pitch sent records evidence of a send the human made — --evidence is required (the tool never performs the send)');
  }
  if (typeof actor !== 'string' || actor.trim() === '') {
    throw new RuleError('G8', 'pitch sent requires --actor (every touch logged with actor + timestamp)');
  }
  checkDailyBudget(store, now); // G6
  return true;
}

// V4/G2: nudge cap 2, ≥7 days spacing. G3: DNC blocks follow-up scheduling.
export function validateNudge(store, pitch, now = new Date()) {
  const curator = store.find('curators', pitch.curator_id);
  if (curator && curator.do_not_contact) {
    throw new RuleError('G3', `curator ${pitch.curator_id} is do-not-contact — follow-up scheduling rejected`);
  }
  if (curator && curator.payola_flag) {
    throw new RuleError('V1', `curator ${pitch.curator_id} is payola-flagged — thread frozen, no nudges`);
  }
  if (TERMINAL_STATUSES.includes(pitch.status)) {
    throw new RuleError('V4', `pitch ${pitch.id} is ${pitch.status} — nudges on closed threads rejected`);
  }
  if (pitch.nudges_used >= NUDGE_CAP) {
    throw new RuleError('V4', `pitch ${pitch.id} already used ${pitch.nudges_used}/${NUDGE_CAP} nudges — further follow-up rejected; close with retired_reason`);
  }
  // Spacing: since last nudge, or since the initial send for nudge #1.
  let since = null;
  if (pitch.last_nudge_at) {
    since = new Date(pitch.last_nudge_at);
  } else {
    const outs = (pitch.messages || []).filter(m => m.direction === 'out');
    if (outs.length > 0) since = new Date(outs.map(m => m.date).sort()[0]);
  }
  if (since && !isNaN(since.getTime())) {
    const gap = daysBetween(since, now);
    if (gap < NUDGE_MIN_DAYS) {
      throw new RuleError('V4', `pitch ${pitch.id}: only ${gap} day(s) since last touch — minimum ${NUDGE_MIN_DAYS} days between nudges`);
    }
  }
  checkDailyBudget(store, now); // G6
  return true;
}

// ---- placement (V2) -------------------------------------------------------------
export function validatePlacement(store, p) {
  reqStr(p, 'id', 'placement');
  // V7: FKs resolve.
  const pitch = store.find('pitches', p.pitch_id);
  if (!pitch) throw new RuleError('V7', `placement.pitch_id ${JSON.stringify(p.pitch_id)} does not resolve`);
  const curator = store.find('curators', p.curator_id);
  if (!curator) throw new RuleError('V7', `placement.curator_id ${JSON.stringify(p.curator_id)} does not resolve`);
  const track = store.find('tracks', p.track_id);
  if (!track) throw new RuleError('V7', `placement.track_id ${JSON.stringify(p.track_id)} does not resolve`);
  if (pitch.curator_id !== p.curator_id) {
    throw new RuleError('V7', `placement.curator_id ${p.curator_id} disagrees with pitch ${p.pitch_id}'s curator ${pitch.curator_id}`);
  }
  if (!pitch.track_ids.includes(p.track_id)) {
    throw new RuleError('V7', `placement.track_id ${p.track_id} is not among pitch ${p.pitch_id}'s tracks`);
  }
  // V2: evidence or it didn't happen.
  const url = p.playlist_url;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new RuleError('V2', 'placement requires a non-empty playlist_url — a claimed add with no link is UNVERIFIED, never a placement');
  }
  if (!PLAYLIST_URL_RE.test(url)) {
    throw new RuleError('V2', `placement.playlist_url must be a Spotify playlist URL (got ${JSON.stringify(url)})`);
  }
  reqEnum(p, 'verified_via', VERIFIED_VIA, 'placement');
  if (!Array.isArray(p.receipts) || p.receipts.length < 1) {
    throw new RuleError('V2', 'placement requires >= 1 receipt (evidence is a file, not a sentence)');
  }
  for (const r of p.receipts) {
    if (typeof r !== 'string' || r.trim() === '') throw new RuleError('V2', 'placement.receipts entries must be non-empty paths');
    if (!existsSync(r)) throw new RuleError('V2', `placement receipt not found on disk: ${r}`);
  }
  if (!Number.isInteger(p.position) || p.position < 1) throw new RuleError('SCHEMA', 'placement.position must be int >= 1');
  if (!Number.isInteger(p.total_tracks) || p.total_tracks < p.position) {
    throw new RuleError('SCHEMA', 'placement.total_tracks must be int >= position');
  }
  if (typeof p.live !== 'boolean') throw new RuleError('SCHEMA', 'placement.live must be boolean');
  return true;
}

// ---- verification-event ----------------------------------------------------------
export function validateVerificationEvent(e) {
  reqStr(e, 'id', 'verification-event');
  reqStr(e, 'playlist_url', 'verification-event');
  if (!PLAYLIST_URL_RE.test(e.playlist_url)) {
    throw new RuleError('SCHEMA', `verification-event.playlist_url must be a Spotify playlist URL (got ${JSON.stringify(e.playlist_url)})`);
  }
  reqStr(e, 'track_id', 'verification-event');
  if (typeof e.found !== 'boolean') throw new RuleError('SCHEMA', 'verification-event.found must be boolean');
  if (e.found && (!Number.isInteger(e.position) || e.position < 1)) {
    throw new RuleError('SCHEMA', 'verification-event.position must be int >= 1 when found=true');
  }
  if (!e.found && e.position !== null && e.position !== undefined) {
    throw new RuleError('SCHEMA', 'verification-event.position must be null when found=false');
  }
  if (!Number.isInteger(e.total_tracks) || e.total_tracks < 1) {
    throw new RuleError('SCHEMA', 'verification-event.total_tracks must be int >= 1');
  }
  reqEnum(e, 'method', VERIFY_METHODS, 'verification-event');
  reqStr(e, 'raw_log_path', 'verification-event');
  if (!existsSync(e.raw_log_path)) {
    throw new RuleError('V2', `verification-event raw_log_path not found on disk: ${e.raw_log_path}`);
  }
  return true;
}

// ---- follow-up --------------------------------------------------------------------
export function validateFollowup(store, f) {
  reqStr(f, 'id', 'follow-up');
  if (!store.find('pitches', f.pitch_id)) throw new RuleError('V7', `follow-up.pitch_id ${JSON.stringify(f.pitch_id)} does not resolve`);
  if (!isoDate(f.due_date)) throw new RuleError('SCHEMA', 'follow-up.due_date must be YYYY-MM-DD');
  reqStr(f, 'action', 'follow-up');
  if (typeof f.done !== 'boolean') throw new RuleError('SCHEMA', 'follow-up.done must be boolean');
  return true;
}

// ---- G6: daily action budget --------------------------------------------------------
// Counts outbound touches (messages with direction=out) dated on the given day,
// across all pitches. Configurable DOWN only (governor rule).
let dailyBudgetOverride = null;
export function setDailyBudget(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('daily budget must be int >= 1');
  if (dailyBudgetOverride !== null && n > dailyBudgetOverride) {
    throw new Error('G6: daily budget is configurable DOWN only — raising it needs a design change');
  }
  if (n > DAILY_ACTION_BUDGET) throw new Error('G6: daily budget is configurable DOWN only — raising it needs a design change');
  dailyBudgetOverride = n;
}
export function dailyBudget() {
  return dailyBudgetOverride === null ? DAILY_ACTION_BUDGET : dailyBudgetOverride;
}
export function countActionsOn(store, yyyyMmDd) {
  let n = 0;
  for (const p of store.records('pitches')) {
    for (const m of (p.messages || [])) {
      if (m.direction === 'out' && typeof m.date === 'string' && m.date.slice(0, 10) === yyyyMmDd) n++;
    }
  }
  return n;
}
export function checkDailyBudget(store, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const used = countActionsOn(store, day);
  if (used >= dailyBudget()) {
    throw new RuleError('G6', `daily action budget exhausted: ${used}/${dailyBudget()} outreach actions on ${day} — the operator does tomorrow's work tomorrow`);
  }
  return { used, budget: dailyBudget(), day };
}

// ---- curator stats (maintained by the tool, never hand-edited) -----------------------
export function bumpStat(curator, key) {
  curator.stats[key] = (curator.stats[key] || 0) + 1;
  curator.updated_at = new Date().toISOString();
}

// Entry-point guard: importing this module never runs anything.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1]) {
  try {
    if (realpathSync(process.argv[1]) === realpathSync(__filename)) {
      console.error('rules.js is a module — use setlist.js, seed.js, or rescan.js.');
      process.exit(2);
    }
  } catch { /* ignore */ }
}
