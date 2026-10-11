import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import ProfileAvatar from './ProfileAvatar';
import BrandMark from './BrandMark';

const styles = {
  nav: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    padding: '0 24px',
    justifyContent: 'space-between',
    transition: 'background 0.3s',
  },
  navScrolled: {
    background: 'rgba(15,15,15,0.97)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  navTransparent: {
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
  },
  logo: {
    fontSize: '26px',
    fontWeight: '800',
    letterSpacing: '-0.5px',
    background: 'linear-gradient(135deg, #00c2ff, #7b2fff)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  links: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  link: {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#b3b3b3',
    transition: 'all 0.2s',
  },
  activeLink: {
    color: '#fff',
    background: 'rgba(255,255,255,0.08)',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  avatar: {
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #00c2ff, #7b2fff)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    position: 'relative',
  },
  dropdown: {
    position: 'absolute',
    top: '44px',
    right: 0,
    background: '#1e1e1e',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '8px',
    minWidth: '180px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#b3b3b3',
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  hamburger: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    width: '36px',
    height: '36px',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    padding: '4px',
    gap: '5px',
    borderRadius: '6px',
  },
  hamburgerSpan: {
    display: 'block',
    width: '22px',
    height: '2px',
    background: '#fff',
    borderRadius: '2px',
    transformOrigin: 'center',
    transition: 'transform 0.25s ease, opacity 0.25s ease',
  },
  mobileDropdown: {
    position: 'fixed',
    top: '60px',
    left: 0,
    right: 0,
    zIndex: 999,
    background: 'rgba(15,15,15,0.97)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    padding: '8px 0 12px',
  },
  mobileLinkItem: {
    display: 'block',
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#b3b3b3',
    transition: 'all 0.2s',
  },
  mobileLinkItemActive: {
    color: '#fff',
    background: 'rgba(255,255,255,0.06)',
  },
};

// Small counts shown as badges: for admins, account requests waiting for an Admin
// Passphrase and feedback with something new; for everyone, replies to their own
// feedback. Fetched at most once a minute across page changes; pages that change
// them report the new numbers straight away (noteAdminCounts / noteFeedbackRead).
function makeCounter(event, url, pick, initial) {
  let cache = { at: 0, value: initial };
  const note = (value) => {
    cache = { at: Date.now(), value: typeof value === 'object' ? { ...cache.value, ...value } : value };
    window.dispatchEvent(new CustomEvent(event, { detail: cache.value }));
  };
  function useCounter(enabled) {
    const [value, setValue] = useState(cache.value);
    useEffect(() => {
      if (!enabled) return undefined;
      const onChange = (e) => setValue(e.detail);
      window.addEventListener(event, onChange);
      if (Date.now() - cache.at > 60000) axios.get(url).then(r => note(pick(r.data))).catch(() => {});
      else setValue(cache.value);
      return () => window.removeEventListener(event, onChange);
    }, [enabled]);
    return enabled ? value : initial;
  }
  return { note, useCounter };
}

const adminCounts = makeCounter('streamulus:admin-counts', '/api/admin/stats',
  d => ({ pending: d.pendingCount || 0, feedback: d.feedbackUnread || 0 }), { pending: 0, feedback: 0 });
const feedbackReplies = makeCounter('streamulus:feedback-replies', '/api/feedback/unread', d => d.count || 0, 0);

export const noteAdminCounts = adminCounts.note;
export const noteFeedbackRead = feedbackReplies.note;

