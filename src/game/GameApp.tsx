import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ThreeScene } from './ThreeScene.ts';
import { AudioManager } from './AudioManager.ts';
import { HudOverlay, ArcadeHitPopup } from './HudOverlay.tsx';
import { LobbyView } from './LobbyView.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { ScoreboardView } from './ScoreboardView.tsx';
import { SimulatorControls } from './SimulatorControls.tsx';
import {
  GameWorldState,
  ServerMessage,
  ClientMessage,
  ServerNetworkInfo,
  GameSettings,
  PlayerInfo,
  GamePhase,
} from '../../shared/types.ts';
import { DEFAULT_SETTINGS, WEAPONS } from '../../shared/config.ts';

export const GameApp: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const threeSceneRef = useRef<ThreeScene | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Network & Server State
  const [networkInfo, setNetworkInfo] = useState<ServerNetworkInfo | null>(null);
  const [worldState, setWorldState] = useState<GameWorldState>({
    phase: 'LOBBY',
    countdownSeconds: 3,
    currentWave: 1,
    stageIndex: 0,
    stageName: 'STAGE 1: NEON DOWNTOWN',
    barricadeHp: 100,
    maxBarricadeHp: 100,
    zombies: [],
    powerups: [],
    players: [],
    settings: { ...DEFAULT_SETTINGS },
    effects: { freezeRemainingMs: 0, doubleDamageRemainingMs: 0 },
    intermissionCountdown: 0,
    serverTickRate: 30,
    slowMoRemainingMs: 0,
    highScores: [],
  });

  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastHitPlayerId, setLastHitPlayerId] = useState<string | null>(null);
  const [hitPopups, setHitPopups] = useState<ArcadeHitPopup[]>([]);

  // Debug Overlays (F3 = Perf & Tick Rate, Key H = Hitboxes, Key K = Audio Preview)
  const [f3DebugActive, setF3DebugActive] = useState(false);
  const [measuredFps, setMeasuredFps] = useState(60);
  const [hitboxDebugActive, setHitboxDebugActive] = useState(false);
  const [debugBanner, setDebugBanner] = useState<string | null>(null);

  const hostPlayerIdRef = useRef<string | null>(null);
  const hostJoinSentRef = useRef<boolean>(false);
  const playersRef = useRef<PlayerInfo[]>([]);
  const settingsRef = useRef<GameSettings>({ ...DEFAULT_SETTINGS });
  const prevPhaseRef = useRef<GamePhase>('LOBBY');
  const prevWaveRef = useRef<number>(1);
  const pendingQueueRef = useRef<ClientMessage[]>([]);

  useEffect(() => {
    settingsRef.current = worldState.settings;
    playersRef.current = worldState.players;
  }, [worldState.settings, worldState.players]);

  // Poll measured FPS once per second when F3 overlay is open
  useEffect(() => {
    if (!f3DebugActive) return;
    const interval = window.setInterval(() => {
      if (threeSceneRef.current) {
        setMeasuredFps(threeSceneRef.current.getMeasuredFps());
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [f3DebugActive]);

  const showTransientDebugBanner = useCallback((text: string) => {
    setDebugBanner(text);
    setTimeout(() => {
      setDebugBanner((curr) => (curr === text ? null : curr));
    }, 2800);
  }, []);

  const spawnHudPopup = useCallback(
    (x: number, y: number, text: string, color: string, headshot = false, subtext?: string) => {
      const popupId = `pop_${Date.now()}_${Math.random()}`;
      const newPopup: ArcadeHitPopup = {
        id: popupId,
        x,
        y: Math.max(0.08, y),
        text,
        subtext,
        color,
        headshot,
      };
      setHitPopups((prev) => [...prev.slice(-9), newPopup]);
      setTimeout(() => {
        setHitPopups((prev) => prev.filter((p) => p.id !== popupId));
      }, 950);
    },
    []
  );

  // Safe WebSocket sender that never throws InvalidStateError when socket is CONNECTING or CLOSED
  const sendMessage = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
        return;
      } catch (err) {
        console.warn('WebSocket send failed, falling back:', err);
      }
    }

    if (msg.type !== 'aim') {
      pendingQueueRef.current.push(msg);
    }

    if (
      msg.type === 'start_game' ||
      msg.type === 'restart_game' ||
      msg.type === 'update_settings' ||
      msg.type === 'spawn_bots' ||
      msg.type === 'remove_bots'
    ) {
      fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.world) {
            setWorldState(data.world);
            threeSceneRef.current?.updateState(data.world, 1 / 30);
          }
        })
        .catch(() => {});
    }
  }, []);

  // 1. Fetch Server Info (Network IP, QR code) & Initial State
  useEffect(() => {
    fetch('/api/info')
      .then((res) => res.json())
      .then((data: ServerNetworkInfo) => setNetworkInfo(data))
      .catch((err) => console.warn('Could not fetch /api/info:', err));

    fetch('/api/state')
      .then((res) => res.json())
      .then((data) => {
        if (data?.world) setWorldState(data.world);
      })
      .catch(() => {});
  }, []);

  // 2. Initialize Three.js Scene and Audio
  useEffect(() => {
    const audio = new AudioManager();
    audioRef.current = audio;
    const savedAudio = audio.getAudioSettings();
    setIsMuted(savedAudio.muted);

    if (mountRef.current && !threeSceneRef.current) {
      threeSceneRef.current = new ThreeScene(mountRef.current);
    }

    return () => {
      threeSceneRef.current?.dispose();
      threeSceneRef.current = null;
      audioRef.current?.stopBackgroundMusic();
      wsRef.current?.close();
    };
  }, []);

  // Phase & Wave Audio Stinger / Announcer Watcher
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    const currPhase = worldState.phase;
    const prevWave = prevWaveRef.current;
    const currWave = worldState.currentWave;

    if (prevPhase !== currPhase) {
      if (currPhase === 'PLAYING') {
        audioRef.current?.playStinger('wave_start');
        audioRef.current?.playAnnouncer('wave_start');
      } else if (currPhase === 'WAVE_CLEARED' || currPhase === 'BONUS_ROUND') {
        audioRef.current?.playStinger('wave_cleared');
      } else if (currPhase === 'VICTORY') {
        audioRef.current?.playStinger('victory');
        audioRef.current?.playAnnouncer('victory');
      } else if (currPhase === 'GAME_OVER') {
        audioRef.current?.playStinger('defeat');
        audioRef.current?.playAnnouncer('defeat');
      }
      prevPhaseRef.current = currPhase;
    } else if (currPhase === 'PLAYING' && currWave !== prevWave) {
      audioRef.current?.playStinger('wave_start');
      audioRef.current?.playAnnouncer('wave_start');
    }
    prevWaveRef.current = currWave;
  }, [worldState.phase, worldState.currentWave]);

  // 3. Connect WebSocket
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
      while (pendingQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
        const nextMsg = pendingQueueRef.current.shift();
        if (nextMsg) {
          try {
            ws.send(JSON.stringify(nextMsg));
          } catch {
            // ignore
          }
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        if (msg.type === 'phone_joined') {
          hostPlayerIdRef.current = msg.player.id;
        } else if (msg.type === 'lobby_update') {
          setWorldState((prev) => ({
            ...prev,
            players: msg.players,
            settings: msg.settings,
            phase: msg.phase,
          }));

          threeSceneRef.current?.applyModeAtmosphere(msg.settings.mode === 'kids');
          audioRef.current?.setKidsMode(msg.settings.mode === 'kids');
          audioRef.current?.setTheme(msg.settings.theme);
          if (msg.settings.scareLevel) {
            audioRef.current?.setScareLevel(msg.settings.scareLevel);
          }
        } else if (msg.type === 'game_tick') {
          setWorldState(msg.world);
          threeSceneRef.current?.updateState(msg.world, 1 / 30);

          if (msg.world.phase === 'PLAYING') {
            audioRef.current?.updateZombieVoices(msg.world.zombies);
            audioRef.current?.updateDynamicMusicState(
              msg.world.currentWave,
              msg.world.zombies,
              msg.world.barricadeHp,
              msg.world.maxBarricadeHp
            );
          }
        } else if (msg.type === 'highscores_updated') {
          setWorldState((prev) => ({ ...prev, highScores: msg.highScores }));
          showTransientDebugBanner('🏆 NEW HIGH SCORE RECORDED TO SERVER LEADERBOARD!');
        } else if (msg.type === 'boss_spawned') {
          threeSceneRef.current?.triggerCameraShake(0.72);
          audioRef.current?.playBossEntranceRoar(msg.position);
          setTimeout(() => {
            audioRef.current?.playAnnouncer('boss_incoming');
          }, 450);
          showTransientDebugBanner(
            `⚠️ BOSS ARRIVAL: ${msg.bossName || 'NECRO OVERLORD'} — AIM FOR WEAK POINT!`
          );
        } else if (msg.type === 'hit_event') {
          setLastHitPlayerId(msg.playerId);
          setTimeout(() => setLastHitPlayerId(null), 130);

          audioRef.current?.playGunshot();
          audioRef.current?.playHit(msg.headshot);
          audioRef.current?.playZombieVoice3D(
            msg.zombieId,
            msg.zombieType || 'normal',
            msg.killed ? 'death' : 'hit',
            msg.position
          );

          const shooter = playersRef.current.find((p) => p.id === msg.playerId);
          const shooterColor = shooter?.color || '#00f5d4';
          const shooterSlot = shooter?.slot || 1;
          const aimX = shooter?.crosshair.x ?? 0.5;
          const aimY = shooter?.crosshair.y ?? 0.5;
          const weaponDef = WEAPONS[msg.weapon || shooter?.weapon || 'pistol'] || WEAPONS.pistol;

          // Phase A: Weapon-scaled camera shake & Hit-Stop freeze on heavy/critical hits
          threeSceneRef.current?.triggerCameraShake(
            msg.weakPointHit || msg.isBossKill
              ? 0.55
              : msg.headshot
              ? Math.max(0.24, weaponDef.shakeIntensity)
              : weaponDef.shakeIntensity * 0.65
          );
          if (msg.weakPointHit || msg.headshot || msg.killed || weaponDef.id === 'grenade_launcher') {
            threeSceneRef.current?.triggerHitStop(msg.isBossKill ? 90 : 42);
          }

          // Fire 3D Laser Tracer Beam from barricade cannon to zombie
          threeSceneRef.current?.firePlayerLaser(
            shooterSlot,
            aimX,
            aimY,
            shooterColor,
            msg.position
          );

          // Trigger zombie hit flash & recoil stagger
          threeSceneRef.current?.zombieManager.triggerHitFlash(msg.zombieId);

          // Floating Arcade Score + Combo/Headshot/WeakPoint Callout Popup
          const pts = msg.scoreAwarded || (msg.headshot ? 50 : 20);
          const multTag = msg.multiplier && msg.multiplier > 1 ? ` (${msg.multiplier}X)` : '';
          const titleText = msg.weakPointHit
            ? `+${pts} WEAK POINT!${multTag}`
            : msg.headshot
            ? `+${pts} HEADSHOT!${multTag}`
            : `+${pts} HIT!${multTag}`;
          const subText = msg.isBossKill
            ? '🔥 BOSS DEFEATED! 🔥'
            : msg.killed
            ? 'ZOMBIE ELIMINATED!'
            : msg.combo && msg.combo >= 3
            ? `${msg.combo} HIT STREAK!`
            : undefined;

          spawnHudPopup(aimX, aimY - 0.04, titleText, shooterColor, msg.headshot, subText);

          // Impact 3D particles & shockwave ring (or Explosion for Grenade Launcher / Weak Point)
          const currentSettings = settingsRef.current;
          const isKids = currentSettings.mode === 'kids' || currentSettings.theme === 'cartoon';
          if (weaponDef.id === 'grenade_launcher' || msg.weakPointHit) {
            threeSceneRef.current?.particleSystem.spawnExplosion(
              msg.position.x,
              msg.position.y + 1.2,
              msg.position.z,
              isKids
            );
          } else {
            const particleType = msg.headshot
              ? 'headshot'
              : currentSettings.theme === 'robot'
              ? 'sparks'
              : isKids
              ? 'confetti'
              : 'blood';

            threeSceneRef.current?.particleSystem.spawnImpact(
              msg.position.x,
              msg.position.y + 1.1,
              msg.position.z,
              particleType,
              shooterColor
            );
          }
        } else if (msg.type === 'coop_combo') {
          audioRef.current?.playPowerup();
          spawnHudPopup(
            0.5,
            0.34,
            `+${msg.bonusScore} CO-OP CROSSFIRE BONUS!`,
            '#ffbe0b',
            true,
            msg.playerNames.join(' + ')
          );
        } else if (msg.type === 'civilian_hit') {
          audioRef.current?.playBarricadeHit();
          threeSceneRef.current?.triggerCameraShake(0.45);
          spawnHudPopup(
            0.5,
            0.4,
            `-${msg.penalty} DON'T SHOOT CIVILIANS!`,
            '#f43f5e',
            false,
            `${msg.playerName} COMBO RESET!`
          );
        } else if (msg.type === 'player_downed') {
          audioRef.current?.playBarricadeHit();
          showTransientDebugBanner(
            `🚨 ${msg.playerName} IS DOWN! SHOOT THEIR BEACON WITHIN 10s TO REVIVE!`
          );
        } else if (msg.type === 'player_revived') {
          audioRef.current?.playPowerup();
          showTransientDebugBanner(`💚 ${msg.reviverName} REVIVED ${msg.playerName}! (+200 PTS)`);
        } else if (msg.type === 'barricade_damaged') {
          threeSceneRef.current?.triggerBarricadeHit();
          audioRef.current?.playBarricadeHit();
        } else if (msg.type === 'powerup_collected') {
          audioRef.current?.playPowerup();
          if (msg.weaponGranted && WEAPONS[msg.weaponGranted]) {
            showTransientDebugBanner(
              `🔫 WEAPON CRATE EQUIPPED: ${WEAPONS[msg.weaponGranted].name}!`
            );
          }
        }
      } catch (err) {
        console.error('Error in WS message:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 1500);
    };

    wsRef.current = ws;
  }, [showTransientDebugBanner, spawnHudPopup]);

  useEffect(() => {
    connectWebSocket();
  }, [connectWebSocket]);

  // Unlock Audio Handler
  const handleUnlockAudio = useCallback(async () => {
    const ok = await audioRef.current?.unlockAudio();
    if (ok) {
      setAudioUnlocked(true);
      showTransientDebugBanner('🔊 3D HORROR SOUNDSCAPE & HRTF AUDIO UNLOCKED');
    }
  }, [showTransientDebugBanner]);

  // Game Control Actions
  const handleStartGame = useCallback(() => {
    handleUnlockAudio();
    sendMessage({ type: 'start_game' });
  }, [handleUnlockAudio, sendMessage]);

  const handleSkipTutorial = useCallback(() => {
    sendMessage({ type: 'skip_tutorial' });
  }, [sendMessage]);

  const handleRestartGame = useCallback(() => {
    sendMessage({ type: 'restart_game' });
  }, [sendMessage]);

  const handleUpdateSettings = useCallback(
    (newSettings: Partial<GameSettings>) => {
      if (newSettings.postProcessingQuality) {
        threeSceneRef.current?.setQualityMode(newSettings.postProcessingQuality);
      }
      if (
        newSettings.masterVolume !== undefined ||
        newSettings.musicVolume !== undefined ||
        newSettings.sfxVolume !== undefined ||
        newSettings.voiceVolume !== undefined ||
        newSettings.scareLevel !== undefined ||
        newSettings.phoneHitSound !== undefined
      ) {
        audioRef.current?.saveSettings({
          masterVolume: newSettings.masterVolume,
          musicVolume: newSettings.musicVolume,
          sfxVolume: newSettings.sfxVolume,
          voiceVolume: newSettings.voiceVolume,
          scareLevel: newSettings.scareLevel,
          phoneHitSound: newSettings.phoneHitSound,
        });
      }
      sendMessage({ type: 'update_settings', settings: newSettings });
    },
    [sendMessage]
  );

  const handleSpawnBots = useCallback(
    (count: number) => {
      sendMessage({ type: 'spawn_bots', count });
    },
    [sendMessage]
  );

  const handleRemoveBots = useCallback(() => {
    sendMessage({ type: 'remove_bots' });
  }, [sendMessage]);

  const handleToggleMute = useCallback(() => {
    const muted = audioRef.current?.toggleMute() ?? false;
    setIsMuted(muted);
    showTransientDebugBanner(
      muted ? '🔇 MASTER AUDIO MUTED [Key M]' : '🔊 MASTER AUDIO UNMUTED [Key M]'
    );
  }, [showTransientDebugBanner]);

  // Keyboard shortcut listener:
  // - F3: Toggle Performance & Server Tick Rate Debug Overlay
  // - Key H: Toggle 3D Hitbox Wireframes (Head Sphere + Body Capsule)
  // - Key K: Cycle & Preview Sound Categories on TV
  // - Key M: Toggle Mute All Audio
  // - Space/Enter: Start or Restart
  // - Esc: Close Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'F3' || e.key === 'F3') {
        e.preventDefault();
        setF3DebugActive((prev) => !prev);
        if (threeSceneRef.current) {
          setMeasuredFps(threeSceneRef.current.getMeasuredFps());
        }
      } else if (e.code === 'KeyH') {
        const visible = threeSceneRef.current?.toggleHitboxDebug() ?? false;
        setHitboxDebugActive(visible);
        const fps = threeSceneRef.current?.getMeasuredFps() ?? 60;
        showTransientDebugBanner(
          visible
            ? `🟡 3D HITBOX DEBUG ON (Head Sphere + Body Capsule) · ${fps} FPS`
            : '⚪ 3D HITBOX DEBUG OFF'
        );
      } else if (e.code === 'KeyK') {
        setAudioUnlocked(true);
        const res = audioRef.current?.triggerDebugSoundPreview();
        if (res) {
          showTransientDebugBanner(`🎵 AUDIO PREVIEW [${res.category}]: ${res.description}`);
        }
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        if (worldState.phase === 'LOBBY') {
          handleStartGame();
        } else if (worldState.phase === 'TUTORIAL') {
          handleSkipTutorial();
        } else if (worldState.phase === 'GAME_OVER' || worldState.phase === 'VICTORY') {
          handleRestartGame();
        }
      } else if (e.code === 'Escape') {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    worldState.phase,
    handleStartGame,
    handleSkipTutorial,
    handleRestartGame,
    handleToggleMute,
    showTransientDebugBanner,
  ]);

  // Audio Controls
  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    audioRef.current?.setSoundEnabled(next);
    if (next) handleUnlockAudio();
  };

  const toggleMusic = () => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    audioRef.current?.setMusicEnabled(next);
    if (next) handleUnlockAudio();
  };

  // PC Mouse Gun Aim Handler for local testing
  const ensureHostPlayer = () => {
    if (hostPlayerIdRef.current) return;
    const existing = playersRef.current.find((p) => p.name === 'PC Host');
    if (existing) {
      hostPlayerIdRef.current = existing.id;
      return;
    }
    if (!hostJoinSentRef.current) {
      hostJoinSentRef.current = true;
      sendMessage({
        type: 'phone_join',
        name: 'PC Host',
        color: '#00f5d4',
      });
    }
  };

  const handleMouseAim = (x: number, y: number) => {
    ensureHostPlayer();
    sendMessage({ type: 'aim', x, y });
  };

  const handleMouseShoot = () => {
    ensureHostPlayer();
    handleUnlockAudio();
    const hostPlayer = playersRef.current.find((p) => p.name === 'PC Host');
    if (hostPlayer && (hostPlayer.ammo > 0 || hostPlayer.unlimitedAmmo) && !hostPlayer.isReloading) {
      audioRef.current?.playGunshot();
      threeSceneRef.current?.firePlayerLaser(
        hostPlayer.slot,
        hostPlayer.crosshair.x,
        hostPlayer.crosshair.y,
        hostPlayer.color
      );
    } else {
      audioRef.current?.playEmptyClick();
    }
    sendMessage({ type: 'shoot' });
  };

  const handleMouseReload = () => {
    ensureHostPlayer();
    audioRef.current?.playReload();
    sendMessage({ type: 'reload' });
  };

  const connectedPlayersCount = worldState.players.filter((p) => p.isConnected).length;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none">
      {/* Isolated Three.js WebGL Mount Container */}
      <div ref={mountRef} className="absolute inset-0 z-0 w-full h-full" />

      {/* Standing Rule: F3 Debug Overlay (FPS, Server Tick Rate, Connected Players, Active Zombies, Quality) */}
      {f3DebugActive && (
        <div className="fixed top-14 left-3 z-50 bg-slate-950/90 backdrop-blur-md border border-emerald-400/70 rounded-xl p-3 font-mono text-xs text-emerald-300 space-y-1 shadow-2xl pointer-events-auto">
          <div className="flex items-center justify-between gap-4 border-b border-white/15 pb-1">
            <span className="font-bold text-white">[F3] ARCADE TELEMETRY</span>
            <button
              type="button"
              onClick={() => setF3DebugActive(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div>
            CLIENT FPS: <strong className="text-amber-300">{measuredFps} FPS</strong>{' '}
            {threeSceneRef.current?.isSoftwareRenderer() ? '(Software WebGL)' : '(Hardware GPU)'}
          </div>
          <div>
            SERVER TICK RATE:{' '}
            <strong className="text-cyan-300">{worldState.serverTickRate || 30} Hz</strong>
          </div>
          <div>
            CONNECTED PLAYERS:{' '}
            <strong className="text-white">{connectedPlayersCount}</strong> (
            {worldState.players.filter((p) => p.isBot).length} Bots)
          </div>
          <div>
            ACTIVE ZOMBIES: <strong className="text-rose-300">{worldState.zombies.length}</strong>
          </div>
          <div>
            POST-FX QUALITY:{' '}
            <strong className="text-fuchsia-300 uppercase">
              {threeSceneRef.current?.getQualityMode() || 'high'}
            </strong>
          </div>
        </div>
      )}

      {/* On-Screen Toast Banner for Hitbox Debug (Key H), Audio Preview (Key K), Mute (Key M), or Boss Roar */}
      {(debugBanner || hitboxDebugActive) && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-1.5">
          {debugBanner && (
            <div className="px-4 py-2 rounded-xl bg-slate-950/85 backdrop-blur-md border border-cyan-400/70 text-xs font-mono font-bold text-cyan-200 shadow-lg">
              {debugBanner}
            </div>
          )}
          {hitboxDebugActive && (
            <div className="px-3 py-1 rounded-lg bg-amber-500/25 backdrop-blur-md border border-amber-400/70 text-[11px] font-mono font-bold text-amber-200">
              [Key H] HITBOX OVERLAY ACTIVE: Yellow = Head Sphere · Cyan = Body Capsule
            </div>
          )}
        </div>
      )}

      {/* Lobby Screen + Live Calibration Reticles for Connected Phones */}
      {worldState.phase === 'LOBBY' && (
        <>
          <LobbyView
            players={worldState.players}
            settings={worldState.settings}
            networkInfo={networkInfo}
            highScores={worldState.highScores}
            audioUnlocked={audioUnlocked}
            onUnlockAudio={handleUnlockAudio}
            onStartGame={handleStartGame}
            onOpenSettings={() => setSettingsOpen(true)}
            onSpawnBots={handleSpawnBots}
            onRemoveBots={handleRemoveBots}
          />
          {/* Live Aim Reticles in Lobby so players can test Flat-Phone Center & Tilt */}
          <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
            {worldState.players
              .filter((p) => !p.isBot && p.isConnected)
              .map((player) => (
                <div
                  key={player.id}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-transform duration-75 ease-out"
                  style={{
                    left: `${player.crosshair.x * 100}%`,
                    top: `${player.crosshair.y * 100}%`,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full border-2 flex items-center justify-center"
                    style={{
                      borderColor: player.color,
                      boxShadow: `0 0 14px ${player.color}`,
                    }}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: player.color }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {/* In-Game HUD (During Tutorial, Countdown, Playing, Bonus Round, or Wave Cleared) */}
      {(worldState.phase === 'TUTORIAL' ||
        worldState.phase === 'PLAYING' ||
        worldState.phase === 'COUNTDOWN' ||
        worldState.phase === 'BONUS_ROUND' ||
        worldState.phase === 'WAVE_CLEARED') && (
        <HudOverlay
          world={worldState}
          soundEnabled={soundEnabled && !isMuted}
          musicEnabled={musicEnabled && !isMuted}
          onToggleSound={toggleSound}
          onToggleMusic={toggleMusic}
          onReturnLobby={handleRestartGame}
          onSkipTutorial={handleSkipTutorial}
          onUpdateSettings={handleUpdateSettings}
          lastHitPlayerId={lastHitPlayerId}
          hitPopups={hitPopups}
        />
      )}

      {/* Scoreboard (Victory or Defeat) */}
      {(worldState.phase === 'GAME_OVER' || worldState.phase === 'VICTORY') && (
        <ScoreboardView world={worldState} onRestart={handleRestartGame} />
      )}

      {/* Settings Modal */}
      <SettingsModal
        settings={worldState.settings}
        isOpen={settingsOpen}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onClose={() => setSettingsOpen(false)}
        onSave={handleUpdateSettings}
      />

      {/* Simulator Hub for Testing without Phones */}
      <SimulatorControls
        phase={worldState.phase}
        onSpawnBots={handleSpawnBots}
        onRemoveBots={handleRemoveBots}
        onMouseAim={handleMouseAim}
        onMouseShoot={handleMouseShoot}
        onMouseReload={handleMouseReload}
      />
    </div>
  );
};
