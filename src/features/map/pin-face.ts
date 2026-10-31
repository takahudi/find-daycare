import type { Facility } from '../../schema.ts';

export type PinShape = 'circle' | 'square';
export type PinTier = 'open' | 'full';
export interface FacilityFace {
  readonly kind: 'facility';
  readonly shape: PinShape;
  readonly vacancy: number;
  readonly selected: boolean;
}
export interface HomeFace {
  readonly kind: 'home';
}
export type PinFace = FacilityFace | HomeFace;
export const HOME_FACE: HomeFace = { kind: 'home' };

export function facilityFace(facility: Pick<Facility, 'licensing'>, vacancy: number, selected: boolean): FacilityFace {
  return { kind: 'facility', shape: facility.licensing === 'unlicensed' ? 'square' : 'circle', vacancy, selected };
}
export function pinTier(face: FacilityFace): PinTier {
  return face.vacancy > 0 ? 'open' : 'full';
}
export function pinLabel(face: PinFace): string {
  return face.kind === 'home' ? '家' : face.vacancy > 0 ? String(face.vacancy) : '×';
}
export function pinImageId(face: PinFace): string {
  return face.kind === 'home' ? 'pin:home' : `pin:${face.shape}:${face.vacancy}${face.selected ? ':selected' : ''}`;
}
export function parsePinImageId(id: string): PinFace | null {
  if (id === 'pin:home') return HOME_FACE;
  const match = /^pin:(circle|square):(0|[1-9]\d*)(:selected)?$/.exec(id);
  if (!match) return null;
  const vacancy = Number(match[2]);
  if (!Number.isSafeInteger(vacancy)) return null;
  return { kind: 'facility', shape: match[1] === 'circle' ? 'circle' : 'square', vacancy, selected: !!match[3] };
}

export type PinSize = 'map' | 'legend';
const METRICS = {
  map: { box: 30, homeBox: 34, border: 2, corner: 7, font: 12.8, homeFont: 13.6 },
  legend: { box: 20, homeBox: 20, border: 1.5, corner: 7, font: 10.4, homeFont: 10.4 },
} as const;
export const PIN_SHADOW = { offsetY: 1, blur: 4, color: 'rgb(0 0 0 / 0.35)' } as const;
export interface PinGeometry {
  readonly box: number;
  readonly border: number;
  readonly corner: number;
  readonly font: number;
  readonly label: string;
  readonly scale: number;
  readonly ring: number;
  readonly extent: number;
}
export function pinGeometry(face: PinFace, size: PinSize): PinGeometry {
  const metrics = METRICS[size];
  const home = face.kind === 'home';
  const box = home ? metrics.homeBox : metrics.box;
  const selected = !home && face.selected;
  const scale = selected ? 1.2 : 1;
  const ring = selected ? 3 : 0;
  const extent = Math.ceil(scale * Math.max(box / 2 + ring, box / 2 + PIN_SHADOW.blur + Math.abs(PIN_SHADOW.offsetY)) * 2) / 2;
  return {
    box,
    border: metrics.border,
    corner: !home && face.shape === 'square' ? metrics.corner : box / 2,
    font: home ? metrics.homeFont : metrics.font,
    label: pinLabel(face),
    scale,
    ring,
    extent,
  };
}
export function pinContains(face: PinFace, dx: number, dy: number): boolean {
  const geometry = pinGeometry(face, 'map');
  const half = (geometry.box * geometry.scale) / 2;
  const radius = geometry.corner * geometry.scale;
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  return x <= half && y <= half && Math.max(x - half + radius, 0) ** 2 + Math.max(y - half + radius, 0) ** 2 <= radius ** 2;
}

export const PIN_THEME_VARS = {
  open: '--open',
  full: '--full',
  fullBg: '--full-bg',
  unlicensed: '--unlicensed',
  accent: '--accent',
  ink: '--ink',
} as const;
export type PinTheme = { readonly [K in keyof typeof PIN_THEME_VARS]: string } & { readonly font: string };
export function pinTheme(read: (cssVar: (typeof PIN_THEME_VARS)[keyof typeof PIN_THEME_VARS]) => string, font: string): PinTheme {
  return {
    open: read(PIN_THEME_VARS.open),
    full: read(PIN_THEME_VARS.full),
    fullBg: read(PIN_THEME_VARS.fullBg),
    unlicensed: read(PIN_THEME_VARS.unlicensed),
    accent: read(PIN_THEME_VARS.accent),
    ink: read(PIN_THEME_VARS.ink),
    font,
  };
}
export interface PinColors {
  readonly fill: string;
  readonly border: string;
  readonly text: string;
  readonly ring: string | null;
}
export function pinColors(face: PinFace, theme: PinTheme): PinColors {
  if (face.kind === 'home') return { fill: theme.accent, border: '#ffffff', text: theme.ink, ring: null };
  const open = face.vacancy > 0;
  return {
    fill: open ? theme.open : theme.fullBg,
    border: face.shape === 'square' ? theme.unlicensed : open ? '#ffffff' : theme.full,
    text: open ? '#ffffff' : theme.full,
    ring: face.selected ? theme.accent : null,
  };
}
