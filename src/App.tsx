import React, { useState, useEffect } from 'react';
import { GameApp } from './game/GameApp.tsx';
import { ControllerApp } from './controller/ControllerApp.tsx';
import { Tv, Smartphone } from 'lucide-react';

export default function App() {
  const [route, setRoute] = useState<'game' | 'controller' | 'choose'>(() => {
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');

    if (roleParam === 'controller' || path.startsWith('/controller')) {
      return 'controller';
    }
    if (roleParam === 'game' || path.startsWith('/game')) {
      return 'game';
    }

    // Check if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    if (isMobile) {
      return 'controller';
    }

    return 'game';
  });

  // Listen to popstate for browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path.startsWith('/controller')) {
        setRoute('controller');
      } else if (path.startsWith('/game')) {
        setRoute('game');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const switchRole = (newRole: 'game' | 'controller') => {
    setRoute(newRole);
    window.history.pushState({}, '', newRole === 'game' ? '/game' : '/controller');
  };

  return (
    <div className="w-full h-full min-h-screen bg-black text-white relative">
      {route === 'controller' ? (
        <ControllerApp />
      ) : (
        <GameApp />
      )}

      {/* Floating Role Switcher Pill in Top-Left Corner for Easy Dev/Preview Testing */}
      <div className="fixed top-2 left-2 z-50 opacity-40 hover:opacity-100 transition-opacity flex items-center gap-1 bg-neutral-900/90 border border-neutral-800 p-1 rounded-xl text-[11px] font-mono shadow-lg">
        <button
          type="button"
          onClick={() => switchRole('game')}
          className={`px-2 py-1 rounded-lg flex items-center gap-1 transition ${
            route === 'game' ? 'bg-cyan-500 text-black font-bold' : 'text-neutral-400 hover:text-white'
          }`}
        >
          <Tv className="w-3 h-3" />
          <span>TV</span>
        </button>
        <button
          type="button"
          onClick={() => switchRole('controller')}
          className={`px-2 py-1 rounded-lg flex items-center gap-1 transition ${
            route === 'controller' ? 'bg-cyan-500 text-black font-bold' : 'text-neutral-400 hover:text-white'
          }`}
        >
          <Smartphone className="w-3 h-3" />
          <span>Phone</span>
        </button>
      </div>
    </div>
  );
}
