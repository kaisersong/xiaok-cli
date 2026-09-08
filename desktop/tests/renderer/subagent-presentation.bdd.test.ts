import { describe, expect, it } from 'vitest';
import { zh } from '../../renderer/src/locales/zh';
import { en } from '../../renderer/src/locales/en';

describe('BDD: stable SubAgent alias mapping across locales', () => {
  it.each([
    [1, '双鱼座', 'Pisces'], [2, '天秤座', 'Libra'], [12, '水瓶座', 'Aquarius'],
    [13, '双鱼座-2', 'Pisces-2'], [24, '水瓶座-2', 'Aquarius-2'], [25, '双鱼座-3', 'Pisces-3'],
  ])('ordinal %s uses the same stable generation in both locales', (ordinal, chinese, english) => {
    expect(zh.multiAgent.alias(Number(ordinal))).toBe(chinese);
    expect(en.multiAgent.alias(Number(ordinal))).toBe(english);
  });
});
