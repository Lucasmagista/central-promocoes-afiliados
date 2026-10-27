import { describe, expect, it } from 'vitest';
import { categorySlug } from './categories';

describe('categorySlug (espelha public.category_slug)', () => {
  it('mapeia rótulos exatos', () => {
    expect(categorySlug('Eletrônicos')).toBe('eletronicos');
    expect(categorySlug('Informática')).toBe('informatica');
    expect(categorySlug('Casa')).toBe('casa');
    expect(categorySlug('Carro e moto')).toBe('automotivo');
  });
  it('usa palavras-chave inteiras (com plural simples)', () => {
    expect(categorySlug('pneu aro 15')).toBe('automotivo');
    expect(categorySlug('Fones Bluetooth')).toBe('eletronicos');
    expect(categorySlug('ativo fixo')).toBe('outros');
  });
  it('vazio é null e desconhecido é outros', () => {
    expect(categorySlug('  ')).toBeNull();
    expect(categorySlug(null)).toBeNull();
    expect(categorySlug('xyz qualquer')).toBe('outros');
  });
});
