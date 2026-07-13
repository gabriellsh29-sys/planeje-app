import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function SelectDown({ value, onChange, options, className, style }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={className}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', ...style }}
      >
        <span>{value}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && createPortal(
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 9999,
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0.75rem',
          maxHeight: 220,
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 16px',
                color: opt === value ? '#22c55e' : '#f1f5f9',
                background: opt === value ? 'rgba(34,197,94,0.08)' : 'transparent',
                fontSize: '0.875rem',
                cursor: 'pointer',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontFamily: 'Poppins, system-ui, sans-serif',
              }}
            >
              {opt}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
