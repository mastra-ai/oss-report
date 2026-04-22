import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { HomePage } from './pages/HomePage';
import { ReportPage } from './pages/ReportPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<HomePage />} />
          <Route path="reports/:id" element={<ReportPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
