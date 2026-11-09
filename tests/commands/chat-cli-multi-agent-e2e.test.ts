import {createServer,type ServerResponse} from 'node:http';
import {readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {assertOpenAIToolProtocol} from '../support/openai-tool-protocol.js';
import {canSpawnChildProcesses,createCliWorkspace,captureCliBuildMetadata,listenProvider,runFixtureCli,
  readBody,requestText,lastMessage,parseLastToolResult,toolNames,spawnedAgentId,
  toolCallEvents,toolBatchEvents,textEvents,sendEvents,writeConfig,type ProviderRequest} from '../support/chat-cli-multi-agent-fixture.js';

describe('chat CLI multi-agent process e2e', () => {
  const tempDirs: string[] = [];
  const itIfCanSpawn = canSpawnChildProcesses() ? it : it.skip;
  let assertMetadataUnchanged: (()=>void)|undefined;
  beforeAll(()=>{assertMetadataUnchanged=captureCliBuildMetadata();});
  afterAll(()=>{assertMetadataUnchanged?.();});

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  itIfCanSpawn.each(['AskUserQuestion', 'ask_user'] as const)('delivers the CLI policy and refuses unavailable user input through %s', async (tool) => {
    const {configDir,homeDir,projectDir}=createCliWorkspace(`xiaok-delegation-question-${tool}-`,tempDirs);
    let requests = 0;
    const errors: string[] = [];
    const server = createServer(async (req, res) => {
      try {
        const request = JSON.parse(await readBody(req)) as ProviderRequest;
        assertOpenAIToolProtocol(request.messages ?? []);
        const system = String(request.messages?.find((message) => message.role === 'system')?.content);
        expect(system).toContain('# CLI autonomous delegation');
        expect(system).toContain('Delegate automatically');
        expect(system).toContain('No interactive user input is available');
        if (requests++ === 0) {
          const options = [{ label: 'Parallel' }, { label: 'Main agent only' }];
          sendEvents(res, toolCallEvents(tool, tool === 'ask_user'
            ? { question: 'Choose execution mode', options }
            : { questions: [{ question: 'Choose execution mode', options }] }, 'ask_execution_mode'));
        } else {
          expect(lastMessage(request)?.content).toContain(tool === 'ask_user' ? '不支持 ask_user 交互' : 'no answer was provided');
          sendEvents(res, textEvents('NO_APPROVAL_INVENTED'));
        }
      } catch (error) {
        errors.push(String(error));
        sendEvents(res, textEvents('QUESTION_BOUNDARY_FAILED'));
      }
    });
    writeConfig(configDir,await listenProvider(server,'missing local address'));
    try {
      const {stdout}=await runFixtureCli({projectDir,homeDir,configDir,prompt:'Review the implementation and coverage.',timeout:15_000});
      expect(errors).toEqual([]);
      expect(requests).toBe(2);
      expect(JSON.parse(stdout)).toMatchObject({ text: 'NO_APPROVAL_INVENTED' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);

  itIfCanSpawn('reports a stalled real child as failed and persists live progress before main completes', async () => {
    const {configDir,homeDir,projectDir}=createCliWorkspace('xiaok-agent-stall-',tempDirs);
    let step = 0;
    let sawChildRequest = false;
    let sawFailed = false;
    let sawLiveLog = false;
    let sawReplacement = false;
    let pendingResponse: ServerResponse | undefined;
    const errors: string[] = [];
    const server = createServer(async (req, res) => {
      try {
        const request = JSON.parse(await readBody(req)) as ProviderRequest;
        assertOpenAIToolProtocol(request.messages ?? []);
        const system = String(request.messages?.find((m) => m.role === 'system')?.content);
        if (system.includes('You are subagent /root/stalled ')) {
          sawChildRequest = true;
          pendingResponse = res; // Real HTTP call deliberately never returns any chunks.
          return;
        }
        if (system.includes('You are subagent /root/replacement ')) {
          sendEvents(res, textEvents('replacement completed'));
          return;
        }
        if (step++ === 0) {
          sendEvents(res, toolCallEvents('spawn_agent', { task_name: 'stalled', message: 'read-only review' }, 'spawn_stalled'));
        } else if (step === 2) {
          sendEvents(res, toolCallEvents('wait_agent', { targets: ['/root/stalled'], timeout_ms: 300_000 }, 'wait_stalled'));
        } else if (step === 3) {
          const result = parseLastToolResult(request);
          sawFailed = JSON.stringify(result).includes('MULTI_AGENT_IDLE_TIMEOUT') && JSON.stringify(result).includes('"status":"failed"');
          const transcriptDir = join(configDir, 'transcripts');
          const files = readdirSync(transcriptDir).filter((name) => name.endsWith('.jsonl'));
          const events = files.flatMap((name) => readFileSync(join(transcriptDir, name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
          sawLiveLog = events.some((event) => event.type === 'multi_agent' && event.event.agent.phase === 'model');
          sendEvents(res, toolCallEvents('spawn_agent', { task_name: 'replacement', message: 'run after automatic reclamation' }, 'spawn_replacement'));
        } else if (step === 4) {
          const result = parseLastToolResult(request);
          sawReplacement = typeof result.id === 'string' && result.taskName === 'replacement';
          if (!sawReplacement) throw new Error('timeout left the only child slot occupied');
          sendEvents(res, toolCallEvents('wait_agent', { targets: ['/root/replacement'], timeout_ms: 10_000 }, 'wait_replacement'));
        } else {
          sendEvents(res, textEvents('E2E_STALL_HANDLED'));
        }
      } catch (error) {
        errors.push(String(error));
        sendEvents(res, textEvents('E2E_STALL_ERROR'));
      }
    });
    writeConfig(configDir,await listenProvider(server,'missing local address'));
    try {
      const {stdout}=await runFixtureCli({projectDir,homeDir,configDir,prompt:'STALL_TEST',timeout:15_000,
        limits:{XIAOK_MAX_AGENT_THREADS:'2',XIAOK_SUBAGENT_IDLE_TIMEOUT_MS:'1000',XIAOK_SUBAGENT_TURN_TIMEOUT_MS:'5000'}});
      expect(errors).toEqual([]);
      expect(JSON.parse(stdout)).toMatchObject({ text: 'E2E_STALL_HANDLED' });
      expect(sawChildRequest).toBe(true);
      expect(sawFailed).toBe(true);
      expect(sawLiveLog).toBe(true);
      expect(sawReplacement).toBe(true);
    } finally {
      pendingResponse?.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);

  itIfCanSpawn.each(['isolated', 'default_fork', 'default_fork_same_batch', 'live_message'] as const)(
    'runs concurrent children, bidirectional messages, persistent follow-up and close: %s', async (mode) => {
    const {configDir,homeDir,projectDir}=createCliWorkspace(`xiaok-multi-agent-e2e-${mode}-`,tempDirs);
    const parentFactPath = join(projectDir, 'parent-context.txt');
    writeFileSync(parentFactPath, 'PARENT_COMPLETED_TOOL_FACT_7K9', 'utf8');

    let mainStep = -1;
    let childAId = '';
    let childBId = '';
    let mainPhase: 'initial' | 'sent_live' | 'wait_initial' | 'sent_to_a' | 'followup_a' | 'wait_followup' | 'close_a' | 'close_b' | 'list_closed' = 'initial';
    const progressSeen = new Set<string>();
    const mainToolNames = new Set<string>();
    let activeInitialChildren = 0;
    let maxConcurrentInitialChildren = 0;
    let sawFollowupContext = false;
    let sawLiveMessage = false;
    let markChildAStarted!: () => void;
    const childAStarted = new Promise<void>((resolve) => { markChildAStarted = resolve; });
    let sawClosedAgents = false;
    const inheritedFactChildren = new Set<string>();
    const protocolErrors: string[] = [];

    const server = createServer(async (req, res) => {
      const request = JSON.parse(await readBody(req)) as ProviderRequest;
      const text = requestText(request);
      const last = lastMessage(request);
      try {
        assertOpenAIToolProtocol(request.messages ?? []);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        protocolErrors.push(message);
        res.writeHead(400, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ error: { message } }));
        return;
      }
      // Forked children legitimately contain the main prompt in their history.
      const systemPrompt = String(request.messages?.find((message) => message.role === 'system')?.content ?? '');
      const childName = systemPrompt.includes('You are subagent /root/child_a ')
        ? 'child_a'
        : systemPrompt.includes('You are subagent /root/child_b ') ? 'child_b' : undefined;

      if (!childName) {
        if (protocolErrors.length > 0) {
          sendEvents(res, textEvents('E2E_PROTOCOL_FAILED'));
          return;
        }
        for (const name of toolNames(request)) mainToolNames.add(name);
        const latestResult = parseLastToolResult(request);
        if (mainStep === -1) {
          mainStep = 0;
          sendEvents(res, toolCallEvents('read', { file_path: parentFactPath }, 'call_parent_read'));
          return;
        }
        if (mainStep === 0) {
          if (!systemPrompt.includes('instructions to execute')
            || systemPrompt.includes('CRITICAL RULE')
            || !systemPrompt.includes('# CLI autonomous delegation')
            || !systemPrompt.includes('User instructions to work alone or ask first take precedence')) {
            protocolErrors.push('CLI delegation policy missing from the active provider request');
            sendEvents(res, textEvents('E2E_POLICY_MISSING'));
            return;
          }
          mainStep += 1;
          if (mode === 'default_fork_same_batch') {
            mainStep = 2;
            sendEvents(res, toolBatchEvents([
              { name: 'spawn_agent', input: { task_name: 'child_a', message: 'child_a_first' }, callId: 'call_spawn_a' },
              { name: 'spawn_agent', input: { task_name: 'child_b', message: 'child_b_first' }, callId: 'call_spawn_b' },
            ]));
            return;
          }
          sendEvents(res, toolCallEvents('spawn_agent', {
            task_name: 'child_a', message: 'child_a_first', ...(mode === 'isolated' ? { fork_context: false } : {}),
          }, 'call_spawn_a'));
          return;
        }
        if (mainStep === 1) {
          childAId = String(latestResult.id ?? '');
          mainStep += 1;
          sendEvents(res, toolCallEvents('spawn_agent', {
            task_name: 'child_b', message: 'child_b_first', ...(mode === 'isolated' ? { fork_context: false } : {}),
          }, 'call_spawn_b'));
          return;
        }
        if (mainStep === 2) {
          childAId = spawnedAgentId(request, 'child_a');
          childBId = spawnedAgentId(request, 'child_b');
          mainStep += 1;
          if (mode === 'live_message') {
            await childAStarted;
            mainPhase = 'sent_live';
            sendEvents(res, toolCallEvents('send_message', { target: childAId, message: 'MAIN_LIVE_A' }, 'send_live_a'));
            return;
          }
          mainPhase = 'wait_initial';
          sendEvents(res, toolCallEvents('wait_agent', {
            targets: [childAId, childBId], timeout_ms: 10_000,
          }, 'call_wait_initial_1'));
          return;
        }

        if (mainPhase === 'sent_live') {
          mainPhase = 'wait_initial';
          sendEvents(res, toolCallEvents('wait_agent', { targets: [childAId, childBId], timeout_ms: 10_000 }, 'wait_after_live_send'));
          return;
        }
        if (mainPhase === 'wait_initial') {
          const messages = Array.isArray(latestResult.messages) ? latestResult.messages : [];
          for (const message of messages) {
            if (message && typeof message === 'object' && 'text' in message) {
              progressSeen.add(String(message.text));
            }
          }
          const agents = Array.isArray(latestResult.agents) ? latestResult.agents : [];
          const bothCompleted = agents.length === 2
            && agents.every((agent) => agent && typeof agent === 'object' && agent.status === 'completed');
          if (!bothCompleted || !progressSeen.has('A_PROGRESS') || !progressSeen.has('B_PROGRESS')) {
            sendEvents(res, toolCallEvents('wait_agent', {
              targets: [childAId, childBId], timeout_ms: 10_000,
            }, `call_wait_initial_${mainStep++}`));
            return;
          }
          mainPhase = 'sent_to_a';
          sendEvents(res, toolCallEvents('send_message', {
            target: childAId, message: 'MAIN_TO_A',
          }, 'call_send_to_a'));
          return;
        }

        if (mainPhase === 'sent_to_a') {
          mainPhase = 'followup_a';
          sendEvents(res, toolCallEvents('followup_task', {
            target: childAId, message: 'child_a_second',
          }, 'call_followup_a'));
          return;
        }

        if (mainPhase === 'followup_a') {
          mainPhase = 'wait_followup';
          sendEvents(res, toolCallEvents('wait_agent', {
            targets: [childAId], timeout_ms: 10_000,
          }, 'call_wait_followup_1'));
          return;
        }

        if (mainPhase === 'close_a') {
          expect(latestResult).toMatchObject({ closed: true, resourcesReleased: true, cleanupPending: false });
          mainPhase = 'close_b';
          sendEvents(res, toolCallEvents('close_agent', { target: childBId }, 'call_close_b'));
          return;
        }
        if (mainPhase === 'close_b') {
          expect(latestResult).toMatchObject({ closed: true, resourcesReleased: true, cleanupPending: false });
          mainPhase = 'list_closed';
          sendEvents(res, toolCallEvents('list_agents', {}, 'call_list_closed'));
          return;
        }
        if (mainPhase === 'list_closed') {
          const agents = Array.isArray(latestResult) ? latestResult : [];
          sawClosedAgents = [childAId, childBId].every((id) => agents.some((agent) => agent.id === id && agent.status === 'closed' && agent.resourcesReleased === true && agent.executionActive === false));
          sendEvents(res, textEvents('E2E_MULTI_AGENT_PASS'));
          return;
        }

        const messages = Array.isArray(latestResult.messages) ? latestResult.messages : [];
        for (const message of messages) {
          if (message && typeof message === 'object' && 'text' in message) {
            progressSeen.add(String(message.text));
          }
        }
        const agents = Array.isArray(latestResult.agents) ? latestResult.agents : [];
        const followupCompleted = agents.some((agent) => (
          agent && typeof agent === 'object'
          && agent.status === 'completed'
          && agent.lastResult === 'A_SECOND_DONE'
        ));
        if (!followupCompleted || !progressSeen.has('A_FOLLOWUP_ACK')) {
          sendEvents(res, toolCallEvents('wait_agent', {
            targets: [childAId], timeout_ms: 10_000,
          }, `call_wait_followup_${mainStep++}`));
          return;
        }
        mainPhase = 'close_a';
        sendEvents(res, toolCallEvents('close_agent', { target: childAId }, 'call_close_a'));
        return;
      }

      const currentTask = String(last?.content ?? '');
      if (mode === 'live_message' && childName === 'child_a' && last?.role === 'user' && currentTask.includes('MAIN_LIVE_A')) {
        sawLiveMessage = true;
        sendEvents(res, textEvents('A_DONE'));
        return;
      }
      if (text.includes('PARENT_COMPLETED_TOOL_FACT_7K9')) inheritedFactChildren.add(childName);
      if (last?.role === 'user' && currentTask.includes('child_a_second')) {
        sawFollowupContext = text.includes('child_a_first')
          && currentTask.includes('MAIN_TO_A');
        sendEvents(res, toolCallEvents('send_message', {
          target: 'main', message: 'A_FOLLOWUP_ACK',
        }, 'call_child_a_followup_message'));
        return;
      }
      if (last?.role === 'tool' && last.tool_call_id === 'call_child_a_followup_message') {
        sendEvents(res, textEvents('A_SECOND_DONE'));
        return;
      }

      if (last?.role === 'user' && (currentTask.includes('child_a_first') || currentTask.includes('child_b_first'))) {
        if (childName === 'child_a') markChildAStarted();
        activeInitialChildren += 1;
        maxConcurrentInitialChildren = Math.max(maxConcurrentInitialChildren, activeInitialChildren);
        await new Promise((resolve) => setTimeout(resolve, 120));
        activeInitialChildren -= 1;
        const isA = childName === 'child_a';
        sendEvents(res, toolCallEvents('send_message', {
          target: 'main', message: isA ? 'A_PROGRESS' : 'B_PROGRESS',
        }, isA ? 'call_child_a_message' : 'call_child_b_message'));
        return;
      }
      if (childName === 'child_a' && last?.role === 'tool') {
        sendEvents(res, textEvents('A_DONE'));
        return;
      }
      if (childName === 'child_b' && last?.role === 'tool') {
        sendEvents(res, textEvents('B_DONE'));
        return;
      }

      sendEvents(res, textEvents('UNEXPECTED_ROUTE'));
    });

    writeConfig(configDir,await listenProvider(server,'failed to bind fake provider'));

    try {
      const {stdout,stderr}=await runFixtureCli({projectDir,homeDir,configDir,prompt:'E2E_MULTI_AGENT_START',timeout:20_000});
      expect(protocolErrors).toEqual([]);
      expect(JSON.parse(stdout)).toMatchObject({ text: 'E2E_MULTI_AGENT_PASS' });
      expect(stderr).not.toContain('UNEXPECTED_ROUTE');
      expect(childAId).toMatch(/^agent_/);
      expect(childBId).toMatch(/^agent_/);
      expect(childBId).not.toBe(childAId);
      expect(maxConcurrentInitialChildren).toBeGreaterThanOrEqual(2);
      expect(sawFollowupContext).toBe(true);
      expect(sawLiveMessage).toBe(mode === 'live_message');
      expect(sawClosedAgents).toBe(true);
      expect([...inheritedFactChildren].sort()).toEqual(mode === 'isolated' ? [] : ['child_a', 'child_b']);
      expect(progressSeen).toEqual(new Set(['A_PROGRESS', 'B_PROGRESS', 'A_FOLLOWUP_ACK', 'A_DONE', 'B_DONE', 'A_SECOND_DONE']));
      expect([...mainToolNames]).toEqual(expect.arrayContaining([
        'spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'list_agents',
        'interrupt_agent', 'close_agent',
      ]));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }, 25_000);
});
