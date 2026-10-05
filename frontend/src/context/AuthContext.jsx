import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const TOKEN_KEY = 'streamulus_token';
// Set after login when the account has several profiles, so "Who's watching?"
// survives a page refresh until a profile is picked.
const PICK_KEY = 'streamulus_pick_profile';

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null); // active profile ("who's watching")
  const [needsProfilePick, setNeedsProfilePick] = useState(() => sessionStorage.getItem(PICK_KEY) === '1');
  const [loading, setLoading] = useState(true);

  const setPick = (v) => {
    if (v) sessionStorage.setItem(PICK_KEY, '1'); else sessionStorage.removeItem(PICK_KEY);
    setNeedsProfilePick(v);
  };

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PICK_KEY);
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
    setProfile(null);
    setNeedsProfilePick(false);
  }, []);

  useEffect(() => {
    // If the active profile is removed (e.g. from another device), its token is
    // refused — sign out rather than silently becoming another profile.
    const id = axios.interceptors.response.use(r => r, (err) => {
      if (err.response?.status === 401 && err.response?.data?.code === 'PROFILE_GONE') logout();
      return Promise.reject(err);
    });
    return () => axios.interceptors.response.eject(id);
  }, [logout]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get('/api/auth/me')
        .then(res => { setUser(res.data.user); setProfile(res.data.profile); })
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [logout]);

  // Finish signing in with a token from /login or an approved Quick Login.
  const completeLogin = ({ token, user, profile, profileCount }) => {
    setToken(token);
    setUser(user);
    setProfile(profile);
    setPick(profileCount > 1);
    return user;
  };

  const login = async (username, password) => {
    const res = await axios.post('/api/auth/login', { username, password });
    return completeLogin(res.data);
  };

  // Switch to another profile; pin is needed for PIN-locked profiles.
  const selectProfile = async (profileId, pin) => {
    const res = await axios.post(`/api/profiles/${profileId}/select`, pin ? { pin } : {});
    setToken(res.data.token);
    setProfile(res.data.profile);
    setPick(false);
    return res.data.profile;
  };

  // Re-read the account and active profile (after renaming, a new photo, etc.)
  const refresh = async () => {
    const res = await axios.get('/api/auth/me');
    setUser(res.data.user);
    setProfile(res.data.profile);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, login, completeLogin, logout, selectProfile, refresh,
      needsProfilePick, cancelProfilePick: () => setPick(false),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
