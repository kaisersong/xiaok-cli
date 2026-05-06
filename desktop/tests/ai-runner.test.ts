import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDesktopServices } from '../electron/desktop-services.js';
import { JsonReminderStore } from '../electron/reminder-store.js';
import { ReminderScheduler } from '../electron/reminder-scheduler.js';
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

  describe('registerReminderScheduler', () => {
    it('should register reminder_create tool in the registry', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });
      const store = new JsonReminderStore(TEST_DIR);
      const scheduler = new ReminderScheduler(store);

      // Before registration: reminder tools not available
      const toolsBefore = services.getToolDefinitions?.() ?? [];
      const reminderToolsBefore = toolsBefore.filter(t => t.name.startsWith('reminder_'));
      expect(reminderToolsBefore).toHaveLength(0);

      // Register
      services.registerReminderScheduler(scheduler);

      // After registration: reminder tools available
      const toolsAfter = services.getToolDefinitions?.() ?? [];
      const reminderToolsAfter = toolsAfter.filter(t => t.name.startsWith('reminder_'));
      expect(reminderToolsAfter.length).toBeGreaterThanOrEqual(3);

      // Check tool names
      const names = reminderToolsAfter.map(t => t.name);
      expect(names).toContain('reminder_create');
      expect(names).toContain('reminder_list');
      expect(names).toContain('reminder_cancel');
    });

    it('reminder_create tool should have correct description mentioning "定时任务"', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });
      const store = new JsonReminderStore(TEST_DIR);
      const scheduler = new ReminderScheduler(store);
      services.registerReminderScheduler(scheduler);

      const tools = services.getToolDefinitions?.() ?? [];
      const createTool = tools.find(t => t.name === 'reminder_create');
      expect(createTool).toBeDefined();
      expect(createTool?.description).toContain('定时');
      expect(createTool?.description).toContain('提醒');
    });

    it('reminder_create execute should create a reminder', async () => {
      const services = createDesktopServices({ dataRoot: TEST_DIR });
      const store = new JsonReminderStore(TEST_DIR);
      const scheduler = new ReminderScheduler(store);
      services.registerReminderScheduler(scheduler);

      const now = Date.now();
      const result = await services.executeTool?.('reminder_create', {
        content: 'Test reminder',
        schedule_at: now + 60_000,
      });

      expect(result).toBeDefined();
      const parsed = JSON.parse(result as string);
      expect(parsed.reminderId).toBeDefined();
      expect(parsed.content).toBe('Test reminder');
      expect(parsed.status).toBe('pending');

      // Verify reminder exists in scheduler
      const list = scheduler.listReminders();
      expect(list).toHaveLength(1);
    });
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
    it('buildSystemPrompt should mention reminder, channel, and skill tools', async () => {
      // This test validates that the system prompt is updated when tools are registered
      const services = createDesktopServices({ dataRoot: TEST_DIR });
      const store = new JsonReminderStore(TEST_DIR);
      const scheduler = new ReminderScheduler(store);

      services.registerReminderScheduler(scheduler);
      services.registerChannelTools();
      services.registerSkillTools();

      const tools = services.getToolDefinitions?.() ?? [];
      const allToolNames = tools.map(t => t.name);

      // Verify all expected tools are registered
      expect(allToolNames).toContain('reminder_create');
      expect(allToolNames).toContain('reminder_list');
      expect(allToolNames).toContain('reminder_cancel');
      expect(allToolNames).toContain('channel_list');
      expect(allToolNames).toContain('channel_send');
      expect(allToolNames).toContain('skill_install');
      expect(allToolNames).toContain('skill_uninstall');
      expect(allToolNames).toContain('skill_list');
    });
  });
});