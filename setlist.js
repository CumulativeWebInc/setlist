#!/usr/bin/env node
// Setlist — setlist.js
// The operator's CLI. The tool TRACKS and REMINDS; it NEVER sends anything
// (ANTI-SPAM-GOVERNOR.md G7). Every mutation validates V1–V7 / G1–G8 via rules.js
// and rejects with an error naming the rule.
//
//   curator   add|list|flag
//   track     add|list
//   pitch     new|status|note|sent|nudge|close
//   placement record
//   verify    <playlist_url> <track_id> [--file PATH | --paste] [--placement ID]
//   rescan    [--snapshots DIR]
//   queue     [--date YYYY-MM-DD]
//   report
//
// Global flags: --dir <store-root>  --json
// Exit codes: 0 ok · 1 rule/data rejection · 2 usage/internal error.

import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, genId, utcNow, todayStr } from './store.js';
import {
  RuleError, validateTrack, validateCurator, validatePitchNew, validateMessage,
  validateSend, validateNudge, validatePlacement, validateFollowup,
  countActionsOn, dailyBudget, bumpStat, botVetHold,
  PLATFORMS, CHANNELS, PITCH_STATUSES, TERMINAL_STATUSES, VERIFIED_VIA,
  NUDGE_CAP, NUDGE_MIN_DAYS,
} from './rules.js';
import { verifyPlacement, readSnapshotFromStdin, availableMethods } from './verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

// ---- arg parsing ---------------------------------------------------------------
function parseArgs(argv) {
  const positionals = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opts };
}

function need(opts, key, what) {
  if (opts[key] === undefined || opts[key] === true || String(opts[key]).trim() === '') {
    usageError(`missing required --${key} (${what})`);
  }
  return String(opts[key]);
}

function usageError(msg) {
  throw new UsageError(msg);
}
class UsageError extends Error {
  constructor(msg) { super(msg); this.name = 'UsageError'; }
}

function splitList(s) {
  return String(s).split(',').map(x => x.trim()).filter(Boolean);
}
function yesNo(s, what) {
  const v = String(s).toLowerCase();
  if (v === 'yes' || v === 'true' || v === '1') return true;
  if (v === 'no' || v === 'false' || v === '0') return false;
  usageError(`--${what} must be yes|no (got ${JSON.stringify(s)})`);
}

// ---- output ----------------------------------------------------------------------
let JSON_OUT = false;
function out(obj, human) {
  if (JSON_OUT) {
    console.log(JSON.stringify(obj, null, 2));
  } else {
    console.log(human);
  }
}
function kv(rows) {
  const w = Math.max(...rows.map(r => r[0].length));
  return rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n');
}

// ---- store -------------------------------------------------------------------------
function openStore(opts) {
  const root = opts.dir ? String(opts.dir) : HERE;
  return new Store(root);
}

function newCuratorSkeleton(over) {
  const now = utcNow();
  return {
    id: over.id, name: over.name, handles: over.handles || [],
    platform: over.platform, playlist_urls: over.playlist_urls || [],
    genres: over.genres || [], follower_count: over.follower_count ?? null,
    followers_observed_at: over.followers_observed_at || null,
    submission_path: over.submission_path, account_needed: !!over.account_needed,
    payola_flag: !!over.payola_flag, payola_evidence: over.payola_evidence || null,
    do_not_contact: !!over.do_not_contact, dnc_reason: over.dnc_reason || null,
    stats: { pitches: 0, replies: 0, placements_verified: 0 },
    notes: over.notes || null, created_at: now, updated_at: now,
  };
}

