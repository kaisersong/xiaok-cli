import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setPastedImagePath } from './image-input.js';
const OSC_1337_IMAGE_PREFIX = '\x1b]1337;File=';
const OSC_ST_TERMINATOR = '\x1b\\';
function parseOsc1337ImagePaste(raw) {
    if (!raw.startsWith(OSC_1337_IMAGE_PREFIX)) {
        return { kind: 'none' };
    }
    const belIndex = raw.indexOf('\x07');
    const stIndex = raw.indexOf(OSC_ST_TERMINATOR);
    const endMarker = (() => {
        if (belIndex === -1)
            return stIndex;
        if (stIndex === -1)
            return belIndex;
        return Math.min(belIndex, stIndex);
    })();
    if (endMarker === -1) {
        return { kind: 'partial' };
    }
    const oscContent = raw.slice(7, endMarker);
    const base64Start = oscContent.indexOf(':');
    if (base64Start === -1) {
        return { kind: 'complete', base64Data: null };
    }
    return { kind: 'complete', base64Data: oscContent.slice(base64Start + 1) };
}
function writePastedImage(base64Data) {
    const tempPath = join(tmpdir(), `xiaok-pasted-${Date.now()}-${randomUUID()}.png`);
    writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));
    return tempPath;
}
export function createInputPasteController(options) {
    let pastedImageCount = 0;
    let pendingOsc1337ImagePaste = '';
    const platform = options.platform ?? process.platform;
    const registerPastedImage = (imagePath) => {
        const index = pastedImageCount;
        pastedImageCount += 1;
        setPastedImagePath(index, imagePath);
        return `[image ${index}]`;
    };
    return {
        handleChunk(raw) {
            const candidate = pendingOsc1337ImagePaste ? pendingOsc1337ImagePaste + raw : raw;
            const parsed = parseOsc1337ImagePaste(candidate);
            if (parsed.kind === 'partial') {
                pendingOsc1337ImagePaste = candidate;
                return { handled: true };
            }
            if (parsed.kind === 'complete') {
                pendingOsc1337ImagePaste = '';
                if (!parsed.base64Data) {
                    return { handled: true };
                }
                return {
                    handled: true,
                    placeholder: registerPastedImage(writePastedImage(parsed.base64Data)),
                };
            }
            if (platform === 'win32' && raw === '\x1bv') {
                const placeholder = this.importClipboardImage();
                return placeholder ? { handled: true, placeholder } : { handled: true };
            }
            if (raw.startsWith('\x1b_G')) {
                return { handled: true };
            }
            return { handled: false };
        },
        importClipboardImage() {
            const imagePath = options.clipboardImageSaver();
            if (!imagePath) {
                return null;
            }
            return registerPastedImage(imagePath);
        },
    };
}
