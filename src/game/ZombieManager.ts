import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ZombieState, ZombieType, ThemeId } from '../../shared/types.ts';
import { ZOMBIE_HITBOXES, ZOMBIE_VISUAL_SCALE } from '../../shared/config.ts';
import themesData from '../../shared/themes.json' with { type: 'json' };

type AnimClipKey = 'walk' | 'attack' | 'death' | 'hit' | 'idle';

interface ThemeTypeConfig {
  name: string;
  hp: number;
  speed: number;
  scale: number;
  model?: string;
  tint?: string;
  animations?: {
    walk: string;
    attack: string;
    death: string;
    hit?: string;
    idle?: string;
  };
}

interface ZombieMeshEntity {
  id: string;
  group: THREE.Group;
  modelRoot: THREE.Object3D;
  type: ZombieType;
  theme: ThemeId;
  usingFallbackBox: boolean;
  isCivilian?: boolean;
  // AnimationMixer & Actions for GLB models
  mixer?: THREE.AnimationMixer;
  actions: Partial<Record<AnimClipKey, THREE.AnimationAction>>;
  currentAnim: AnimClipKey | null;
  deathAnimFinished: boolean;
  deathTimer: number;
  // Procedural fallback references (used if GLB file is missing)
  head?: THREE.Mesh;
  torso?: THREE.Mesh;
  leftArm?: THREE.Group;
  rightArm?: THREE.Group;
  leftLeg?: THREE.Group;
  rightLeg?: THREE.Group;
  core?: THREE.Mesh;
  // UI, Boss Weak-Point & Debug Hitbox Overlays
  hpBarGroup: THREE.Group;
  hpBarFill: THREE.Mesh;
  hpBarMat: THREE.MeshBasicMaterial;
  weakPointGroup?: THREE.Group;
  civilianHalo?: THREE.Mesh;
  hitboxDebugGroup: THREE.Group;
  hitFlashTimer: number;
  lastHp: number;
  animTime: number;
}

export class ZombieManager {
  private scene: THREE.Scene;
  private gltfLoader = new GLTFLoader();
  private zombieEntities: Map<string, ZombieMeshEntity> = new Map();
  private isKidsMode = false;

  // Model Cache: Load each GLB once, then clone per zombie with SkeletonUtils.clone
  private gltfCache: Map<string, GLTF> = new Map();
  private gltfLoadingPromises: Map<string, Promise<GLTF | null>> = new Map();
  private missingModelWarned: Set<string> = new Set();

  // Hitbox debug overlay state (toggled via key H on TV)
  private showHitboxes = false;

  // Procedural fallback caches
  private faceTextureCache: Map<string, THREE.CanvasTexture> = new Map();
  private torsoTextureCache: Map<string, THREE.CanvasTexture> = new Map();

  // Shared geometries for fallback procedural zombie (never crashes if GLB is missing)
  private normalGeom = {
    torso: new THREE.BoxGeometry(0.66, 0.82, 0.42),
    head: new THREE.BoxGeometry(0.46, 0.48, 0.46),
    mohawk: new THREE.BoxGeometry(0.1, 0.24, 0.48),
    visor: new THREE.BoxGeometry(0.48, 0.15, 0.14),
    shoulder: new THREE.SphereGeometry(0.14, 8, 8),
    arm: new THREE.CapsuleGeometry(0.1, 0.52, 4, 8),
    claw: new THREE.ConeGeometry(0.05, 0.18, 5),
    leg: new THREE.CapsuleGeometry(0.12, 0.56, 4, 8),
    shoe: new THREE.BoxGeometry(0.28, 0.16, 0.36),
  };

  private tankGeom = {
    torso: new THREE.BoxGeometry(1.34, 1.18, 0.84),
    belt: new THREE.BoxGeometry(1.38, 0.22, 0.88),
    head: new THREE.BoxGeometry(0.64, 0.64, 0.64),
    jaw: new THREE.BoxGeometry(0.68, 0.24, 0.68),
    canister: new THREE.CylinderGeometry(0.16, 0.16, 0.72, 10),
    arm: new THREE.CapsuleGeometry(0.22, 0.72, 4, 10),
    leg: new THREE.CapsuleGeometry(0.23, 0.62, 4, 10),
    shoulderPad: new THREE.ConeGeometry(0.4, 0.5, 6),
  };

  private bossGeom = {
    torso: new THREE.BoxGeometry(1.75, 1.68, 0.98),
    head: new THREE.BoxGeometry(0.9, 0.94, 0.86),
    crown: new THREE.CylinderGeometry(0.52, 0.4, 0.36, 6),
    halo: new THREE.TorusGeometry(0.98, 0.08, 8, 24),
    arm: new THREE.CapsuleGeometry(0.28, 1.0, 6, 10),
    leg: new THREE.CapsuleGeometry(0.3, 0.8, 6, 10),
    core: new THREE.OctahedronGeometry(0.38, 1),
    horn: new THREE.ConeGeometry(0.2, 0.7, 6),
  };

