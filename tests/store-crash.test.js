// Setlist tests — store-crash.test.js
// CRASH SAFETY: the store must never corrupt. Writes go to a temp file +
// fsync + atomic rename per collection file; readers fail closed. This suite
// proves it by killing a writer mid-flight.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.js';

const HERE = new URL('..', import.meta.url).pathname;

function trackRec(i) {
  return {
    id: 't' + i, title: 'T', artist: 'A',
    spotify_url: 'https://open.spotify.com/track/0emH8ktA8x4DkOFLsG5xkW',
    explicit: true, fcc_safe: false,
  };
}

// Spawn a child that writes to the store in a tight loop; SIGKILL it; then
// the collection file must still parse and hold the envelope shape.
describe('crash safety', { timeout: 60000 }, () => {
  it('SIGKILL mid-write leaves a valid store (no torn/corrupt JSON)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setlist-crash-'));
    new Store(dir).records('tracks'); // prime dirs + empty envelope

    const childScript = `
      const { Store } = await import(${JSON.stringify(join(HERE, 'store.js'))});
      const s = new Store(${JSON.stringify(dir)});
      let i = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        s.insert('tracks', { id: 't' + (i++), title: 'T', artist: 'A',
          spotify_url: 'https://open.spotify.com/track/0emH8ktA8x4DkOFLsG5xkW',
          explicit: true, fcc_safe: false });
      }
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      stdio: 'ignore',
    });
    await new Promise(r => setTimeout(r, 700)); // let it land writes mid-flight
    child.kill('SIGKILL');
    await new Promise(r => child.on('exit', r));

    const raw = readFileSync(join(dir, 'data', 'tracks.json'), 'utf8');
    const env = JSON.parse(raw); // must not throw
    assert.ok(Array.isArray(env.records), 'envelope shape intact');
    assert.equal(env.version, 1);
    for (const r of env.records) assert.ok(r.id, 'record is whole');
    assert.ok(env.records.length > 0, 'pre-crash writes survived');
  });

  it('no .tmp files linger after a successful save', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setlist-tmp-'));
    const s = new Store(dir);
    s.insert('tracks', trackRec(1));
    const leftovers = readdirSync(join(dir, 'data')).filter(f => /\.tmp\.\d+$/.test(f));
    assert.deepEqual(leftovers, []);
  });

  it('gcTmp removes stale writer tmp files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setlist-gc-'));
    const s = new Store(dir);
    s.insert('tracks', trackRec(1));
    writeFileSync(join(dir, 'data', 'tracks.json.tmp.999999'), 'partial');
    assert.equal(s.gcTmp(), 1);
    assert.deepEqual(readdirSync(join(dir, 'data')).filter(f => /\.tmp\.\d+$/.test(f)), []);
  });

  it('a corrupt collection fails closed with a loud error, never silent garbage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setlist-corrupt-'));
    const s = new Store(dir);
    s.insert('tracks', trackRec(1));
    writeFileSync(join(dir, 'data', 'tracks.json'), '{broken json');
    assert.throws(() => new Store(dir).records('tracks'), /CORRUPT/);
  });

  it('a non-envelope collection file fails closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setlist-badenv-'));
    const s = new Store(dir);
    s.ensureDirs();
    writeFileSync(join(dir, 'data', 'tracks.json'), JSON.stringify({ records: 'not-an-array' }));
    assert.throws(() => new Store(dir).records('tracks'), /CORRUPT/);
  });

  it('the 10,000-record migration trigger fires (TRADEOFFS.md T1)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setlist-mig-'));
    const s = new Store(dir);
    const big = Array.from({ length: 10001 }, (_, i) => trackRec(i));
    assert.throws(() => s.save('tracks', big), /migrate to SQLite/);
  });
});
