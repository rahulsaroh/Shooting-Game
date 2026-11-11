/**
 * Motion Sensors and Gyroscope Handling for DeadAim Phone Controller
 *
 * Supports:
 * - DeviceOrientationEvent (standard beta/gamma tilt)
 * - deviceorientationabsolute (fallback for Android browsers where standard event is silent)
 * - DeviceMotionEvent accelerationIncludingGravity (fallback for phones without a gyroscope)
 */

export interface MotionData {
  pitch: number; // Relative front-back tilt in degrees (+ = top higher, - = top lower)
  yaw: number;   // Relative left-right tilt in degrees (- = left, + = right)
  roll: number;  // Compass heading alpha
  x: number;     // 0 to 1 normalized horizontal screen coordinate (0 = left, 0.5 = center, 1 = right)
  y: number;     // 0 to 1 normalized vertical screen coordinate (0 = top, 0.5 = center, 1 = bottom)
}

export type MotionCallback = (data: MotionData) => void;
export type FlickReloadCallback = () => void;

export class MotionSensors {
  private active = false;
  private hasPermission = false;

  // Baseline neutral angles: 0°, 0° means a flat horizontal phone aims at the center (0.5, 0.5)
  private centerPitch = 0;
  private centerYaw = 0;

  private currentPitch = 0;
  private currentYaw = 0;
  private currentRoll = 0;
  private lastOrientationEventTime = 0;
  private eventCount = 0;

  // Low-pass filter smoothed values
  private smoothPitch = 0;
  private smoothYaw = 0;
  private smoothRoll = 0;
  private alpha = 0.3; // Responsive smoothing factor

  // Full screen angular span (in degrees):
  // ±22° left/right tilt covers full width [0, 1]
  // ±20° up/down tilt covers full height [0, 1]
  private yawRange = 44;
  private pitchRange = 40;

  // Small flat deadzone (in degrees) so resting the phone flat stays steady at (0.5, 0.5)
  private deadzoneDeg = 0.6;

  // Accelerometer flick detection
  private lastLinearZ: number | null = null;
  private lastFlickTime = 0;
  private flickThreshold = 24;

  private motionListeners: MotionCallback[] = [];
  private flickListeners: FlickReloadCallback[] = [];

