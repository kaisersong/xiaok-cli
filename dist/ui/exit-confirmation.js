export function createExitConfirmation(now = Date.now, windowMs = 2000) {
    let firstPress;
    return {
        press() {
            const current = now();
            if (firstPress !== undefined && current >= firstPress && current - firstPress < windowMs)
                return true;
            firstPress = current;
            return false;
        },
        reset() { firstPress = undefined; },
    };
}
