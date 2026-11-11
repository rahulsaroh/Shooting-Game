export type PlatformHapticPattern =
  | 'tap'
  | 'select'
  | 'launch'
  | 'shoot'
  | 'boost'
  | 'ring'
  | 'hit'
  | 'damage'
  | 'stall'
  | 'victory';

export function triggerPlatformHaptic(pattern: PlatformHapticPattern): void {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;

  try {
    switch (pattern) {
      case 'tap':
        navigator.vibrate(18);
        break;
      case 'select':
        navigator.vibrate([22, 20, 32]);
        break;
      case 'launch':
        navigator.vibrate([40, 30, 60, 25, 90]);
        break;
      case 'shoot':
        navigator.vibrate(22);
        break;
      case 'boost':
        navigator.vibrate([50, 20, 75]);
        break;
      case 'ring':
        navigator.vibrate([30, 20, 55]);
        break;
      case 'hit':
        navigator.vibrate([35, 25, 45]);
        break;
      case 'damage':
        navigator.vibrate([110, 50, 140]);
        break;
      case 'stall':
        navigator.vibrate([45, 45, 45]);
        break;
      case 'victory':
        navigator.vibrate([50, 30, 50, 30, 90]);
        break;
    }
  } catch {
    // Ignore on browsers that block vibration
  }
}
