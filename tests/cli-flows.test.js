// Setlist tests — cli-flows.test.js
// End-to-end CLI flows against freshly-seeded temp stores: rejection paths
// exit non-zero and name their rule; happy paths update state (verified by
// reading the store back directly).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.js';

const HERE = new URL('..', import.meta.url).pathname;
const CLI = join(HERE, 'setlist.js');
const SEED = join(HERE, 'seed.js');
const FIX = join(HERE, 'design', 'fixtures');

function seededStore() {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-cli-'));
  execFileSync(process.execPath, [SEED, '--dir', dir], { stdio: 'pipe' });
  return dir;
}

function run(dir, ...args) {
  try {
    const out = execFileSync(process.execPath, [CLI, '--dir', dir, ...args], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, out, err: '' };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || '', code: e.status };
  }
}

function pitchOf(dir, id) {
  return new Store(dir).find('pitches', id);
}

describe('CLI rejection paths name their rule', { timeout: 120000 }, () => {
  let dir;
  before(() => { dir = seededStore(); });

  it('pitch new on a payola curator → [V1]', () => {
    const r = run(dir, 'pitch', 'new', '--curator', 'shan-dj-6rings', '--tracks', 'zooted-zone', '--channel', 'email');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[V1]'), r.err);
  });
  it('pitch new duplicate curator+track → [G1]', () => {
    const r = run(dir, 'pitch', 'new', '--curator', 'audiartist', '--tracks', 'zooted-zone', '--channel', 'email');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[G1]'), r.err);
  });
  it('pitch new on a DNC curator → [V3]', () => {
    const r = run(dir, 'pitch', 'new', '--curator', 'elevator', '--tracks', 'zooted-zone', '--channel', 'email');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[V3]'), r.err);
  });
  it('track add with the invalid link → [V6]', () => {
    const r = run(dir, 'track', 'add', '--id', 'bad', '--title', 'Bad', '--explicit', 'yes', '--fcc-safe', 'no',
      '--spotify-url', 'https://open.spotify.com/track/1sY0hpRVAYMVgTEeDxZgFA');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[V6]'), r.err);
  });
  it('pitch sent --personal without approval-ref → [V5], parked awaiting-approval', () => {
    const mk = run(dir, 'pitch', 'new', '--curator', 'submithub', '--tracks', 'warped-and-wicked', '--channel', 'form');
    assert.ok(mk.ok, mk.err);
    const id = mk.out.match(/pitch created: (\S+)/)[1];
    const sent = run(dir, 'pitch', 'sent', '--id', id, '--personal', '--actor', '@lanskyblack', '--evidence', 'DM sent 2026-09-20');
    assert.equal(sent.ok, false);
    assert.ok(sent.err.includes('[V5]'), sent.err);
    assert.equal(pitchOf(dir, id).status, 'awaiting-approval');
    // With the approval, the same send records fine.
    const ok = run(dir, 'pitch', 'sent', '--id', id, '--personal', '--actor', '@lanskyblack',
      '--approval-ref', 'black-exact-copy-2026-09-20', '--evidence', 'DM sent 2026-09-20');
    assert.ok(ok.ok, ok.err);
    const p = pitchOf(dir, id);
    assert.equal(p.status, 'sent');
    assert.equal(p.messages.at(-1).approval_ref, 'black-exact-copy-2026-09-20');
  });
  it('pitch nudge --personal without approval-ref → [V5]', () => {
    const r = run(dir, 'pitch', 'nudge', '--id', 'pch_20260914_002', '--personal',
      '--evidence', 'x', '--actor', '@lanskyblack', '--text', 'nudge text');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[V5]'), r.err);
  });
  it('pitch note --direction out without evidence → [G7]', () => {
    const r = run(dir, 'pitch', 'note', '--id', 'pch_20260914_002', '--direction', 'out',
      '--text', 'some outbound text', '--actor', 'CWI');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[G7]'), r.err);
  });
  it('curator flag holds the thread (V3-HOLD); clear releases it', () => {
    const mk = run(dir, 'pitch', 'new', '--curator', 'tempo-check-radio', '--tracks', 'warped-and-wicked', '--channel', 'email');
    assert.ok(mk.ok, mk.err);
    const id = mk.out.match(/pitch created: (\S+)/)[1];
    assert.ok(run(dir, 'curator', 'flag', '--id', 'tempo-check-radio', '--note', 'follower velocity spike').ok);
    const held = run(dir, 'pitch', 'sent', '--id', id, '--evidence', 'email sent', '--actor', 'CWI');
    assert.equal(held.ok, false);
    assert.ok(held.err.includes('[V3-HOLD]'), held.err);
    assert.ok(run(dir, 'curator', 'flag', '--id', 'tempo-check-radio', '--clear', '--note', 'organic growth, legit').ok);
    const released = run(dir, 'pitch', 'sent', '--id', id, '--evidence', 'email sent', '--actor', 'CWI');
    assert.ok(released.ok, released.err);
  });
  it('pitch status --to sent redirects to the evidence path (G7)', () => {
    const r = run(dir, 'pitch', 'status', '--id', 'pch_20260914_008', '--to', 'sent');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[G7]'), r.err);
  });
  it('pitch status --to placed with no placement record → [V2]', () => {
    const r = run(dir, 'pitch', 'status', '--id', 'pch_20260914_008', '--to', 'placed');
    assert.equal(r.ok, false);
    assert.ok(r.err.includes('[V2]'), r.err);
  });
});

