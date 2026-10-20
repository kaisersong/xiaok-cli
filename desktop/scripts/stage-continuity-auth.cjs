#!/usr/bin/env node
// Stages the pinned AuthOwner native binary (restriction
// xiaok-auth-owner-v1, sha256 5319f2e0...) into the packaged-resources
// staging area. Refuses any byte-mismatched source; the packaged file is
// verified again by verify-packaged-continuity-resources.cjs.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const PINNED_SHA256='5319f2e03161415f75a88ccf251fc43fbc9a86c62481e2f8430f6b831cd54c6c';
const source=process.argv[2]||process.env.XIAOK_AUTH_OWNER_BINARY_SOURCE;
if(!source||!path.isAbsolute(source))throw new Error('usage: stage-continuity-auth.cjs <absolute-source-binary>');
const stats=fs.lstatSync(source);
if(stats.isSymbolicLink()||!stats.isFile()||path.basename(source)!=='codex-app-server')throw new Error('auth_owner_binary_unqualified');
const sha256=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
if(sha256!==PINNED_SHA256)throw new Error('auth_owner_binary_unqualified');
const target=path.join(__dirname,'..','resources','continuity-auth','darwin-arm64','codex-app-server');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.copyFileSync(source,target);
fs.chmodSync(target,0o755);
const staged=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
if(staged!==PINNED_SHA256)throw new Error('auth_owner_stage_mismatch');
console.log(JSON.stringify({staged:target,sha256:staged}));
