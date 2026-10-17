// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createKSwarmCreateProjectTool, runDesktopToolLoop } from '../../electron/desktop-services.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function tool() {
  return createKSwarmCreateProjectTool({ request: async () => Response.json({ agents: [
    { id: 'xiaok-po', name: 'PO', roles: ['po'], status: 'active' },
    { id: 'xiaok-worker', name: 'Worker', roles: ['worker'], status: 'active' },
  ] }) } as never);
}

describe('conversation project host receipt', () => {
  it('keeps report.md IR intermediate material from overriding final HTML delivery', async () => {
    const output = JSON.parse(String(await tool().execute({ name: 'xiaok介绍报告', goal: '最终交付为 HTML 报告 artifact',
      requirements: '报告撰写（生成 .report.md IR）、三路评审、修复后渲染为 HTML 报告 artifact；最终交付物为 HTML 文件' })));
    expect(output.proposal.planningGuidance).toContain('report renderer HTML');
    expect(output.proposal.planningGuidance).not.toContain('用户明确要求报告交付 Markdown');
  });
  it('persists and sends the real creation receipt to the model from the actual tool loop', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-receipt-')); roots.push(root);
    const registry = new ToolRegistry({ autoMode: true }, [tool()]);
    const messages: Parameters<typeof runDesktopToolLoop>[0]['messages'] = [{ role: 'user', content: [{ type: 'text', text: '创建项目' }] }];
    const emitRuntimeEvent = vi.fn(async () => {});
    const finalizeProjectProposal = vi.fn(async () => ({ ok: true, projectId: 'proj-real', project: { id: 'proj-real', status: 'planning' }, planningStart: { sent: true } }));
    let calls = 0;
    try {
      await runDesktopToolLoop({ adapter: { async *stream() {
        if (++calls === 1) yield { type: 'tool_use' as const, id: 'create-1', name: 'create_project', input: { name: '项目', goal: '完成 HTML 报告' } };
        else yield { type: 'text' as const, delta: '项目已创建' };
        yield { type: 'done' as const };
      } }, registry, allToolDefs: registry.getToolDefinitions(), messages, systemPrompt: '',
      signal: new AbortController().signal, taskDeadline: Date.now() + 30000, sessionId: 'sess-real', turnId: 'turn', taskId: 'task-real', intentId: 'intent', stepId: 'step',
      materials: [], emitRuntimeEvent, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(), finalizeProjectProposal,
      strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: m => m, processToolResult: r => r,
        trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
      expect(finalizeProjectProposal).toHaveBeenCalledOnce();
      expect(finalizeProjectProposal.mock.calls[0]?.[0]).toMatchObject({ kind: 'project_proposal', name: '项目' });
      const result = messages.flatMap(m => m.content).find(b => b.type === 'tool_result');
      expect(result?.type === 'tool_result' && result.content).toContain('proj-real');
      expect(emitRuntimeEvent.mock.calls.some(([event]: any[]) => event.type === 'post_tool_use' && event.toolResponse.includes('proj-real'))).toBe(true);
    } finally { registry.dispose(); }
  });

  it.each(['Markdown 不算交付完成', '不要 Markdown 报告，只交付 HTML', '不能只用 Markdown 代替最终报告'])(
    'keeps HTML report delivery when Markdown is negated: %s', async requirements => {
      const output = JSON.parse(String(await tool().execute({ name: '调研项目', goal: '交付带来源的 HTML 参考报告', requirements })));
      expect(output.proposal.planningGuidance).toContain('report renderer');
      expect(output.proposal.planningGuidance).not.toContain('用户明确要求报告交付 Markdown');
    });

  it('keeps an explicit Markdown deliverable', async () => {
    const output = JSON.parse(String(await tool().execute({ name: '调研项目', goal: '生成报告并交付 Markdown 文件' })));
    expect(output.proposal.planningGuidance).toContain('用户明确要求报告交付 Markdown');
  });
});
