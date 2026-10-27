export const FACILITY_ID_ATTRIBUTE = 'data-facility-id';

export function scrollToFacility(id: string) {
  document
    .querySelector<HTMLElement>(`[${FACILITY_ID_ATTRIBUTE}="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