export default function Navbar() {
  const { user, profile, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const isAdmin = user?.role === 'admin' && !profile?.is_kids;
  const admin = adminCounts.useCounter(isAdmin);
  const adminAttention = admin.pending + admin.feedback;
  const newReplies = feedbackReplies.useCounter(!!user);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close both menus on route change
  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [location]);

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/movies', label: 'Movies' },
    { to: '/tv', label: 'TV Shows' },
    { to: '/genres', label: 'Genres' },
  ];
  // A genre's own page (/genre/Action) keeps "Genres" highlighted.
  const isActive = (to) => location.pathname === to || (to === '/genres' && location.pathname.startsWith('/genre/'));

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const closeBothMenus = () => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  };

  const navHeight = isMobile ? '60px' : '64px';

  return (
    <>
      <nav
        style={{
          ...styles.nav,
          height: navHeight,
          ...(scrolled ? styles.navScrolled : styles.navTransparent),
        }}
      >
        {/* Left side: logo + desktop nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link to="/" aria-label="Streamulus home" style={{ display: 'flex', textDecoration: 'none' }}><BrandMark size={isMobile ? 22 : 26} /></Link>
            {profile?.is_kids && (
              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#1a1200', background: 'linear-gradient(135deg, #ffb703, #fb5607)' }}>
                Streamlings
              </span>
            )}
          </div>

          {/* Desktop nav links — hidden on mobile */}
          {!isMobile && (
            <div style={styles.links}>
              {navLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  style={{
                    ...styles.link,
                    ...(isActive(to) ? styles.activeLink : {}),
                  }}
                  onMouseEnter={e => { if (!isActive(to)) e.target.style.color = '#fff'; }}
                  onMouseLeave={e => { if (!isActive(to)) e.target.style.color = '#b3b3b3'; }}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Right side */}
        <div style={styles.right}>
          {/* User avatar dropdown */}
          <div style={{ position: 'relative' }}>
            <div
              style={{ cursor: 'pointer' }}
              onClick={() => setUserMenuOpen(v => !v)}
              title={profile?.name}
            >
              <ProfileAvatar profile={profile} size={34} />
              {adminAttention + newReplies > 0 && (
                <span title={[
                  admin.pending ? `${admin.pending} account request${admin.pending === 1 ? '' : 's'} waiting` : null,
                  admin.feedback ? `${admin.feedback} feedback to read` : null,
                  newReplies ? `${newReplies} new feedback repl${newReplies === 1 ? 'y' : 'ies'}` : null,
                ].filter(Boolean).join(' · ')}
                  style={{ position: 'absolute', top: '-2px', right: '-2px', width: '12px', height: '12px', borderRadius: '50%', background: '#00c2ff', border: '2px solid #0f0f0f' }} />
              )}
            </div>
            {userMenuOpen && (
              <div style={styles.dropdown}>
                <div
                  style={{
                    padding: '4px 14px 10px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    marginBottom: '6px',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#fff' }}>
                    {profile?.name}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: profile?.is_kids ? '#ffb703' : '#666',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {profile?.is_kids ? 'Streamling' : `${user?.username} · ${user?.role}`}
                  </div>
                </div>
                {[
                  { to: '/profiles', label: 'Switch Profile' },
                  { to: '/profile', label: profile?.is_kids ? 'My Profile' : 'Profile & Account' },
                  ...(profile?.is_kids ? [] : [{ to: '/quick-login', label: 'Quick Login' }]),
                  { to: '/feedback', label: 'Feedback', badge: newReplies },
                ].map(item => (
                  <Link
                    key={item.to}
                    to={item.to}
                    style={{ ...styles.dropdownItem, display: 'block' }}
                    onClick={closeBothMenus}
                    onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.06)'; e.target.style.color = '#fff'; }}
                    onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#b3b3b3'; }}
                  >
                    {item.label}
                    {item.badge > 0 && (
                      <span style={{ marginLeft: '8px', padding: '1px 7px', borderRadius: '10px', background: '#00c2ff', color: '#000', fontSize: '11px', fontWeight: 800 }}>{item.badge}</span>
                    )}
                  </Link>
                ))}
                {user?.role === 'admin' && !profile?.is_kids && (
                  <Link
                    to="/admin"
                    style={{ ...styles.dropdownItem, display: 'block' }}
                    onClick={closeBothMenus}
                    onMouseEnter={e => {
                      e.target.style.background = 'rgba(255,255,255,0.06)';
                      e.target.style.color = '#fff';
                    }}
                    onMouseLeave={e => {
                      e.target.style.background = 'transparent';
                      e.target.style.color = '#b3b3b3';
                    }}
                  >
                    Admin Dashboard
                    {adminAttention > 0 && (
                      <span style={{ marginLeft: '8px', padding: '1px 7px', borderRadius: '10px', background: '#00c2ff', color: '#000', fontSize: '11px', fontWeight: 800 }}>{adminAttention}</span>
                    )}
                  </Link>
                )}
                <button
                  style={{ ...styles.dropdownItem, color: '#ff4444' }}
                  onClick={handleLogout}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,68,68,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>

          {/* Hamburger button — mobile only */}
          {isMobile && (
            <button
              style={styles.hamburger}
              onClick={() => setMobileMenuOpen(v => !v)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {/* Top bar: rotates to first arm of X */}
              <span
                style={{
                  ...styles.hamburgerSpan,
                  transform: mobileMenuOpen
                    ? 'translateY(7px) rotate(45deg)'
                    : 'none',
                }}
              />
              {/* Middle bar: fades out */}
              <span
                style={{
                  ...styles.hamburgerSpan,
                  opacity: mobileMenuOpen ? 0 : 1,
                  transform: mobileMenuOpen ? 'scaleX(0)' : 'none',
                }}
              />
              {/* Bottom bar: rotates to second arm of X */}
              <span
                style={{
                  ...styles.hamburgerSpan,
                  transform: mobileMenuOpen
                    ? 'translateY(-7px) rotate(-45deg)'
                    : 'none',
                }}
              />
            </button>
          )}
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {isMobile && mobileMenuOpen && (
        <div style={styles.mobileDropdown}>
          {navLinks.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              style={{
                ...styles.mobileLinkItem,
                ...(isActive(to) ? styles.mobileLinkItemActive : {}),
              }}
              onClick={closeBothMenus}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => {
                e.currentTarget.style.color =
                  isActive(to) ? '#fff' : '#b3b3b3';
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
