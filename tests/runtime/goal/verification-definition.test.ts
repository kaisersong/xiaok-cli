import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
import { parseGoalVerificationDefinition, goalVerificationRegistration, assertGoalVerificationExtension } from '../../../src/runtime/goal/verification-definition.js';

function definition() {
  return { version: 1, obligations: [{ obligationId: 'original', predicateId: 'exact-artifact', predicateVersion: '1', semantics: 'current-subject',
    recipe: { kind: 'artifact-content', checks: [{ id: 'original-content', path: 'result.txt', sha256: 'a'.repeat(64), structure: 'utf8' }] } }] };
}
it('binds explicit original criteria through the production independent recipe parser without deriving expected answers from output', () => {
  const raw = definition(), parsed = parseGoalVerificationDefinition(raw), registration = goalVerificationRegistration(parsed);
  expect(registration).toEqual({ migrationEpoch: 1, source: { kind: 'new-owner' }, obligations: [{
    obligation: { obligationId: 'original', predicateId: 'exact-artifact', predicateVersion: '1', semantics: 'current-subject',
      definitionHash: createHash('sha256').update(json(raw.obligations[0].recipe)).digest('hex'), requiredCheckIds: ['original-content'] },
    recipe: raw.obligations[0].recipe,
  }] });
  raw.obligations[0].recipe.checks[0].sha256 = 'b'.repeat(64);
  expect(registration.obligations[0].recipe).toEqual(parsed.obligations[0].recipe);
  expect(Object.isFrozen(parsed.obligations[0].recipe)).toBe(true);
  expect(Object.isFrozen(registration.obligations[0].obligation.requiredCheckIds)).toBe(true);
  expect(Object.isFrozen(registration.source)).toBe(true);
});
it('rejects absent, inferred, extra, duplicate, oversized or malformed definitions', () => {
  const input = definition();
  for (const value of [undefined, {}, {version:1,obligations:[]}, {...input,approved:true},
    {...input,obligations:[...input.obligations,...input.obligations]},
    {...input,obligations:[{...input.obligations[0],definitionHash:'a'.repeat(64)}]},
    {...input,obligations:[{...input.obligations[0],semantics:'model-says-complete'}]},
    {...input,obligations:[{...input.obligations[0],obligationId:'   '}]},
    {...input,obligations:[{...input.obligations[0],recipe:{kind:'artifact-content',checks:[{...input.obligations[0].recipe.checks[0],sha256:'derive-from-output'}]}}]},
    {...input,obligations:Array.from({length:257},(_,i)=>({...input.obligations[0],obligationId:`o-${i}`}))},
    {...input,obligations:Array.from({length:120},(_,i)=>({...input.obligations[0],obligationId:`o-${i}`,predicateId:'中'.repeat(100)}))},
  ]) expect(() => parseGoalVerificationDefinition(value)).toThrow();
  let reads=0;expect(()=>parseGoalVerificationDefinition({version:1,get obligations(){reads++;return input.obligations;}})).toThrow();expect(reads).toBe(0);
});
it('supports all existing independent recipe types with unchanged original expected inputs', () => {
  for(const recipe of [
    {kind:'blackbox',cases:[{id:'case',inputBase64:'aW5wdXQ=',expectedOutputBase64:'b3JpZ2luYWw=',sideEffects:[]}]},
    {kind:'diagnostic-coverage',checkId:'all-original-errors',sourceRunId:'original-run',runNonce:'original-nonce',archiveHash:'a'.repeat(64),diagnosisPath:'diagnosis.json',sourceScope:'protected-execution-run'},
  ]) {
    const parsed=parseGoalVerificationDefinition({...definition(),obligations:[{...definition().obligations[0],semantics:'specific-run',recipe}]});
    expect(goalVerificationRegistration(parsed).obligations[0].recipe).toEqual(recipe);
  }
});
it('allows identical or append-only replacement and refuses removal, reorder, weaker definitions or changed semantics', () => {
  const before=definition(), extra={...structuredClone(before.obligations[0]),obligationId:'additional'};
  const extended={version:1,obligations:[...before.obligations,extra]};
  expect(()=>assertGoalVerificationExtension(before,before)).not.toThrow();
  expect(()=>assertGoalVerificationExtension(before,extended)).not.toThrow();
  const changed=definition();changed.obligations[0].recipe.checks[0].sha256='b'.repeat(64);
  for(const [prior,next] of [[before,changed],[extended,before],[extended,{version:1,obligations:[extra,...before.obligations]}],
    [before,{...before,obligations:[{...before.obligations[0],semantics:'cumulative'}]}]])
    expect(()=>assertGoalVerificationExtension(prior,next)).toThrow();
});

it('counts the ASCII-escaped native registration including derived hashes rather than raw definition bytes only',()=>{
 const raw={...definition(),obligations:Array.from({length:100},(_,i)=>({...definition().obligations[0],obligationId:`o-${i}`,predicateId:'中'.repeat(40)}))};
 expect(Buffer.byteLength(json(raw))).toBeLessThan(65536);
 expect(()=>parseGoalVerificationDefinition(raw)).toThrow('goal_verification_definition_limit');
});
