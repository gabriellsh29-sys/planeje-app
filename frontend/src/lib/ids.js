// Gera IDs únicos resistentes a colisão.
// Substitui Date.now() — que colide quando dois itens são criados no mesmo
// milissegundo (ex.: clique duplo no salvar, criação de parcelas em loop).
export function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback para ambientes sem crypto.randomUUID (contexto não-seguro / navegador antigo)
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}
