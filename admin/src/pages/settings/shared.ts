import type { SecretInfo, SettingsMap } from '../../lib/types';
export interface TabProps { s: SettingsMap; secrets: SecretInfo[]; reload: () => void; isAdmin: boolean }
export const secretOf = (secrets: SecretInfo[], k: SecretInfo['key']) => secrets.find((x) => x.key === k);
export const digitsOnly = (v: string) => v.replace(/\D/g, '');
/** JSON com chaves ordenadas: o banco (jsonb) reordena as chaves, então comparar texto cru acusaria mudança que não existe. */
export const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b))) : x));
