import { dim, cyan, green, red } from './render.js';

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export class ToolExplorer {
  private calls: ToolCall[] = [];
  private collapsed = true;

  addCall(name: string, input: Record<string, unknown>): void {
    this.calls.push({ name, input });
  }

  setResult(index: number, result: string, isError: boolean): void {
    if (this.calls[index]) {
      this.calls[index].result = result;
      this.calls[index].isError = isError;
    }
  }

  render(): void {
    if (this.calls.length === 0) return;

    const header = this.collapsed
      ? dim(`  Explored (${this.calls.length} tools)`)
      : dim(`  Explored`);

    process.stdout.write(`\n${header}\n`);

    if (!this.collapsed) {
      for (const call of this.calls) {
        const icon = call.isError ? red('✗') : green('✓');
        const name = cyan(call.name);
        const summary = this.getSummary(call);
        process.stdout.write(`    ${icon} ${name} ${dim(summary)}\n`);
      }
    }
  }

  private getSummary(call: ToolCall): string {
    if (call.name === 'read') return call.input.file_path as string;
    if (call.name === 'write') return call.input.file_path as string;
    if (call.name === 'bash') {
      const cmd = call.input.command as string;
      return cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
    }
    if (call.name === 'edit') return call.input.file_path as string;
    if (call.name === 'glob') return call.input.pattern as string;
    if (call.name === 'grep') return call.input.pattern as string;
    return '';
  }

  reset(): void {
    this.calls = [];
    this.collapsed = true;
  }
}
