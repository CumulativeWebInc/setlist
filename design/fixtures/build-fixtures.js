#!/usr/bin/env node
// Setlist — design/fixtures/build-fixtures.js
// Builds the K6 binary-gate fixtures: hand-specified playlist snapshots
// (JSON arrays of Spotify track IDs in order) reproducing the three known-good
// placements EXACTLY (VERIFICATION-METHOD.md V-4).
//
// Filler IDs are deterministic (seeded LCG) and prefixed "qx" so they can never
// collide with real Spotify IDs. The target track sits at the exact verified
// position; everything else is synthetic stand-in for the surrounding tracks.
// Re-running this script reproduces the fixtures byte-for-byte.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Seeded LCG — deterministic filler IDs.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function fillerId(rand) {
  let id = 'qx';
  for (let i = 0; i < 20; i++) id += ALPHA[Math.floor(rand() * ALPHA.length)];
  return id;
}

const ZOOTED = '0emH8ktA8x4DkOFLsG5xkW';
const SHAKA = '3pQEzg7xFqGIk0CK1Za1Kw';
const DOVES = '4NAyd7rvnuG3DrPFqXo4eQ';
// 2026-09-20 API read identified THIS upload of Flex My Flame at #7 on It's Goin.
// (The AI learning kit lists a different upload, 7FQvcCS2CdTVsd6hb9jvHx —
// possible duplicate upload; the placement is verified against this ID.)
const FLEX = '3knXIxd0PlraXvarlwGwKm';

function buildSnapshot(total, placements, seed) {
  const rand = lcg(seed);
  const used = new Set(Object.values(placements));
  const arr = [];
  for (let i = 0; i < total; i++) {
    if (placements[i] !== undefined) {
      arr.push(placements[i]);
    } else {
      let id;
      do { id = fillerId(rand); } while (used.has(id));
      used.add(id);
      arr.push(id);
    }
  }
  return arr;
}

const fixtures = [
  {
    file: 'eric-alper-360.json',
    playlist_url: 'https://open.spotify.com/playlist/0hsLLFaADDjU54tFqaImFh',
    playlist_name: '360° : The Best Indie Music (Eric Alper)',
    total: 216,
    // 0-based index -> track ID. #216/216 verified via curator reply 2026-09-17.
    placements: { 215: ZOOTED },
    expect: [{ track_id: 'zooted-zone', spotify_id: ZOOTED, position: 216, total: 216 }],
  },
  {
    file: 'audiartist-new-rap-hits.json',
    playlist_url: 'https://open.spotify.com/playlist/5zhnSpZqKRRaOvRMWuT0bL',
    playlist_name: 'New Rap Hits (Audiartist)',
    total: 105,
    // Full 105-track scan 2026-09-15: Shaka #21, Zooted #30, Doves #31.
    placements: { 20: SHAKA, 29: ZOOTED, 30: DOVES },
    expect: [
      { track_id: 'shaka-zulu', spotify_id: SHAKA, position: 21, total: 105 },
      { track_id: 'zooted-zone', spotify_id: ZOOTED, position: 30, total: 105 },
      { track_id: 'doves-diamonds', spotify_id: DOVES, position: 31, total: 105 },
    ],
  },
  {
    file: 'dj-6rings-its-goin.json',
    playlist_url: 'https://open.spotify.com/playlist/1aKBRGOS2ZOMiKwleCd9KV',
    playlist_name: "It's Goin (DJ 6Rings)",
    total: 40,
    // Verified via the curator's own link, free route, 2026-09-20: #7.
    // Total track count is synthetic stand-in (not captured in the corpus).
    placements: { 6: FLEX },
    expect: [{ track_id: 'flex-my-flame', spotify_id: FLEX, position: 7, total: 40 }],
  },
];

const manifest = [];
for (const f of fixtures) {
  const snap = buildSnapshot(f.total, f.placements, 20260920 + f.total);
  writeFileSync(join(HERE, f.file), JSON.stringify(snap, null, 1) + '\n', 'utf8');
  manifest.push({
    file: f.file, playlist_url: f.playlist_url, playlist_name: f.playlist_name,
    total: f.total, expect: f.expect,
  });
  console.log(`wrote ${f.file} (${f.total} tracks)`);
}
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('wrote manifest.json');
