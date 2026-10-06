import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Original Punctum glyph bitmaps, SIL OFL 1.1 (data/fonts/punctum/OFL.txt).
// Two dot rows per ASCII cell keep the mark readable and width-stable in CJK TTYs.
export function punctumWordmark() {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    for (const dataDir of [join(moduleDir, '..', '..', 'data'), join(moduleDir, '..', '..', '..', 'data')]) {
        try {
            const glyphs = JSON.parse(readFileSync(join(dataDir, 'fonts', 'punctum', 'wordmark.json'), 'utf8'));
            const grid = Array.from({ length: 8 }, (_, y) => [...'XIAOK'].map(char => glyphs[char][y] ?? '.....').join('.'));
            return [0, 2, 4, 6].map(top => {
                let row = '';
                for (let x = 0; x < grid[0].length; x++) {
                    const upper = grid[top][x] === '#';
                    const lower = grid[top + 1][x] === '#';
                    row += upper ? (lower ? ':' : "'") : (lower ? '.' : ' ');
                }
                return row;
            });
        }
        catch { /* Missing optional branding must not prevent CLI startup. */ }
    }
    return null;
}
