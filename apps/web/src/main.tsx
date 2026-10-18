import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
let stored: string | null = null;
try { stored = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
if (stored === 'dark' || (!stored && prefersDark)) document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
