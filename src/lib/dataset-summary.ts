import type { Dataset } from '../schema';

export function summarizeDataset(data: Dataset) {
  const wardNames = data.wards.map((w) => w.name);
  const title =
    wardNames.length >= 24 ? '大阪市' : wardNames.length >= 5 ? `大阪市 ${wardNames.length}区` : `大阪市 ${wardNames.join('・')}`;
  const asOfLabels = [...new Set(data.wards.map((w) => `${w.vacancyAsOf}（${w.vacancyFor}）`))];
  const kigyoAsOfText = (() => {
    const byLabel = new Map<string, string[]>();
    for (const w of data.wards) {
      if (w.kigyoVacancyAsOf) byLabel.set(w.kigyoVacancyAsOf, [...(byLabel.get(w.kigyoVacancyAsOf) ?? []), w.name]);
    }
    const [main, ...others] = [...byLabel].sort((a, b) => b[1].length - a[1].length);
    if (!main) return null;
    const exceptions = others.map(([label, names]) => `${names.join('・')}は${label}`).join('、');
    return exceptions ? `${main[0]}（${exceptions}）` : main[0];
  })();
  return { wardNames, title, asOfLabels, kigyoAsOfText };
}

export type DatasetSummary = ReturnType<typeof summarizeDataset>;
