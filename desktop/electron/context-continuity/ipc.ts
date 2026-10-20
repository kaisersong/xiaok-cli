import { legacyPreviewInput, legacyClaimInput, legacyDisplayMetadata,type LegacyContinuityImporter } from './legacy.js';
import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHandleRegistrar } from '../shutdown-aware-ipc-main.js';
import { registerIpcHandler } from '../ipc-runtime.js';
import { CONTINUITY_CHANNELS as channels } from '../../shared/context-continuity-types.js';
import { ContinuityService, type ContinuityActor } from './service.js';
import type { ContinuityMcpController } from './mcp-control.js';
import { historySearchInput } from './history-search.js';
import type { CliArchiveImporter } from './cli-archive.js';

const key = z.string().min(1).max(256), revision = z.number().int().nonnegative();
const refId = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const conversation = z.object({
  id: key, title: z.string().max(1024).nullable(), status: z.enum(['idle','running','completed','failed']), mode: z.enum(['chat','work']),
  createdAt: z.number().finite(), updatedAt: z.number().finite(), starred: z.boolean(), gtdBucket: z.enum(['inbox','todo','waiting','someday','archived']).nullable(),
  pinnedAt: z.number().nullable(), currentTaskId: key.nullable(), taskIds: z.array(key), revision, coverage: z.enum(['complete','partial','unclaimed']), sidebar_work_folder: z.string().nullable().optional(),
}).strict();
const message = z.object({ messageId: key, revision, sequence: z.number().int().positive(), role: z.enum(['user','assistant','tool_summary']), text: z.string(), contentHash: key,
  sourceKind: z.enum(['desktop_task','cli_session','native_codex','room']), sourceId: key, sourceMessageId: key, observedAt: z.number().finite(), executionState: z.enum(['pending','settled','unknown']), visibilityBasis: z.literal('user_claimed_archive').optional(), truncated: z.boolean().optional() }).strict();
const reference = z.object({ refId, url: z.string(), conversationId: key, snapshotRevision: revision, contentHash: key }).strict();

/** Renderer-facing AuthOwner intents. The projection is deliberately
 * token-free: any credential bytes stay inside the main-process controller. */
