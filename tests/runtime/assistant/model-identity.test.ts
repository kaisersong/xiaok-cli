import {spawnSync} from 'node:child_process';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readAssistantModelConfiguration,readAssistantModelIdentity} from '../../../src/runtime/assistant/model-identity.js';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function config(){const root=mkdtempSync(join(tmpdir(),'assistant-model-identity-'));roots.push(root);vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','env-key-a-secret');vi.stubEnv('DEEPSEEK_API_KEY','lower-priority-secret');const file=join(root,'config.json');writeFileSync(file,JSON.stringify({schemaVersion:2,defaultModelId:'selected',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'config-key-secret',headers:{'x-private':'header-secret'}}},models:{selected:{provider:'deepseek',model:'deepseek-flash'}}}),{mode:0o600});return file;}
describe('effective assistant model identity',()=>{
 it('changes on effective environment key rotation without any config file change',()=>{
  const file=config(),bytes=readFileSync(file),first=readAssistantModelIdentity();
  vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','env-key-b-secret');const changed=readAssistantModelIdentity();
  expect(changed.modelEpoch).toBe(first.modelEpoch);expect(changed.configFingerprint).not.toBe(first.configFingerprint);expect(readFileSync(file)).toEqual(bytes);
  vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','env-key-a-secret');expect(readAssistantModelIdentity()).toEqual(first);
 });
 it('keeps identical effective identity stable and ignores shadowed credential changes',()=>{
  const file=config(),before=statSync(file),first=readAssistantModelIdentity();
  vi.stubEnv('DEEPSEEK_API_KEY','different-shadowed-secret');expect(readAssistantModelIdentity()).toEqual(first);
  expect(readAssistantModelConfiguration().identity).toEqual(first);const after=statSync(file);expect(after.mtimeMs).toBe(before.mtimeMs);expect(after.mode).toBe(before.mode);
 });
 it('includes environment endpoint and custom provider credentials in the whole fingerprint',()=>{
  const file=config(),raw=JSON.parse(readFileSync(file,'utf8'));raw.providers.anthropic={type:'first_party',protocol:'anthropic',apiKey:'anthropic-secret'};raw.providers['custom-gate']={type:'custom',protocol:'openai_legacy',baseUrl:'https://example.invalid/v1',apiKey:'custom-config-secret'};writeFileSync(file,JSON.stringify(raw));
  vi.stubEnv('ANTHROPIC_BASE_URL','https://first.invalid');vi.stubEnv('XIAOK_CUSTOM_GATE_API_KEY','custom-env-a-secret');const first=readAssistantModelIdentity();
  vi.stubEnv('ANTHROPIC_BASE_URL','https://second.invalid');const endpoint=readAssistantModelIdentity();expect(endpoint.configFingerprint).not.toBe(first.configFingerprint);
  vi.stubEnv('XIAOK_CUSTOM_GATE_API_KEY','custom-env-b-secret');expect(readAssistantModelIdentity().configFingerprint).not.toBe(endpoint.configFingerprint);
 });
 it('exports only a single combined fingerprint, and sanitizes errors without JSON/key excerpts',()=>{
  const file=config(),identity=readAssistantModelIdentity();expect(Object.keys(identity).sort()).toEqual(['configFingerprint','modelEpoch']);expect(JSON.stringify(identity)).not.toContain('secret');expect(identity.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
  writeFileSync(file,'{"apiKey":"sensitive-malformed-secret", broken');
  try{readAssistantModelIdentity();expect.unreachable();}catch(error){expect((error as Error).message).toBe('assistant_model_configuration_unavailable');expect(String(error)).not.toContain('sensitive-malformed-secret');expect(String(error)).not.toContain(file);}
 });
 it('resolves stable identities in fresh OS processes and notices an environment-only rotation',()=>{
  config();const expected=readAssistantModelIdentity();let moduleUrl=new URL('../../../src/runtime/assistant/model-identity.js',import.meta.url);let loader:string[]=[];
  if(!existsSync(moduleUrl)){moduleUrl=new URL('../../../src/runtime/assistant/model-identity.ts',import.meta.url);loader=['--import','tsx'];}
  const script=`import {readAssistantModelIdentity} from ${JSON.stringify(moduleUrl.href)};process.stdout.write(JSON.stringify(readAssistantModelIdentity()));`;
  const child=(key:string)=>{const result=spawnSync(process.execPath,[...loader,'--input-type=module','-e',script],{env:{...process.env,XIAOK_DEEPSEEK_API_KEY:key},encoding:'utf8',timeout:15000,maxBuffer:65536});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout).not.toContain('secret');return JSON.parse(result.stdout);};
  expect(child('env-key-a-secret')).toEqual(expected);expect(child('env-key-b-secret').configFingerprint).not.toBe(expected.configFingerprint);expect(child('env-key-a-secret')).toEqual(expected);
 });

});
