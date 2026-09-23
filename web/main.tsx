import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CloudApp } from './CloudApp';
import '../src/renderer/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Cloud POS root element is missing');
createRoot(root).render(<StrictMode><CloudApp /></StrictMode>);
