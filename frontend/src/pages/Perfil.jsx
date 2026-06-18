import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import * as Sentry from '@sentry/react';
import AvatarCropModal from '../components/AvatarCropModal';
import { startRegistration } from '@simplewebauthn/browser';

function detectarNomeDispositivo() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Dispositivo';
}

const PRICE_MENSAL = import.meta.env.VITE_STRIPE_PRICE_MENSAL;
const PRICE_ANUAL = import.meta.env.VITE_STRIPE_PRICE_ANUAL;

const TABS = [
  { id: 'dados', label: 'Dados' },
  { id: 'planos', label: 'Planos' },
  { id: 'senha', label: 'Senha' },
];

export default function Perfil() {
  const { logout } = useAuth();
  const [tab, setTab] = useState('dados');

  return (
    <div className="max-w-xl mx-auto p-4 md:p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-text-1 font-bold text-lg">Perfil</h1>
        <button onClick={logout}
          className="text-text-3 text-xs font-semibold hover:text-expense transition-colors px-2 py-1">
          Sair da conta
        </button>
      </div>

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
  const { user, perfil, refreshPerfil, session, logout } = useAuth();
  const [nome, setNome] = useState(perfil?.nome || user?.user_metadata?.full_name || '');
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [msg, setMsg] = useState('');
  const [cropSrc, setCropSrc] = useState(null);

  const avatarUrl = perfil?.avatar_url;
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  React.useEffect(() => { setAvatarLoaded(false); }, [avatarUrl]);

  const [excluindo, setExcluindo] = useState(false);
  const [showExcluirModal, setShowExcluirModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const webauthnSuportado = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const [dispositivos, setDispositivos] = useState([]);
  const [carregandoDispositivos, setCarregandoDispositivos] = useState(true);
  const [ativandoFaceId, setAtivandoFaceId] = useState(false);
  const [faceIdMsg, setFaceIdMsg] = useState('');

  const carregarDispositivos = React.useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('webauthn_credentials')
      .select('id, device_name, created_at').eq('user_id', user.id).order('created_at', { ascending: false });
    setDispositivos(data || []);
    setCarregandoDispositivos(false);
  }, [user]);

  React.useEffect(() => { carregarDispositivos(); }, [carregarDispositivos]);

  const ativarFaceId = async () => {
    setFaceIdMsg(''); setAtivandoFaceId(true);
    try {
      const optsRes = await fetch('/api/webauthn-register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      const options = await optsRes.json();
      if (!optsRes.ok) throw new Error(options.error || 'Erro ao iniciar cadastro');

      const attestationResponse = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/webauthn-register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ attestationResponse, deviceName: detectarNomeDispositivo() }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Erro ao confirmar cadastro');

      setFaceIdMsg('Face ID / Touch ID ativado neste dispositivo!');
      await carregarDispositivos();
    } catch (err) {
      if (err.name !== 'NotAllowedError') Sentry.captureException(err);
      setFaceIdMsg(err.name === 'NotAllowedError' ? 'Cadastro cancelado.' : 'Erro: ' + err.message);
    }
    setAtivandoFaceId(false);
  };

  const removerDispositivo = async (id) => {
    if (!window.confirm('Remover este dispositivo? Você precisará reativar o Face ID/Touch ID nele para usar novamente.')) return;
    await supabase.from('webauthn_credentials').delete().eq('id', id);
    await carregarDispositivos();
  };

  const excluirConta = async () => {
    if (confirmText.trim().toUpperCase() !== 'EXCLUIR') return;
    setExcluindo(true);
    try {
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await logout();
    } catch (err) {
      Sentry.captureException(err);
      alert('Erro ao excluir conta: ' + err.message);
      setExcluindo(false);
    }
  };

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

  const onFotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
    e.target.value = '';
  };

  const fecharCrop = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const confirmarFoto = async (blob) => {
    fecharCrop();
    setEnviandoFoto(true); setMsg('');
    try {
      const path = `${user.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
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
          <span className="text-accent text-3xl font-bold">{(nome || user?.email || '?').charAt(0).toUpperCase()}</span>
          {avatarUrl && (
            <img src={avatarUrl} alt="Foto de perfil" loading="eager" decoding="async"
              onLoad={() => setAvatarLoaded(true)}
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              style={{ opacity: avatarLoaded ? 1 : 0 }} />
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

      {webauthnSuportado && (
        <div className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-text-3 text-xs font-semibold uppercase tracking-wider mb-2">Face ID / Touch ID</p>

          {!carregandoDispositivos && dispositivos.length > 0 && (
            <div className="space-y-2 mb-3">
              {dispositivos.map(d => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-accent">
                      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-text-1 text-sm">{d.device_name || 'Dispositivo'}</p>
                      <p className="text-text-3 text-[10px]">Ativado em {new Date(d.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                  <button onClick={() => removerDispositivo(d.id)} className="text-expense text-xs hover:underline">Remover</button>
                </div>
              ))}
            </div>
          )}

          <button onClick={ativarFaceId} disabled={ativandoFaceId}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
            style={{ color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)' }}>
            {ativandoFaceId ? 'Aguardando confirmação...' : 'Ativar Face ID / Touch ID neste dispositivo'}
          </button>
          {faceIdMsg && <p className="text-text-2 text-xs text-center mt-2">{faceIdMsg}</p>}
        </div>
      )}

      <div className="pt-6 mt-2 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => { setConfirmText(''); setShowExcluirModal(true); }}
          className="text-text-3 text-xs underline hover:text-expense transition-colors">
          Quero excluir minha conta permanentemente
        </button>
      </div>

      {showExcluirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative card-premium p-6 w-full max-w-sm animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-text-1 font-bold text-base">Excluir conta</h3>
              <button onClick={() => setShowExcluirModal(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-text-3 hover:text-text-1 hover:bg-white/5 transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
            </div>
            <p className="text-text-3 text-sm mb-4">
              Essa ação é <span className="text-expense font-semibold">irreversível</span>. Seus dados — transações, metas, anotações, dispositivos com Face ID e assinatura — serão excluídos permanentemente.
            </p>
            <label className="text-text-3 text-xs block mb-1.5">
              Digite <span className="font-bold text-text-1">EXCLUIR</span> para confirmar
            </label>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
              placeholder="EXCLUIR" autoFocus className="input-premium w-full mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setShowExcluirModal(false)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={excluirConta} disabled={excluindo || confirmText.trim().toUpperCase() !== 'EXCLUIR'}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ color: '#fff', background: '#dc2626' }}>
                {excluindo ? 'Excluindo...' : 'Excluir definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cropSrc && (
        <AvatarCropModal src={cropSrc} onCancel={fecharCrop} onConfirm={confirmarFoto} />
      )}
    </div>
  );
}

function PlanosTab() {
  const { perfil, user, session } = useAuth();
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
      Sentry.captureException(err);
      alert('Erro ao iniciar pagamento: ' + err.message);
      setLoading(null);
    }
  };

  const gerenciarAssinatura = async () => {
    setLoading('portal');
    try {
      const res = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Erro ao abrir portal de assinatura');
    } catch (err) {
      Sentry.captureException(err);
      alert('Erro ao abrir portal de assinatura: ' + err.message);
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

      {ativo && (
        <button onClick={gerenciarAssinatura} disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-white border transition-all disabled:opacity-60"
          style={{ borderColor: 'rgba(255,255,255,0.15)' }}>
          {loading === 'portal' ? 'Abrindo...' : 'Gerenciar / Cancelar assinatura'}
        </button>
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