  constructor() {
    this.handleOrientation = this.handleOrientation.bind(this);
    this.handleMotion = this.handleMotion.bind(this);
  }

  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window)
    );
  }

  public requiresPermissionPrompt(): boolean {
    if (typeof window === 'undefined') return false;
    const deviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    return typeof deviceOrientation?.requestPermission === 'function';
  }

  public isActive(): boolean {
    return this.active;
  }

  public getEventCount(): number {
    return this.eventCount;
  }

  public async requestPermissions(): Promise<boolean> {
    if (!this.isSupported()) return false;

    const deviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const deviceMotion = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    try {
      if (typeof deviceOrientation?.requestPermission === 'function') {
        const response = await deviceOrientation.requestPermission();
        this.hasPermission = response === 'granted';
        if (typeof deviceMotion?.requestPermission === 'function') {
          await deviceMotion.requestPermission().catch(() => {});
        }
        return this.hasPermission;
      }
    } catch (err) {
      console.warn('DeviceOrientation permission request failed:', err);
      return false;
    }

    // Android and standard browsers do not require requestPermission
    this.hasPermission = true;
    return true;
  }

  public start() {
    if (this.active) return;
    this.active = true;

    window.addEventListener('deviceorientation', this.handleOrientation, true);
    window.addEventListener(
      'deviceorientationabsolute' as any,
      this.handleOrientation as any,
      true
    );
    window.addEventListener('devicemotion', this.handleMotion, true);
  }

  public stop() {
    if (!this.active) return;
    this.active = false;

    window.removeEventListener('deviceorientation', this.handleOrientation, true);
    window.removeEventListener(
      'deviceorientationabsolute' as any,
      this.handleOrientation as any,
      true
    );
    window.removeEventListener('devicemotion', this.handleMotion, true);
  }

  /**
   * Reset baseline to true flat horizontal (beta = 0°, gamma = 0°).
   * Putting the phone flat on a table or palm places the aim marker at (0.5, 0.5).
   */
  public resetToFlat() {
    this.centerPitch = 0;
    this.centerYaw = 0;
    this.smoothPitch = 0;
    this.smoothYaw = 0;
  }

  /**
   * Calibrate current holding posture as neutral center (0.5, 0.5).
   */
  public calibrateCurrentAngle() {
    this.centerPitch = this.currentPitch;
    this.centerYaw = this.currentYaw;
    this.smoothPitch = 0;
    this.smoothYaw = 0;
  }

  public recenter() {
    this.resetToFlat();
  }

  public setSensitivity(multiplier: number) {
    const clamped = Math.max(0.5, Math.min(2.0, multiplier));
    this.yawRange = 44 / clamped;
    this.pitchRange = 40 / clamped;
  }

  public onMotion(cb: MotionCallback) {
    if (!this.motionListeners.includes(cb)) {
      this.motionListeners.push(cb);
    }
    return () => {
      this.motionListeners = this.motionListeners.filter((c) => c !== cb);
    };
  }

  public onFlick(cb: FlickReloadCallback) {
    if (!this.flickListeners.includes(cb)) {
      this.flickListeners.push(cb);
    }
    return () => {
      this.flickListeners = this.flickListeners.filter((c) => c !== cb);
    };
  }

  private applyDeadzone(deg: number): number {
    if (Math.abs(deg) <= this.deadzoneDeg) return 0;
    return deg > 0 ? deg - this.deadzoneDeg : deg + this.deadzoneDeg;
  }

  private processTiltAngles(rawPitch: number, rawYaw: number, rawRoll: number) {
    this.eventCount++;
    this.currentPitch = rawPitch;
    this.currentYaw = rawYaw;
    this.currentRoll = rawRoll;

    // Relative delta from neutral (0°, 0° when in Flat Reference mode)
    const deltaPitch = this.applyDeadzone(rawPitch - this.centerPitch);
    const deltaYaw = this.applyDeadzone(rawYaw - this.centerYaw);

    // Low-pass filter to keep crosshair movement silky-smooth
    this.smoothPitch = this.alpha * deltaPitch + (1 - this.alpha) * this.smoothPitch;
    this.smoothYaw = this.alpha * deltaYaw + (1 - this.alpha) * this.smoothYaw;
    this.smoothRoll = this.alpha * rawRoll + (1 - this.alpha) * this.smoothRoll;

    // Horizontal Mapping (X):
    // - Phone flat (smoothYaw = 0) -> normX = 0.5 (Middle)
    // - Tilt left (smoothYaw < 0)  -> normX < 0.5 (Moves Left)
    // - Tilt right (smoothYaw > 0) -> normX > 0.5 (Moves Right)
    const normX = 0.5 + this.smoothYaw / this.yawRange;

    // Vertical Mapping (Y):
    // - Phone flat (smoothPitch = 0) -> normY = 0.5 (Middle)
    // - Top of phone tilted LOWER / bottom HIGHER (smoothPitch < 0) -> normY > 0.5 (Slides to Bottom)
    // - Top of phone tilted HIGHER / bottom LOWER (smoothPitch > 0) -> normY < 0.5 (Slides to Top/Upper side)
    const normY = 0.5 - this.smoothPitch / this.pitchRange;

    const clampedX = Math.max(0.01, Math.min(0.99, normX));
    const clampedY = Math.max(0.01, Math.min(0.99, normY));

    const data: MotionData = {
      pitch: this.smoothPitch,
      yaw: this.smoothYaw,
      roll: this.smoothRoll,
      x: clampedX,
      y: clampedY,
    };

    for (const listener of this.motionListeners) {
      listener(data);
    }
  }

  private handleOrientation(event: DeviceOrientationEvent) {
    if (event.beta === null && event.gamma === null) return;

    const rawPitch = event.beta ?? 0;
    const rawYaw = event.gamma ?? 0;
    const rawRoll = event.alpha ?? 0;

    // Ignore dummy (0, 0, 0) initial events emitted by devices without a gyroscope
    if (rawPitch === 0 && rawYaw === 0 && rawRoll === 0 && this.eventCount === 0) {
      return;
    }

    this.lastOrientationEventTime = performance.now();
    this.processTiltAngles(rawPitch, rawYaw, rawRoll);
  }

  private handleMotion(event: DeviceMotionEvent) {
    const now = performance.now();

    // 1. Automatic Fallback: If DeviceOrientationEvent hasn't fired recently (e.g. within 250ms),
    // compute exact flat-phone tilt angles from the hardware accelerometer's gravity vector!
    if (now - this.lastOrientationEventTime > 250 && event.accelerationIncludingGravity) {
      const gx = event.accelerationIncludingGravity.x;
      const gy = event.accelerationIncludingGravity.y;
      const gz = event.accelerationIncludingGravity.z;

      if (gx !== null && gy !== null && gz !== null && (gx !== 0 || gy !== 0 || gz !== 0)) {
        const radToDeg = 180 / Math.PI;
        // Standardize sign across iOS and Android:
        const isIOS =
          typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
        const sign = isIOS ? 1 : -1;
        const derivedYaw = Math.atan2( sign * gx, Math.sqrt(gy * gy + gz * gz)) * radToDeg;
        const derivedPitch = Math.atan2( sign * gy, Math.sqrt(gx * gx + gz * gz)) * radToDeg;
        this.processTiltAngles(derivedPitch, derivedYaw, 0);
      }
    }

    // 2. Sharp downward flick reload detection
    const linear = event.acceleration;
    if (!linear || linear.z === null) return;

    if (this.lastLinearZ === null) {
      this.lastLinearZ = linear.z;
      return;
    }

    const deltaZ = Math.abs(linear.z - this.lastLinearZ);
    this.lastLinearZ = linear.z;

    if (deltaZ > this.flickThreshold && now - this.lastFlickTime > 1200) {
      this.lastFlickTime = now;
      for (const listener of this.flickListeners) {
        listener();
      }
    }
  }
}
