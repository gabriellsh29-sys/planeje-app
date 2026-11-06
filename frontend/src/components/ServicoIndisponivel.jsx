import React, { useState } from 'react';

export default function ServicoIndisponivel({ onRetry }) {
  const [tentando, setTentando] = useState(false);

  const tentarDeNovo = async () => {
    setTentando(true);
    try { await onRetry(); } finally { setTentando(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0f172a' }}>
      <div className="max-w-sm w-full text-center flex flex-col items-center gap-4">
        <img src="/img/logo/logo-app-icon.png" alt="Planeje" className="w-20 h-20 object-contain rounded-3xl" />
        <h1 className="text-xl font-bold text-white">Planeje temporariamente indisponível</h1>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Estamos com uma instabilidade no nosso serviço de dados e o acesso está pausado por
          enquanto. Previsão de normalização: a partir de 10/11.
        </p>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Quando o serviço voltar, esta tela some sozinha. Você também pode tentar novamente abaixo.
        </p>
        <button
          onClick={tentarDeNovo}
          disabled={tentando}
          className="w-full py-3 rounded-xl font-semibold transition-all active:scale-95 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#07090f' }}>
          {tentando ? 'Verificando...' : 'Tentar novamente'}
        </button>
        <a
          href="https://wa.me/5562999855052?text=Planeje%20indispon%C3%ADvel"
          target="_blank" rel="noreferrer"
          className="text-xs underline"
          style={{ color: 'rgba(255,255,255,0.4)' }}>
          Dúvidas? Fale com o suporte
        </a>
      </div>
    </div>
  );
}
