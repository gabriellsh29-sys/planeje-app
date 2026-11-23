import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { ordenarAZ, filtrarOpcoes } from '../lib/categorias';

const MARGIN = 8;
const MAX_H  = 320;   // altura máxima do painel inteiro (campo de busca + lista)
const MIN_H  = 150;

// Área realmente visível: com o teclado do celular aberto ela é menor que window.innerHeight.
function areaVisivel() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  return vv ? { topo: vv.offsetTop, base: vv.offsetTop + vv.height } : { topo: 0, base: window.innerHeight };
}

// Lista suspensa com busca: ao abrir (ou ao começar a digitar no campo fechado) o texto digitado
// filtra as opções, sem distinguir acento ou maiúscula. Setas navegam, Enter escolhe, Esc fecha.
// As opções sempre aparecem em ordem alfabética (A–Z), a menos que ordenar={false}.
// onCreate (opcional): quando nada do que foi digitado existe, oferece criar essa opção.
export default function SelectDown({
  value, onChange, options, className, style,
  placeholder = 'Selecione...', ordenar = true, onCreate, rotuloBusca = 'Buscar...', semResultado = 'Nada encontrado',
}) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [ativo, setAtivo]   = useState(0);
  const [pos, setPos]       = useState({ top: 0, left: 0, width: 0, maxHeight: MAX_H, dropUp: false });
  const triggerRef  = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef    = useRef(null);
  const focarBusca  = useRef(false);
  const uid         = useId();
  const listaId     = `${uid}-lista`;
  const opId        = (i) => `${uid}-op-${i}`;

  const todas = useMemo(() => (ordenar ? ordenarAZ(options) : options), [options, ordenar]);
  const lista = useMemo(() => filtrarOpcoes(todas, query), [todas, query]);
  // "Criar" só aparece quando NADA bate com o texto: com resultados na tela ele seria ruído e
  // um toque acidental criaria uma categoria lixo.
  const podeCriar = !!onCreate && query.trim() !== '' && lista.length === 0;
  const total = lista.length + (podeCriar ? 1 : 0);
  const toque = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  const reposition = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const v = areaVisivel();
    const abaixo = v.base - r.bottom - MARGIN;
    const acima  = r.top - v.topo - MARGIN;
    const dropUp = abaixo < 230 && acima > abaixo;
    const maxHeight = Math.min(MAX_H, Math.max(MIN_H, dropUp ? acima : abaixo));
    setPos({
      top: dropUp ? undefined : r.bottom + 4,
      bottom: dropUp ? window.innerHeight - r.top + 4 : undefined,
      left: r.left, width: r.width, maxHeight, dropUp,
    });
  };

  // viaTeclado: quem usa teclado quer digitar já. No toque o campo não rouba o foco, para o
  // teclado do celular não cobrir a lista antes de a pessoa escolher tocar nele.
  const abrir = (textoInicial = '', viaTeclado = false) => {
    reposition();
    setQuery(textoInicial);
    const atual = todas.indexOf(value);
    setAtivo(textoInicial ? 0 : Math.max(atual, 0));
    focarBusca.current = viaTeclado || !toque;
    setOpen(true);
  };

  const fechar = (devolverFoco = false) => {
    setOpen(false);
    setQuery('');
    if (devolverFoco) triggerRef.current?.focus();
  };

  const escolher = (valor) => { onChange(valor); fechar(true); };
  const criar = () => { onCreate(query.trim()); fechar(true); };
  const confirmarAtivo = () => {
    if (ativo < lista.length) escolher(lista[ativo].valor);
    else if (podeCriar) criar();
  };

  useEffect(() => {
    if (open && focarBusca.current) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(opId(ativo))?.scrollIntoView({ block: 'nearest' });
  }, [ativo, open]);

  useEffect(() => {
    if (!open) return;
    const onScrollResize = (e) => {
      if (e?.target && dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      reposition();
    };
    window.addEventListener('resize', onScrollResize);
    window.addEventListener('scroll', onScrollResize, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onScrollResize);
    vv?.addEventListener('scroll', onScrollResize);
    return () => {
      window.removeEventListener('resize', onScrollResize);
      window.removeEventListener('scroll', onScrollResize, true);
      vv?.removeEventListener('resize', onScrollResize);
      vv?.removeEventListener('scroll', onScrollResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      const inTrigger  = triggerRef.current  && triggerRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inTrigger && !inDropdown) fechar(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const onKeyDownTrigger = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) abrir('', true);
    } else if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault();
      if (!open) abrir(e.key, true);
      else { setQuery(q => q + e.key); setAtivo(0); inputRef.current?.focus(); }
    }
  };

  const onKeyDownBusca = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo(a => Math.min(a + 1, Math.max(total - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); confirmarAtivo(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); }
    else if (e.key === 'Tab') fechar(false);
  };

  const destacar = ({ valor, de, ate }) => {
    if (de < 0) return valor;
    return (
      <>
        {valor.slice(0, de)}
        <span style={{ color: '#ffffff', fontWeight: 700 }}>{valor.slice(de, ate)}</span>
        {valor.slice(ate)}
      </>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? fechar(false) : abrir('', false))}
        onKeyDown={onKeyDownTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={className}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', ...style }}
      >
        <span style={value ? undefined : { opacity: 0.5 }}>{value || placeholder}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '0.75rem',
            maxHeight: pos.maxHeight,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}>
          <div style={{ padding: 8, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setAtivo(0); }}
              onKeyDown={onKeyDownBusca}
              placeholder={rotuloBusca}
              role="combobox"
              aria-expanded="true"
              aria-controls={listaId}
              aria-activedescendant={total > 0 ? opId(ativo) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '0.5rem', color: '#f1f5f9', outline: 'none',
                fontSize: toque ? '16px' : '0.875rem', fontFamily: 'Poppins, system-ui, sans-serif',
              }}
            />
          </div>
          <div id={listaId} role="listbox" style={{ overflowY: 'auto', flex: 1, minHeight: 0, overscrollBehavior: 'contain' }}>
            {lista.map((item, i) => {
              const marcada = item.valor === value;
              const emFoco = i === ativo;
              return (
                <button
                  key={item.valor}
                  id={opId(i)}
                  type="button"
                  role="option"
                  aria-selected={marcada}
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => escolher(item.valor)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 16px',
                    color: marcada ? '#22c55e' : '#cbd5e1',
                    background: emFoco ? 'rgba(255,255,255,0.07)' : marcada ? 'rgba(34,197,94,0.08)' : 'transparent',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    fontFamily: 'Poppins, system-ui, sans-serif',
                  }}
                >
                  {destacar(item)}
                </button>
              );
            })}
            {podeCriar && (
              <button
                id={opId(lista.length)}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setAtivo(lista.length)}
                onClick={criar}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', border: 'none',
                  color: '#22c55e', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                  background: ativo === lista.length ? 'rgba(34,197,94,0.1)' : 'transparent',
                  fontFamily: 'Poppins, system-ui, sans-serif',
                }}
              >
                + Criar "{query.trim()}"
              </button>
            )}
            {total === 0 && (
              <div style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '0.8125rem', fontFamily: 'Poppins, system-ui, sans-serif' }}>
                {semResultado}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
