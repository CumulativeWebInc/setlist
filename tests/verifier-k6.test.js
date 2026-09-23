// Setlist tests — verifier-k6.test.js
// K6 VERIFIER GATE (VERIFICATION-METHOD.md V-4): the exact-ID matcher must
// reproduce the known-good placements EXACTLY — spotify_id, position, total —
// from the corpus fixtures. 5/5 or the build does not ship.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchSnapshot, verifyPlacement, availableMethods } from '../verify.js';
import { makeStore, addTrack, addCurator, addPitch, seedPair } from './helpers.js';

const FIX = new URL('../design/fixtures/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8')); // array

function loadFixture(file) {
  return JSON.parse(readFileSync(join(FIX, file), 'utf8')); // string[] of spotify IDs
}

// ---- K6: the binary gate ----------------------------------------------------------------
describe('K6 verifier gate — known placements reproduced exactly (5/5)', () => {
  const cases = [];
  for (const fx of manifest) {
    const snap = loadFixture(fx.file);
    for (const exp of fx.expect) cases.push({ fx, snap, exp });
  }
  it('exactly five known placements across the fixtures', () => {
    assert.equal(cases.length, 5);
  });
  for (const { fx, snap, exp } of cases) {
    it(`${fx.playlist_name}: ${exp.track_id} at #${exp.position}/${exp.total}`, () => {
      assert.equal(snap.length, fx.total, 'fixture length');
      const r = matchSnapshot(snap, exp.spotify_id);
      assert.ok(r.found, `${exp.spotify_id} must be found`);
      assert.equal(r.position, exp.position, 'position');
      assert.equal(r.total_tracks, exp.total, 'total');
    });
  }
  it('corpus truth table (pinned)', () => {
    const truth = {
      '0emH8ktA8x4DkOFLsG5xkW': [ // Zooted Zone
        ['eric-alper-360.json', 216, 216],
        ['audiartist-new-rap-hits.json', 30, 105],
      ],
      '3pQEzg7xFqGIk0CK1Za1Kw': [['audiartist-new-rap-hits.json', 21, 105]], // Shaka Zulu
      '4NAyd7rvnuG3DrPFqXo4eQ': [['audiartist-new-rap-hits.json', 31, 105]], // Doves & Diamonds
      '3knXIxd0PlraXvarlwGwKm': [['dj-6rings-its-goin.json', 7, 40]], // Flex My Flame (free route)
    };
    for (const [sid, rows] of Object.entries(truth)) {
      for (const [file, pos, total] of rows) {
        const r = matchSnapshot(loadFixture(file), sid);
        assert.deepEqual([r.position, r.total_tracks], [pos, total], `${file} ${sid}`);
      }
    }
  });
});

// ---- unit: matcher edge cases ------------------------------------------------------------------
describe('matcher edge cases', () => {
  it('returns not-found cleanly for an absent track', () => {
    const r = matchSnapshot(loadFixture('eric-alper-360.json'), 'nonexistentID123456');
    assert.equal(r.found, false);
    assert.equal(r.position, null);
    assert.equal(r.total_tracks, 216);
  });
  it('matches only the exact spotify_id — a near-miss is not a placement', () => {
    const snap = ['abcDEF123456'];
    assert.equal(matchSnapshot(snap, 'abcDEF12345').found, false);
    assert.equal(matchSnapshot(snap, 'abcdef123456').found, false, 'case-sensitive');
    assert.equal(matchSnapshot(snap, 'abcDEF123456').position, 1);
  });
  it('rejects a non-array snapshot', () => {
    assert.throws(() => matchSnapshot('nope', 'abcDEF123456'), /snapshot must be an array/);
  });
});

// ---- method registry ---------------------------------------------------------------------------------
describe('method registry', () => {
  it('manual is available; spotify-api is registered but honestly blocked (K8 queued)', async () => {
    assert.ok(availableMethods().includes('manual'));
    assert.ok(availableMethods().includes('spotify-api'));
    const s = makeStore();
    seedPair(s);
    await assert.rejects(
      () => verifyPlacement(s, {
        playlistUrl: 'https://open.spotify.com/playlist/abcDEF123456',
        trackId: 'zooted-zone', method: 'spotify-api',
      }),
      /Spotify app registration is queued to Black/);
  });
  it('manual without a snapshot array is rejected', async () => {
    const s = makeStore();
    seedPair(s);
    await assert.rejects(
      () => verifyPlacement(s, {
        playlistUrl: 'https://open.spotify.com/playlist/abcDEF123456',
        trackId: 'zooted-zone', method: 'manual', snapshot: null,
      }),
      /manual method requires a snapshot array/);
  });
});

