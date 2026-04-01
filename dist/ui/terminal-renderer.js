import { buildTerminalFrame } from './terminal-frame.js';
export class TerminalRenderer {
    stream;
    previousLineCount = 0;
    constructor(stream = process.stdout) {
        this.stream = stream;
    }
    render(state) {
        const frame = buildTerminalFrame(state);
        const linesToClear = Math.max(this.previousLineCount, frame.lines.length);
        this.stream.write('\r');
        for (let index = 0; index < linesToClear; index += 1) {
            this.stream.write('\x1b[2K');
            if (index < linesToClear - 1) {
                this.stream.write('\x1b[1B');
                this.stream.write('\r');
            }
        }
        if (linesToClear > 1) {
            this.stream.write(`\x1b[${linesToClear - 1}A`);
        }
        this.stream.write('\r');
        frame.lines.forEach((line, index) => {
            this.stream.write('\x1b[2K');
            this.stream.write(line);
            if (index < frame.lines.length - 1) {
                this.stream.write('\x1b[1B');
                this.stream.write('\r');
            }
        });
        if (frame.cursor) {
            const lineDelta = frame.lines.length - 1 - frame.cursor.line;
            if (lineDelta > 0) {
                this.stream.write(`\x1b[${lineDelta}A`);
            }
            this.stream.write('\r');
            if (frame.cursor.column > 0) {
                this.stream.write(`\x1b[${frame.cursor.column}C`);
            }
        }
        else if (frame.lines.length > 1) {
            this.stream.write(`\x1b[${frame.lines.length - 1}A`);
            this.stream.write('\r');
        }
        this.previousLineCount = frame.lines.length;
    }
}
