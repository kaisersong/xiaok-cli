import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactString } from './redactor.js';
export class TraceBundleWriter {
    options;
    previewBytes;
    persistOutputBytes;
    constructor(options) {
        this.options = options;
        this.previewBytes = options.previewBytes ?? 10_000;
        this.persistOutputBytes = options.persistOutputBytes ?? 50_000;
    }
    appendEvent(_event) { }
    recordToolCall(_call) { }
    recordArtifact(_artifact) { }
    persistLargeOutput(input) {
        const bytes = Buffer.byteLength(input.content, 'utf8');
        const redacted = redactString(input.content, `toolCalls.${input.toolCallId}.output`);
        const redactedSha256 = sha256(redacted.value);
        const preview = sliceBytes(redacted.value, this.previewBytes);
        if (bytes <= this.persistOutputBytes) {
            return { preview, redactedSha256, bytes, path: undefined, redactions: redacted.redactions };
        }
        const outputDir = join(this.options.rootDir, 'tool-output');
        mkdirSync(outputDir, { recursive: true });
        const filePath = join(outputDir, `${safeFilePart(input.toolCallId)}.txt`);
        writeFileSync(filePath, redacted.value, 'utf8');
        return { preview, redactedSha256, bytes, path: filePath, redactions: redacted.redactions };
    }
    async writeBundle(bundle) {
        mkdirSync(this.options.rootDir, { recursive: true });
        const filePath = join(this.options.rootDir, `${safeFilePart(bundle.bundleId)}.json`);
        writeFileSync(filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
        return filePath;
    }
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function sliceBytes(value, maxBytes) {
    const buffer = Buffer.from(value, 'utf8');
    if (buffer.byteLength <= maxBytes)
        return value;
    return buffer.subarray(0, maxBytes).toString('utf8');
}
function safeFilePart(value) {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
