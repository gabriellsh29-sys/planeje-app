import React, { useRef, useState, useEffect } from 'react';

const SIZE = 280;
const OUTPUT = 320;

export default function AvatarCropModal({ src, onCancel, onConfirm }) {
  const imgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [base, setBase] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const onLoad = () => {
      const b = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
      setBase(b);
      setPos({
        x: (SIZE - img.naturalWidth * b) / 2,
        y: (SIZE - img.naturalHeight * b) / 2,
      });
      setZoom(1);
    };
    if (img.complete && img.naturalWidth) onLoad();
    else img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [src]);

  const scale = base * zoom;

  const clamp = (p, z) => {
    const img = imgRef.current;
    if (!img) return p;
    const s = base * z;
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    const minX = Math.min(0, SIZE - w);
    const minY = Math.min(0, SIZE - h);
    return {
      x: Math.min(0, Math.max(minX, p.x)),
      y: Math.min(0, Math.max(minY, p.y)),
    };
  };

  const onPointerDown = (e) => {
    drag.current = { startX: e.clientX, startY: e.clientY, origin: { ...pos } };
    e.target.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setPos(clamp({ x: drag.current.origin.x + dx, y: drag.current.origin.y + dy }, zoom));
  };
  const onPointerUp = () => { drag.current = null; };

  const onZoomChange = (e) => {
    const z = parseFloat(e.target.value);
    setPos(p => clamp(p, z));
    setZoom(z);
  };

  const confirmar = () => {
    const img = imgRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    const out = OUTPUT / SIZE;
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const sSize = SIZE / scale;
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(blob => onConfirm(blob), 'image/jpeg', 0.9);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="rounded-2xl p-5 w-[340px] flex flex-col items-center gap-4"
        style={{ background: '#0f172a', border: '1px solid rgba(34,197,94,0.25)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
        <h3 className="text-text-1 font-bold text-base self-start">Ajustar foto</h3>

        <div
          className="relative overflow-hidden rounded-full touch-none select-none cursor-grab"
          style={{ width: SIZE, height: SIZE, border: '2px solid rgba(34,197,94,0.4)' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}>
          <img ref={imgRef} src={src} alt="Pré-visualização"
            draggable={false}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: imgRef.current ? imgRef.current.naturalWidth * scale : 'auto',
              height: imgRef.current ? imgRef.current.naturalHeight * scale : 'auto',
              maxWidth: 'none',
            }} />
        </div>

        <div className="w-full flex items-center gap-3">
          <span className="text-text-3 text-xs">−</span>
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={onZoomChange} className="flex-1" />
          <span className="text-text-3 text-xs">+</span>
        </div>

        <div className="flex gap-3 w-full">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm text-text-2 hover:bg-white/5 transition border"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            Cancelar
          </button>
          <button onClick={confirmar} className="btn-gold flex-1 py-2.5 rounded-xl text-sm font-semibold">
            Salvar foto
          </button>
        </div>
      </div>
    </div>
  );
}
