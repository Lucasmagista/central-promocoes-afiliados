const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v: number | null | undefined) => (v == null ? '—' : brl.format(v));
export const int = (v: number | null | undefined) => (v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v));
export const pct = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;

const TZ = 'America/Sao_Paulo';
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const dateFull = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' }) : '—';
export const dayLabel = (isoDay: string) => {
  const [, m, d] = isoDay.split('-');
  return `${d}/${m}`;
};

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'agora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const minutesLabel = (m: number | null | undefined) => {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
};

export const platformName: Record<string, string> = {
  mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon Brasil', aliexpress: 'AliExpress', magalu: 'Magalu', network: 'Redes de afiliados',
};
export const channelName: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp' };

export const offerStatusLabel: Record<string, string> = {
  discovered: 'Descoberta', needs_review: 'Em revisão', approved: 'Aprovada', scheduled: 'Agendada',
  published: 'Publicada', rejected: 'Rejeitada', expired: 'Expirada',
};
export const pubStatusLabel: Record<string, string> = {
  pending: 'Na fila', claimed: 'Enviando', sent: 'Enviada', retry_scheduled: 'Nova tentativa',
  failed_permanent: 'Falha permanente', unknown: 'Unknown (reconciliar)', cancelled: 'Cancelada',
};
export const connectorModeLabel: Record<string, string> = {
  disabled: 'Desabilitado', manual_only: 'Somente manual', api_pending: 'API pendente',
  api_ready: 'API pronta', paused_policy: 'Pausado por política', error: 'Erro',
};
export const roleLabel: Record<string, string> = { admin: 'Administrador', operator: 'Operador', viewer: 'Leitor' };
export const sourceLabel: Record<string, string> = {
  api: 'API oficial', feed: 'Feed', admin_declared: 'Declarado manualmente',
};

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function download(name: string, content: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