// ---- verifyPlacement end-to-end ----------------------------------------------------------------
describe('verifyPlacement', () => {
  function wiredStore() {
    const s = makeStore();
    seedPair(s);
    addPitch(s, { status: 'sent', created_at: '2026-09-14T12:00:00Z' });
    return s;
  }
  // A placement that is VALID at rest: seed receipt file exists (V2).
  function addPlacementDirect(s, id = 'plc_20260915_001') {
    s.ensureDirs();
    const rp = join(s.receiptsDir, `${id}.md`);
    writeFileSync(rp, '# seed receipt\n');
    return s.insert('placements', {
      id, pitch_id: 'pch_test_001', curator_id: 'test-curator', track_id: 'zooted-zone',
      playlist_url: 'https://open.spotify.com/playlist/5zhnSpZqKRRaOvRMWuT0bL',
      position: 30, total_tracks: 105, verified_via: 'scan',
      observed_at: '2026-09-15T12:00:00Z', live: true, receipts: [rp],
    });
  }
  const AUDIARTIST_URL = 'https://open.spotify.com/playlist/5zhnSpZqKRRaOvRMWuT0bL';

  it('FOUND: event + receipt written, placement refreshed (position drift recorded)', async () => {
    const s = wiredStore();
    const snap = loadFixture('audiartist-new-rap-hits.json');
    const p = addPlacementDirect(s);
    const r = await verifyPlacement(s, {
      playlistUrl: AUDIARTIST_URL, trackId: 'zooted-zone', method: 'manual',
      snapshot: snap, placementId: p.id,
    });
    assert.equal(r.found, true);
    assert.equal(r.position, 30);
    assert.equal(r.total_tracks, 105);
    const ev = s.find('verifications', r.verification_id);
    assert.ok(ev && ev.found && ev.position === 30 && ev.placement_id === p.id);
    const receipt = JSON.parse(readFileSync(r.raw_log_path, 'utf8'));
    assert.deepEqual(receipt.snapshot, snap, 'receipt carries the exact matcher-run snapshot');
    assert.equal(receipt.procedure, 'V-1');
    const upd = s.find('placements', p.id);
    assert.equal(upd.position, 30);
    assert.equal(upd.live, true);
    assert.ok(upd.receipts.includes(r.raw_log_path), 'receipt linked on the placement');
  });

  it('FOUND without a placement: writes the event only, touches nothing else', async () => {
    const s = wiredStore();
    const r = await verifyPlacement(s, {
      playlistUrl: AUDIARTIST_URL, trackId: 'zooted-zone', method: 'manual',
      snapshot: loadFixture('audiartist-new-rap-hits.json'),
    });
    assert.equal(r.found, true);
    assert.equal(s.records('placements').length, 0);
    assert.equal(s.records('followups').length, 0);
  });

  it('NOT FOUND with placement (V-2): live=false, follow-up opened, event kept', async () => {
    const s = wiredStore();
    const p = addPlacementDirect(s);
    const snap = ['other1234567890123'];
    const r = await verifyPlacement(s, {
      playlistUrl: AUDIARTIST_URL, trackId: 'zooted-zone', method: 'manual',
      snapshot: snap, placementId: p.id,
    });
    assert.equal(r.found, false);
    assert.equal(s.find('placements', p.id).live, false);
    const ev = s.find('verifications', r.verification_id);
    assert.equal(ev.found, false);
    const fups = s.records('followups').filter(f => f.pitch_id === 'pch_test_001');
    assert.equal(fups.length, 1);
    assert.ok(fups[0].action.includes('dropped from playlist'), 'follow-up names the drop');
    assert.equal(fups[0].done, false, 'no auto-nudge — human decides');
  });

  it('NOT FOUND without placement: UNVERIFIED event, never counted, no follow-up', async () => {
    const s = wiredStore();
    const r = await verifyPlacement(s, {
      playlistUrl: AUDIARTIST_URL, trackId: 'zooted-zone', method: 'manual',
      snapshot: ['other1234567890123'],
    });
    assert.equal(r.found, false);
    assert.equal(s.records('followups').length, 0);
    assert.equal(s.find('verifications', r.verification_id).found, false);
  });

  it('rejects a non-Spotify playlist URL (link-first: no URL -> UNVERIFIED, never "not found")', async () => {
    const s = wiredStore();
    await assert.rejects(
      () => verifyPlacement(s, {
        playlistUrl: 'https://example.com/pl/1', trackId: 'zooted-zone',
        method: 'manual', snapshot: [],
      }),
      /curator-provided Spotify playlist URL/);
  });

  it('rejects an unknown track (V7)', async () => {
    const s = makeStore();
    await assert.rejects(
      () => verifyPlacement(s, {
        playlistUrl: AUDIARTIST_URL, trackId: 'ghost', method: 'manual', snapshot: [],
      }),
      /does not resolve to a track record/);
  });
});
