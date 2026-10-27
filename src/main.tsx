import { StrictMode } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react';
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
        <NuqsAdapter defaultOptions={{ history: 'replace', clearOnDefault: true }}>
          <App data={data} />
        </NuqsAdapter>
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
