/**
 * Wake Lock API wrapper to keep phone display awake during gameplay
 */

export class ScreenLockManager {
  private wakeLock: any = null;
  private isRequested = false;

  public async requestLock(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      console.debug('Screen Wake Lock API not supported on this browser.');
      return false;
    }

    try {
      this.isRequested = true;
      this.wakeLock = await (navigator as any).wakeLock.request('screen');

      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });

      // Re-request if visibility changes back to visible
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      return true;
    } catch (err) {
      console.warn('Wake Lock request error:', err);
      return false;
    }
  }

  public releaseLock() {
    this.isRequested = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  private handleVisibilityChange = async () => {
    if (this.isRequested && document.visibilityState === 'visible' && !this.wakeLock) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn('Could not re-acquire Wake Lock:', err);
      }
    }
  };
}
