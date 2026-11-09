import { z } from 'zod';
import type { IpcMainInvokeEvent, BrowserWindow } from 'electron';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import { getDecisionModelService } from './decision-model-service.js';
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9-]+$/);
const selection = z.object({ version: z.literal(1), modelId: id.nullable(), revision: z.string().nullable(), automaticMemoryRerank: z.literal('not-qualified-r12') }).strict();
const runtime = z.object({ implementation: z.literal('xiaok-local-text-v2'), engine: z.enum(['mlx-vlm', 'torch-eager']).nullable(), device: z.enum(['metal', 'mps', 'cpu', 'cuda']).nullable(), parameterPrecision: z.enum(['mixed-4bit-bf16', 'float32', 'float16', 'bfloat16']).nullable(), quantization: z.enum(['affine-4bit-group64', 'none']).nullable(), versions: z.record(z.string(), z.string()), peakRssBytes: z.number().finite().nonnegative().nullable(), peakGpuAllocatedBytes: z.number().finite().nonnegative().nullable() }).strict();
const view = z.object({ id, source: z.string(), revision: z.string(), sizeBytes: z.number().int().positive(), sizeLabel: z.string(), supported: z.boolean(), verified: z.boolean(), state: z.enum(['not_installed', 'downloading', 'checking', 'interrupted', 'installed', 'loading', 'ready', 'failed']), reason: z.string().nullable(), downloadedBytes: z.number().finite().nonnegative(), currentFile: z.string().nullable(), availableDiskBytes: z.number().finite().nonnegative().nullable(), codeHash: z.string().nullable(), runtime: z.enum(['clef-mlx', 'laya']), endpoint: z.string().nullable(), runtimeSource: z.string().optional(), runtimeVersion: z.string().optional(), runtimePid: z.number().int().positive().nullable().optional(), runtimeInfo: runtime.nullable().optional(), selected: z.boolean(), automaticMemoryRerank: z.literal('not-qualified-r12') }).strict();
export function registerDecisionModelIpc(options: {
    registrar: IpcHandleRegistrar;
    dataRoot: string;
    authorize: (event: IpcMainInvokeEvent) => {
        actorId: string;
    } | null;
    window: () => BrowserWindow;
    registerDisposer: (dispose: () => void) => void;
}): void {
    const service = getDecisionModelService(options.dataRoot);
    const authorize = (event: unknown) => options.authorize(event as IpcMainInvokeEvent);
    const guard = (event: IpcMainInvokeEvent) => service.guardSender(authorize, event);
    function handle<I, O>(operation: string, input: z.ZodType<I>, output: z.ZodType<O>, tags: RiskTag[], run: (value: I) => Promise<O>) {
        registerIpcHandler({ registrar: options.registrar, channel: 'desktop:' + operation, input, wireInput: z.unknown() as z.ZodType<I>, inputStage: 'afterHostAuthorization', output,
            sourceFile: 'desktop/electron/decision-model-ipc.ts', rolloutRound: 39, riskTags: tags,
            handler: async (raw, event, helpers) => {
                await guard(event);
                const value = helpers!.parseInput(raw);
                const result = await run(value);
                await guard(event);
                return result;
            },
        });
    }
    const user = { requestSource: 'user' } as const;
    handle('decisionModelsList', z.undefined(), z.array(view), ['fs-read'], () => service.list());
    handle('decisionModelsDownload', id, z.void(), ['fs-read', 'fs-write-userData', 'network'], value => service.download(value, user));
    handle('decisionModelsCancel', id, z.void(), ['internal-mutation'], value => service.cancel(value, user));
    handle('decisionModelsRemove', id, z.void(), ['fs-read', 'fs-delete'], value => service.remove(value, user));
    handle('decisionModelsStart', z.object({ modelId: id, approveCommunityCode: z.boolean() }).strict(), z.void(), ['fs-read', 'fs-write-userData', 'external-process', 'network'], value => service.start(value.modelId, value.approveCommunityCode, user));
    handle('decisionModelsStop', id, z.void(), ['external-process'], value => service.stop(value, user));
    handle('decisionModelsUse', id, selection, ['fs-write-userData'], value => service.use(value, user));
    const unsubscribe = service.subscribe(views => { const target = options.window(); if (!target || typeof target.isDestroyed !== 'function')
        service.retainHostOutcome(target); const destroyed = target.isDestroyed(); if (destroyed !== true && destroyed !== false)
        service.retainHostOutcome(destroyed); if (!destroyed) {
        const ack = target.webContents.send('desktop:decisionModelsChanged', views);
        if (ack !== undefined)
            service.retainHostOutcome(ack);
    } });
    options.registerDisposer(unsubscribe);
}
