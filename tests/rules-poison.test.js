// Setlist tests — rules-poison.test.js
// POISON TESTS: every validation rule must reject its violation with an error
// NAMING the rule. A rule that fails open is a ship-blocking defect.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RuleError, validateTrack, validateCurator, validatePitchNew, validateMessage,
  validateSend, validateNudge, validatePlacement, validateFollowup,
  checkDailyBudget, countActionsOn, botVetHold,
} from '../rules.js';
import { makeStore, addTrack, addCurator, addPitch, seedPair, msgOut, msgIn } from './helpers.js';

function rejectsWith(fn, rule) {
  assert.throws(fn, (e) => e instanceof RuleError && e.rule.includes(rule),
    `expected rejection naming rule ${rule}`);
}

// ---- V6: track URL ---------------------------------------------------------------
describe('V6 track URL', () => {
  it('rejects a non-Spotify URL', () => {
    rejectsWith(() => validateTrack({
      id: 'x', title: 'X', artist: 'Y', spotify_url: 'https://example.com/track/abc',
      explicit: true, fcc_safe: false,
    }), 'V6');
  });
  it('rejects the known-invalid denylisted ID', () => {
    rejectsWith(() => validateTrack({
      id: 'x', title: 'X', artist: 'Y',
      spotify_url: 'https://open.spotify.com/track/1sY0hpRVAYMVgTEeDxZgFA',
      explicit: true, fcc_safe: false,
    }), 'V6');
  });
  it('accepts a valid verified URL', () => {
    const s = makeStore();
    addTrack(s); // throws if invalid
  });
});

// ---- V1: payola --------------------------------------------------------------------
describe('V1 payola', () => {
  it('rejects pitch creation for a payola-flagged curator', () => {
    const s = makeStore();
    seedPair(s, { id: 'payola-c', payola_flag: true, payola_evidence: 'sells $25 playlist adds' });
    rejectsWith(() => validatePitchNew(s, { curator_id: 'payola-c', track_ids: ['zooted-zone'], channel: 'email' }), 'V1');
  });
  it('freezes existing drafts: payola curator thread cannot reach sent', () => {
    const s = makeStore();
    seedPair(s, { id: 'payola-c' });
    const p = addPitch(s, { curator_id: 'payola-c', created_at: '2026-09-14T12:00:00Z' });
    s.update('curators', 'payola-c', { payola_flag: true, payola_evidence: 'sells $25 playlist adds' });
    const frozen = s.find('pitches', p.id);
    rejectsWith(() => validateSend(s, frozen,
      { personal: false, approval_ref: null, actor: 'CWI', evidence: 'sent it' },
      new Date('2026-09-20T12:00:00Z')), 'V1');
  });
  it('requires verbatim evidence when the flag is set', () => {
    rejectsWith(() => validateCurator({
      id: 'c', name: 'C', platform: 'blog',
      submission_path: { type: 'email', value: 'a@b.c' },
      account_needed: false, payola_flag: true, payola_evidence: null,
      do_not_contact: false, dnc_reason: null,
      stats: { pitches: 0, replies: 0, placements_verified: 0 },
      created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
    }), 'V1');
  });
});

// ---- V3/G3: do-not-contact --------------------------------------------------------------
describe('V3/G3 do-not-contact', () => {
  it('rejects pitch creation for a DNC curator, surfacing the reason', () => {
    const s = makeStore();
    seedPair(s, { id: 'dnc-c', do_not_contact: true, dnc_reason: 'asked to stop, 2026-09-18' });
    try {
      validatePitchNew(s, { curator_id: 'dnc-c', track_ids: ['zooted-zone'], channel: 'email' });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof RuleError && e.rule === 'V3');
      assert.ok(e.message.includes('asked to stop'), 'reason surfaced: ' + e.message);
    }
  });
  it('rejects follow-up scheduling (nudge) for a DNC curator', () => {
    const s = makeStore();
    seedPair(s, { id: 'dnc-c' });
    const p = addPitch(s, {
      curator_id: 'dnc-c', status: 'sent', created_at: '2026-09-01T12:00:00Z',
      messages: [msgOut('sent it', 'CWI', '2026-09-01T12:00:00Z')],
    });
    s.update('curators', 'dnc-c', { do_not_contact: true, dnc_reason: 'asked to stop' });
    rejectsWith(() => validateNudge(s, s.find('pitches', p.id), new Date('2026-09-20T12:00:00Z')), 'G3');
  });
  it('requires dnc_reason when the flag is set', () => {
    const s = makeStore();
    assert.throws(() => addCurator(s, { id: 'dnc-c', do_not_contact: true, dnc_reason: null }),
      (e) => e instanceof RuleError && e.rule === 'V3');
  });
});

