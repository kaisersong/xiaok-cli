import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { types } from 'node:util';
import { getConfigPath } from '../../src/utils/config.js';
import { DEFAULT_CONFIG, isValidLegacyProvider, type Config, type LegacyConfig } from '../../src/types.js';
import { normalizeConfig } from '../../src/ai/providers/normalize.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { STORED_CHANNELS_READONLY_SCHEMA, CHANNEL_READONLY_OUTPUT_SCHEMA, MCP_INSTALLS_READONLY_OUTPUT_SCHEMA } from '../shared/channel-mcp-readonly-ipc-contract.js';
function readJson(path: string): unknown | undefined {
  let raw: string;
  try { raw=readFileSync(path,'utf8'); }
  catch(error) { if(error && typeof error==='object' && !types.isProxy(error) && Object.getOwnPropertyDescriptor(error,'code')?.value==='ENOENT')return undefined;throw error; }
  return captureIpcData(JSON.parse(raw),'channel_mcp_projection_unavailable',{preserveDataPrototype:true});
}
export function readChannelViews() {
  const raw=readJson(getConfigPath());
  let config: Config;
  if(raw===undefined) config=JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  else {
    if(!raw || typeof raw!=='object' || Array.isArray(raw))throw Error('channel_mcp_projection_unavailable');
    const obj=raw as Record<string,unknown>;
    if(obj.schemaVersion!==1 && obj.schemaVersion!==2)throw Error('channel_mcp_projection_unavailable');
    if(obj.schemaVersion===1 && obj.defaultModel!==undefined && !isValidLegacyProvider(obj.defaultModel))throw Error('channel_mcp_projection_unavailable');
    if(obj.channels!==undefined && obj.channels!==null && !STORED_CHANNELS_READONLY_SCHEMA.safeParse(obj.channels).success)throw Error('channel_mcp_projection_unavailable');
    config=normalizeConfig(obj as unknown as LegacyConfig|Config);
  }
  const channels=captureIpcData(config.channels ?? {},'channel_mcp_projection_unavailable',{preserveDataPrototype:true});
  const parsed=STORED_CHANNELS_READONLY_SCHEMA.safeParse(channels);
  if(!parsed.success)throw Error('channel_mcp_projection_unavailable');
  const rows=Object.entries(parsed.data).map(([key,c])=>({id:key,type:key,name:c.name||key,webhookUrl:c.webhookUrl||c.sendMsgUrl,enabled:c.enabled!==false,createdAt:0,updatedAt:0}));
  if(!CHANNEL_READONLY_OUTPUT_SCHEMA.safeParse(rows).success)throw Error('channel_mcp_projection_unavailable');
  return rows;
}
export function readMcpInstallViews(dataRoot: string) {
  const raw=readJson(join(dataRoot,'mcp-installs.json'));
  const rows=raw===undefined?[]:raw;
  const parsed=MCP_INSTALLS_READONLY_OUTPUT_SCHEMA.safeParse(rows);
  if(!parsed.success)throw Error('channel_mcp_projection_unavailable');
  return parsed.data;
}
