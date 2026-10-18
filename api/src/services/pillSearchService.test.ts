import { describe, expect, it } from 'vitest';
import { PILLS } from '../content/pills';
import { searchPills, tokenize } from './pillSearchService';

const topSlug = (question: string) => searchPills(question)[0]?.slug;

describe('pillSearchService', () => {
  it('ignora acentos, maiúsculas e palavras vazias', () => {
    expect(tokenize('Posso PROIBIR o cachorro?')).toEqual(['proib', 'cacho']);
  });

  it('encontra a pílula certa a partir de perguntas em linguagem natural', () => {
    expect(topSlug('O condomínio pode proibir cachorro no apartamento?')).toBe('animais-no-condominio');
    expect(topSlug('qual a multa maxima por atraso do boleto')).toBe('multa-e-juros-por-atraso');
    expect(topSlug('como cobrar morador inadimplente')).toBe('cobranca-de-inadimplentes');
    expect(topSlug('quem está devendo pode votar na assembleia?')).toBe('inadimplente-pode-votar');
    expect(topSlug('vizinho faz muito barulho de madrugada')).toBe('barulho-e-condomino-antissocial');
    expect(topSlug('posso alugar meu apê no airbnb?')).toBe('airbnb-e-locacao-por-temporada');
    expect(topSlug('assembleia online é válida?')).toBe('convocacao-e-quorum-de-assembleia');
    expect(topSlug('seguro contra incêndio é obrigatório?')).toBe('seguro-obrigatorio-do-condominio');
    expect(topSlug('câmeras na portaria e LGPD')).toBe('lgpd-no-condominio');
    expect(topSlug('como calcular o valor do condomínio?')).toBe('como-calcular-a-taxa-condominial');
    expect(topSlug('qual o custo da obra e como dividir entre os moradores')).toBe('custo-de-obras-e-rateio-extra');
    expect(topSlug('quem aprova melhorias como academia nova?')).toBe('melhorias-e-benfeitorias');
    expect(topSlug('o inquilino ou o proprietário paga a pintura da fachada?')).toBe('inquilino-ou-proprietario-quem-paga');
    expect(topSlug('quem paga o fundo de reserva?')).toBe('fundo-de-reserva');
    expect(topSlug('inquilino pode votar na assembleia?')).toBe('inquilino-pode-votar');
  });

  it('não devolve nada para assunto fora da base', () => {
    expect(searchPills('receita de bolo de chocolate')).toEqual([]);
    expect(searchPills('   ')).toEqual([]);
  });

  it('toda pílula tem fonte, data de revisão e slug único', () => {
    expect(new Set(PILLS.map((pill) => pill.slug)).size).toBe(PILLS.length);
    for (const pill of PILLS) {
      expect(pill.sources.length).toBeGreaterThan(0);
      expect(pill.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
