import { BookOpen, Baby, Car, Dumbbell, Gamepad2, Heart, Home, Laptop, PawPrint, Puzzle, Shirt, ShoppingCart, Smartphone, Sparkles, Tag, UtensilsCrossed, Wrench } from 'lucide-react';
import type { ProductCategory } from '../lib/types';

const ICONS: Record<string, typeof Tag> = {
  smartphone: Smartphone, laptop: Laptop, gamepad: Gamepad2, home: Home, utensils: UtensilsCrossed, car: Car, shirt: Shirt, sparkles: Sparkles,
  heart: Heart, dumbbell: Dumbbell, baby: Baby, puzzle: Puzzle, wrench: Wrench, paw: PawPrint, cart: ShoppingCart, book: BookOpen, tag: Tag,
};
export function CatIcon({ name, size = 16 }: { name: string; size?: number }) { const I = ICONS[name] ?? Tag; return <I size={size} />; }

const PRESETS: { label: string; slugs: string[] }[] = [
  { label: 'Só carro e moto', slugs: ['automotivo'] },
  { label: 'Tecnologia', slugs: ['eletronicos', 'informatica', 'games'] },
  { label: 'Casa e cozinha', slugs: ['casa', 'cozinha'] },
  { label: 'Moda e beleza', slugs: ['moda', 'beleza'] },
  { label: 'Família', slugs: ['bebes', 'brinquedos'] },
];

/** Escolha dos tipos de produto que um destino aceita. Vazio = aceita todos. */
export function CategoryPicker({ cats, value, onChange, counts }: { cats: ProductCategory[]; value: string[]; onChange: (v: string[]) => void; counts?: Record<string, number> }) {
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <button type="button" className="chip" aria-pressed={value.length === 0} onClick={() => onChange([])}>Todos os tipos</button>
        <span className="small muted" style={{ margin: '0 4px' }}>ou atalhos:</span>
        {PRESETS.map((p) => <button key={p.label} type="button" className="chip" aria-pressed={p.slugs.length === value.length && p.slugs.every((s) => value.includes(s))} onClick={() => onChange(p.slugs)}>{p.label}</button>)}
      </div>
      <div className="catgrid" role="group" aria-label="Tipos de produto">
        {cats.map((c) => (
          <button type="button" key={c.slug} className="catcard" aria-pressed={value.includes(c.slug)} onClick={() => toggle(c.slug)}>
            <span className="ci"><CatIcon name={c.icon} size={18} /></span><span className="cl">{c.label}</span>
            {counts && counts[c.slug] ? <span className="cn" title="Ofertas na fila de aprovação deste tipo">{counts[c.slug]}</span> : null}
          </button>))}
      </div>
      <div className="small muted">{value.length === 0 ? 'Este destino recebe ofertas de qualquer tipo.' : `Este destino só recebe ofertas de: ${value.map((s) => cats.find((c) => c.slug === s)?.label ?? s).join(', ')}. As demais são bloqueadas na aprovação.`}</div>
    </div>);
}

export function CategoryChips({ cats, value, max = 4 }: { cats: ProductCategory[]; value: string[]; max?: number }) {
  if (!value.length) return <span className="badge"><Tag size={12} />todos os tipos</span>;
  const shown = value.slice(0, max);
  return <>{shown.map((s) => { const c = cats.find((x) => x.slug === s); return <span key={s} className="badge accent"><CatIcon name={c?.icon ?? 'tag'} size={12} />{c?.label ?? s}</span>; })}{value.length > max && <span className="badge">+{value.length - max}</span>}</>;
}
