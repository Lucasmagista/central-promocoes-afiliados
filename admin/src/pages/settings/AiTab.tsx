import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Save, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, Button, Card, Field, Seg, Toggle, useAction, useDialogs, useLoad } from '../../ui/ui';
import { ActionBanner, StateDot, statusOf, useIntAction } from '../../components/integrations';
import type { TabProps } from './shared';
import { stable } from './shared';

interface AiConfig { enabled: boolean; model: string; tone: 'animado' | 'neutro' | 'chamativo'; style: string; max_per_hour: number }
const DEF: AiConfig = { enabled: false, model: 'openai/gpt-4o-mini', tone: 'animado', style: '', max_per_hour: 120 };
const MODELS = ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'anthropic/claude-3.5-haiku', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'];

export default function AiTab({ s, reload, isAdmin }: TabProps) {
  const cfg: AiConfig = { ...DEF, ...((s.ai_config as Partial<AiConfig> | undefined) ?? {}) }; const st = statusOf(s, 'ai');
  const key = useLoad(() => api().getAiKeyStatus(), [], 0);
  const { run, busy } = useAction(); const { confirm } = useDialogs();
  const [f, setF] = useState(cfg); const sig = stable(cfg);
  useEffect(() => { setF(cfg); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const out: AiConfig = { ...f, model: f.model.trim(), style: f.style.trim(), max_per_hour: Math.max(1, Math.min(Number(f.max_per_hour) || 120, 1000)) };
  const dirty = stable(out) !== stable(cfg);
  const [val, setVal] = useState(''); const [edit, setEdit] = useState(false); const [title, setTitle] = useState('');
  const act = useIntAction();
  const hasKey = !!key.data?.is_set; const live = cfg.enabled && hasKey;

  const save = async () => { if (await run('save-ai', () => api().setSetting('ai_config', out), 'Configuração da IA salva')) reload(); };
  const saveKey = async () => { if (val.trim() && await run('ai-key', () => api().setAiKey(val.trim()), 'Chave guardada com segurança')) { setVal(''); setEdit(false); void key.reload(); } };
  const removeKey = async () => {
    if (!(await confirm({ title: 'Remover a chave do OpenRouter?', danger: true, confirmLabel: 'Remover', body: 'A IA para de criar legendas e as mensagens voltam a usar o nome curto do produto.' }))) return;
    if (await run('ai-key-del', () => api().clearAiKey(), 'Chave removida')) void key.reload();
  };

  return <div className="col" style={{ gap: 14 }}>
    <section className="card">
      <div className="statushero">
        <div className="row" style={{ gap: 14, minWidth: 0 }}>
          <span className="heroico"><Sparkles size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}><h2>IA para criar os textos</h2>
              {live ? <Badge tone="ok"><StateDot tone="ok" />Ligada</Badge> : <Badge><StateDot tone="off" />{cfg.enabled ? 'Falta a chave' : 'Desligada'}</Badge>}
              {st.ok === false && <Badge tone="bad">com erro</Badge>}</div>
            <div className="small muted">Cada oferta ganha uma manchete com emoji e uma linha de benefício, escritas pelo modelo que você escolher no OpenRouter. Sem a IA, a mensagem usa o nome curto do produto.</div>
          </div>
        </div>
        <div className="row wrap right"><span className="small muted">Usar a IA</span><Toggle label="Usar a IA" checked={f.enabled} disabled={!isAdmin} onChange={(v) => setF({ ...f, enabled: v })} /></div>
      </div>
      {st.ok === false && <div style={{ padding: '0 18px 14px' }}><div className="alert critical" role="alert"><div>{String(st.error ?? 'A IA parou por um erro.')}</div></div></div>}
      {!!st.last_run_at && <div className="small muted" style={{ padding: '0 18px 14px' }}>Última rodada: {String(st.last_run_at).replace('T', ' ').slice(0, 16)} · {Number(st.done ?? 0)} legenda(s) criada(s){Number(st.failed ?? 0) ? `, ${Number(st.failed)} sem sucesso` : ''}</div>}
    </section>

    <Card title="Chave do OpenRouter" actions={<Badge tone={hasKey ? 'ok' : 'warn'}><KeyRound size={12} />{hasKey ? `guardada •••• ${key.data?.hint ?? ''}` : 'não informada'}</Badge>}>
      <div className="col">
        <div className="small muted">Crie a chave em <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener">openrouter.ai/keys <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a> e adicione um pouco de saldo na conta. A chave fica guardada no banco, só de escrita: depois de salvar ela nunca volta para a tela.</div>
        {(!hasKey || edit) ? <div className="row">
          <input type="password" autoComplete="new-password" spellCheck={false} aria-label="Chave do OpenRouter" placeholder="sk-or-v1-…" value={val} disabled={!isAdmin} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveKey()} style={{ flex: 1, minWidth: 0 }} />
          <Button variant="primary" size="sm" icon={<KeyRound size={14} />} disabled={!isAdmin || !val.trim()} busy={busy === 'ai-key'} onClick={saveKey}>Guardar chave</Button>
          {hasKey && <Button size="sm" onClick={() => { setEdit(false); setVal(''); }}>Cancelar</Button>}
        </div> : <div className="row wrap">
          <Button size="sm" disabled={!isAdmin} onClick={() => setEdit(true)}>Trocar chave</Button>
          <Button size="sm" variant="danger" disabled={!isAdmin} busy={busy === 'ai-key-del'} onClick={removeKey}>Remover</Button>
        </div>}
      </div>
    </Card>

    <Card title="Modelo e estilo" actions={<Button variant="primary" size="sm" icon={<Save size={14} />} disabled={!isAdmin || !dirty || !out.model} busy={busy === 'save-ai'} onClick={save}>Salvar</Button>}>
      <fieldset disabled={!isAdmin} className="bare"><div className="col">
        <div className="grid g2">
          <Field label="Modelo" hint="Qualquer modelo do OpenRouter (nome como aparece lá, ex.: openai/gpt-4o-mini). Os modelos “mini/flash/haiku” são baratos e bastam para legendas curtas.">
            <input list="ai-models" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="openai/gpt-4o-mini" /></Field>
          <Field label="Limite por hora" hint="Teto de legendas por hora, para o custo nunca passar do esperado.">
            <input type="number" min={1} max={1000} value={f.max_per_hour} onChange={(e) => setF({ ...f, max_per_hour: Number(e.target.value) })} /></Field>
        </div>
        <datalist id="ai-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
        <Field label="Tom"><Seg value={f.tone} onChange={(tone) => setF({ ...f, tone })} options={[{ v: 'animado', label: 'Animado' }, { v: 'neutro', label: 'Neutro' }, { v: 'chamativo', label: 'Chamativo' }]} /></Field>
        <Field label="Instruções do seu estilo (opcional)" hint="Ex.: “fale como um amigo que garimpa ofertas, frases curtas, no máximo 2 emojis, nunca use ponto de exclamação duplo”. Termos proibidos das Regras de publicação continuam valendo.">
          <textarea rows={3} maxLength={600} value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })} placeholder="Escreva como o seu canal fala" /></Field>
      </div></fieldset>
    </Card>

    <Card title="Testar" actions={<Button icon={<Wand2 size={14} />} disabled={!isAdmin || dirty || !hasKey || act.running} busy={act.running} onClick={() => act.start('ai', 'test', title.trim() ? { title: title.trim() } : undefined, 'Gerando um exemplo')}>Gerar exemplo</Button>}>
      <div className="col">
        <Field label="Produto de exemplo (opcional)" hint={dirty ? 'Salve as alterações antes de testar.' : 'Deixe vazio para usar um fone Bluetooth de exemplo.'}>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Air Fryer Digital 4L Inox 1500W" /></Field>
        <ActionBanner act={act} okText={(r) => `Pronto em ${Math.round(Number(r.ms ?? 0) / 100) / 10}s com ${String(r.model ?? '')}.`} />
        {act.result?.headline && <div className="phone"><div className="bubble"><b>{String(act.result.headline)}</b>{!!act.result.body && <div>{String(act.result.body)}</div>}<div className="muted" style={{ marginTop: 6 }}>💰 R$ 89,90 · 🛒 link da oferta</div></div></div>}
      </div>
    </Card>

    <Card title="Como funciona" actions={<Badge tone="ok"><ShieldCheck size={12} />sem dados pessoais</Badge>}>
      <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li>O worker pede a legenda quando a oferta chega para revisão, <b>antes</b> do modo automático aprovar. As de maior score vão primeiro.</li>
        <li>Para a IA vão só: nome do produto, plataforma, categoria, desconto e se há cupom. Nunca chaves, links, telefones ou dados de clientes.</li>
        <li>A manchete entra no lugar do título (<code>{'{{title}}'}</code>) e o benefício na variável <code>{'{{ai_text}}'}</code>, que já vem logo abaixo do título nos modelos. Preço, link e aviso de afiliado continuam sendo montados pelo sistema.</li>
        <li>Legenda com termo proibido, link ou fora do tamanho é descartada (uma segunda tentativa pede para reescrever). Se a IA falhar, usa o nome curto.</li>
        <li>Se a chave for recusada ou acabar o saldo, a IA pausa sozinha e o erro aparece aqui.</li>
      </ul>
    </Card>
  </div>;
}
