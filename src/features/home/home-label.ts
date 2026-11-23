const OSAKA_CITY_PREFIX = /^(?:大阪府)?大阪市(?=.+)/;

export function formatHomeLabel(label: string): string {
  return label.replace(OSAKA_CITY_PREFIX, '');
}
