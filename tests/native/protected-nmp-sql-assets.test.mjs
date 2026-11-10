import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getProtectedNmpSqlFixtureAssets,PROTECTED_NMP_SQL_FINITE_FACTS_HEADER} from './helpers/protected-nmp-sql-assets.mjs';
test('protected NMP fragment exposes only a prepare asset and refuses accidental Node SDK execution',()=>{
 const assets=getProtectedNmpSqlFixtureAssets(); assert.ok(Object.isFrozen(assets));
 assert.equal(createHash('sha256').update(readFileSync(assets.fragment)).digest('hex'),assets.fragmentSha256);
 assert.equal(assets.finiteHeader,PROTECTED_NMP_SQL_FINITE_FACTS_HEADER);
 assert.match(assets.finiteHeader,/#define NR_FIXTURE_FACT_COUNT 0\n$/);
 assert.equal(assets.finiteHeader.includes('fixtureSubject('),false);
 const {runProtectedNmpSqlFixture}=createRequire(import.meta.url)(assets.fragment);
 assert.equal(typeof runProtectedNmpSqlFixture,'function'); let traps=0;
 const foreign=new Proxy({},{get(){traps++;throw Error('unexpected SDK');}});
 assert.throws(()=>runProtectedNmpSqlFixture(foreign,foreign,'fresh','unused'),/ACTUAL_MAIN_REQUIRED/);
 assert.equal(traps,0);
});
