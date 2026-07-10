import React from 'react';
import { useAuth } from '../context/AuthContext';

function TrialBanner({ onClickPlanos }) {
  const { perfil } = useAuth();

  if (!perfil) return null;
  if (perfil.plano === 'pago' && perfil.assinatura_status === 'ativa') return null;
  if (perfil.plano === 'liberado') return null;
  if (!perfil.trial_expira_em) return null;

  const diffMs = new Date(perfil.trial_expira_em) - new Date();
  const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (dias < 0) return null;

  return (
    <div onClick={onClickPlanos}
      className="flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-center cursor-pointer"
      style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', borderBottom: '1px solid rgba(34,197,94,0.2)' }}>
      {dias > 0
        ? `Você tem ${dias} dia${dias === 1 ? '' : 's'} de teste grátis restante${dias === 1 ? '' : 's'}.`
        : 'Seu teste grátis termina hoje.'}
      {' '}Toque para ver os planos →
    </div>
  );
}

export default React.memo(TrialBanner);
