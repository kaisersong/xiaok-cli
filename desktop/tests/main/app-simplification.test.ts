import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('desktop simplified interaction', () => {
  it('uses a simplified local desktop shell without chat or incognito modes', async () => {
    const renderer = await readFile(join(repoRoot, 'desktop', 'renderer', 'src', 'main.tsx'), 'utf8');
    const styles = await readFile(join(repoRoot, 'desktop', 'renderer', 'src', 'styles.css'), 'utf8');

    expect(renderer).toContain('auth-shell');
    expect(renderer).toContain('desktop-titlebar');
    expect(renderer).toContain('app-sidebar');
    expect(renderer).toContain('sidebar-settings-button');
    expect(renderer).toContain('settings-view');
    expect(renderer).not.toContain('settings-modal');
    expect(renderer).not.toContain('settings-overlay');
    expect(renderer).toContain('Providers');
    expect(renderer).toContain('Agents');
    expect(renderer).toContain('Channels');
    expect(renderer).toContain('Security');
    expect(renderer).toContain('Advanced');
    expect(renderer).toContain('work-surface');
    expect(renderer).toContain('conversation-pane');
    expect(renderer).toContain('canvas-panel');
    expect(renderer).toContain('TaskRecord');
    expect(renderer).toContain('className="composer-card"');
    expect(renderer).not.toContain('<h1>xiaok</h1>');
    expect(styles).not.toContain('.brand-row h1');
    const externalProductName = ['Ark', 'loop'].join('');
    expect(renderer).not.toContain(externalProductName);
    expect(styles).not.toContain(externalProductName);
    expect(renderer).not.toContain('无痕');
    expect(renderer).not.toContain('incognito');
    expect(renderer).not.toContain('Chat');
    expect(renderer).not.toContain('className="workspace"');
    expect(renderer).not.toContain('Needs You');
    expect(renderer).not.toContain('任务理解');
    expect(renderer).not.toContain('建议计划');
    expect(renderer).not.toContain('正在解析材料');
    expect(renderer).not.toContain('已生成可继续细化的方案大纲');
    expect(renderer).not.toContain('<span>完成</span>');
    expect(renderer).toContain('conversation-thread');
    expect(renderer).toContain('onComposerKeyDown');
    expect(renderer).toContain('useState<DialogueMessage[]>([])');
    expect(renderer).toContain('appendAssistantDelta');
    expect(renderer).toContain('CanvasPanel');
    expect(renderer).toContain('upsertTaskRecord');
    expect(renderer).toContain('thread.scrollTop = thread.scrollHeight');
    expect(renderer).not.toContain('添加材料');
    expect(renderer).not.toContain('客户材料');
    expect(renderer).not.toContain('>发送<');
    expect(renderer).toContain("addFiles: '添加文件或文件夹'");
    expect(renderer).toContain("sendTask: '发送任务'");
    expect(renderer).not.toContain('recoverTask(activeTask.taskId)');
    expect(renderer).toContain('cancelTask(activeTask.taskId)');
    expect(styles).toContain('.work-surface');
    expect(styles).toContain('.conversation-pane');
    expect(styles).toContain('.canvas-panel');
    expect(styles).not.toContain('grid-template-columns: 300px minmax(420px, 1fr) 320px');
  });

  it('defaults settings to Chinese through a basic zh/en localization table', async () => {
    const renderer = await readFile(join(repoRoot, 'desktop', 'renderer', 'src', 'main.tsx'), 'utf8');

    expect(renderer).toContain("useState<Locale>('zh')");
    expect(renderer).toContain('const translations: Record<Locale');
    expect(renderer).toContain("settings: '设置'");
    expect(renderer).toContain("providers: '模型服务'");
    expect(renderer).toContain("settings: 'Settings'");
    expect(renderer).toContain("providers: 'Providers'");
    expect(renderer).toContain('onLocaleChange');
    expect(renderer).not.toContain('<strong>Settings</strong>');
    expect(renderer).not.toContain("label: 'Providers'");
    expect(renderer).not.toContain('title="Language"');
  });
});
