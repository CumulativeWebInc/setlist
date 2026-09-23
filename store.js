#!/usr/bin/env node
// Setlist — store.js
// Owns ALL reads/writes to data/*.json. Every file is a {version:1, records:[]} envelope.
// Crash safety: every write goes to a temp file in the same directory, is fsync'd,
// then atomically renamed over the target. A kill -9 mid-write can only ever leave
// the previous complete version (or an orphaned tmp file, never a partial target).
//
// Collections: curators, pitches, placements, verifications, followups, tracks
//   -> data/<collection>.json
//
// Receipts live under <root>/receipts/ (evidence files referenced by placements
// and verification-events).
//
// Migration trigger (per TRADEOFFS.md T1): if any one file passes 10,000 records,
// migrate to SQLite. This module is the seam.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORE_VERSION = 1;
export const COLLECTIONS = ['curators', 'pitches', 'placements', 'verifications', 'followups', 'tracks'];
export const MIGRATION_TRIGGER_RECORDS = 10000;

function emptyEnvelope() {
  return { version: STORE_VERSION, records: [] };
}

export class Store {
  constructor(rootDir) {
    this.root = rootDir;
    this.dataDir = join(rootDir, 'data');
    this.receiptsDir = join(rootDir, 'receipts');
  }

  ensureDirs() {
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.receiptsDir, { recursive: true });
  }

  pathFor(collection) {
    if (!COLLECTIONS.includes(collection)) throw new Error(`unknown collection: ${collection}`);
    return join(this.dataDir, `${collection}.json`);
  }

  // Read the full envelope. Missing file -> empty envelope (never an error).
  // A corrupt file IS an error (fail-closed: never silently start over).
  load(collection) {
    const p = this.pathFor(collection);
    if (!existsSync(p)) return emptyEnvelope();
    let raw;
    try {
      raw = readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error(`store read failed for ${collection}: ${e.message}`);
    }
    let env;
    try {
      env = JSON.parse(raw);
    } catch (e) {
      throw new Error(`store CORRUPT: ${p} is not valid JSON (${e.message}). Refusing to proceed.`);
    }
    if (!env || typeof env !== 'object' || !Array.isArray(env.records)) {
      throw new Error(`store CORRUPT: ${p} missing {version, records[]} envelope. Refusing to proceed.`);
    }
    if (env.version !== STORE_VERSION) {
      throw new Error(`store version mismatch: ${p} has version ${env.version}, expected ${STORE_VERSION}.`);
    }
    return env;
  }

  records(collection) {
    return this.load(collection).records;
  }

  find(collection, id) {
    return this.records(collection).find(r => r.id === id) || null;
  }

  // Atomic write: tmp file + fsync + rename. The target is never partially written.
  save(collection, records) {
    if (!Array.isArray(records)) throw new Error('save() requires an array of records');
    if (records.length > MIGRATION_TRIGGER_RECORDS) {
      throw new Error(
        `collection ${collection} passed ${MIGRATION_TRIGGER_RECORDS} records — ` +
        `migration trigger (TRADEOFFS.md T1): migrate to SQLite before writing more.`
      );
    }
    this.ensureDirs();
    const target = this.pathFor(collection);
    const tmp = `${target}.tmp.${process.pid}`;
    const payload = JSON.stringify({ version: STORE_VERSION, records }, null, 2) + '\n';
    try {
      writeFileSync(tmp, payload, 'utf8');
      // Best-effort fsync of the tmp file before rename (durability, not just atomicity).
      try {
        const { openSync, fsyncSync, closeSync } = awaitImportFs();
        const fd = openSync(tmp, 'r');
        fsyncSync(fd);
        closeSync(fd);
      } catch { /* fsync best-effort only */ }
      renameSync(tmp, target); // atomic on POSIX
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
      throw new Error(`store write failed for ${collection}: ${e.message}`);
    }
    return records.length;
  }

  // Append one record (read-modify-write under this process; single-writer assumption
  // per TRADEOFFS.md — cron + operator never write concurrently by design).
  insert(collection, record) {
    const recs = this.records(collection);
    if (recs.some(r => r.id === record.id)) {
      throw new Error(`duplicate id ${record.id} in ${collection}`);
    }
    recs.push(record);
    this.save(collection, recs);
    return record;
  }

  // Replace one record by id.
  update(collection, id, patch) {
    const recs = this.records(collection);
    const i = recs.findIndex(r => r.id === id);
    if (i === -1) throw new Error(`no ${collection} record with id ${id}`);
    recs[i] = { ...recs[i], ...patch };
    this.save(collection, recs);
    return recs[i];
  }

  // Remove orphaned tmp files left by a killed writer (safe: tmps are never read).
  gcTmp() {
    this.ensureDirs();
    let removed = 0;
    for (const f of readdirSync(this.dataDir)) {
      if (f.endsWith('.tmp')) { /* tmp names include pid; only gc stale ones */ }
      if (/\.tmp\.\d+$/.test(f)) {
        try { unlinkSync(join(this.dataDir, f)); removed++; } catch { /* ignore */ }
      }
    }
    return removed;
  }
}

// Tiny indirection so the fsync block above doesn't need top-level await.
import { openSync as _openSync, fsyncSync as _fsyncSync, closeSync as _closeSync } from 'node:fs';
function awaitImportFs() {
  return { openSync: _openSync, fsyncSync: _fsyncSync, closeSync: _closeSync };
}

// ---- id helpers -------------------------------------------------------------
// pch_YYYYMMDD_NNN, plc_YYYYMMDD_NNN, fup_YYYYMMDD_NNN, ver_YYYYMMDDHHMMSS

export function genId(records, prefix, date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = prefix === 'ver'
    ? d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    : ymd;
  let n = 1;
  let id;
  do {
    id = `${prefix}_${stamp}_${String(n).padStart(3, '0')}`;
    n++;
  } while (records.some(r => r.id === id) && n < 10000);
  if (records.some(r => r.id === id)) throw new Error(`id space exhausted for ${prefix}_${stamp}`);
  return id;
}

export function utcNow() {
  return new Date().toISOString();
}

export function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Entry-point guard: importing this module never runs anything.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1]) {
  try {
    if (realpathSync(process.argv[1]) === realpathSync(__filename)) {
      console.error('store.js is a module — use setlist.js, seed.js, or rescan.js.');
      process.exit(2);
    }
  } catch { /* ignore guard failures when argv[1] is odd */ }
}
