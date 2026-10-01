import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import type { EvaluationAccess } from './App.js';
import './styles.css';

// Lane D supplies the API URL and Cognito settings (see README). Until they are
// connected the Console stays unconnected and never shows a fabricated result.
const access: EvaluationAccess = { status: 'unconnected', pending: ['評価APIのURL', 'Cognitoログイン'] };

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><App access={access} /></StrictMode>);
