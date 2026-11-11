import * as THREE from 'three';
import { PowerUpState } from '../../shared/types.ts';

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
}

interface LaserBeam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  start: THREE.Vector3;
  end: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

interface PowerUpMesh {
  id: string;
  group: THREE.Group;
  box: THREE.Mesh;
  ring: THREE.Mesh;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private lasers: LaserBeam[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private powerupMeshes: Map<string, PowerUpMesh> = new Map();

  // Shared geometries
  private particleGeom = new THREE.OctahedronGeometry(0.11, 0);
  private confettiGeom = new THREE.PlaneGeometry(0.18, 0.09);
  private shockwaveGeom = new THREE.RingGeometry(0.2, 0.36, 20);
  private powerupBoxGeom = new THREE.BoxGeometry(0.75, 0.75, 0.75);
  private weaponCrateGeom = new THREE.BoxGeometry(1.05, 0.68, 0.75);
  private powerupRingGeom = new THREE.TorusGeometry(0.72, 0.06, 8, 20);

  // Vibrant Timezone Arcade materials
  private bloodMat = new THREE.MeshBasicMaterial({ color: 0xff1e56 });
  private slimeMat = new THREE.MeshBasicMaterial({ color: 0x80ed99 });
  private sparksMat = new THREE.MeshBasicMaterial({ color: 0xffbe0b });
  private headshotMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });
  private goldMat = new THREE.MeshBasicMaterial({ color: 0xffea00 });
  private plasmaMat = new THREE.MeshBasicMaterial({ color: 0xf72585 });
  private confettiMats = [
    new THREE.MeshBasicMaterial({ color: 0xf72585, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x00f5d4, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0xfee440, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x80ed99, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x7209b7, side: THREE.DoubleSide }),
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // Spawn short upward shot tracer bolt from bottom foreground turret muzzle to crosshair target (fades in 120ms)
  public spawnLaserTracer(
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    colorHex = '#00f5d4'
  ) {
    const start = new THREE.Vector3(fromX, fromY, fromZ);
    const end = new THREE.Vector3(toX, toY, toZ);
    const distance = start.distanceTo(end);
    if (distance < 0.1) return;

    // Compact tapered tracer bolt (instead of a long beam cutting across the entire screen)
    const boltLength = Math.min(distance * 0.36, 4.2);
    const beamGeom = new THREE.CylinderGeometry(0.018, 0.042, boltLength, 6, 1, true);
    beamGeom.translate(0, boltLength / 2, 0);
    beamGeom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(beamGeom, mat);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.scene.add(mesh);

    // 120ms tracer lifetime (within 100-150ms spec)
    this.lasers.push({
      mesh,
      mat,
      start,
      end,
      life: 0.12,
      maxLife: 0.12,
    });
  }

  // Spawn explosive blast for Grenade Launcher or Boss Weak-Point hit
  public spawnExplosion(x: number, y: number, z: number, isKids = false) {
    const count = 28;
    for (let i = 0; i < count; i++) {
      const mat = isKids
        ? this.confettiMats[i % this.confettiMats.length]
        : i % 2 === 0
        ? this.sparksMat
        : this.plasmaMat;
      const geom = isKids && i % 2 === 0 ? this.confettiGeom : this.particleGeom;
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(1.45);
      this.scene.add(mesh);

      const speed = 4.0 + Math.random() * 6.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;

      this.particles.push({
        mesh,
        vx: Math.cos(theta) * Math.cos(phi) * speed,
        vy: Math.sin(phi) * speed + 3.5,
        vz: Math.sin(theta) * Math.cos(phi) * speed + 1.5,
        life: 0.75 + Math.random() * 0.4,
        maxLife: 1.15,
        gravity: isKids ? 4.5 : 9.2,
      });
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: isKids ? 0xfee440 : 0xf72585,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(this.shockwaveGeom, ringMat);
    ringMesh.position.set(x, y, z + 0.3);
    ringMesh.scale.setScalar(1.8);
    this.scene.add(ringMesh);

    this.shockwaves.push({
      mesh: ringMesh,
      mat: ringMat,
      life: 0.38,
      maxLife: 0.38,
    });
  }

  // Spawn impact burst + expanding arcade shockwave ring
  // In Kids mode ('slime' / 'confetti'), spawns slime droplets + colorful confetti instead of blood!
  public spawnImpact(
    x: number,
    y: number,
    z: number,
    type: 'blood' | 'slime' | 'confetti' | 'sparks' | 'headshot' = 'blood',
    playerColorHex?: string
  ) {
    const isKidsSlimeConfetti = type === 'slime' || type === 'confetti';
    const primaryMat =
      type === 'headshot'
        ? this.headshotMat
        : isKidsSlimeConfetti
        ? this.slimeMat
        : type === 'sparks'
        ? this.sparksMat
        : this.bloodMat;

    const count = type === 'headshot' ? 22 : isKidsSlimeConfetti ? 20 : 14;

    for (let i = 0; i < count; i++) {
      const useConfettiRibbon = isKidsSlimeConfetti && i % 2 === 0;
      const mat = useConfettiRibbon
        ? this.confettiMats[i % this.confettiMats.length]
        : type === 'headshot' && i % 2 === 0
        ? this.goldMat
        : primaryMat;

      const geom = useConfettiRibbon ? this.confettiGeom : this.particleGeom;
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      const speed = 2.6 + Math.random() * 4.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;

      this.particles.push({
        mesh,
        vx: Math.cos(theta) * Math.cos(phi) * speed,
        vy: Math.sin(phi) * speed + (useConfettiRibbon ? 3.2 : 2.4),
        vz: Math.sin(theta) * Math.cos(phi) * speed + 1.2,
        life: 0.6 + Math.random() * 0.4,
        maxLife: 1.0,
        gravity: useConfettiRibbon ? 4.5 : 9.8,
      });
    }

    // Spawn expanding shockwave ring facing the camera
    const ringColor = playerColorHex
      ? new THREE.Color(playerColorHex)
      : type === 'headshot'
      ? new THREE.Color(0xffea00)
      : new THREE.Color(0x00f5d4);

    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    const ringMesh = new THREE.Mesh(this.shockwaveGeom, ringMat);
    ringMesh.position.set(x, y, z + 0.2);
    this.scene.add(ringMesh);

    this.shockwaves.push({
      mesh: ringMesh,
      mat: ringMat,
      life: 0.28,
      maxLife: 0.28,
    });
  }

  // Synchronize 3D powerup & weapon crates floating in world
  public syncPowerUps(powerups: PowerUpState[], dt: number) {
    const activeIds = new Set<string>();

    for (const p of powerups) {
      activeIds.add(p.id);
      let pMesh = this.powerupMeshes.get(p.id);

      if (!pMesh) {
        pMesh = this.createPowerUpMesh(p);
        this.powerupMeshes.set(p.id, pMesh);
        this.scene.add(pMesh.group);
      }

      pMesh.group.position.x = p.x;
      pMesh.group.position.z = p.z;
      pMesh.group.position.y = p.y + Math.sin(Date.now() * 0.005 + p.createdAt) * 0.25;

      pMesh.box.rotation.y += dt * 1.8;
      pMesh.box.rotation.x += dt * 0.9;
      pMesh.ring.rotation.z += dt * 2.4;
    }

    for (const [id, pMesh] of this.powerupMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(pMesh.group);
        this.powerupMeshes.delete(id);
      }
    }
  }

  private createPowerUpMesh(p: PowerUpState): PowerUpMesh {
    const group = new THREE.Group();

    let color = 0x00f5d4; // ammo
    if (p.type === 'health') color = 0x38b000;
    if (p.type === 'freeze') color = 0x00bbf9;
    if (p.type === 'double_damage') color = 0xf72585;
    if (p.type === 'weapon_crate') color = 0xffbe0b;

    const boxMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.25,
      metalness: 0.65,
      emissive: color,
      emissiveIntensity: 0.55,
    });

    const ringMat = new THREE.MeshBasicMaterial({
      color: p.type === 'weapon_crate' ? 0xffbe0b : color,
      transparent: true,
      opacity: 0.65,
    });

    const geom = p.type === 'weapon_crate' ? this.weaponCrateGeom : this.powerupBoxGeom;
    const box = new THREE.Mesh(geom, boxMat);
    const ring = new THREE.Mesh(this.powerupRingGeom, ringMat);
    ring.rotation.x = Math.PI / 2;

    group.add(box);
    group.add(ring);
    group.position.set(p.x, p.y, p.z);

    return { id: p.id, group, box, ring };
  }

  // Update particles, laser tracers, and shockwaves per frame
  public update(dt: number) {
    // 1. Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 6;
      p.vy -= p.gravity * dt;

      const scale = Math.max(0.01, p.life / p.maxLife);
      p.mesh.scale.set(scale, scale, scale);

      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vy = -p.vy * 0.4;
      }
    }

    // 2. Update laser tracers (travel upward from turret muzzle toward crosshair target and fade out in 120ms)
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.life -= dt;
      if (l.life <= 0) {
        this.scene.remove(l.mesh);
        l.mesh.geometry.dispose();
        l.mat.dispose();
        this.lasers.splice(i, 1);
        continue;
      }
      const ratio = Math.max(0, l.life / l.maxLife);
      const progress = 1 - ratio;
      // Travel from bottom turret muzzle up toward crosshair target
      l.mesh.position.lerpVectors(l.start, l.end, progress * 0.72);
      l.mesh.lookAt(l.end);
      l.mat.opacity = ratio * 0.95;
      const widthScale = 0.55 + ratio * 0.45;
      l.mesh.scale.set(widthScale, widthScale, Math.max(0.35, ratio));
    }

    // 3. Update shockwave rings
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mat.dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const progress = 1 - s.life / s.maxLife;
      const scale = 1 + progress * 3.8;
      s.mesh.scale.set(scale, scale, 1);
      s.mat.opacity = (1 - progress) * 0.85;
    }
  }

  public dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
    }
    this.particles = [];

    for (const l of this.lasers) {
      this.scene.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mat.dispose();
    }
    this.lasers = [];

    for (const s of this.shockwaves) {
      this.scene.remove(s.mesh);
      s.mat.dispose();
    }
    this.shockwaves = [];

    for (const pm of this.powerupMeshes.values()) {
      this.scene.remove(pm.group);
    }
    this.powerupMeshes.clear();
  }
}
