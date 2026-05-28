import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider, useAuth } from './context/AuthContext';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Home from './pages/Home';
import Movies from './pages/Movies';
import TVShows from './pages/TVShows';
import Watch from './pages/Watch';
import Admin from './pages/Admin';

function AppRoutes() {
  const { user, loading } = useAuth();
  const [setupComplete, setSetupComplete] = useState(null);

  useEffect(() => {
    axios.get('/api/setup/status').then(res => {
      setSetupComplete(res.data.setupComplete);
    });
  }, []);

  if (loading || setupComplete === null) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!setupComplete) return <Setup onComplete={() => setSetupComplete(true)} />;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/movies" element={<Movies />} />
      <Route path="/tv" element={<TVShows />} />
      <Route path="/watch/:type/:id" element={<Watch />} />
      <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
