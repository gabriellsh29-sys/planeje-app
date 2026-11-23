/**
 * Planeje — Ordenação e busca de categorias (motivos de despesa, dívida e receita)
 * Regra do produto: categorias SEMPRE em ordem A–Z, sem distinguir acento nem maiúscula,
 * e a busca ao digitar também ignora acento.
 */
import { describe, it, expect } from 'vitest';
import { normalizar, ordenarAZ, filtrarOpcoes } from '../lib/categorias';

describe('normalizar', () => {
  it('tira acento, cedilha e maiúsculas', () => {
    expect(normalizar('Açaí & Água')).toBe('acai & agua');
    expect(normalizar('  Cartão de Crédito ')).toBe('cartao de credito');
  });
  it('aceita vazio, null e undefined', () => {
    expect(normalizar('')).toBe('');
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});

describe('ordenarAZ', () => {
  it('ordena de A a Z sem distinguir acento: "Água" fica entre os A, não depois do Z', () => {
    expect(ordenarAZ(['Transporte', 'Água e luz', 'Alimentação', 'Saúde', 'Aluguel']))
      .toEqual(['Água e luz', 'Alimentação', 'Aluguel', 'Saúde', 'Transporte']);
  });
  it('não distingue maiúscula de minúscula', () => {
    expect(ordenarAZ(['bônus', 'Aluguel', 'CASA', 'dízimo'])).toEqual(['Aluguel', 'bônus', 'CASA', 'dízimo']);
  });
  it('"Outros" também entra na ordem alfabética (sem posição fixa)', () => {
    expect(ordenarAZ(['Outros', 'Saúde', 'Lazer', 'Vestuário'])).toEqual(['Lazer', 'Outros', 'Saúde', 'Vestuário']);
  });
  it('remove repetidos e vazios, e não altera a lista original', () => {
    const original = ['b', 'a', 'a', '', '  ', 'c'];
    expect(ordenarAZ(original)).toEqual(['a', 'b', 'c']);
    expect(original).toEqual(['b', 'a', 'a', '', '  ', 'c']);
  });
  it('lista ausente vira lista vazia', () => {
    expect(ordenarAZ(undefined)).toEqual([]);
    expect(ordenarAZ(null)).toEqual([]);
  });
});

describe('filtrarOpcoes', () => {
  const todas = ordenarAZ(['Alimentação', 'Cartão de Crédito', 'Conta/Serviço', 'Educação', 'Saúde', 'Outros', 'Transporte']);

  it('sem texto devolve tudo, na mesma ordem, sem trecho marcado', () => {
    const r = filtrarOpcoes(todas, '');
    expect(r.map(x => x.valor)).toEqual(todas);
    expect(r.every(x => x.de === -1)).toBe(true);
  });
  it('acha sem acento e sem maiúscula', () => {
    expect(filtrarOpcoes(todas, 'SAUDE').map(x => x.valor)).toEqual(['Saúde']);
    expect(filtrarOpcoes(todas, 'cartao').map(x => x.valor)).toEqual(['Cartão de Crédito']);
  });
  it('quem COMEÇA com o texto vem antes de quem só contém', () => {
    // "tr": Transporte começa com "tr"; Outros só contém ("ou-tr-os")
    expect(filtrarOpcoes(todas, 'tr').map(x => x.valor)).toEqual(['Transporte', 'Outros']);
  });
  it('palavra que começa no meio do nome (depois de espaço ou barra) vale mais que o meio da palavra', () => {
    // "en": Entrada começa com "en"; "Conta de ENergia" tem palavra começando com "en"; "PENsão" só contém.
    // A ordem de entrada (Pensão, Conta, Entrada) não pode mandar: o que manda é o grupo.
    const r = filtrarOpcoes(['Pensão', 'Conta de Energia', 'Entrada'], 'en').map(x => x.valor);
    expect(r).toEqual(['Entrada', 'Conta de Energia', 'Pensão']);
  });
  it('devolve onde está o trecho achado, para destacar na tela', () => {
    const [achado] = filtrarOpcoes(['Alimentação'], 'lim');
    expect(achado).toEqual({ valor: 'Alimentação', de: 1, ate: 4 });
  });
  it('nada encontrado devolve lista vazia', () => {
    expect(filtrarOpcoes(todas, 'zzzz')).toEqual([]);
  });
  it('espaços em volta do que foi digitado não atrapalham', () => {
    expect(filtrarOpcoes(todas, '  saude ').map(x => x.valor)).toEqual(['Saúde']);
  });
});
