import { describe, expect, it, vi } from 'vitest';
import indexCss from '../index.css?raw';
import {
  THEME_STORAGE_KEY,
  applyThemePreference,
  initTheme,
  parseTheme,
  readStoredTheme,
  readSystemTheme,
  resolveTheme,
  writeStoredTheme,
} from './theme';

function parseVariables(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const full =
      hex.length === 4
        ? hex
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')
        : hex.slice(1);
    const [red, green, blue] = [0, 2, 4]
      .map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('テーマ状態の解決と保存', () => {
  it('保存値が未設定または不正ならシステム設定を使う', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBeNull();
    expect(parseTheme(null)).toBeNull();

    expect(resolveTheme(null, 'light')).toBe('light');
    expect(resolveTheme(null, 'dark')).toBe('dark');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
  });

  it('localStorage の読み書きと例外耐性を保つ', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });

    expect(readStoredTheme()).toBeNull();
    writeStoredTheme('dark');
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
    store.set(THEME_STORAGE_KEY, 'invalid');
    expect(readStoredTheme()).toBeNull();

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readStoredTheme()).toBeNull();
    expect(() => writeStoredTheme('light')).not.toThrow();
    expect(readStoredTheme()).toBe('light');

    // 後続テストへメモリ上のフォールバックを残さない。
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
    });
    writeStoredTheme('dark');
    expect(readStoredTheme()).toBeNull();
  });

  it('documentElement の data-theme 属性を同期する', () => {
    const dataset: Record<string, string | undefined> = {};
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', {
      getItem: () => 'dark',
    });

    initTheme();
    expect(dataset.theme).toBe('dark');

    applyThemePreference('light');
    expect(dataset.theme).toBe('light');

    applyThemePreference(null);
    expect('theme' in dataset).toBe(false);
  });

  it('prefers-color-scheme からシステムテーマを読む', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(readSystemTheme()).toBe('dark');

    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(readSystemTheme()).toBe('light');
  });
});

describe('ダークモード CSS トークン', () => {
  const darkAttrVars = parseVariables(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/.exec(indexCss)![1]);
  const darkMediaVars = parseVariables(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([^}]+)\}/.exec(indexCss)![1],
  );

  it('手動ダークとシステムダークで同じトークンを定義する', () => {
    expect([...darkAttrVars.entries()]).toEqual([...darkMediaVars.entries()]);
  });

  it('ダークモードの主要な文字色と背景色が WCAG AA（4.5:1以上）を満たす', () => {
    const v = (name: string) => darkAttrVars.get(name)!;
    const pairs: [string, string, string][] = [
      ['ink on surface', v('--ink'), v('--surface')],
      ['ink on bg', v('--ink'), v('--bg')],
      ['muted on surface', v('--muted'), v('--surface')],
      ['muted on bg', v('--muted'), v('--bg')],
      ['muted on full-bg', v('--muted'), v('--full-bg')],
      ['accent on surface', v('--accent'), v('--surface')],
      ['on-accent on accent', v('--on-accent'), v('--accent')],
      ['white on accent-fill', '#ffffff', v('--accent-fill')],
      ['accent-ink on surface', v('--accent-ink'), v('--surface')],
      ['accent-ink on bg', v('--accent-ink'), v('--bg')],
      ['accent-ink on accent-bg', v('--accent-ink'), v('--accent-bg')],
      ['open on surface', v('--open'), v('--surface')],
      ['open on bg', v('--open'), v('--bg')],
      ['open on open-bg', v('--open'), v('--open-bg')],
      ['full on full-bg', v('--full'), v('--full-bg')],
      ['full on na-stripe-a', v('--full'), v('--na-stripe-a')],
      ['full on na-stripe-b', v('--full'), v('--na-stripe-b')],
      ['white on nursery', '#ffffff', v('--nursery')],
      ['nursery-ink on nursery-bg', v('--nursery-ink'), v('--nursery-bg')],
      ['white on kodomoen', '#ffffff', v('--kodomoen')],
      ['kodomoen-ink on kodomoen-bg', v('--kodomoen-ink'), v('--kodomoen-bg')],
      ['white on community', '#ffffff', v('--community')],
      ['community-ink on community-bg', v('--community-ink'), v('--community-bg')],
      ['white on kigyo', '#ffffff', v('--kigyo')],
      ['kigyo-ink on kigyo-bg', v('--kigyo-ink'), v('--kigyo-bg')],
      ['unlicensed on unlicensed-bg', v('--unlicensed'), v('--unlicensed-bg')],
      ['error on surface', v('--error'), v('--surface')],
    ];
    for (const [label, fg, bg] of pairs) {
      expect(contrast(fg, bg), label).toBeGreaterThanOrEqual(4.5);
    }
  });
});
