import { dim, cyan, green, red } from './render.js';
export class ToolExplorer {
    calls = [];
    collapsed = true;
    addCall(name, input) {
        this.calls.push({ name, input });
    }
    setResult(index, result, isError) {
        if (this.calls[index]) {
            this.calls[index].result = result;
            this.calls[index].isError = isError;
        }
    }
    render() {
        if (this.calls.length === 0)
            return;
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
    getSummary(call) {
        if (call.name === 'read')
            return call.input.file_path;
        if (call.name === 'write')
            return call.input.file_path;
        if (call.name === 'bash') {
            const cmd = call.input.command;
            return cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
        }
        if (call.name === 'edit')
            return call.input.file_path;
        if (call.name === 'glob')
            return call.input.pattern;
        if (call.name === 'grep')
            return call.input.pattern;
        return '';
    }
    reset() {
        this.calls = [];
        this.collapsed = true;
    }
}
