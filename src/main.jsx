import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Service Worker 注册失败', error)));
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
