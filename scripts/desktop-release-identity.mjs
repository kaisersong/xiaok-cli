#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OWNER = 'kaisersong';
const NAME = 'xiaok-cli';
const REPO = OWNER + '/' + NAME;
const ENDPOINT = 'repos/' + REPO + '/releases/tags/';
const GRAPHQL_QUERY = 'query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){tagName,isDraft,isPrerelease}}}';
const fullSHA = /^[a-f0-9]{40}$/;
const tagPattern = /^desktop-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function fail(code) { throw new Error(code); }
function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GITHUB_REPOSITORY: REPO }, maxBuffer: 4 * 1024 * 1024, shell: false });
  if (result.error || result.signal) fail('release_command_unconfirmed');
  return result;
}
function git(args) {
  const result = command('git', args);
  if (result.status !== 0) fail('release_git_' + args[0] + '_failed');
  return result.stdout.trim();
}
function inputs(resolve = false) {
  const tag = process.env.RELEASE_TAG;
  if (typeof tag !== 'string' || !tagPattern.test(tag)) fail('release_tag_invalid');
  const version = tag.slice('desktop-v'.length), expected = process.env.RELEASE_SHA;
  if (!resolve && (typeof expected !== 'string' || !fullSHA.test(expected))) fail('release_sha_required');
  return { tag, version, expected };
}
export function parseRemoteTag(text, tag, expected) {
  const ref = 'refs/tags/' + tag, rows = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match || ![ref, ref + '^{}'].includes(match[2]) || rows.has(match[2])) fail('release_remote_tag_unconfirmed');
    rows.set(match[2], match[1]);
  }
  if (!rows.has(ref) || (rows.get(ref + '^{}') ?? rows.get(ref)) !== expected) fail('release_remote_tag_changed');
}
function freshRemote(tag, expected) {
  const ref = 'refs/tags/' + tag;
  const result = command('git', ['ls-remote', '--quiet', '--exit-code', 'origin', ref, ref + '^{}']);
  if (result.status !== 0) fail('release_remote_tag_unavailable');
  parseRemoteTag(result.stdout, tag, expected);
}
export function assertReleaseIdentity(resolve = false) {
  const input = inputs(resolve);
  const sha = resolve ? git(['rev-parse', '--verify', 'refs/tags/' + input.tag + '^{commit}']) : input.expected;
  if (!fullSHA.test(sha) || git(['rev-parse', '--verify', 'HEAD']) !== sha) fail('release_head_mismatch');
  for (const path of ['package.json', join('desktop', 'package.json')]) {
    let data; try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('release_package_unconfirmed'); }
    if (data.version !== input.version) fail('release_version_mismatch');
  }
  git(['fetch', '--quiet', '--no-tags', 'origin', 'master']);
  if (command('git', ['merge-base', '--is-ancestor', sha, 'FETCH_HEAD']).status !== 0) fail('release_not_master_ancestor');
  freshRemote(input.tag, sha);
  return { tag: input.tag, version: input.version, sha };
}
function parseHttpResponse(result) {
  let response;
  for (const stream of [result.stdout, result.stderr]) {
    if ([...(stream ?? '').matchAll(/^HTTP\/[^\s]+\s+[0-9]{3}[^\r\n]*\r?\n/gm)].length > 1) fail('release_api_ambiguous');
    const match = /^HTTP\/[^\s]+\s+([0-9]{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/m.exec(stream ?? '');
    if (!match) continue;
    if (response) fail('release_api_ambiguous');
    response = { status: Number(match[1]), body: match[2] };
  }
  if (!response) fail('release_api_status_unconfirmed');
  return response;
}
// A 404 must be an actual HTTP response. Authentication/network/parser errors never mean "absent".
export function parseReleaseResponse(result) {
  const response = parseHttpResponse(result);
  if (response.status === 404 && result.status !== 0) return null;
  if (response.status !== 200 || result.status !== 0) fail('release_api_failed');
  let value; try { value = JSON.parse(response.body); } catch { fail('release_api_json_unconfirmed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.tag_name !== 'string'
    || typeof value.draft !== 'boolean' || typeof value.prerelease !== 'boolean') fail('release_api_shape_unconfirmed');
  return value;
}
export function parseGraphqlReleaseResponse(result) {
  const response = parseHttpResponse(result);
  if (response.status !== 200 || result.status !== 0) fail('release_api_failed');
  let payload; try { payload = JSON.parse(response.body); } catch { fail('release_api_json_unconfirmed'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('release_api_shape_unconfirmed');
  if (Array.isArray(payload.errors) && payload.errors.length > 0) fail('release_api_failed');
  const repo = payload.data?.repository;
  if (!repo || typeof repo !== 'object' || Array.isArray(repo) || !Object.hasOwn(repo, 'release')) fail('release_api_shape_unconfirmed');
  if (repo.release === null) return null;
  const rel = repo.release;
  if (!rel || typeof rel !== 'object' || Array.isArray(rel) || typeof rel.tagName !== 'string'
    || typeof rel.isDraft !== 'boolean' || typeof rel.isPrerelease !== 'boolean') fail('release_api_shape_unconfirmed');
  return { tag_name: rel.tagName, draft: rel.isDraft, prerelease: rel.isPrerelease };
}
function releaseState(tag) {
  const file = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const direct = parseReleaseResponse(command(file, ['api', '--hostname', 'github.com', '--include', '--method', 'GET', ENDPOINT + encodeURIComponent(tag)]));
  if (direct !== null) return direct;
  // GitHub /releases/tags/{tag} returns 404 for drafts, and /releases carries s-maxage=60; POST /graphql is uncached and sees drafts by tag.
  return parseGraphqlReleaseResponse(command(file, [
    'api', '--hostname', 'github.com', '--include', '--method', 'POST', 'graphql',
    '-f', 'query=' + GRAPHQL_QUERY,
    '-f', 'owner=' + OWNER,
    '-f', 'name=' + NAME,
    '-f', 'tag=' + tag,
  ]));
}
function assertDraft(tag, release) {
  if (!release || release.tag_name !== tag || release.draft !== true || release.prerelease !== false) fail('release_draft_required');
}
function gh(args) {
  const file = process.platform === 'win32' ? 'gh.exe' : 'gh';
  if (command(file, [...args, '--repo', REPO]).status !== 0) fail('release_gh_' + args[1] + '_failed');
}
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function draft(identity) {
  const found = releaseState(identity.tag);
  if (found !== null) { assertDraft(identity.tag, found); return; }
  // Recheck before the only create mutation. Never allow gh to create a new tag.
  freshRemote(identity.tag, identity.sha);
  gh(['release', 'create', identity.tag, '--title', 'Xiaok CLI & Desktop ' + identity.version,
    '--generate-notes', '--draft', '--latest=false', '--verify-tag', '--target', identity.sha]);
  let created = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    created = releaseState(identity.tag);
    if (created !== null) break;
    if (attempt < 4) sleepMs(1000);
  }
  assertDraft(identity.tag, created);
}
function assets(identity, platform) {
  const directory = join('desktop', 'release');
  const expected = platform === 'mac'
    ? [`xiaok-${identity.version}-arm64.dmg`, `xiaok-${identity.version}-arm64-mac.zip`, 'latest-mac.yml']
    : [`xiaok-setup-${identity.version}.exe`, 'latest.yml'];
  const selected = readdirSync(directory).filter(name => platform === 'mac'
    ? name.endsWith('.dmg') || name.endsWith('-mac.zip') || name === 'latest-mac.yml'
    : name.endsWith('.exe') || name === 'latest.yml');
  if (selected.length !== expected.length || expected.some(name => !selected.includes(name))) fail('release_assets_version_mismatch');
  return expected.map(name => {
    const path = join(directory, name), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('release_asset_unconfirmed');
    return path;
  });
}
export function runReleaseGate(action) {
  if (!['resolve', 'check', 'draft', 'upload-mac', 'upload-windows', 'verify-draft'].includes(action)) fail('release_action_invalid');
  const identity = assertReleaseIdentity(action === 'resolve');
  if (action === 'resolve') {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'sha=' + identity.sha + '\n');
  } else if (action === 'draft') draft(identity);
  else if (action.startsWith('upload-')) {
    const files = assets(identity, action === 'upload-mac' ? 'mac' : 'windows');
    freshRemote(identity.tag, identity.sha); assertDraft(identity.tag, releaseState(identity.tag));
    gh(['release', 'upload', identity.tag, ...files, '--clobber']);
    try { freshRemote(identity.tag, identity.sha); assertDraft(identity.tag, releaseState(identity.tag)); }
    catch (error) { console.error('[release-identity] upload may already have completed; post-upload checks failed; no rollback performed'); throw error; }
  } else if (action === 'verify-draft') {
    assertDraft(identity.tag, releaseState(identity.tag));
    const verifier = fileURLToPath(new URL('./verify-desktop-release.mjs', import.meta.url));
    const checked = command(process.execPath, [verifier, identity.tag, '--prepublish']);
    if (checked.stdout) process.stdout.write(checked.stdout);
    if (checked.stderr) process.stderr.write(checked.stderr);
    if (checked.status !== 0) fail('release_assets_verification_failed');
    freshRemote(identity.tag, identity.sha); assertDraft(identity.tag, releaseState(identity.tag));
    console.info('Draft asset checks complete. Formal installer smoke and written quality approval are still required before manual promotion; run the original published verifier afterwards.');
  }
  return identity;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { console.log(JSON.stringify(runReleaseGate(process.argv[2]))); }
  catch (error) { console.error('[release-identity] ' + (error instanceof Error ? error.message : 'release_unknown_failure')); process.exitCode = 1; }
}
