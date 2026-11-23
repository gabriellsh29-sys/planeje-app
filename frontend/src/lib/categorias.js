// Ordenação e busca de categorias ("motivos" de despesa, dívida e receita).

// Marcas de acento soltas (U+0300 a U+036F) que sobram depois do normalize('NFD').
const MARCAS_DE_ACENTO = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

// Minúsculas e sem acento, para "acai" achar "Açaí" e "cartao" achar "Cartão de Crédito".
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(MARCAS_DE_ACENTO, '')
    .toLowerCase()
    .trim();
}

// A–Z sem distinguir maiúscula/minúscula nem acento (Água fica junto do A, não depois do Z).
// Remove repetidos e vazios.
export function ordenarAZ(lista) {
  const unicos = [...new Set((lista || []).filter(x => String(x ?? '').trim() !== ''))];
  return unicos.sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }));
}

// Filtra pelo que foi digitado. Quem COMEÇA com o texto vem primeiro, depois quem tem uma
// palavra começando com ele, depois quem só contém. Dentro de cada grupo mantém a ordem
// recebida (A–Z). Devolve também onde está o trecho achado, para destacar na tela.
export function filtrarOpcoes(opcoes, consulta) {
  const q = normalizar(consulta);
  if (!q) return opcoes.map(valor => ({ valor, de: -1, ate: -1 }));

  const achados = [];
  for (const valor of opcoes) {
    const alvo = normalizar(valor);
    const pos = alvo.indexOf(q);
    if (pos === -1) continue;
    const inicioDePalavra = pos === 0 || /[\s/\-(]/.test(alvo[pos - 1]);
    achados.push({ valor, de: pos, ate: pos + q.length, grupo: pos === 0 ? 0 : inicioDePalavra ? 1 : 2 });
  }
  // sort estável: a ordem A–Z original é preservada dentro de cada grupo
  return achados.sort((a, b) => a.grupo - b.grupo).map(({ valor, de, ate }) => ({ valor, de, ate }));
}
