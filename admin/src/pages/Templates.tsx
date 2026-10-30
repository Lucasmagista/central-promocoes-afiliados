import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, History, Italic, Link2, RotateCcw, Save, Send } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../session';
import { TEMPLATE_VARS, renderTemplate } from '../lib/template';
import { dateTime } from '../lib/format';
import type { Offer, Template } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHead, Toggle, useAction, useLoad } from '../ui/ui';
import { Bubble } from '../components/Approve';

type Sample = Pick<Offer, 'title' | 'current_price' | 'previous_price' | 'previous_price_source' | 'discount_pct' | 'coupon_code' | 'coupon_confirmed' | 'price_observed_at' | 'category' | 'seller_name' | 'affiliate_url'>;
const BASE: Sample = {
  title: 'Fone de Ouvido Bluetooth TWS com Cancelamento de Ruído', current_price: 189.9, previous_price: 299.9, previous_price_source: 'api', discount_pct: 36.68,
  coupon_code: 'TECH10', coupon_confirmed: true, price_observed_at: new Date().toISOString(), category: 'Eletrônicos', seller_name: 'Loja Oficial', affiliate_url: 'https://exemplo.com/aff/abc',
};
const SCEN: { v: string; label: string; make: (b: Sample) => Sample }[] = [
  { v: 'full', label: 'Com desconto e cupom', make: (b) => b },
  { v: 'hist', label: 'Preço do histórico', make: (b) => ({ ...b, previous_price_source: 'own_history' }) },
  { v: 'no_prev', label: 'Sem preço anterior', make: (b) => ({ ...b, previous_price: null, discount_pct: null, previous_price_source: null, coupon_code: null }) },
  { v: 'coupon_unc', label: 'Cupom não confirmado', make: (b) => ({ ...b, coupon_confirmed: false }) },
  { v: 'long', label: 'Título muito longo', make: (b) => ({ ...b, title: b.title + ' — edição especial com estojo de carregamento sem fio, 40 horas de bateria, resistência à água IPX5 e garantia estendida de 12 meses' }) },
];
const KIND: Record<Template['kind'], string> = { offer: 'Oferta', price_drop: 'Queda de preço', daily_summary: 'Resumo do dia' };
const CH = (c: string) => (c === 'telegram' ? 'Telegram' : 'WhatsApp');
const LIMIT = (c: string) => (c === 'telegram' ? 4096 : 1000);

function History_({ t, onClose, onRestore }: { t: Template; onClose: () => void; onRestore: (body: string) => void }) {
  const q = useLoad(() => api().listTemplateVersions(t.id), [t.id]);
  const [open, setOpen] = useState<number | null>(null);
  return <Modal wide title={`Histórico — ${t.name}`} onClose={onClose} footer={<Button onClick={onClose}>Fechar</Button>}>
    {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : !q.data?.length ? <div className="empty">Ainda não há versões anteriores. Elas aparecem a cada alteração salva.</div> :
      <div className="col">{q.data.map((v) => <div key={v.id} className="card" style={{ padding: 12 }}>
        <div className="row"><Badge>v{v.version}</Badge><span className="small muted">{dateTime(v.changed_at)}</span>
          <span className="right row"><Button size="sm" variant="ghost" onClick={() => setOpen(open === v.version ? null : v.version)}>{open === v.version ? 'Ocultar' : 'Ver texto'}</Button>
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => { onRestore(v.body); onClose(); }}>Restaurar no editor</Button></span></div>
        {open === v.version && <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>{v.body}</pre>}
      </div>)}</div>}
  </Modal>;
}

