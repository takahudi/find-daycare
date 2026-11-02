import { pinGeometry, type PinFace } from './pin-face';
import { paintPin, readPinTheme } from './pin-paint';
import styles from './MapLegend.module.css';

export function PinSwatch({ face }: { face: PinFace }) {
  const { box, extent } = pinGeometry(face, 'legend');
  const side = extent * 2;
  return (
    <canvas
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
