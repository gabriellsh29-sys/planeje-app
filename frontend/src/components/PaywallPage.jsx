import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function PaywallPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0f172a' }}>
      <div className="max-w-sm w-full text-center flex flex-col items-center gap-4">
        <img src="/logo.png" alt="Planeje" className="w-14 h-14 object-contain" />
        <h1 className="text-xl font-bold text-white">Seu período gratuito acabou</h1>
        <p className="text-text-2 text-sm">
          Esperamos que o Planeje tenha te ajudado a organizar suas finanças!
          Para continuar usando, assine um dos nossos planos.
        </p>
        <a
          href="https://wa.me/5562999855052?text=Quero%20assinar%20o%20Planeje"
          target="_blank" rel="noreferrer"
          className="w-full py-3 rounded-xl font-semibold text-[#07090f] transition-all"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' }}>
          Assinar agora
        </a>
        <button onClick={logout} className="text-text-3 text-sm underline">
          Sair da conta
        </button>
      </div>
    </div>
  );
}
