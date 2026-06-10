import React, { useState } from 'react';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function TransactionList({ transactions, onDelete, loading }) {
  const [confirmId, setConfirmId] = useState(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-surface border border-card rounded-2xl h-16 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!transactions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted">
        <span className="text-4xl mb-3">📭</span>
        <p className="text-sm">Nenhuma transação neste mês</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-24 flex flex-col gap-2">
      {transactions.map((tx) => (
        <div
          key={tx.id}
          className="bg-surface border border-card rounded-2xl px-4 py-3 flex items-center gap-3"
        >
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tx.type === 'income' ? 'bg-income' : 'bg-expense'}`} />

          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{tx.description}</p>
            <p className="text-muted text-xs mt-0.5">{fmtDate(tx.date)}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-income' : 'text-expense'}`}>
              {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
            </span>

            {confirmId === tx.id ? (
              <div className="flex gap-2">
                <button
                  onClick={() => { onDelete(tx.id); setConfirmId(null); }}
                  className="text-expense text-xs font-bold px-2 py-1 bg-card rounded-lg"
                >
                  Excluir
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-muted text-xs px-2 py-1 bg-card rounded-lg"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(tx.id)}
                className="text-muted text-lg leading-none px-1 active:scale-90 transition-transform"
              >
                ···
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
