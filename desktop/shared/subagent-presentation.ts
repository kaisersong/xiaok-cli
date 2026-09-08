/** Stable vocabulary shared by model-facing metadata and locale presentation. */
export const SUBAGENT_NAMES = {
  zh: ['双鱼座', '天秤座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天蝎座', '射手座', '摩羯座', '水瓶座'],
  en: ['Pisces', 'Libra', 'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius'],
} as const;
export function subAgentAlias(ordinal: number, names: readonly string[]): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || names.length !== 12) return '';
  const generation = Math.floor((ordinal - 1) / 12) + 1;
  return `${names[(ordinal - 1) % 12]}${generation > 1 ? `-${generation}` : ''}`;
}
export function agentDisplayNames(ordinal?: number): { zh: string; en: string } | undefined {
  if (ordinal === undefined || !subAgentAlias(ordinal, SUBAGENT_NAMES.en)) return undefined;
  return { zh: subAgentAlias(ordinal, SUBAGENT_NAMES.zh), en: subAgentAlias(ordinal, SUBAGENT_NAMES.en) };
}
