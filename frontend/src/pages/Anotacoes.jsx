import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon, LIST_ICONS } from '../lib/icons';
import { newId } from '../lib/ids';

const TAREFAS_KEY = 'planeje_tarefas';
const GRUPOS_KEY  = 'planeje_grupos';
const ETIQUETAS_KEY = 'planeje_etiquetas';

function load(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; } }
function sv(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function loadTarefas() {
  const salvas = load(TAREFAS_KEY, null);
  if (salvas !== null) return salvas.map(t => ({ secao: null, etiquetas: [], concluido: false, descricao: '', vencimento: null, subtarefas: [], ...t }));
  const antigas = load('financeiro_notas', []);
  return antigas.map(n => ({ id: n.id || newId(), texto: n.texto || '', concluido: false, grupo: null, secao: null, etiquetas: [], criadoEm: n.criadoEm || new Date().toISOString(), descricao: '', vencimento: null, subtarefas: [] }));
}

function loadGrupos() {
  const salvos = load(GRUPOS_KEY, null);
  if (salvos !== null) return salvos.map(g => ({ emoji: 'clipboard-list', cor: '#22c55e', secoes: [], ...g }));
  return [];
}

const CORES_LISTA = ['#6366f1','#a855f7','#22c55e','#f59e0b','#ef4444','#06b6d4','#f43f5e','#3b82f6','#84cc16','#f97316'];
const COR_OPTIONS = ['#6366f1','#a855f7','#22c55e','#f59e0b','#ef4444','#06b6d4','#f43f5e','#3b82f6'];

export default function Anotacoes() {
  const [tarefas,       setTarefas]       = useState(loadTarefas);
  const [grupos,        setGrupos]        = useState(loadGrupos);
  const [etiquetas,     setEtiquetas]     = useState(() => load(ETIQUETAS_KEY, []));
  const [grupoAtivo,    setGrupoAtivo]    = useState(() => { const gs = loadGrupos(); return gs[0]?.id || null; });
  const [tarefaDetalhe, setTarefaDetalhe] = useState(null);
  const [secoesColl,    setSecoesColl]    = useState({});
  const [conclColl,     setConclColl]     = useState({});
  const [secaoMenu,     setSecaoMenu]     = useState(null);
  const [addingIn,      setAddingIn]      = useState(null);
  const [novaTexto,     setNovaTexto]     = useState('');
  const [editSecaoId,   setEditSecaoId]   = useState(null);
  const [editSecaoNome, setEditSecaoNome] = useState('');
  const [addingSecBottom, setAddingSecBottom] = useState(false);
  const [novaSecNome,   setNovaSecNome]   = useState('');
  const [undo,          setUndo]          = useState(null);
  const [smartView,     setSmartView]     = useState(null); // 'todas' | 'hoje' | 'proximos7' | null
  const [listModal,     setListModal]     = useState(null);
  const [showEtiqMgr,   setShowEtiqMgr]  = useState(false);
  const [novaEtiqNome,  setNovaEtiqNome]  = useState('');
  const [novaEtiqCor,   setNovaEtiqCor]   = useState(COR_OPTIONS[0]);

  useEffect(() => {
    const reload = () => {
      setTarefas(loadTarefas());
      const gs = loadGrupos(); setGrupos(gs);
      setEtiquetas(load(ETIQUETAS_KEY, []));
      setGrupoAtivo(a => a ?? (gs[0]?.id || null));
    };
    window.addEventListener('planeje-sync', reload);
    return () => window.removeEventListener('planeje-sync', reload);
  }, []);

  useEffect(() => { sv(TAREFAS_KEY, tarefas); }, [tarefas]);
  useEffect(() => { sv(GRUPOS_KEY,  grupos);  }, [grupos]);
  useEffect(() => { sv(ETIQUETAS_KEY, etiquetas); }, [etiquetas]);

  useEffect(() => {
    if (!secaoMenu) return;
    const close = () => setSecaoMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [secaoMenu]);

  const grupoObj = grupos.find(g => g.id === grupoAtivo) || grupos[0] || null;
  const secoes   = grupoObj?.secoes || [];

  const todayStr = new Date().toISOString().split('T')[0];
  const in7Str   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const smartTasks = smartView === 'todas'
    ? tarefas.filter(t => !t.concluido)
    : smartView === 'hoje'
    ? tarefas.filter(t => !t.concluido && t.vencimento === todayStr)
    : smartView === 'proximos7'
    ? tarefas.filter(t => !t.concluido && t.vencimento >= todayStr && t.vencimento <= in7Str)
    : [];
  const SMART_VIEWS = [
    { id: 'todas',      label: 'Todas',          count: tarefas.filter(t => !t.concluido).length },
    { id: 'hoje',       label: 'Hoje',           count: tarefas.filter(t => !t.concluido && t.vencimento === todayStr).length },
    { id: 'proximos7',  label: 'Próximos 7 dias', count: tarefas.filter(t => !t.concluido && t.vencimento >= todayStr && t.vencimento <= in7Str).length },
  ];

  // ── Task helpers ────────────────────────────────────────────────
  const updateTarefa = (id, fields) =>
    setTarefas(prev => prev.map(t => t.id === id ? { ...t, ...fields, updatedAt: new Date().toISOString() } : t));

  const addTarefa = (secaoId) => {
    const texto = novaTexto.trim() || 'Sem título';
    const nova = { id: newId(), texto, concluido: false, grupo: grupoAtivo, secao: secaoId || null, etiquetas: [], criadoEm: new Date().toISOString(), updatedAt: new Date().toISOString(), descricao: '', vencimento: null, subtarefas: [] };
    setTarefas(prev => [...prev, nova]);
    setTarefaDetalhe(nova.id);
    setNovaTexto(''); setAddingIn(null);
  };

  const toggleConcluido = (id) => {
    const t = tarefas.find(x => x.id === id);
    if (!t) return;
    if (!t.concluido) {
      setTarefas(prev => prev.map(x => x.id === id ? { ...x, concluido: true, concluidoEm: new Date().toISOString(), updatedAt: new Date().toISOString() } : x));
      const timer = setTimeout(() => setUndo(null), 4000);
      setUndo({ id, texto: t.texto, timer });
    } else {
      setTarefas(prev => prev.map(x => x.id === id ? { ...x, concluido: false, concluidoEm: null, updatedAt: new Date().toISOString() } : x));
    }
  };

  const removeTarefa = (id) => {
    setTarefas(prev => prev.filter(t => t.id !== id));
    if (tarefaDetalhe === id) setTarefaDetalhe(null);
  };

  const desfazerConcluido = () => {
    if (!undo) return;
    clearTimeout(undo.timer);
    setTarefas(prev => prev.map(t => t.id === undo.id ? { ...t, concluido: false, concluidoEm: null } : t));
    setUndo(null);
  };

  // ── Group helpers ───────────────────────────────────────────────
  const saveGrupo = ({ nome, emoji, cor }, editGrupoId) => {
    if (editGrupoId) {
      setGrupos(prev => prev.map(g => g.id === editGrupoId ? { ...g, nome, emoji, cor, updatedAt: new Date().toISOString() } : g));
    } else {
      const id = 'g_' + newId();
      setGrupos(prev => [...prev, { id, nome, emoji, cor, secoes: [], updatedAt: new Date().toISOString() }]);
      setGrupoAtivo(id);
    }
    setListModal(null);
  };

  const removeGrupo = (id) => {
    const restantes = grupos.filter(g => g.id !== id);
    setGrupos(restantes);
    setTarefas(prev => prev.filter(t => t.grupo !== id));
    if (grupoAtivo === id) setGrupoAtivo(restantes[0]?.id || null);
    if (tarefaDetalhe && tarefas.find(t => t.id === tarefaDetalhe)?.grupo === id) setTarefaDetalhe(null);
  };

  // ── Section helpers ─────────────────────────────────────────────
  const insertSecaoAt = (index, nome) => {
    if (!nome) return;
    const id = 's_' + newId();
    setGrupos(prev => prev.map(g => {
      if (g.id !== grupoAtivo) return g;
      const arr = [...(g.secoes || [])];
      arr.splice(index, 0, { id, nome });
      return { ...g, secoes: arr, updatedAt: new Date().toISOString() };
    }));
    setSecaoMenu(null);
  };

  const saveSecao = (secaoId) => {
    const nome = editSecaoNome.trim();
    if (nome) setGrupos(prev => prev.map(g => g.id === grupoAtivo
      ? { ...g, secoes: (g.secoes || []).map(s => s.id === secaoId ? { ...s, nome } : s) } : g));
    setEditSecaoId(null); setEditSecaoNome('');
  };

  const removeSecao = (secaoId) => {
    setGrupos(prev => prev.map(g => g.id === grupoAtivo
      ? { ...g, secoes: (g.secoes || []).filter(s => s.id !== secaoId) } : g));
    setTarefas(prev => prev.map(t => t.secao === secaoId ? { ...t, secao: null } : t));
    setSecaoMenu(null);
  };

  // ── Etiqueta helpers ────────────────────────────────────────────
  const addEtiqueta = () => {
    const nome = novaEtiqNome.trim();
    if (!nome) return;
    setEtiquetas(prev => [...prev, { id: 'e_' + newId(), nome, cor: novaEtiqCor, updatedAt: new Date().toISOString() }]);
    setNovaEtiqNome('');
  };

  const removeEtiqueta = (id) => {
    setEtiquetas(prev => prev.filter(e => e.id !== id));
    setTarefas(prev => prev.map(t => ({ ...t, etiquetas: (t.etiquetas || []).filter(e => e !== id) })));
  };

  // ── Computed ────────────────────────────────────────────────────
  const tarefasGrupo = tarefas.filter(t => t.grupo === grupoAtivo);
  const pendentes    = tarefasGrupo.filter(t => !t.concluido);
  const daSecao      = (sid) => pendentes.filter(t => (t.secao || null) === (sid || null));
  const conclSecao   = (sid) => tarefasGrupo.filter(t => t.concluido && (t.secao || null) === (sid || null));
  const tarefaObj    = tarefas.find(t => t.id === tarefaDetalhe) || null;

  const openSecaoMenu = (e, secao, index) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setSecaoMenu({ id: secao.id, nome: secao.nome, index, top: r.bottom + 4, left: r.left });
  };

  const InlineAdd = ({ secaoId }) => (
    <div className="flex items-center gap-2 py-2 px-1 mb-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div className="w-4 h-4 rounded border border-white/20 flex-shrink-0" />
      <input autoFocus value={novaTexto} onChange={e => setNovaTexto(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') addTarefa(secaoId); if (e.key === 'Escape') setAddingIn(null); }}
        onBlur={() => { if (novaTexto.trim()) addTarefa(secaoId); else setAddingIn(null); }}
        placeholder="Nome da tarefa..."
        className="flex-1 bg-transparent text-white/90 text-sm outline-none placeholder:text-white/25" />
    </div>
  );

  const renderSecao = (secao, index) => {
    const collapsed  = !!secoesColl[secao.id];
    const concl      = conclSecao(secao.id);
    const conclHide  = !!conclColl[secao.id];
    const tasks      = daSecao(secao.id);

    return (
      <div key={secao.id} className="mt-5">
        {/* TickTick-style section header: NAME ─────── count [actions] */}
        <div className="flex items-center gap-2 group/sec mb-1">
          <button onClick={() => setSecoesColl(p => ({ ...p, [secao.id]: !p[secao.id] }))}
            className="flex-shrink-0 text-white/30 hover:text-white/60 transition">
            <svg viewBox="0 0 20 20" fill="currentColor"
              className={`w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}`}>
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
          {editSecaoId === secao.id ? (
            <input autoFocus value={editSecaoNome}
              onChange={e => setEditSecaoNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveSecao(secao.id); if (e.key === 'Escape') setEditSecaoId(null); }}
              onBlur={() => saveSecao(secao.id)}
              className="bg-transparent text-white text-xs font-bold uppercase tracking-wider outline-none border-b border-white/30 pb-px w-32" />
          ) : (
            <span className="text-white/55 text-xs font-bold uppercase tracking-wider flex-shrink-0">{secao.nome}</span>
          )}
          {/* Line extending to the right — the TickTick signature */}
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          {tasks.length > 0 && !editSecaoId && (
            <span className="text-white/25 text-xs flex-shrink-0 font-medium">{tasks.length}</span>
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 transition flex-shrink-0">
            <button onClick={() => { setAddingIn(secao.id); setNovaTexto(''); }}
              className="w-5 h-5 rounded flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/5 transition text-sm leading-none">
              +
            </button>
            <button onClick={e => openSecaoMenu(e, secao, index)}
              className="w-5 h-5 rounded flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/5 transition">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z"/>
              </svg>
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            {addingIn === secao.id && <InlineAdd secaoId={secao.id} />}
            {tasks.map(t => (
              <TarefaRow key={t.id} tarefa={t} isSelected={tarefaDetalhe === t.id}
                onToggle={toggleConcluido} onClick={() => setTarefaDetalhe(t.id === tarefaDetalhe ? null : t.id)} />
            ))}
            {concl.length > 0 && (
              <div className="mt-0.5">
                <button onClick={() => setConclColl(p => ({ ...p, [secao.id]: !p[secao.id] }))}
                  className="flex items-center gap-1.5 text-white/25 hover:text-white/45 transition text-xs py-1 font-medium">
                  <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform ${conclHide ? '-rotate-90' : ''}`}>
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                  </svg>
                  Concluído {concl.length}
                </button>
                {!conclHide && concl.map(t => (
                  <TarefaRow key={t.id} tarefa={t} isSelected={tarefaDetalhe === t.id}
                    onToggle={toggleConcluido} onClick={() => setTarefaDetalhe(t.id === tarefaDetalhe ? null : t.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const rootTasks  = daSecao(null);
  const rootConcl  = conclSecao(null);
  const rootConclH = !!conclColl['root'];

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-112px)] md:h-[calc(100vh-0px)] overflow-hidden animate-fade-in">

      {/* ── Sidebar desktop ─────────────────────────────────────── */}
      <div className="hidden md:flex w-52 flex-shrink-0 flex-col border-r overflow-y-auto"
        style={{ background: 'rgba(10,15,30,0.6)', borderColor: 'rgba(255,255,255,0.07)' }}>

        {/* Smart views */}
        <div className="pt-4 pb-1">
          {SMART_VIEWS.map(sv => {
            const active = smartView === sv.id;
            return (
              <button key={sv.id}
                onClick={() => { setSmartView(sv.id); setGrupoAtivo(null); }}
                className="w-full flex items-center justify-between px-4 py-2 text-left transition-all group"
                style={active ? { background: 'rgba(34,197,94,0.1)', borderLeft: '2px solid #22c55e' } : { borderLeft: '2px solid transparent' }}>
                <span className={`text-sm ${active ? 'text-white font-semibold' : 'text-white/55 hover:text-white/80'} transition`}>{sv.label}</span>
                {sv.count > 0 && <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'text-accent' : 'text-white/30'}`}>{sv.count}</span>}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="mx-4 my-2 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />

        {/* Lists */}
        <p className="text-white/25 text-[9px] font-bold uppercase tracking-widest px-4 mb-1">Listas</p>
        {grupos.map(g => {
          const count  = tarefas.filter(t => t.grupo === g.id && !t.concluido).length;
          const active = !smartView && grupoAtivo === g.id;
          return (
            <div key={g.id}
              className="w-full flex items-center justify-between px-3 py-2 text-left group transition-all cursor-pointer"
              style={active ? { background: 'rgba(34,197,94,0.1)', borderLeft: `2px solid ${g.cor}` } : { borderLeft: '2px solid transparent' }}
              onClick={() => { setSmartView(null); setGrupoAtivo(g.id); }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex-shrink-0" style={{ color: g.cor }}><AppIcon id={g.emoji} className="w-4 h-4" /></span>
                <span className={`text-sm truncate ${active ? 'text-white font-semibold' : 'text-white/60'}`}>{g.nome}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {count > 0 && <span className="text-[10px] font-bold" style={{ color: g.cor }}>{count}</span>}
                <button onClick={e => { e.stopPropagation(); setListModal({ modo: 'edit', grupo: g }); }}
                  className="opacity-0 group-hover:opacity-100 text-white/25 hover:text-accent text-xs w-4 h-4 flex items-center justify-center transition">✎</button>
                <button onClick={e => { e.stopPropagation(); removeGrupo(g.id); }}
                  className="opacity-0 group-hover:opacity-100 text-white/25 hover:text-expense text-xs w-4 h-4 flex items-center justify-center transition">×</button>
              </div>
            </div>
          );
        })}
        <button onClick={() => setListModal({ modo: 'add' })}
          className="mx-3 mt-1 py-1.5 text-xs text-white/30 hover:text-accent hover:bg-white/5 transition text-left px-2 rounded-lg">
          + Nova lista
        </button>

        {/* Footer */}
        <div className="mt-auto px-4 pb-3 pt-4 border-t text-white/20 text-[10px]"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {tarefas.filter(t => t.concluido).length} concluídos
        </div>
      </div>

      {/* ── Mobile list tabs ─────────────────────────────────────── */}
      {grupos.length > 0 && (
        <div className="md:hidden flex-shrink-0 px-3 pt-2 pb-1 overflow-x-auto flex gap-2"
          style={{ borderBottom: '1px solid rgba(34,197,94,0.1)' }}>
          {grupos.map(g => {
            const count  = tarefas.filter(t => t.grupo === g.id && !t.concluido).length;
            const active = grupoAtivo === g.id;
            return (
              <button key={g.id} onClick={() => setGrupoAtivo(g.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
                style={active ? { background: g.cor + '22', color: g.cor, border: `1px solid ${g.cor}44` } : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <AppIcon id={g.emoji} className="w-4 h-4" />
                <span>{g.nome}</span>
                {count > 0 && <span className="font-bold">{count}</span>}
              </button>
            );
          })}
          <button onClick={() => setListModal({ modo: 'add' })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0"
            style={{ background: 'rgba(34,197,94,0.08)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
            + Lista
          </button>
        </div>
      )}

      {/* ── Main ────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {smartView ? (
          // ── Smart view content (Todas / Hoje / Próximos 7 dias) ──
          <>
            <div className={`flex-1 flex flex-col overflow-hidden ${tarefaObj ? 'hidden md:flex' : 'flex'}`}>
              <div className="px-4 md:px-5 py-3 flex items-center gap-2 flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <h2 className="text-white font-bold text-base">
                  {SMART_VIEWS.find(s => s.id === smartView)?.label}
                </h2>
                <span className="text-white/30 text-sm">{smartTasks.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto px-4 md:px-5 py-3">
                {smartTasks.length === 0 ? (
                  <p className="text-white/25 text-sm text-center pt-12">Nenhuma tarefa</p>
                ) : (
                  grupos.map(g => {
                    const gTasks = smartTasks.filter(t => t.grupo === g.id);
                    if (gTasks.length === 0) return null;
                    return (
                      <div key={g.id} className="mt-5 first:mt-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AppIcon id={g.emoji} className="w-3.5 h-3.5 flex-shrink-0" style={{ color: g.cor }} />
                          <span className="text-xs font-bold uppercase tracking-wider flex-shrink-0" style={{ color: g.cor }}>{g.nome}</span>
                          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                          <span className="text-white/25 text-xs flex-shrink-0">{gTasks.length}</span>
                        </div>
                        {gTasks.map(t => (
                          <TarefaRow key={t.id} tarefa={t} isSelected={tarefaDetalhe === t.id}
                            onToggle={toggleConcluido} onClick={() => setTarefaDetalhe(t.id === tarefaDetalhe ? null : t.id)} />
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {tarefaObj && (
              <TaskDetailPanel tarefa={tarefaObj} onClose={() => setTarefaDetalhe(null)}
                onUpdate={updateTarefa} onRemove={removeTarefa} onToggle={toggleConcluido}
                grupos={grupos} grupoAtivo={grupoAtivo}
                onMoveToGrupo={(tId, gId) => { updateTarefa(tId, { grupo: gId, secao: null }); setTarefaDetalhe(null); }} />
            )}
          </>
        ) : grupos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-3 gap-4 p-6">
            <AppIcon id="clipboard-list" className="w-12 h-12 opacity-30" />
            <p className="text-sm font-medium text-text-2">Nenhuma lista criada ainda</p>
            <button onClick={() => setListModal({ modo: 'add' })} className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold">
              + Criar primeira lista
            </button>
          </div>
        ) : (
          <>
            {/* Task list column */}
            <div className={`flex-1 flex flex-col overflow-hidden ${tarefaObj ? 'hidden md:flex' : 'flex'}`}>
              <div className="px-4 md:px-5 py-3 flex items-center gap-2 flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <AppIcon id={grupoObj?.emoji} className="w-5 h-5" style={{ color: grupoObj?.cor }} />
                <h2 className="text-white font-bold text-base">{grupoObj?.nome}</h2>
                <span className="text-white/30 text-sm">{pendentes.length}</span>
                <div className="flex-1" />
                <button onClick={() => setListModal({ modo: 'edit', grupo: grupoObj })}
                  className="md:hidden text-text-3 hover:text-accent p-1 text-sm transition">⚙</button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 md:px-5 py-3">
                {/* Add task root */}
                {addingIn === 'root' ? (
                  <InlineAdd secaoId={null} />
                ) : (
                  <button onClick={() => { setAddingIn('root'); setNovaTexto(''); }}
                    className="flex items-center gap-2 py-1.5 text-white/25 hover:text-white/55 transition w-full text-left text-sm mb-1">
                    + Adicionar tarefa
                  </button>
                )}

                {rootTasks.map(t => (
                  <TarefaRow key={t.id} tarefa={t} isSelected={tarefaDetalhe === t.id}
                    onToggle={toggleConcluido} onClick={() => setTarefaDetalhe(t.id === tarefaDetalhe ? null : t.id)} />
                ))}

                {rootConcl.length > 0 && (
                  <div className="mt-1">
                    <button onClick={() => setConclColl(p => ({ ...p, root: !p.root }))}
                      className="flex items-center gap-1.5 text-white/25 hover:text-white/45 transition text-xs py-1 font-medium">
                      <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform ${rootConclH ? '-rotate-90' : ''}`}>
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                      </svg>
                      Concluído {rootConcl.length}
                    </button>
                    {!rootConclH && rootConcl.map(t => (
                      <TarefaRow key={t.id} tarefa={t} isSelected={tarefaDetalhe === t.id}
                        onToggle={toggleConcluido} onClick={() => setTarefaDetalhe(t.id === tarefaDetalhe ? null : t.id)} />
                    ))}
                  </div>
                )}

                {secoes.map((s, i) => renderSecao(s, i))}

                {/* Add section */}
                <div className="mt-5">
                  {addingSecBottom ? (
                    <div className="flex items-center gap-2">
                      <input autoFocus value={novaSecNome} onChange={e => setNovaSecNome(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { insertSecaoAt(secoes.length, novaSecNome.trim()); setNovaSecNome(''); setAddingSecBottom(false); }
                          if (e.key === 'Escape') { setAddingSecBottom(false); setNovaSecNome(''); }
                        }}
                        onBlur={() => { if (novaSecNome.trim()) { insertSecaoAt(secoes.length, novaSecNome.trim()); } setNovaSecNome(''); setAddingSecBottom(false); }}
                        placeholder="Nome da seção..."
                        className="flex-1 bg-transparent text-white/70 text-xs font-bold uppercase tracking-wider outline-none border-b border-white/25 pb-px" />
                    </div>
                  ) : (
                    <button onClick={() => setAddingSecBottom(true)}
                      className="flex items-center gap-2 text-white/20 hover:text-white/40 transition text-xs py-1">
                      + Adicionar seção
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Detail panel */}
            {tarefaObj && (
              <TaskDetailPanel
                tarefa={tarefaObj}
                onClose={() => setTarefaDetalhe(null)}
                onUpdate={updateTarefa}
                onRemove={removeTarefa}
                onToggle={toggleConcluido}
                grupos={grupos}
                grupoAtivo={grupoAtivo}
                onMoveToGrupo={(tId, gId) => { updateTarefa(tId, { grupo: gId, secao: null }); setTarefaDetalhe(null); }}
              />
            )}
          </>
        )}
      </div>

      {/* ── Section 3-dot menu (portal) ─────────────────────────── */}
      {secaoMenu && createPortal(
        <div onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', top: secaoMenu.top, left: secaoMenu.left, zIndex: 9999, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', minWidth: 180, overflow: 'hidden' }}>
          {[
            { label: 'Renomear', action: () => { setEditSecaoId(secaoMenu.id); setEditSecaoNome(secaoMenu.nome); setSecaoMenu(null); } },
            { label: 'Inserir seção acima', action: () => { setSecaoMenu(null); setTimeout(() => { const n = window.prompt('Nome da seção:'); if (n?.trim()) insertSecaoAt(secaoMenu.index, n.trim()); }, 50); } },
            { label: 'Inserir seção abaixo', action: () => { setSecaoMenu(null); setTimeout(() => { const n = window.prompt('Nome da seção:'); if (n?.trim()) insertSecaoAt(secaoMenu.index + 1, n.trim()); }, 50); } },
            { label: 'Deletar', action: () => removeSecao(secaoMenu.id), danger: true },
          ].map(item => (
            <button key={item.label} onClick={item.action}
              className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-white/5"
              style={{ color: item.danger ? '#f43f5e' : 'rgba(255,255,255,0.85)', display: 'block' }}>
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* ── Modal Nova/Editar Lista ──────────────────────────────── */}
      {listModal && (
        <ListModal modo={listModal.modo} grupoInicial={listModal.grupo}
          onSave={saveGrupo} onClose={() => setListModal(null)} />
      )}

      {/* ── Modal Gerenciar Etiquetas ────────────────────────────── */}
      {showEtiqMgr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowEtiqMgr(false)}>
          <div className="rounded-2xl p-6 w-80 max-h-[80vh] flex flex-col"
            style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-1 font-bold text-base">Etiquetas</h3>
              <button onClick={() => setShowEtiqMgr(false)} className="text-text-3 hover:text-text-1 text-xl w-6 h-6 flex items-center justify-center">×</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {etiquetas.map(e => (
                <div key={e.id} className="flex items-center gap-3 py-2 px-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.cor }} />
                  <span className="text-text-2 text-sm flex-1">{e.nome}</span>
                  <button onClick={() => removeEtiqueta(e.id)} className="text-text-3 hover:text-expense text-sm w-5 h-5 flex items-center justify-center">×</button>
                </div>
              ))}
            </div>
            <div className="border-t pt-4" style={{ borderColor: 'rgba(34,197,94,0.1)' }}>
              <p className="text-text-3 text-xs mb-2 font-semibold uppercase tracking-wider">Nova etiqueta</p>
              <input value={novaEtiqNome} onChange={e => setNovaEtiqNome(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addEtiqueta(); }}
                placeholder="Nome..." className="input-premium text-sm w-full mb-3" />
              <div className="flex flex-wrap gap-2 mb-3">
                {COR_OPTIONS.map(cor => (
                  <button key={cor} onMouseDown={e => { e.preventDefault(); setNovaEtiqCor(cor); }}
                    className="w-6 h-6 rounded-full flex items-center justify-center transition-transform"
                    style={{ background: cor, transform: novaEtiqCor === cor ? 'scale(1.3)' : 'scale(1)', border: novaEtiqCor === cor ? '2px solid white' : '2px solid transparent' }}>
                    {novaEtiqCor === cor && <span className="text-white text-[9px] font-bold">✓</span>}
                  </button>
                ))}
              </div>
              <button onClick={addEtiqueta} className="btn-gold w-full py-2 text-sm font-semibold rounded-xl">Criar etiqueta</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Undo toast ───────────────────────────────────────────── */}
      {undo && (
        <div className="fixed fab-safe-lg left-1/2 -translate-x-1/2 z-50"
          style={{ background: '#1e293b', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, minWidth: 260 }}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-income flex-shrink-0">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          <p className="text-text-2 text-sm flex-1 truncate">"{undo.texto}" concluída</p>
          <button onClick={desfazerConcluido} className="text-accent text-sm font-semibold hover:text-accent/80 transition flex-shrink-0">Desfazer</button>
        </div>
      )}
    </div>
  );
}

// ── TarefaRow ────────────────────────────────────────────────────
function TarefaRow({ tarefa, isSelected, onToggle, onClick }) {
  const fmtD = (d) => { if (!d) return null; const [y,m,day] = d.split('-'); return `${day}/${m}/${String(y).slice(2)}`; };
  const subs = tarefa.subtarefas || [];
  const subsDone = subs.filter(s => s.concluido).length;
  return (
    <div className={`group flex items-center gap-2 py-2 px-1.5 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <button onClick={e => { e.stopPropagation(); onToggle(tarefa.id); }}
        className="flex-shrink-0 w-4 h-4 rounded border transition-all flex items-center justify-center"
        style={tarefa.concluido
          ? { background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderColor: 'transparent' }
          : { borderColor: 'rgba(255,255,255,0.25)', background: 'transparent' }}>
        {tarefa.concluido && (
          <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
            <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0" onClick={onClick}>
        <p className={`text-sm leading-snug select-none ${tarefa.concluido ? 'text-white/25 line-through' : 'text-white/85'}`}>
          {tarefa.texto}
        </p>
        {(tarefa.vencimento || (tarefa.descricao && tarefa.descricao.trim())) && !tarefa.concluido && (
          <p className="text-[11px] text-white/30 mt-0.5">
            {tarefa.vencimento && fmtD(tarefa.vencimento)}
            {tarefa.vencimento && tarefa.descricao?.trim() && ' · '}
            {tarefa.descricao?.trim() && <span className="italic">nota</span>}
          </p>
        )}
      </div>
      {subs.length > 0 && (
        <span className="text-[10px] text-white/25 flex-shrink-0 font-medium">{subsDone}/{subs.length}</span>
      )}
    </div>
  );
}

// ── TaskDetailPanel ──────────────────────────────────────────────
const MESES_CAL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function TaskDetailPanel({ tarefa, onClose, onUpdate, onRemove, onToggle, grupos, grupoAtivo, onMoveToGrupo }) {
  const [titulo,       setTitulo]       = useState(tarefa.texto);
  const [showMenu,     setShowMenu]     = useState(false);
  const [showMover,    setShowMover]    = useState(false);
  const [showCal,      setShowCal]      = useState(false);
  const [calMonth,     setCalMonth]     = useState(() => {
    if (tarefa.vencimento) { const [y,m] = tarefa.vencimento.split('-').map(Number); return { year: y, month: m }; }
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [subtexto,     setSubtexto]     = useState('');
  const [editSubId,    setEditSubId]    = useState(null);
  const [editSubTexto, setEditSubTexto] = useState('');
  const menuRef        = useRef(null);
  const calRef         = useRef(null);
  const addSubInputRef = useRef(null);

  useEffect(() => {
    setTitulo(tarefa.texto); setShowMenu(false); setShowMover(false); setShowCal(false);
    if (tarefa.vencimento) { const [y,m] = tarefa.vencimento.split('-').map(Number); setCalMonth({ year: y, month: m }); }
  }, [tarefa.id]);

  useEffect(() => {
    if (!showMenu) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, [showMenu]);

  useEffect(() => {
    if (!showCal) return;
    const close = (e) => { if (calRef.current && !calRef.current.contains(e.target)) setShowCal(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, [showCal]);

  const fmtD = (d) => { if (!d) return null; const [y,m,day] = d.split('-'); return `${day}/${m}/${String(y).slice(2)}`; };
  const subs     = tarefa.subtarefas || [];
  const subsDone = subs.filter(s => s.concluido).length;
  const todayD   = new Date().toISOString().split('T')[0];
  const tomorrowD = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const in7D     = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const addSub = () => {
    if (!subtexto.trim()) return;
    onUpdate(tarefa.id, { subtarefas: [...subs, { id: newId(), texto: subtexto.trim(), concluido: false }] });
    setSubtexto('');
    setTimeout(() => addSubInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30);
  };
  const toggleSub = (sid) => onUpdate(tarefa.id, { subtarefas: subs.map(s => s.id === sid ? { ...s, concluido: !s.concluido } : s) });
  const removeSub = (sid) => onUpdate(tarefa.id, { subtarefas: subs.filter(s => s.id !== sid) });
  const updateSub = (sid, texto) => onUpdate(tarefa.id, { subtarefas: subs.map(s => s.id === sid ? { ...s, texto } : s) });
  const pickDate  = (d) => { onUpdate(tarefa.id, { vencimento: d }); setShowCal(false); };

  // Calendar grid
  const renderCal = () => {
    const { year, month } = calMonth;
    const firstDay     = new Date(year, month - 1, 1).getDay();
    const daysInMonth  = new Date(year, month, 0).getDate();
    const prevMonth    = () => setCalMonth(p => p.month === 1 ? { year: p.year - 1, month: 12 } : { ...p, month: p.month - 1 });
    const nextMonth    = () => setCalMonth(p => p.month === 12 ? { year: p.year + 1, month: 1 } : { ...p, month: p.month + 1 });
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return (
      <div ref={calRef} onMouseDown={e => e.stopPropagation()}
        className="absolute left-0 top-7 z-50 rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#1a2235', border: '1px solid rgba(255,255,255,0.12)', width: 264, boxShadow: '0 16px 48px rgba(0,0,0,0.7)' }}>
        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <button className="flex-1 py-2.5 text-sm font-semibold text-white border-b-2" style={{ borderColor: '#4a9cf5' }}>Data</button>
          <button className="flex-1 py-2.5 text-sm text-white/35">Duração</button>
        </div>
        {/* Quick picks */}
        <div className="grid grid-cols-4 gap-1 px-3 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {[
            { label: 'Hoje',    emoji: '☀️', val: todayD },
            { label: 'Amanhã',  emoji: '⏰', val: tomorrowD },
            { label: '7 dias',  emoji: '+7', val: in7D },
            { label: 'Noite',   emoji: '🌙', val: todayD },
          ].map(q => (
            <button key={q.label} onClick={() => pickDate(q.val)}
              className="flex flex-col items-center gap-1 py-1.5 rounded-xl hover:bg-white/5 transition">
              <span className="text-base leading-none">{q.emoji}</span>
              <span className="text-[9px] text-white/35">{q.label}</span>
            </button>
          ))}
        </div>
        {/* Month nav */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <button onClick={prevMonth} className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white transition text-lg">‹</button>
          <span className="text-white text-xs font-semibold">{MESES_CAL[month - 1]} {year}</span>
          <button onClick={nextMonth} className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white transition text-lg">›</button>
        </div>
        {/* Day headers */}
        <div className="grid grid-cols-7 px-2 pb-0.5">
          {['D','S','T','Q','Q','S','S'].map((d,i) => (
            <div key={i} className="text-center text-[9px] text-white/25 font-medium py-1">{d}</div>
          ))}
        </div>
        {/* Days */}
        <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
          {days.map((d, i) => {
            if (!d) return <div key={i} />;
            const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const sel   = tarefa.vencimento === ds;
            const today = todayD === ds;
            return (
              <button key={i} onClick={() => pickDate(ds)}
                className="h-7 w-7 mx-auto rounded-full text-xs font-medium transition-all flex items-center justify-center"
                style={sel ? { background: '#4a9cf5', color: '#fff' } : today ? { color: '#4a9cf5', fontWeight: 700 } : { color: 'rgba(255,255,255,0.7)' }}>
                {d}
              </button>
            );
          })}
        </div>
        {/* Extra rows */}
        <div className="border-t px-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {[{ icon: '⏱', label: 'Hora' }, { icon: '🔔', label: 'Lembrete' }, { icon: '🔁', label: 'Repetir' }].map(o => (
            <div key={o.label} className="flex items-center justify-between py-2.5 border-b last:border-0 text-xs text-white/35"
              style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <span>{o.icon} {o.label}</span>
              <span className="text-white/20">›</span>
            </div>
          ))}
        </div>
        {/* Limpar / OK */}
        <div className="flex gap-2 px-4 py-3">
          <button onClick={() => { onUpdate(tarefa.id, { vencimento: null }); setShowCal(false); }}
            className="flex-1 py-2 rounded-xl text-xs font-semibold transition"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)' }}>
            Limpar
          </button>
          <button onClick={() => setShowCal(false)}
            className="flex-1 py-2 rounded-xl text-xs font-semibold"
            style={{ background: '#4a9cf5', color: '#fff' }}>
            OK
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full md:w-80 lg:w-96 border-l flex flex-col overflow-hidden flex-shrink-0 relative"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#080f1d' }}>

      {/* TickTick-style header: clipboard | 📅[data]   🚩 ⋮ × */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {/* Status circle */}
        <button onClick={() => onToggle(tarefa.id)}
          className="flex-shrink-0 w-4 h-4 rounded-full border-2 transition-all flex items-center justify-center"
          style={tarefa.concluido ? { background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderColor: 'transparent' } : { borderColor: 'rgba(255,255,255,0.3)', background: 'transparent' }}>
          {tarefa.concluido && <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
        {/* Separator */}
        <span className="text-white/15 text-xs">|</span>
        {/* Date button (icon only when no date, icon+date when set) */}
        <div className="relative flex-1">
          <button onClick={() => setShowCal(v => !v)}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition group">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
            </svg>
            {tarefa.vencimento ? (
              <span className="text-xs" style={{ color: '#4a9cf5' }}>{fmtD(tarefa.vencimento)}</span>
            ) : (
              <span className="text-xs text-white/30 group-hover:text-white/55">Dia do vencimento</span>
            )}
          </button>
          {showCal && renderCal()}
        </div>
        {/* Flag */}
        <button className="w-6 h-6 flex items-center justify-center text-white/20 hover:text-white/50 transition flex-shrink-0">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 7l2.55 2.4A1 1 0 0116 11H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clipRule="evenodd"/>
          </svg>
        </button>
        {/* Menu */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button onClick={() => setShowMenu(v => !v)}
            className="w-6 h-6 flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 transition rounded">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z"/>
            </svg>
          </button>
          {showMenu && (
            <div className="absolute right-0 top-8 z-50 rounded-xl overflow-hidden"
              style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', minWidth: 150 }}
              onMouseDown={e => e.stopPropagation()}>
              <button onClick={() => { setShowMover(true); setShowMenu(false); }}
                className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 transition block">Mover para</button>
              <button onClick={() => onRemove(tarefa.id)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition block"
                style={{ color: '#f43f5e' }}>Deletar</button>
            </div>
          )}
        </div>
        {/* Close */}
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 transition rounded text-lg leading-none flex-shrink-0">
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Title — big, like TickTick */}
        <div className="px-5 pt-5 pb-3">
          <textarea value={titulo}
            onChange={e => setTitulo(e.target.value)}
            onBlur={() => onUpdate(tarefa.id, { texto: titulo.trim() || tarefa.texto })}
            rows={2}
            className="w-full bg-transparent text-white font-bold text-xl outline-none resize-none placeholder:text-white/15"
            style={{ lineHeight: 1.3 }}
            placeholder="Título da tarefa" />
        </div>

        {/* Description */}
        <div className="px-5 pb-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          <textarea value={tarefa.descricao || ''}
            onChange={e => onUpdate(tarefa.id, { descricao: e.target.value })}
            rows={3}
            placeholder="Adicionar descrição..."
            className="w-full bg-transparent text-white/45 text-sm outline-none resize-none placeholder:text-white/18" />
        </div>

        {/* Subtasks — TickTick style */}
        <div className="flex-1 px-4 pt-3 pb-4">
          {subs.length > 0 && (
            <div className="w-full h-0.5 rounded-full mb-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(subsDone / subs.length * 100)}%`, background: '#4a9cf5' }} />
            </div>
          )}
          {subs.map(s => (
            <div key={s.id}
              className="flex items-center gap-2 py-2 group/sub border-b"
              style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
              {/* Drag handle */}
              <span className="text-white/15 text-sm flex-shrink-0 cursor-grab select-none">≡</span>
              {/* Checkbox */}
              <button onClick={() => toggleSub(s.id)}
                className="flex-shrink-0 w-4 h-4 rounded border transition-all flex items-center justify-center"
                style={s.concluido ? { background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderColor: 'transparent' } : { borderColor: 'rgba(255,255,255,0.25)', background: 'transparent' }}>
                {s.concluido && <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </button>
              {/* Text */}
              {editSubId === s.id ? (
                <input autoFocus value={editSubTexto}
                  onChange={e => setEditSubTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { updateSub(s.id, editSubTexto.trim() || s.texto); setEditSubId(null); } }}
                  onBlur={() => { updateSub(s.id, editSubTexto.trim() || s.texto); setEditSubId(null); }}
                  className="flex-1 bg-transparent text-white/85 text-sm outline-none border-b border-white/20 pb-px" />
              ) : (
                <span onClick={() => { setEditSubId(s.id); setEditSubTexto(s.texto); }}
                  className={`flex-1 text-sm cursor-text select-none ${s.concluido ? 'text-white/25 line-through' : 'text-white/80'}`}>
                  {s.texto || 'Item sem título'}
                </span>
              )}
              {/* Actions — visible on hover */}
              <div className="opacity-0 group-hover/sub:opacity-100 transition flex items-center gap-1 flex-shrink-0">
                <button className="w-5 h-5 flex items-center justify-center text-white/25 hover:text-white/60 transition">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
                  </svg>
                </button>
                <button onClick={() => removeSub(s.id)}
                  className="w-5 h-5 flex items-center justify-center text-white/25 hover:text-expense transition">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {/* Add subtask — TickTick style: ○ placeholder */}
          <div ref={addSubInputRef} className="flex items-center gap-2.5 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            <div className="w-4 h-4 rounded-full border border-white/20 flex-shrink-0" />
            <input value={subtexto} onChange={e => setSubtexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addSub(); }}
              placeholder="Pressione 'Entrar' para adicionar item na lista"
              className="flex-1 bg-transparent text-white/35 text-sm outline-none placeholder:text-white/20" />
          </div>
        </div>
      </div>

      {/* Move to overlay */}
      {showMover && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="rounded-xl p-4 w-56" style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">Mover para</p>
            {grupos.map(g => (
              <button key={g.id} onClick={() => { onMoveToGrupo(tarefa.id, g.id); setShowMover(false); }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/5 transition flex items-center gap-2">
                <AppIcon id={g.emoji} className="w-4 h-4" style={{ color: g.cor }} />
                {g.nome}
                {g.id === grupoAtivo && <span className="ml-auto text-white/25 text-xs">✓</span>}
              </button>
            ))}
            <button onClick={() => setShowMover(false)} className="mt-2 w-full text-center text-white/25 text-xs py-1 hover:text-white/45 transition">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ListModal ────────────────────────────────────────────────────
function ListModal({ modo, grupoInicial, onSave, onClose }) {
  const [nome,      setNome]      = useState(grupoInicial?.nome || '');
  const [emoji,     setEmoji]     = useState(grupoInicial?.emoji || 'clipboard-list');
  const [cor,       setCor]       = useState(grupoInicial?.cor  || CORES_LISTA[0]);
  const [emojiTab,  setEmojiTab]  = useState(Object.keys(LIST_ICONS)[0]);
  const [showEmoji, setShowEmoji] = useState(false);

  const submit = () => { if (!nome.trim()) return; onSave({ nome: nome.trim(), emoji, cor }, modo === 'edit' ? grupoInicial.id : null); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="rounded-2xl w-[360px] flex flex-col overflow-hidden"
        style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(34,197,94,0.12)' }}>
          <h3 className="text-text-1 font-bold">{modo === 'edit' ? 'Editar lista' : 'Adicionar lista'}</h3>
          <button onClick={onClose} className="text-text-3 hover:text-text-1 transition text-xl w-6 h-6 flex items-center justify-center">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowEmoji(v => !v)}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition hover:bg-white/5"
                style={{ background: cor + '22', border: `1px solid ${cor}44` }}>
                <AppIcon id={emoji} className="w-5 h-5" style={{ color: cor }} />
              </button>
              {showEmoji && (
                <div className="absolute top-12 left-0 z-10 rounded-2xl overflow-hidden w-72"
                  style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
                  <div className="flex border-b overflow-x-auto" style={{ borderColor: 'rgba(34,197,94,0.12)' }}>
                    {Object.keys(LIST_ICONS).map(cat => (
                      <button key={cat} onClick={() => setEmojiTab(cat)}
                        className={`px-3 py-2 text-xs whitespace-nowrap transition flex-shrink-0 ${emojiTab === cat ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-2'}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-8 gap-0 p-2 max-h-36 overflow-y-auto">
                    {LIST_ICONS[emojiTab].map(iconId => (
                      <button key={iconId} onClick={() => { setEmoji(iconId); setShowEmoji(false); }}
                        className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition">
                        <AppIcon id={iconId} className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <input autoFocus value={nome} onChange={e => setNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
              placeholder="Nome da lista..." className="flex-1 input-premium text-sm" />
          </div>
          <div>
            <p className="text-text-3 text-xs font-semibold uppercase tracking-wider mb-2">Cor da Lista</p>
            <div className="flex flex-wrap gap-2">
              {CORES_LISTA.map(c => (
                <button key={c} onClick={() => setCor(c)}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-transform"
                  style={{ background: c, transform: cor === c ? 'scale(1.25)' : 'scale(1)', border: cor === c ? '2px solid white' : '2px solid transparent' }}>
                  {cor === c && <span className="text-white text-[10px] font-bold">✓</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: cor + '11', border: `1px solid ${cor}33` }}>
            <AppIcon id={emoji} className="w-5 h-5" style={{ color: cor }} />
            <span className="text-sm font-semibold" style={{ color: cor }}>{nome || 'Nome da lista'}</span>
          </div>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-text-2 hover:bg-white/5 transition border"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            Cancelar
          </button>
          <button onClick={submit} disabled={!nome.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${cor}, ${cor}cc)`, color: '#fff' }}>
            {modo === 'edit' ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}
