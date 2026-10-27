import { Modal, Kbd } from '../ui/ui';

const ROWS: [string[], string][] = [
  [['Ctrl', 'K'], 'Abrir a paleta de comandos (buscar e ir para qualquer tela)'],
  [['?'], 'Mostrar esta lista'],
  [['g', 'v'], 'Ir para Visão geral'], [['g', 'r'], 'Ir para a Fila de aprovação'], [['g', 'o'], 'Ir para Ofertas'], [['g', 'p'], 'Ir para Publicações'],
  [['g', 'w'], 'Ir para WhatsApp'], [['g', 't'], 'Ir para Telegram'],
  [['J'], 'Fila de aprovação: próxima oferta'], [['K'], 'Fila de aprovação: oferta anterior'],
  [['A'], 'Fila de aprovação: aprovar a oferta aberta'], [['R'], 'Fila de aprovação: rejeitar a oferta aberta'],
  [['Esc'], 'Fechar janela ou painel lateral'],
];
export function Shortcuts({ onClose }: { onClose: () => void }) {
  return <Modal title="Atalhos de teclado" onClose={onClose}><div className="col" style={{ gap: 8 }}>
    {ROWS.map(([k, d]) => <div key={d} className="row"><span style={{ minWidth: 100 }}>{k.map((x, i) => <span key={x}>{i > 0 && <span className="muted small"> depois </span>}<Kbd>{x}</Kbd></span>)}</span><span>{d}</span></div>)}
    <div className="small muted">Atalhos de uma tecla não funcionam enquanto você digita em um campo.</div></div></Modal>;
}
