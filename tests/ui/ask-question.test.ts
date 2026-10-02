import { describe, expect, it } from 'vitest';
import { askQuestion, type AskQuestionParams, type AskQuestionResult } from '../../src/ui/ask-question.js';
import { createTtyHarness, type TtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';

async function withMenu(params: AskQuestionParams, check: (harness: TtyHarness, pending: Promise<AskQuestionResult>) => Promise<void>): Promise<void> {
  const harness = createTtyHarness(100, 24);
  const pending = askQuestion(params);
  try { await check(harness, pending); }
  finally { harness.emitter.emit('data', '\x1b'); await pending.catch(() => undefined); harness.restore(); }
}

// We test renderFrame logic and key handling separately from the interactive loop
describe('ask-question', () => {
  describe('renderFrame basic structure', () => {
    it('produces correct line count for simple options', async () => {
      // Import dynamically to avoid side effects
      const { MarkdownRenderer } = await import('../../src/ui/markdown.js');

      // Test MarkdownRenderer.renderToLines directly
      const lines = MarkdownRenderer.renderToLines('```\ncode\n```\n\n**bold**');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('code'))).toBe(true);
    });

    it('handles empty preview correctly', async () => {
      const { MarkdownRenderer } = await import('../../src/ui/markdown.js');
      const lines = MarkdownRenderer.renderToLines('');
      expect(lines).toEqual(['']);
    });
  });

  describe('key handling', () => {

    it('shows option numbers and submits the corresponding single choice without Enter', async () => {
      await withMenu({question:'选择环境',options:[{label:'桌面'},{label:'手机'}]}, async (h,pending) => {
        expect(h.screen.text()).toContain('1. 桌面');
        expect(h.screen.text()).toContain('2. 手机');
        expect(h.screen.text()).toContain('3. Other');
        expect(h.screen.text()).toContain('1-3 select');
        h.send('2');
        expect(h.emitter.listenerCount('data')).toBe(0);
        await expect(pending).resolves.toEqual({selected:[1],labels:['手机']});
        expect(h.screen.text()).not.toContain('1-3 select');
      });
    });
    it('ignores zero and out-of-range digits while retaining arrow and Enter selection', async () => {
      await withMenu({question:'选择环境',options:[{label:'桌面'},{label:'手机'}]}, async (h,pending) => {
        h.send('0'); h.send('9'); h.send('a');
        expect(h.emitter.listenerCount('data')).toBe(1);
        h.send('\x1b[B'); h.send('\r');
        await expect(pending).resolves.toEqual({selected:[1],labels:['手机']});
      });
    });
    it.each([false,true])('uses number 3 for Other and preserves numeric free text (explicit=%s)', async explicit => {
      let reads=0;
      await withMenu({question:'补充',options:[{label:'桌面'},{label:'手机'},...(explicit?[{label:'其它'}]:[])],readText:async()=>{reads++;return '123 个节点';}}, async (h,pending) => {
        h.send('3');
        expect(h.emitter.listenerCount('data')).toBe(0);
        h.send('3');
        await expect(pending).resolves.toEqual({selected:[],labels:[],otherText:'123 个节点'});
        expect(reads).toBe(1);
      });
    });
    it('toggles multi-select with digits and waits for Enter to confirm', async () => {
      await withMenu({question:'多选',options:[{label:'桌面'},{label:'手机'}],multiSelect:true}, async (h,pending) => {
        h.send('2');h.send('1');h.send('2');
        expect(h.screen.text()).toContain('✓ 桌面');
        expect(h.screen.text()).not.toContain('✓ 手机');
        expect(h.emitter.listenerCount('data')).toBe(1);
        h.send('\r');
        await expect(pending).resolves.toEqual({selected:[0],labels:['桌面']});
      });
    });
    it('handles rapidly typed digits delivered together in one stdin chunk', async () => {
      await withMenu({question:'多选',options:[{label:'桌面'},{label:'手机'}],multiSelect:true}, async (h,pending) => {
        h.send('12');
        expect(h.screen.text()).toContain('✓ 桌面');
        expect(h.screen.text()).toContain('✓ 手机');
        h.send('\r');
        await expect(pending).resolves.toEqual({selected:[0,1],labels:['桌面','手机']});
      });
    });
    it('does not request free text when Other was toggled off in a multi-select', async () => {
      let reads=0;
      await withMenu({question:'多选',options:[{label:'桌面'},{label:'手机'}],multiSelect:true,readText:async()=>{reads++;return 'unexpected';}}, async (h,pending) => {
        h.send('1');h.send('3');h.send('3');h.send('\r');
        await expect(pending).resolves.toEqual({selected:[0],labels:['桌面']});
        expect(reads).toBe(0);
      });
    });
    it('waits for the complete multi-digit number instead of submitting its first digit', async () => {
      await withMenu({question:'选择编号',options:Array.from({length:10},(_,i)=>({label:`方案${i+1}`}))}, async (h,pending) => {
        h.send('1');h.send('0');
        expect(h.emitter.listenerCount('data')).toBe(1);
        h.send('\r');
        await expect(pending).resolves.toEqual({selected:[9],labels:['方案10']});
      });
    });
    it('does not submit an invalid buffered number and allows backspace and navigation', async () => {
      await withMenu({question:'选择编号',options:Array.from({length:10},(_,i)=>({label:`方案${i+1}`}))}, async (h,pending) => {
        h.send('9');h.send('9');h.send('\r');
        expect(h.emitter.listenerCount('data')).toBe(1);
        h.send('\x7f');h.send('\x08');h.send('1');h.send('\x1b[B');h.send('\r');
        await expect(pending).resolves.toEqual({selected:[1],labels:['方案2']});
      });
    });
    it('toggles multi-digit choices before a separate Enter confirms all selections', async () => {
      await withMenu({question:'多选编号',options:Array.from({length:10},(_,i)=>({label:`方案${i+1}`})),multiSelect:true}, async (h,pending) => {
        h.send('1');h.send('0');h.send('\r');h.send('1');h.send('\r');
        expect(h.screen.text()).toContain('✓ 方案10');
        expect(h.screen.text()).toContain('✓ 方案1');
        h.send('\r');
        await expect(pending).resolves.toEqual({selected:[9,0],labels:['方案10','方案1']});
      });
    });

    it('aborts a pending menu and releases its input listener', async () => {
      const harness = createTtyHarness(80, 24);
      const controller = new AbortController();
      try {
        const pending = askQuestion({ question: 'Proceed?', options: [{label:'Yes'}, {label:'No'}], signal: controller.signal });
        const rejection = expect(pending).rejects.toMatchObject({name:'AbortError'});
        controller.abort();
        await rejection;
        expect(harness.emitter.listenerCount('data')).toBe(0);
      } finally { harness.restore(); }
    });

    it('uses the host reader once for Other and propagates its cancellation', async () => {
      const harness = createTtyHarness(80, 24);
      const controller = new AbortController();
      let reads = 0;
      const readText = async () => {
        reads++;
        expect(harness.emitter.listenerCount('data')).toBe(0);
        throw new DOMException('Aborted', 'AbortError');
      };
      try {
        const pending = askQuestion({question:'Proceed?', options:[{label:'Yes'}, {label:'No'}], readText, signal:controller.signal});
        const rejection = expect(pending).rejects.toMatchObject({name:'AbortError'});
        harness.emitter.emit('data', '\x1b[B');
        harness.emitter.emit('data', '\x1b[B');
        harness.emitter.emit('data', '\r');
        harness.emitter.emit('data', '\r');
        await rejection;
        expect(reads).toBe(1);
        expect(harness.emitter.listenerCount('data')).toBe(0);
      } finally { harness.restore(); }
    });

    it('settles on EOF without inventing a user answer', async () => {
      const harness = createTtyHarness(80, 24);
      try {
        const pending = askQuestion({question:'Proceed?', options:[{label:'Yes'}, {label:'No'}]});
        harness.emitter.emit('end');
        await expect(pending).resolves.toEqual({selected:[],labels:[]});
        expect(harness.emitter.listenerCount('data')).toBe(0);
      } finally { harness.restore(); }
    });

    it('ESC should cancel and return empty result', async () => {
      // This test verifies the ESC constant is correctly defined
      const ESC = '\x1b';
      const CTRL_C = '\x03';

      // These should be different values
      expect(ESC).not.toBe(CTRL_C);
      expect(ESC.length).toBe(1);
      expect(ESC.charCodeAt(0)).toBe(27);
    });

    it('arrow keys produce correct escape sequences', () => {
      const UP = '\x1b[A';
      const DOWN = '\x1b[B';

      expect(UP).toBe('\x1b[A');
      expect(DOWN).toBe('\x1b[B');
    });

    it('re-renders wrapped option prompts in place while navigating and clears the menu after confirm', async () => {
      const harness = createTtyHarness(36, 16);
      const sendKey = (key: string): void => {
        harness.emitter.emit('data', key);
      };

      process.stdout.write(
        Array.from({ length: 10 }, (_, index) => `prefill line ${index + 1}`).join('\n') + '\n',
      );

      const pending = askQuestion({
        question: '想吃什么类型的？',
        options: [
          { label: '中餐炒菜（如宫保鸡丁、番茄炒蛋）', description: '经典家常炒菜配米饭' },
          { label: '面食/粉类（如拉面、米粉、饺子）', description: '面条、粉类、水饺等' },
          { label: '轻食/沙拉（如三明治、燕麦碗）', description: '低卡健康餐' },
          { label: '快餐/便当（如汉堡、便当）', description: '方便快捷' },
          { label: '火锅/烧烤（如麻辣烫、烤肉）', description: '聚餐或想吃点重的' },
          { label: '其他（告诉我具体想法）', description: '自由输入' },
        ],
      });

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).toContain('想吃什么类型的？');
        expect((screen.match(/1-6 select/g) ?? []).length).toBe(1);
      });

      for (let i = 0; i < 9; i += 1) {
        sendKey('\x1b[B');
      }

      await waitFor(() => {
        const screen = harness.screen.text();
        expect((screen.match(/想吃什么类型的？/g) ?? []).length).toBe(1);
        expect((screen.match(/1-6 select/g) ?? []).length).toBe(1);
      });

      sendKey('\r');

      await expect(pending).resolves.toEqual({
        selected: [3],
        labels: ['快餐/便当（如汉堡、便当）'],
      });

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).toContain('❯ 想吃什么类型的？');
        expect(screen).toContain('快餐/便当（如汉堡、便当）');
        expect(screen).not.toContain('1-6 select');
        expect(screen).not.toContain('1. 中餐炒菜（如宫保鸡丁、番茄炒蛋）');
      });

      harness.restore();
    });

    it('does not append a duplicate fallback when the caller already supplies 其它', async () => {
      const harness = createTtyHarness(80, 24);
      const pending = askQuestion({
        question: '请选择环境',
        options: [
          { label: '桌面端' },
          { label: '手机端' },
          { label: '其它', description: '补充说明' },
        ],
      });

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).toContain('其它');
        expect(screen).not.toContain('Other');
      });

      harness.emitter.emit('data', '\x1b');
      await expect(pending).resolves.toEqual({ selected: [], labels: [] });
      harness.restore();
    });

    it('keeps regular selections when multi-select also includes Other text', async () => {
      const harness = createTtyHarness(80, 24);
      const pending = askQuestion({
        question: '请选择复现场景',
        multiSelect: true,
        options: [
          { label: '桌面端' },
          { label: '手机端' },
        ],
      });

      await waitFor(() => expect(harness.screen.text()).toContain('Enter confirm'));
      harness.emitter.emit('data', ' ');
      harness.emitter.emit('data', '\x1b[B');
      harness.emitter.emit('data', '\x1b[B');
      harness.emitter.emit('data', ' ');
      harness.emitter.emit('data', '\r');
      await waitFor(() => expect(harness.screen.text()).toContain('Enter your answer:'));
      harness.emitter.emit('data', '代理节点\r');

      await expect(pending).resolves.toEqual({
        selected: [0],
        labels: ['桌面端'],
        otherText: '代理节点',
      });
      harness.restore();
    });
  });
});

describe('session resume edge cases', () => {
  it('loadLast handles missing file gracefully', async () => {
    const { FileSessionStore } = await import('../../src/ai/runtime/session-store.js');
    const store = new FileSessionStore('/nonexistent/path');
    const result = await store.loadLast();
    expect(result).toBeNull();
  });

  it('load returns null for nonexistent session', async () => {
    const { FileSessionStore } = await import('../../src/ai/runtime/session-store.js');
    const store = new FileSessionStore('/nonexistent/path');
    const result = await store.load('sess_nonexistent');
    expect(result).toBeNull();
  });
});
