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
// Retorno do login do Mercado Livre: https://painel/oauth/mercadolivre?code=…&state=… → guarda e volta ao painel.
if (location.pathname === '/oauth/mercadolivre') {
  const q = new URLSearchParams(location.search); const code = q.get('code'); const state = q.get('state');
  try { if (code) sessionStorage.setItem('ml_oauth_return', JSON.stringify({ code, state, at: Date.now() })); else sessionStorage.setItem('ml_oauth_return', JSON.stringify({ error: q.get('error_description') || q.get('error') || 'A autorização foi cancelada.', at: Date.now() })); } catch { /* sem sessionStorage */ }
  history.replaceState(null, '', '/#/conectores');
}
const forceDemo = new URLSearchParams(location.search).has('demo');
setApi(url && key && !forceDemo ? createSupabaseApi(url, key) : createDemoApi());

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
