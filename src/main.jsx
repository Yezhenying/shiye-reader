import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const scope = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${scope}sw.js`, { scope, updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => undefined))
      .catch(error => console.warn('Service Worker 注册失败', error));
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('页面渲染失败', error, info); }
  render() {
    if (this.state.error) return <main className="fatal-error" role="alert"><h1>页面遇到问题</h1><p>本地数据没有因此被删除。请刷新页面；若问题持续，请先从设置导出快照。</p><button onClick={() => location.reload()}>刷新页面</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);
