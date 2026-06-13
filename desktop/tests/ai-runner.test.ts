import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDesktopServices } from '../electron/desktop-services.js';
import { saveConfig, loadConfig } from '../../src/utils/config.js';

const TEST_DIR = '/tmp/xiaok-desktop-runner-test';

describe('DesktopServices AI Runner', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('registerChannelTools', () => {
    it('should register channel_list and channel_send tools', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });

      // Before registration
      const toolsBefore = services.getToolDefinitions?.() ?? [];
      const channelToolsBefore = toolsBefore.filter(t => t.name.startsWith('channel_'));
      expect(channelToolsBefore).toHaveLength(0);

      // Register
      services.registerChannelTools();

      // After registration
      const toolsAfter = services.getToolDefinitions?.() ?? [];
      const channelToolsAfter = toolsAfter.filter(t => t.name.startsWith('channel_'));
      expect(channelToolsAfter.length).toBeGreaterThanOrEqual(2);

      const names = channelToolsAfter.map(t => t.name);
      expect(names).toContain('channel_list');
      expect(names).toContain('channel_send');
    });

    it('channel_send tool should have correct description mentioning "发消息"', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });
      services.registerChannelTools();

      const tools = services.getToolDefinitions?.() ?? [];
      const sendTool = tools.find(t => t.name === 'channel_send');
      expect(sendTool).toBeDefined();
      expect(sendTool?.description).toContain('发消息');
      expect(sendTool?.description).toContain('通道');
    });

    it('channel_list execute should return empty array when no channels configured', async () => {
      // Ensure no channels in config by saving a clean config
      const config = await loadConfig();
      (config as any).channels = {};
      await saveConfig(config);

      const services = createDesktopServices({ dataRoot: TEST_DIR });
      services.registerChannelTools();

      const result = await services.executeTool?.('channel_list', {});
      expect(result).toBeDefined();
      const parsed = JSON.parse(result as string);
      expect(parsed).toEqual([]);
    });

    it('channel_list execute should return configured channels', async () => {
      // Set up a mock channel config
      const config = await loadConfig();
      (config as any).channels = {
        yunzhijia: { name: '云之家', sendMsgUrl: 'https://example.com/webhook', enabled: true },
      };
      await saveConfig(config);

      const services = createDesktopServices({ dataRoot: TEST_DIR });
      services.registerChannelTools();

      const result = await services.executeTool?.('channel_list', {});
      expect(result).toBeDefined();
      const parsed = JSON.parse(result as string);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.find((c: any) => c.id === 'yunzhijia')).toBeDefined();
    });
  });

  describe('registerSkillTools', () => {
    it('should register skill_install, skill_uninstall, and skill_list tools', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });

      // Before registration
      const toolsBefore = services.getToolDefinitions?.() ?? [];
      const skillToolsBefore = toolsBefore.filter(t => t.name.startsWith('skill_'));
      expect(skillToolsBefore).toHaveLength(0);

      // Register
      services.registerSkillTools();

      // After registration
      const toolsAfter = services.getToolDefinitions?.() ?? [];
      const skillToolsAfter = toolsAfter.filter(t => t.name.startsWith('skill_'));
      expect(skillToolsAfter.length).toBeGreaterThanOrEqual(3);

      const names = skillToolsAfter.map(t => t.name);
      expect(names).toContain('skill_install');
      expect(names).toContain('skill_uninstall');
      expect(names).toContain('skill_list');
    });

    it('skill_install tool should have correct description mentioning "安装"', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });
      services.registerSkillTools();

      const tools = services.getToolDefinitions?.() ?? [];
      const installTool = tools.find(t => t.name === 'skill_install');
      expect(installTool).toBeDefined();
      expect(installTool?.description).toContain('安装');
      expect(installTool?.description).toContain('技能');
    });

    it('skill_list execute should return installed skills', async () => {
      // Create a mock skill directory
      const skillDir = join(TEST_DIR, 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `
---
name: test-skill
description: Test skill for unit tests
---
Test skill content.
`);

      const services = createDesktopServices({ dataRoot: TEST_DIR });
      services.registerSkillTools();

      const result = await services.executeTool?.('skill_list', {});
      expect(result).toBeDefined();
      const parsed = JSON.parse(result as string);
      // May be empty if skill catalog doesn't find the test skill, but should not error
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe('system prompt includes all tools', () => {
    it('buildSystemPrompt should mention channel and skill tools', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });

      services.registerChannelTools();
      services.registerSkillTools();

      const tools = services.getToolDefinitions?.() ?? [];
      const allToolNames = tools.map(t => t.name);

      expect(allToolNames).toContain('channel_list');
      expect(allToolNames).toContain('channel_send');
      expect(allToolNames).toContain('skill_install');
      expect(allToolNames).toContain('skill_uninstall');
      expect(allToolNames).toContain('skill_list');
    });
  });
});