// ---- V2: placement evidence ------------------------------------------------------------------
describe('V2 placement evidence', () => {
  function basePlacement(store, over = {}) {
    return {
      id: 'plc_test_001', pitch_id: 'pch_test_001', curator_id: 'test-curator', track_id: 'zooted-zone',
      playlist_url: 'https://open.spotify.com/playlist/abcDEF123',
      position: 7, total_tracks: 40, verified_via: 'link',
      observed_at: '2026-09-20T12:00:00Z', live: true, receipts: ['/tmp/does-not-matter.json'],
      ...over,
    };
  }
  function wiredStore() {
    const s = makeStore();
    seedPair(s);
    addPitch(s);
    return s;
  }
  it('rejects a placement with no playlist URL', () => {
    const s = wiredStore();
    rejectsWith(() => validatePlacement(s, basePlacement(s, { playlist_url: '' })), 'V2');
  });
  it('rejects a placement with no receipts', () => {
    const s = wiredStore();
    rejectsWith(() => validatePlacement(s, basePlacement(s, { receipts: [] })), 'V2');
  });
  it('rejects a placement whose receipt file does not exist', () => {
    const s = wiredStore();
    rejectsWith(() => validatePlacement(s, basePlacement(s, { receipts: ['/tmp/setlist-no-such-receipt.json'] })), 'V2');
  });
  it('rejects a non-Spotify playlist URL', () => {
    const s = wiredStore();
    rejectsWith(() => validatePlacement(s, basePlacement(s, { playlist_url: 'https://example.com/pl/1' })), 'V2');
  });
  it('accepts a fully-evidenced placement', () => {
    const s = wiredStore();
    const rp = join(s.receiptsDir, 'r.json');
    s.ensureDirs();
    writeFileSync(rp, '{}');
    validatePlacement(s, basePlacement(s, { receipts: [rp] })); // throws if invalid
  });
});

// ---- V4/G2: nudge cap + spacing -----------------------------------------------------------------
describe('V4/G2 nudge cap and spacing', () => {
  function nudgableStore(over = {}) {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s, {
      status: 'sent', created_at: '2026-09-01T12:00:00Z',
      messages: [msgOut('first touch', 'CWI', '2026-09-01T12:00:00Z')],
      ...over,
    });
    return { s, p: s.find('pitches', p.id) };
  }
  it('rejects the 3rd nudge (cap is 2)', () => {
    const { s, p } = nudgableStore({ nudges_used: 2, last_nudge_at: '2026-09-08' });
    rejectsWith(() => validateNudge(s, p, new Date('2026-09-20T12:00:00Z')), 'V4');
  });
  it('enforces the 7-day minimum spacing', () => {
    const { s, p } = nudgableStore({ nudges_used: 1, last_nudge_at: '2026-09-18' });
    rejectsWith(() => validateNudge(s, p, new Date('2026-09-20T12:00:00Z')), 'V4');
  });
  it('allows nudge #1 at >= 7 days after the first touch', () => {
    const { s, p } = nudgableStore();
    validateNudge(s, p, new Date('2026-09-08T12:00:01Z')); // throws if invalid
  });
  it('rejects nudges on closed threads', () => {
    const { s, p } = nudgableStore({ status: 'closed', retired_reason: 'done', closed_at: '2026-09-10T00:00:00Z' });
    rejectsWith(() => validateNudge(s, p, new Date('2026-09-20T12:00:00Z')), 'V4');
  });
});

// ---- V5: personal-identity approval ----------------------------------------------------------------
describe('V5 personal-identity approval', () => {
  it('blocks a personal-identity send without approval_ref', () => {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s);
    rejectsWith(() => validateSend(s, s.find('pitches', p.id),
      { personal: true, approval_ref: null, actor: '@lanskyblack', evidence: 'sent it' },
      new Date('2026-09-20T12:00:00Z')), 'V5');
  });
  it('allows a personal-identity send WITH approval_ref', () => {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s);
    validateSend(s, s.find('pitches', p.id),
      { personal: true, approval_ref: 'black-exact-copy-2026-09-20', actor: '@lanskyblack', evidence: 'sent it' },
      new Date('2026-09-20T12:00:00Z')); // throws if invalid
  });
  it('allows a CWI-account send without approval_ref (fire-always)', () => {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s);
    validateSend(s, s.find('pitches', p.id),
      { personal: false, approval_ref: null, actor: 'CWI', evidence: 'sent it' },
      new Date('2026-09-20T12:00:00Z')); // throws if invalid
  });
});

