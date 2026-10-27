import { dayLabel, int } from '../lib/format';

const W = 640, H = 220, P = { l: 40, r: 12, t: 12, b: 26 };
function nice(max: number) { if (max <= 5) return 5; const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; }

export function LineChart({ days, series, height = H }: { days: string[]; series: { name: string; color: string; values: number[] }[]; height?: number }) {
  const max = nice(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, days.length - 1);
  const y = (v: number) => P.t + (1 - v / max) * (height - P.t - P.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = Math.ceil(days.length / 7);
  const dots = days.length <= 31;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Gráfico de linhas: ${series.map((s) => s.name).join(', ')}`}>
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={P.l - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{int(Math.round(t))}</text></g>)}
      {days.map((d, i) => i % step === 0 && <text key={d} x={x(i)} y={height - 7} fontSize="11" textAnchor="middle" fill="var(--muted)">{dayLabel(d)}</text>)}
      {series.map((s) => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
        return <g key={s.name}>
          <polygon points={`${x(0)},${y(0)} ${pts.join(' ')} ${x(s.values.length - 1)},${y(0)}`} fill={s.color} opacity=".12" />
          <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          {s.values.map((v, i) => <g key={i}>{dots && <circle cx={x(i)} cy={y(v)} r="3" fill="var(--surface)" stroke={s.color} strokeWidth="2" />}<circle cx={x(i)} cy={y(v)} r="8" fill="transparent"><title>{`${s.name} · ${dayLabel(days[i])}: ${int(v)}`}</title></circle></g>)}
        </g>;
      })}
    </svg>
  );
}

export function PriceChart({ points }: { points: { t: number; v: number }[] }) {
  if (points.length < 2) return <div className="muted small">Histórico insuficiente para o gráfico (menos de 2 observações).</div>;
  const pts = points.slice().sort((a, b) => a.t - b.t);
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const pad = (hi - lo || hi * 0.05) * 0.25, minV = lo - pad, maxV = hi + pad;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const L = 62, R = 22;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => P.t + 8 + (1 - (v - minV) / (maxV - minV)) * (H - P.t - P.b - 8);
  const brl = (v: number, d = 0) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: d, minimumFractionDigits: d });
  const dayShort = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const levels = [...new Set([lo, (lo + hi) / 2, hi].map((v) => Math.round(v * 100) / 100))];
  const last = pts[pts.length - 1], minP = pts.reduce((a, b) => (b.v < a.v ? b : a));
  const xt = [t0, t0 + (t1 - t0) / 2, t1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Histórico de preço: de ${brl(pts[0].v)} a ${brl(last.v)}`}>
      {levels.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" /><text x={L - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{brl(v)}</text></g>)}
      {xt.map((t, i) => <text key={i} x={x(t)} y={H - 7} fontSize="11" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fill="var(--muted)">{dayShort(t)}</text>)}
      <polygon points={`${x(pts[0].t)},${H - P.b} ${pts.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} ${x(last.t)},${H - P.b}`} fill="var(--accent)" opacity=".10" />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} />
      {pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.v)} r={i === pts.length - 1 ? 5 : 3.5} fill={i === pts.length - 1 ? 'var(--tag)' : 'var(--surface)'} stroke={i === pts.length - 1 ? 'var(--ink)' : 'var(--accent)'} strokeWidth="2"><title>{`${new Date(p.t).toLocaleString('pt-BR')}: ${brl(p.v, 2)}`}</title></circle>)}
      <text x={Math.min(x(last.t), W - R)} y={y(last.v) - 11} fontSize="12" fontWeight="700" textAnchor="end" fill="var(--text)">{brl(last.v, 2)}</text>
      {minP !== last && minP.v < last.v && <text x={x(minP.t)} y={y(minP.v) + 20} fontSize="11" fontWeight="600" textAnchor="middle" fill="var(--ok)">menor: {brl(minP.v, 2)}</text>}
    </svg>
  );
}

export function HBars({ rows, color = 'var(--accent)' }: { rows: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="muted small">Sem dados no período.</div>;
  return <div className="col" style={{ gap: 10 }}>{rows.map((r) => (
    <div key={r.label}><div className="row small"><span className="truncate">{r.label}</span><b className="right">{int(r.value)}</b></div>
      <div className="bar" role="presentation"><i style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div></div>))}</div>;
}

export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, steps[0]?.value ?? 1);
  return <div className="col" style={{ gap: 8 }}>{steps.map((s, i) => (
    <div key={s.label}><div className="row small"><span>{s.label}</span><b className="right">{int(s.value)}{i > 0 && steps[i - 1].value > 0 && <span className="muted"> · {Math.round((s.value / steps[i - 1].value) * 100)}%</span>}</b></div>
      <div className="bar"><i style={{ width: `${(s.value / max) * 100}%`, opacity: 1 - i * 0.18 }} /></div></div>))}</div>;
}

export function Spark({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values), w = 90, h = 26;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ');
  return <svg width={w} height={h} aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" /></svg>;
}
