import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, realpathSync } from 'node:fs';
import { createSkillTool } from '../../../src/ai/skills/tool.js';
import { loadSkills } from '../../../src/ai/skills/loader.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import { buildToolList } from '../../../src/ai/tools/index.js';
import { createRoomToolRegistry, runRoomWorkspaceExecutor, type RoomWorkspaceExecutionContext, type WorkspaceExecutionPort } from '../../electron/room-workspace-executor.js';
import type { ToolExecutionContext } from '../../../src/types.js';
const context = (cwd: string): RoomWorkspaceExecutionContext => { const canonicalRoot=realpathSync(cwd),s=lstatSync(canonicalRoot,{bigint:true});return { roomId: 'r', logicalAgentId: 'a', runId: 'run', claimId: 'claim', executorInstanceId: 'ex', workspaceId: 'w', bindingId: 'b', generation: 1, instructionsRevision: 2, effectiveCwd: cwd, workspaceRoot:{canonicalRoot,identity:{dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)}}, publishedInstructions: '已发布规则', contextScope: { kind: 'room_only' } }; };
const port = (): WorkspaceExecutionPort => ({ authorize: vi.fn(async () => { }), acquireChild: vi.fn(async ({ parent, turn, agentId }) => ({ ...parent, runId: `${agentId}-${turn}`, claimId: `claim-${agentId}-${turn}`, executorInstanceId: agentId })), release: vi.fn(async () => { }), submitManifest: vi.fn(async () => { }) });
describe('room runner physical execution and scoped tools', () => {
    it.skipIf(process.platform==='win32')('only an explicitly enabled binding exposes commands and revocation denies launch',async()=>{
        const cwd=mkdtempSync(join(tmpdir(),'room-enabled-command-')),p=port();
        const r=createRoomToolRegistry({mode:'workspace',tools:buildToolList(undefined,{cwd}),context:{...context(cwd),localCommandsAllowed:true},port:p});
        expect(r.getToolDefinitions().map(t=>t.name)).toContain('bash');
        expect(await r.executeTool('bash',{command:'echo local-command-ok',workdir:'/'})).toContain('local-command-ok');
        vi.mocked(p.authorize).mockRejectedValue(new Error('revoked'));
        expect(await r.executeTool('bash',{command:'echo forbidden'})).not.toContain('forbidden');
        await r.drain();r.dispose();
    });
    it('reads registered skill references outside the workspace without opening arbitrary files', async () => {
        const cwd=mkdtempSync(join(tmpdir(),'room-skill-work-')),config=mkdtempSync(join(tmpdir(),'room-skill-config-'));
        const skillDir=join(config,'skills','cli-guide');
        mkdirSync(join(skillDir,'references'),{recursive:true});
        writeFileSync(join(skillDir,'SKILL.md'),'---\nname: cli-guide\ndescription: CLI reference\n---\nRead references/usage.md.');
        writeFileSync(join(skillDir,'references','usage.md'),'verified CLI usage');
        const skills=await loadSkills(config,cwd,{builtinRoots:[]});
        const p=port(),r=createRoomToolRegistry({mode:'workspace',tools:[],context:context(cwd),port:p});
        r.registerTool(createSkillTool(skills));
        expect(r.getToolDefinitions().map(t=>t.name)).toContain('skillFetchAssets');
        expect(await r.executeTool('skillFetchAssets',{skillName:'cli-guide',kind:'references',paths:['references/usage.md']})).toContain('verified CLI usage');
        expect(await r.executeTool('skillFetchAssets',{skillName:'cli-guide',kind:'references',paths:['../../secret']})).toContain('not_in_manifest');
        vi.mocked(p.authorize).mockRejectedValue(new Error('revoked'));
        expect(await r.executeTool('skillFetchAssets',{skillName:'cli-guide',kind:'references',paths:['references/usage.md']})).not.toContain('verified CLI usage');
        const discussion=createRoomToolRegistry({mode:'discussion',tools:[createSkillTool(skills)]});
        expect(discussion.getToolDefinitions().map(t=>t.name)).not.toContain('skillFetchAssets');
    });
    it('real managed write creates requested business parents but never follows an outside parent link',async()=>{
        const cwd=mkdtempSync(join(tmpdir(),'room-nested-')),outside=mkdtempSync(join(tmpdir(),'room-nested-outside-'));
        const r=createRoomToolRegistry({mode:'workspace',tools:buildToolList(undefined,{cwd}),context:context(cwd),port:port()});
        const written=await r.executeTool('write',{file_path:'用户自定义/第一轮/result.txt',content:'nested output'});
        expect(written).not.toContain('Error:');expect(readFileSync(join(cwd,'用户自定义/第一轮/result.txt'),'utf8')).toBe('nested output');
        symlinkSync(outside,join(cwd,'escape'),'dir');
        expect(await r.executeTool('write',{file_path:'escape/new/result.txt',content:'bad'})).toContain('Error:');
        expect(()=>readFileSync(join(outside,'new/result.txt'))).toThrow();
    });
    it('managed writes preserve actual runtime mutation facts and never emit success for conflicts', async () => {
        const cwd=mkdtempSync(join(tmpdir(),'room-write-fact-')),emit=vi.fn();
        const r=createRoomToolRegistry({mode:'workspace',tools:buildToolList(undefined,{cwd}),context:context(cwd),port:port()});
        const execution={session:{cwd},toolInvocationId:'write-invocation',runtimeFactSink:{emit}} as unknown as ToolExecutionContext;
        await r.executeTool('write',{file_path:'out.txt',content:'one'},execution);
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({invocationId:'write-invocation',toolName:'write',factKind:'file_mutation'}));
        await r.executeTool('edit',{file_path:'out.txt',old_string:'one',new_string:'two'},{...execution,toolInvocationId:'edit-invocation'});
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({invocationId:'edit-invocation',toolName:'edit',factKind:'file_mutation'}));
        const count=emit.mock.calls.length;
        await r.executeTool('write',{file_path:'out.txt',content:'bad',expectedHash:null},execution);
        expect(emit).toHaveBeenCalledTimes(count);
    });
    it('real model tool registries reject blind overwrites and serialize competing observed writes', async () => {
        const cwd=mkdtempSync(join(tmpdir(),'room-cas-'));writeFileSync(join(cwd,'shared.txt'),'initial');
        const registry=()=>createRoomToolRegistry({mode:'workspace',tools:buildToolList(undefined,{cwd}),context:context(cwd),port:port()});
        const a=registry(),b=registry();
        expect(await a.executeTool('write',{file_path:'shared.txt',content:'blind'})).toContain('workspace_write_conflict');
        await a.executeTool('read',{file_path:'shared.txt'});await b.executeTool('read',{file_path:'shared.txt'});
        const results=await Promise.all([a.executeTool('write',{file_path:'shared.txt',content:'one'}),b.executeTool('edit',{file_path:'shared.txt',old_string:'initial',new_string:'two'})]);
        expect(results.filter(result=>result.includes('workspace_write_conflict'))).toHaveLength(1);
        expect(['one','two']).toContain(readFileSync(join(cwd,'shared.txt'),'utf8'));
        await a.executeTool('read',{file_path:'shared.txt'});writeFileSync(join(cwd,'shared.txt'),'external');
        expect(await a.executeTool('edit',{file_path:'shared.txt',old_string:'external',new_string:'bad'})).toContain('workspace_write_conflict');
        expect(readFileSync(join(cwd,'shared.txt'),'utf8')).toBe('external');
        const unbound=context(cwd);delete unbound.workspaceRoot;
        const denied=createRoomToolRegistry({mode:'workspace',tools:buildToolList(undefined,{cwd}),context:unbound,port:port()});
        expect(await denied.executeTool('write',{file_path:'missing.txt',content:'bad'})).toContain('workspace_root_identity_required');
        expect(await denied.executeTool('glob',{pattern:'**/*'})).toContain('workspace_root_identity_required');
    });
    it('discussion cannot discover or invoke filesystem, shell, notebook or skill tools', async () => {
        const r = createRoomToolRegistry({ mode: 'discussion', tools: buildToolList() });
        r.registerTool({ definition: { name: 'notebook_read', description: 'private', inputSchema: { type: 'object', properties: {} } }, permission: 'safe', execute: async () => 'secret' });
        expect(r.getToolDefinitions().map(t => t.name)).not.toContain('read');
        expect(r.getToolDefinitions().map(t => t.name)).not.toContain('bash');
        expect(r.getToolDefinitions().map(t => t.name)).not.toContain('notebook_read');
        expect(await r.executeTool('notebook_read', {})).not.toContain('secret');
    });
    it('real write/read use explicit cwd and revoked authorization denies side effects', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'room-tools-')), p = port(), c = context(cwd);
        const r = createRoomToolRegistry({ mode: 'workspace', tools: buildToolList(undefined, { cwd }), context: c, port: p });
        await r.executeTool('write', { file_path: 'test.txt', content: 'right root' });
        expect(readFileSync(join(cwd, 'test.txt'), 'utf8')).toBe('right root');
        expect(await r.executeTool('read', { file_path: 'test.txt' })).toContain('right root');
        expect(r.getToolDefinitions().map(t => t.name)).not.toContain('bash');
        vi.mocked(p.authorize).mockRejectedValue(new Error('revoked'));
        await r.executeTool('write', { file_path: 'test.txt', content: 'bad' });
        expect(readFileSync(join(cwd, 'test.txt'), 'utf8')).toBe('right root');
    });
    it('abort does not release a never-settled physical runner and does not retry it', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'room-run-')), p = port(), abort = new AbortController();
        let finish!: () => void;
        const deferred = new Promise<void>(resolve => { finish = resolve; });
        const runner = vi.fn(async () => deferred);
        const running = runRoomWorkspaceExecutor({ context: context(cwd), port: p, prompt: 'work', signal: abort.signal, createRunner: () => runner });
        await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
        abort.abort();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(p.release).not.toHaveBeenCalled();
        finish();
        await expect(running).rejects.toThrow();
        expect(p.release).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledTimes(1);
    });
    it('read and glob refuse directory escapes including symlink traversal', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'room-boundary-')), outside = mkdtempSync(join(tmpdir(), 'room-outside-'));
        writeFileSync(join(outside, 'secret.txt'), 'outside private content');
        symlinkSync(outside, join(cwd, 'escape'), 'dir');
        const r = createRoomToolRegistry({ mode: 'workspace', tools: buildToolList(undefined, { cwd }), context: context(cwd), port: port() });
        expect(await r.executeTool('read', { file_path: 'escape/secret.txt' })).not.toContain('outside private content');
        expect(await r.executeTool('glob', { pattern: '**/*.txt' })).not.toContain('secret.txt');
        expect(await r.executeTool('glob', { pattern: '../**/*.txt' })).toContain('workspace_glob_escape');
        expect(await r.executeTool('glob', { pattern: '**/*.txt', path: outside })).toContain('outside workspace');
    });
    it('a narrowed child tool ceiling cannot expand through later skill policy changes', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'room-ceiling-'));
        const r = createRoomToolRegistry({ mode: 'workspace', tools: buildToolList(undefined, { cwd }), context: context(cwd), port: port(), allowedTools: ['read'] });
        r.setAllowedTools(null);
        r.registerTool(buildToolList(undefined, { cwd }).find(tool => tool.definition.name === 'write')!);
        expect(r.getToolDefinitions().map(tool => tool.name)).toContain('read');
        expect(r.getToolDefinitions().map(tool => tool.name)).not.toContain('write');
    });
    it('standard background spawn and followup each acquire independently; parent waits for child tool disposal', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'room-children-')), p = port();
        let finish!: () => void;
        const deferred = new Promise<string>(resolve => { finish = () => resolve('done'); });
        let childTurns = 0;
        const running = runRoomWorkspaceExecutor({ context: context(cwd), port: p, prompt: 'root', createRunner: ({ registry, publishedInstructions }) => async (input) => {
                expect(publishedInstructions).toContain('已发布规则');
                if (input.prompt === 'root') {
                    const child = JSON.parse(await registry.executeTool('spawn_agent', { task_name: 'child', message: 'first' }));
                    expect(child.id).toBeTruthy();
                    await registry.executeTool('send_message', { target: child.id, message: 'shared note' });
                    await registry.executeTool('followup_task', { target: child.id, message: 'second' });
                }
                else {
                    childTurns++;
                    if (childTurns === 2) {
                        registry.registerTool({ definition: { name: 'report_progress', description: 'tracked deferred fixture', inputSchema: { type: 'object', properties: {} } }, permission: 'safe', execute: async () => deferred });
                        void registry.executeTool('report_progress', {});
                    }
                }
            } });
        await vi.waitFor(() => expect(childTurns).toBe(2));
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(p.acquireChild).toHaveBeenCalledTimes(2);
        expect(p.release).toHaveBeenCalledTimes(1);
        expect(vi.mocked(p.release).mock.calls[0][0].claimId).not.toBe('claim');
        finish();
        await running;
        expect(p.release).toHaveBeenCalledTimes(3);
        expect(vi.mocked(p.release).mock.calls.at(-1)?.[0].claimId).toBe('claim');
    });
    it('releases an acquired mismatched child claim without ever starting its runner', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'room-invalid-child-')), p = port();
        vi.mocked(p.acquireChild).mockImplementation(async ({ parent }) => ({ ...parent, claimId: 'wrong-child', runId: 'wrong-run', effectiveCwd: '/wrong' }));
        const runner = vi.fn(async ({ registry }: any) => { await registry.executeTool('spawn_agent', { task_name: 'child', message: 'work' }); });
        await runRoomWorkspaceExecutor({ context: context(cwd), port: p, prompt: 'root', createRunner: input => async () => runner(input) });
        expect(runner).toHaveBeenCalledTimes(1);
        expect(p.release).toHaveBeenCalledTimes(2);
        expect(vi.mocked(p.release).mock.calls[0][0].claimId).toBe('wrong-child');
    });
    it('a duplicate parent claim returned for a child cannot release the still-running parent', async () => {
        const cwd=mkdtempSync(join(tmpdir(),'room-duplicate-child-')),p=port();
        vi.mocked(p.acquireChild).mockImplementation(async({parent})=>({...parent}));
        let finish!:()=>void;const pending=new Promise<void>(done=>{finish=done;});
        const running=runRoomWorkspaceExecutor({context:context(cwd),port:p,prompt:'root',createRunner:({registry})=>async()=>{
            await registry.executeTool('spawn_agent',{task_name:'child',message:'work'});
            await pending;
        }});
        await vi.waitFor(()=>expect(p.acquireChild).toHaveBeenCalledTimes(1));
        await new Promise(done=>setTimeout(done,10));expect(p.release).not.toHaveBeenCalled();
        finish();await running;expect(p.release).toHaveBeenCalledTimes(1);
    });
});
