import { HapticPatternType } from '../../shared/types.ts';

/**
 * Haptic Feedback Utility for Mobile Gun Controller
 * Distinct vibration patterns per weapon (Pistol, Shotgun, Machine Gun, Grenade Launcher)
 */
export function triggerHaptic(pattern: HapticPatternType) {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;

  try {
    switch (pattern) {
      case 'shoot':
      case 'shoot_pistol':
        navigator.vibrate(25);
        break;
      case 'shoot_shotgun':
        // Heavy double-pump recoil thump
        navigator.vibrate([55, 25, 40]);
        break;
      case 'shoot_machine_gun':
        // Crisp rapid staccato pulse
        navigator.vibrate(16);
        break;
      case 'shoot_grenade':
        // Deep explosive launcher rumble
        navigator.vibrate([70, 30, 85]);
        break;
      case 'hit':
        navigator.vibrate([35, 30, 50]);
        break;
      case 'coop_bonus':
        navigator.vibrate([40, 25, 40, 25, 65]);
        break;
      case 'reload':
        navigator.vibrate([25, 50, 25, 50, 40]);
        break;
      case 'damage':
        navigator.vibrate([120, 60, 150]);
        break;
      case 'empty':
        navigator.vibrate([15, 30, 15]);
        break;
    }
  } catch {
    // Ignore errors on browsers that block vibration
  }
}
