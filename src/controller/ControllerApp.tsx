import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MotionSensors } from './MotionSensors.ts';
import { triggerHaptic } from './Haptics.ts';
import { ScreenLockManager } from './ScreenLock.ts';
import {
  PLAYER_COLORS,
  REWARDS_CATALOG,
  WEAPON_CONFIG,
  WEAPONS,
} from '../../shared/config.ts';
import {
  ClientMessage,
  GamePhase,
  PlayerInfo,
  ServerMessage,
  WeaponType,
} from '../../shared/types.ts';
import {
  Crosshair,
  RotateCcw,
  Zap,
  Wifi,
  Sparkles,
  Smartphone,
  HandMetal,
  Infinity as InfinityIcon,
  Flame,
  RefreshCw,
  Compass,
  Volume2,
  VolumeX,
  Trophy,
  Ticket,
  Lock,
  Check,
  X,
} from 'lucide-react';

interface ControllerAppProps {
  onBackToMenu?: () => void;
}

export const ControllerApp: React.FC<ControllerAppProps> = ({ onBackToMenu }) => {
  const [joined, setJoined] = useState(false);
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('deadaim_player_name') || ''
  );
  const [selectedColor, setSelectedColor] = useState(
    () => localStorage.getItem('deadaim_player_color') || PLAYER_COLORS[0].hex
  );
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);
  const [reconnectToken, setReconnectToken] = useState(
    () => localStorage.getItem('deadaim_token') || ''
  );

  const [connected, setConnected] = useState(false);
  const [ping, setPing] = useState<number | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>('LOBBY');
  const [isFiring, setIsFiring] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [currentWeapon, setCurrentWeapon] = useState<WeaponType>('pistol');
  const [currentAmmo, setCurrentAmmo] = useState(WEAPON_CONFIG.maxAmmo);
  const [maxAmmo, setMaxAmmo] = useState(WEAPON_CONFIG.maxAmmo);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [hp, setHp] = useState(100);
  const [isDowned, setIsDowned] = useState(false);
  const [downedSec, setDownedSec] = useState(0);
  const [tickets, setTickets] = useState(25);
  const [unlockedRewards, setUnlockedRewards] = useState<string[]>([
    'skin_default',
    'crosshair_default',
  ]);
  const [equippedSkin, setEquippedSkin] = useState('skin_default');
  const [equippedCrosshair, setEquippedCrosshair] = useState('crosshair_default');

  // 3-Letter High-Score Initials Entry & Rewards Modal State
  const [initials, setInitials] = useState('ACE');
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [rewardsOpen, setRewardsOpen] = useState(false);

  const [touchMode, setTouchMode] = useState(false);
  const [sensorStreaming, setSensorStreaming] = useState(false);
  const [aimCoords, setAimCoords] = useState({ x: 0.5, y: 0.5 });
  const [tiltDeg, setTiltDeg] = useState({ pitch: 0, yaw: 0 });
  const [targetLocked, setTargetLocked] = useState(false);

  // Weapon Assist & Phone Speaker Hit Tick Toggles
  const [autoFire, setAutoFire] = useState(true);
  const [autoReload, setAutoReload] = useState(true);
  const [unlimitedAmmo, setUnlimitedAmmo] = useState(false);
  const [phoneHitSound, setPhoneHitSound] = useState(
    () => localStorage.getItem('deadaim_phone_hit_sound') !== 'false'
  );

  const wsRef = useRef<WebSocket | null>(null);
  const motionRef = useRef<MotionSensors | null>(null);
  const screenLockRef = useRef<ScreenLockManager | null>(null);
  const phoneAudioCtxRef = useRef<AudioContext | null>(null);
  const touchAreaRef = useRef<HTMLDivElement | null>(null);
  const lastAimSentRef = useRef<number>(0);
  const touchModeRef = useRef(false);
  const phoneHitSoundRef = useRef(phoneHitSound);
  const playerIdRef = useRef<string | null>(null);

  useEffect(() => {
    touchModeRef.current = touchMode;
  }, [touchMode]);

  useEffect(() => {
    phoneHitSoundRef.current = phoneHitSound;
    localStorage.setItem('deadaim_phone_hit_sound', String(phoneHitSound));
  }, [phoneHitSound]);

  useEffect(() => {
    playerIdRef.current = playerInfo?.id || null;
  }, [playerInfo?.id]);

  // Play crisp hit-confirmation tick on the shooter's phone speaker alongside haptics
  const playPhoneHitTick = useCallback((headshot = false) => {
    if (!phoneHitSoundRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!phoneAudioCtxRef.current) {
        phoneAudioCtxRef.current = new AudioCtx();
      }
      const ctx = phoneAudioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = headshot ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(headshot ? 1760 : 1080, t);
      osc.frequency.exponentialRampToValueAtTime(headshot ? 2340 : 620, t + 0.055);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.005, t + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.065);
    } catch {
      // ignore audio errors
    }
  }, []);

  // Send Aim data at up to 60Hz
  const sendAim = useCallback(
    (x: number, y: number, pitch?: number, yaw?: number, roll?: number) => {
      const now = performance.now();
      if (now - lastAimSentRef.current < 16) return;
      lastAimSentRef.current = now;

      setAimCoords({ x, y });
      if (pitch !== undefined && yaw !== undefined) {
        setTiltDeg({ pitch: Math.round(pitch), yaw: Math.round(yaw) });
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(
            JSON.stringify({
              type: 'aim',
              x,
              y,
              pitch,
              yaw,
              roll,
            } as ClientMessage)
          );
        } catch {
          // ignore
        }
      }
    },
    []
  );

  const handleReload = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    triggerHaptic('reload');
    setIsReloading(true);
    try {
      wsRef.current.send(JSON.stringify({ type: 'reload' } as ClientMessage));
    } catch {
      // ignore
    }
  }, []);

  // Initialize sensors, attach motion listeners immediately on mount, and auto-start on Android/standard browsers
  useEffect(() => {
    const motion = new MotionSensors();
    motionRef.current = motion;
    screenLockRef.current = new ScreenLockManager();

    const unsubMotion = motion.onMotion((data) => {
      setSensorStreaming(true);
      if (!touchModeRef.current) {
        sendAim(data.x, data.y, data.pitch, data.yaw, data.roll);
      }
    });

    const unsubFlick = motion.onFlick(() => {
      handleReload();
    });

    if (!motion.requiresPermissionPrompt()) {
      motion.resetToFlat();
      motion.start();
    }

    return () => {
      unsubMotion();
      unsubFlick();
      motion.stop();
      screenLockRef.current?.releaseLock();
      wsRef.current?.close();
    };
  }, [sendAim, handleReload]);

  const syncFromPlayer = (p: PlayerInfo) => {
    setPlayerInfo(p);
    setCurrentWeapon(p.weapon || 'pistol');
    setCurrentAmmo(p.ammo);
    setMaxAmmo(p.maxAmmo || WEAPON_CONFIG.maxAmmo);
    setIsReloading(p.isReloading);
    setCombo(p.combo || 0);
    setMultiplier(p.multiplier || 1);
    setHp(p.hp ?? 100);
    setIsDowned(Boolean(p.isDowned));
    setDownedSec(Math.ceil(p.downedRemainingSec || 0));
    setTickets(p.tickets ?? 25);
    if (p.unlockedRewards) setUnlockedRewards(p.unlockedRewards);
    if (p.equippedSkin) setEquippedSkin(p.equippedSkin);
    if (p.equippedCrosshair) setEquippedCrosshair(p.equippedCrosshair);
    setTargetLocked(Boolean(p.isTargetLocked));
    if (p.autoFire !== undefined) setAutoFire(p.autoFire);
    if (p.autoReload !== undefined) setAutoReload(p.autoReload);
    if (p.unlimitedAmmo !== undefined) setUnlimitedAmmo(p.unlimitedAmmo);
  };

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
      const savedToken = localStorage.getItem('deadaim_token');
      const savedName = localStorage.getItem('deadaim_player_name');
      const savedColor = localStorage.getItem('deadaim_player_color');
      if (savedToken && savedName && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(
            JSON.stringify({
              type: 'phone_join',
              name: savedName,
              color: savedColor || undefined,
              reconnectToken: savedToken,
            } as ClientMessage)
          );
        } catch {
          // ignore
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === 'phone_joined') {
          playerIdRef.current = msg.player.id;
          syncFromPlayer(msg.player);
          setReconnectToken(msg.reconnectToken);
          localStorage.setItem('deadaim_token', msg.reconnectToken);
          localStorage.setItem('deadaim_player_name', msg.player.name);
          localStorage.setItem('deadaim_player_color', msg.player.color);
          setInitials(
            (msg.player.name || 'ACE')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 3)
              .padEnd(3, 'A')
          );
          setJoined(true);

          if (motionRef.current && !motionRef.current.requiresPermissionPrompt()) {
            motionRef.current.start();
          }
        } else if (msg.type === 'lobby_update') {
          setGamePhase(msg.phase);
          if (playerIdRef.current) {
            const me = msg.players.find((p) => p.id === playerIdRef.current);
            if (me) syncFromPlayer(me);
          }
        } else if (msg.type === 'haptic') {
          triggerHaptic(msg.pattern);
          if (msg.pattern === 'hit') {
            playPhoneHitTick(Boolean(msg.headshot));
          } else if (msg.pattern.startsWith('shoot')) {
            setIsFiring(true);
            setTimeout(() => setIsFiring(false), 85);
          } else if (msg.pattern === 'reload') {
            setIsReloading(true);
          }
        } else if (msg.type === 'game_tick') {
          setGamePhase(msg.world.phase);
          if (msg.world.phase === 'PLAYING' || msg.world.phase === 'TUTORIAL') {
            setScoreSubmitted(false);
          }
          if (msg.world.settings.phoneHitSound !== undefined) {
            setPhoneHitSound(msg.world.settings.phoneHitSound);
          }
          if (playerIdRef.current) {
            const me = msg.world.players.find((p) => p.id === playerIdRef.current);
            if (me) syncFromPlayer(me);
          }
        } else if (msg.type === 'pong') {
          setPing(Math.round(Date.now() - msg.time));
        }
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 1500);
    };

    wsRef.current = ws;

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping', time: Date.now() }));
        } catch {
          // ignore
        }
      }
    }, 2000);

    return () => clearInterval(pingInterval);
  }, [playPhoneHitTick]);

  useEffect(() => {
    connectWebSocket();
  }, [connectWebSocket]);

  const unlockAndStartSensors = async () => {
    if (motionRef.current) {
      const granted = await motionRef.current.requestPermissions();
      if (granted) {
        motionRef.current.start();
        setTouchMode(false);
      } else {
        setTouchMode(true);
      }
    }
    if (screenLockRef.current) {
      screenLockRef.current.requestLock().catch(() => {});
    }
  };

  const updateWeaponOptions = (opts: {
    autoFire?: boolean;
    autoReload?: boolean;
    unlimitedAmmo?: boolean;
  }) => {
    if (opts.autoFire !== undefined) setAutoFire(opts.autoFire);
    if (opts.autoReload !== undefined) setAutoReload(opts.autoReload);
    if (opts.unlimitedAmmo !== undefined) setUnlimitedAmmo(opts.unlimitedAmmo);

    triggerHaptic('reload');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            type: 'update_player_options',
            ...opts,
          } as ClientMessage)
        );
      } catch {
        // ignore
      }
    }
  };

  const handleSwitchWeapon = (weapon: WeaponType) => {
    setCurrentWeapon(weapon);
    triggerHaptic('reload');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'switch_weapon', weapon } as ClientMessage));
      } catch {
        // ignore
      }
    }
  };

  const handleSubmitHighScore = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    triggerHaptic('coop_bonus');
    setScoreSubmitted(true);
    try {
      wsRef.current.send(
        JSON.stringify({
          type: 'submit_highscore',
          initials: initials.toUpperCase().slice(0, 3).padEnd(3, 'A'),
        } as ClientMessage)
      );
    } catch {
      // ignore
    }
  };

  const handleRewardAction = (rewardId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    triggerHaptic('hit');
    const isUnlocked = unlockedRewards.includes(rewardId);
    try {
      wsRef.current.send(
        JSON.stringify({
          type: isUnlocked ? 'equip_reward' : 'unlock_reward',
          rewardId,
        } as ClientMessage)
      );
    } catch {
      // ignore
    }
  };

  const handleActivateGun = async () => {
    await unlockAndStartSensors();
    motionRef.current?.resetToFlat();

    const finalName = playerName.trim() || `Agent-${Math.floor(100 + Math.random() * 900)}`;
    setPlayerName(finalName);

    localStorage.setItem('deadaim_player_name', finalName);
    localStorage.setItem('deadaim_player_color', selectedColor);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            type: 'phone_join',
            name: finalName,
            color: selectedColor,
            reconnectToken: reconnectToken || undefined,
          } as ClientMessage)
        );
        wsRef.current.send(
          JSON.stringify({
            type: 'update_player_options',
            autoFire,
            autoReload,
            unlimitedAmmo,
          } as ClientMessage)
        );
      } catch {
        // ignore
      }
    }

    setJoined(true);
    triggerHaptic('shoot');
  };

  const handleShoot = () => {
    if (!sensorStreaming && !touchMode) {
      unlockAndStartSensors();
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 90);

    const wDef = WEAPONS[currentWeapon] || WEAPONS.pistol;
    triggerHaptic(wDef.hapticPattern);
    try {
      wsRef.current.send(JSON.stringify({ type: 'shoot', timestamp: Date.now() } as ClientMessage));
    } catch {
      // ignore
    }
  };

  const handleFlatCenter = async () => {
    await unlockAndStartSensors();
    triggerHaptic('reload');
    if (motionRef.current) {
      motionRef.current.resetToFlat();
    }
    sendAim(0.5, 0.5, 0, 0, 0);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'recenter' } as ClientMessage));
      } catch {
        // ignore
      }
    }
  };

  const handleCalibrateHoldCenter = async () => {
    await unlockAndStartSensors();
    triggerHaptic('reload');
    if (motionRef.current) {
      motionRef.current.calibrateCurrentAngle();
    }
    sendAim(0.5, 0.5, 0, 0, 0);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'recenter' } as ClientMessage));
      } catch {
        // ignore
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!touchAreaRef.current) return;
    const rect = touchAreaRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const normX = Math.max(0.01, Math.min(0.99, (clientX - rect.left) / rect.width));
    const normY = Math.max(0.01, Math.min(0.99, (clientY - rect.top) / rect.height));

    sendAim(normX, normY);
  };

  const playerColor = playerInfo?.color || selectedColor;
  const weaponDef = WEAPONS[currentWeapon] || WEAPONS.pistol;
  const skinItem = REWARDS_CATALOG.find((r) => r.id === equippedSkin);
  const gunSkinColor =
    equippedSkin === 'skin_default'
      ? playerColor
      : skinItem?.previewColor || playerColor;
  const isFlatCentered = Math.abs(tiltDeg.pitch) <= 2 && Math.abs(tiltDeg.yaw) <= 2;

  // Onboarding View (Lobby / Calibration)
  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-6 select-none font-sans">
        <div className="max-w-md mx-auto w-full pt-8">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Crosshair className="w-7 h-7 text-cyan-400" />
              <h1 className="font-display text-2xl font-bold tracking-wider uppercase text-white">
                DEADAIM LIGHT-GUN
              </h1>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-900 border border-white/15 px-3 py-1 rounded-lg">
              <Wifi className={`w-3.5 h-3.5 ${connected ? 'text-emerald-400' : 'text-rose-500'}`} />
              <span>{connected ? 'Arcade Linked' : 'Connecting...'}</span>
            </div>
          </div>

          <div className="space-y-4 bg-slate-900/90 border-2 border-cyan-400/50 p-5 rounded-2xl shadow-2xl">
            <div>
              <label className="block text-xs uppercase font-display font-bold tracking-wider text-amber-400 mb-1.5">
                Operative Call-Sign
              </label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="e.g. Maverick, Viper, Ace"
                maxLength={16}
                className="w-full bg-slate-950 border border-white/20 focus:border-cyan-400 text-lg font-bold px-4 py-2.5 rounded-xl text-white outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs uppercase font-display font-bold tracking-wider text-amber-400 mb-1.5">
                Laser Sight Color
              </label>
              <div className="grid grid-cols-4 gap-2">
                {PLAYER_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setSelectedColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`h-10 rounded-xl transition transform active:scale-95 flex items-center justify-center font-black text-slate-950 text-xs ${
                      selectedColor === c.hex
                        ? 'ring-4 ring-white shadow-md scale-105'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    {selectedColor === c.hex && '✓'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase font-display font-bold tracking-wider text-amber-400 mb-1.5">
                Arcade Weapon Assist
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAutoFire(!autoFire)}
                  className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                    autoFire
                      ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300'
                      : 'bg-slate-950 border-white/10 text-slate-400'
                  }`}
                >
                  <Flame className="w-4 h-4" />
                  <span>Auto-Fire: {autoFire ? 'ON' : 'OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAutoReload(!autoReload)}
                  className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                    autoReload
                      ? 'bg-cyan-950/80 border-cyan-400 text-cyan-300'
                      : 'bg-slate-950 border-white/10 text-slate-400'
                  }`}
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Auto-Reload: {autoReload ? 'ON' : 'OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUnlimitedAmmo(!unlimitedAmmo)}
                  className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                    unlimitedAmmo
                      ? 'bg-amber-950/80 border-amber-400 text-amber-300'
                      : 'bg-slate-950 border-white/10 text-slate-400'
                  }`}
                >
                  <InfinityIcon className="w-4 h-4" />
                  <span>Unlimited: {unlimitedAmmo ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-950/90 p-3.5 rounded-xl border border-white/10 text-xs text-slate-300 space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-cyan-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Flat-Phone Tilt Aiming Guide</span>
              </div>
              <ul className="text-slate-300 text-[11px] space-y-1 list-disc pl-4">
                <li>
                  <strong>Hold Phone FLAT</strong>: Aim marker centers in the <strong>middle</strong> of the TV screen.
                </li>
                <li>
                  <strong>Tilt Left / Right</strong>: Aim marker moves <strong>Left / Right</strong>.
                </li>
                <li>
                  <strong>Shake / Pump Phone</strong>: Quick reload gesture for all weapons.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto w-full pb-3 pt-4">
          <button
            type="button"
            onClick={handleActivateGun}
            className="w-full py-4 rounded-2xl font-display font-bold uppercase text-lg tracking-wider transition-all transform active:scale-95 shadow-xl flex items-center justify-center gap-3 text-slate-950"
            style={{
              backgroundColor: selectedColor,
              boxShadow: `0 0 25px ${selectedColor}66`,
            }}
          >
            <Smartphone className="w-6 h-6" />
            Activate Light-Gun &amp; Sensors
          </button>
        </div>
      </div>
    );
  }

  // Active Controller Gun HUD View
  return (
    <div
      className="fixed inset-0 bg-slate-950 text-white flex flex-col justify-between select-none overflow-hidden touch-none font-sans"
      style={{
        boxShadow: `inset 0 0 40px ${playerColor}22`,
      }}
    >
      {/* Top Status & Calibration Bar */}
      <div className="pt-8 pb-2 px-3 bg-slate-900/95 border-b border-white/15 flex items-center justify-between gap-2 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-3.5 h-3.5 rounded-full border border-white/60 shrink-0"
            style={{ backgroundColor: playerColor }}
          />
          <div className="min-w-0">
            <div className="font-display font-bold text-xs uppercase tracking-wider text-white truncate">
              {playerInfo?.name || playerName}
            </div>
            <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
              <span>{playerInfo?.slot || 1}P</span>
              <span>•</span>
              <span className="text-amber-300 font-bold">🎟️ {tickets}</span>
              <span>•</span>
              <span>{ping !== null ? `${ping}ms` : 'ONLINE'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onBackToMenu && (
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-2 py-1.5 bg-slate-800 border border-white/25 rounded-lg text-[11px] font-bold text-cyan-300 flex items-center gap-1 active:scale-95"
              title="Return to Arcade Game Selection Menu"
            >
              <span>◀ Menu</span>
            </button>
          )}

          {/* Rewards Locker Modal Button */}
          <button
            type="button"
            onClick={() => setRewardsOpen(true)}
            className="px-2 py-1.5 bg-amber-500/20 border border-amber-400/60 rounded-lg text-[11px] font-bold text-amber-300 flex items-center gap-1 active:scale-95"
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>Locker</span>
          </button>

          {/* Aim Mode Switch */}
          <button
            type="button"
            onClick={() => {
              if (touchMode) {
                unlockAndStartSensors();
              } else {
                setTouchMode(true);
              }
              triggerHaptic('empty');
            }}
            className="px-2 py-1.5 bg-slate-800 border border-white/15 rounded-lg text-[11px] font-bold text-slate-200 flex items-center gap-1 active:bg-slate-700"
          >
            {touchMode ? (
              <HandMetal className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>{touchMode ? 'Touch' : 'Gyro'}</span>
          </button>

          {/* Flat = Center Reset Button */}
          <button
            type="button"
            onClick={handleFlatCenter}
            className="px-2 py-1.5 bg-cyan-500/20 border border-cyan-400/60 rounded-lg text-[11px] font-bold text-cyan-300 flex items-center gap-1 active:scale-95 transition"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Flat</span>
          </button>

          {/* Hold Angle = Center Button */}
          <button
            type="button"
            onClick={handleCalibrateHoldCenter}
            className="px-2 py-1.5 bg-fuchsia-500/20 border border-fuchsia-400/60 rounded-lg text-[11px] font-bold text-fuchsia-300 flex items-center gap-1 active:scale-95 transition"
          >
            <Compass className="w-3 h-3" />
            <span>Hold</span>
          </button>

          {/* Phone Hit Tick Speaker Toggle */}
          <button
            type="button"
            onClick={() => setPhoneHitSound(!phoneHitSound)}
            title="Toggle Hit Confirmation Tick on Phone Speaker"
            className={`p-1.5 rounded-lg border text-[11px] font-bold transition ${
              phoneHitSound
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                : 'bg-slate-800 border-white/15 text-slate-400'
            }`}
          >
            {phoneHitSound ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Weapon Assist Quick-Toggle Strip */}
      <div className="px-3 py-1.5 bg-slate-900/60 border-b border-white/10 grid grid-cols-3 gap-1.5 z-10">
        <button
          type="button"
          onClick={() => updateWeaponOptions({ autoFire: !autoFire })}
          className={`py-1 px-2 rounded-xl border text-[10px] font-display font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition active:scale-95 ${
            autoFire
              ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300'
              : 'bg-slate-900 border-white/10 text-slate-400'
          }`}
        >
          <Flame className="w-3 h-3 shrink-0" />
          <span>Auto-Fire: {autoFire ? 'ON' : 'OFF'}</span>
        </button>

        <button
          type="button"
          onClick={() => updateWeaponOptions({ autoReload: !autoReload })}
          className={`py-1 px-2 rounded-xl border text-[10px] font-display font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition active:scale-95 ${
            autoReload
              ? 'bg-cyan-950/90 border-cyan-400 text-cyan-300'
              : 'bg-slate-900 border-white/10 text-slate-400'
          }`}
        >
          <RefreshCw className="w-3 h-3 shrink-0" />
          <span>Auto-Reload: {autoReload ? 'ON' : 'OFF'}</span>
        </button>

        <button
          type="button"
          onClick={() => updateWeaponOptions({ unlimitedAmmo: !unlimitedAmmo })}
          className={`py-1 px-2 rounded-xl border text-[10px] font-display font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition active:scale-95 ${
            unlimitedAmmo
              ? 'bg-amber-950/90 border-amber-400 text-amber-300'
              : 'bg-slate-900 border-white/10 text-slate-400'
          }`}
        >
          <InfinityIcon className="w-3 h-3 shrink-0" />
          <span>Unlimited: {unlimitedAmmo ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Phase C: Custom Gun-Style Visual + Weapon Selector & Combo Badge */}
      <div className="px-3 py-2 bg-slate-950/90 border-b border-white/10 flex flex-col gap-1.5 z-10">
        <div className="flex items-center justify-between gap-2">
          {/* Custom SVG Light-Gun Blaster Silhouette in Player's Color / Skin */}
          <div className="flex items-center gap-2.5 min-w-0">
            <svg viewBox="0 0 120 44" className="w-20 h-8 shrink-0">
              <path
                d="M10 12 H96 L108 18 V26 H72 L64 38 H46 L52 26 H26 L18 40 H6 L12 22 Z"
                fill="#0f172a"
                stroke={gunSkinColor}
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <rect x="24" y="16" width="54" height="5" rx="2" fill={gunSkinColor} />
              <circle cx="88" cy="20" r="3" fill="#ffbe0b" />
            </svg>
            <div className="min-w-0">
              <div
                className="font-display font-bold text-xs tracking-wider truncate"
                style={{ color: weaponDef.color }}
              >
                {weaponDef.name}
              </div>
              <div className="text-[10px] font-mono text-slate-300 flex items-center gap-2">
                <span>HP: {Math.round(hp)}%</span>
                {multiplier > 1 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-400/20 border border-amber-400 text-amber-300 font-bold">
                    {multiplier}X COMBO ({combo})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 4-Weapon Selector Bar */}
          <div className="flex items-center gap-1 shrink-0">
            {(['pistol', 'shotgun', 'machine_gun', 'grenade_launcher'] as WeaponType[]).map(
              (wKey) => {
                const w = WEAPONS[wKey];
                const active = currentWeapon === wKey;
                return (
                  <button
                    key={wKey}
                    type="button"
                    onClick={() => handleSwitchWeapon(wKey)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-display font-bold border transition ${
                      active
                        ? 'bg-white/15 text-white border-amber-400'
                        : 'bg-slate-900 text-slate-400 border-white/10'
                    }`}
                  >
                    {w.shortName === 'MACHINE GUN' ? 'SMG' : w.shortName}
                  </button>
                );
              }
            )}
          </div>
        </div>
      </div>

      {/* Middle Interactive Radar / Trackpad Zone OR High-Score Initials Entry */}
      <div className="flex-1 flex flex-col items-center justify-center p-2.5 relative overflow-y-auto">
        {/* Phase B: 3-Letter High-Score Initials Entry on Phone when Match Ends */}
        {(gamePhase === 'VICTORY' || gamePhase === 'GAME_OVER') && (
          <div className="mb-3 w-full max-w-xs bg-slate-900/95 border-2 border-amber-400 rounded-2xl p-3.5 text-center space-y-2 shadow-2xl z-20">
            <div className="flex items-center justify-center gap-1.5 text-amber-300 font-display font-bold text-sm">
              <Trophy className="w-4 h-4" />
              <span>ENTER 3-LETTER ARCADE INITIALS</span>
            </div>
            {scoreSubmitted ? (
              <div className="py-1.5 text-xs font-mono font-bold text-emerald-300">
                ✓ HIGH SCORE INITIALS ({initials}) SAVED TO SERVER!
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <input
                  type="text"
                  maxLength={3}
                  value={initials}
                  onChange={(e) =>
                    setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  className="w-24 text-center bg-slate-950 border-2 border-cyan-400 rounded-xl py-1.5 font-mono font-extrabold text-xl tracking-widest text-amber-300 uppercase outline-none"
                />
                <button
                  type="button"
                  onClick={handleSubmitHighScore}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-display font-bold text-xs tracking-wider uppercase active:scale-95"
                >
                  SAVE SCORE
                </button>
              </div>
            )}
          </div>
        )}

        {/* Downed Alert Banner on Phone */}
        {isDowned && (
          <div className="mb-2 px-4 py-2 rounded-xl bg-rose-600/90 border-2 border-amber-300 text-center animate-pulse">
            <div className="font-display font-bold text-xs text-white">
              🚨 YOU ARE DOWN! ({downedSec}s)
            </div>
            <div className="text-[10px] font-mono text-amber-200">
              TEAMMATES CAN SHOOT YOUR BEACON ON TV TO REVIVE YOU!
            </div>
          </div>
        )}

        {!touchMode && !sensorStreaming && (
          <button
            type="button"
            onClick={unlockAndStartSensors}
            className="mb-2 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-display font-bold text-xs tracking-wider uppercase shadow-lg flex items-center gap-2 animate-bounce"
          >
            <Smartphone className="w-4 h-4" />
            <span>Tap Here to Enable Phone Motion Sensor</span>
          </button>
        )}

        {targetLocked && !isDowned && (
          <div className="mb-1.5 px-3 py-0.5 rounded-lg bg-rose-600/90 border border-amber-300 text-xs font-display font-bold tracking-widest text-white animate-pulse">
            🎯 TARGET LOCKED {autoFire ? '— AUTO-FIRING!' : '— TAP FIRE!'}
          </div>
        )}

        {touchMode ? (
          <div
            ref={touchAreaRef}
            onTouchMove={handleTouchMove}
            onMouseMove={(e) => e.buttons === 1 && handleTouchMove(e)}
            className="w-full h-36 bg-slate-900/70 border-2 border-dashed border-cyan-400/40 rounded-2xl flex flex-col items-center justify-center relative touch-none shadow-inner"
          >
            <div
              className="absolute w-8 h-8 rounded-full border-2 border-white pointer-events-none transform -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
              style={{
                left: `${aimCoords.x * 100}%`,
                top: `${aimCoords.y * 100}%`,
                borderColor: playerColor,
              }}
            />
            <Crosshair className="w-8 h-8 text-slate-600 mb-1" />
            <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">
              Drag Thumb to Aim Anywhere on TV
            </div>
          </div>
        ) : (
          /* Flat-Phone Tilt Aim Radar */
          <div
            onClick={() => {
              if (!sensorStreaming) unlockAndStartSensors();
            }}
            className="relative w-40 h-40 rounded-2xl border-2 border-white/15 bg-slate-900/60 flex items-center justify-center shadow-inner"
          >
            <span className="absolute top-1 text-[8px] font-mono font-bold text-cyan-400/80 uppercase">
              TOP ↑
            </span>
            <span className="absolute bottom-1 text-[8px] font-mono font-bold text-amber-400/80 uppercase">
              BOTTOM ↓
            </span>
            <span className="absolute left-1.5 text-[8px] font-mono font-bold text-slate-400 uppercase">
              ← L
            </span>
            <span className="absolute right-1.5 text-[8px] font-mono font-bold text-slate-400 uppercase">
              R →
            </span>

            <div className="absolute w-full h-[1px] bg-white/10" />
            <div className="absolute h-full w-[1px] bg-white/10" />
            <div className="w-7 h-7 rounded-full border border-dashed border-emerald-400/50" />

            <div
              className="absolute w-6 h-6 rounded-full border-2 transition-transform duration-75 flex items-center justify-center"
              style={{
                transform: `translate(${(aimCoords.x - 0.5) * 120}px, ${(aimCoords.y - 0.5) * 120}px)`,
                borderColor: targetLocked ? '#ffbe0b' : playerColor,
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: targetLocked ? '#ffbe0b' : playerColor }}
              />
            </div>
          </div>
        )}

        {!touchMode && (
          <div className="mt-1.5 text-[10px] font-mono text-slate-300 flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded font-bold ${
                !sensorStreaming
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-400/40'
                  : isFlatCentered
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                  : 'bg-slate-900 text-cyan-300 border border-cyan-400/30'
              }`}
            >
              {!sensorStreaming
                ? '⚠️ TAP FLAT TO START SENSOR'
                : isFlatCentered
                ? '🟢 FLAT (CENTERED)'
                : `🟢 L/R: ${tiltDeg.yaw}° • U/D: ${tiltDeg.pitch}°`}
            </span>
          </div>
        )}

        {/* Ammo Readout */}
        <div className="mt-2 w-full max-w-xs text-center">
          {unlimitedAmmo ? (
            <div className="py-1 px-3 rounded-xl bg-amber-500/15 border border-amber-400/50 inline-flex items-center gap-1.5 text-amber-300 font-display font-bold text-xs tracking-wider">
              <InfinityIcon className="w-3.5 h-3.5" />
              <span>UNLIMITED AMMO ACTIVE</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg font-mono font-extrabold tabular-nums text-white">
                {currentAmmo}
              </span>
              <span className="text-slate-400 text-xs font-mono font-bold uppercase">
                / {maxAmmo} RDS ({weaponDef.shortName})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Gun Action Trigger Cluster */}
      <div className="p-3 bg-slate-900/95 border-t border-white/15 grid grid-cols-4 gap-3 z-10 pb-5">
        <button
          type="button"
          onClick={handleReload}
          disabled={unlimitedAmmo || isReloading || currentAmmo === maxAmmo}
          className={`col-span-1 rounded-2xl flex flex-col items-center justify-center p-2 border font-display font-bold uppercase tracking-wider text-xs transition active:scale-95 ${
            unlimitedAmmo || isReloading || currentAmmo === maxAmmo
              ? 'bg-slate-950 border-white/10 text-slate-600'
              : 'bg-slate-800 border-cyan-400/50 text-cyan-300 active:bg-slate-700'
          }`}
        >
          <RotateCcw className="w-5 h-5 mb-0.5" />
          <span>Reload</span>
        </button>

        <button
          type="button"
          onClick={handleShoot}
          disabled={isDowned || (!unlimitedAmmo && isReloading)}
          className={`col-span-3 py-4 rounded-2xl font-display font-bold uppercase text-2xl tracking-wider flex items-center justify-center gap-3 transition-all transform active:scale-95 shadow-2xl relative overflow-hidden text-slate-950 ${
            isDowned || (!unlimitedAmmo && isReloading)
              ? 'bg-slate-800 text-neutral-500 opacity-60'
              : isFiring
              ? 'scale-95 ring-4 ring-white'
              : ''
          }`}
          style={{
            backgroundColor:
              isDowned || (!unlimitedAmmo && isReloading) ? '#1e293b' : gunSkinColor,
          }}
        >
          <Zap className="w-7 h-7 fill-current" />
          <span>{isDowned ? 'DOWNED' : autoFire ? 'FIRE (AUTO ON)' : 'FIRE'}</span>
        </button>
      </div>

      {/* Phase E: Unlockable Rewards Locker Modal (Weapon Skins, Crosshair Styles, Zombie Themes) */}
      {rewardsOpen && (
        <div className="fixed inset-0 bg-slate-950/92 z-50 flex flex-col justify-between p-4 overflow-y-auto">
          <div className="max-w-md mx-auto w-full space-y-4">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-amber-300 flex items-center gap-2">
                  <Ticket className="w-5 h-5" />
                  <span>ARCADE REWARDS LOCKER</span>
                </h2>
                <p className="text-xs text-slate-300">
                  Your Balance: <strong className="text-amber-300">🎟️ {tickets} Tickets</strong>{' '}
                  (Saved to your player name)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRewardsOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {REWARDS_CATALOG.map((item) => {
                const isUnlocked = unlockedRewards.includes(item.id);
                const isEquipped =
                  equippedSkin === item.id || equippedCrosshair === item.id;
                const canAfford = tickets >= item.costTickets;

                return (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-900 border border-white/15 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-lg border border-white/40 shrink-0"
                        style={{ backgroundColor: item.previewColor }}
                      />
                      <div className="min-w-0">
                        <div className="font-display font-bold text-xs text-white flex items-center gap-1.5">
                          <span>{item.name}</span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-white/10 text-cyan-300">
                            {item.category.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {item.description}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRewardAction(item.id)}
                      disabled={!isUnlocked && !canAfford}
                      className={`px-3 py-1.5 rounded-lg font-display font-bold text-xs shrink-0 flex items-center gap-1 ${
                        isEquipped
                          ? 'bg-emerald-500/30 border border-emerald-400 text-emerald-200'
                          : isUnlocked
                          ? 'bg-cyan-500 text-slate-950'
                          : canAfford
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {isEquipped ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Equipped</span>
                        </>
                      ) : isUnlocked ? (
                        <span>Equip</span>
                      ) : (
                        <>
                          <Lock className="w-3 h-3" />
                          <span>🎟️ {item.costTickets}</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setRewardsOpen(false)}
              className="w-full py-3 rounded-xl bg-cyan-400 text-slate-950 font-display font-bold text-sm uppercase tracking-wider"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
