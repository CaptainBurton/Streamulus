import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// Admin › Profile Pictures: categories (e.g. "The Simpsons") of pictures that
// profiles can choose from on the web and the iPhone / iPad app. Each category
// and each picture says who it's for: Streamers (grown-up profiles), Streamlings,
// or both — a picture is offered when both its category and the picture allow it.
export const AUDIENCES = [
  { value: 'all', label: 'Streamers & Streamlings', short: 'Both' },
  { value: 'adults', label: 'Streamers only', short: 'Streamers' },
  { value: 'kids', label: 'Streamlings only', short: 'Streamlings' },
];
const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
// Nobody sees a picture whose audience contradicts its category's.
const hiddenBy = (category, image) =>
  category.audience !== 'all' && image.audience !== 'all' && category.audience !== image.audience;

export default function AvatarLibraryAdmin({ flash }) {
  const [categories, setCategories] = useState(null);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState('all');
  const [busy, setBusy] = useState(false);

  const load = () => axios.get('/api/admin/avatars')
    .then(r => setCategories(r.data.categories || []))
    .catch(() => { setCategories([]); flash('Failed to load profile pictures', true); });

  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post('/api/admin/avatars/categories', { name, audience });
      flash(`Category "${name.trim()}" added — now add some pictures to it`);
      setName(''); setAudience('all');
      await load();
    } catch (err) { flash(err.response?.data?.error || "Couldn't add the category", true); }
    setBusy(false);
  };

  const total = (categories || []).reduce((n, c) => n + c.images.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={S.card}>
        <h3 style={S.h3}>Profile Pictures</h3>
        <p style={S.intro}>
          Pictures that profiles can choose from in Profile &amp; Account on the web and in the iPhone / iPad app —
          the only way Streamlings can change their picture. Group them into categories and choose who each category
          and picture is for. Profiles keep a picture they've chosen even if you remove it here.
        </p>
        <form onSubmit={add} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input style={{ ...S.input, flex: '1 1 220px' }} placeholder="New category, e.g. The Simpsons" value={name}
            maxLength={40} onChange={e => setName(e.target.value)} aria-label="Category name" />
          <AudienceSelect value={audience} onChange={setAudience} label="Who the new category is for" />
          <button type="submit" disabled={busy || !name.trim()} style={{ ...S.primary, opacity: busy || !name.trim() ? 0.5 : 1 }}>+ Add Category</button>
        </form>
        {categories && (
          <div style={{ color: '#666', fontSize: '12px', marginTop: '14px' }}>
            {plural(categories.length, 'category', 'categories')} · {plural(total, 'picture')}
          </div>
        )}
      </div>

      {categories === null && <div style={{ color: '#666', fontSize: '14px' }}>Loading…</div>}
      {categories?.length === 0 && (
        <div style={{ ...S.card, textAlign: 'center', color: '#777', fontSize: '14px' }}>No categories yet. Add one above, then upload pictures into it.</div>
      )}
      {(categories || []).map(c => (
        <CategoryCard key={c.id} category={c} reload={load} flash={flash} />
      ))}
    </div>
  );
}

