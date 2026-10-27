import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './styles.css';
import { setApi } from './lib/api';
import { createSupabaseApi } from './lib/supabaseApi';
import { createDemoApi } from './lib/demoApi';
import App from './App';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const forceDemo = new URLSearchParams(location.search).has('demo');
setApi(url && key && !forceDemo ? createSupabaseApi(url, key) : createDemoApi());

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
