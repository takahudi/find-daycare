import { readFile, writeFile } from 'node:fs/promises';

export interface WarningsDiff {
  added: string[];
  resolved: string[];
}

/** 同じ文言の警告が複数あるときは件数の増減で比べる */
export function diffWarnings(previous: readonly string[], current: readonly string[]): WarningsDiff {
  const remaining = new Map<string, number>();
  for (const w of previous) remaining.set(w, (remaining.get(w) ?? 0) + 1);
  const added: string[] = [];
  for (const w of current) {
    const n = remaining.get(w) ?? 0;
    if (n > 0) remaining.set(w, n - 1);
    else added.push(w);
  }
  const resolved = previous.filter((w) => {
    const n = remaining.get(w) ?? 0;
    if (n === 0) return false;
    remaining.set(w, n - 1);
    return true;
  });
  return { added, resolved };
}

/** 前回コミットした警告と比べてから、今回の警告で置き換える */
export async function replaceWarnings(file: string, warnings: readonly string[]): Promise<WarningsDiff> {
  const previous = await readFile(file, 'utf8').then(
    (text) => text.split('\n').filter(Boolean),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  await writeFile(file, warnings.map((w) => `${w}\n`).join(''));
  return diffWarnings(previous, warnings);
}
