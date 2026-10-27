import { LICENSING_LABELS } from '../../lib/facility-labels';
import styles from './MapLegend.module.css';
import './pins.css';

export function MapLegend({ hasHome: home }: { hasHome: boolean }) {
  return (
    <div className={styles.legend} role="group" aria-label="地図の凡例">
      <span>
        <i className="pin pin--open" aria-hidden="true">
          2
        </i>{' '}
        空きあり（人数）
      </span>
      <span>
        <i className="pin pin--full" aria-hidden="true">
          ×
        </i>{' '}
        空きなし
      </span>
      <span>
        <i className="pin pin--open pin--unlicensed" aria-hidden="true">
          1
        </i>{' '}
        {LICENSING_LABELS.unlicensed}
      </span>
      {home && (
        <span>
          <i className="pin pin--home" aria-hidden="true">
            家
          </i>{' '}
          自宅
        </span>
      )}
    </div>
  );
}
