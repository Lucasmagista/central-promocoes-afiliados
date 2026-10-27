import { useEffect, useState } from 'react';
import { Check, Minus, Save } from 'lucide-react';
import { api } from '../lib/api';
import type { GroupDefaults, SettingsMap } from '../lib/types';
import { Button, Card, Field, Toggle, useAction } from '../ui/ui';
import { stable } from '../pages/settings/shared';

export const GROUP_DEF: GroupDefaults = {
  whatsapp: { only_admins_send: true, lock_info: true, ephemeral_seconds: 0, add_disclosure: true, add_batch_size: 20, add_delay_s: 6, invite_after_create: true },
  telegram: { restrict_members_send: false, add_disclosure: true },
};
const merged = (s: SettingsMap): GroupDefaults => { const g = (s.int_groups ?? {}) as Partial<GroupDefaults>; return { whatsapp: { ...GROUP_DEF.whatsapp, ...(g.whatsapp ?? {}) }, telegram: { ...GROUP_DEF.telegram, ...(g.telegram ?? {}) } }; };

const WA_CAN: [string, boolean][] = [
  ['Criar grupos e definir nome e descrição', true], ['Só administradores enviam / editam dados', true], ['Mensagens temporárias (24 h, 7 ou 90 dias)', true],
  ['Link de convite (ver, revogar e gerar outro)', true], ['Adicionar e remover participantes, promover e rebaixar', true], ['Convidar por mensagem privada', true], ['Sair do grupo', true],
  ['Aprovar pedidos de entrada (use o aplicativo)', false], ['Criar comunidades e canais (use o aplicativo)', false],
];
const TG_CAN: [string, boolean][] = [
  ['Mudar título e descrição de grupos e canais', true], ['Liberar ou travar o envio de membros', true], ['Criar, ver e revogar links de convite', true], ['Listar administradores e contar membros', true], ['Sair do chat', true],
  ['Criar grupos ou canais (só pelo aplicativo)', false], ['Adicionar membros por API (eles entram pelo link)', false], ['Listar todos os membros (só administradores)', false],
];

/** Padrões aplicados a grupos novos + o que cada plataforma permite por API. */
export default function GroupDefaultsCard({ channel, s, reload, isAdmin }: { channel: 'whatsapp' | 'telegram'; s: SettingsMap; reload: () => void; isAdmin: boolean }) {
  const cur = merged(s); const sig = stable(cur);
  const { run, busy } = useAction();
  const [f, setF] = useState(cur);
  useEffect(() => { setF(merged(s)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);
  const dirty = stable(f[channel]) !== stable(cur[channel]);
  const save = async () => { if (await run('grp-' + channel, () => api().saveGroupDefaults({ [channel]: f[channel] } as never), 'Padrões de grupo salvos')) reload(); };
  const wa = f.whatsapp, tg = f.telegram; const can = channel === 'whatsapp' ? WA_CAN : TG_CAN;
  return (
    <Card title="Grupos: padrões e o que a plataforma permite">
      <fieldset disabled={!isAdmin} className="bare"><div className="col">
        {channel === 'whatsapp' ? <>
          <div className="small muted">Aplicados automaticamente quando o painel cria um grupo novo (e em “Aplicar padrões do painel”, nos grupos existentes).</div>
          <div className="row"><Toggle label="Só administradores enviam" checked={wa.only_admins_send} onChange={(v) => setF({ ...f, whatsapp: { ...wa, only_admins_send: v } })} /><span><b>Só administradores enviam mensagens</b><div className="small muted">Grupo de ofertas sem conversa paralela.</div></span></div>
          <div className="row"><Toggle label="Só administradores editam dados" checked={wa.lock_info} onChange={(v) => setF({ ...f, whatsapp: { ...wa, lock_info: v } })} /><span><b>Só administradores editam nome, foto e descrição</b></span></div>
          <div className="row"><Toggle label="Aviso de afiliado na descrição" checked={wa.add_disclosure} onChange={(v) => setF({ ...f, whatsapp: { ...wa, add_disclosure: v } })} /><span><b>Incluir o aviso de afiliado na descrição</b><div className="small muted">Usa o texto de Configurações → Geral. Exigido por Mercado Livre, Shopee e Amazon.</div></span></div>
          <div className="row"><Toggle label="Gerar link de convite ao criar" checked={wa.invite_after_create} onChange={(v) => setF({ ...f, whatsapp: { ...wa, invite_after_create: v } })} /><span><b>Gerar o link de convite ao criar o grupo</b></span></div>
          <div className="grid g3">
            <label className="f">Mensagens temporárias
              <select value={wa.ephemeral_seconds} onChange={(e) => setF({ ...f, whatsapp: { ...wa, ephemeral_seconds: Number(e.target.value) } })}>{[[0, 'Desligadas'], [86400, '24 horas'], [604800, '7 dias'], [7776000, '90 dias']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <Field label="Participantes por lote" hint="Ao adicionar muita gente de uma vez. De 1 a 50."><input type="number" min={1} max={50} value={wa.add_batch_size} onChange={(e) => setF({ ...f, whatsapp: { ...wa, add_batch_size: +e.target.value } })} /></Field>
            <Field label="Espera entre lotes (s)" hint="De 2 a 60. Protege o número."><input type="number" min={2} max={60} value={wa.add_delay_s} onChange={(e) => setF({ ...f, whatsapp: { ...wa, add_delay_s: +e.target.value } })} /></Field>
          </div></> : <>
          <div className="small muted">O Telegram não deixa o bot criar grupos: crie no aplicativo, adicione o bot como administrador e use “Buscar grupos”. Estes padrões valem para a gestão dos grupos existentes.</div>
          <div className="row"><Toggle label="Restringir envio de membros" checked={tg.restrict_members_send} onChange={(v) => setF({ ...f, telegram: { ...tg, restrict_members_send: v } })} /><span><b>Sugerir “membros não enviam” em grupos novos</b><div className="small muted">Sugestão exibida ao gerenciar; não muda nada sozinha.</div></span></div>
          <div className="row"><Toggle label="Aviso de afiliado na descrição" checked={tg.add_disclosure} onChange={(v) => setF({ ...f, telegram: { ...tg, add_disclosure: v } })} /><span><b>Sugerir o aviso de afiliado na descrição</b></span></div></>}
        <div><Button variant="primary" icon={<Save size={14} />} disabled={!dirty} busy={busy === 'grp-' + channel} onClick={save}>Salvar padrões</Button></div>
      </div></fieldset>
      <div className="capgrid" style={{ marginTop: 14 }}>
        {can.map(([t, ok]) => <div key={t} className={ok ? 'cap yes' : 'cap no'}>{ok ? <Check size={14} /> : <Minus size={14} />}<span>{t}</span></div>)}
      </div>
    </Card>);
}