// ---- curator --------------------------------------------------------------------------
function cmdCurator(store, sub, opts) {
  if (sub === 'add') {
    const id = need(opts, 'id', 'slug e.g. flow-no-label-needed');
    const c = newCuratorSkeleton({
      id,
      name: need(opts, 'name', 'person or brand name'),
      platform: need(opts, 'platform', `one of ${PLATFORMS.join('|')}`),
      handles: opts.handles ? splitList(opts.handles) : [],
      playlist_urls: opts['playlist-urls'] ? splitList(opts['playlist-urls']) : [],
      genres: opts.genres ? splitList(opts.genres).map(g => g.toLowerCase()) : [],
      follower_count: opts.followers !== undefined ? parseInt(opts.followers, 10) : null,
      followers_observed_at: opts.followers !== undefined ? (opts['followers-at'] || todayStr()) : null,
      submission_path: {
        type: opts['submission-type'] || 'unknown',
        value: opts['submission-value'] || '(not yet known)',
      },
      account_needed: !!opts['account-needed'],
      payola_flag: !!opts.payola,
      payola_evidence: opts['payola-evidence'] || null,
      do_not_contact: !!opts.dnc,
      dnc_reason: opts['dnc-reason'] || null,
      notes: opts.notes || null,
    });
    validateCurator(c);
    store.insert('curators', c);
    out({ ok: true, id }, `curator added: ${id} (${c.name})`);
  } else if (sub === 'list') {
    let recs = store.records('curators');
    if (opts.platform) recs = recs.filter(c => c.platform === opts.platform);
    out({ curators: recs }, recs.length === 0
      ? '(no curators yet)'
      : recs.map(c =>
        `${c.id}  [${c.platform}]${c.payola_flag ? '  PAYOLA-FLAGGED' : ''}${c.do_not_contact ? '  DO-NOT-CONTACT' : ''}\n` +
        `    name: ${c.name}${c.handles.length ? '  handles: ' + c.handles.join(' ') : ''}\n` +
        `    via: ${c.submission_path.type} :: ${c.submission_path.value}\n` +
        `    stats: ${c.stats.pitches} pitches / ${c.stats.replies} replies / ${c.stats.placements_verified} placements`
      ).join('\n'));
  } else if (sub === 'flag') {
    // V-3 bot-vet: flag for human review, never an accusation.
    const id = need(opts, 'id', 'curator id');
    const c = store.find('curators', id);
    if (!c) throw new RuleError('V7', `curator ${JSON.stringify(id)} not found`);
    const stamp = utcNow();
    const marker = opts.clear
      ? `[BOT-VET CLEARED ${stamp}] ${need(opts, 'note', 'clearance note')}`
      : `[BOT-VET FLAG ${stamp}] ${need(opts, 'note', 'flag signal description')}`;
    const notes = (c.notes ? c.notes + '\n' : '') + marker;
    store.update('curators', id, { notes, updated_at: stamp });
    const hold = botVetHold(store.find('curators', id));
    out({ ok: true, id, hold: !!hold },
      opts.clear ? `bot-vet flag cleared on ${id}` : `bot-vet flag recorded on ${id} — pitches held at draft until cleared`);
  } else {
    usageError('curator: add|list|flag');
  }
}

// ---- track ----------------------------------------------------------------------------
function cmdTrack(store, sub, opts) {
  if (sub === 'add') {
    const t = {
      id: need(opts, 'id', 'slug e.g. zooted-zone'),
      title: need(opts, 'title', 'track title'),
      artist: opts.artist || 'That Boy Hi Hat',
      spotify_url: need(opts, 'spotify-url', 'verified Spotify track URL'),
      isrc: opts.isrc || null,
      explicit: yesNo(need(opts, 'explicit', 'yes|no'), 'explicit'),
      fcc_safe: yesNo(need(opts, 'fcc-safe', 'yes|no — never imply a clean version exists'), 'fcc-safe'),
      release_date: opts['release-date'] || null,
    };
    validateTrack(t); // V6
    store.insert('tracks', t);
    out({ ok: true, id: t.id }, `track added: ${t.id} (${t.title})`);
  } else if (sub === 'list') {
    const recs = store.records('tracks');
    out({ tracks: recs }, recs.length === 0
      ? '(no tracks yet)'
      : recs.map(t => `${t.id}  "${t.title}"  ${t.spotify_url}${t.explicit ? '  [explicit]' : ''}`).join('\n'));
  } else {
    usageError('track: add|list');
  }
}

// ---- pitch ------------------------------------------------------------------------------
function newPitchSkeleton(store, { curator_id, track_ids, channel, createdAt }) {
  const recs = store.records('pitches');
  const created = createdAt || utcNow();
  return {
    id: genId(recs, 'pch', new Date(created)),
    curator_id, track_ids, channel,
    status: 'draft',
    messages: [],
    next_action_date: null,
    next_action: null,
    nudges_used: 0,
    last_nudge_at: null,
    retired_reason: null,
    created_at: created,
    closed_at: null,
  };
}