// ---- V7: referential integrity ------------------------------------------------------------------------
describe('V7 referential integrity', () => {
  it('rejects a pitch whose curator does not exist', () => {
    const s = makeStore();
    addTrack(s);
    rejectsWith(() => validatePitchNew(s, { curator_id: 'ghost', track_ids: ['zooted-zone'], channel: 'email' }), 'V7');
  });
  it('rejects a pitch whose track does not exist', () => {
    const s = makeStore();
    addCurator(s);
    rejectsWith(() => validatePitchNew(s, { curator_id: 'test-curator', track_ids: ['ghost-track'], channel: 'email' }), 'V7');
  });
  it('rejects a placement whose track FK dangles', () => {
    const s = makeStore();
    seedPair(s);
    addPitch(s);
    const rp = join(s.receiptsDir, 'r.json');
    s.ensureDirs(); writeFileSync(rp, '{}');
    rejectsWith(() => validatePlacement(s, {
      id: 'plc_x', pitch_id: 'pch_test_001', curator_id: 'test-curator', track_id: 'ghost',
      playlist_url: 'https://open.spotify.com/playlist/abcDEF123', position: 1, total_tracks: 10,
      verified_via: 'scan', observed_at: '2026-09-20T12:00:00Z', live: true, receipts: [rp],
    }), 'V7');
  });
  it('rejects a placement whose track is not on the pitch', () => {
    const s = makeStore();
    seedPair(s);
    addTrack(s, { id: 'other-track', spotify_url: 'https://open.spotify.com/track/abcDEF123456' });
    addPitch(s);
    const rp = join(s.receiptsDir, 'r.json');
    s.ensureDirs(); writeFileSync(rp, '{}');
    rejectsWith(() => validatePlacement(s, {
      id: 'plc_x', pitch_id: 'pch_test_001', curator_id: 'test-curator', track_id: 'other-track',
      playlist_url: 'https://open.spotify.com/playlist/abcDEF123', position: 1, total_tracks: 10,
      verified_via: 'scan', observed_at: '2026-09-20T12:00:00Z', live: true, receipts: [rp],
    }), 'V7');
  });
  it('rejects a follow-up whose pitch does not exist', () => {
    const s = makeStore();
    rejectsWith(() => validateFollowup(s,
      { id: 'fup_x', pitch_id: 'ghost', due_date: '2026-09-22', action: 'x', done: false }), 'V7');
  });
});

// ---- G1: one pitch per (curator, track) ----------------------------------------------------------------------
describe('G1 duplicate pitch', () => {
  it('rejects a second non-closed pitch for the same curator+track', () => {
    const s = makeStore();
    seedPair(s);
    addPitch(s, { status: 'sent', created_at: '2026-09-14T12:00:00Z' });
    rejectsWith(() => validatePitchNew(s, { curator_id: 'test-curator', track_ids: ['zooted-zone'], channel: 'email' }), 'G1');
  });
  it('allows a new pitch for the same pair after the old one closed honestly', () => {
    const s = makeStore();
    seedPair(s);
    addPitch(s, { status: 'closed', retired_reason: 'no reply after 2 touches', created_at: '2026-09-14T12:00:00Z', closed_at: '2026-09-20T00:00:00Z' });
    validatePitchNew(s, { curator_id: 'test-curator', track_ids: ['zooted-zone'], channel: 'email' }); // throws if invalid
  });
  it('allows a different track to the same curator', () => {
    const s = makeStore();
    seedPair(s);
    addTrack(s, { id: 'other-track', spotify_url: 'https://open.spotify.com/track/abcDEF123456' });
    addPitch(s, { status: 'sent', created_at: '2026-09-14T12:00:00Z' });
    validatePitchNew(s, { curator_id: 'test-curator', track_ids: ['other-track'], channel: 'email' });
  });
});

