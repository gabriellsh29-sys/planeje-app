import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const PRICE_MENSAL = import.meta.env.VITE_STRIPE_PRICE_MENSAL;
const PRICE_ANUAL = import.meta.env.VITE_STRIPE_PRECOS_ANUAL;

export default function PaywallPage() {
  const { logout, user, session } = useAuth();
  const [loading, setLoading] = useState(null);

  const assinar = async (priceId, plano) => {
    setLoading(plano);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ priceId, userId: user.id }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Erro ao iniciar pagamento');
    } catch (err) {
      alert('Erro ao iniciar pagamento: ' + err.message);
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0f172a' }}>
      <div className="max-w-sm w-full text-center flex flex-col items-center gap-4">
        <img src="/logo.png" alt="Planeje" className="w-14 h-14 object-contain" />
        <h1 className="text-xl font-bold text-white">Seu período gratuito acabou</h1>
        <p className="text-text-2 text-sm">
          Esperamos que o Planeje tenha te ajudado a organizar suas finanças!
          Para continuar usando, escolha um plano:
        </p>

        <button onClick={() => assinar(PRICE_MENSAL, 'mensal')} disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-[#07090f] transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}>
          {loading === 'mensal' ? 'Redirecionando...' : 'Assinar Mensal — R$ 9,90/mês'}
        </button>

        <button onClick={() => assinar(PRICE_ANUAL, 'anual')} disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-white border transition-all disabled:opacity-60"
          style={{ borderColor: 'rgba(34,197,94,0.4)' }}>
          {loading === 'anual' ? 'Redirecionando...' : 'Assinar Anual — R$ 89,90/ano'}
        </button>

        <a
          href="https://wa.me/5562999855052?text=Quero%20assinar%20o%20Planeje"
          target="_blank" rel="noreferrer"
          className="text-text-3 text-xs underline">
          Dúvidas? Fale com o suporte
        </a>
        <button onClick={logout} className="text-text-3 text-sm underline">
          Sair da conta
        </button>
      </div>
    </div>
  );
}