function appendMessage(store, pitch, msg, now = new Date()) {
  validateMessage(msg, pitch, now); // G8
  const hadInbound = (pitch.messages || []).some(m => m.direction === 'in');
  const messages = [...(pitch.messages || []), msg];
  const patch = { messages };
  // First inbound reply counts toward curator reply stats (maintained by the tool).
  if (msg.direction === 'in' && !hadInbound) {
    const c = store.find('curators', pitch.curator_id);
    if (c) { bumpStat(c, 'replies'); store.update('curators', c.id, { stats: c.stats, updated_at: c.updated_at }); }
  }
  store.update('pitches', pitch.id, patch);
  return store.find('pitches', pitch.id);
}

function cmdPitch(store, sub, opts, now = new Date()) {
  if (sub === 'new') {
    const curator_id = need(opts, 'curator', 'curator id');
    const track_ids = splitList(need(opts, 'tracks', 'comma-separated track ids'));
    const channel = need(opts, 'channel', `one of ${CHANNELS.join('|')}`);
    validatePitchNew(store, { curator_id, track_ids, channel }); // V1 V3 V7 G1
    const pitch = newPitchSkeleton(store, { curator_id, track_ids, channel });
    if (opts.message) {
      const msg = {
        date: now.toISOString(), direction: 'out',
        text: String(opts.message), actor: need(opts, 'actor', 'who sent it (G8)'),
        approval_ref: opts['approval-ref'] || null,
      };
      validateMessage(msg, pitch, now);
      pitch.messages.push(msg);
    }
    store.insert('pitches', pitch);
    const c = store.find('curators', curator_id);
    bumpStat(c, 'pitches');
    store.update('curators', c.id, { stats: c.stats, updated_at: c.updated_at });
    out({ ok: true, id: pitch.id }, `pitch created: ${pitch.id} (draft) — curator ${curator_id}, tracks ${track_ids.join(', ')}`);
  } else if (sub === 'status') {
    const pitch = getPitch(store, need(opts, 'id', 'pitch id'));
    const to = need(opts, 'to', `one of ${PITCH_STATUSES.join('|')}`);
    if (!PITCH_STATUSES.includes(to)) usageError(`--to must be one of ${PITCH_STATUSES.join('|')}`);
    if (TERMINAL_STATUSES.includes(pitch.status) && to !== pitch.status) {
      throw new RuleError('V4', `pitch ${pitch.id} is ${pitch.status} (terminal) — closed threads stay closed`);
    }
    if (to === 'sent') {
      throw new RuleError('G7', 'use `pitch sent` to record a send — it requires --evidence (the tool records sends the human made, never performs them)');
    }
    if (to === 'placed') {
      const pls = store.records('placements').filter(p => p.pitch_id === pitch.id);
      if (pls.length === 0) {
        throw new RuleError('V2', `pitch ${pitch.id} cannot move to placed: no placement record with evidence (status placed without evidence is rejected)`);
      }
    }
    if (pitch.status === 'awaiting-approval' && to !== 'awaiting-approval' && to !== 'draft') {
      const approved = (pitch.messages || []).some(m => m.direction === 'out' && m.approval_ref);
      if (!approved) {
        throw new RuleError('V5', `pitch ${pitch.id} cannot leave awaiting-approval without an approval_ref on an outbound message (Black's exact-copy approval)`);
      }
    }
    const patch = { status: to };
    if (opts['next-action-date']) patch.next_action_date = opts['next-action-date'];
    if (opts['next-action']) patch.next_action = String(opts['next-action']);
    if (to === 'closed') {
      patch.retired_reason = need(opts, 'reason', 'why this thread is closing');
      patch.closed_at = now.toISOString();
    }
    store.update('pitches', pitch.id, patch);
    out({ ok: true, id: pitch.id, status: to }, `pitch ${pitch.id}: ${pitch.status} -> ${to}`);
  } else if (sub === 'close') {
    const pitch = getPitch(store, need(opts, 'id', 'pitch id'));
    if (TERMINAL_STATUSES.includes(pitch.status)) throw new RuleError('V4', `pitch ${pitch.id} is already ${pitch.status}`);
    const reason = need(opts, 'reason', 'retired_reason — the honest close-out');
    store.update('pitches', pitch.id, { status: 'closed', retired_reason: reason, closed_at: now.toISOString() });
    out({ ok: true, id: pitch.id }, `pitch ${pitch.id} closed — "${reason}"`);
  } else if (sub === 'note') {
    const pitch = getPitch(store, need(opts, 'id', 'pitch id'));
    if (TERMINAL_STATUSES.includes(pitch.status)) throw new RuleError('V4', `pitch ${pitch.id} is ${pitch.status} — log to a new thread instead`);
    const direction = need(opts, 'direction', 'in|out');
    if (!['in', 'out'].includes(direction)) usageError('--direction must be in|out');
    const msg = {
      date: opts.date || now.toISOString(),
      direction,
      text: need(opts, 'text', 'exact text (G8)'),
      actor: need(opts, 'actor', 'who (G8 — anonymous entries rejected)'),
      approval_ref: opts['approval-ref'] || null,
    };
    if (direction === 'out') {
      // G7: an outbound note is a send record — it needs send evidence, same as `pitch sent`.
      // (Without this, `note --direction out` would bypass the evidence requirement.)
      checkBudgetOrThrow(store, now);
      if (!opts.evidence) {
        throw new RuleError('G7', 'pitch note --direction out requires --evidence — an outbound note is a send record; attach proof the human sent it (or use `pitch sent`)');
      }
      msg.evidence = String(opts.evidence);
    }
    const updated = appendMessage(store, pitch, msg, now);
    out({ ok: true, id: pitch.id, messages: updated.messages.length }, `note logged on ${pitch.id} (${direction}, ${msg.actor})`);
  } else if (sub === 'sent') {
    // G7: records EVIDENCE of a send the human made. Never performs the send.
    const pitch = getPitch(store, need(opts, 'id', 'pitch id'));
    const personal = !!opts.personal;
    const approval_ref = opts['approval-ref'] || null;
    const evidence = need(opts, 'evidence', 'proof the human sent it, e.g. "IG DM 2026-09-20 10:05, screenshot receipts/x.png"');
    const actor = need(opts, 'actor', 'who sent it (G8)');
    try {
      validateSend(store, pitch, { personal, approval_ref, actor, evidence }, now); // V1 V3 V5 G6 G7 G8
    } catch (e) {
      if (e instanceof RuleError && e.rule === 'V5') {
        // V5: status cannot leave awaiting-approval — park it there.
        if (pitch.status === 'draft') store.update('pitches', pitch.id, { status: 'awaiting-approval' });
      }
      throw e;
    }
    const msg = { date: now.toISOString(), direction: 'out', text: String(opts.text || evidence), actor, approval_ref };
    validateMessage(msg, pitch, now);
    store.update('pitches', pitch.id, { messages: [...pitch.messages, msg], status: 'sent' });
    out({ ok: true, id: pitch.id }, `send recorded on ${pitch.id} (${actor}) — evidence logged, nothing auto-sent (G7)`);
  } else if (sub === 'nudge') {
    const pitch = getPitch(store, need(opts, 'id', 'pitch id'));
    const evidence = need(opts, 'evidence', 'proof the human sent the nudge');
    const actor = need(opts, 'actor', 'who sent it (G8)');
    const text = need(opts, 'text', 'exact nudge text (G8)');
    const personal = !!opts.personal;
    const approval_ref = opts['approval-ref'] || null;
    // V5: a nudge under Black's personal identity needs his exact-copy approval.
    if (personal && !approval_ref) {
      throw new RuleError('V5', `pitch ${pitch.id}: personal-identity nudge requires --approval-ref (Black's exact-copy approval of the exact text)`);
    }
    validateNudge(store, pitch, now); // V4/G2 G3 G6 (+V1 frozen)
    const msg = { date: now.toISOString(), direction: 'out', text, actor, approval_ref };
    const nudges_used = pitch.nudges_used + 1;
    const patch = {
      messages: [...pitch.messages, msg],
      nudges_used,
      last_nudge_at: now.toISOString().slice(0, 10),
    };
    let closedNote = '';
    if (nudges_used >= NUDGE_CAP) {
      const hasInbound = (pitch.messages || []).some(m => m.direction === 'in');
      if (!hasInbound) {
        patch.status = 'closed';
        patch.retired_reason = 'no reply after 2 touches';
        patch.closed_at = now.toISOString();
        closedNote = ' — 2/2 nudges used: pitch closed ("no reply after 2 touches")';
      } else {
        closedNote = ' — 2/2 nudges used: close the pitch with `pitch close` (replies exist, operator decides)';
      }
    }
    store.update('pitches', pitch.id, patch);
    // The nudge itself is a completed follow-up record.
    const fups = store.records('followups');
    const fup = {
      id: genId(fups, 'fup', now), pitch_id: pitch.id,
      due_date: now.toISOString().slice(0, 10),
      action: `nudge ${nudges_used}/${NUDGE_CAP} sent`,
      done: true, done_at: now.toISOString(),
      result: evidence,
    };
    validateFollowup(store, fup);
    store.insert('followups', fup);
    out({ ok: true, id: pitch.id, nudges_used }, `nudge ${nudges_used}/${NUDGE_CAP} recorded on ${pitch.id}${closedNote}`);
  } else {
    usageError('pitch: new|status|note|sent|nudge|close');
  }
}

