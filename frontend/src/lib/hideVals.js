import { useState, useEffect } from 'react';

const KEY = 'planeje_hide_vals';
let _h = localStorage.getItem(KEY) === '1';
const subs = new Set();

function sync() {
  localStorage.setItem(KEY, _h ? '1' : '0');
  document.body.classList.toggle('hide-vals', _h);
  subs.forEach(fn => fn(_h));
}

export function toggleHide() { _h = !_h; sync(); }
export function getHidden()  { return _h; }

export function useHideVals() {
  const [h, setH] = useState(_h);
  useEffect(() => { subs.add(setH); return () => subs.delete(setH); }, []);
  return h;
}

// Aplica na carga inicial
document.body.classList.toggle('hide-vals', _h);