describe('CLI happy paths + nudge cap', { timeout: 120000 }, () => {
  let dir;
  before(() => { dir = seededStore(); });

  it('full lifecycle: new → sent (evidence) → note in → close', () => {
    const mk = run(dir, 'pitch', 'new', '--curator', 'delaynote', '--tracks', 'flamerz',
      '--channel', 'form', '--message', 'drafting', '--actor', 'CWI');
    assert.ok(mk.ok, mk.err);
    const id = mk.out.match(/pitch created: (\S+)/)[1];
    assert.ok(run(dir, 'pitch', 'sent', '--id', id, '--evidence', 'form submitted, confirmation screen saved', '--actor', 'CWI').ok);
    assert.equal(pitchOf(dir, id).status, 'sent');
    assert.ok(run(dir, 'pitch', 'note', '--id', id, '--direction', 'in', '--text', 'Thanks for submitting', '--actor', 'Groover').ok);
    const closed = run(dir, 'pitch', 'close', '--id', id, '--reason', 'no reply after window; closed honestly');
    assert.ok(closed.ok, closed.err);
    const p = pitchOf(dir, id);
    assert.equal(p.status, 'closed');
    assert.equal(p.retired_reason, 'no reply after window; closed honestly');
  });

  it('nudge #1 succeeds on an aged pitch; nudge #2 rejected on spacing (V4)', () => {
    // Setup (not the system under test): a pitch whose first touch is old
    // enough that the 7-day spacing rule is satisfied against the real clock.
    const s = new Store(dir);
    const now = new Date().toISOString();
    s.insert('curators', {
      id: 'cli-old-curator', name: 'Old Curator', handles: [], platform: 'blog',
      playlist_urls: [], genres: ['hip-hop'], follower_count: null, followers_observed_at: null,
      submission_path: { type: 'email', value: 'old@example.com' },
      account_needed: false, payola_flag: false, payola_evidence: null,
      do_not_contact: false, dnc_reason: null,
      stats: { pitches: 0, replies: 0, placements_verified: 0 },
      notes: null, created_at: '2026-09-01T12:00:00Z', updated_at: now,
    });
    s.insert('pitches', {
      id: 'pch_cli_old_001', curator_id: 'cli-old-curator', track_ids: ['zooted-zone'], channel: 'email',
      status: 'sent',
      messages: [{ date: '2026-09-01T12:00:00Z', direction: 'out', text: 'first touch', actor: 'CWI', approval_ref: null }],
      next_action_date: null, next_action: null, nudges_used: 0, last_nudge_at: null,
      retired_reason: null, created_at: '2026-09-01T12:00:00Z', closed_at: null,
    });
    const n1 = run(dir, 'pitch', 'nudge', '--id', 'pch_cli_old_001',
      '--evidence', 'IG DM sent by Black, screenshot receipts/', '--actor', 'Black (@lanskyblack)',
      '--text', 'polite nudge text', '--personal', '--approval-ref', 'black-exact-copy-2026-09-20');
    assert.ok(n1.ok, n1.err);
    assert.ok(n1.out.includes('nudge 1/2'), n1.out);
    assert.equal(pitchOf(dir, 'pch_cli_old_001').nudges_used, 1);
    const n2 = run(dir, 'pitch', 'nudge', '--id', 'pch_cli_old_001',
      '--evidence', 'x', '--actor', 'CWI', '--text', 'second attempt');
    assert.equal(n2.ok, false);
    assert.ok(n2.err.includes('[V4]'), n2.err);
  });

  it('verify reproduces the Alper known placement from the fixture', () => {
    const r = run(dir, 'verify', 'https://open.spotify.com/playlist/0hsLLFaADDjU54tFqaImFh',
      'zooted-zone', '--file', join(FIX, 'eric-alper-360.json'));
    assert.ok(r.ok, r.err);
    assert.ok(r.out.includes('#216/216'), r.out);
    assert.ok(r.out.includes('VERIFIED'), r.out);
  });

  it('placement record enforces evidence (V2)', () => {
    const noUrl = run(dir, 'placement', 'record', '--pitch', 'pch_20260914_008',
      '--curator', 'obscure-sound', '--track', 'zooted-zone');
    assert.equal(noUrl.ok, false); // missing --playlist-url → usage error
    const bad = run(dir, 'placement', 'record', '--pitch', 'pch_20260914_008',
      '--curator', 'obscure-sound', '--track', 'zooted-zone',
      '--playlist-url', 'https://example.com/pl/1', '--position', '1', '--total', '10', '--via', 'link');
    assert.equal(bad.ok, false);
    assert.ok(bad.err.includes('[V2]'), bad.err);
  });

  it('placement record happy path: evidence file → placed status', () => {
    const mk = run(dir, 'pitch', 'new', '--curator', 'kice-993-dj-benz', '--tracks', 'flamerz', '--channel', 'email');
    assert.ok(mk.ok, mk.err);
    const pid = mk.out.match(/pitch created: (\S+)/)[1];
    const ok = run(dir, 'placement', 'record', '--pitch', pid, '--curator', 'kice-993-dj-benz',
      '--track', 'flamerz', '--playlist-url', 'https://open.spotify.com/playlist/abcDEF123456',
      '--position', '3', '--total', '25', '--via', 'link', '--receipt', join(FIX, 'manifest.json'));
    assert.ok(ok.ok, ok.err);
    const s = new Store(dir);
    const plc = s.records('placements').find(p => p.pitch_id === pid);
    assert.ok(plc && plc.position === 3);
    assert.equal(s.find('pitches', pid).status, 'placed');
  });

  it('queue shows at most 20 items (G6)', () => {
    const q = run(dir, 'queue', '--date', '2026-09-22');
    assert.ok(q.ok, q.err);
    assert.ok(q.out.includes('20 shown'), q.out);
  });

  it('rescan runs clean on the seeded store', () => {
    const r = run(dir, 'rescan');
    assert.ok(r.ok, r.err);
  });
});
