// Setlist tests — helpers.js
// Shared scaffolding: temp stores + a minimal valid corpus for poison tests.
// Every test file gets a FRESH store (mkdtemp), so tests never interfere.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, utcNow } from '../store.js';
import { validateTrack, validateCurator, validatePitchNew, validateMessage } from '../rules.js';

export function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-test-'));
  return new Store(dir);
}

export function addTrack(store, over = {}) {
  const t = {
    id: 'zooted-zone', title: 'Zooted Zone', artist: 'That Boy Hi Hat',
    spotify_url: 'https://open.spotify.com/track/0emH8ktA8x4DkOFLsG5xkW',
    isrc: null, explicit: true, fcc_safe: false, release_date: null,
    ...over,
  };
  validateTrack(t);
  return store.insert('tracks', t);
}

export function addCurator(store, over = {}) {
  const now = utcNow();
  const c = {
    id: 'test-curator', name: 'Test Curator', handles: [], platform: 'spotify-playlist',
    playlist_urls: [], genres: ['hip-hop'], follower_count: null, followers_observed_at: null,
    submission_path: { type: 'form-url', value: 'https://example.com/submit' },
    account_needed: false, payola_flag: false, payola_evidence: null,
    do_not_contact: false, dnc_reason: null,
    stats: { pitches: 0, replies: 0, placements_verified: 0 },
    notes: null, created_at: now, updated_at: now,
    ...over,
  };
  validateCurator(c);
  return store.insert('curators', c);
}

// Minimal pitch inserted WITHOUT the CLI (bypasses nothing — validates first).
export function addPitch(store, over = {}) {
  const now = utcNow();
  const spec = {
    curator_id: 'test-curator', track_ids: ['zooted-zone'], channel: 'email',
    ...over,
  };
  validatePitchNew(store, { curator_id: spec.curator_id, track_ids: spec.track_ids, channel: spec.channel },
    over.historical ? { historical: true } : {});
  const recs = store.records('pitches');
  const pitch = {
    id: `pch_test_${String(recs.length + 1).padStart(3, '0')}`,
    curator_id: spec.curator_id, track_ids: spec.track_ids, channel: spec.channel,
    status: spec.status || 'draft', messages: spec.messages || [],
    next_action_date: spec.next_action_date || null, next_action: spec.next_action || null,
    nudges_used: spec.nudges_used || 0, last_nudge_at: spec.last_nudge_at || null,
    retired_reason: spec.retired_reason || null,
    created_at: spec.created_at || now, closed_at: spec.closed_at || null,
  };
  for (const m of pitch.messages) validateMessage(m, pitch, new Date('2030-01-01T00:00:00Z'));
  return store.insert('pitches', pitch);
}

// A standard seeded pair: one track + one curator, ready for pitch tests.
export function seedPair(store, curatorOver = {}) {
  addTrack(store);
  addCurator(store, curatorOver);
}

export function msgOut(text, actor = 'CWI', date = '2026-09-14T12:00:00Z', approval_ref = null) {
  return { date, direction: 'out', text, actor, approval_ref };
}
export function msgIn(text, actor = 'Curator', date = '2026-09-14T18:00:00Z') {
  return { date, direction: 'in', text, actor, approval_ref: null };
}
