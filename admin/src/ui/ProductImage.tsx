import { useState } from 'react';
import { Package } from 'lucide-react';

/** Miniatura do produto: carrega sob demanda, não envia referrer e cai num ícone se a imagem falhar. Aceita https e imagens embutidas (demonstração). */
export function ProductImage({ src, size = 44, radius = 8, alt = '' }: { src?: string | null; size?: number; radius?: number; alt?: string }) {
  const [bad, setBad] = useState(false);
  const ok = !!src && /^(https:\/\/|data:image\/)/i.test(src) && !bad;
  return (
    <span className="pimg" style={{ width: size, height: size, borderRadius: radius }}>
      {ok ? <img src={src!} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : <Package size={Math.max(14, Math.round(size * 0.42))} aria-hidden />}
    </span>);
}
