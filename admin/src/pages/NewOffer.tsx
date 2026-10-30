import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { platformName, sourceLabel } from '../lib/format';
import type { Availability, IngestInput, IngestResult, Platform, SourceKind } from '../lib/types';
import { Button, Card, Field, PageHead, useAction } from '../ui/ui';
import { useSession } from '../session';
import { AlertTriangle, CheckCircle2, Copy } from 'lucide-react';

const empty = { platform: 'mercadolivre' as Platform, title: '', original_url: '', affiliate_url: '', price: '', previous_price: '', category: '', seller_name: '', coupon_code: '', coupon_confirmed: false, availability: 'in_stock' as Availability, source_kind: 'admin_declared' as SourceKind, expires_at: '' };

export default function NewOffer() {
  const { canOperate } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState(empty);
  const [res, setRes] = useState<IngestResult | null>(null);
  const { run, busy } = useAction();
  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const price = Number(f.price.replace(',', '.'));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setRes(null);
    const input: IngestInput = {
      platform: f.platform, title: f.title, original_url: f.original_url.trim(), affiliate_url: f.affiliate_url.trim() || undefined, price,
      previous_price: f.previous_price ? Number(f.previous_price.replace(',', '.')) : undefined, availability: f.availability, category: f.category || undefined,
      seller_name: f.seller_name || undefined, coupon_code: f.coupon_code || undefined, coupon_confirmed: f.coupon_confirmed,
      expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : undefined, source_kind: f.source_kind, source_name: 'Painel (manual)',
    };
    await run('save', async () => { setRes(await api().ingestOffer(input)); });
  };
  if (!canOperate) return <><PageHead title="Nova oferta" /><div className="alert warning">Seu perfil é somente leitura.</div></>;
  return (
    <>
      <PageHead title="Nova oferta manual" sub="Cadastro de oferta encontrada por você. Todas as regras do banco valem aqui — sem atalhos." />
      <div className="grid split">
        <Card><form className="col" onSubmit={submit}>
          <div className="grid g2">
            <Field label="Plataforma"><select value={f.platform} onChange={(e) => set('platform', e.target.value as Platform)}>{(['mercadolivre', 'shopee', 'amazon', 'aliexpress', 'magalu'] as const).map((p) => <option key={p} value={p}>{platformName[p]}</option>)}</select></Field>
            <Field label="Origem do dado" hint="Define o que o sistema aceita como preço anterior."><select value={f.source_kind} onChange={(e) => set('source_kind', e.target.value as SourceKind)}>{Object.entries(sourceLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <Field label="Título"><input required maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="URL do produto" hint="Precisa estar nos domínios permitidos da plataforma (Configurações)."><input required type="url" value={f.original_url} onChange={(e) => set('original_url', e.target.value)} placeholder="https://" /></Field>
          <Field label="Link de afiliado" hint="Gere no painel oficial do programa. Pode ficar vazio agora, mas é obrigatório para aprovar."><input type="url" value={f.affiliate_url} onChange={(e) => set('affiliate_url', e.target.value)} placeholder="https://" /></Field>
          <div className="grid g3">
            <Field label="Preço atual (R$)"><input required inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="Preço anterior (R$)" hint={f.source_kind === 'admin_declared' ? 'Será ignorado: dado manual não é fonte confiável.' : 'Só vale com fonte oficial.'}><input inputMode="decimal" value={f.previous_price} onChange={(e) => set('previous_price', e.target.value)} /></Field>
            <Field label="Disponibilidade"><select value={f.availability} onChange={(e) => set('availability', e.target.value as Availability)}><option value="in_stock">Em estoque</option><option value="unknown">Desconhecida</option><option value="out_of_stock">Sem estoque</option></select></Field>
          </div>
          <div className="grid g3">
            <Field label="Categoria"><input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Ex.: Eletrônicos" /></Field>
            <Field label="Vendedor"><input value={f.seller_name} onChange={(e) => set('seller_name', e.target.value)} /></Field>
            <Field label="Oferta expira em"><input type="datetime-local" value={f.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></Field>
          </div>
          <div className="grid g2">
            <Field label="Cupom"><input value={f.coupon_code} onChange={(e) => set('coupon_code', e.target.value)} /></Field>
            <label className="row" style={{ alignSelf: 'end', paddingBottom: 9 }}><input type="checkbox" checked={f.coupon_confirmed} onChange={(e) => set('coupon_confirmed', e.target.checked)} /> Confirmei que o cupom funciona agora</label>
          </div>
          <div className="row"><Button type="submit" variant="primary" busy={busy === 'save'} disabled={!(price > 0)}>Enviar para revisão</Button>
            <Button type="button" onClick={() => { setF(empty); setRes(null); }}>Limpar</Button></div>
        </form></Card>
        <div className="col">
          <Card title="Resultado">
            {!res ? <div className="muted small">O resultado da validação aparece aqui.</div> :
              res.status === 'created' ? <div className="col"><div className="alert info"><CheckCircle2 size={16} style={{ flex: 'none', marginTop: 2 }} />Oferta criada com score <b>{res.score}</b> e enviada para a fila de aprovação.</div>
                {res.notes?.map((n) => <div key={n} className="alert warning"><AlertTriangle size={16} style={{ flex: 'none', marginTop: 2 }} />{n}</div>)}
                <Button variant="primary" onClick={() => nav('/revisao')}>Ir para a fila</Button></div> :
              res.status === 'duplicate' ? <div className="alert warning"><Copy size={16} style={{ flex: 'none', marginTop: 2 }} />Já existe uma oferta aberta para este produto. Nada foi criado.</div> :
                <div className="col">{res.failures?.map((x) => <div key={x.code} className="alert critical"><AlertTriangle size={16} style={{ flex: 'none', marginTop: 2 }} />{x.message}</div>)}</div>}
          </Card>
          <Card title="Regras que se aplicam"><ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Domínio do produto e do link de afiliado precisam estar na lista permitida.</li>
            <li>Preço anterior só vale vindo de API/feed ou do histórico próprio.</li>
            <li>Cupom só entra na mensagem se confirmado.</li>
            <li>Produto sem estoque ou oferta vencida é recusado.</li>
          </ul></Card>
        </div>
      </div>
    </>);
}
