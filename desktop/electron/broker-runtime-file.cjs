'use strict';
// Read-only package-file custody. This is a denial-only check, not IO authority.
const fs = require('node:fs');
const {openSync, closeSync, lstatSync, fstatSync, readSync} = fs;
const {createHash} = require('node:crypto');
const rows = new Set();
const verified = new Map();
const keys = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'];
function regular(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw Error('broker_runtime_alias');
  return stat;
}
function same(a, b) { return keys.every(key => a[key] === b[key]); }
function enter(path) {
  if ([...rows].some(row => row.unknown)) assertRuntimeFileReadsKnown();
  const row = {path, entered: true, fd: undefined, unknown: false, failures: []};
  rows.add(row); // Before the original SDK can enter, including no-return failures.
  try {
    const returned=Reflect.apply(openSync, fs, [path, 'r']);
    if(!Number.isInteger(returned)||returned<0){row.unknown=true;row.failures.push({raw:returned});throw Error('broker_runtime_open_result',{cause:returned});}
    row.fd=returned;
  }
  catch (raw) { row.unknown = true; row.failures.push({raw}); throw raw; }
  return row;
}
function sdk(row, fn, args) {
  try { return Reflect.apply(fn, fs, args); }
  catch (raw) { row.unknown = true; row.failures.push({raw}); throw raw; }
}
function finish(row) {
  let failed = false, raw;
  if (row.fd !== undefined) {
    try {
      const returned = Reflect.apply(closeSync, fs, [row.fd]);
      if (returned !== undefined) { failed = true; raw = Error('broker_runtime_close_nonvoid', {cause: returned}); }
    } catch (first) { failed = true; raw = first; }
    if (!failed) row.fd = undefined;
  }
  if (failed) { row.unknown = true; row.failures.push({raw}); throw raw; }
  if (!row.unknown) rows.delete(row);
}
function using(path, fn) {
  const row = enter(path); let firstPresent = false, first, value;
  try { value = fn(row); } catch (raw) { firstPresent = true; first = raw; }
  try { finish(row); } catch (second) {
    if (firstPresent) throw new AggregateError([first, second], 'broker_runtime_read_and_close', {cause: first});
    throw second;
  }
  if (firstPresent) throw first;
  return value;
}
function pathInfo(path) { return regular(Reflect.apply(lstatSync, fs, [path, {bigint: true}])); }
function comparePath(path, opened, initial) {
  const now = pathInfo(path);
  // Node22 on Windows reports dev=0 only in path stats. Obtain the actual
  // device with an independent read handle and retain every BigInt field.
  if (now.dev === 0n) {
    return using(path, row => {
      const probe = regular(sdk(row, fstatSync, [row.fd, {bigint: true}]));
      if (!same(probe, opened) || !same({...now, dev: probe.dev}, opened)) throw Error('broker_runtime_identity');
      if (initial && !same({...initial, dev: probe.dev}, opened)) throw Error('broker_runtime_identity');
      const last = pathInfo(path);
      if (!same(last, now)) throw Error('broker_runtime_identity');
      return probe;
    });
  }
  if (!same(now, opened) || (initial && !same(initial, opened))) throw Error('broker_runtime_identity');
  return now;
}
function readPackageFile(path, limit, expected) {
  const initial = pathInfo(path);
  if (initial.size < 0n || initial.size > BigInt(limit)) throw Error('broker_runtime_file_size');
  return using(path, row => {
    const opened = regular(sdk(row, fstatSync, [row.fd, {bigint: true}]));
    comparePath(path, opened, initial);
    const fingerprint = keys.map(key => String(opened[key])).join(':');
    const cached = expected && verified.get(path);
    if (cached && cached.fingerprint === fingerprint && cached.sha256 === expected.sha256 && cached.size === expected.size) {
      const last = regular(sdk(row, fstatSync, [row.fd, {bigint: true}]));
      if (!same(last, opened)) throw Error('broker_runtime_identity');
      comparePath(path, last);
      return {bytes: null, sha256: cached.sha256, size: cached.size};
    }
    const hash = createHash('sha256'), chunks = expected ? null : [];
    const chunk = Buffer.allocUnsafe(Math.min(limit + 1, 1024 * 1024));
    let count = 0;
    for (;;) {
      const n = sdk(row, readSync, [row.fd, chunk, 0, chunk.length, null]);
      if (!Number.isInteger(n) || n < 0 || n > chunk.length) {row.unknown=true;row.failures.push({raw:n});throw Error('broker_runtime_read_result',{cause:n});}
      if (n === 0) break;
      count += n;
      if (count > limit) throw Error('broker_runtime_file_size');
      hash.update(chunk.subarray(0, n));
      if (chunks) chunks.push(Buffer.from(chunk.subarray(0, n)));
    }
    const after = regular(sdk(row, fstatSync, [row.fd, {bigint: true}]));
    if (BigInt(count) !== opened.size || !same(after, opened)) throw Error('broker_runtime_identity');
    comparePath(path, after);
    const sha256 = hash.digest('hex');
    if (expected && (count !== expected.size || sha256 !== expected.sha256)) throw Error('broker_runtime_digest');
    if (expected) verified.set(path, {fingerprint, sha256, size: count});
    return {bytes: chunks ? Buffer.concat(chunks) : null, sha256, size: count};
  });
}
function assertRuntimeFileReadsKnown() {
  if (rows.size) {
    const failures = [...rows].flatMap(row => row.failures.map(failure => failure.raw));
    // The original FD stays private; failed/unknown custody cannot be cleared
    // through an error value or a later successful read.
    throw new AggregateError(failures, 'broker_runtime_file_custody_unknown', {cause: failures[0]});
  }
}
module.exports = Object.freeze({readPackageFile, assertRuntimeFileReadsKnown});
