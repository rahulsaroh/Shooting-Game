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

  const [f2DebugVisible, setF2DebugVisible] = useState(false);

  // Listen to popstate for browser back/forward and F2 debug toggle
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path.startsWith('/controller')) {
        setRoute('controller');
      } else if (path.startsWith('/game')) {
        setRoute('game');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'F2' || e.key === 'F2') {
        setF2DebugVisible((prev) => !prev);
      }
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const switchRole = (newRole: 'game' | 'controller') => {
    setRoute(newRole);
    window.history.pushState({}, '', newRole === 'game' ? '/game' : '/controller');
  };

  return (
    <div className="w-full h-full min-h-screen bg-black text-white relative">
      {route === 'controller' ? <ControllerApp /> : <GameApp />}

      {/* Phase 3: Floating Role Switcher Pill is hidden by default and only visible when Debug Mode [F2] is active */}
      {f2DebugVisible && (
        <div className="fixed top-2 left-2 z-50 flex items-center gap-1 bg-neutral-900/95 border border-amber-400/60 p-1 rounded-xl text-[11px] font-mono shadow-lg">
          <span className="px-1.5 text-amber-300 font-bold">[F2]</span>
          <button
            type="button"
            onClick={() => switchRole('game')}
            className={`px-2 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
              route === 'game'
                ? 'bg-cyan-500 text-black font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Tv className="w-3 h-3" />
            <span>TV</span>
          </button>
          <button
            type="button"
            onClick={() => switchRole('controller')}
            className={`px-2 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
              route === 'controller'
                ? 'bg-cyan-500 text-black font-bold'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3 h-3" />
            <span>Phone</span>
          </button>
        </div>
      )}
    </div>
  );
}
