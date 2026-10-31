import { PIN_SHADOW, pinColors, pinGeometry, pinTheme, type PinFace, type PinSize, type PinTheme } from './pin-face';

export function readPinTheme(element: Element): PinTheme {
  const style = getComputedStyle(element);
  return pinTheme((name) => style.getPropertyValue(name).trim(), style.fontFamily);
}

export function paintPin(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  face: PinFace,
  size: PinSize,
  theme: PinTheme,
  pixelRatio: number,
): void {
  const g = pinGeometry(face, size);
  const colors = pinColors(face, theme);
  const centre = context.canvas.width / 2;
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(pixelRatio * g.scale, 0, 0, pixelRatio * g.scale, centre, centre);
  const rect = (inset: number, radius: number) => {
    context.beginPath();
    context.roundRect(-g.box / 2 + inset, -g.box / 2 + inset, g.box - inset * 2, g.box - inset * 2, radius);
  };
  rect(0, g.corner);
  context.fillStyle = colors.border;
  // Canvas の影の寸法は変換行列に追従しないため、CSS の拡大と同じ比率を明示する。
  context.shadowOffsetY = PIN_SHADOW.offsetY * pixelRatio * g.scale;
  context.shadowBlur = PIN_SHADOW.blur * pixelRatio * g.scale;
  context.shadowColor = PIN_SHADOW.color;
  context.fill();
  context.shadowColor = 'transparent';
  context.fill();
  rect(g.border, Math.max(0, g.corner - g.border));
  context.fillStyle = colors.fill;
  context.fill();
  if (colors.ring) {
    rect(-g.ring / 2, g.corner + g.ring / 2);
    context.lineWidth = g.ring;
    context.strokeStyle = colors.ring;
    context.stroke();
  }
  context.font = `800 ${g.font}px ${theme.font}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = colors.text;
  context.fillText(g.label, 0, 0);
}

export function pinImage(face: PinFace, theme: PinTheme, pixelRatio: number): ImageData {
  const side = Math.ceil(2 * pinGeometry(face, 'map').extent * pixelRatio);
  const context = new OffscreenCanvas(side, side).getContext('2d')!;
  paintPin(context, face, 'map', theme, pixelRatio);
  return context.getImageData(0, 0, side, side);
}
