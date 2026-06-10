import React, { useState, useEffect, useRef } from 'react';

const TAREFAS_KEY   = 'planeje_tarefas';
const GRUPOS_KEY    = 'planeje_grupos';
const ETIQUETAS_KEY = 'planeje_etiquetas';

function load(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; } }
function sv(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function loadTarefas() {
  const salvas = load(TAREFAS_KEY, null);
  if (salvas !== null) return salvas.map(t => ({ secao: null, etiquetas: [], concluido: false, ...t }));
  // Migra notas antigas se existirem
  const antigas = load('financeiro_notas', []);
  return antigas.map(n => ({ id: n.id || Date.now() + Math.random(), texto: n.texto || '', concluido: false, grupo: null, secao: null, etiquetas: [], criadoEm: n.criadoEm || new Date().toISOString() }));
}

function loadGrupos() {
  const salvos = load(GRUPOS_KEY, null);
  if (salvos !== null) return salvos.map(g => ({ emoji: '📋', cor: '#22c55e', secoes: [], ...g }));
  return [];
}

const ETIQUETAS_PADRAO = [
  { id: 'pendente',   nome: 'Pendente',   cor: '#22c55e' },
  { id: 'comprar',    nome: 'Comprar',    cor: '#f59e0b' },
  { id: 'emprestado', nome: 'Emprestado', cor: '#ef4444' },
  { id: 'ok',         nome: 'OK',         cor: '#22c55e' },
];

const CORES_LISTA = ['#6366f1','#a855f7','#22c55e','#f59e0b','#ef4444','#06b6d4','#f43f5e','#3b82f6','#84cc16','#f97316'];
const COR_OPTIONS = ['#6366f1','#a855f7','#22c55e','#f59e0b','#ef4444','#06b6d4','#f43f5e','#3b82f6'];

const EMOJIS = {
  'Geral':    ['📋','📝','✅','🎯','💡','⭐','🔔','📌','🗂️','📁','🚀','💼','📊','🏠','🗒️','📎','🔖','🧩','🎪','🏆'],
  'Finanças': ['💰','💵','💳','🏦','📈','📉','💸','🪙','💲','🤑','🏧','💹'],
  'Saúde':    ['🏋️','🧘','🥗','💊','🩺','🧬','❤️','🏃','🚴','🥤'],
  'Estudo':   ['🎓','📚','✏️','🔬','🧪','🖥️','💻','📐','🧮','📖'],
  'Vida':     ['✈️','🛒','🍕','🎮','🎵','🎨','🌱','🐶','👨‍👩‍👧','🏡'],
};

export default function Anotacoes() {
  const [tarefas,       setTarefas]       = useState(loadTarefas);
  const [grupos,        setGrupos]        = useState(loadGrupos);
  const [etiquetas,     setEtiquetas]     = useState(() => load(ETIQUETAS_KEY, ETIQUETAS_PADRAO));
  const [grupoAtivo,    setGrupoAtivo]    = useState(() => { const gs = loadGrupos(); return gs[0]?.id || null; });
  const [filtroEtiq,    setFiltroEtiq]    = useState(null);
  const [novaTexto,     setNovaTexto]     = useState('');
  const [novaTags,      setNovaTags]      = useState([]);
  const [adicionando,   setAdicionando]   = useState(null);
  const [editId,        setEditId]        = useState(null);
  const [editTexto,     setEditTexto]     = useState('');
  const [editTags,      setEditTags]      = useState([]);
  const [showConcluidos,setShowConcluidos]= useState(false);
  const [undo,          setUndo]          = useState(null);
  const [tagPickerId,   setTagPickerId]   = useState(null);
  const [novaSecaoNome, setNovaSecaoNome] = useState('');
  const [addingSecao,   setAddingSecao]   = useState(false);
  const [editSecaoId,   setEditSecaoId]   = useState(null);
  const [editSecaoNome, setEditSecaoNome] = useState('');
  const [listModal,     setListModal]     = useState(null);
  const [showEtiqMgr,   setShowEtiqMgr]  = useState(false);
  const [novaEtiqNome,  setNovaEtiqNome]  = useState('');
  const [novaEtiqCor,   setNovaEtiqCor]   = useState(COR_OPTIONS[0]);

  const inputRef = useRef(null);

  useEffect(() => { sv(TAREFAS_KEY, tarefas); }, [tarefas]);
  useEffect(() => { sv(GRUPOS_KEY, grupos); }, [grupos]);
  useEffect(() => { sv(ETIQUETAS_KEY, etiquetas); }, [etiquetas]);

  const grupoObj = grupos.find(g => g.id === grupoAtivo) || grupos[0] || null;
  const secoes   = grupoObj?.secoes || [];

  // ── Tarefas ────────────────────────────────────────────────────
  const addTarefa = (secaoId) => {
    const t = novaTexto.trim();
    if (!t) { setAdicionando(null); return; }
    setTarefas(prev => [{ id: Date.now(), texto: t, concluido: false, grupo: grupoAtivo, secao: secaoId || null, etiquetas: novaTags, criadoEm: new Date().toISOString() }, ...prev]);
    setNovaTexto(''); setNovaTags([]);
  };

  const toggleConcluido = (id) => {
    const tarefa = tarefas.find(t => t.id === id);
    if (!tarefa) return;
    if (!tarefa.concluido) {
      setTarefas(prev => prev.map(t => t.id === id ? { ...t, concluido: true, concluidoEm: new Date().toISOString() } : t));
      const timer = setTimeout(() => setUndo(null), 4000);
      setUndo({ id, texto: tarefa.texto, timer });
    } else {
      setTarefas(prev => prev.map(t => t.id === id ? { ...t, concluido: false, concluidoEm: null } : t));
    }
  };

  const desfazerConcluido = () => {
    if (!undo) return;
    clearTimeout(undo.timer);
    setTarefas(prev => prev.map(t => t.id === undo.id ? { ...t, concluido: false, concluidoEm: null } : t));
    setUndo(null);
  };

  const removeTarefa = (id) => setTarefas(prev => prev.filter(t => t.id !== id));

  const saveEdit = (id) => {
    const t = editTexto.trim();
    if (t) setTarefas(prev => prev.map(x => x.id === id ? { ...x, texto: t, etiquetas: editTags } : x));
    setEditId(null); setEditTexto(''); setEditTags([]);
  };

  const toggleTagTarefa = (tarefaId, etiqId) =>
    setTarefas(prev => prev.map(t => {
      if (t.id !== tarefaId) return t;
      const arr = t.etiquetas || [];
      return { ...t, etiquetas: arr.includes(etiqId) ? arr.filter(e => e !== etiqId) : [...arr, etiqId] };
    }));

  // ── Grupos ─────────────────────────────────────────────────────
  const saveGrupo = ({ nome, emoji, cor }, editGrupoId) => {
    if (editGrupoId) {
      setGrupos(prev => prev.map(g => g.id === editGrupoId ? { ...g, nome, emoji, cor } : g));
    } else {
      const id = 'g_' + Date.now();
      setGrupos(prev => [...prev, { id, nome, emoji, cor, secoes: [] }]);
      setGrupoAtivo(id);
    }
    setListModal(null);
  };

  const removeGrupo = (id) => {
    const restantes = grupos.filter(g => g.id !== id);
    setGrupos(restantes);
    setTarefas(prev => prev.filter(t => t.grupo !== id));
    if (grupoAtivo === id) setGrupoAtivo(restantes[0]?.id || null);
  };

  // ── Seções ─────────────────────────────────────────────────────
  const addSecao = () => {
    const nome = novaSecaoNome.trim();
    if (!nome) { setAddingSecao(false); return; }
    const id = 's_' + Date.now();
    setGrupos(prev => prev.map(g => g.id === grupoAtivo ? { ...g, secoes: [...(g.secoes || []), { id, nome }] } : g));
    setNovaSecaoNome(''); setAddingSecao(false);
  };

  const saveSecao = (secaoId) => {
    const nome = editSecaoNome.trim();
    if (nome) setGrupos(prev => prev.map(g => g.id === grupoAtivo
      ? { ...g, secoes: (g.secoes || []).map(s => s.id === secaoId ? { ...s, nome } : s) }
      : g));
    setEditSecaoId(null); setEditSecaoNome('');
  };

  const removeSecao = (secaoId) => {
    setGrupos(prev => prev.map(g => g.id === grupoAtivo
      ? { ...g, secoes: (g.secoes || []).filter(s => s.id !== secaoId) }
      : g));
    setTarefas(prev => prev.map(t => t.secao === secaoId ? { ...t, secao: null } : t));
  };

  // ── Etiquetas ──────────────────────────────────────────────────
  const addEtiqueta = () => {
    const nome = novaEtiqNome.trim();
    if (!nome) return;
    setEtiquetas(prev => [...prev, { id: 'e_' + Date.now(), nome, cor: novaEtiqCor }]);
    setNovaEtiqNome('');
  };

  const removeEtiqueta = (id) => {
    setEtiquetas(prev => prev.filter(e => e.id !== id));
    setTarefas(prev => prev.map(t => ({ ...t, etiquetas: (t.etiquetas || []).filter(e => e !== id) })));
    if (filtroEtiq === id) setFiltroEtiq(null);
  };

  // ── Dados filtrados ────────────────────────────────────────────
  const tarefasGrupo = tarefas.filter(t => t.grupo === grupoAtivo);
  const matchEtiq    = (t) => !filtroEtiq || (t.etiquetas || []).includes(filtroEtiq);
  const pendentes    = tarefasGrupo.filter(t => !t.concluido && matchEtiq(t));
  const concluidos   = tarefasGrupo.filter(t => t.concluido && matchEtiq(t));
  const daSecao      = (sid) => pendentes.filter(t => (t.secao || null) === (sid || null));

  const rowProps = (t) => ({
    tarefa: t, etiquetas,
    editId, editTexto, editTags,
    setEditId, setEditTexto, setEditTags,
    onToggle: toggleConcluido, onRemove: removeTarefa, onSaveEdit: saveEdit,
    onToggleTag: (etiqId) => toggleTagTarefa(t.id, etiqId),
    tagPickerOpen: tagPickerId === t.id,
    onTagPickerToggle: () => setTagPickerId(v => v === t.id ? null : t.id),
  });

  const addProps = (secaoId) => ({
    secaoId, adicionando, setAdicionando,
    novaTexto, setNovaTexto, novaTags, setNovaTags,
    etiquetas, addTarefa, inputRef,
  });

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-112px)] md:h-[calc(100vh-0px)] overflow-hidden animate-fade-in">

      {/* ── Sidebar desktop ─────────────────────────────────────── */}
      <div className="hidden md:flex w-48 flex-shrink-0 flex-col border-r py-4 overflow-y-auto"
        style={{ background: 'rgba(34,197,94,0.04)', borderColor: 'rgba(34,197,94,0.12)' }}>

        <p className="text-text-3 text-[9px] font-bold uppercase tracking-widest px-4 mb-1">Listas</p>

        {grupos.map(g => {
          const count  = tarefas.filter(t => t.grupo === g.id && !t.concluido).length;
          const active = grupoAtivo === g.id;
          return (
            <div key={g.id}
              className="w-full flex items-center justify-between px-3 py-2 text-left group transition-all cursor-pointer"
              style={active ? { background: 'rgba(34,197,94,0.12)', borderLeft: `2px solid ${g.cor}` } : { borderLeft: '2px solid transparent' }}
              onClick={() => setGrupoAtivo(g.id)}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm flex-shrink-0" style={{ color: g.cor }}>{g.emoji}</span>
                <span className={`text-sm truncate ${active ? 'text-text-1 font-semibold' : 'text-text-2'}`}>{g.nome}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {count > 0 && <span className="text-[10px] font-bold" style={{ color: g.cor }}>{count}</span>}
                <button onClick={e => { e.stopPropagation(); setListModal({ modo: 'edit', grupo: g }); }}
                  className="opacity-0 group-hover:opacity-100 text-text-3 hover:text-accent text-xs w-4 h-4 flex items-center justify-center transition">✎</button>
                <button onClick={e => { e.stopPropagation(); removeGrupo(g.id); }}
                  className="opacity-0 group-hover:opacity-100 text-text-3 hover:text-expense text-xs w-4 h-4 flex items-center justify-center transition">×</button>
              </div>
            </div>
          );
        })}

        <button onClick={() => setListModal({ modo: 'add' })}
          className="mx-3 mt-1 py-1.5 text-xs text-text-3 hover:text-accent hover:bg-white/5 transition text-left px-2 rounded-lg">
          + Nova lista
        </button>

        {/* Etiquetas */}
        <div className="mt-4 mb-1 flex items-center justify-between px-4">
          <p className="text-text-3 text-[9px] font-bold uppercase tracking-widest">Etiquetas</p>
          <button onClick={() => setShowEtiqMgr(true)} className="text-text-3 hover:text-accent text-xs transition">⚙</button>
        </div>

        <button onClick={() => setFiltroEtiq(null)}
          className="w-full flex items-center gap-2 px-4 py-1.5 text-left transition"
          style={!filtroEtiq ? { borderLeft: '2px solid #22c55e', background: 'rgba(34,197,94,0.06)' } : { borderLeft: '2px solid transparent' }}>
          <span className="w-2 h-2 rounded-full bg-text-3 flex-shrink-0" />
          <span className={`text-xs ${!filtroEtiq ? 'text-text-1 font-semibold' : 'text-text-3'}`}>Todas</span>
        </button>

        {etiquetas.map(e => (
          <button key={e.id} onClick={() => setFiltroEtiq(filtroEtiq === e.id ? null : e.id)}
            className="w-full flex items-center gap-2 px-4 py-1.5 text-left transition"
            style={filtroEtiq === e.id ? { borderLeft: `2px solid ${e.cor}`, background: 'rgba(34,197,94,0.06)' } : { borderLeft: '2px solid transparent' }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.cor }} />
            <span className={`text-xs truncate ${filtroEtiq === e.id ? 'text-text-1 font-semibold' : 'text-text-3'}`}>{e.nome}</span>
          </button>
        ))}

        <div className="mt-auto px-4 pb-2 pt-4 border-t text-text-3 text-[10px]"
          style={{ borderColor: 'rgba(34,197,94,0.1)' }}>
          {tarefas.filter(t => t.concluido).length} concluídos
        </div>
      </div>

      {/* ── Seletor mobile de lista (horizontal scroll) ──────────── */}
      {grupos.length > 0 && (
        <div className="md:hidden flex-shrink-0 px-3 pt-2 pb-1 overflow-x-auto flex gap-2"
          style={{ borderBottom: '1px solid rgba(34,197,94,0.1)' }}>
          {grupos.map(g => {
            const count = tarefas.filter(t => t.grupo === g.id && !t.concluido).length;
            const active = grupoAtivo === g.id;
            return (
              <button key={g.id} onClick={() => setGrupoAtivo(g.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
                style={active
                  ? { background: g.cor + '22', color: g.cor, border: `1px solid ${g.cor}44` }
                  : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span>{g.emoji}</span>
                <span>{g.nome}</span>
                {count > 0 && <span className="font-bold" style={{ color: active ? g.cor : 'rgba(255,255,255,0.4)' }}>{count}</span>}
              </button>
            );
          })}
          <button onClick={() => setListModal({ modo: 'add' })}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
            style={{ background: 'rgba(34,197,94,0.08)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
            + Lista
          </button>
        </div>
      )}

      {/* ── Conteúdo ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {grupos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-3 gap-4 p-6">
            <span className="text-5xl opacity-30">📋</span>
            <p className="text-sm font-medium text-text-2">Nenhuma lista criada ainda</p>
            <button onClick={() => setListModal({ modo: 'add' })}
              className="btn-gold px-5 py-2.5 rounded-xl text-sm font-semibold">
              + Criar primeira lista
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(34,197,94,0.12)' }}>
              <span className="text-xl">{grupoObj?.emoji}</span>
              <h2 className="text-text-1 font-bold text-base md:text-lg">{grupoObj?.nome}</h2>
              <span className="text-text-3 text-sm">{pendentes.length}</span>
              <div className="flex-1" />
              <button onClick={() => setShowEtiqMgr(true)} className="md:hidden text-text-3 hover:text-accent text-sm transition p-1">⚙</button>
              {filtroEtiq && (() => {
                const e = etiquetas.find(x => x.id === filtroEtiq);
                return e ? (
                  <span className="text-xs px-2 py-0.5 rounded-full cursor-pointer"
                    onClick={() => setFiltroEtiq(null)}
                    style={{ background: e.cor + '33', color: e.cor }}>
                    {e.nome} ×
                  </span>
                ) : null;
              })()}
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3">

              <AdicionarTarefa {...addProps(null)} />
              {daSecao(null).map(t => <TarefaRow key={t.id} {...rowProps(t)} />)}

              {secoes.map(secao => (
                <div key={secao.id} className="mt-4">
                  <div className="flex items-center gap-2 mb-1 group/sec">
                    <div className="flex-1 h-px" style={{ background: 'rgba(34,197,94,0.15)' }} />
                    {editSecaoId === secao.id ? (
                      <input autoFocus value={editSecaoNome} onChange={e => setEditSecaoNome(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveSecao(secao.id); if (e.key === 'Escape') setEditSecaoId(null); }}
                        onBlur={() => saveSecao(secao.id)}
                        className="bg-transparent text-text-2 text-xs font-semibold uppercase tracking-wider outline-none border-b px-1"
                        style={{ borderColor: 'rgba(34,197,94,0.4)' }} />
                    ) : (
                      <span className="text-text-3 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:text-text-2 transition"
                        onDoubleClick={() => { setEditSecaoId(secao.id); setEditSecaoNome(secao.nome); }}>
                        {secao.nome}
                      </span>
                    )}
                    <div className="flex items-center gap-1 opacity-0 group-hover/sec:opacity-100 transition">
                      <button onClick={() => setAdicionando('s_' + secao.id)}
                        className="text-text-3 hover:text-accent text-xs w-4 h-4 flex items-center justify-center">+</button>
                      <button onClick={() => removeSecao(secao.id)}
                        className="text-text-3 hover:text-expense text-xs w-4 h-4 flex items-center justify-center">×</button>
                    </div>
                    <div className="flex-1 h-px" style={{ background: 'rgba(34,197,94,0.15)' }} />
                  </div>
                  <AdicionarTarefa {...addProps(secao.id)} />
                  {daSecao(secao.id).map(t => <TarefaRow key={t.id} {...rowProps(t)} />)}
                </div>
              ))}


              {/* Concluídos */}
              {concluidos.length > 0 && (
                <div className="mt-5">
                  <button onClick={() => setShowConcluidos(v => !v)}
                    className="flex items-center gap-2 text-text-3 hover:text-text-2 transition text-sm font-medium mb-2">
                    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 transition-transform ${showConcluidos ? '' : '-rotate-90'}`}>
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                    Concluído <span className="text-xs">{concluidos.length}</span>
                  </button>
                  {showConcluidos && concluidos.map(t => <TarefaRow key={t.id} {...rowProps(t)} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modal Nova/Editar Lista ────────────────────────────── */}
      {listModal && (
        <ListModal modo={listModal.modo} grupoInicial={listModal.grupo}
          onSave={saveGrupo} onClose={() => setListModal(null)} />
      )}

      {/* ── Modal Gerenciar Etiquetas ──────────────────────────── */}
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

      {/* ── Undo toast ─────────────────────────────────────────── */}
      {undo && (
        <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50"
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

// ── Modal Nova/Editar Lista ──────────────────────────────────────
function ListModal({ modo, grupoInicial, onSave, onClose }) {
  const [nome,      setNome]      = useState(grupoInicial?.nome || '');
  const [emoji,     setEmoji]     = useState(grupoInicial?.emoji || '📋');
  const [cor,       setCor]       = useState(grupoInicial?.cor  || CORES_LISTA[0]);
  const [emojiTab,  setEmojiTab]  = useState(Object.keys(EMOJIS)[0]);
  const [showEmoji, setShowEmoji] = useState(false);

  const submit = () => {
    if (!nome.trim()) return;
    onSave({ nome: nome.trim(), emoji, cor }, modo === 'edit' ? grupoInicial.id : null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}>
      <div className="rounded-2xl w-[360px] flex flex-col overflow-hidden"
        style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'rgba(34,197,94,0.12)' }}>
          <h3 className="text-text-1 font-bold">{modo === 'edit' ? 'Editar lista' : 'Adicionar lista'}</h3>
          <button onClick={onClose} className="text-text-3 hover:text-text-1 transition text-xl w-6 h-6 flex items-center justify-center">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowEmoji(v => !v)}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl transition hover:bg-white/5"
                style={{ background: cor + '22', border: `1px solid ${cor}44` }}>
                {emoji}
              </button>
              {showEmoji && (
                <div className="absolute top-12 left-0 z-10 rounded-2xl overflow-hidden w-72"
                  style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
                  <div className="flex border-b overflow-x-auto" style={{ borderColor: 'rgba(34,197,94,0.12)' }}>
                    {Object.keys(EMOJIS).map(cat => (
                      <button key={cat} onClick={() => setEmojiTab(cat)}
                        className={`px-3 py-2 text-xs whitespace-nowrap transition flex-shrink-0 ${emojiTab === cat ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-2'}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-10 gap-0 p-2 max-h-36 overflow-y-auto">
                    {EMOJIS[emojiTab].map(em => (
                      <button key={em} onClick={() => { setEmoji(em); setShowEmoji(false); }}
                        className="w-7 h-7 flex items-center justify-center text-base rounded hover:bg-white/10 transition">
                        {em}
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

          <div className="rounded-xl p-3 flex items-center gap-2"
            style={{ background: cor + '11', border: `1px solid ${cor}33` }}>
            <span className="text-lg">{emoji}</span>
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

// ── Adicionar Tarefa ─────────────────────────────────────────────
function AdicionarTarefa({ secaoId, adicionando, setAdicionando, novaTexto, setNovaTexto, novaTags, setNovaTags, etiquetas, addTarefa, inputRef }) {
  const key    = secaoId ? 's_' + secaoId : 'root';
  const isOpen = adicionando === key;
  const close  = () => { setAdicionando(null); setNovaTexto(''); setNovaTags([]); };

  if (!isOpen) {
    return (
      <button onClick={() => setAdicionando(key)}
        className="flex items-center gap-2 py-2 text-text-3 hover:text-accent transition w-full text-left group mb-1"
        style={{ borderBottom: secaoId ? 'none' : '1px solid rgba(34,197,94,0.08)' }}>
        <span className="text-base leading-none group-hover:scale-110 transition-transform">+</span>
        <span className="text-xs">Adicionar tarefa</span>
      </button>
    );
  }

  return (
    <div className="mb-2 rounded-xl p-3"
      style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-4 h-4 rounded border flex-shrink-0" style={{ borderColor: 'rgba(34,197,94,0.3)' }} />
        <input
          ref={secaoId === null ? inputRef : undefined}
          autoFocus={secaoId !== null}
          value={novaTexto}
          onChange={e => setNovaTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTarefa(secaoId); if (e.key === 'Escape') close(); }}
          placeholder="Nome da tarefa..."
          className="flex-1 bg-transparent text-text-1 text-sm outline-none placeholder:text-text-3" />
      </div>
      <div className="flex flex-wrap gap-1 pl-7">
        {etiquetas.map(e => (
          <button key={e.id}
            onMouseDown={ev => { ev.preventDefault(); setNovaTags(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id]); }}
            className="text-[10px] px-2 py-0.5 rounded-full transition font-medium"
            style={novaTags.includes(e.id) ? { background: e.cor, color: '#fff' } : { background: e.cor + '22', color: e.cor }}>
            {e.nome}
          </button>
        ))}
        <button onMouseDown={ev => { ev.preventDefault(); addTarefa(secaoId); }}
          className="text-[10px] px-2 py-0.5 rounded-full font-semibold ml-auto"
          style={{ background: '#22c55e', color: '#0f172a' }}>↵ Salvar</button>
        <button onMouseDown={ev => { ev.preventDefault(); close(); }}
          className="text-[10px] px-2 py-0.5 text-text-3 hover:text-text-2 transition">Esc</button>
      </div>
    </div>
  );
}

// ── Linha de tarefa ──────────────────────────────────────────────
function TarefaRow({ tarefa, etiquetas, editId, editTexto, editTags, setEditId, setEditTexto, setEditTags, onToggle, onRemove, onSaveEdit, onToggleTag, tagPickerOpen, onTagPickerToggle }) {
  const isEdit   = editId === tarefa.id;
  const startEdit = () => { setEditId(tarefa.id); setEditTexto(tarefa.texto); setEditTags(tarefa.etiquetas || []); };

  return (
    <div className="group" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex items-start gap-3 py-2.5">
        <button onClick={() => onToggle(tarefa.id)}
          className="flex-shrink-0 w-4 h-4 rounded border transition-all flex items-center justify-center mt-0.5"
          style={tarefa.concluido
            ? { background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderColor: 'transparent' }
            : { borderColor: 'rgba(34,197,94,0.4)', background: 'transparent' }}>
          {tarefa.concluido && (
            <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
              <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {isEdit ? (
            <div>
              <input autoFocus value={editTexto} onChange={e => setEditTexto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(tarefa.id); if (e.key === 'Escape') setEditId(null); }}
                onBlur={() => onSaveEdit(tarefa.id)}
                className="bg-transparent text-text-1 text-sm outline-none w-full border-b mb-2 pb-1"
                style={{ borderColor: 'rgba(34,197,94,0.4)' }} />
              <div className="flex flex-wrap gap-1">
                {etiquetas.map(e => (
                  <button key={e.id}
                    onMouseDown={ev => { ev.preventDefault(); setEditTags(prev => prev.includes(e.id) ? prev.filter(x => x !== e.id) : [...prev, e.id]); }}
                    className="text-[10px] px-2 py-0.5 rounded-full transition font-medium"
                    style={editTags.includes(e.id) ? { background: e.cor, color: '#fff' } : { background: e.cor + '22', color: e.cor }}>
                    {e.nome}
                  </button>
                ))}
                <button onMouseDown={e => { e.preventDefault(); onSaveEdit(tarefa.id); }}
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold ml-auto"
                  style={{ background: '#22c55e', color: '#0f172a' }}>✓ Ok</button>
              </div>
            </div>
          ) : (
            <>
              <p onDoubleClick={startEdit} style={{ cursor: 'text' }}
                className={`text-sm leading-snug select-none ${tarefa.concluido ? 'text-text-3 line-through' : 'text-text-1'}`}>
                {tarefa.texto}
              </p>
              {(tarefa.etiquetas || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(tarefa.etiquetas || []).map(etiqId => {
                    const e = etiquetas.find(x => x.id === etiqId);
                    return e ? (
                      <span key={e.id} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: e.cor + '22', color: e.cor }}>{e.nome}</span>
                    ) : null;
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {!isEdit && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0 pt-0.5">
            <button onClick={onTagPickerToggle} title="Etiquetas"
              className={`w-6 h-6 rounded flex items-center justify-center transition text-xs ${tagPickerOpen ? 'text-accent' : 'text-text-3 hover:text-accent hover:bg-white/5'}`}>
              🏷
            </button>
            <button onClick={startEdit} title="Editar"
              className="w-6 h-6 rounded flex items-center justify-center text-text-3 hover:text-accent hover:bg-white/5 transition">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
              </svg>
            </button>
            <button onClick={() => onRemove(tarefa.id)} title="Excluir"
              className="w-6 h-6 rounded flex items-center justify-center text-text-3 hover:text-expense hover:bg-white/5 transition">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {tagPickerOpen && !isEdit && (
        <div className="flex flex-wrap items-center gap-1 pb-2.5 pl-7">
          {etiquetas.map(e => (
            <button key={e.id} onClick={() => onToggleTag(e.id)}
              className="text-[10px] px-2 py-0.5 rounded-full transition font-medium"
              style={(tarefa.etiquetas || []).includes(e.id)
                ? { background: e.cor, color: '#fff' }
                : { background: e.cor + '22', color: e.cor }}>
              {e.nome}
            </button>
          ))}
          <button onClick={onTagPickerToggle} className="text-[10px] text-text-3 hover:text-text-2 px-1 ml-1">✕</button>
        </div>
      )}
    </div>
  );
}
