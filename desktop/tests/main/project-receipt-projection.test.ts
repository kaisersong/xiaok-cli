// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { projectRuntimeEventsToDesktopEvents } from '../../../src/runtime/task-host/event-projection.js';
import { formatTaskToolResultResponse } from '../../../src/runtime/task-host/tool-result-response.js';
import { buildCompletionEvidenceContext } from '../../../src/runtime/task-host/delivery-pure.js';
import { buildProjectCardMessageFromToolResult } from '../../renderer/src/components/chatToolResultMessages.js';

function project(raw: unknown, toolName = 'create_project') {
  return projectRuntimeEventsToDesktopEvents({ taskId: 'task-test', events: [{ type: 'post_tool_use', sessionId: 'session-test', turnId: 'turn-test', toolName, toolUseId: 'create-test', toolResponse: raw }] });
}
describe('bounded semantic creation receipt transport', () => {
  it('keeps a valid large receipt clickable and usable by real delivery classification through both truncation sites', () => {
    const receipt = { ok: true, project: { id: 'proj-test', name: '项目', goal: 'g'.repeat(30000), requirements: 'r'.repeat(50000), members: [1, 2, 3], status: 'planning' }, created: true, projectId: 'proj-test', planningStart: { sent: true } };
    const emitted = formatTaskToolResultResponse('create_project', JSON.stringify(receipt));
    const events = project(emitted);
    const event = events.find(e => e.type === 'canvas_tool_result')!;
    expect(event.type).toBe('canvas_tool_result');
    if (event.type !== 'canvas_tool_result') throw Error('missing result');
    expect(event.response.length).toBeLessThanOrEqual(10000);
    expect(buildProjectCardMessageFromToolResult(event.response)?.projectData).toMatchObject({ projectId: 'proj-test', name: '项目', memberCount: 3, status: 'planning' });
    const facts = buildCompletionEvidenceContext('task-test', { taskId: 'task-test', sessionId: 'session-test', prompt: '创建项目', status: 'completed', materials: [], events, createdAt: 1, updatedAt: 2 });
    expect(facts.evidence).toContainEqual(expect.objectContaining({ kind: 'project_update', metadata: expect.objectContaining({ projectId: 'proj-test' }) }));
  });
  it.each([
    { ok: false, created: true, project: { id: 'p', name: 'P' } },
    { ok: true, created: false, project: { id: 'p', name: 'P' } },
    { ok: true, proposal: { id: 'p', name: 'P' } },
    { ok: true, created: true, projectId: 'foreign', project: { id: 'p', name: 'P' } },
  ])('does not manufacture a card from noncreation or conflicting data: %j', raw => {
    const value = formatTaskToolResultResponse('create_project', raw);
    expect(buildProjectCardMessageFromToolResult(value)).toBeNull();
  });
  it('preserves old cards and ordinary tool preview limits', () => {
    expect(buildProjectCardMessageFromToolResult(formatTaskToolResultResponse('create_project', { type: 'project_card', projectId: 'p', name: 'P' }))?.projectData?.projectId).toBe('p');
    expect(formatTaskToolResultResponse('bash', 'x'.repeat(20000))).toHaveLength(10000);
  });
});
