import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyTheme, loadTheme } from './ui/theme';
import './styles/index.css';

// Applied before the first render so the table never flashes the wrong colour.
applyTheme(loadTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
