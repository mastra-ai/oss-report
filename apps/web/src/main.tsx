import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { HomePage } from './pages/HomePage';
import { ReportPage } from './pages/ReportPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<HomePage />} />
          <Route path="reports/:id" element={<ReportPage />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