function getPitch(store, id) {
  const p = store.find('pitches', id);
  if (!p) throw new RuleError('V7', `pitch ${JSON.stringify(id)} not found`);
  return p;
}

function checkBudgetOrThrow(store, now) {
  const day = now.toISOString().slice(0, 10);
  const used = countActionsOn(store, day);
  if (used >= dailyBudget()) {
    throw new RuleError('G6', `daily action budget exhausted: ${used}/${dailyBudget()} outreach actions on ${day} — the operator does tomorrow's work tomorrow`);
  }
}

// ---- placement ----------------------------------------------------------------------------
function cmdPlacement(store, sub, opts, now = new Date()) {
  if (sub !== 'record') usageError('placement: record');
  const recs = store.records('placements');
  const p = {
    id: genId(recs, 'plc', now),
    pitch_id: need(opts, 'pitch', 'pitch id'),
    curator_id: need(opts, 'curator', 'curator id'),
    track_id: need(opts, 'track', 'track id'),
    playlist_url: need(opts, 'playlist-url', 'curator-provided playlist URL'),
    position: parseInt(need(opts, 'position', '1-based position'), 10),
    total_tracks: parseInt(need(opts, 'total', 'playlist length at verification time'), 10),
    verified_via: need(opts, 'via', `one of ${VERIFIED_VIA.join('|')}`),
    observed_at: opts['observed-at'] || now.toISOString(),
    live: true,
    receipts: opts.receipt ? splitList(opts.receipt) : [],
  };
  validatePlacement(store, p); // V2 + V7
  store.insert('placements', p);
  // Promote the pitch (unless honestly closed already).
  const pitch = store.find('pitches', p.pitch_id);
  if (!TERMINAL_STATUSES.includes(pitch.status)) {
    store.update('pitches', pitch.id, { status: 'placed' });
  }
  const c = store.find('curators', p.curator_id);
  bumpStat(c, 'placements_verified');
  store.update('curators', c.id, { stats: c.stats, updated_at: c.updated_at });
  out({ ok: true, id: p.id }, `placement recorded: ${p.id} — ${p.track_id} at #${p.position}/${p.total_tracks} (${p.verified_via})`);
}

