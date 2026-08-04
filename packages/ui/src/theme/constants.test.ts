import { describe, expect, test } from 'bun:test';
import {
  SCALE_FACTOR,
  UI_SCALES,
  isContrast,
  isThemeChoice,
  isUiScale,
  resolveTheme,
} from './constants';

describe('theme constants', () => {
  test('scale factors increase monotonically and start at the 18px comfortable base', () => {
    expect(SCALE_FACTOR.base).toBe(1.125); // 16 * 1.125 = 18px
    const factors = UI_SCALES.map((s) => SCALE_FACTOR[s]);
    const sorted = [...factors].sort((a, b) => a - b);
    expect(factors).toEqual(sorted);
    expect(new Set(factors).size).toBe(factors.length);
  });

  test('resolveTheme maps system to the OS preference and passes explicit choices through', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  test('guards reject unknown values', () => {
    expect(isUiScale('base')).toBe(true);
    expect(isUiScale('huge')).toBe(false);
    expect(isThemeChoice('system')).toBe(true);
    expect(isThemeChoice(null)).toBe(false);
    expect(isContrast('high')).toBe(true);
    expect(isContrast('extreme')).toBe(false);
  });
});
