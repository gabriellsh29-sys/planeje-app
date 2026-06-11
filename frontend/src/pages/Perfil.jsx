import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';

const PRICE_MENSAL = import.meta.env.VITE_STRIPE_PRICE_MENSAL;
const PRICE_ANUAL = import.meta.env.VITE_STRIPE_PRICE_ANUAL;

const TABS = [
  { id: 'dados', label: 'Dados' },
  { id: 'planos', label: 'Planos' },
  { id: 'senha', label: 'Senha' },
];

export default function Perfil() {
  const [tab, setTab] = useState('dados');

  return (
    <div className="max-w-xl mx-auto p-4 md:p-6 animate-fade-in">
      <h1 className="text-text-1 font-bold text-lg mb-4">Perfil</h1>

      <div className="flex gap-1 mb-5 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
            style={tab === t.id
              ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }
              : { color: 'rgba(255,255,255,0.5)', border: '1px solid transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dados' && <DadosTab />}
      {tab === 'planos' && <PlanosTab />}
      {tab === 'senha' && <SenhaTab />}
    </div>
  );
}

function DadosTab() {
  const { user, perfil, refreshPerfil } = useAuth();
  const [nome, setNome] = useState(perfil?.nome || user?.user_metadata?.full_name || '');
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [msg, setMsg] = useState('');

  const avatarUrl = perfil?.avatar_url;

  const salvarNome = async () => {
    setSalvando(true); setMsg('');
    const { error } = await supabase.from('perfis').update({ nome }).eq('id', user.id);
    if (!error) {
      await refreshPerfil();
      setMsg('Dados salvos com sucesso!');
    } else {
      setMsg('Erro ao salvar: ' + error.message);
    }
    setSalvando(false);
  };

  const onFotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEnviandoFoto(true); setMsg('');
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabase.from('perfis').update({ avatar_url: url }).eq('id', user.id);
      if (dbErr) throw dbErr;
      await refreshPerfil();
    } catch (err) {
      setMsg('Erro ao enviar foto: ' + err.message);
    }
    setEnviandoFoto(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-24 h-24 rounded-full overflow-hidden flex items-center justify-center"
          style={{ background: 'rgba(34,197,94,0.12)', border: '2px solid rgba(34,197,94,0.3)' }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="Foto de perfil" className="w-full h-full object-cover" />
          ) : (
            <span className="text-accent text-3xl font-bold">{(nome || user?.email || '?').charAt(0).toUpperCase()}</span>
          )}
        </div>
        <label className="text-accent text-xs font-semibold cursor-pointer hover:underline">
          {enviandoFoto ? 'Enviando...' : 'Alterar foto'}
          <input type="file" accept="image/*" className="hidden" onChange={onFotoChange} disabled={enviandoFoto} />
        </label>
      </div>

      <div>
        <label className="text-text-3 text-xs font-semibold uppercase tracking-wider mb-1 block">Nome</label>
        <input value={nome} onChange={e => setNome(e.target.value)} className="input-premium w-full text-sm" />
      </div>

      <div>
        <label className="text-text-3 text-xs font-semibold uppercase tracking-wider mb-1 block">E-mail</label>
        <input value={user?.email || ''} disabled className="input-premium w-full text-sm opacity-60" />
      </div>

      <button onClick={salvarNome} disabled={salvando}
        className="btn-gold w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
        {salvando ? 'Salvando...' : 'Salvar alterações'}
      </button>

      {msg && <p className="text-text-2 text-xs text-center">{msg}</p>}
    </div>
  );
}

function PlanosTab() {
  const { perfil, user } = useAuth();
  const [loading, setLoading] = useState(null);

  const assinar = async (priceId, plano) => {
    setLoading(plano);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, userId: user.id, email: user.email }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Erro ao iniciar pagamento');
    } catch (err) {
      alert('Erro ao iniciar pagamento: ' + err.message);
      setLoading(null);
    }
  };

  const ativo = perfil?.plano === 'pago' && perfil?.assinatura_status === 'ativa';
  const liberado = perfil?.plano === 'liberado';

  let statusTexto = '';
  if (liberado) statusTexto = 'Acesso liberado pela equipe Planeje.';
  else if (ativo) statusTexto = 'Sua assinatura está ativa. Obrigado por apoiar o Planeje!';
  else if (perfil?.trial_expira_em) {
    const dias = Math.ceil((new Date(perfil.trial_expira_em) - new Date()) / (1000 * 60 * 60 * 24));
    statusTexto = dias > 0
      ? `Você está no período de teste grátis (${dias} dia${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}).`
      : 'Seu período de teste grátis terminou.';
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-center text-sm text-text-2"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {statusTexto}
      </div>

      {!ativo && !liberado && (
        <>
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
        </>
      )}

      <a href="https://wa.me/5562999855052?text=Quero%20saber%20mais%20sobre%20o%20Planeje"
        target="_blank" rel="noreferrer"
        className="block text-center text-text-3 text-xs underline">
        Dúvidas? Fale com o suporte
      </a>
    </div>
  );
}

function SenhaTab() {
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  const salvar = async () => {
    setMsg('');
    if (senha.length < 6) { setMsg('A senha deve ter pelo menos 6 caracteres.'); return; }
    if (senha !== confirmar) { setMsg('As senhas não coincidem.'); return; }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) setMsg('Erro: ' + error.message);
    else { setMsg('Senha alterada com sucesso!'); setSenha(''); setConfirmar(''); }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="text-text-3 text-xs font-semibold uppercase tracking-wider mb-1 block">Nova senha</label>
        <input type="password" value={senha} onChange={e => setSenha(e.target.value)} className="input-premium w-full text-sm" />
      </div>
      <div>
        <label className="text-text-3 text-xs font-semibold uppercase tracking-wider mb-1 block">Confirmar nova senha</label>
        <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} className="input-premium w-full text-sm" />
      </div>
      <button onClick={salvar} disabled={salvando}
        className="btn-gold w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
        {salvando ? 'Salvando...' : 'Alterar senha'}
      </button>
      {msg && <p className="text-text-2 text-xs text-center">{msg}</p>}
    </div>
  );
}
