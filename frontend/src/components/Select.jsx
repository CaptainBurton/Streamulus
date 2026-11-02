import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A drop-in for <select> in the app's own style — the same dark menu as the
// Requests filters — instead of the browser's (which looks different on every
// system). Use it exactly like <select>: <option> children (plain or inside
// fragments / conditionals), value, onChange(e => e.target.value), disabled,
// id, style, aria-label, data-*. The menu opens below (or above, near the
// bottom of the window) and follows its field if the page scrolls; it scrolls
// to the chosen option, and takes ↑/↓, Home/End, Enter, Esc and typing the
// first letters of an option.

const flat = (children, out = []) => {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) { flat(child.props.children, out); return; }
    if (child.type === 'option') {
      const text = React.Children.toArray(child.props.children).join('');
      out.push({ value: child.props.value !== undefined ? String(child.props.value) : text, label: text, disabled: !!child.props.disabled });
    }
  });
  return out;
};

export default function Select({ value, onChange, children, style, disabled = false, id, className, ...rest }) {
  const options = flat(children);
  const current = String(value ?? '');
  const chosen = options.find(o => o.value === current) || options[0];
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [place, setPlace] = useState(null); // where the menu goes: { left, top|bottom, width, maxHeight }
  const button = useRef(null);
  const menu = useRef(null);
  const typed = useRef({ text: '', at: 0 });

  const pick = (o) => {
    if (!o || o.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (o.value !== current) onChange?.({ target: { value: o.value, type: 'select-one', id, name: rest.name }, currentTarget: { value: o.value } });
  };

  // Where the menu fits: below the field, or above it when there's more room there.
  const measure = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    // As wide as the widest option (at least the field); lined up with the field's
    // right edge when there isn't room to the right of it.
    const room = Math.min(460, window.innerWidth - 16);
    const side = r.left + room > window.innerWidth - 8 ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) };
    setPlace({ ...side, minWidth: Math.min(Math.max(r.width, 160), room), maxWidth: room, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), maxHeight: Math.min(320, up ? above : below) });
  };
  useLayoutEffect(() => { if (open) measure(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const at = Math.max(0, options.findIndex(o => o.value === current));
    setFocus(at);
    requestAnimationFrame(() => menu.current?.children[at]?.scrollIntoView({ block: 'nearest' }));
    const away = (e) => { if (!button.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    // The page scrolled: the menu follows its field, and closes once the field is off screen.
    const moved = (e) => {
      if (menu.current?.contains(e.target)) return;
      const r = button.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false); else measure();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) menu.current?.children[focus]?.scrollIntoView({ block: 'nearest' }); }, [focus, open]);

  const step = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
    return from;
  };
  const onKey = (e) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(f => step(f, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(f => step(f, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setFocus(step(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setFocus(step(options.length, -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[focus]); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type the start of an option to jump to it.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setFocus(hit);
    }
  };

  const { width, minWidth, maxWidth, flex, margin, marginTop, marginLeft, ...look } = style || {};
  return (
    <>
      <button
        type="button" ref={button} id={id} className={`app-select${className ? ` ${className}` : ''}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} data-value={current} {...rest}
        onClick={() => !disabled && setOpen(o => !o)} onKeyDown={onKey}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', textAlign: 'left',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff',
          fontSize: '13px', padding: '8px 12px', fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none',
          boxSizing: 'border-box', opacity: disabled ? 0.55 : 1,
          ...look,
          width, minWidth, maxWidth, flex, margin, marginTop, marginLeft,
          ...(open ? { borderColor: 'rgba(0,194,255,0.6)' } : {}),
        }}>
        {/* Sized like a <select>: as wide as its longest option (every label stacked
            invisibly in one grid cell), shrinking with an ellipsis if it must. */}
        <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, max-content)', minWidth: 0, flex: '0 1 auto' }}>
          <span style={{ gridArea: '1 / 1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chosen?.label ?? ''}</span>
          {options.map((o, i) => (
            <span key={i} aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden', height: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{o.label}</span>
          ))}
        </span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none', opacity: 0.7 }}>
          <path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && place && createPortal(
        <div role="listbox" ref={menu} aria-label={rest['aria-label'] || id} className="app-select-menu" onKeyDown={onKey}
          style={{
            position: 'fixed', zIndex: 5000, left: place.left, right: place.right, top: place.top, bottom: place.bottom,
            width: 'max-content', minWidth: place.minWidth, maxWidth: place.maxWidth,
            maxHeight: place.maxHeight, overflowY: 'auto', padding: '6px', background: '#1b1b21', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px', boxShadow: '0 18px 50px rgba(0,0,0,0.6)', animation: 'selectIn 0.12s ease-out', boxSizing: 'border-box',
          }}>
          {options.map((o, i) => {
            const selected = o.value === current;
            return (
              <div key={`${o.value}-${i}`} role="option" aria-selected={selected} aria-disabled={o.disabled || undefined} data-value={o.value}
                onMouseEnter={() => !o.disabled && setFocus(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 10px', borderRadius: '8px',
                  fontSize: '13.5px', cursor: o.disabled ? 'default' : 'pointer', opacity: o.disabled ? 0.4 : 1,
                  fontWeight: selected ? 700 : 500, color: selected ? '#00c2ff' : '#e6e6ea',
                  background: i === focus && !o.disabled ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                {selected && <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            );
          })}
          <style>{'@keyframes selectIn { from { opacity: 0; transform: translateY(-3px) } to { opacity: 1; transform: none } }'}</style>
        </div>,
        document.body,
      )}
      <style>{'.app-select:focus-visible { outline: 2px solid #00c2ff; outline-offset: 2px; } .app-select:hover:not(:disabled) { border-color: rgba(255,255,255,0.25) !important; }'}</style>
    </>
  );
}
