/**
 * E2E: KSwarm integration flow tests (API-level, no Electron required)
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
 * Requires: kswarm server running on port 4400
 */

import { test, expect } from '@playwright/test';

const KSWARM_PORT = 4400;
const BROKER_PORT = 4318;
const BASE = `http://127.0.0.1:${KSWARM_PORT}`;
const BROKER = `http://127.0.0.1:${BROKER_PORT}`;

test.describe('KSwarm integration (API-level)', () => {

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
    expect(types).toContain('xiaok');
    expect(types).toContain('qoder');
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

  test('Full project lifecycle: create → approve → dispatch → execute → deliver → close', async ({ request }) => {
    // Ensure broker is healthy
    const brokerHealth = await request.get(`${BROKER}/health`);
    expect(brokerHealth.ok()).toBe(true);

    // Register a test worker on broker
    const regRes = await request.post(`${BROKER}/participants/register`, {
      data: { participantId: 'e2e-lifecycle-worker', kind: 'agent', alias: 'e2e-lifecycle-worker', roles: ['worker'], capabilities: ['coding'] },
    });
    expect(regRes.ok()).toBe(true);

    // Helper: send intent via broker targeting kswarm-hub
    async function sendIntent(kind: string, taskId: string, payload: any = {}) {
      const res = await request.post(`${BROKER}/intents`, {
        data: { kind, fromParticipantId: 'e2e-lifecycle-worker', taskId, to: { mode: 'role', roles: ['hub'] }, payload },
      });
      expect(res.ok()).toBe(true);
      // Allow async WS delivery
      await new Promise(r => setTimeout(r, 300));
    }

    // Get a PO agent
    const agentsRes = await request.get(`${BASE}/agents`);
    const { agents } = await agentsRes.json();
    const po = agents.find((a: any) => a.roles?.includes('project_owner'));
    expect(po).toBeTruthy();

    // 1. Create project
    const createRes = await request.post(`${BASE}/projects`, {
      data: { name: 'E2E-Lifecycle', goal: 'full lifecycle test', poAgent: po.id },
    });
    expect(createRes.ok()).toBe(true);
    const { project } = await createRes.json();
    expect(project.status).toBe('created');

    // 2. Add tasks with agent assignment
    const addRes = await request.post(`${BASE}/projects/${project.id}/tasks/human`, {
      data: { tasks: [
        { title: 'task-alpha', description: 'first task', assignedAgent: 'e2e-lifecycle-worker' },
        { title: 'task-beta', description: 'second task', assignedAgent: 'e2e-lifecycle-worker' },
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

    // 4. Dispatch tasks
    const dispatchRes = await request.post(`${BASE}/projects/${project.id}/dispatch`, {
      data: { fromAgent: po.id },
    });
    expect(dispatchRes.ok()).toBe(true);
    const dispatchBody = await dispatchRes.json();
    expect(dispatchBody.dispatched).toHaveLength(2);

    // 5. Worker accepts tasks (via broker)
    for (const taskId of taskIds) {
      await sendIntent('accept_task', taskId);
    }

    // 6. Worker reports progress (via broker)
    for (const taskId of taskIds) {
      await sendIntent('report_progress', taskId, { stage: 'started' });
    }

    // 7. Worker submits results (via broker)
    for (const taskId of taskIds) {
      await sendIntent('submit_result', taskId, { summary: `completed ${taskId}`, artifacts: [] });
    }

    // 8. PO marks tasks done
    for (const taskId of taskIds) {
      const res = await request.post(`${BASE}/projects/${project.id}/tasks/${taskId}/done`, {
        data: { fromAgent: po.id },
      });
      expect(res.ok()).toBe(true);
    }

    // Verify all tasks are done
    const afterDone = await (await request.get(`${BASE}/projects/${project.id}`)).json();
    const allDone = afterDone.tasks.every((t: any) => t.status === 'done');
    expect(allDone).toBe(true);

    // 9. PO delivers project
    const deliverRes = await request.post(`${BASE}/projects/${project.id}/deliver`, {
      data: { fromAgent: po.id, deliverable: { summary: 'All tasks completed successfully' } },
    });
    expect(deliverRes.ok()).toBe(true);

    const afterDeliver = await (await request.get(`${BASE}/projects/${project.id}`)).json();
    expect(afterDeliver.project.status).toBe('delivered');

    // 10. Human closes project
    const closeRes = await request.post(`${BASE}/projects/${project.id}/close`, {
      data: { summary: 'E2E lifecycle verified' },
    });
    expect(closeRes.ok()).toBe(true);

    const afterClose = await (await request.get(`${BASE}/projects/${project.id}`)).json();
    expect(afterClose.project.status).toBe('closed');
    expect(afterClose.project.closedBy).toBe('human');
    expect(afterClose.activities.length).toBeGreaterThan(10);
  });
});
