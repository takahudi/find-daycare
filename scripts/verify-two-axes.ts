import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as v from 'valibot';

const LegacyDatasetSchema = v.looseObject({
  generatedAt: v.string(),
  facilities: v.array(
    v.looseObject({
      category: v.picklist(['nursery', 'kodomoen', 'community', 'kigyo']),
      categoryLabel: v.string(),
      licensed: v.boolean(),
    }),
  ),
});
const before = v.parse(
  LegacyDatasetSchema,
  JSON.parse(execFileSync('git', ['show', '3fd8c7a:src/data/facilities.json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })),
);
const after: unknown = JSON.parse(await readFile('src/data/facilities.json', 'utf8'));
const facilities = before.facilities.map(({ category, categoryLabel: _categoryLabel, licensed, ...rest }) => ({
  ...rest,
  facilityType: category,
  licensing: licensed ? 'licensed' : 'unlicensed',
}));
assert.equal(facilities.length, 1109);
const { generatedAt: _generatedAt, ...beforeRest } = before;
const afterWithoutTimestamp = v.parse(v.looseObject({ generatedAt: v.string() }), after);
const { generatedAt: _afterGeneratedAt, ...afterRest } = afterWithoutTimestamp;
assert.deepStrictEqual(afterRest, { ...beforeRest, facilities });
console.log('PASS: 1109施設とデータセット全体が旧→新フィールドの変換のみで完全一致（generatedAtを除く）');
for (const facilityType of ['nursery', 'kodomoen', 'community', 'kigyo']) {
  for (const licensing of ['licensed', 'unlicensed']) {
    console.log(
      `${facilityType} × ${licensing}: ${facilities.filter((f) => f.facilityType === facilityType && f.licensing === licensing).length}`,
    );
  }
}
