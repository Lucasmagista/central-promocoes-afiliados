import type { ProductCategory } from './types';

/** Espelho da tabela product_categories (migração 007). O banco é a fonte de verdade; isto serve à demonstração e a testes. */
export const DEFAULT_CATEGORIES: ProductCategory[] = [
  { slug: 'eletronicos', label: 'Eletrônicos', icon: 'smartphone', sort: 10, keywords: ['eletronico', 'audio', 'fone', 'smartphone', 'celular', 'tv', 'camera', 'smartwatch', 'wearable', 'caixa de som'] },
  { slug: 'informatica', label: 'Informática', icon: 'laptop', sort: 20, keywords: ['informatica', 'computador', 'notebook', 'periferico', 'teclado', 'mouse', 'monitor', 'impressora', 'ssd', 'roteador'] },
  { slug: 'games', label: 'Games', icon: 'gamepad', sort: 30, keywords: ['game', 'games', 'console', 'videogame', 'playstation', 'xbox', 'nintendo'] },
  { slug: 'casa', label: 'Casa e decoração', icon: 'home', sort: 40, keywords: ['casa', 'decoracao', 'movel', 'moveis', 'iluminacao', 'jardim', 'limpeza', 'utilidades domesticas', 'cama mesa banho'] },
  { slug: 'cozinha', label: 'Cozinha e eletrodomésticos', icon: 'utensils', sort: 50, keywords: ['cozinha', 'eletrodomestico', 'panela', 'airfryer', 'air fryer', 'cafeteira', 'liquidificador', 'geladeira'] },
  { slug: 'automotivo', label: 'Carro e moto', icon: 'car', sort: 60, keywords: ['automotivo', 'carro', 'moto', 'veiculo', 'pneu', 'som automotivo', 'acessorio automotivo', 'capacete'] },
  { slug: 'moda', label: 'Moda e acessórios', icon: 'shirt', sort: 70, keywords: ['moda', 'roupa', 'calcado', 'tenis', 'bolsa', 'relogio', 'acessorio', 'mochila'] },
  { slug: 'beleza', label: 'Beleza e perfumaria', icon: 'sparkles', sort: 80, keywords: ['beleza', 'perfume', 'maquiagem', 'cabelo', 'skincare', 'barbear'] },
  { slug: 'saude', label: 'Saúde e bem-estar', icon: 'heart', sort: 90, keywords: ['saude', 'vitamina', 'suplemento', 'bem estar', 'massageador'] },
  { slug: 'esporte', label: 'Esporte e lazer', icon: 'dumbbell', sort: 100, keywords: ['esporte', 'fitness', 'academia', 'ciclismo', 'bicicleta', 'camping', 'lazer', 'pesca'] },
  { slug: 'bebes', label: 'Bebês e crianças', icon: 'baby', sort: 110, keywords: ['bebe', 'bebes', 'infantil', 'crianca', 'maternidade'] },
  { slug: 'brinquedos', label: 'Brinquedos', icon: 'puzzle', sort: 120, keywords: ['brinquedo', 'boneca', 'lego', 'jogo de tabuleiro'] },
  { slug: 'ferramentas', label: 'Ferramentas e construção', icon: 'wrench', sort: 130, keywords: ['ferramenta', 'construcao', 'eletrica', 'obra', 'furadeira', 'parafusadeira'] },
  { slug: 'pet', label: 'Pet', icon: 'paw', sort: 140, keywords: ['pet', 'animal', 'cachorro', 'gato', 'racao'] },
  { slug: 'mercado', label: 'Mercado e bebidas', icon: 'cart', sort: 150, keywords: ['supermercado', 'mercado', 'alimento', 'bebida', 'cafe'] },
  { slug: 'livros', label: 'Livros e papelaria', icon: 'book', sort: 160, keywords: ['livro', 'papelaria', 'escritorio', 'caderno'] },
  { slug: 'outros', label: 'Outros', icon: 'tag', sort: 999, keywords: [] },
];

export const norm = (t: string | null | undefined) =>
  (t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Mesma regra de public.category_slug(): vazio → null; sem correspondência → 'outros'. */
export function categorySlug(text: string | null | undefined, cats: ProductCategory[] = DEFAULT_CATEGORIES): string | null {
  const n = norm(text);
  if (!n) return null;
  for (const c of cats.slice().sort((a, b) => a.sort - b.sort)) {
    if (c.slug === 'outros') continue;
    if (n === norm(c.label) || n === c.slug.replace(/-/g, ' ')) return c.slug;
    if (c.keywords.some((k) => new RegExp(`(^| )${norm(k)}s?( |$)`).test(n))) return c.slug;
  }
  return 'outros';
}

export const categoryLabel = (slug: string, cats: ProductCategory[] = DEFAULT_CATEGORIES) => cats.find((c) => c.slug === slug)?.label ?? slug;
