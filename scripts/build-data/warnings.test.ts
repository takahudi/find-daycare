import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffWarnings, replaceWarnings } from './warnings.ts';

describe('ビルド警告の前回との差分', () => {
  it('新しく出た警告と解消した警告だけを返す', () => {
    expect(diffWarnings(['[北区] A', '[北区] B'], ['[北区] B', '[中央区] C'])).toEqual({
      added: ['[中央区] C'],
      resolved: ['[北区] A'],
    });
  });

  it('同じ文言の警告は件数の増減を差分にする', () => {
    expect(diffWarnings(['A', 'A', 'B'], ['A', 'B', 'B'])).toEqual({ added: ['B'], resolved: ['A'] });
  });

  it('前回のファイルがなければ全件を新規とし、今回の警告を1行1件で書き出す', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'warnings-')), 'build-warnings.txt');
    expect(await replaceWarnings(file, ['A', 'B'])).toEqual({ added: ['A', 'B'], resolved: [] });
    expect(await readFile(file, 'utf8')).toBe('A\nB\n');
  });

  it('前回書き出したファイルと比べる', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'warnings-')), 'build-warnings.txt');
    await writeFile(file, 'A\nB\n');
    expect(await replaceWarnings(file, ['B', 'C'])).toEqual({ added: ['C'], resolved: ['A'] });
    expect(await readFile(file, 'utf8')).toBe('B\nC\n');
  });
});
