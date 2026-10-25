// Fixture-only explicit consent through the existing public project-rule UI.
// The original CLI scenarios still run their real dist/index.js entry afterward.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [publicUiPath, expectedJson] = process.argv.slice(2);
const expected = JSON.parse(expectedJson);
assert.ok(Array.isArray(expected) && expected.length === 3 && expected.every(rule => typeof rule === 'string'));
const publicUiUrl = pathToFileURL(resolve(publicUiPath));
const { promptPendingProjectRules } = await import(publicUiUrl.href);
const { listPendingProjectRules, loadSettings } = await import(new URL('../ai/permissions/settings.js', publicUiUrl).href);
const cwd = process.cwd();
assert.deepEqual(await listPendingProjectRules(cwd), expected);
await promptPendingProjectRules(cwd);
assert.deepEqual(await listPendingProjectRules(cwd), []);
assert.deepEqual((await loadSettings(cwd)).approvedProjectAllow, expected);
console.log('E2E_FIXTURE_PROJECT_RULE_CONSENT_VERIFIED');
