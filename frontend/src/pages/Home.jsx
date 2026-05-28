import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import MediaRow from '../components/MediaRow';

export default function Home() {
  const [featured, setFeatured] = useState(null);
  const [recentMovies, setRecentMovies] = useState([]);
  const [recentShows, setRecentShows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get('/api/movies/featured').catch(() => ({ data: { movie: null } })),
      axios.get('/api/movies/recent').catch(() => ({ data: { movies: [] } })),
      axios.get('/api/tv/recent').catch(() => ({ data: { shows: [] } })),
    ]).then(([featuredRes, moviesRes, showsRes]) => {
      setFeatured(featuredRes.data.movie);
      setRecentMovies(moviesRes.data.movies || []);
      setRecentShows(showsRes.data.shows || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <Navbar />
      <Hero item={featured} type="movie" />
      <div style={{ paddingTop: '32px', paddingBottom: '60px' }}>
        <MediaRow title="Recently Added Movies" items={recentMovies} type="movie" />
        <MediaRow title="Recently Added TV Shows" items={recentShows} type="tv" />
      </div>
    </div>
  );
}
