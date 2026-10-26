import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App.tsx';
import DatasetError from './components/DatasetError.tsx';
import { loadDataset } from './lib/dataset';

const root = createRoot(document.getElementById('root')!);

loadDataset(document.querySelector<HTMLLinkElement>('#facilities-data')?.href ?? null).then(
  (data) => {
    root.render(
      <StrictMode>
        <App data={data} />
      </StrictMode>,
    );
  },
  (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    root.render(
      <StrictMode>
        <DatasetError error={error} />
      </StrictMode>,
    );
  },
);
