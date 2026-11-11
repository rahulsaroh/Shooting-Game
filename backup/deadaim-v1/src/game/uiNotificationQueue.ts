import { COMBO_CONFIG } from '../../shared/config.ts';

export interface QueuedBannerNotification {
  id: string;
  text: string;
  tone: 'amber' | 'cyan' | 'emerald' | 'rose' | 'fuchsia';
  enqueuedAt: number;
  durationMs: number;
}

export interface ArcadeHitPopup {
  id: string;
  targetKey: string;
  x: number;
  y: number;
  points: number;
  hitCount: number;
  text: string;
  color: string;
  headshot: boolean;
  updatedAt: number;
}

export interface TurretToast {
  id: string;
  playerId: string;
  slot: number;
  text: string;
  color: string;
  expiresAt: number;
}

/**
 * Phase 2: Central Notification Queue Rules
 * - Only one large banner is shown at a time.
 * - Queued banners older than 2000ms (2 seconds) are dropped when advancing the queue.
 */
export const MAX_BANNER_QUEUE_AGE_MS = 2000;
export const DEFAULT_BANNER_DURATION_MS = 1650;
export const SCORE_POPUP_LIFETIME_MS = 800;

export function filterFreshQueuedBanners(
  queue: QueuedBannerNotification[],
  now = Date.now()
): QueuedBannerNotification[] {
  return queue.filter((item) => now - item.enqueuedAt <= MAX_BANNER_QUEUE_AGE_MS);
}

export function dequeueNextFreshBanner(
  queue: QueuedBannerNotification[],
  now = Date.now()
): { next: QueuedBannerNotification | null; remaining: QueuedBannerNotification[] } {
  const fresh = filterFreshQueuedBanners(queue, now);
  if (fresh.length === 0) {
    return { next: null, remaining: [] };
  }
  return {
    next: fresh[0],
    remaining: fresh.slice(1),
  };
}

/**
 * Phase 2: Merge rapid hits on the same target into one updating popup (~0.8s fade)
 * instead of stacking duplicate popups.
 */
export function mergeOrCreateScorePopup(
  existing: ArcadeHitPopup[],
  params: {
    targetKey: string;
    x: number;
    y: number;
    points: number;
    label: 'HIT!' | 'HEADSHOT!' | 'WEAK POINT!' | 'CO-OP!' | 'PENALTY!';
    color: string;
    headshot: boolean;
    now?: number;
  }
): ArcadeHitPopup[] {
  const now = params.now ?? Date.now();
  // Filter out expired popups (> 800ms old)
  const active = existing.filter((p) => now - p.updatedAt < SCORE_POPUP_LIFETIME_MS);
  const clampedY = Math.max(0.14, Math.min(0.82, params.y));
  const clampedX = Math.max(0.08, Math.min(0.92, params.x));

  const idx = active.findIndex((p) => p.targetKey === params.targetKey);
  if (idx !== -1) {
    const prev = active[idx];
    const mergedPoints = prev.points + params.points;
    const mergedCount = prev.hitCount + 1;
    const sign = mergedPoints >= 0 ? '+' : '';
    const mergedPopup: ArcadeHitPopup = {
      ...prev,
      x: clampedX,
      y: clampedY,
      points: mergedPoints,
      hitCount: mergedCount,
      headshot: prev.headshot || params.headshot,
      color: params.color,
      text: `${sign}${mergedPoints} ${params.label}${mergedCount > 1 ? ` ×${mergedCount}` : ''}`,
      updatedAt: now,
    };
    const next = [...active];
    next[idx] = mergedPopup;
    return next;
  }

  const sign = params.points >= 0 ? '+' : '';
  const created: ArcadeHitPopup = {
    id: `pop_${params.targetKey}_${now}`,
    targetKey: params.targetKey,
    x: clampedX,
    y: clampedY,
    points: params.points,
    hitCount: 1,
    text: `${sign}${params.points} ${params.label}`,
    color: params.color,
    headshot: params.headshot,
    updatedAt: now,
  };

  return [...active.slice(-7), created];
}

/**
 * Phase 2: Format player hit-streak multiplier in place with a "MAX" cap label at 8X.
 */
export function formatStreakBadge(multiplier: number, combo: number): {
  label: string;
  isMax: boolean;
  progressPct: number;
} {
  const maxMult = COMBO_CONFIG.maxMultiplier || 8;
  const clampedMult = Math.max(1, Math.min(maxMult, multiplier));
  const isMax = clampedMult >= maxMult;
  const tierHits = COMBO_CONFIG.hitsPerMultiplierTier || 3;
  const progressPct = isMax ? 100 : Math.round(((combo % tierHits) / tierHits) * 100);
  return {
    label: isMax ? `${maxMult}X MAX` : `${clampedMult}X`,
    isMax,
    progressPct,
  };
}
