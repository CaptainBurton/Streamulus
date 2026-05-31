import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

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
  ];

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
          <Link to="/" style={styles.logo}>STREAMULUS</Link>

          {/* Desktop nav links — hidden on mobile */}
          {!isMobile && (
            <div style={styles.links}>
              {navLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  style={{
                    ...styles.link,
                    ...(location.pathname === to ? styles.activeLink : {}),
                  }}
                  onMouseEnter={e => { if (location.pathname !== to) e.target.style.color = '#fff'; }}
                  onMouseLeave={e => { if (location.pathname !== to) e.target.style.color = '#b3b3b3'; }}
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
              style={styles.avatar}
              onClick={() => setUserMenuOpen(v => !v)}
            >
              {user?.username?.[0]?.toUpperCase()}
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
                    {user?.username}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#666',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {user?.role}
                  </div>
                </div>
                {user?.role === 'admin' && (
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
                ...(location.pathname === to ? styles.mobileLinkItemActive : {}),
              }}
              onClick={closeBothMenus}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => {
                e.currentTarget.style.color =
                  location.pathname === to ? '#fff' : '#b3b3b3';
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
