import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { StudentApp } from './StudentApp';
import { Dashboard } from './Dashboard';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/dashboard') ? <Dashboard /> : <StudentApp />}
  </React.StrictMode>
);
