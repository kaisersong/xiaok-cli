import {describe,it,expect} from 'vitest';
import {parseEgressProvisionBundle} from '../../../src/runtime/verification/deployment-egress-provision.js';

const proposal=()=>({version:1,targets:[{destination:'https://example.com/v1/chat/completions',model:'model',protocol:'generic-openai',headers:{'content-type':'application/json'},credentialId:'primary'}],credentials:{primary:{authorization:'Bearer local-test-only'}}});
describe('initial egress provision input',()=>{
 it('splits explicit nonsecret targets from credentials without granting execution',()=>{
  const input=proposal(),parsed=parseEgressProvisionBundle(input);
  expect(parsed.targets).toEqual({version:1,targets:input.targets});
  expect(parsed.credentials).toEqual(input.credentials);
  expect(JSON.stringify(parsed.targets)).not.toContain('local-test-only');
  expect(Object.isFrozen(parsed.targets.targets[0])).toBe(true);
  input.credentials.primary.authorization='changed';
  expect(parsed.credentials.primary.authorization).toBe('Bearer local-test-only');
 });
 it('rejects unknown or unreferenced credentials and duplicate destinations',()=>{
  const missing=proposal();missing.targets[0].credentialId='unknown';
  expect(()=>parseEgressProvisionBundle(missing)).toThrow();
  const extra=proposal();Object.assign(extra.credentials,{unused:{authorization:'secret'}});
  expect(()=>parseEgressProvisionBundle(extra)).toThrow();
  const duplicate=proposal();duplicate.targets.push(structuredClone(duplicate.targets[0]));
  expect(()=>parseEgressProvisionBundle(duplicate)).toThrow();
 });
 it('rejects header injection, secret overrides and non HTTPS destinations',()=>{
  const injected=proposal();injected.credentials.primary.authorization='Bearer value\r\nx-injected: yes';
  expect(()=>parseEgressProvisionBundle(injected)).toThrow();
  const override=proposal();Object.assign(override.targets[0].headers,{Authorization:'public'});
  expect(()=>parseEgressProvisionBundle(override)).toThrow();
  for(const destination of ['http://example.com','https://name:password@example.com','https://example.com/#secret']){
   const value=proposal();value.targets[0].destination=destination;
   expect(()=>parseEgressProvisionBundle(value)).toThrow();
  }
 });
 it('rejects excess fields and actual serialized file limits',()=>{
  expect(()=>parseEgressProvisionBundle({...proposal(),requestSource:'agent'})).toThrow();
  const large=proposal();large.credentials.primary.authorization='x'.repeat(65536);
  expect(()=>parseEgressProvisionBundle(large)).toThrow();
 });
});
