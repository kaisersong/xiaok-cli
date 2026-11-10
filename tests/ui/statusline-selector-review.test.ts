import { describe, expect, it, vi } from "vitest";
import { selectStatuslineFields } from "../../src/ui/statusline-selector.js";
import { ReplRenderer } from "../../src/ui/repl-renderer.js";
import { DEFAULT_STATUSLINE_FIELDS } from "../../src/ui/statusline-preferences.js";
import { createTtyHarness } from "../support/tty.js";
import { retainRawInputModeForSession } from "../../src/ui/input-mode.js";

describe("statusline selector production input and cleanup regression", () => {
  it.each(["CSI", "SS3", "enhanced"] as const)(
    "buffers split %s keys and commits ordered fields",
    async (kind) => {
      const h = createTtyHarness(110, 30);
      let pending: Promise<unknown> | undefined;
      try {
        pending = selectStatuslineFields(["model", "branch"], {
          renderer: new ReplRenderer(process.stdout),
          preview: (fields) => fields.join(" "),
        });
        // Move model after branch, including a split ESC prefix, then save.
        for (const chunk of kind === "CSI"
          ? ["\x1b", "[", "C", "\r"]
          : kind === "SS3"
            ? ["\x1b", "O", "C", "\r"]
            : ["\x1b[C", "\x1b[", "13", "u"])
          h.send(chunk);
        expect(await pending).toEqual(["branch", "model"]);
        expect(h.emitter.listenerCount("data")).toBe(0);
      } finally {
        h.emitter.emit("end");
        await pending;
        h.restore();
      }
    },
  );

  it.each(["ESC", "EOF", "ctrl+c", "ctrl+d"])(
    "cancels on %s and releases input, resize, keyboard and overlay",
    async (key) => {
      const h = createTtyHarness(110, 30);
      let pending: Promise<unknown> | undefined;
      const resizeCount = process.stdout.listenerCount("resize");
      const renderer = new ReplRenderer(process.stdout);
      const clear = vi.spyOn(renderer, "clearOverlay");
      try {
        pending = selectStatuslineFields(["model"], {
          renderer,
          preview: (fields) => fields.join(" "),
        });
        h.send(" "); // A local edit must never commit on cancel.
        if (key === "EOF") h.emitter.emit("end");
        else
          h.send(key === "ESC" ? "\x1b" : key === "ctrl+c" ? "\x03" : "\x04");
        expect(await pending).toBeNull();
        expect(h.emitter.listenerCount("data")).toBe(0);
        expect(h.emitter.listenerCount("end")).toBe(0);
        expect(process.stdout.listenerCount("resize")).toBe(resizeCount);
        expect(process.stdin.pause).toHaveBeenCalled();
        expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(false);
        expect(clear).toHaveBeenCalledOnce();
      } finally {
        h.emitter.emit("end");
        await pending;
        h.restore();
      }
    },
  );

  it.each([
    ["reset", 9, DEFAULT_STATUSLINE_FIELDS],
    ["off", 10, []],
    ["cancel", 12, null],
  ] as const)(
    "executes the %s action only on Enter",
    async (_label, down, result) => {
      const h = createTtyHarness(110, 30);
      let pending: Promise<unknown> | undefined;
      try {
        pending = selectStatuslineFields(["model"], {
          renderer: new ReplRenderer(process.stdout),
          preview: (fields) => fields.join(" "),
        });
        h.send("\x1b[B".repeat(down) + "\r");
        expect(await pending).toEqual(result);
      } finally {
        h.emitter.emit("end");
        await pending;
        h.restore();
      }
    },
  );

  it("cleans listeners even when preview rendering fails and does nothing without a TTY", async () => {
    const h = createTtyHarness(110, 30);
    const resizeCount = process.stdout.listenerCount("resize");
    try {
      const preview = vi.fn(() => {
        throw new Error("preview failed");
      });
      await expect(
        selectStatuslineFields(["model"], {
          renderer: new ReplRenderer(process.stdout),
          preview,
        }),
      ).rejects.toThrow("preview failed");
      expect(h.emitter.listenerCount("data")).toBe(0);
      expect(h.emitter.listenerCount("end")).toBe(0);
      expect(process.stdout.listenerCount("resize")).toBe(resizeCount);
      process.stdin.isTTY = false;
      preview.mockClear();
      expect(
        await selectStatuslineFields(["model"], {
          renderer: new ReplRenderer(process.stdout),
          preview,
        }),
      ).toBeNull();
      expect(preview).not.toHaveBeenCalled();
    } finally {
      h.restore();
    }
  });

  it("retains the Windows session raw-mode owner during selector handoff", async () => {
    const h = createTtyHarness(110, 30);
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    let release: (() => void) | undefined;
    try {
      Object.defineProperty(process, "platform", {
        ...platform,
        value: "win32",
      });
      release = retainRawInputModeForSession();
      const pending = selectStatuslineFields(["model"], {
        renderer: new ReplRenderer(process.stdout),
        preview: (fields) => fields.join(" "),
      });
      h.emitter.emit("end");
      expect(await pending).toBeNull();
      expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(true);
      expect(process.stdin.pause).toHaveBeenCalled();
    } finally {
      release?.();
      Object.defineProperty(process, "platform", platform);
      h.restore();
    }
  });
});
