import { describe, expect, it } from 'vitest';
import { renderTemplate } from './template';

const base = { title: 'Fone <X>', current_price: 189.9, previous_price: 299.9, previous_price_source: 'api' as const, discount_pct: 36.68, coupon_code: 'TECH10', coupon_confirmed: true, price_observed_at: '2026-10-26T15:00:00Z', category: null, seller_name: null, affiliate_url: 'https://amazon.com.br/x' };
const body = '<b>{{title}}</b>\n{{previous_line}}\n{{coupon_line}}\n{{url}}\n<i>{{disclosure}}</i>';

describe('renderTemplate', () => {
  it('escapa HTML no Telegram', () => expect(renderTemplate(body, 'telegram', { offer: base, disclosure: 'aviso', shortlinkBase: '' })).toContain('Fone &lt;X&gt;'));
  it('descarta a linha de preço anterior quando não há', () => {
    const t = renderTemplate(body, 'whatsapp', { offer: { ...base, previous_price: null, discount_pct: null, previous_price_source: null }, disclosure: 'aviso', shortlinkBase: '' });
    expect(t).not.toContain('Antes');
  });
  it('só mostra cupom confirmado', () => expect(renderTemplate(body, 'whatsapp', { offer: { ...base, coupon_confirmed: false }, disclosure: 'a', shortlinkBase: '' })).not.toContain('TECH10'));
  it('sempre anexa o aviso de afiliado', () => expect(renderTemplate('{{title}}', 'whatsapp', { offer: base, disclosure: 'AVISO', shortlinkBase: '' })).toContain('AVISO'));
  it('usa o link curto quando configurado', () => expect(renderTemplate(body, 'whatsapp', { offer: base, disclosure: 'a', shortlinkBase: 'https://go.x.com/', code: 'abc' })).toContain('https://go.x.com/abc'));
});
