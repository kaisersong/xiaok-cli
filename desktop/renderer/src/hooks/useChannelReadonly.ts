import { api } from '../api';
import { useDesktopReadonly } from './useSkillReadonly';
import { CHANNEL_READONLY_OUTPUT_SCHEMA } from '../../../shared/channel-mcp-readonly-ipc-contract';
const readChannels=()=>api.listChannels();
export function useChannelReadonly(){return useDesktopReadonly(readChannels,CHANNEL_READONLY_OUTPUT_SCHEMA,false);}
