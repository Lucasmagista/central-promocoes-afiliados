import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, can, type SessionState } from './lib/api';
import type { Role } from './lib/types';

interface Ctx { state: SessionState | null; refresh: () => Promise<void>; role: Role | undefined; canOperate: boolean; isAdmin: boolean; dark: boolean; toggleDark: () => void }
const C = createContext<Ctx>(null as never);
export const useSession = () => useContext(C);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('theme') ? localStorage.getItem('theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } });
  const refresh = useCallback(async () => { try { setState(await api().auth.current()); } catch { setState({ status: 'anonymous' }); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* sem storage */ } }, [dark]);
  const role = state?.status === 'ready' ? state.profile.role : undefined;
  return <C.Provider value={{ state, refresh, role, canOperate: can.operate(role), isAdmin: can.admin(role), dark, toggleDark: () => setDark((d) => !d) }}>{children}</C.Provider>;
}
