import { afterEach, describe, expect, it } from 'vitest';
import { MultiAgentProgressView, SubAgentNoticeQueue } from '../../src/ui/multi-agent-progress.js';
import { describeToolActivity, setColorsEnabled, setTheme } from '../../src/ui/render.js';
import { getDisplayWidth, stripAnsi } from '../../src/ui/text-metrics.js';

function event(id = 'a', turn = 1, kind = 'started') {
  return { agentId: id, taskName: 'review', turn, kind, timestamp: 1_000, startedAt: 1_000, elapsedMs: 0,
    task: '检查队列与取消', status: 'running', toolsCompleted: 0, toolsFailed: 0, toolCounts: {} } as any;
}

describe('subagent presentation', () => {
  afterEach(() => { setTheme('default'); setColorsEnabled(false); });
  it('describes both delegation entry points, with terminal-safe task text', () => {
    for (const tool of ['subagent', 'spawn_agent']) {
      const text = describeToolActivity(tool, { prompt: 'TASK\x1b[2J', message: 'TASK\x1b[2J' });
      expect(text).toContain('安排 SubAgent');
      expect(text).toContain('TASK');
      expect(text).not.toContain('\x1b');
    }
  });

  it('defers notices while a prompt or stream owns the output, then flushes in order exactly once', () => {
    const queue = new SubAgentNoticeQueue();
    const written: string[] = [];
    queue.push('start'); queue.push('finish');
    queue.flush(false, text => written.push(text));
    expect(written).toEqual([]);
    queue.flush(true, text => written.push(text));
    queue.flush(true, text => written.push(text));
    expect(written).toEqual(['start\nfinish']);
  });
  it('announces real delegation, assigns distinct constellations and retains assignment in live progress', () => {
    const view = new MultiAgentProgressView();
    expect(view.updateRun(event())).toContain('双鱼座');
    const second = view.updateRun(event('b'));
    expect(second).toContain('天秤座');
    expect(view.updateRun(event('c'))).toContain('白羊座');
    expect(second).toContain('SubAgent');
    expect(second).toContain('╭─');
    expect(second).toContain('│');
    expect(second).toContain('检查队列与取消');
    expect(view.summary(5_000, 160)).toContain('双鱼座');
    expect(view.summary(5_000, 160)).toContain('天秤座');
  });

  it('puts all ten agents on separate rows even on narrow terminals', () => {
    const view = new MultiAgentProgressView();
    for (let i = 0; i < 10; i++) view.updateRun(event(String(i)));
    for (const width of [45, 160]) {
      const lines = view.summary(5_000, width).split('\n');
      expect(lines).toHaveLength(10);
      expect(lines.every(line => line.startsWith('SubAgent '))).toBe(true);
      expect(lines.every(line => getDisplayWidth(line) <= width)).toBe(true);
    }
  });

  it('uses one shared italic accent for every codename, including more than twelve instances', () => {
    setColorsEnabled(true);
    const view = new MultiAgentProgressView();
    const first = view.updateRun(event());
    const second = view.updateRun(event('b'));
    const code = (text: string, name: string) => text.match(new RegExp(`((?:\\x1b\\[[0-9;]+m)+)${name}\\x1b\\[0m`))?.[1];
    const pisces = code(first, '双鱼座'); const libra = code(second, '天秤座');
    expect(pisces).toMatch(/\x1b\[3(?:;|m)/);
    expect(pisces).toContain('38;2;');
    expect(libra).toBe(pisces);
    for (let i = 2; i < 20; i++) {
      const notice = view.updateRun(event(`agent-${i}`));
      expect(notice.match(/(?:\x1b\[[0-9;]+m)+/)?.[0]).toBe(pisces);
    }
    expect(code(view.summary(5_000, 160), '双鱼座')).toBe(pisces);
    expect(code(view.updateRun(event('a', 2)), '双鱼座')).toBe(pisces);
    const narrow = view.summary(5_000, 17);
    for (const line of narrow.split('\n')) expect(getDisplayWidth(line)).toBeLessThanOrEqual(17);
    if (narrow.includes('\x1b')) expect(narrow).toMatch(/\x1b\[0m$/);
    for (const text of [first, second]) expect(stripAnsi(text)).not.toMatch(/子\s*Agent/);
  });

  it('keeps the same text identity and metrics in plain/no-color output', () => {
    setTheme('plain');
    const view = new MultiAgentProgressView();
    const first = view.updateRun(event());
    expect(first).toContain('SubAgent'); expect(first).toContain('双鱼座');
    expect(first).not.toContain('\x1b');
    expect(view.summary(5_000, 100)).not.toContain('\x1b');
  });

  it('reports actual per-turn work and time once; followup preserves alias', () => {
    const view = new MultiAgentProgressView();
    view.updateRun(event());
    const done = { ...event(), kind: 'finished', status: 'completed', elapsedMs: 65_000,
      timestamp: 66_000, toolsCompleted: 3, toolsFailed: 1, toolCounts: { read: 2, bash: 1 }, resultSummary: '发现两处问题' };
    const summary = view.updateRun(done);
    expect(summary).toContain('双鱼座');
    expect(summary).toContain('3 次工具调用');
    expect(summary).toContain('1 次失败');
    expect(summary).toContain('1m5s');
    expect(summary).toContain('发现两处问题');
    expect(summary).toContain('检查队列与取消');
    expect(view.updateRun(done)).toBe('');
    expect(view.updateRun(event('a', 2))).toContain('双鱼座');
    expect(view.summary(5_000, 160)).toContain('4s');
    expect(view.updateRun(done)).toBe(''); // stale previous turn
  });

  it('does not reuse names after the 12th instance, sanitizes terminal controls and localizes', () => {
    const view = new MultiAgentProgressView();
    for (let i = 0; i < 12; i++) view.updateRun(event(String(i)));
    expect(view.updateRun(event('13'))).toContain('双鱼座-2');
    const hostile = { ...event('unsafe'), task: '\x1b]0;unsafe\x07\x1b[2J任务\n新行' };
    const text = view.updateRun(hostile);
    expect(text).not.toContain('\x1b');
    expect(text).not.toContain('unsafe');
    expect(text).toContain('任务 新行');
    const english = new MultiAgentProgressView();
    expect(english.updateRun(event(), 100, 'en')).toContain('Pisces');
    expect(english.updateRun(event('b'), 100, 'en')).toContain('Libra');
    expect(english.updateRun({ ...event(), kind: 'finished', status: 'failed' }, 100, 'en')).toContain('failed');
  });
});
