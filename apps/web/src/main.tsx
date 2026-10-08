import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ActionResultHost } from './action-result';
import './style.css';
import './calendar.css';
import './cash.css';
import './payment-methods.css';
import './guests.css';
import './rooms.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App/><ActionResultHost/></React.StrictMode>
);
