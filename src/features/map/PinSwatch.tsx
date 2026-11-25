import type { Theme } from '../../app/theme';
import { pinGeometry, type PinFace } from './pin-face';
import { paintPin, readPinTheme } from './pin-paint';
import styles from './MapLegend.module.css';

export function PinSwatch({ face, theme }: { face: PinFace; theme: Theme }) {
  const { box, extent } = pinGeometry(face, 'legend');
  const side = extent * 2;
  return (
    <canvas
      key={theme}
      aria-hidden="true"
      className={styles.swatch}
      style={{ width: side, height: side, margin: box / 2 - extent }}
      ref={(canvas) => {
        if (!canvas) return;
        const ratio = window.devicePixelRatio;
        canvas.width = canvas.height = Math.ceil(side * ratio);
        paintPin(canvas.getContext('2d')!, face, 'legend', readPinTheme(canvas), ratio);
      }}
    />
  );
}
