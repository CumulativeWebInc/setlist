#!/usr/bin/env node
// Setlist — rescan.js
// Procedure V-2: hold re-scan — is each live=true placement still live?
// Cadence: weekly (Sundays) via cron, plus on-demand `setlist rescan`.
//
//   node /home/hatch/workspace/cwi-company/marquee/rescan.js [--snapshots DIR] [--dir ROOT]
//
// --snapshots DIR: maps <spotify-playlist-id>.json -> captured track-ID snapshot.
//   With a snapshot present the placement is re-verified (V-1) and the hold
//   record updated (position drift recorded; drops set live=false + open a
//   follow-up for the human — no auto-nudge fires).
//   Without snapshots the run only REPORTS what is due; it changes nothing and
//   exits 0 (nothing failed — the operator supplies manual evidence).
//
// Exits non-zero only on real failure (corrupt store, unreadable snapshot).

import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, utcNow } from './store.js';
import { verifyPlacement } from './verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function playlistId(url) {
  const m = /^https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)$/.exec(url || '');
  return m ? m[1] : null;
}

// Exported for setlist.js `rescan` and for tests.
export async function runRescan(store, { snapshotsDir = null, now = new Date() } = {}) {
  const placements = store.records('placements').filter(p => p.live);
  const result = {
    ran_at: (now.toISOString ? now.toISOString() : new Date(now).toISOString()),
    checked: 0, still_live: 0, dropped: 0, due_manual: 0,
    dropped_list: [], due_manual_list: [], errors: [],
  };

  let snapMap = {};
  if (snapshotsDir) {
    if (!existsSync(snapshotsDir)) {
      result.errors.push(`snapshots dir not found: ${snapshotsDir}`);
      return result;
    }
    for (const f of readdirSync(snapshotsDir)) {
      if (f.endsWith('.json')) snapMap[basename(f, '.json')] = join(snapshotsDir, f);
    }
  }

  for (const p of placements) {
    const pid = playlistId(p.playlist_url);
    const snapFile = pid ? snapMap[pid] : null;
    if (!snapFile) {
      result.due_manual++;
      result.due_manual_list.push({ placement_id: p.id, track_id: p.track_id, playlist_url: p.playlist_url });
      continue;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(readFileSync(snapFile, 'utf8'));
      if (!Array.isArray(snapshot)) throw new Error('not a JSON array');
    } catch (e) {
      result.errors.push(`unreadable snapshot ${snapFile}: ${e.message}`);
      continue;
    }
    const res = await verifyPlacement(store, {
      playlistUrl: p.playlist_url,
      trackId: p.track_id,
      method: 'manual',
      snapshot,
      placementId: p.id,
      observedAt: result.ran_at,
      note: `V-2 weekly hold re-scan (snapshot ${basename(snapFile)})`,
    });
    result.checked++;
    if (res.found) {
      result.still_live++;
    } else {
      result.dropped++;
      const fups = store.records('followups');
      const fup = fups[fups.length - 1]; // verifyPlacement opened it
      result.dropped_list.push({
        placement_id: p.id, track_id: p.track_id, playlist_url: p.playlist_url,
        followup_id: fup ? fup.id : null,
      });
    }
  }
  return result;
}

// Cron entry point. Absolute paths per the gear-ledger heartbeat pattern.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  const args = process.argv.slice(2);
  const snapshots = (i => { const k = args.indexOf('--snapshots'); return k === -1 ? null : args[k + 1]; })();
  const dir = (i => { const k = args.indexOf('--dir'); return k === -1 ? null : args[k + 1]; })();
  const store = new Store(dir || HERE);
  runRescan(store, { snapshotsDir: snapshots })
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.errors.length > 0 ? 1 : 0);
    })
    .catch(e => { console.error(`rescan failed: ${e.message}`); process.exit(1); });
}
