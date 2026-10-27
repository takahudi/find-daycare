import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const modules = globSync('**/*.tsx', { cwd: sourceRoot }).flatMap((file) => {
  const source = readFileSync(path.join(sourceRoot, file), 'utf8');
  return [...source.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)].map(([, binding, modulePath]) => ({
    file,
    source,
    binding,
    modulePath,
  }));
});

describe('CSS Modules のクラス参照', () => {
  it.each(modules)('$file の $binding の静的参照が $modulePath に存在する', ({ file, source, binding, modulePath }) => {
    const css = readFileSync(path.resolve(sourceRoot, path.dirname(file), modulePath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]));
    const references = new RegExp(`\\b${binding}(?:\\.([a-zA-Z_$][\\w$]*)|\\[\\s*(['"])([^'"]+)\\2\\s*\\])`, 'g');
    for (const match of source.matchAll(references)) {
      const name = match[1] ?? match[3];
      expect(classes.has(name), `${file}: ${binding} の ${name} が ${modulePath} に存在する`).toBe(true);
    }
  });
});