  // Shared geometries & materials for Hitboxes (Head Sphere + Body Capsule)
  private hitboxGeomCache: Map<
    ZombieType,
    { headSphere: THREE.SphereGeometry; bodyCapsule: THREE.CapsuleGeometry }
  > = new Map();

  private headHitboxWireMat = new THREE.MeshBasicMaterial({
    color: 0xffea00,
    wireframe: true,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });

  private bodyHitboxWireMat = new THREE.MeshBasicMaterial({
    color: 0x00f5d4,
    wireframe: true,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });

  private weakPointRingGeom = new THREE.TorusGeometry(0.42, 0.06, 8, 24);
  private weakPointCoreGeom = new THREE.RingGeometry(0.12, 0.24, 16);
  private weakPointMat = new THREE.MeshBasicMaterial({
    color: 0xf72585,
    side: THREE.DoubleSide,
  });
  private weakPointInnerMat = new THREE.MeshBasicMaterial({
    color: 0xfee440,
    side: THREE.DoubleSide,
  });

  private civilianHaloGeom = new THREE.TorusGeometry(0.52, 0.05, 8, 20);
  private civilianHaloMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });

  private hpBgGeom = new THREE.PlaneGeometry(1.15, 0.16);
  private hpFillGeom = new THREE.PlaneGeometry(1.08, 0.11);
  private shadowDiscGeom = new THREE.CircleGeometry(0.7, 16);
  private shadowDiscMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initHitboxGeometries();
    this.preloadAllThemeModels();
  }

  public setKidsMode(isKids: boolean) {
    this.isKidsMode = isKids;
  }

  private initHitboxGeometries() {
    (['normal', 'fast', 'tank', 'boss'] as ZombieType[]).forEach((type) => {
      const cfg = ZOMBIE_HITBOXES[type];
      const headSphere = new THREE.SphereGeometry(cfg.headSphere.radius, 12, 10);
      const cylLen = Math.max(
        0.1,
        cfg.bodyCapsule.topY - cfg.bodyCapsule.bottomY - cfg.bodyCapsule.radius * 0.5
      );
      const bodyCapsule = new THREE.CapsuleGeometry(cfg.bodyCapsule.radius, cylLen, 6, 12);
      this.hitboxGeomCache.set(type, { headSphere, bodyCapsule });
    });
  }

  // Toggle wireframe hitbox display (Key H)
  public toggleHitboxDebug(): boolean {
    this.showHitboxes = !this.showHitboxes;
    for (const entity of this.zombieEntities.values()) {
      entity.hitboxDebugGroup.visible = this.showHitboxes;
    }
    return this.showHitboxes;
  }

  public isHitboxDebugVisible(): boolean {
    return this.showHitboxes;
  }

  public setHitboxDebugVisible(visible: boolean) {
    this.showHitboxes = visible;
    for (const entity of this.zombieEntities.values()) {
      entity.hitboxDebugGroup.visible = this.showHitboxes;
    }
  }

  // Preload all GLB models defined in shared/themes.json once
  public preloadAllThemeModels() {
    const themes = themesData.themes as Record<
      ThemeId,
      { types: Record<ZombieType, ThemeTypeConfig> }
    >;
    for (const themeKey of Object.keys(themes) as ThemeId[]) {
      const types = themes[themeKey].types;
      for (const typeKey of Object.keys(types) as ZombieType[]) {
        const modelPath = types[typeKey].model;
        if (modelPath) {
          this.loadGltfOnce(modelPath);
        }
      }
    }
  }

  // Load a GLB file once and cache it; if missing, warn clearly and return null for fallback
  public loadGltfOnce(modelPath: string): Promise<GLTF | null> {
    if (this.gltfCache.has(modelPath)) {
      return Promise.resolve(this.gltfCache.get(modelPath)!);
    }
    if (this.gltfLoadingPromises.has(modelPath)) {
      return this.gltfLoadingPromises.get(modelPath)!;
    }

    const promise = new Promise<GLTF | null>((resolve) => {
      this.gltfLoader.load(
        modelPath,
        (gltf) => {
          this.gltfCache.set(modelPath, gltf);
          resolve(gltf);
        },
        undefined,
        (err) => {
          if (!this.missingModelWarned.has(modelPath)) {
            this.missingModelWarned.add(modelPath);
            console.warn(
              `[ZombieManager] Warning: Missing or invalid GLB model at "${modelPath}". Using fallback procedural box zombie so the game never crashes.`,
              err
            );
          }
          resolve(null);
        }
      );
    });

    this.gltfLoadingPromises.set(modelPath, promise);
    return promise;
  }

  private createHitboxDebugGroup(type: ZombieType): THREE.Group {
    const group = new THREE.Group();
    const cfg = ZOMBIE_HITBOXES[type] || ZOMBIE_HITBOXES.normal;
    const geoms = this.hitboxGeomCache.get(type) || this.hitboxGeomCache.get('normal')!;

    const headMesh = new THREE.Mesh(geoms.headSphere, this.headHitboxWireMat);
    headMesh.position.y = cfg.headSphere.offsetY;
    group.add(headMesh);

    const bodyMesh = new THREE.Mesh(geoms.bodyCapsule, this.bodyHitboxWireMat);
    bodyMesh.position.y = (cfg.bodyCapsule.bottomY + cfg.bodyCapsule.topY) * 0.5;
    group.add(bodyMesh);

    group.visible = this.showHitboxes;
    return group;
  }

  public triggerHitFlash(zombieId: string) {
    const entity = this.zombieEntities.get(zombieId);
    if (!entity) return;
    entity.hitFlashTimer = 0.16;

    // Trigger additive or brief Hit clip if available and not dying
    if (entity.mixer && entity.actions.hit && entity.currentAnim !== 'death') {
      const hitAction = entity.actions.hit;
      hitAction.reset();
      hitAction.setLoop(THREE.LoopOnce, 1);
      hitAction.clampWhenFinished = false;
      hitAction.setEffectiveWeight(0.85);
      hitAction.play();
    }
  }

  // Synchronize 3D zombies with authoritative server state
  public syncZombies(serverZombies: ZombieState[], dt: number) {
    const activeIds = new Set<string>();

    for (const z of serverZombies) {
      activeIds.add(z.id);
      let entity = this.zombieEntities.get(z.id);

      if (!entity) {
        entity = this.createZombieEntity(z);
        this.zombieEntities.set(z.id, entity);
        this.scene.add(entity.group);
      }

      if (z.hp < entity.lastHp) {
        this.triggerHitFlash(z.id);
        entity.lastHp = z.hp;
      }

      entity.group.position.set(z.x, z.y, z.z);

      // Update floating health bar
      const hpRatio = Math.max(0, Math.min(1, z.hp / z.maxHp));
      entity.hpBarFill.scale.x = Math.max(0.001, hpRatio);
      entity.hpBarFill.position.x = -0.54 * (1 - hpRatio);
      if (z.isCivilian) {
        entity.hpBarMat.color.setHex(0x38bdf8);
      } else if (hpRatio > 0.55) {
        entity.hpBarMat.color.setHex(0x00f5d4);
      } else if (hpRatio > 0.25) {
        entity.hpBarMat.color.setHex(0xffbe0b);
      } else {
        entity.hpBarMat.color.setHex(0xff0055);
      }
      entity.hpBarGroup.visible = z.state !== 'dying';

      // Pulse Boss Weak Point bullseye ring if present
      if (entity.weakPointGroup) {
        entity.weakPointGroup.visible = Boolean(z.weakPoint?.active && z.state !== 'dying');
        entity.weakPointGroup.rotation.z += dt * 3.5;
        const pulse = 1.0 + Math.sin(Date.now() * 0.012) * 0.16;
        entity.weakPointGroup.scale.setScalar(pulse);
      }

      // Rotate Civilian safety halo
      if (entity.civilianHalo) {
        entity.civilianHalo.rotation.z += dt * 2.5;
      }

      // Hit flinch/stagger recoil impulse
      if (entity.hitFlashTimer > 0) {
        entity.hitFlashTimer = Math.max(0, entity.hitFlashTimer - dt);
        const recoil = Math.sin((entity.hitFlashTimer / 0.16) * Math.PI);
        entity.group.position.z -= recoil * 0.26;
        entity.modelRoot.rotation.z = Math.sin(entity.hitFlashTimer * 40) * 0.18 * recoil;
        entity.modelRoot.rotation.x = -recoil * 0.22;
        if (entity.torso) {
          entity.torso.scale.set(1 + recoil * 0.14, 1 - recoil * 0.08, 1 + recoil * 0.14);
        } else {
          entity.modelRoot.scale.set(
            1 + recoil * 0.1,
            1 - recoil * 0.06,
            1 + recoil * 0.1
          );
        }
      } else if (z.state !== 'dying') {
        if (entity.torso) entity.torso.scale.set(1, 1, 1);
        entity.modelRoot.scale.set(1, 1, 1);
        entity.modelRoot.rotation.x = 0;
        entity.modelRoot.rotation.z = 0;
        entity.modelRoot.rotation.y = 0;
      }

      // Varied Ragdoll-Style Death Tumble / Spin (or Kids Mode goofy bounce-spin!)
      if (z.state === 'dying') {
        const p = Math.min(1, z.deathProgress || 0);
        const variant = z.deathVariant || 0;
        if (this.isKidsMode) {
          // Kids Mode: goofy cartoon spin & pop shrink!
          entity.modelRoot.rotation.y = p * Math.PI * 5;
          entity.modelRoot.position.y = Math.sin(p * Math.PI) * 1.1;
          const s = Math.max(0.05, 1 - p * 0.85);
          entity.modelRoot.scale.set(s, s, s);
        } else if (variant === 1) {
          // Variant 1: Dramatic backward ragdoll flip
          entity.modelRoot.rotation.x = -p * 1.65;
          entity.modelRoot.position.z = -p * 0.9;
          entity.modelRoot.position.y = Math.sin(p * Math.PI) * 0.45 - p * 0.5;
        } else if (variant === 2) {
          // Variant 2: Sideways corkscrew tumble
          entity.modelRoot.rotation.z = p * 1.55;
          entity.modelRoot.rotation.y = p * 2.4;
          entity.modelRoot.position.y = -p * 0.65;
        }
      }

      // Update AnimationMixer or Procedural Fallback
      if (entity.mixer && !entity.usingFallbackBox) {
        this.updateGltfAnimation(entity, z, dt);
      } else {
        if (!z.isFrozen) {
          entity.animTime += dt * (z.type === 'fast' ? 8.2 : z.type === 'tank' ? 3.2 : 4.8);
        }
        this.animateFallbackZombie(entity, z);
      }
    }

    // Remove zombies no longer on server (or whose death animation finished)
    for (const [id, entity] of this.zombieEntities.entries()) {
      if (!activeIds.has(id)) {
        this.removeZombieEntity(id, entity);
      }
    }
  }

  private updateGltfAnimation(entity: ZombieMeshEntity, z: ZombieState, dt: number) {
    if (!entity.mixer) return;

    // Determine target animation state
    let targetAnim: AnimClipKey = 'walk';
    if (z.state === 'dying') {
      targetAnim = 'death';
    } else if (z.isFrozen && entity.actions.idle) {
      targetAnim = 'idle';
    } else if (z.state === 'attacking') {
      targetAnim = 'attack';
    } else {
      targetAnim = 'walk';
    }

    // Cross-fade when animation state changes
    if (entity.currentAnim !== targetAnim) {
      const prevAction = entity.currentAnim ? entity.actions[entity.currentAnim] : undefined;
      const nextAction = entity.actions[targetAnim] || entity.actions.walk;

      if (nextAction) {
        nextAction.reset();
        if (targetAnim === 'death') {
          nextAction.setLoop(THREE.LoopOnce, 1);
          nextAction.clampWhenFinished = true;
        } else {
          nextAction.setLoop(THREE.LoopRepeat, Infinity);
          nextAction.clampWhenFinished = false;
        }

        nextAction.play();
        if (prevAction && prevAction !== nextAction) {
          prevAction.crossFadeTo(nextAction, 0.2, false);
        } else {
          nextAction.fadeIn(0.15);
        }
      }
      entity.currentAnim = targetAnim;
    }

    // Adjust playback speed based on zombie speed & freeze state
    const timeScale =
      z.isFrozen && targetAnim !== 'death'
        ? 0.0
        : targetAnim === 'walk'
        ? z.type === 'fast'
          ? 1.65
          : z.type === 'tank'
          ? 0.8
          : 1.15
        : 1.0;

    entity.mixer.timeScale = timeScale;
    entity.mixer.update(dt);

    // If dying, track death timer and hide/remove corpse once death animation finishes
    if (z.state === 'dying') {
      entity.deathTimer += dt;
      if (entity.deathAnimFinished || entity.deathTimer >= 0.68) {
        entity.modelRoot.visible = false;
      }
    }
  }

  private createZombieEntity(z: ZombieState): ZombieMeshEntity {
    const group = new THREE.Group();
    const themeKey = z.theme || 'classic';
    const themeDef = (themesData.themes as any)[themeKey] || themesData.themes.classic;
    const typeConfig: ThemeTypeConfig = themeDef.types[z.type] || themeDef.types.normal;
    const modelPath = typeConfig.model || `/models/${themeKey}/zombie_${z.type}.glb`;

    // Shadow disc on ground
    const shadowDisc = new THREE.Mesh(this.shadowDiscGeom, this.shadowDiscMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.03;
    shadowDisc.scale.setScalar(z.type === 'boss' ? 2.1 : z.type === 'tank' ? 1.5 : 1.0);
    group.add(shadowDisc);

    // Floating 3D Arcade Health Bar
    const hpBarHeight =
      z.type === 'boss' ? 4.3 : z.type === 'tank' ? 3.05 : z.type === 'fast' ? 2.05 : 2.35;
    const hpBarGroup = new THREE.Group();
    hpBarGroup.position.set(0, hpBarHeight, 0);
    if (z.type === 'boss') hpBarGroup.scale.setScalar(1.8);
    else if (z.type === 'tank') hpBarGroup.scale.setScalar(1.3);

    const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x090d16 });
    const hpBg = new THREE.Mesh(this.hpBgGeom, hpBgMat);
    hpBarGroup.add(hpBg);

    const hpBarMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });
    const hpBarFill = new THREE.Mesh(this.hpFillGeom, hpBarMat);
    hpBarFill.position.z = 0.01;
    hpBarGroup.add(hpBarFill);
    group.add(hpBarGroup);

    // Optional Boss Weak-Point Bullseye Ring
    let weakPointGroup: THREE.Group | undefined;
    if (z.type === 'boss' || z.weakPoint) {
      weakPointGroup = new THREE.Group();
      const wpY = z.weakPoint?.offsetY || 2.4;
      weakPointGroup.position.set(0, wpY, 0.62);
      const outerRing = new THREE.Mesh(this.weakPointRingGeom, this.weakPointMat);
      const innerRing = new THREE.Mesh(this.weakPointCoreGeom, this.weakPointInnerMat);
      weakPointGroup.add(outerRing);
      weakPointGroup.add(innerRing);
      group.add(weakPointGroup);
    }

    // Optional Civilian Friendly Safety Halo
    let civilianHalo: THREE.Mesh | undefined;
    if (z.isCivilian) {
      civilianHalo = new THREE.Mesh(this.civilianHaloGeom, this.civilianHaloMat);
      civilianHalo.rotation.x = Math.PI / 2;
      civilianHalo.position.set(0, 2.15, 0);
      group.add(civilianHalo);
    }

    // Debug Hitbox Overlay (Head Sphere + Body Capsule) toggled with Key H
    const hitboxDebugGroup = this.createHitboxDebugGroup(z.type);
    group.add(hitboxDebugGroup);

    group.scale.setScalar(ZOMBIE_VISUAL_SCALE);

    // Check if GLB model is already cached
    const cachedGltf = this.gltfCache.get(modelPath);
    if (cachedGltf) {
      const entity = this.instantiateGltfEntity(
        z,
        group,
        cachedGltf,
        themeDef,
        typeConfig,
        hpBarGroup,
        hpBarFill,
        hpBarMat,
        hitboxDebugGroup
      );
      entity.weakPointGroup = weakPointGroup;
      entity.civilianHalo = civilianHalo;
      return entity;
    }

    // Build fallback procedural mesh first, and hot-swap if async GLB load completes
    const fallbackEntity = this.createProceduralFallbackEntity(
      z,
      group,
      themeDef,
      hpBarGroup,
      hpBarFill,
      hpBarMat,
      hitboxDebugGroup
    );
    fallbackEntity.weakPointGroup = weakPointGroup;
    fallbackEntity.civilianHalo = civilianHalo;

    this.loadGltfOnce(modelPath).then((gltf) => {
      if (!gltf) return;
      const current = this.zombieEntities.get(z.id);
      if (!current || !current.usingFallbackBox || z.state === 'dying') return;

      // Hot-swap fallback box with cloned GLB model
      group.remove(current.modelRoot);
      this.disposeGroup(current.modelRoot as THREE.Group);

      const upgraded = this.instantiateGltfEntity(
        z,
        group,
        gltf,
        themeDef,
        typeConfig,
        hpBarGroup,
        hpBarFill,
        hpBarMat,
        hitboxDebugGroup
      );
      upgraded.weakPointGroup = weakPointGroup;
      upgraded.civilianHalo = civilianHalo;
      this.zombieEntities.set(z.id, upgraded);
    });

    return fallbackEntity;
  }

  private instantiateGltfEntity(
    z: ZombieState,
    group: THREE.Group,
    gltf: GLTF,
    themeDef: any,
    typeConfig: ThemeTypeConfig,
    hpBarGroup: THREE.Group,
    hpBarFill: THREE.Mesh,
    hpBarMat: THREE.MeshBasicMaterial,
    hitboxDebugGroup: THREE.Group
  ): ZombieMeshEntity {
    // Clone scene per zombie using SkeletonUtils.clone
    const clonedScene = SkeletonUtils.clone(gltf.scene);
    const tintHex = z.isCivilian
      ? '#38bdf8'
      : z.isBonusTarget
      ? '#fee440'
      : typeConfig.tint || themeDef.tint;
    const tintColor = tintHex ? new THREE.Color(tintHex) : null;

    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          if (z.isCivilian && mat.color) {
            // Friendly civilian wears bright sky-blue/white jacket & warm skin tone
            if (mat.name === 'ClothesMat') mat.color.setHex(0x00b4d8);
            if (mat.name === 'SkinMat') mat.color.setHex(0xffd6a5);
          } else if (tintColor && mat.name === 'ClothesMat' && mat.color) {
            mat.color.lerp(tintColor, 0.55);
          }
          if (z.theme === 'robot') {
            mat.metalness = 0.72;
            mat.roughness = 0.28;
          }
          mesh.material = mat;
        }
      }
    });

    group.add(clonedScene);

    // Setup THREE.AnimationMixer & map clip names from themes.json
    const mixer = new THREE.AnimationMixer(clonedScene);
    const animMap = typeConfig.animations || {
      walk: 'Walk',
      attack: 'Attack',
      death: 'Death',
      hit: 'Hit',
      idle: 'Idle',
    };

    const actions: Partial<Record<AnimClipKey, THREE.AnimationAction>> = {};
    const clips = gltf.animations || [];

    (['walk', 'attack', 'death', 'hit', 'idle'] as AnimClipKey[]).forEach((key) => {
      const clipName = animMap[key];
      if (!clipName) return;
      const clip =
        THREE.AnimationClip.findByName(clips, clipName) ||
        clips.find((c) => c.name.toLowerCase().includes(key));
      if (clip) {
        actions[key] = mixer.clipAction(clip);
      }
    });

    const entity: ZombieMeshEntity = {
      id: z.id,
      group,
      modelRoot: clonedScene,
      type: z.type,
      theme: z.theme,
      usingFallbackBox: false,
      isCivilian: z.isCivilian,
      mixer,
      actions,
      currentAnim: null,
      deathAnimFinished: false,
      deathTimer: 0,
      hpBarGroup,
      hpBarFill,
      hpBarMat,
      hitboxDebugGroup,
      hitFlashTimer: 0,
      lastHp: z.hp,
      animTime: Math.random() * 10,
    };

    // Remove corpse after death animation ends
    mixer.addEventListener('finished', (e: any) => {
      if (e.action === actions.death) {
        entity.deathAnimFinished = true;
        entity.modelRoot.visible = false;
      }
    });

    // Start initial walk animation
    if (actions.walk) {
      actions.walk.reset().play();
      entity.currentAnim = 'walk';
    }

    return entity;
  }

  // Fallback procedural zombie builder when a GLB file is missing
  private createProceduralFallbackEntity(
    z: ZombieState,
    group: THREE.Group,
    theme: any,
    hpBarGroup: THREE.Group,
    hpBarFill: THREE.Mesh,
    hpBarMat: THREE.MeshBasicMaterial,
    hitboxDebugGroup: THREE.Group
  ): ZombieMeshEntity {
    const modelRoot = new THREE.Group();
    const themeKey = z.theme || 'classic';
    const palette = theme.palette;

    let primaryClothesHex = z.isCivilian ? '#00b4d8' : palette.clothes;
    let accentHex = z.isCivilian ? '#ffffff' : palette.accent || '#ffb703';
    if (!z.isCivilian) {
      if (z.type === 'fast') {
        primaryClothesHex = '#ffbe0b';
        accentHex = '#f72585';
      } else if (z.type === 'tank') {
        primaryClothesHex = '#7209b7';
        accentHex = '#80ed99';
      } else if (z.type === 'boss') {
        primaryClothesHex = '#d90429';
        accentHex = '#ffd166';
      }
    }

    const skinColorHex = z.isCivilian ? '#ffd6a5' : palette.skin;
    const faceTex = this.getFaceTexture(skinColorHex, palette.eyes, z.type);
    const torsoTex = this.getTorsoTexture(primaryClothesHex, accentHex);

    const skinMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(skinColorHex),
      roughness: 0.42,
      metalness: themeKey === 'robot' ? 0.7 : 0.1,
    });

    const headFaceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.38,
      metalness: themeKey === 'robot' ? 0.6 : 0.1,
    });

    const headMaterials = [skinMat, skinMat, skinMat, skinMat, headFaceMat, skinMat];

    const clothesMat = new THREE.MeshStandardMaterial({
      map: torsoTex,
      roughness: 0.45,
      metalness: themeKey === 'robot' ? 0.65 : 0.2,
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.3,
      metalness: 0.45,
      emissive: new THREE.Color(accentHex),
      emissiveIntensity: 0.2,
    });

    const pantsMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.pants),
      roughness: 0.7,
      metalness: 0.15,
    });

    const eyeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.eyes),
    });

    let torso: THREE.Mesh;
    let head: THREE.Mesh;
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();
    const leftLeg = new THREE.Group();
    const rightLeg = new THREE.Group();
    let core: THREE.Mesh | undefined;

    if (z.type === 'boss') {
      torso = new THREE.Mesh(this.bossGeom.torso, clothesMat);
      torso.position.y = 2.1;
      modelRoot.add(torso);

      core = new THREE.Mesh(
        this.bossGeom.core,
        new THREE.MeshBasicMaterial({ color: 0x00f5d4 })
      );
      core.position.set(0, 2.3, 0.54);
      modelRoot.add(core);

      const halo = new THREE.Mesh(this.bossGeom.halo, accentMat);
      halo.position.set(0, 2.5, -0.5);
      modelRoot.add(halo);

      head = new THREE.Mesh(this.bossGeom.head, headMaterials);
      head.position.y = 3.35;
      modelRoot.add(head);

      const crown = new THREE.Mesh(this.bossGeom.crown, accentMat);
      crown.position.set(0, 0.55, 0);
      head.add(crown);

      const armL = new THREE.Mesh(this.bossGeom.arm, skinMat);
      armL.position.y = -0.65;
      leftArm.position.set(-1.18, 2.8, 0);
      leftArm.add(armL);
      modelRoot.add(leftArm);

      const armR = new THREE.Mesh(this.bossGeom.arm, skinMat);
      armR.position.y = -0.65;
      rightArm.position.set(1.18, 2.8, 0);
      rightArm.add(armR);
      modelRoot.add(rightArm);

      const legL = new THREE.Mesh(this.bossGeom.leg, pantsMat);
      legL.position.y = -0.65;
      leftLeg.position.set(-0.55, 1.3, 0);
      leftLeg.add(legL);
      modelRoot.add(leftLeg);

      const legR = new THREE.Mesh(this.bossGeom.leg, pantsMat);
      legR.position.y = -0.65;
      rightLeg.position.set(0.55, 1.3, 0);
      rightLeg.add(legR);
      modelRoot.add(rightLeg);
    } else if (z.type === 'tank') {
      torso = new THREE.Mesh(this.tankGeom.torso, clothesMat);
      torso.position.y = 1.45;
      modelRoot.add(torso);

      head = new THREE.Mesh(this.tankGeom.head, headMaterials);
      head.position.y = 2.3;
      modelRoot.add(head);

      const armL = new THREE.Mesh(this.tankGeom.arm, skinMat);
      armL.position.y = -0.55;
      leftArm.position.set(-0.88, 1.9, 0);
      leftArm.add(armL);
      modelRoot.add(leftArm);

      const armR = new THREE.Mesh(this.tankGeom.arm, skinMat);
      armR.position.y = -0.55;
      rightArm.position.set(0.88, 1.9, 0);
      rightArm.add(armR);
      modelRoot.add(rightArm);

      const legL = new THREE.Mesh(this.tankGeom.leg, pantsMat);
      legL.position.y = -0.5;
      leftLeg.position.set(-0.4, 0.95, 0);
      leftLeg.add(legL);
      modelRoot.add(leftLeg);

      const legR = new THREE.Mesh(this.tankGeom.leg, pantsMat);
      legR.position.y = -0.5;
      rightLeg.position.set(0.4, 0.95, 0);
      rightLeg.add(legR);
      modelRoot.add(rightLeg);
    } else {
      const isFast = z.type === 'fast';
      const scaleY = isFast ? 0.85 : 1.0;

      torso = new THREE.Mesh(this.normalGeom.torso, clothesMat);
      torso.position.y = 1.15 * scaleY;
      modelRoot.add(torso);

      head = new THREE.Mesh(this.normalGeom.head, headMaterials);
      head.position.y = 1.72 * scaleY;
      modelRoot.add(head);

      const shoulderL = new THREE.Mesh(this.normalGeom.shoulder, clothesMat);
      leftArm.add(shoulderL);
      const armL = new THREE.Mesh(this.normalGeom.arm, skinMat);
      armL.position.y = -0.34;
      leftArm.add(armL);
      const clawL = new THREE.Mesh(this.normalGeom.claw, eyeMat);
      clawL.rotation.x = Math.PI;
      clawL.position.set(0, -0.7, 0.05);
      leftArm.add(clawL);
      leftArm.position.set(-0.44, 1.45 * scaleY, 0);
      modelRoot.add(leftArm);

      const shoulderR = new THREE.Mesh(this.normalGeom.shoulder, clothesMat);
      rightArm.add(shoulderR);
      const armR = new THREE.Mesh(this.normalGeom.arm, skinMat);
      armR.position.y = -0.34;
      rightArm.add(armR);
      const clawR = new THREE.Mesh(this.normalGeom.claw, eyeMat);
      clawR.rotation.x = Math.PI;
      clawR.position.set(0, -0.7, 0.05);
      rightArm.add(clawR);
      rightArm.position.set(0.44, 1.45 * scaleY, 0);
      modelRoot.add(rightArm);

      const legL = new THREE.Mesh(this.normalGeom.leg, pantsMat);
      legL.position.y = -0.38;
      leftLeg.position.set(-0.18, 0.75 * scaleY, 0);
      leftLeg.add(legL);
      modelRoot.add(leftLeg);

      const legR = new THREE.Mesh(this.normalGeom.leg, pantsMat);
      legR.position.y = -0.38;
      rightLeg.position.set(0.18, 0.75 * scaleY, 0);
      rightLeg.add(legR);
      modelRoot.add(rightLeg);
    }

    group.add(modelRoot);

    return {
      id: z.id,
      group,
      modelRoot,
      type: z.type,
      theme: themeKey,
      usingFallbackBox: true,
      isCivilian: z.isCivilian,
      actions: {},
      currentAnim: null,
      deathAnimFinished: false,
      deathTimer: 0,
      head,
      torso,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      core,
      hpBarGroup,
      hpBarFill,
      hpBarMat,
      hitboxDebugGroup,
      hitFlashTimer: 0,
      lastHp: z.hp,
      animTime: Math.random() * 10,
    };
  }

  private animateFallbackZombie(entity: ZombieMeshEntity, z: ZombieState) {
    if (!entity.head || !entity.torso || !entity.leftArm || !entity.rightArm || !entity.leftLeg || !entity.rightLeg) {
      return;
    }

    if (z.state === 'dying') {
      const p = z.deathProgress || 0;
      entity.modelRoot.rotation.x = -p * 1.5;
      entity.modelRoot.position.y = -p * 0.8;
      if (p >= 0.92) {
        entity.modelRoot.visible = false;
      }
      return;
    }

    const t = entity.animTime;
    if (z.state === 'attacking') {
      const slashCycle = Math.sin(t * 4.5);
      const altSlash = Math.cos(t * 4.5);
      entity.leftArm.rotation.x = -1.55 + slashCycle * 0.85;
      entity.rightArm.rotation.x = -1.55 + altSlash * 0.85;
      entity.head.rotation.y = Math.sin(t * 5) * 0.3;
      entity.torso.rotation.x = 0.32 + Math.sin(t * 4.5) * 0.14;
    } else {
      const walkSwing = Math.sin(t);
      const isRunner = z.type === 'fast';
      entity.leftLeg.rotation.x = walkSwing * (isRunner ? 1.1 : 0.65);
      entity.rightLeg.rotation.x = -walkSwing * (isRunner ? 1.1 : 0.65);
      entity.leftArm.rotation.x = -0.95 + Math.sin(t * 0.8) * 0.35;
      entity.rightArm.rotation.x = -0.95 - Math.cos(t * 0.8) * 0.35;
      entity.torso.rotation.z = Math.sin(t * 0.5) * 0.09;
    }
  }

  private getFaceTexture(skinHex: string, eyeHex: string, type: ZombieType): THREE.CanvasTexture {
    const key = `${skinHex}_${eyeHex}_${type}`;
    if (this.faceTextureCache.has(key)) return this.faceTextureCache.get(key)!;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = skinHex;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = eyeHex;
    ctx.fillRect(24, 48, 24, 14);
    ctx.fillRect(80, 48, 24, 14);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(24, 82, 80, 26);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.faceTextureCache.set(key, tex);
    return tex;
  }

  private getTorsoTexture(clothesHex: string, accentHex: string): THREE.CanvasTexture {
    const key = `${clothesHex}_${accentHex}`;
    if (this.torsoTextureCache.has(key)) return this.torsoTextureCache.get(key)!;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = clothesHex;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = accentHex;
    ctx.fillRect(12, 62, 104, 18);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.torsoTextureCache.set(key, tex);
    return tex;
  }

  private removeZombieEntity(id: string, entity: ZombieMeshEntity) {
    if (entity.mixer) {
      entity.mixer.stopAllAction();
      entity.mixer.uncacheRoot(entity.modelRoot);
    }
    this.scene.remove(entity.group);
    this.disposeGroup(entity.modelRoot as THREE.Group);
    entity.hpBarMat.dispose();
    this.zombieEntities.delete(id);
  }

  private disposeGroup(group: THREE.Object3D) {
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });
  }

  public dispose() {
    for (const [id, entity] of this.zombieEntities.entries()) {
      this.removeZombieEntity(id, entity);
    }
    this.zombieEntities.clear();
  }
}