export interface AuthOwnerIpcTarget {
  status(): Promise<{state:'logged_out'|'logging_in'|'logged_in';account?:{accountId?:string}}>;
  startLogin(): Promise<{authUrl:string;loginId:string}>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
}
export interface ContinuityIpcPort { service: ContinuityService; actor: ContinuityActor; importer?: LegacyContinuityImporter; cliArchive?:CliArchiveImporter; refresh?: () => Promise<void>; mcp?: ContinuityMcpController; authOwner?: AuthOwnerIpcTarget }
export function registerContextContinuityIpc(registrar: IpcHandleRegistrar, port: ContinuityIpcPort | null | (() => ContinuityIpcPort), authorize: (event: IpcMainInvokeEvent) => boolean): void {
  const trusted = (event: IpcMainInvokeEvent) => {
    if (!authorize(event)) throw new Error('not_readable');
    const current = typeof port === 'function' ? port() : port;
    if (!current) throw new Error('continuity_unavailable');
    current.service.assertActor(current.actor, true); return current;
  };
  const register = <I, O>(channel: string, input: z.ZodType<I>, output: z.ZodType<O>, handler: (value: I, port: ContinuityIpcPort) => O | Promise<O>, finalize?: (result:O,port:ContinuityIpcPort)=>void) =>
    registerIpcHandler({ registrar, channel, input, output, sourceFile: 'context-continuity/ipc.ts', rolloutRound: 3, riskTags: ['internal-mutation'],
      assertOutputCurrent: (result,event)=>{const p=trusted(event);return finalize?.(result,p);},
      handler: async (value, event) => {
        const p=trusted(event);await p.refresh?.();trusted(event);const result=await handler(value,p);const current=trusted(event);
        const checked:unknown=finalize?.(result,current);
        if(checked!==undefined){try{await checked;}catch{/* An invalid async guard cannot authorize output. */}throw new Error('ipc_output_fence_invalid');}
        return result;
      } });
  const cli=(p:ContinuityIpcPort)=>{if(!p.cliArchive)throw new Error('cli_source_unavailable');return p.cliArchive;};
  const authOwner=(p:ContinuityIpcPort)=>{if(!p.authOwner)throw new Error('auth_owner_unavailable');return p.authOwner;};
  const authOwnerStatus=z.object({state:z.enum(['logged_out','logging_in','logged_in']),account:z.object({accountId:z.string().max(256)}).optional()}).strict();
  const authOwnerAttempt=z.object({authUrl:z.string().max(8192),loginId:z.string().max(256)}).strict();
  register(channels.getAuthOwnerStatus,z.void(),authOwnerStatus,(_,p)=>authOwner(p).status());
  register(channels.startAuthOwnerLogin,z.void(),authOwnerAttempt,(_,p)=>authOwner(p).startLogin());
  register(channels.cancelAuthOwnerLogin,z.void(),z.void(),(_,p)=>authOwner(p).cancelLogin());
  register(channels.logoutAuthOwner,z.void(),z.void(),(_,p)=>authOwner(p).logout());
  const sessionId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
  register(channels.listCliArchives,z.object({after:sessionId.optional()}).strict(),z.object({items:z.array(z.object({sessionId,available:z.boolean(),updatedAt:z.number().int().nonnegative().nullable()}).strict()).max(20),nextAfter:sessionId.optional()}).strict(),(input,p)=>cli(p).list(input),(result,p)=>cli(p).assertReply(result,p.actor));
  register(channels.previewCliArchive,z.object({sessionId,operationId:key}).strict(),z.object({previewId:key,sessionId,manifestHash:key,messageCount:z.number().int().min(1).max(5000),sample:z.string().max(240),coverage:z.literal('partial')}).strict(),(input,p)=>cli(p).preview(input),(result,p)=>cli(p).assertReply(result,p.actor));
  register(channels.claimCliArchive,z.object({previewId:key,manifestHash:key,operationId:key}).strict(),z.object({conversationId:key,messageCount:z.number().int().min(1).max(5000)}).strict(),(input,p)=>cli(p).claim(input),(result,p)=>cli(p).assertReply(result,p.actor));
  const consent=z.object({enabled:z.boolean(),revision}).strict();
  register(channels.getHistorySearchConsent,z.object({conversationId:key}).strict(),consent,(input,p)=>p.service.getHistorySearchConsent(p.actor,input.conversationId));
  register(channels.setHistorySearchConsent,z.object({conversationId:key,enabled:z.boolean()}).strict(),consent,(input,p)=>p.service.setHistorySearchConsent(p.actor,input));
  register(channels.searchContextHistory,historySearchInput,z.object({mode:z.literal('keyword'),coverage:z.literal('canonical_only'),scope:z.enum(['private_history','own_and_attached']),hits:z.array(z.object({
    refId,url:z.string(),conversationId:key,title:z.string().max(1024).nullable(),messageId:key,revision,contentHash:key,sourceKind:z.enum(['desktop_task','cli_session','native_codex','room']),
    observedAt:z.number().finite(),executionState:z.enum(['pending','settled','unknown']),visibilityBasis:z.literal('user_claimed_archive').optional(),excerpt:z.string().max(800),
  }).strict()).max(20)}).strict(),(input,p)=>p.service.searchHistory(p.actor,input),(result,p)=>p.service.assertHistorySearchCurrent(result,p.actor));
  const mcpStatus=z.object({enabled:z.boolean(),state:z.enum(['disabled','listening','unavailable']),url:z.string().nullable()}).strict();
  const mcp=(p:ContinuityIpcPort)=>{if(!p.mcp)throw new Error('continuity_unavailable');return p.mcp;};
  register(channels.getContextMcpStatus,z.void(),mcpStatus,(_,p)=>mcp(p).status());
  register(channels.setContextMcpEnabled,z.object({enabled:z.boolean()}).strict(),mcpStatus,(input,p)=>mcp(p).setEnabled(input.enabled));
  register(channels.resetContextMcpPort,z.void(),mcpStatus,(_,p)=>mcp(p).resetPort());
  register(channels.issueContextMcpConfig,z.object({operationId:key,targetConversationId:key,refIds:z.array(refId).min(1).max(20)}).strict(),z.object({credentialId:key,clientConfig:z.string().max(8192)}).strict(),(input,p)=>mcp(p).issue(input));
  register(channels.listExternalContextReaders,z.void(),z.array(z.object({credentialId:key,targetConversationId:key,refIds:z.array(refId).max(20),revoked:z.boolean()}).strict()),(_,p)=>p.service.listExternalReaders(p.actor));
  register(channels.revokeExternalContextReader,z.object({credentialId:key}).strict(),z.void(),(input,p)=>p.service.revokeExternalReader(p.actor,input.credentialId));
  register(channels.importLegacyThreadMetadata, legacyPreviewInput.extend({ taskIds: legacyPreviewInput.shape.taskIds.min(0) }), z.void(),
    (input, p) => { if (!p.importer) throw new Error('source_offline'); p.importer.importMetadata(input); });
  register(channels.getLegacyThreadMetadata, z.object({ legacyThreadId: key, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    z.object({ id: key, title: z.string().nullable(), metadata:legacyDisplayMetadata.optional(),taskIds: z.array(key).max(100), total: z.number().int().min(0), nextOffset: z.number().int().min(0).optional() }).strict().nullable(),
    (input, p) => { if (!p.importer) throw new Error('source_offline'); return p.importer.metadata(input); });
  register(channels.inspectContextConversations, z.object({ conversationIds: z.array(key).max(200) }).strict(),
    z.array(z.object({ id: key, state: z.enum(['active','missing','blocked','deleted']) }).strict()).max(200), (input, p) => p.service.inspectConversations(p.actor, input.conversationIds));
  register(channels.getContextGrant, z.object({ refId, targetConversationId: key }).strict(), z.object({ grantId: key,basis:z.enum(['explicit','history_search']).optional() }).strict().nullable(),
    (input, p) => p.service.getReferenceGrantView(p.actor, input));
  register(channels.previewLegacyContext, legacyPreviewInput, z.object({ previewId: key, legacyThreadId: key, title: z.string().nullable(), manifestHash: key,
    sources: z.array(z.object({ taskId: key, messageCount: z.number().int().nonnegative(), preview: z.string().max(240), status: z.string() }).strict()).max(100), coverage: z.literal('partial') }).strict(),
    (input, p) => { if (!p.importer) throw new Error('source_offline'); return p.importer.preview(input); });
  register(channels.claimLegacyContext, legacyClaimInput, conversation,
    (input, p) => { if (!p.importer) throw new Error('source_offline'); return p.importer.claim(input); });
  register(channels.createContextConversation, z.object({ operationId: key, title: z.string().max(1024).optional() }).strict(), conversation,
    (input, p) => p.service.createConversation(p.actor, input));
  register(channels.getContextConversation, z.object({ conversationId: key }).strict(), conversation.nullable(),
    (input, p) => p.service.getConversation(p.actor, input.conversationId));
  register(channels.listContextConversations, z.object({ limit: z.number().int().min(1).max(200).optional(), before: key.optional() }).strict().optional(), z.array(conversation).max(200),
    (input, p) => { const rows = p.service.listConversations(p.actor), offset = input?.before ? rows.findIndex(row => row.id === input.before) + 1 : 0; return rows.slice(offset, offset + (input?.limit ?? 100)); });
  register(channels.updateContextConversation, z.object({ conversationId: key, patch: z.object({ title: z.string().max(1024).nullable().optional(), mode: z.enum(['chat','work']).optional(), starred: z.boolean().optional(),
    gtdBucket: z.enum(['inbox','todo','waiting','someday','archived']).nullable().optional(), sidebar_work_folder: z.string().max(4096).nullable().optional() }).strict() }).strict(), conversation,
    (input, p) => p.service.updateConversation(p.actor, input.conversationId, input.patch));
  register(channels.createContextReference, z.object({ conversationId: key, expectedRevision: revision, operationId: key, firstMessageId: key.optional(), lastMessageId: key.optional(),
    sourceMessage: z.object({ sourceId: key, sourceMessageId: key }).strict().optional() }).strict(), reference,
    (input, p) => p.service.createReference(p.actor, input));
  register(channels.resolveContextReference, z.object({ refId, cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    z.object({ refId, conversationId: key, snapshotRevision: revision, messages: z.array(message).max(100), nextCursor: z.string().max(2048).optional() }).strict(),
    (input,p)=>{const page=p.service.resolveReference(p.actor,input);p.service.assertReferenceCurrent(page,p.actor,input);return page;},(page,p)=>p.service.assertReferenceCurrent(page,p.actor));
  register(channels.attachContextReference, z.object({ refId, targetConversationId: key, operationId: key }).strict(), z.object({ grantId: key }).strict(),
    (input, p) => p.service.attachReference(p.actor, input));
  register(channels.revokeContextGrant, z.object({ grantId: key }).strict(), z.void(), (input, p) => p.service.revokeGrant(p.actor, input));
}
