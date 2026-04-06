import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
function getClipboardCommands() {
    const platform = process.platform;
    const screenshotPath = join(tmpdir(), 'xiaok_clipboard_image.png');
    const commands = {
        darwin: {
            checkImage: `osascript -e 'the clipboard as «class PNGf»'`,
            saveImage: `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'write png_data to fp' -e 'close access fp'`,
            deleteFile: `rm -f "${screenshotPath}"`,
        },
        linux: {
            checkImage: 'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg)"',
            saveImage: `xclip -selection clipboard -t image/png -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/png > "${screenshotPath}" 2>/dev/null`,
            deleteFile: `rm -f "${screenshotPath}"`,
        },
        win32: {
            checkImage: 'powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"',
            saveImage: `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`,
            deleteFile: `del /f "${screenshotPath}"`,
        },
    };
    return {
        commands: commands[platform] || commands.linux,
        screenshotPath,
    };
}
/**
 * Check if clipboard contains an image (quick check without reading)
 */
export function hasImageInClipboard() {
    const { commands } = getClipboardCommands();
    try {
        execSync(commands.checkImage, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get image from clipboard as base64
 * Returns null if no image in clipboard or on error
 */
export function getImageFromClipboard() {
    const { commands, screenshotPath } = getClipboardCommands();
    try {
        // Check if clipboard has image
        execSync(commands.checkImage, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        // Save the image to temp file
        execSync(commands.saveImage, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        // Read the image file
        const imageBuffer = readFileSync(screenshotPath);
        if (imageBuffer.length === 0) {
            return null;
        }
        // Detect format from magic bytes
        const mediaType = detectImageFormat(imageBuffer);
        const base64 = imageBuffer.toString('base64');
        // Cleanup temp file
        try {
            unlinkSync(screenshotPath);
        }
        catch {
            // Ignore cleanup errors
        }
        return { base64, mediaType };
    }
    catch {
        return null;
    }
}
/**
 * Detect image format from magic bytes
 */
function detectImageFormat(buffer) {
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'image/png';
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    // GIF: 47 49 46
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'image/gif';
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'image/webp';
    }
    // Default to PNG
    return 'image/png';
}
/**
 * Save clipboard image to temp file and return path
 */
export function saveClipboardImageToTemp() {
    const image = getImageFromClipboard();
    if (!image)
        return null;
    const tempPath = join(tmpdir(), `xiaok_pasted_${Date.now()}.png`);
    const buffer = Buffer.from(image.base64, 'base64');
    writeFileSync(tempPath, buffer);
    return tempPath;
}
