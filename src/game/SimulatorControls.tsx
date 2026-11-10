import React, { useState, useEffect } from 'react';
import { GamePhase } from '../../shared/types.ts';
import { Bot, MousePointer, ChevronDown, ChevronUp } from 'lucide-react';

interface SimulatorControlsProps {
  phase: GamePhase;
  onSpawnBots: (count: number) => void;
  onRemoveBots: () => void;
  onMouseAim: (x: number, y: number) => void;
  onMouseShoot: () => void;
  onMouseReload: () => void;
}

export const SimulatorControls: React.FC<SimulatorControlsProps> = ({
  phase,
  onSpawnBots,
  onRemoveBots,
  onMouseAim,
  onMouseShoot,
  onMouseReload,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const [mouseAimActive, setMouseAimActive] = useState(false);

  // Mouse aim listener on TV canvas when enabled during active gameplay
  useEffect(() => {
    if (!mouseAimActive || phase === 'LOBBY') return;

    const handleMouseMove = (e: MouseEvent) => {
      const x = Math.max(0.01, Math.min(0.99, e.clientX / window.innerWidth));
      const y = Math.max(0.01, Math.min(0.99, e.clientY / window.innerHeight));
      onMouseAim(x, y);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('button')) return;
      if (e.button === 0) {
        onMouseShoot();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        onMouseReload();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mouseAimActive, phase, onMouseAim, onMouseShoot, onMouseReload]);

  return (
    <div className="fixed bottom-3 right-3 z-40 select-none font-sans">
      <div className="bg-slate-950/45 backdrop-blur-md border border-white/20 rounded-xl shadow-lg overflow-hidden transition-all">
        {/* Toggle Bar */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full px-3 py-1.5 hover:bg-white/10 flex items-center justify-between gap-2.5 text-[11px] font-display font-bold tracking-wider text-white/90 transition cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-amber-400" />
            <span>ARCADE TEST DECK</span>
          </div>
          {collapsed ? <ChevronUp className="w-4 h-4 text-cyan-400" /> : <ChevronDown className="w-4 h-4 text-cyan-400" />}
        </button>

        {!collapsed && (
          <div className="p-4 space-y-3 w-72 text-xs">
            {/* Mouse aim controller */}
            <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-xl border border-white/10">
              <div className="flex items-center gap-2 text-slate-200 font-semibold">
                <MousePointer className="w-3.5 h-3.5 text-cyan-400" />
                <span>PC Light-Gun Mouse</span>
              </div>
              <button
                type="button"
                onClick={() => setMouseAimActive(!mouseAimActive)}
                className={`px-3 py-1 rounded-lg font-display font-bold transition text-xs cursor-pointer ${
                  mouseAimActive
                    ? 'bg-cyan-400 text-slate-950'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {mouseAimActive ? 'ON (Click Fire)' : 'OFF'}
              </button>
            </div>

            {/* Quick Bot Spawns */}
            <div>
              <div className="text-[11px] font-display font-bold text-amber-400 tracking-wider mb-1.5">
                ADD CO-OP WINGMAN BOTS
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onSpawnBots(1)}
                  className="py-2 bg-slate-800 hover:bg-slate-700 border border-white/15 rounded-lg font-bold text-white transition text-center cursor-pointer"
                >
                  +1 Bot
                </button>
                <button
                  type="button"
                  onClick={() => onSpawnBots(4)}
                  className="py-2 bg-slate-800 hover:bg-slate-700 border border-cyan-400/40 rounded-lg font-bold text-cyan-300 transition text-center cursor-pointer"
                >
                  +4 Squad
                </button>
                <button
                  type="button"
                  onClick={onRemoveBots}
                  className="py-2 bg-rose-950 hover:bg-rose-900 border border-rose-500/40 rounded-lg font-bold text-rose-200 transition text-center cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