function Editor({ t, disabled, onSaved }: { t: Template; disabled: boolean; onSaved: () => void }) {
  const settings = useLoad(() => api().getSettings(), []);
  const [body, setBody] = useState(t.body);
  const [scen, setScen] = useState('full');
  const [price, setPrice] = useState('189.9');
  const [hist, setHist] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const { run, busy } = useAction();
  useEffect(() => setBody(t.body), [t.id, t.body]);
  const s = settings.data ?? {};
  const sample = useMemo(() => { const x = SCEN.find((c) => c.v === scen)!.make(BASE); const p = Number(price); return p > 0 ? { ...x, current_price: p, discount_pct: x.previous_price ? +(((x.previous_price - p) / x.previous_price) * 100).toFixed(2) : null } : x; }, [scen, price]);
  let preview = ''; let err: string | null = null;
  try { preview = renderTemplate(body, t.channel, { offer: sample, disclosure: String(s.affiliate_disclosure ?? ''), shortlinkBase: String(s.shortlink_base ?? ''), code: 'k7Fq2xPa', aiText: 'Bateria para o dia todo ✨' }); } catch (e) { err = String(e); }
  const used = [...new Set([...body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]))];
  const unknown = used.filter((v) => !TEMPLATE_VARS.some((x) => x.name === v));
  const dirty = body !== t.body;
  const lim = LIMIT(t.channel);
  const lacksUrl = !used.includes('url');
  const lacksTitle = !used.includes('title');
  const lacksPrice = !used.includes('price');

  const insert = (txt: string, wrap = false) => {
    const el = ta.current; if (!el || disabled) return;
    const a = el.selectionStart; const b = el.selectionEnd;
    const sel = body.slice(a, b);
    const ins = wrap ? txt.replace('§', sel || 'texto') : txt;
    const next = body.slice(0, a) + ins + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); const pos = a + ins.length; el.setSelectionRange(pos, pos); });
  };
  const bold = t.channel === 'telegram' ? '<b>§</b>' : '*§*';
  const ital = t.channel === 'telegram' ? '<i>§</i>' : '_§_';

  return (
    <div className="grid split">
      <div className="col">
        <Card title={<span className="row wrap">{t.name}<Badge>v{t.version}</Badge><Badge tone={t.active ? 'ok' : undefined}>{t.active ? 'ativo' : 'inativo'}</Badge></span>} actions={<>
          <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => setHist(true)}>Histórico</Button>
          <Toggle label="Template ativo" checked={t.active} disabled={disabled} onChange={async (v) => { if (await run('a', () => api().saveTemplate(t.id, { active: v }), v ? 'Template ativado' : 'Template desativado')) onSaved(); }} /></>}>
          <div className="col">
            {!disabled && <div className="row wrap" style={{ gap: 6 }} role="toolbar" aria-label="Formatação">
              <Button size="sm" icon={<Bold size={14} />} onClick={() => insert(bold, true)}>Negrito</Button>
              <Button size="sm" icon={<Italic size={14} />} onClick={() => insert(ital, true)}>Itálico</Button>
              {t.channel === 'telegram' && <Button size="sm" icon={<Link2 size={14} />} onClick={() => insert('<a href="{{url}}">§</a>', true)}>Link</Button>}
              <span className="small muted" style={{ marginLeft: 6 }}>Inserir:</span>
              {TEMPLATE_VARS.map((v) => <button key={v.name} type="button" className="varchip" title={v.help} onClick={() => insert(`{{${v.name}}}`)}>{`{{${v.name}}}`}</button>)}
            </div>}
            <textarea ref={ta} aria-label="Corpo do template" className="mono" style={{ minHeight: 300 }} readOnly={disabled} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
            <div className="row small muted"><span style={{ color: body.length > lim ? 'var(--bad)' : undefined }}>{body.length} caracteres no modelo</span><span className="right">{t.channel === 'telegram' ? 'HTML: <b> <i> <a>' : 'WhatsApp: *negrito* _itálico_'}</span></div>
            {unknown.length > 0 && <div className="alert critical">Variável(is) desconhecida(s): {unknown.map((v) => `{{${v}}}`).join(', ')} — a linha inteira será descartada.</div>}
            {t.kind === 'offer' && (lacksUrl || lacksTitle || lacksPrice) && <div className="alert warning">Faltam elementos essenciais: {[lacksTitle && '{{title}}', lacksPrice && '{{price}}', lacksUrl && '{{url}}'].filter(Boolean).join(', ')}. Uma oferta sem eles não leva o cliente ao produto.</div>}
            {!body.includes('{{disclosure}}') && <div className="small muted">O aviso de afiliado é adicionado ao final automaticamente; use <code>{'{{disclosure}}'}</code> para escolher onde ele aparece.</div>}
            {!disabled && <div className="row"><Button variant="primary" icon={<Save size={15} />} disabled={!dirty || !body.trim() || unknown.length > 0} busy={busy === 's'} onClick={async () => { if (await run('s', () => api().saveTemplate(t.id, { body }), 'Template salvo (nova versão)')) onSaved(); }}>Salvar nova versão</Button>
              {dirty && <Button variant="ghost" onClick={() => setBody(t.body)}>Descartar alterações</Button>}</div>}
            <div className="small muted">Última alteração: {dateTime(t.updated_at)}. Publicações já enfileiradas mantêm o texto de quando foram aprovadas.</div>
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="Prévia ao vivo">
          <div className="col">
            <div className="grid g2">
              <Field label="Situação"><select value={scen} onChange={(e) => setScen(e.target.value)}>{SCEN.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></Field>
              <Field label="Preço de teste (R$)"><input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            </div>
            {err ? <ErrorBox error={err} /> : <Bubble text={preview} channel={t.channel} />}
            <div className="row small muted"><span style={{ color: preview.length > lim ? 'var(--bad)' : undefined }}>{preview.length} / {lim} caracteres{t.channel === 'telegram' ? ' (legenda de imagem: 1024)' : ''}</span>
              <span className="right"><Send size={12} style={{ verticalAlign: -1 }} /> {preview.split('\n').filter(Boolean).length} linhas</span></div>
            {t.channel === 'telegram' && preview.length > 1024 && <div className="alert warning small">Acima de 1024 caracteres o Telegram não aceita como legenda de imagem; a oferta sairá sem imagem.</div>}
          </div>
        </Card>
        <Card title="Variáveis"><div className="col" style={{ gap: 6 }}>{TEMPLATE_VARS.map((v) => <div key={v.name} className="small"><code style={{ opacity: used.includes(v.name) ? 1 : .7 }}>{`{{${v.name}}}`}</code> {used.includes(v.name) && <Badge tone="ok">em uso</Badge>} <span className="muted">— {v.help}</span></div>)}
          <div className="small muted" style={{ marginTop: 6 }}>Regra: se uma variável de uma linha estiver vazia, a linha inteira some. Assim não sobra “Cupom:” sem cupom.</div></div></Card>
      </div>
      {hist && <History_ t={t} onClose={() => setHist(false)} onRestore={setBody} />}
    </div>);
}

export default function Templates() {
  const { isAdmin } = useSession();
  const q = useLoad(() => api().listTemplates(), []);
  const [sel, setSel] = useState<string | null>(null);
  const list = q.data ?? [];
  const cur = list.find((t) => t.id === sel) ?? list[0];
  return (
    <>
      <PageHead title="Templates" sub="O texto final é sempre montado pelo banco, com as mesmas regras desta prévia. Alterar cria uma nova versão." />
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.reloadLoud} /> : !cur ? <Card><div className="empty">Nenhum template.</div></Card> : <>
        <div className="row wrap" style={{ marginBottom: 14, gap: 8 }} role="tablist" aria-label="Templates">
          {list.map((t) => <button key={t.id} role="tab" aria-selected={t.id === cur.id} className="tplpick" onClick={() => setSel(t.id)}>
            <b>{CH(t.channel)}</b><span>{KIND[t.kind]}</span><small>v{t.version}{t.active ? '' : ' · inativo'}</small></button>)}
        </div>
        <Editor t={cur} disabled={!isAdmin} onSaved={q.reload} /></>}
    </>);
}