// ---- G6: daily action budget ---------------------------------------------------------------------------------------
describe('G6 daily action budget', () => {
  it('refuses the 21st outreach action in a day', () => {
    const s = makeStore();
    seedPair(s);
    const msgs = [];
    for (let i = 0; i < 20; i++) msgs.push(msgOut(`touch ${i}`, 'CWI', '2026-09-20T10:00:00Z'));
    addPitch(s, { status: 'sent', created_at: '2026-09-20T09:00:00Z', messages: msgs });
    assert.equal(countActionsOn(s, '2026-09-20'), 20);
    rejectsWith(() => checkDailyBudget(s, new Date('2026-09-20T12:00:00Z')), 'G6');
  });
  it('resets the next day', () => {
    const s = makeStore();
    seedPair(s);
    const msgs = [];
    for (let i = 0; i < 20; i++) msgs.push(msgOut(`touch ${i}`, 'CWI', '2026-09-20T10:00:00Z'));
    addPitch(s, { status: 'sent', created_at: '2026-09-20T09:00:00Z', messages: msgs });
    checkDailyBudget(s, new Date('2026-09-21T12:00:00Z')); // throws if invalid
  });
  it('a send at the budget is rejected by validateSend (G6)', () => {
    const s = makeStore();
    seedPair(s);
    addTrack(s, { id: 'track-two', title: 'Track Two', spotify_url: 'https://open.spotify.com/track/abcDEF123456' });
    const msgs = [];
    for (let i = 0; i < 20; i++) msgs.push(msgOut(`touch ${i}`, 'CWI', '2026-09-20T10:00:00Z'));
    const p = addPitch(s, { status: 'sent', created_at: '2026-09-20T09:00:00Z', messages: msgs });
    const p2 = addPitch(s, { track_ids: ['track-two'], status: 'draft', created_at: '2026-09-20T11:00:00Z' });
    void p;
    rejectsWith(() => validateSend(s, s.find('pitches', p2.id),
      { personal: false, approval_ref: null, actor: 'CWI', evidence: 'sent it' },
      new Date('2026-09-20T12:00:00Z')), 'G6');
  });
});

// ---- G8: every touch logged -----------------------------------------------------------------------------------------------
describe('G8 touch logging', () => {
  it('rejects an anonymous message', () => {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s, { created_at: '2026-09-14T12:00:00Z' });
    rejectsWith(() => validateMessage(
      { date: '2026-09-14T13:00:00Z', direction: 'out', text: 'hi' },
      s.find('pitches', p.id), new Date('2026-09-20T12:00:00Z')), 'G8');
  });
  it('rejects a future-dated message', () => {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s, { created_at: '2026-09-14T12:00:00Z' });
    rejectsWith(() => validateMessage(
      msgOut('hi', 'CWI', '2026-09-25T12:00:00Z'),
      s.find('pitches', p.id), new Date('2026-09-20T12:00:00Z')), 'G8');
  });
  it('rejects a message predating the pitch', () => {
    const s = makeStore();
    seedPair(s);
    const p = addPitch(s, { created_at: '2026-09-14T12:00:00Z' });
    rejectsWith(() => validateMessage(
      msgOut('hi', 'CWI', '2026-09-10T12:00:00Z'),
      s.find('pitches', p.id), new Date('2026-09-20T12:00:00Z')), 'G8');
  });
});

// ---- V-3 bot-vet hold ----------------------------------------------------------------------------------------------------------
describe('V-3 bot-vet hold', () => {
  it('holds pitches at draft while a flag is uncleared, releases on clear', () => {
    const s = makeStore();
    seedPair(s, { id: 'flagged-c', notes: '[BOT-VET FLAG 2026-09-20T00:00:00Z] follower velocity spike' });
    const p = addPitch(s, { curator_id: 'flagged-c', created_at: '2026-09-14T12:00:00Z' });
    assert.ok(botVetHold(s.find('curators', 'flagged-c')), 'hold detected');
    rejectsWith(() => validateSend(s, s.find('pitches', p.id),
      { personal: false, approval_ref: null, actor: 'CWI', evidence: 'sent it' },
      new Date('2026-09-20T12:00:00Z')), 'V3-HOLD');
    s.update('curators', 'flagged-c', {
      notes: '[BOT-VET FLAG 2026-09-20T00:00:00Z] follower velocity spike\n[BOT-VET CLEARED 2026-09-21T00:00:00Z] human review: organic growth, playlist legit',
    });
    assert.equal(botVetHold(s.find('curators', 'flagged-c')), null);
    validateSend(s, s.find('pitches', p.id),
      { personal: false, approval_ref: null, actor: 'CWI', evidence: 'sent it' },
      new Date('2026-09-21T12:00:00Z')); // throws if still held
  });
});
