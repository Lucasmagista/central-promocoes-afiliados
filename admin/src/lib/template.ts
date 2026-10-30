import type { Offer, Channel } from './types';
import { money } from './format';

/** Variáveis disponíveis nos templates. O texto FINAL é sempre gerado no banco (render_offer_text). */
export const TEMPLATE_VARS: { name: string; help: string }[] = [
  { name: 'title', help: 'Nome curto do produto (até 70 caracteres, como nos canais de ofertas)' },
  { name: 'full_title', help: 'Título completo, como vem da loja' },
  { name: 'ai_text', help: 'Linha de benefício escrita pela IA (some se a IA estiver desligada)' },
  { name: 'price', help: 'Preço atual (R$)' },
  { name: 'previous_line', help: 'Linha "Antes: R$ x (-y%)" — só existe com preço anterior confiável' },
  { name: 'coupon_line', help: 'Linha de cupom — só existe se confirmado' },
  { name: 'observed_at', help: 'Quando o preço foi visto' },
  { name: 'url', help: 'Link curto (ou de afiliado se o link curto estiver desligado)' },
  { name: 'disclosure', help: 'Aviso de afiliado (Configurações)' },
  { name: 'category', help: 'Categoria' },
  { name: 'seller', help: 'Vendedor' },
];

/** Nome curto: mesma regra do banco (short_title). Corta em separador ou palavra inteira, sem terminar em "de", "para"... */
export function shortTitle(title: string, max = 70): string {
  const t = (title ?? '').replace(/\s+/g, ' ').trim(); const m = Math.max(max, 20);
  if (t.length <= m) return t;
  let cut = t[m] === ' ' ? t.slice(0, m) : t.slice(0, m).replace(/\s+\S*$/, '');
  const sep = cut.replace(/\s*[,;|]\s*[^,;|]*$/, '');
  if (sep !== cut && sep.length >= m * 0.55) cut = sep;
  for (let i = 0; i < 4; i++) cut = cut.replace(/[\s,;:|/+&-]+$/, '').replace(/\s+(de|da|do|das|dos|para|pra|com|e|em|p\/|c\/|a|o|ou|no|na|por)$/i, '');
  if ((cut.match(/\(/g) ?? []).length > (cut.match(/\)/g) ?? []).length) cut = cut.replace(/\([^)]*$/, '').trim();
  return cut.length < 3 ? t.slice(0, m) : cut;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RenderContext {
  offer: Pick<Offer, 'title' | 'current_price' | 'previous_price' | 'previous_price_source' | 'discount_pct'
    | 'coupon_code' | 'coupon_confirmed' | 'price_observed_at' | 'category' | 'seller_name' | 'affiliate_url'>;
  disclosure: string;
  shortlinkBase: string;
  code?: string;
  /** Só para a prévia: texto de exemplo da linha da IA. */
  aiText?: string;
}

/** Réplica fiel da regra do banco: linha com variável vazia é descartada; aviso de afiliado é sempre garantido. */
const spin = (t: string) => t.replace(/\[\[([^\[\]]+)\]\]/g, (_m, g: string) => { const o = g.split("|"); return o[Math.floor(Math.random() * o.length)]; });
export function renderTemplate(body: string, channel: Channel, ctx: RenderContext): string {
  const o = ctx.offer;
  const discount = o.discount_pct != null ? String(+o.discount_pct) : '';
  let previousLine = '';
  if (o.previous_price != null && o.discount_pct != null) {
    previousLine = (o.previous_price_source === 'own_history'
      ? `Já registramos por ${money(o.previous_price)}`
      : `Antes: ${money(o.previous_price)}`) + ` (-${discount}%)`;
  }
  const url = ctx.shortlinkBase ? `${ctx.shortlinkBase.replace(/\/+$/, '')}/${ctx.code ?? 'abc123xy'}` : o.affiliate_url ?? '';
  const observed = new Date(o.price_observed_at).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' às');
  const vars: Record<string, string> = {
    title: shortTitle(o.title), full_title: o.title, ai_text: ctx.aiText ?? '', price: money(o.current_price), previous_line: previousLine,
    coupon_line: o.coupon_code && o.coupon_confirmed ? `Cupom: ${o.coupon_code}` : '',
    observed_at: observed, url, disclosure: ctx.disclosure, category: o.category ?? '', seller: o.seller_name ?? '',
  };
  const escape = channel === 'telegram';
  const out: string[] = [];
  for (const line of spin(body).split('\n')) {
    let drop = false;
    let res = line;
    for (const m of new Set([...line.matchAll(/\{\{([a-z_]+)\}\}/g)].map((x) => x[1]))) {
      const v = vars[m] ?? '';
      if (v === '') { drop = true; break; }
      res = res.split(`{{${m}}}`).join(escape ? esc(v) : v);
    }
    if (!drop) out.push(res);
  }
  let text = out.join('\n');
  if (!body.includes('{{disclosure}}') && ctx.disclosure) {
    text += '\n\n' + (escape ? `<i>${esc(ctx.disclosure)}</i>` : ctx.disclosure);
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** Converte a marcação do canal em HTML seguro apenas para a prévia visual. */
export function previewHtml(text: string, channel: Channel): string {
  if (channel === 'telegram') {
    const safe = text
      .replace(/&(?!(amp|lt|gt|quot);)/g, '&amp;')
      .replace(/<(?!\/?(b|i|a)\b)/g, '&lt;')
      .replace(/<a href="([^"]*)"/g, (_m, u: string) => `<a href="${/^https?:\/\//.test(u) ? u : '#'}" target="_blank" rel="noreferrer noopener"`);
    return safe.replace(/\n/g, '<br/>');
  }
  const e = esc(text);
  return e
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/\n/g, '<br/>');
}
