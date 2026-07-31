import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ContextProvider } from './context/ContextManager';
import { BusinessSettingsProvider } from './context/BusinessSettingsContext';
import { ThemeProvider } from './design-system/themes/ThemeProvider';
import { App } from './App';
import './i18n';
import './design-system/tokens/index.css';
import './design-system/themes/dark.css';
import './design-system/themes/light.css';
import './design-system/themes/theme-lock.css';
import './design-system/themes/transitions.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ContextProvider>
          <BusinessSettingsProvider>
            <ThemeProvider>
              <App />
            </ThemeProvider>
          </BusinessSettingsProvider>
        </ContextProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
