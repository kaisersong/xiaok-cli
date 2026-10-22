export const MODEL_TEXT_REPETITION_CODE = 'MODEL_TEXT_REPETITION_DETECTED';
/** Bounded, exact tandem-repeat detection for visible model prose, per request. */
export class ModelTextRepetitionGuard {
    tail = '';
    append(delta) {
        // Inspect inside large deltas too: the whole loop can arrive in one chunk
        // followed by an unrelated suffix. Never forward that chunk first.
        for (let offset = 0; offset < delta.length; offset += 32) {
            this.tail = (this.tail + delta.slice(offset, offset + 32)).slice(-4096);
            if (this.tail.length < 512 || !/\p{L}/u.test(this.tail))
                continue;
            const maxPeriod = Math.min(512, Math.floor(this.tail.length / 8));
            // Native substring search narrows candidate periods before exact checks;
            // ordinary long responses must not stall Electron's main thread.
            const anchor = this.tail.slice(-16);
            const anchorEnd = this.tail.length - 16;
            for (let at = this.tail.lastIndexOf(anchor, anchorEnd - 16); at >= Math.max(0, anchorEnd - maxPeriod); at = at > 0 ? this.tail.lastIndexOf(anchor, at - 1) : -1) {
                const period = anchorEnd - at;
                const unit = this.tail.slice(-period);
                if (this.tail.slice(-2 * period, -period) !== unit)
                    continue;
                const copies = Math.max(8, Math.ceil(512 / period));
                if (this.tail.endsWith(unit.repeat(copies)) && /\p{L}/u.test(unit)) {
                    // Static diagnostics never retain provider text. The stream owner
                    // cancels this attempt in finally instead of retrying the loop.
                    throw Object.assign(new Error(MODEL_TEXT_REPETITION_CODE), {
                        code: MODEL_TEXT_REPETITION_CODE, retryable: false,
                    });
                }
            }
        }
    }
}
