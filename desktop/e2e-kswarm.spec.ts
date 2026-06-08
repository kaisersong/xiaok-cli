/**
 * E2E: KSwarm integration flow tests.
 *
 * Verifies core kswarm flows end-to-end:
 * 1. Seed agents exist (PO-Agent + Worker-Agent)
 * 2. Runtime discovery works
 * 3. LLM providers + models work
 * 4. Create agent works
 * 5. Create project + full detail works
 * 6. Task failure + retry works
 * 7. Agent heartbeat + liveness works
 *
 * Run: npx playwright test e2e-kswarm.spec.ts --config=playwright.e2e.config.ts
 */

import { join } from 'node:path';
import { test, expect, type ElectronApplication, type APIRequestContext } from '@playwright/test';
import { _electron as electron } from 'playwright';

const KSWARM_PORT = 4400;
const BROKER_PORT = 4318;
const BASE = `http://127.0.0.1:${KSWARM_PORT}`;
const BROKER = `http://127.0.0.1:${BROKER_PORT}`;
const APP_PATH = process.env.XIAOK_E2E_APP_PATH
  ?? join(process.cwd(), 'release/mac-arm64/xiaok.app/Contents/MacOS/xiaok');

let app: ElectronApplication | null = null;

async function serviceHealthy(request: APIRequestContext, url: string): Promise<boolean> {
  try {
    const res = await request.get(url, { timeout: 1000 });
    return res.ok();
  } catch {
    return false;
  }
}

