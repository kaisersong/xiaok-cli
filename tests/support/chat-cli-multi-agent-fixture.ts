import assert from 'node:assert/strict';
import {execFile,spawnSync} from 'node:child_process';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import type {OpenAIToolProtocolMessage} from './openai-tool-protocol.js';

const execFileAsync=promisify(execFile);
const selectedEntry=process.env.XIAOK_MULTI_AGENT_E2E_CLI_ENTRY;
const cliEntryPath=selectedEntry??join(process.cwd(),'.test-dist','src','index.js');
const childSetup=join(process.cwd(),'tests','support','profile-account-child.setup.mjs');

export type ProviderRequest = {
  messages?: OpenAIToolProtocolMessage[];
  tools?: Array<{ function?: { name?: string } }>;
};

export type ProviderEvent = Record<string, unknown>;

export function canSpawnChildProcesses(): boolean {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'pipe' });
  return !result.error && result.status === 0;
}

export function writeConfig(configDir: string, baseUrl: string): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    schemaVersion: 1,
    defaultModel: 'custom',
    models: {
      custom: {
        baseUrl,
        apiKey: 'test-key',
        model: 'gpt-multi-agent-e2e',
      },
    },
    defaultMode: 'interactive',
    contextBudget: 8_000,
    channels: {},
  }, null, 2), 'utf8');
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export function toolCallEvents(name: string, input: Record<string, unknown>, callId: string): ProviderEvent[] {
  return toolBatchEvents([{ name, input, callId }]);
}

export function toolBatchEvents(calls: Array<{ name: string; input: Record<string, unknown>; callId: string }>): ProviderEvent[] {
  return [
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: calls.map((call, index) => ({ index, id: call.callId, function: { name: call.name, arguments: '' } })),
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        index: 0,
        delta: {
          tool_calls: calls.map((call, index) => ({ index, function: { arguments: JSON.stringify(call.input) } })),
        },
        finish_reason: null,
      }],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
}

export function textEvents(text: string): ProviderEvent[] {
  return [
    { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
}

export function sendEvents(res: ServerResponse, events: ProviderEvent[]): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'close',
  });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

export function requestText(request: ProviderRequest): string {
  return JSON.stringify(request.messages ?? []);
}

export function lastMessage(request: ProviderRequest): OpenAIToolProtocolMessage | undefined {
  return request.messages?.at(-1);
}

export function parseLastToolResult(request: ProviderRequest): Record<string, unknown> {
  const message = lastMessage(request);
  if (message?.role !== 'tool' || typeof message.content !== 'string') return {};
  try {
    return JSON.parse(message.content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function toolNames(request: ProviderRequest): string[] {
  return (request.tools ?? [])
    .map((tool) => tool.function?.name)
    .filter((name): name is string => typeof name === 'string');
}

export function spawnedAgentId(request: ProviderRequest, taskName: string): string {
  for (const message of request.messages ?? []) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue;
    try {
      const result = JSON.parse(message.content);
      if (result.taskName === taskName) return result.id;
    } catch { /* Other tools may return plain text. */ }
  }
  return '';
}

export function createCliWorkspace(prefix:string,tempDirs:string[]){
  const rootDir=realpathSync(mkdtempSync(join(tmpdir(),prefix)));
  tempDirs.push(rootDir);
  const configDir=join(rootDir,'config'),homeDir=join(rootDir,'home'),projectDir=join(rootDir,'project');
  mkdirSync(homeDir,{recursive:true});mkdirSync(projectDir,{recursive:true});
  return {configDir,homeDir,projectDir};
}

export async function listenProvider(server:Server,reason='missing local address'):Promise<string>{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error(reason);
  return `http://127.0.0.1:${address.port}/v1`;
}

type FixtureCliInput={projectDir:string;homeDir:string;configDir:string;prompt:string;timeout:number;
  limits?:Pick<NodeJS.ProcessEnv,'XIAOK_MAX_AGENT_THREADS'|'XIAOK_SUBAGENT_IDLE_TIMEOUT_MS'|'XIAOK_SUBAGENT_TURN_TIMEOUT_MS'>};
export function runFixtureCli(input:FixtureCliInput){
  return execFileAsync(process.execPath,['--import',childSetup,cliEntryPath,'chat','--auto','--json',input.prompt],{
    cwd:input.projectDir,
    env:{...process.env,HOME:input.homeDir,USERPROFILE:input.homeDir,XIAOK_CONFIG_DIR:input.configDir,XIAOK_TEST_ACCOUNT_HOME:input.homeDir,...input.limits},
    timeout:input.timeout,
  });
}

function builtMetadataPath():string{
  if(!selectedEntry)return join(process.cwd(),'.test-dist','package.json');
  for(let directory=dirname(resolve(cliEntryPath));;directory=dirname(directory)){
    const candidate=join(directory,'package.json');
    if(existsSync(candidate))return candidate;
    if(dirname(directory)===directory)throw new Error('CLI fixture build metadata missing');
  }
}

/** Read only: never synthesize or restore shared build metadata. */
export function captureCliBuildMetadata():()=>void{
  const path=builtMetadataPath();
  assert.ok(existsSync(path),'Run npm run test:sandbox:build before the CLI fixture');
  const before=statSync(path,{bigint:true}),bytes=readFileSync(path),metadata=JSON.parse(bytes.toString('utf8'));
  const source=JSON.parse(readFileSync(join(process.cwd(),'package.json'),'utf8'));
  assert.equal(metadata.version,source.version,'CLI fixture requires actual current build metadata; run test:sandbox:build');
  assert.equal(metadata.type,'module');
  assert.equal(statSync(path,{bigint:true}).mtimeNs,before.mtimeNs,'CLI build metadata changed during capture');
  return ()=>{
    assert.deepEqual(readFileSync(path),bytes,'CLI fixture must not change build metadata bytes');
    assert.equal(statSync(path,{bigint:true}).mtimeNs,before.mtimeNs,'CLI fixture must not rewrite build metadata');
  };
}
