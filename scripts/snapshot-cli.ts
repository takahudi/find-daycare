import { parseArgs } from 'node:util';
import { selectIds } from './snapshots.ts';

export function parseFetchArgs(args: string[]) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: { 'force-city': { type: 'boolean', default: false }, 'discard-unarchived': { type: 'string', multiple: true } },
  });
  if (parsed.values['discard-unarchived']?.length && !parsed.positionals.length)
    throw new Error('--discard-unarchived を使う場合は取得対象の区idも位置引数で指定してください。全区取得は実行しません');
  selectIds(parsed.positionals);
  return parsed;
}
