import React, { useEffect, useRef, useState } from 'react';

// A pill-shaped dropdown in the app's own style, instead of the browser's
// <select> (which looks different on every system). Click or Enter/Space/↓
// opens it; ↑/↓ move, Enter picks, Esc or a click outside closes.
//
// options: [{ value, label }] — value '' is the "any" choice.
export default function Dropdown({ value, onChange, options, label, ariaLabel, name, icon = null, width = 'auto', menuWidth = 220 }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const wrap = useRef(null);
  const list = useRef(null);
  const chosen = options.find(o => String(o.value) === String(value));
  const active = value !== '' && value != null;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);

  // Opening: start on the chosen option, scrolled into view.
  useEffect(() => {
    if (!open) return;
    const at = Math.max(0, options.findIndex(o => String(o.value) === String(value)));
    setFocus(at);
    requestAnimationFrame(() => list.current?.children[at]?.scrollIntoView({ block: 'nearest' }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) list.current?.children[focus]?.scrollIntoView({ block: 'nearest' });
  }, [focus, open]);

  const pick = (o) => { onChange(o.value); setOpen(false); };
  const onKey = (e) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(f => Math.min(options.length - 1, f + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(f => Math.max(0, f - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setFocus(0); }
    else if (e.key === 'End') { e.preventDefault(); setFocus(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[focus]) pick(options[focus]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={wrap} style={{ position: 'relative', width }} onKeyDown={onKey}>
      <button type="button" className="dd-button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} data-dropdown={name}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px', width: width === 'auto' ? 'auto' : '100%', justifyContent: 'space-between',
          padding: '7px 12px 7px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          background: active ? 'rgba(0,194,255,0.12)' : 'rgba(255,255,255,0.06)', color: active ? '#fff' : '#ddd',
          border: `1px solid ${active ? '#00c2ff' : open ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)'}`,
        }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
          {icon}
          {chosen && active ? chosen.label : label}
        </span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none', opacity: 0.7 }}>
          <path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} ref={list} className="dd-menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, width: menuWidth, maxWidth: 'calc(100vw - 32px)', maxHeight: '300px', overflowY: 'auto',
            padding: '6px', background: '#1b1b21', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px',
            boxShadow: '0 18px 50px rgba(0,0,0,0.6)', animation: 'ddIn 0.14s ease-out',
          }}>
          {options.map((o, i) => {
            const selected = String(o.value) === String(value);
            return (
              <div key={`${o.value}`} role="option" aria-selected={selected} data-value={o.value}
                onMouseEnter={() => setFocus(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 10px', borderRadius: '9px', cursor: 'pointer',
                  fontSize: '14px', fontWeight: selected ? 700 : 500, color: selected ? '#00c2ff' : '#e6e6ea',
                  background: i === focus ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}>
                <span>{o.label}</span>
                {selected && (
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </div>
            );
          })}
        </div>
      )}
      <style>{'@keyframes ddIn { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } } .dd-button:focus-visible { outline: 2px solid #00c2ff; outline-offset: 2px; }'}</style>
    </div>
  );
}
