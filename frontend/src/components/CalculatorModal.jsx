import React, { useState, useEffect } from 'react';

const KEYS = [
  ['C', '%', '⌫', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['00', '0', ',', '='],
];

// Parser matemático sem eval/Function — compatível com CSP restrita.
// Suporta +, -, *, / e % (% vira /100) com precedência correta (* / antes de + -).
function evaluate(expr) {
  if (!expr) return 0;
  const s = expr
    .replace(/,/g, '.')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/%/g, '/100');

  const nums = [];
  const ops  = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue; }
    if (/[0-9.]/.test(s[i])) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      const v = parseFloat(num);
      if (!isFinite(v)) return 0;
      nums.push(v);
    } else if (['+', '-', '*', '/'].includes(s[i])) {
      ops.push(s[i++]);
    } else {
      i++;
    }
  }
  if (!nums.length) return 0;

  // 1ª passagem: * e / (maior precedência)
  const n = [...nums];
  const o = [...ops];
  let j = 0;
  while (j < o.length) {
    if (o[j] === '*' || o[j] === '/') {
      const r = o[j] === '*' ? n[j] * n[j+1] : (n[j+1] !== 0 ? n[j] / n[j+1] : 0);
      n.splice(j, 2, r);
      o.splice(j, 1);
    } else { j++; }
  }

  // 2ª passagem: + e -
  let result = n[0] ?? 0;
  for (let k = 0; k < o.length; k++) {
    if (o[k] === '+') result += n[k+1];
    else if (o[k] === '-') result -= n[k+1];
  }
  return isFinite(result) ? result : 0;
}

export default function CalculatorModal({ initialValue, onClose, onConfirm }) {
  const [expr, setExpr] = useState(initialValue ? String(initialValue).replace('.', ',') : '');

  const press = (k) => {
    if (k === 'C') { setExpr(''); return; }
    if (k === '⌫') { setExpr(e => e.slice(0, -1)); return; }
    if (k === '=') {
      const result = Math.round(evaluate(expr) * 100) / 100;
      onConfirm(Math.max(0, result));
      return;
    }
    if (k === ',') {
      const lastSegment = expr.split(/[+\-×÷]/).pop();
      if (lastSegment.includes(',')) return;
      if (!lastSegment) { setExpr(e => e + '0,'); return; }
    }
    setExpr(e => e + k);
  };

  useEffect(() => {
    const handler = (e) => {
      const map = { '*': '×', '/': '÷', '.': ',', 'Enter': '=', '=': '=', 'Backspace': '⌫', 'Delete': 'C', 'Escape': null };
      let key = e.key;
      if (key === 'Escape') { onClose(); return; }
      if (map[key] !== undefined) key = map[key];
      if (key === null) return;
      if (/^[0-9]$/.test(key) || ['+','-','×','÷','%',',','C','⌫','='].includes(key)) {
        e.preventDefault();
        press(key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expr]);

  const hasOp = /[+\-×÷%]/.test(expr);
  const evaluable = expr.replace(/[+\-×÷%,]+$/, '');
  const hasOpEvaluable = /[+\-×÷%]/.test(evaluable);
  const preview = hasOp && hasOpEvaluable ? evaluate(evaluable) : null;

  const exprFontSize = expr.length > 18 ? 16 : expr.length > 12 ? 22 : 28;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
      <div
        className="relative w-full max-w-xs rounded-t-[1.75rem] md:rounded-[1.5rem] shadow-2xl animate-scale-in overflow-hidden p-4"
        style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="md:hidden flex justify-center pb-2">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        </div>

        <div className="flex items-center justify-between mb-2">
          <p className="text-white font-semibold text-sm">Calculadora</p>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-lg text-text-3 hover:text-text-1 hover:bg-white/5 transition">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
        </div>

        <div className="rounded-xl px-4 py-4 mb-3 text-right"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-text-3 text-xs h-4 truncate">
            {preview !== null ? `= ${preview.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ' '}
          </p>
          <p className="text-white font-bold break-all leading-snug" style={{ fontSize: exprFontSize }}>{expr || '0'}</p>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {KEYS.flat().map((k, i) => {
            const isOp = ['÷', '×', '-', '+'].includes(k);
            const isEq = k === '=';
            const isClear = k === 'C' || k === '⌫' || k === '%';
            return (
              <button
                key={i}
                type="button"
                onClick={() => press(k)}
                className="rounded-2xl py-4 text-lg font-semibold transition-all active:scale-95"
                style={
                  isEq
                    ? { background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#fff', boxShadow: '0 4px 16px rgba(34,197,94,0.3)' }
                    : isOp
                    ? { background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }
                    : isClear
                    ? { background: 'rgba(244,63,94,0.08)', color: '#f43f5e' }
                    : { background: 'rgba(255,255,255,0.04)', color: '#fff', border: '1px solid rgba(255,255,255,0.06)' }
                }
              >
                {k === '=' ? '✓' : k}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
