import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '../../src/types.js';
type RecordValue = Record<string, unknown>;
type Source = 'user' | 'agent' | 'scheduler';
type UserRequest = {
    prompt: string;
    permissionMode?: string;
};
type Creator = (input: RecordValue, context: {
    requestSource: 'user';
    signal?: AbortSignal;
}) => Promise<unknown>;
type Operation = {
    schemaVersion: 1;
    taskId: string;
    prompt: string;
    result?: RecordValue;
};
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
function requested(prompt: string) {
    const clause = prompt.trim().split(/[，。；\n]/, 1)[0] ?? '';
    if (/(?:不要|别|不用|不需要|暂不|先不)|[?？]|如何|怎么|是否/.test(clause))
        return false;
    return /^(?:(?:请(?:你)?|帮我|麻烦(?:你)?|我要|我想(?:要)?|现在|直接)\s*)*(?:创建|新建|建立|开).{0,24}(?:协作空间|协作房间)/u.test(clause) || /^(?:please\s+)?(?:create|set up)\s+(?:a\s+)?collaboration\s+(?:room|space|workspace)\b/i.test(clause);
}
/** Main owns the user's explicit room creation grant, never model input. */
export class ConversationRoomService {
    private readonly admission = new AsyncLocalStorage<UserRequest>();
    private readonly inflight = new Map<string, Promise<RecordValue>>();
    private readonly directory: string;
    private creator?: Creator;
    constructor(options: {
        dataRoot: string;
    }) { this.directory = join(options.dataRoot, 'conversation-rooms'); mkdirSync(this.directory, { recursive: true, mode: 0o700 }); }
    bindCreator(creator: Creator) { this.creator = creator; }
    withUserRequest<T>(input: UserRequest, context: {
        requestSource: Source;
    }, action: () => T): T { if (context.requestSource !== 'user')
        throw Error('conversation_room_user_source_required'); return this.admission.run(input, action); }
    bindPreparedTask(input: {
        taskId: string;
        prompt: string;
        permissionMode?: string;
        executionScope?: {
            kind: string;
            origin?: string;
        };
    }, context: {
        requestSource: Source;
    }) {
        const grant = this.admission.getStore();
        if (context.requestSource !== 'user' || !grant || grant.prompt !== input.prompt || grant.permissionMode === 'plan' || input.permissionMode === 'plan' || input.executionScope && (input.executionScope.kind !== 'goal_turn' || input.executionScope.origin !== 'user') || !requested(input.prompt))
            return false;
        if (!this.filename(input.taskId))
            return false;
        const prior = this.read(input.taskId);
        if (prior)
            return prior.prompt === input.prompt;
        this.save({ schemaVersion: 1, taskId: input.taskId, prompt: input.prompt });
        return true;
    }
    private filename(id: string) { return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(id) ? join(this.directory, `${id}.json`) : undefined; }
    private read(id: string): Operation | undefined { const file = this.filename(id); if (!file || !existsSync(file))
        return; try {
        const value = JSON.parse(readFileSync(file, 'utf8'));
        if (value.schemaVersion === 1 && value.taskId === id && requested(value.prompt))
            return value;
    }
    catch { } }
    private save(operation: Operation) { const file = this.filename(operation.taskId)!; const temporary = `${file}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(operation), { mode: 0o600 }); renameSync(temporary, file); }
    async create(input: RecordValue, context: {
        requestSource: Source;
        taskId: string;
        signal?: AbortSignal;
    }): Promise<RecordValue> {
        context.signal?.throwIfAborted();
        const operation = this.read(context.taskId);
        if (!operation || !['agent', 'user'].includes(context.requestSource))
            return { ok: false, error: 'conversation_room_user_authorization_required' };
        if (operation.result)
            return { ...operation.result, reused: true };
        const pending = this.inflight.get(context.taskId);
        if (pending)
            return pending;
        const run = this.execute(operation, input, context.signal).finally(() => this.inflight.delete(context.taskId));
        this.inflight.set(context.taskId, run);
        return run;
    }
    private async execute(operation: Operation, input: RecordValue, signal?: AbortSignal): Promise<RecordValue> {
        if (!this.creator)
            return { ok: false, error: 'conversation_room_service_unavailable' };
        const clientRequestKey = 'conversation-room:' + createHash('sha256').update(operation.taskId).digest('hex');
        const result = await this.creator({ goal: text(input.goal) || operation.prompt, title: text(input.title) || undefined, description: text(input.description) || undefined, clientRequestKey }, { requestSource: 'user', ...(signal ? { signal } : {}) });
        if (!record(result) || result.ok !== true || !record(result.room) || !text(result.room.roomId))
            return record(result) ? result : { ok: false, error: 'conversation_room_creation_failed' };
        // Save committed side effects before observing cancellation; never replay creation.
        const receipt = { ok: true, created: true, type: 'room_card', roomId: text(result.room.roomId), title: text(result.room.title), description: text(result.room.description).slice(0, 500), status: text(result.room.status), memberCount: Array.isArray(result.members) ? result.members.filter(m => record(m) && record(m.subject) && m.subject.kind === 'agent' && m.status !== 'removed').length : 0 };
        operation.result = receipt;
        this.save(operation);
        signal?.throwIfAborted();
        return receipt;
    }
}
export function createConversationRoomTool(create: (input: RecordValue, context: {
    taskId: string;
    signal?: AbortSignal;
}) => Promise<RecordValue>): Tool {
    return { permission: 'safe', definition: { name: 'create_collaboration_room', description: '只能在用户明确要求创建协作空间时使用。AI 补齐名称、说明和本地成员。严禁因普通讨论、子任务、引用或问题自行创建，严禁传入权限、actor、taskId 或外部成员来伪造授权。创建成功返回真实 roomId 和可点击卡片。', inputSchema: { type: 'object', properties: { goal: { type: 'string', description: '用户要进行的协作目标' }, title: { type: 'string', description: '可选，建议的简短名称' }, description: { type: 'string', description: '可选，建议的协作说明' } }, required: ['goal'] } }, async execute(input, context) { if (!context?.taskId)
            return JSON.stringify({ ok: false, error: 'conversation_room_host_context_required' }); return JSON.stringify(await create(input, { taskId: context.taskId, signal: context.signal })); } };
}
