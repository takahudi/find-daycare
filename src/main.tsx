import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadDataset } from './lib/dataset';
import DatasetErrorScreen from './app/DatasetErrorScreen.tsx';
import App from './app/App.tsx';
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
        <DatasetErrorScreen error={error} />
      </StrictMode>,
    );
  },
);