// ---- verify -------------------------------------------------------------------------------
async function cmdVerify(store, positionals, opts, now = new Date()) {
  const playlistUrl = positionals[0];
  const trackId = positionals[1];
  if (!playlistUrl || !trackId) usageError('verify <playlist_url> <track_id> [--file PATH | --paste] [--placement ID] [--method manual]');
  const method = opts.method || 'manual';
  if (!availableMethods().includes(method)) usageError(`--method must be one of ${availableMethods().join('|')}`);
  let snapshot = null;
  if (opts.file) {
    const raw = readFileSync(String(opts.file), 'utf8');
    snapshot = JSON.parse(raw);
    if (!Array.isArray(snapshot)) usageError('--file must contain a JSON array of Spotify track IDs');
  } else {
    if (opts.paste || !process.stdin.isTTY) {
      if (!opts.paste) console.error('(reading snapshot: paste one Spotify track ID per line, blank line or Ctrl-D to finish)');
      snapshot = await readSnapshotFromStdin();
    } else {
      usageError('manual method needs a snapshot: --file PATH or --paste (stdin)');
    }
  }
  const res = await verifyPlacement(store, {
    playlistUrl, trackId, method, snapshot,
    placementId: opts.placement || null,
    observedAt: opts['observed-at'] || null,
    note: opts.note || null,
  });
  out(
    { ok: true, ...res },
    res.found
      ? `VERIFIED: ${trackId} found at #${res.position}/${res.total_tracks}\n  event: ${res.verification_id}\n  receipt: ${res.raw_log_path}`
      : `NOT FOUND: ${trackId} absent from ${res.total_tracks} tracks — UNVERIFIED, never counted\n  event: ${res.verification_id}\n  receipt: ${res.raw_log_path}`
  );
}

