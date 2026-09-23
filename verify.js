#!/usr/bin/env node
// Setlist — verify.js
// Implements VERIFICATION-METHOD.md procedure V-1: given a playlist snapshot
// (JSON array of Spotify track IDs in order) + a track ID, return
// { found, position, total_tracks } and write the verification-event + receipt.
//
// Doctrine encoded here:
//   - Link-first, scan-second: the caller passes the curator-provided playlist_url;
//     a scan that can't resolve a URL is UNVERIFIED, never "not found".
//   - Exact Spotify track-ID match only. Never title/artist fuzzy-match.
//   - Evidence is a file: the raw snapshot is always persisted to receipts/.
//
// Methods registry: `manual` is the v0.1 production path (operator supplies the
// snapshot via file, pasted stdin, or guided prompt). `spotify-api` plugs in
// behind the SAME interface once Black's app registration exists (K8) — register
// it with registerMethod('spotify-api', async ({playlistUrl}) => string[]).
// Until then it throws a clear error naming the blocker.

import { writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, genId, utcNow } from './store.js';
import { RuleError, validateVerificationEvent, PLAYLIST_URL_RE } from './rules.js';

const methods = {
  // Manual: the snapshot is already in hand (file / paste / prompt upstream).
  // Returns it unchanged — matching logic is method-independent.
  manual: async ({ snapshot }) => {
    if (!Array.isArray(snapshot)) throw new RuleError('V1-METHOD', 'manual method requires a snapshot array of track IDs');
    return snapshot;
  },
  // Placeholder with the honest blocker. K8: app registration is account
  // creation -> queued to Black. Until it exists, this stays a clear error.
  'spotify-api': async () => {
    throw new RuleError(
      'V1-METHOD',
      'spotify-api method not configured: Spotify app registration is queued to Black (identity, not tool access) ' +
      'and the K8 ToS review is pending. Use method=manual with a captured snapshot.'
    );
  },
};

export function registerMethod(name, fn) {
  if (typeof fn !== 'function') throw new Error('registerMethod requires a function');
  methods[name] = fn;
}
export function availableMethods() {
  return Object.keys(methods);
}

// Pure matcher: the heart of the K6 binary gate.
export function matchSnapshot(snapshot, trackId) {
  if (!Array.isArray(snapshot)) throw new RuleError('V1-METHOD', 'snapshot must be an array of track IDs');
  const ids = snapshot.map(s => String(s).trim());
  const idx = ids.indexOf(String(trackId).trim());
  return {
    found: idx !== -1,
    position: idx !== -1 ? idx + 1 : null, // 1-based
    total_tracks: ids.length,
  };
}

function playlistIdFromUrl(url) {
  const m = /^https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)$/.exec(url || '');
  return m ? m[1] : 'unknown';
}

// Full V-1 run: fetch (via method) -> match -> write verification-event + receipt.
// If placementId is given, V-2 hold semantics apply: found -> refresh the hold
// record; not found -> live=false + open a follow-up for the human.
export async function verifyPlacement(store, {
  playlistUrl,
  trackId,
  method = 'manual',
  snapshot = null,        // for manual: the array (or null -> method-specific source)
  methodInput = {},       // extra input for the method (e.g. {file})
  placementId = null,
  observedAt = null,
  note = null,
}) {
  if (!PLAYLIST_URL_RE.test(playlistUrl || '')) {
    throw new RuleError('V1', `verify requires a curator-provided Spotify playlist URL (got ${JSON.stringify(playlistUrl)}). No URL -> UNVERIFIED, never "not found".`);
  }
  if (!trackId || typeof trackId !== 'string') throw new RuleError('SCHEMA', 'verify requires a track_id');
  const track = store.find('tracks', trackId);
  if (!track) throw new RuleError('V7', `verify: track_id ${JSON.stringify(trackId)} does not resolve to a track record`);

  const methodFn = methods[method];
  if (!methodFn) throw new RuleError('V1-METHOD', `unknown verification method ${JSON.stringify(method)} (available: ${availableMethods().join(', ')})`);

  const snap = await methodFn({ playlistUrl, snapshot, ...methodInput });
  const { found, position, total_tracks } = matchSnapshot(snap, spotifyIdOf(track));

  const observed = observedAt || utcNow();
  const verId = genId(store.records('verifications'), 'ver', new Date(observed));

  // Receipt: the raw evidence, always a file.
  store.ensureDirs();
  const receiptPath = join(store.receiptsDir, `ver_${verId}.json`);
  const receiptBody = {
    verification_id: verId,
    procedure: 'V-1',
    playlist_url: playlistUrl,
    track_id: trackId,
    spotify_track_id: spotifyIdOf(track),
    method,
    observed_at: observed,
    result: { found, position, total_tracks },
    snapshot: snap, // the EXACT array the matcher ran over (method-returned, never the raw input)
    note: note || null,
  };
  writeFileSync(receiptPath, JSON.stringify(receiptBody, null, 2) + '\n', 'utf8');

  const event = {
    id: verId,
    placement_id: placementId,
    playlist_url: playlistUrl,
    track_id: trackId,
    observed_at: observed,
    found,
    position,
    total_tracks,
    method,
    raw_log_path: receiptPath,
  };
  validateVerificationEvent(event);
  store.insert('verifications', event);

  // V-2 hold semantics when tied to a placement.
  if (placementId) {
    const placement = store.find('placements', placementId);
    if (!placement) throw new RuleError('V7', `verify: placement_id ${JSON.stringify(placementId)} does not resolve`);
    if (found) {
      // Position drift is data, not an alarm — record it.
      store.update('placements', placementId, {
        position, total_tracks, observed_at: observed, live: true,
        receipts: [...placement.receipts, receiptPath],
      });
    } else {
      store.update('placements', placementId, { live: false, observed_at: observed, receipts: [...placement.receipts, receiptPath] });
      // Open a follow-up on the pitch: the human decides, no auto-nudge fires.
      const fups = store.records('followups');
      store.insert('followups', {
        id: genId(fups, 'fup', new Date(observed)),
        pitch_id: placement.pitch_id,
        due_date: observed.slice(0, 10),
        action: `placement dropped from playlist (${playlistUrl}) — scanned ${observed.slice(0, 10)}, track not present. Confirm with curator? (No auto-nudge fires; human decides.)`,
        done: false,
        done_at: null,
        result: null,
      });
    }
  }

  return { found, position, total_tracks, verification_id: verId, raw_log_path: receiptPath };
}

function spotifyIdOf(track) {
  const m = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)$/.exec(track.spotify_url || '');
  return m ? m[1] : null;
}

// Guided manual capture: read track IDs from stdin (one per line, blank line ends).
export function readSnapshotFromStdin() {
  return new Promise((resolve) => {
    const ids = [];
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === '' && ids.length > 0) { process.stdin.pause(); resolve(ids); return; }
        if (line !== '') ids.push(line);
      }
    });
    process.stdin.on('end', () => {
      const rest = buf.trim();
      if (rest) ids.push(...rest.split(/\s+/));
      resolve(ids);
    });
  });
}

// Entry-point guard.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1]) {
  try {
    if (realpathSync(process.argv[1]) === realpathSync(__filename)) {
      console.error('verify.js is a module — use `setlist verify ...`.');
      process.exit(2);
    }
  } catch { /* ignore */ }
}
