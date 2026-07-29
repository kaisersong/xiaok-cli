/**
 * Self-built Wilson score interval with a free denominator.
 *
 * Not the D9 statistics module: kimi-k3-d9/statistics.mjs hard-asserts
 * denominator === 30 and a 5x6 stratification, which never holds for a
 * 20-30 task product eval.
 */
export function wilsonInterval(numerator, denominator, z = 1.96) {
  if (
    !Number.isSafeInteger(numerator)
    || !Number.isSafeInteger(denominator)
    || denominator <= 0
    || numerator < 0
    || numerator > denominator
    || typeof z !== 'number'
    || !(z > 0)
  ) {
    throw new Error('PRODUCT_EVAL_WILSON_INPUT_INVALID');
  }
  const p = numerator / denominator;
  const z2 = z * z;
  const center = (p + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const margin = (z / (1 + z2 / denominator)) * Math.sqrt(
    (p * (1 - p)) / denominator + z2 / (4 * denominator * denominator),
  );
  return Object.freeze({
    point: p,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  });
}