// ---- rescan -------------------------------------------------------------------------------
async function cmdRescan(store, opts) {
  const { runRescan } = await import('./rescan.js');
  const result = await runRescan(store, { snapshotsDir: opts.snapshots || null });
  out(result, formatRescan(result));
}
function formatRescan(r) {
  const lines = [`rescan: ${r.checked} placement(s) checked, ${r.still_live} live, ${r.dropped} dropped, ${r.due_manual} awaiting manual snapshot`];
  for (const d of r.dropped_list) lines.push(`  DROPPED: ${d.placement_id} (${d.track_id}) from ${d.playlist_url} — follow-up ${d.followup_id} opened`);
  for (const m of r.due_manual_list) lines.push(`  DUE: ${m.placement_id} — ${m.playlist_url} (no snapshot supplied)`);
  return lines.join('\n');
}

// ---- queue ----------------------------------------------------------------------------------
function cmdQueue(store, opts, now = new Date()) {
  const asOf = opts.date || todayStr(now);
  const due = [];
  for (const f of store.records('followups')) {
    if (!f.done && f.due_date <= asOf) due.push({ kind: 'follow-up', id: f.id, pitch_id: f.pitch_id, due_date: f.due_date, action: f.action });
  }
  for (const p of store.records('pitches')) {
    if (!TERMINAL_STATUSES.includes(p.status) && p.next_action_date && p.next_action_date <= asOf) {
      due.push({ kind: 'pitch-next-action', id: p.id, pitch_id: p.id, due_date: p.next_action_date, action: p.next_action || '(no action noted)' });
    }
  }
  due.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
  const budget = dailyBudget();
  const listed = due.slice(0, budget);
  const capped = due.length > budget;
  out(
    { as_of: asOf, total_due: due.length, listed: listed.length, capped_by_g6: capped, items: listed },
    (listed.length === 0 ? `(queue empty for ${asOf} — nothing due)` :
      `queue for ${asOf} (${listed.length} shown${capped ? `, G6 cap ${budget}/day — rest waits for tomorrow` : ''}):\n` +
      listed.map(i => `  [${i.due_date}] ${i.kind} ${i.id} (pitch ${i.pitch_id}): ${i.action}`).join('\n'))
  );
}

// ---- report -----------------------------------------------------------------------------------
function cmdReport(store, opts, now = new Date()) {
  const pitches = store.records('pitches');
  const placements = store.records('placements');
  const curators = store.records('curators');
  const followups = store.records('followups');

  const byStatus = {};
  for (const s of PITCH_STATUSES) byStatus[s] = 0;
  for (const p of pitches) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

  const live = placements.filter(p => p.live);
  const dropped = placements.filter(p => !p.live);

  const curatorStats = curators
    .filter(c => c.stats.pitches > 0)
    .map(c => ({
      id: c.id, name: c.name, pitches: c.stats.pitches, replies: c.stats.replies,
      placements_verified: c.stats.placements_verified,
      reply_rate: c.stats.pitches ? +(c.stats.replies / c.stats.pitches).toFixed(2) : 0,
      payola_flag: c.payola_flag, do_not_contact: c.do_not_contact,
    }))
    .sort((a, b) => b.placements_verified - a.placements_verified || b.reply_rate - a.reply_rate);

  const pending = followups.filter(f => !f.done);
  const overdue = pending.filter(f => f.due_date < todayStr(now));

  const day = todayStr(now);
  const actions = { used: countActionsOn(store, day), budget: dailyBudget(), day };

  const report = {
    generated_at: now.toISOString(),
    pitches_by_status: byStatus,
    pitches_total: pitches.length,
    placements: {
      live: live.length, dropped: dropped.length,
      live_list: live.map(p => ({ id: p.id, track_id: p.track_id, position: p.position, total_tracks: p.total_tracks, playlist_url: p.playlist_url, verified_via: p.verified_via, observed_at: p.observed_at })),
      dropped_list: dropped.map(p => ({ id: p.id, track_id: p.track_id, playlist_url: p.playlist_url })),
    },
    curator_reply_stats: curatorStats,
    followups: { pending: pending.length, overdue: overdue.length },
    daily_actions: actions,
  };
  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }
  const L = [];
  L.push(`Setlist report — ${report.generated_at}`);
  L.push(`pitches: ${report.pitches_total}  ` + PITCH_STATUSES.map(s => `${s}=${byStatus[s]}`).join(' '));
  L.push(`placements: ${live.length} live, ${dropped.length} dropped`);
  for (const p of report.placements.live_list) L.push(`  LIVE  ${p.track_id} #${p.position}/${p.total_tracks} (${p.verified_via}) ${p.playlist_url}`);
  for (const p of report.placements.dropped_list) L.push(`  DROPPED ${p.track_id} ${p.playlist_url}`);
  L.push(`curators with pitches: ${curatorStats.length}`);
  for (const c of curatorStats) L.push(`  ${c.id}: ${c.pitches} pitches, ${c.replies} replies (rate ${c.reply_rate}), ${c.placements_verified} placements${c.payola_flag ? ' [PAYOLA]' : ''}${c.do_not_contact ? ' [DNC]' : ''}`);
  L.push(`follow-ups: ${pending.length} pending, ${overdue.length} overdue`);
  L.push(`daily actions: ${actions.used}/${actions.budget} on ${actions.day}`);
  console.log(L.join('\n'));
}