async function waitForService(request: APIRequestContext, url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await request.get(url, { timeout: 1500 });
      if (res.ok()) return;
      lastError = new Error(`HTTP ${res.status()} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

test.describe('KSwarm integration (API-level)', () => {
  test.beforeAll(async ({ request }) => {
    if (await serviceHealthy(request, `${BASE}/health`) && await serviceHealthy(request, `${BROKER}/health`)) {
      return;
    }
    app = await electron.launch({
      executablePath: APP_PATH,
      args: [],
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
      },
    });
    await app.firstWindow();
    await waitForService(request, `${BASE}/health`);
    await waitForService(request, `${BROKER}/health`);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    app = null;
  });

  test('Server health check passes', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('Seed agents exist', async ({ request }) => {
    const res = await request.get(`${BASE}/agents`);
    expect(res.ok()).toBe(true);
    const { agents } = await res.json();
    const names = agents.map((a: any) => a.name);
    expect(names).toContain('PO-Agent');
    expect(names).toContain('Worker-Agent');
    const xiaokAgents = agents.filter((a: any) => a.runtimeType === 'xiaok');
    expect(xiaokAgents.length).toBeGreaterThanOrEqual(2);
  });

  test('Runtime discovery lists known platforms', async ({ request }) => {
    const res = await request.get(`${BASE}/runtimes`);
    expect(res.ok()).toBe(true);
    const { runtimes } = await res.json();
    const types = runtimes.map((r: any) => r.type);
    expect(types.some((type: string) => type === 'xiaok' || type === 'xiaok-cli')).toBe(true);
    expect(types.some((type: string) => type === 'qoder' || type === 'qodercli' || type === 'qoder-cli')).toBe(true);
  });

  test('LLM providers and models work', async ({ request }) => {
    // List providers
    const provRes = await request.get(`${BASE}/llm/providers`);
    expect(provRes.ok()).toBe(true);
    const { providers } = await provRes.json();
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');

    // Get models for a provider
    const modelRes = await request.get(`${BASE}/llm/models?provider=anthropic`);
    expect(modelRes.ok()).toBe(true);
    const { models } = await modelRes.json();
    expect(models.length).toBeGreaterThan(0);
    expect(models.map((m: any) => m.id)).toContain('claude-sonnet-4-6');
  });

  test('Create and archive agent', async ({ request }) => {
    // Create
    const createRes = await request.post(`${BASE}/agents`, {
      data: { name: 'E2E-Test-Agent', roles: ['worker'], runtimeType: 'xiaok' },
    });
    expect(createRes.ok()).toBe(true);
    const { agent } = await createRes.json();
    expect(agent.name).toBe('E2E-Test-Agent');

    // Archive
    const archiveRes = await request.delete(`${BASE}/agents/${agent.id}`);
    expect(archiveRes.ok()).toBe(true);

    // Verify archived
    const listRes = await request.get(`${BASE}/agents`);
    const { agents } = await listRes.json();
    expect(agents.find((a: any) => a.id === agent.id)).toBeFalsy();
  });

  test('Create project with full detail', async ({ request }) => {
    // Get a PO agent
    const agentsRes = await request.get(`${BASE}/agents`);
    const { agents } = await agentsRes.json();
    const po = agents.find((a: any) => a.roles?.includes('project_owner') && a.runtimeType === 'xiaok');
    expect(po).toBeTruthy();

    // Create project
    const createRes = await request.post(`${BASE}/projects`, {
      data: { name: 'E2E-Project', goal: 'verify full flow', poAgent: po.id },
    });
    expect(createRes.ok()).toBe(true);
    const { project } = await createRes.json();
    expect(project.id).toBeTruthy();

    // Get full detail
    const detailRes = await request.get(`${BASE}/projects/${project.id}`);
    expect(detailRes.ok()).toBe(true);
    const detail = await detailRes.json();
    expect(detail.tasks).toBeDefined();
    expect(detail.activities).toBeDefined();
    expect(detail.workspace).toBeDefined();
    expect(detail.workspace.path).toContain(project.id);

    // Cleanup: close project
    await request.post(`${BASE}/projects/${project.id}/close`);
  });

  test('Task failure and auto-retry', async ({ request }) => {
    // Get agents
    const agentsRes = await request.get(`${BASE}/agents`);
    const { agents } = await agentsRes.json();
    const po = agents.find((a: any) => a.roles?.includes('project_owner'));
    expect(po).toBeTruthy();

    // Create project
    const createRes = await request.post(`${BASE}/projects`, {
      data: { name: 'E2E-Retry-Project', goal: 'test retry', poAgent: po.id },
    });
    const { project } = await createRes.json();

    // Manually add a task (human endpoint doesn't require fromAgent)
    const addRes = await request.post(`${BASE}/projects/${project.id}/tasks/human`, {
      data: { tasks: [{ title: 'retry-test-task', description: 'will fail' }] },
    });
    expect(addRes.ok()).toBe(true);

    // Get tasks to find the one
    const detailRes = await request.get(`${BASE}/projects/${project.id}`);
    const { tasks } = await detailRes.json();
    const task = tasks.find((t: any) => t.title === 'retry-test-task');
    expect(task).toBeTruthy();

    // Fail the task with a retryable reason
    const failRes = await request.post(`${BASE}/projects/${project.id}/tasks/${task.id}/fail`, {
      data: { failureReason: 'timeout', errorMessage: 'task timed out' },
    });
    expect(failRes.ok()).toBe(true);
    const failBody = await failRes.json();
    expect(failBody.retried).toBe(true);
    expect(failBody.attempt).toBe(2);
    expect(failBody.retryTaskId).toBeTruthy();

    // Verify retry task exists (pending since no assignedAgent on original)
    const retryDetailRes = await request.get(`${BASE}/projects/${project.id}`);
    const { tasks: allTasks } = await retryDetailRes.json();
    const retryTask = allTasks.find((t: any) => t.id === failBody.retryTaskId);
    expect(retryTask).toBeTruthy();
    expect(retryTask.status).toBe('pending');

    // Cleanup
    await request.post(`${BASE}/projects/${project.id}/close`);
  });

  test('Agent heartbeat and liveness', async ({ request }) => {
    // Get an agent
    const agentsRes = await request.get(`${BASE}/agents`);
    const { agents } = await agentsRes.json();
    const agent = agents[0];
    expect(agent).toBeTruthy();

    // Send heartbeat
    const hbRes = await request.post(`${BASE}/agents/heartbeat`, {
      data: { agentId: agent.id },
    });
    expect(hbRes.ok()).toBe(true);

    // Check liveness
    const livenessRes = await request.get(`${BASE}/agents/liveness`);
    expect(livenessRes.ok()).toBe(true);
    const { liveness } = await livenessRes.json();
    const aLiveness = liveness[agent.id];
    expect(aLiveness).toBeTruthy();
    expect(aLiveness.online).toBe(true);
    expect(aLiveness.lastSeen).toBeGreaterThan(0);
  });

  test('Full project lifecycle: create → approve → dispatch → close', async ({ request }) => {
    // Ensure broker is healthy
    const brokerHealth = await request.get(`${BROKER}/health`);
    expect(brokerHealth.ok()).toBe(true);

    // Get a PO agent
    const agentsRes = await request.get(`${BASE}/agents`);
    const { agents } = await agentsRes.json();
    const po = agents.find((a: any) => a.name === 'PO' && a.roles?.includes('project_owner') && !a.roles?.includes('worker') && a.status !== 'offline')
      ?? agents.find((a: any) => a.roles?.includes('project_owner') && !a.roles?.includes('worker') && a.status !== 'offline')
      ?? agents.find((a: any) => a.roles?.includes('project_owner'));
    expect(po).toBeTruthy();

    const worker = agents.find((a: any) => a.id === 'cli-xiaok' && a.roles?.includes('worker'))
      ?? agents.find((a: any) => a.id === 'xiaok' && a.roles?.includes('worker'))
      ?? agents.find((a: any) => a.roles?.includes('worker') && a.status !== 'offline');
    expect(worker).toBeTruthy();
    const workerId = worker.id;
    const workerName = worker.name || worker.id;

    async function registerBrokerWorker(participantId: string, alias: string = participantId) {
      const res = await request.post(`${BROKER}/participants/register`, {
        data: { participantId, kind: 'agent', alias, roles: ['worker'], capabilities: ['coding'] },
      });
      expect(res.ok()).toBe(true);
    }

    // Register the same worker identity on broker so task lifecycle intents are accepted.
    await registerBrokerWorker(workerId, workerName);

    async function markWorkerAvailable() {
      const res = await request.put(`${BASE}/agents/${workerId}`, {
        data: { status: 'idle' },
      });
      expect(res.ok()).toBe(true);
    }

    // 1. Create project
    const createRes = await request.post(`${BASE}/projects`, {
      data: { name: 'E2E-Lifecycle', goal: 'full lifecycle test', poAgent: po.id, members: [workerId] },
    });
    expect(createRes.ok()).toBe(true);
    const { project } = await createRes.json();
    expect(project.status).toBe('created');

    // 2. Add tasks with agent assignment
    const addRes = await request.post(`${BASE}/projects/${project.id}/tasks/human`, {
      data: { tasks: [
        { title: 'task-alpha', description: 'first task', assignedAgent: workerId },
        { title: 'task-beta', description: 'second task', assignedAgent: workerId },
      ]},
    });
    expect(addRes.ok()).toBe(true);
    const { taskIds } = await addRes.json();
    expect(taskIds).toHaveLength(2);

    // 3. Approve project
    const approveRes = await request.post(`${BASE}/projects/${project.id}/approve`);
    expect(approveRes.ok()).toBe(true);

    // Verify project is now active
    const afterApprove = await (await request.get(`${BASE}/projects/${project.id}`)).json();
    expect(afterApprove.project.status).toBe('active');

    // 4. Dispatch tasks under the real packaged-app policy. Auto-workers may
    // already be executing one task by the time this request returns, so assert
    // the routing contract instead of manually impersonating the same worker.
    await markWorkerAvailable();
    const dispatchRes = await request.post(`${BASE}/projects/${project.id}/dispatch`, {
      data: { fromAgent: po.id },
    });
    expect(dispatchRes.ok()).toBe(true);
    const dispatchBody = await dispatchRes.json();

    const afterDispatch = await (await request.get(`${BASE}/projects/${project.id}`)).json();
    const lifecycleTasks = (afterDispatch.tasks || []).filter((task: any) => taskIds.includes(task.id));
    expect(lifecycleTasks).toHaveLength(2);

    const dispatchedCount = Array.isArray(dispatchBody.dispatched) ? dispatchBody.dispatched.length : 0;
    const skippedCount = Array.isArray(dispatchBody.skipped) ? dispatchBody.skipped.length : 0;
    const blockedCount = Array.isArray(dispatchBody.blocked) ? dispatchBody.blocked.length : 0;
    const workflowDispatchCount = Array.isArray(dispatchBody.workflowNodeDispatches)
      ? dispatchBody.workflowNodeDispatches.length
      : 0;
    const taskRoutingCount = lifecycleTasks.filter((task: any) => {
      return task.status !== 'pending' || task.selectedRoute || task.preferredAssignedAgent;
    }).length;
    expect(dispatchedCount + skippedCount + blockedCount + workflowDispatchCount + taskRoutingCount).toBeGreaterThan(0);

    // 5. Human closes project
    const closeRes = await request.post(`${BASE}/projects/${project.id}/close`, {
      data: { summary: 'E2E lifecycle verified' },
    });
    expect(closeRes.ok()).toBe(true);

    const afterClose = await (await request.get(`${BASE}/projects/${project.id}`)).json();
    expect(afterClose.project.status).toBe('closed');
    expect(afterClose.project.closedBy).toBe('human');
    expect(afterClose.activities.length).toBeGreaterThan(0);

  });
});
