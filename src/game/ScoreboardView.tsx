import React from 'react';
import { GameWorldState } from '../../shared/types.ts';
import { Trophy, RotateCcw, Award, Ticket } from 'lucide-react';

interface ScoreboardViewProps {
  world: GameWorldState;
  onRestart: () => void;
}

export const ScoreboardView: React.FC<ScoreboardViewProps> = ({ world, onRestart }) => {
  const isVictory = world.phase === 'VICTORY';

  const sortedPlayers = [...world.players].sort((a, b) => b.stats.score - a.stats.score);
  const mvp = sortedPlayers[0];

  const totalKills = world.players.reduce((sum, p) => sum + p.stats.kills, 0);
  const totalShots = world.players.reduce((sum, p) => sum + p.stats.shotsFired, 0);
  const totalHits = world.players.reduce((sum, p) => sum + p.stats.shotsHit, 0);
  const teamAccuracy = totalShots > 0 ? Math.round((totalHits / totalShots) * 100) : 0;
  const teamScore = world.players.reduce((sum, p) => sum + p.stats.score, 0);
  const highScores = world.highScores || [];

  return (
    <div className="absolute inset-0 bg-gradient-to-b from-slate-950/92 via-slate-950/85 to-slate-950/95 z-40 flex flex-col justify-between p-6 lg:p-8 select-none overflow-y-auto font-sans">
      <div className="max-w-5xl mx-auto w-full my-auto space-y-5">
        {/* Arcade Stage Complete / Game Over Header */}
        <div className="text-center space-y-1.5">
          <div className="font-display text-sm font-bold tracking-widest text-amber-400">
            {isVictory
              ? 'ALL 3 STAGES CLEARED · ENTER INITIALS ON YOUR PHONE!'
              : 'BARRICADE BREACHED · ENTER INITIALS ON YOUR PHONE!'}
          </div>

          <h1
            className={`font-display text-6xl font-bold italic tracking-wider ${
              isVictory ? 'text-emerald-400' : 'text-rose-500'
            }`}
          >
            {isVictory ? 'ARCADE VICTORY!' : 'GAME OVER'}
          </h1>
          <p className="text-slate-300 text-sm font-mono">
            Waves Cleared: {isVictory ? world.settings.maxWaves : Math.max(0, world.currentWave - 1)} /{' '}
            {world.settings.maxWaves} · Enter your 3-letter High-Score Initials on your Phone Controller!
          </p>
        </div>

        {/* MVP Top Scorer Spotlight */}
        {mvp && (
          <div
            className="p-5 rounded-2xl border-2 bg-slate-900/95 flex flex-wrap items-center justify-between gap-4 shadow-xl"
            style={{
              borderColor: mvp.color,
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center border-2 border-white shadow-lg text-slate-950 font-display font-bold text-2xl"
                style={{ backgroundColor: mvp.color }}
              >
                <Trophy className="w-7 h-7 text-slate-950 fill-current" />
              </div>
              <div>
                <div className="text-xs font-display font-bold tracking-wider text-amber-400 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5" /> TOP ARCADE GUNNER ({mvp.slot}P)
                </div>
                <div className="font-display text-2xl font-bold text-white tracking-wider">
                  {mvp.name}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 text-right font-mono">
              <div>
                <div className="text-[10px] text-slate-400">MAX COMBO</div>
                <div className="text-2xl font-extrabold text-fuchsia-400 tabular-nums">
                  {mvp.maxCombo || 0} HIT
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">FINAL SCORE</div>
                <div className="text-2xl font-extrabold text-amber-400 tabular-nums">
                  {String(mvp.stats.score).padStart(6, '0')}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">ZOMBIES KO</div>
                <div className="text-2xl font-extrabold text-cyan-400 tabular-nums">
                  {mvp.stats.kills}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Squad Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
          <div className="bg-slate-900/90 border border-white/15 p-3.5 rounded-xl text-center">
            <div className="text-xs text-slate-400">TEAM SCORE</div>
            <div className="text-2xl font-extrabold text-amber-400 mt-1 tabular-nums">
              {String(teamScore).padStart(6, '0')}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-white/15 p-3.5 rounded-xl text-center">
            <div className="text-xs text-slate-400">TOTAL KILLS</div>
            <div className="text-2xl font-extrabold text-emerald-400 mt-1 tabular-nums">
              {totalKills}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-white/15 p-3.5 rounded-xl text-center">
            <div className="text-xs text-slate-400">SHOTS FIRED</div>
            <div className="text-2xl font-extrabold text-white mt-1 tabular-nums">
              {totalShots}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-white/15 p-3.5 rounded-xl text-center">
            <div className="text-xs text-slate-400">ACCURACY</div>
            <div className="text-2xl font-extrabold text-cyan-400 mt-1 tabular-nums">
              {teamAccuracy}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Match Player Breakdown */}
          <div className="lg:col-span-7 bg-slate-900/90 border border-white/15 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-white/10">
                <tr>
                  <th className="p-3 pl-4">PLAYER</th>
                  <th className="p-3 text-right">KILLS</th>
                  <th className="p-3 text-right">COMBO</th>
                  <th className="p-3 text-right">TICKETS</th>
                  <th className="p-3 text-right pr-4">SCORE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                {sortedPlayers.map((p) => (
                  <tr key={p.id} className="hover:bg-white/5 transition">
                    <td className="p-3 pl-4 flex items-center gap-2 font-bold">
                      <span
                        className="font-display text-xs px-1.5 py-0.5 rounded text-slate-950"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.slot}P
                      </span>
                      <span>{p.name}</span>
                    </td>
                    <td className="p-3 text-right font-bold text-emerald-400 tabular-nums">
                      {p.stats.kills}
                    </td>
                    <td className="p-3 text-right text-fuchsia-300 tabular-nums">
                      {p.maxCombo || 0}x
                    </td>
                    <td className="p-3 text-right text-amber-300 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Ticket className="w-3 h-3" /> {p.tickets || 0}
                      </span>
                    </td>
                    <td className="p-3 text-right pr-4 font-extrabold text-white tabular-nums">
                      {String(p.stats.score).padStart(6, '0')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* All-Time Persistent High Scores Table */}
          <div className="lg:col-span-5 bg-slate-900/90 border border-amber-400/40 rounded-2xl p-4 space-y-2.5">
            <div className="font-display font-bold text-sm text-amber-300 tracking-wider flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              <span>ALL-TIME HIGH SCORES (SERVER JSON)</span>
            </div>
            <div className="space-y-1.5 font-mono text-xs">
              {highScores.slice(0, 6).map((hs, idx) => (
                <div
                  key={`${hs.initials}_${idx}`}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/80 border border-white/10"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-amber-400 font-bold">#{idx + 1}</span>
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 font-bold">
                      {hs.initials}
                    </span>
                    <span className="text-white">{hs.name}</span>
                  </div>
                  <span className="text-amber-300 font-extrabold tabular-nums">
                    {String(hs.score).padStart(6, '0')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Play Again CTA */}
        <div className="pt-1 flex justify-center">
          <button
            type="button"
            onClick={onRestart}
            className="px-10 py-4 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 hover:from-amber-300 hover:to-pink-400 text-slate-950 font-display font-bold text-lg tracking-wider flex items-center gap-2.5 shadow-xl transition transform active:scale-95 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-5 h-5" />
            <span>PLAY AGAIN (FREE PLAY)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