// ---- main --------------------------------------------------------------------------------------
function printHelp() {
  console.log(`Setlist v${VERSION} — playlist-pitching CRM + scan-verified placement tracker.
The tool tracks and reminds. It NEVER sends (G7).

  curator add --id --name --platform (${PLATFORMS.join('|')}) [--handles a,b] [--genres a,b]
            [--playlist-urls u,v] [--followers N] [--submission-type T] [--submission-value V]
            [--account-needed] [--payola --payola-evidence "..."] [--dnc --dnc-reason "..."] [--notes "..."]
  curator list [--platform P]
  curator flag --id ID --note "..." | --clear --note "..."     (V-3 bot-vet flag)
  track add --id --title --spotify-url --explicit yes|no --fcc-safe yes|no [--artist] [--isrc] [--release-date]
  track list
  pitch new --curator ID --tracks a,b --channel (${CHANNELS.join('|')}) [--actor A --message "..."]
  pitch status --id ID --to STATUS [--reason "..." (for closed)]
  pitch note --id ID --direction in|out --text "..." --actor A [--date ISO] [--evidence "..." (required for out, G7)]
  pitch sent --id ID --evidence "..." --actor A [--text "..."] [--personal --approval-ref R]
  pitch nudge --id ID --evidence "..." --actor A --text "..." [--personal --approval-ref R]
  pitch close --id ID --reason "..."
  placement record --pitch P --curator C --track T --playlist-url U --position N --total M
                   --via link|scan|both --receipt PATH [--receipt PATH2] [--observed-at ISO]
  verify <playlist_url> <track_id> [--file PATH | --paste] [--placement ID] [--note "..."]
  rescan [--snapshots DIR]
  queue [--date YYYY-MM-DD]
  report

Global: --dir <store-root>  --json
Rules enforced in the data layer: V1–V7, G1–G8. Every rejection names its rule.`);
}

async function main() {
  const { positionals, opts } = parseArgs(process.argv.slice(2));
  JSON_OUT = !!opts.json;
  if (positionals.length === 0 || positionals[0] === 'help' || opts.help) { printHelp(); return; }
  const store = openStore(opts);
  const [entity, sub, ...rest] = positionals;
  const now = new Date();
  try {
    if (entity === 'curator') cmdCurator(store, sub, opts);
    else if (entity === 'track') cmdTrack(store, sub, opts);
    else if (entity === 'pitch') cmdPitch(store, sub, opts, now);
    else if (entity === 'placement') cmdPlacement(store, sub, opts, now);
    else if (entity === 'verify') await cmdVerify(store, [sub, ...rest], opts, now);
    else if (entity === 'rescan') await cmdRescan(store, opts);
    else if (entity === 'queue') cmdQueue(store, opts, now);
    else if (entity === 'report') cmdReport(store, opts, now);
    else usageError(`unknown command: ${entity}`);
  } catch (e) {
    if (e instanceof UsageError) { console.error(`usage: ${e.message}`); printHelp(); process.exit(2); }
    if (e instanceof RuleError) { console.error(`rejected: ${e.message}`); process.exit(1); }
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}

// Entry-point import guard (AGENTS.md): importing setlist.js never runs main().
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  main().catch(e => { console.error(`fatal: ${e.message}`); process.exit(2); });
}
