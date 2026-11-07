import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { runStatuslineCommand } from "../../src/commands/chat-statusline.js";
import { StatusBar } from "../../src/ui/statusbar.js";
import {
  DEFAULT_STATUSLINE_FIELDS,
  loadStatuslineConfiguration,
  saveStatuslineFields,
  statuslinePreferencePath,
} from "../../src/ui/statusline-preferences.js";

describe("statusline production configuration and command regression", () => {
  let root: string;
  let config: string;
  let cwd: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "xiaok-statusline-review-"));
    config = join(root, "config");
    cwd = join(root, "project");
    mkdirSync(config);
    mkdirSync(join(cwd, ".xiaok"), { recursive: true });
    vi.stubEnv("XIAOK_CONFIG_DIR", config);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  const legacy = (fields: string[]) =>
    JSON.stringify({ ui: { statusBar: { fields } } });
  function bar() {
    const result = new StatusBar();
    result.init("model-review", "session-review", cwd, "plan");
    return result;
  }

  it("uses project legacy over global, then explicit preferences including off over both", () => {
    writeFileSync(join(config, "settings.json"), legacy(["model"]));
    expect(loadStatuslineConfiguration(cwd)).toEqual({
      fields: ["model"],
      legacy: true,
    });
    writeFileSync(
      join(cwd, ".xiaok", "settings.json"),
      legacy(["session", "mode"]),
    );
    expect(loadStatuslineConfiguration(cwd)).toEqual({
      fields: ["session", "mode"],
      legacy: true,
    });
    saveStatuslineFields(["version", "session", "version"]);
    expect(loadStatuslineConfiguration(cwd)).toEqual({
      fields: ["version", "project"],
      legacy: false,
    });
    saveStatuslineFields([]);
    expect(bar().getFields()).toEqual([]);
    expect(bar().getStatusLine()).toBe("");
  });

  it.each([
    "{",
    "null",
    '{"version":2,"fields":["version"]}',
    '{"version":1,"fields":["__proto__"]}',
  ])("falls back safely from invalid preferences %s", (value) => {
    writeFileSync(join(cwd, ".xiaok", "settings.json"), legacy(["mode"]));
    writeFileSync(statuslinePreferencePath(), value);
    expect(loadStatuslineConfiguration(cwd)).toEqual({
      fields: ["mode"],
      legacy: true,
    });
  });

  it("help is read only; command normalizes, persists, reloads and handles reset/on/off", () => {
    const status = bar();
    expect(runStatuslineCommand("", status)).toContain("当前字段");
    expect(existsSync(statuslinePreferencePath())).toBe(false);
    expect(runStatuslineCommand("session,model model", status)).toContain(
      "状态栏已保存",
    );
    expect(status.getFields()).toEqual(["project", "model"]);
    expect(
      JSON.parse(readFileSync(statuslinePreferencePath(), "utf8")),
    ).toEqual({ version: 1, fields: ["project", "model"] });
    expect(bar().getFields()).toEqual(["project", "model"]);
    for (const command of ["off", "reset", "on"]) {
      expect(runStatuslineCommand(command, status)).toContain("状态栏已保存");
      expect(bar().getFields()).toEqual(
        command === "off" ? [] : DEFAULT_STATUSLINE_FIELDS,
      );
    }
  });

  it("unknown fields and save failure preserve the active configuration", () => {
    const status = bar();
    runStatuslineCommand("model", status);
    const saved = readFileSync(statuslinePreferencePath(), "utf8");
    expect(runStatuslineCommand("constructor", status)).toContain("未知字段");
    expect(status.getFields()).toEqual(["model"]);
    expect(readFileSync(statuslinePreferencePath(), "utf8")).toBe(saved);
    const blocked = join(root, "not-a-directory");
    writeFileSync(blocked, "sentinel");
    vi.stubEnv("XIAOK_CONFIG_DIR", blocked);
    expect(runStatuslineCommand("off", status)).toContain(
      "保存失败，当前设置未变",
    );
    expect(status.getFields()).toEqual(["model"]);
    expect(readFileSync(blocked, "utf8")).toBe("sentinel");
    expect(readFileSync(join(config, "statusline.json"), "utf8")).toBe(saved);
  });

  it("preserves legacy visible token/cost/branch order when opening the editor", () => {
    writeFileSync(
      join(cwd, ".xiaok", "settings.json"),
      legacy(["model", "mode", "tokens", "session"]),
    );
    const status = bar();
    status.updateModel("claude-sonnet-4-20250514");
    status.updateBranch("review");
    status.update({ inputTokens: 6000, outputTokens: 2000 });
    const before = status.getStatusLine();
    expect(before).toContain("$0.05");
    expect(before).toContain("review");
    expect(status.getStatusLineForFields(status.getEditableFields())).toBe(
      before,
    );
  });

  it("removes terminal controls from displayed fields while preserving requested order", () => {
    const status = bar();
    status.updateModel("model\x1b[2Jname");
    status.updateBranch("branch\rforged");
    status.setFields(["branch", "model"]);
    expect(stripVTControlCharacters(status.getStatusLine())).toBe(
      "branch forged · modelname",
    );
  });
});
