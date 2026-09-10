// @vitest-environment node
import { createServer } from 'node:http';
import {createHash} from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { it, expect } from 'vitest';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { RoomWorkspaceLocalStore } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceService } from '../../electron/room-workspace-service.js';
import { createRoomWorkspaceBrokerClient } from '../../electron/room-workspace-broker-client.js';
import { createCollaborationRoomBrokerClient } from '../../electron/collaboration-room-broker-client.js';
import { createRoomWorkspaceRuntime } from '../../electron/room-workspace-runtime.js';
it('real broker HTTP + SQLite binding + main runtime + SSE provider complete scoped concurrent child turns', async () => {
    const root = mkdtempSync(join(tmpdir(), 'room-provider-')), cwd = join(root, 'work');
    mkdirSync(cwd);
    const attachmentPath=join(root,'brief.txt'), imagePath=join(root,'pixel.png');
    writeFileSync(attachmentPath,'ROOM_ATTACHMENT_BODY');
    writeFileSync(imagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64'));
    writeFileSync(join(cwd,'downloaded.png'),readFileSync(imagePath));
    const previous = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = join(root, 'config');
    mkdirSync(process.env.XIAOK_CONFIG_DIR);
    const requests: any[] = [];
    let readObserved=false,childHashObserved=false,materialReads=0;
    let serial = 0;
    const server = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req)
            raw += chunk;
        const body = JSON.parse(raw);
        requests.push(body);
        const messages = body.messages ?? [], text = JSON.stringify(messages), rootTurn = text.includes('ROOT_FLOW');
        const called = messages.flatMap((m: any) => (m.tool_calls ?? []).map((t: any) => t.function.name));
        const toolResults=messages.filter((m:any)=>m.role==='tool').map((m:any)=>String(m.content));
        if(toolResults.some((value:string)=>value.includes('ROOM_ATTACHMENT_BODY')))materialReads++;
        if(!rootTurn&&toolResults.some((value:string)=>value.includes(createHash('sha256').update('child physical output').digest('hex'))))childHashObserved=true;
        if(rootTurn&&called.includes('read')){expect(toolResults.some((value:string)=>value.includes('child physical output'))).toBe(true);readObserved=true;}
        let name: string | undefined, input: Record<string, unknown> = {};
        if (!called.includes('read_material')) {
            name='read_material';
            const materialId=text.match(/materialId: (mat_[a-zA-Z0-9_-]+)/)?.[1];
            expect(materialId).toBeTruthy();input={materialId};
        }
        else if(rootTurn&&!called.includes('read_workspace_material')){
            name='read_workspace_material';input={file_path:'downloaded.png'};
        }
        else if(rootTurn&&!called.includes('bash')){
            name='bash';input={command:'printf ROOM_COMMAND_CONFIRMED'};
        }
        else if (rootTurn) {
            if (!called.includes('spawn_agent')) {
                name = 'spawn_agent';
                input = { task_name: 'helper', message: 'CHILD_ONE' };
            }
            else if (!called.includes('write')) {
                name = 'write';
                input = { file_path: 'root.txt', content: 'root physical output' };
            }
            else if (!called.includes('wait_agent')) {
                name = 'wait_agent';
                input = { targets: ['/root/helper'], timeout_ms: 10000 };
            }
            else if (!called.includes('read')) {
                name='read';input={file_path:'child.txt'};
            }
            else if (!called.includes('followup_task')) {
                name = 'followup_task';
                input = { target: '/root/helper', message: 'CHILD_TWO' };
            }
            else if (called.filter((n: string) => n === 'wait_agent').length < 2) {
                name = 'wait_agent';
                input = { targets: ['/root/helper'], timeout_ms: 10000 };
            }
        }
        else if (!called.includes('write')) {
            name = 'write';
            input = { file_path: text.includes('CHILD_TWO') ? 'child2.txt' : 'child.txt', content: 'child physical output' };
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const emit = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: `fixture-${++serial}`, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        if (name) {
            emit({ tool_calls: [{ index: 0, id: `call-${serial}`, type: 'function', function: { name, arguments: JSON.stringify(input) } }] });
            emit({}, 'tool_calls');
        }
        else {
            emit({ content: rootTurn ? 'ROOM_SSE_DONE' : 'CHILD_SSE_DONE' });
            emit({}, 'stop');
        }
        res.end('data: [DONE]\n\n');
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address() as {
        port: number;
    };
    writeFileSync(join(process.env.XIAOK_CONFIG_DIR, 'config.json'), JSON.stringify({ schemaVersion: 2, defaultProvider: 'openai', defaultModelId: 'fixture', providers: { openai: { type: 'first_party', protocol: 'openai_legacy', apiKey: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1` } }, models: { fixture: { provider: 'openai', model: 'gpt-room-fixture', label: 'fixture',runtimeOptions:{contextLimit:100000} } }, defaultMode: 'interactive', contextBudget: 100000, channels: {} }));
    const nodeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const sibling = resolve(process.cwd(), '..', '..', 'intent-broker');
    const { createBrokerService } = await nodeImport(pathToFileURL(join(sibling, 'src/broker/service.js')).href);
    const { createServer: createBrokerServer } = await nodeImport(pathToFileURL(join(sibling, 'src/http/server.js')).href);
    const broker = createBrokerService({ dbPath: join(root, 'broker.db') }), store = new RoomWorkspaceLocalStore(join(root, 'local.db'));
    const brokerServer = createBrokerServer({ broker, roomService: broker.room, roomDesktopToken: 'fixture-secret', roomKSwarmToken: 'fixture-kswarm' });
    await brokerServer.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${brokerServer.address().port}`;
    const roomClient = createCollaborationRoomBrokerClient({ token: 'fixture-secret', fetchImpl: (input, init) => fetch(`${baseUrl}${new URL(String(input)).pathname}${new URL(String(input)).search}`, init) });
    const client = createRoomWorkspaceBrokerClient({ token: 'fixture-secret', baseUrl, isMutationOwner: () => true });
    try {
        const created = await roomClient.createRoom({ title: 'Full chain fixture', memberAgentIds: ['agent'] });
        expect(created.ok, JSON.stringify(created)).toBe(true);
        const roomId = (created.room as any).roomId;
        const workspaceService = createRoomWorkspaceService({ store, broker: client, isMutationOwner: () => true, ensureProtocol: async () => { } });
        const preview = await workspaceService.previewCollaborationRoomWorkspace({ roomId, mode: 'existing', selectedPath: cwd, expectedRevision: 0, templateEntries: [], instructionsText: 'FROZEN_ROOM_RULES' });
        expect(preview.ok, JSON.stringify(preview)).toBe(true);
        const bound = await workspaceService.commitCollaborationRoomWorkspace({ roomId, previewId: preview.previewId!, expectedRevision: 0, idempotencyKey: 'bind-fixture', confirmOverlap: true, confirmSharedReadGrant: true });
        expect(bound.ok, JSON.stringify(bound)).toBe(true);
        expect(bound.snapshot!.localCommandsAllowed).toBe(true);
        const sent = await roomClient.sendRoomMessage({ roomId, text: 'ROOT_FLOW', idempotencyKey: 'message-fixture', responsePolicy: 'mentioned', mentions: [{ kind: 'agent', logicalAgentId: 'agent' }] });
        expect(sent.ok, JSON.stringify(sent)).toBe(true);
        const message = sent.message as any;
        const services = createDesktopServices({ dataRoot: join(root, 'data'), kswarmService: { request: async () => new Response('{}'), getDesktopMutationToken: () => 'fixture' } as any });
        const runtime = createRoomWorkspaceRuntime({ store, broker: client, wake: roomClient, execute: services.runCollaborationRoomAgentTask, ensureProtocol: async () => { }, flushOutbox: workspaceService.flushOutbox });
        const result = await runtime.run({ roomId, roomTitle: 'Fixture', roomRevision: 1, roomMessageId: message.messageId, logicalAgentId: 'agent', contextScope: { kind: 'room_only' }, messages: [message], attachmentPaths:[attachmentPath,imagePath], contextWindow: { fromSequence: message.roomSequence, toSequence: message.roomSequence, totalMessages: 1, isComplete: true, snapshotAt: new Date().toISOString() } });
        expect(result.ok).toBe(true);
        expect(readObserved).toBe(true);expect(childHashObserved).toBe(true);
        expect(materialReads).toBeGreaterThan(2);
        for (const file of ['root.txt', 'child.txt', 'child2.txt'])
            expect(readFileSync(join(cwd, file), 'utf8')).toContain('physical output');
        expect(readdirSync(cwd).sort()).toEqual(['child.txt','child2.txt','downloaded.png','root.txt']);
        const state = await client.get(roomId), claims = state.claims as any[];
        expect(claims).toHaveLength(3);
        expect(new Set(claims.map(c => c.claimId)).size).toBe(3);
        expect(claims.every(c => c.executionState === 'released' && c.terminationEvidence.verified)).toBe(true);
        const snapshot = await roomClient.getRoomSnapshot(roomId);
        expect(JSON.stringify(snapshot)).toContain('ROOM_SSE_DONE');
        expect((snapshot.messages as any[]).filter(message => message.kind === 'workspace_event')).toHaveLength(3);
        for (const request of requests) {
            expect(JSON.stringify(request.messages)).toContain('FROZEN_ROOM_RULES');
            const tools = request.tools.map((tool: any) => tool.function.name);
            expect(tools).toContain('spawn_agent');
            expect(tools).toContain('read_material');
            expect(JSON.stringify(request.messages)).toContain('data:image/png;base64,');
            expect(tools).toContain('bash');
            expect(tools).not.toContain('grep');
            expect(tools.some((n: string) => n.startsWith('notebook'))).toBe(false);
        }
        expect(requests.some(request=>JSON.stringify(request.messages).includes('ROOM_COMMAND_CONFIRMED'))).toBe(true);
        expect(requests.some(request=>JSON.stringify(request.messages).split('data:image/png;base64,').length>=3)).toBe(true);
        const files = await workspaceService.getCollaborationRoomWorkspace({ roomId });
        expect(files.artifacts.map(a => a.relativePath).sort()).toEqual(['child.txt', 'child2.txt', 'root.txt']);
        expect(store.pendingOutbox()).toHaveLength(0);
        const configPath=join(process.env.XIAOK_CONFIG_DIR!,'config.json');
        const noBudget=JSON.parse(readFileSync(configPath,'utf8'));delete noBudget.models.fixture.runtimeOptions;
        writeFileSync(configPath,JSON.stringify(noBudget));
        const next=await roomClient.sendRoomMessage({roomId,text:'NO_BUDGET',idempotencyKey:'no-budget',responsePolicy:'mentioned',mentions:[{kind:'agent',logicalAgentId:'agent'}]});
        expect(next.ok,JSON.stringify(next)).toBe(true);const nextMessage=next.message as any;
        const requestCount=requests.length;
        await expect(runtime.run({roomId,roomTitle:'Fixture',roomRevision:1,roomMessageId:nextMessage.messageId,logicalAgentId:'agent',contextScope:{kind:'room_only'},messages:[nextMessage],contextWindow:{fromSequence:nextMessage.roomSequence,toSequence:nextMessage.roomSequence,totalMessages:1,isComplete:true,snapshotAt:new Date().toISOString()}})).rejects.toThrow('workspace_context_budget_unavailable');
        expect(requests).toHaveLength(requestCount);
        const afterRefusal=await client.get(roomId);
        expect((afterRefusal.claims as any[])).toHaveLength(4);
        expect((afterRefusal.claims as any[]).every(claim=>claim.executionState==='released')).toBe(true);
        const scheduled=await roomClient.sendScheduledRoomWake({roomId,targetAgentId:'agent',text:'Scheduled room check',scheduleId:'schedule-fixture',idempotencyKey:'due-fixture'});
        expect(scheduled.ok,JSON.stringify(scheduled)).toBe(true);
        expect((scheduled.message as any).sender).toEqual({kind:'system',service:'desktop'});
        const pending=await roomClient.listPendingWakes('agent');
        expect(JSON.stringify(pending)).toContain((scheduled.message as any).messageId);
    }
    finally {
        await brokerServer.close();
        broker.close();
        store.close();
        if (previous === undefined)
            delete process.env.XIAOK_CONFIG_DIR;
        else
            process.env.XIAOK_CONFIG_DIR = previous;
        server.closeAllConnections();
        await new Promise<void>(done => server.close(() => done()));
    }
}, 30000);
