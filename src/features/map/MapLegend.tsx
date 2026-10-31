import { LICENSING_LABELS } from '../../lib/facility-labels';
import { facilityFace, HOME_FACE } from './pin-face';
import { PinSwatch } from './PinSwatch';
import styles from './MapLegend.module.css';

const ENTRIES = [
  { face: facilityFace({ licensing: 'licensed' }, 2, false), label: '空きあり（人数）' },
  { face: facilityFace({ licensing: 'licensed' }, 0, false), label: '空きなし' },
  { face: facilityFace({ licensing: 'unlicensed' }, 1, false), label: LICENSING_LABELS.unlicensed },
] as const;

export function MapLegend({ hasHome: home }: { hasHome: boolean }) {
  return (
    <div className={styles.legend} role="group" aria-label="地図の凡例">
      {ENTRIES.map(({ face, label }) => (
        <span key={label}>
          <PinSwatch face={face} /> {label}
        </span>
      ))}
      {home && (
        <span>
          <PinSwatch face={HOME_FACE} /> 自宅
        </span>
      )}
    </div>
  );
}
