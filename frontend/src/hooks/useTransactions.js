import { useState } from 'react';

const DIVIDA_KEY   = 'financeiro_dividas';
const RECEITA_KEY  = 'financeiro_receitas';

export function useTransactions() {
  const [loading] = useState(false);

  const addTransaction = (data) => {
    try {
      const dataLanc = data.date || new Date().toISOString().slice(0, 10);
      const valor = parseFloat(data.amount) || 0;

      if (data.type === 'income') {
        const all = JSON.parse(localStorage.getItem(RECEITA_KEY) || '[]');
        all.push({
          id: Date.now().toString(),
          nome: data.description || '',
          valor,
          categoria: data.category || 'Outros',
          data: dataLanc,
          recorrencia: 'nao',
          periodicidade: 'Mensal',
          observacao: '',
          recebida: true,
          recebimentoData: dataLanc,
          valorRecebido: valor,
        });
        localStorage.setItem(RECEITA_KEY, JSON.stringify(all));
        return;
      }

      const all = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
      all.push({
        id: Date.now().toString(),
        nome: data.description || '',
        valor,
        vencimento: dataLanc,
        categoria: data.category || 'Outros',
        recorrencia: 'nao',
        pago: true,
        pagamentoData: dataLanc,
        valorPago: valor,
      });
      localStorage.setItem(DIVIDA_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  };

  const removeTransaction = () => {};

  return { transactions: [], summary: {}, loading, addTransaction, removeTransaction, refresh: () => {} };
}
