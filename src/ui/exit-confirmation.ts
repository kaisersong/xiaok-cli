export function createExitConfirmation(now: () => number = Date.now, windowMs = 2000) {
  let firstPress: number | undefined;
  return {
    press(): boolean {
      const current = now();
      if (firstPress !== undefined && current >= firstPress && current - firstPress < windowMs) return true;
      firstPress = current;
      return false;
    },
    reset(): void { firstPress = undefined; },
  };
}
