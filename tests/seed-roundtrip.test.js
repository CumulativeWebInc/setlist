// Setlist tests — seed-roundtrip.test.js
// The dogfood seed must round-trip: seed into a temp store, then assert the
// exact corpus counts and the key known facts. No invented numbers here —
// every assertion is tied to the corpus sections.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { seedCorpus } from '../seed.js';
import { makeStore } from './helpers.js';

const EXPECT = { tracks: 8, curators: 60, pitches: 35, followups: 12, placements: 5, verification_events: 5 };

describe('seed round-trip', () => {
  const COLL = { tracks: 'tracks', curators: 'curators', pitches: 'pitches', followups: 'followups', placements: 'placements', verification_events: 'verifications' };
  it('produces the exact corpus counts', () => {
    const s = makeStore();
    const summary = seedCorpus(s);
    assert.deepEqual(summary, EXPECT);
    for (const [key, n] of Object.entries(EXPECT)) {
      assert.equal(s.records(COLL[key]).length, n, `${key} count`);
    }
  });
  it('carries the four known placement groups', () => {
    const s = makeStore();
    seedCorpus(s);
    const live = s.records('placements').filter(p => p.live);
    assert.equal(live.length, 5);
    const byCurator = {};
    for (const p of live) (byCurator[p.curator_id] ||= []).push(p);
    // Audiartist: 3 tracks at the corpus positions
    assert.deepEqual(
      byCurator['audiartist'].map(p => [p.track_id, p.position]).sort(),
      [['doves-diamonds', 31], ['shaka-zulu', 21], ['zooted-zone', 30]]);
    // Eric Alper: Zooted Zone #216/216
    assert.equal(byCurator['eric-alper'][0].position, 216);
    assert.equal(byCurator['eric-alper'][0].total_tracks, 216);
    // DJ 6Rings: Flex My Flame #7 (free route), payola flag stays
    assert.equal(byCurator['shan-dj-6rings'][0].position, 7);
    assert.equal(s.find('curators', 'shan-dj-6rings').payola_flag, true);
  });
  it('WATCH THA GAP is replied, NOT placed', () => {
    const s = makeStore();
    seedCorpus(s);
    const p = s.records('pitches').find(x => x.curator_id === 'watch-tha-gap');
    assert.equal(p.status, 'replied');
    assert.equal(s.records('placements').filter(x => x.curator_id === 'watch-tha-gap').length, 0);
  });
  it('DJ 6Rings historical pitch is closed and immutable under V1', () => {
    const s = makeStore();
    seedCorpus(s);
    const p = s.records('pitches').find(x => x.curator_id === 'shan-dj-6rings');
    assert.equal(p.status, 'closed');
  });
  it('curator stats reflect placements_verified', () => {
    const s = makeStore();
    seedCorpus(s);
    assert.equal(s.find('curators', 'audiartist').stats.placements_verified, 3);
    assert.equal(s.find('curators', 'eric-alper').stats.placements_verified, 1);
  });
  it('all receipts referenced by placements exist on disk', () => {
    const s = makeStore();
    seedCorpus(s);
    for (const p of s.records('placements')) {
      for (const r of p.receipts) assert.ok(existsSync(r), `receipt exists: ${r}`);
    }
  });
  it('seeding is deterministic: two fresh stores produce identical summaries', () => {
    const s1 = makeStore();
    const s2 = makeStore();
    assert.deepEqual(seedCorpus(s1), seedCorpus(s2));
  });
});
