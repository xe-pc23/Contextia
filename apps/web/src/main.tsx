import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Bootstrap } from './Bootstrap.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><Bootstrap /></StrictMode>);
