import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadDataset } from './lib/dataset';
import DatasetError from './features/dataset/DatasetError.tsx';
import App from './App.tsx';
import './index.css';

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