function CategoryCard({ category, reload, flash }) {
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => setName(category.name), [category.name]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); await reload(); if (ok) flash(ok); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy(false);
  };

  const upload = (files) => {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of files) form.append('images', f);
    run(async () => {
      const r = await axios.post(`/api/admin/avatars/categories/${category.id}/images`, form);
      const skipped = r.data.skipped?.length ? ` (${plural(r.data.skipped.length, 'file')} skipped — not a picture)` : '';
      flash(`Added ${plural(r.data.added.length, 'picture')} to ${category.name}${skipped}`);
    });
  };

  const remove = () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return; }
    run(() => axios.delete(`/api/admin/avatars/categories/${category.id}`), `Removed ${category.name}`);
  };

  return (
    <div style={S.card} data-category={category.name}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
        <input style={{ ...S.input, flex: '1 1 200px', fontWeight: 700, fontSize: '15px' }} value={name} maxLength={40}
          onChange={e => setName(e.target.value)} aria-label="Category name" />
        {name.trim() && name.trim() !== category.name && (
          <button style={S.secondary} disabled={busy}
            onClick={() => run(() => axios.put(`/api/admin/avatars/categories/${category.id}`, { name }), 'Category renamed')}>Save name</button>
        )}
        <AudienceSelect value={category.audience} label={`Who ${category.name} is for`}
          onChange={v => run(() => axios.put(`/api/admin/avatars/categories/${category.id}`, { audience: v }), `${category.name}: ${AUDIENCES.find(a => a.value === v).label}`)} />
      </div>

      <div style={S.grid}>
        {category.images.map(image => (
          <ImageTile key={image.id} category={category} image={image} reload={reload} flash={flash} />
        ))}
        <button style={S.addTile} disabled={busy} onClick={() => { fileRef.current.value = ''; fileRef.current.click(); }}>
          <span style={{ fontSize: '26px', lineHeight: 1 }}>+</span>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{busy ? 'Working…' : 'Add pictures'}</span>
        </button>
        <input ref={fileRef} type="file" accept={IMAGE_TYPES} multiple style={{ display: 'none' }} onChange={e => upload(e.target.files)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
        <span style={{ color: '#666', fontSize: '12px' }}>{plural(category.images.length, 'picture')} · PNG, JPG, WebP or GIF, up to 8 MB each; square works best</span>
        <button style={S.danger} disabled={busy} onClick={remove}>
          {confirmDelete ? `Click again to remove ${category.name} and its pictures` : 'Remove category'}
        </button>
      </div>
    </div>
  );
}

function ImageTile({ category, image, reload, flash }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); await reload(); if (ok) flash(ok); } catch (err) { flash(err.response?.data?.error || 'Something went wrong', true); }
    setBusy(false);
  };
  const hidden = hiddenBy(category, image);
  return (
    <div style={{ ...S.tile, opacity: busy ? 0.5 : 1 }}>
      <div style={{ position: 'relative' }}>
        <img src={image.url} alt="" style={{ ...S.img, filter: hidden ? 'grayscale(1)' : 'none', opacity: hidden ? 0.5 : 1 }} loading="lazy" />
        <button title="Remove this picture" aria-label="Remove this picture" style={S.remove} disabled={busy}
          onClick={() => run(() => axios.delete(`/api/admin/avatars/images/${image.id}`), 'Picture removed')}>✕</button>
      </div>
      <AudienceSelect small value={image.audience} label="Who this picture is for"
        onChange={v => run(() => axios.put(`/api/admin/avatars/images/${image.id}`, { audience: v }))} />
      {hidden
        ? <span style={{ fontSize: '10px', color: '#ffb703', textAlign: 'center' }}>Hidden — the category is {category.audience === 'kids' ? 'Streamlings' : 'Streamers'} only</span>
        : image.usedBy > 0 && <span style={{ fontSize: '10px', color: '#777' }}>Used by {plural(image.usedBy, 'profile')}</span>}
    </div>
  );
}

function AudienceSelect({ value, onChange, label, small }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}
      style={small ? S.smallSelect : S.select}>
      {AUDIENCES.map(a => <option key={a.value} value={a.value}>{small ? a.short : a.label}</option>)}
    </select>
  );
}

const S = {
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px' },
  h3: { fontSize: '16px', fontWeight: 700, marginBottom: '6px' },
  intro: { color: '#777', fontSize: '13px', lineHeight: 1.6, marginBottom: '18px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', minWidth: 0, fontFamily: 'inherit' },
  select: { padding: '10px 12px', background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#ddd', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  smallSelect: { width: '100%', padding: '4px 4px', background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#bbb', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  primary: { padding: '10px 18px', background: '#00c2ff', color: '#000', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  secondary: { padding: '9px 14px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  danger: { padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,68,68,0.3)', color: '#ff6b6b', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: '16px' },
  tile: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', transition: 'opacity 0.2s' },
  img: { width: '96px', height: '96px', objectFit: 'cover', borderRadius: '50%', display: 'block', background: 'rgba(255,255,255,0.06)' },
  remove: { position: 'absolute', top: '-2px', right: '-2px', width: '26px', height: '26px', borderRadius: '50%', border: '2px solid #151515', background: '#ff4444', color: '#fff', fontSize: '11px', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  addTile: { width: '96px', height: '96px', justifySelf: 'center', borderRadius: '50%', border: '2px dashed rgba(255,255,255,0.2)', background: 'transparent', color: '#aaa', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', fontFamily: 'inherit' },
};
