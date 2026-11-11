export interface TiltTelemetry {
  pitch: number; // degrees (-45 to +45)
  roll: number;  // degrees (-45 to +45)
  yaw: number;   // compass heading
  normPitch: number; // -1 (nose down) to +1 (nose up)
  normRoll: number;  // -1 (bank left) to +1 (bank right)
}

export type TiltListener = (data: TiltTelemetry) => void;

export class PlatformTiltController {
  private active = false;
  private centerPitch = 0;
  private centerRoll = 0;
  private currentPitch = 0;
  private currentRoll = 0;
  private currentYaw = 0;
  private smoothPitch = 0;
  private smoothRoll = 0;
  private alpha = 0.28;
  private maxAngleDeg = 28;
  private deadzoneDeg = 1.0;
  private lastOrientationTime = 0;
  private listeners: TiltListener[] = [];

  constructor() {
    this.onOrientation = this.onOrientation.bind(this);
    this.onMotion = this.onMotion.bind(this);
  }

  public requiresPermissionPrompt(): boolean {
    if (typeof window === 'undefined') return false;
    const devOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    return typeof devOrient?.requestPermission === 'function';
  }

  public async requestPermissions(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const devOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const devMotion = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    try {
      if (typeof devOrient?.requestPermission === 'function') {
        const res = await devOrient.requestPermission();
        if (typeof devMotion?.requestPermission === 'function') {
          await devMotion.requestPermission().catch(() => {});
        }
        return res === 'granted';
      }
      return true;
    } catch {
      return false;
    }
  }

  public start(): void {
    if (this.active || typeof window === 'undefined') return;
    this.active = true;
    window.addEventListener('deviceorientation', this.onOrientation, true);
    window.addEventListener('deviceorientationabsolute' as any, this.onOrientation as any, true);
    window.addEventListener('devicemotion', this.onMotion, true);
  }

  public stop(): void {
    if (!this.active || typeof window === 'undefined') return;
    this.active = false;
    window.removeEventListener('deviceorientation', this.onOrientation, true);
    window.removeEventListener('deviceorientationabsolute' as any, this.onOrientation as any, true);
    window.removeEventListener('devicemotion', this.onMotion, true);
  }

  public calibrateFlat(): void {
    this.centerPitch = 0;
    this.centerRoll = 0;
    this.smoothPitch = 0;
    this.smoothRoll = 0;
  }

  public calibrateCurrentPosture(): void {
    this.centerPitch = this.currentPitch;
    this.centerRoll = this.currentRoll;
    this.smoothPitch = 0;
    this.smoothRoll = 0;
  }

  public onTilt(cb: TiltListener): () => void {
    if (!this.listeners.includes(cb)) {
      this.listeners.push(cb);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private applyDeadzone(deg: number): number {
    if (Math.abs(deg) <= this.deadzoneDeg) return 0;
    return deg > 0 ? deg - this.deadzoneDeg : deg + this.deadzoneDeg;
  }

  private processAngles(rawPitch: number, rawRoll: number, rawYaw: number): void {
    this.currentPitch = rawPitch;
    this.currentRoll = rawRoll;
    this.currentYaw = rawYaw;

    const dPitch = this.applyDeadzone(rawPitch - this.centerPitch);
    const dRoll = this.applyDeadzone(rawRoll - this.centerRoll);

    this.smoothPitch = this.alpha * dPitch + (1 - this.alpha) * this.smoothPitch;
    this.smoothRoll = this.alpha * dRoll + (1 - this.alpha) * this.smoothRoll;

    const normPitch = Math.max(-1, Math.min(1, this.smoothPitch / this.maxAngleDeg));
    const normRoll = Math.max(-1, Math.min(1, this.smoothRoll / this.maxAngleDeg));

    const payload: TiltTelemetry = {
      pitch: this.smoothPitch,
      roll: this.smoothRoll,
      yaw: this.currentYaw,
      normPitch,
      normRoll,
    };

    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  private onOrientation(ev: DeviceOrientationEvent): void {
    if (ev.beta === null && ev.gamma === null) return;
    const rawPitch = ev.beta ?? 0;
    const rawRoll = ev.gamma ?? 0;
    const rawYaw = ev.alpha ?? 0;
    if (rawPitch === 0 && rawRoll === 0 && rawYaw === 0) return;

    this.lastOrientationTime = performance.now();
    this.processAngles(rawPitch, rawRoll, rawYaw);
  }

  private onMotion(ev: DeviceMotionEvent): void {
    const now = performance.now();
    if (now - this.lastOrientationTime > 250 && ev.accelerationIncludingGravity) {
      const gx = ev.accelerationIncludingGravity.x;
      const gy = ev.accelerationIncludingGravity.y;
      const gz = ev.accelerationIncludingGravity.z;
      if (gx !== null && gy !== null && gz !== null && (gx !== 0 || gy !== 0 || gz !== 0)) {
        const radToDeg = 180 / Math.PI;
        const isIOS =
          typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
        const sign = isIOS ? 1 : -1;
        const derivedRoll = Math.atan2(sign * gx, Math.sqrt(gy * gy + gz * gz)) * radToDeg;
        const derivedPitch = Math.atan2(sign * gy, Math.sqrt(gx * gx + gz * gz)) * radToDeg;
        this.processAngles(derivedPitch, derivedRoll, 0);
      }
    }
  }
}
