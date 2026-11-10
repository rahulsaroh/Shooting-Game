import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ZombieManager } from './ZombieManager.ts';
import { ParticleSystem } from './ParticleSystem.ts';
import { GamePhase, GameWorldState, PostProcessingQuality } from '../../shared/types.ts';
import { PLAYER_COLORS, STAGES } from '../../shared/config.ts';

/**
 * Phase 1: Evenly space 1 to 8 player turrets across the bottom edge of the screen.
 * Shared by ThreeScene (3D foreground turrets) and HudOverlay (player name/ammo tags).
 */
export function getTurretScreenX(index: number, totalPlayers: number): number {
  if (totalPlayers <= 1) return 0.5;
  const clampedTotal = Math.min(8, Math.max(2, totalPlayers));
  const halfSpan = Math.min(0.4, 0.14 + (clampedTotal - 2) * 0.043);
  const startX = 0.5 - halfSpan;
  const step = (halfSpan * 2) / (clampedTotal - 1);
  return startX + index * step;
}

interface PlayerTurretUnit {
  root: THREE.Group;
  swivelHead: THREE.Group;
  barrelGroup: THREE.Group;
  muzzleTip: THREE.Object3D;
  muzzleFlashGroup: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  barrelMat: THREE.MeshBasicMaterial;
  visorMat: THREE.MeshBasicMaterial;
  flashMat: THREE.MeshBasicMaterial;
  targetQuat: THREE.Quaternion;
  targetWorldPos: THREE.Vector3;
  recoil: number;
  flashTimer: number;
  assignedSlot: number;
  colorHex: string;
}

export class ThreeScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private qualityMode: PostProcessingQuality = 'high';
  private maxAnisotropy = 1;
  private lowFpsCounter = 0;
  private isSoftwareGl: boolean;
  private frameId = 0;
  private isDestroyed = false;
  private currentPhase: GamePhase = 'LOBBY';
  private currentStageIndex = -1;
  private isKidsMode = false;

  public zombieManager: ZombieManager;
  public particleSystem: ParticleSystem;

  // Hit-Stop & Slow-Motion state (Phase A)
  private hitStopRemainingMs = 0;
  private slowMoActive = false;

  // Camera & Patrol Vehicle motion state
  private shakeIntensity = 0;
  private baseCamPos = new THREE.Vector3(0, 2.4, 5.0);
  private baseCamLook = new THREE.Vector3(0, 1.2, -18.0);

  // Scrolling City Segments (2 seamless 60m city blocks that loop continuously)
  private readonly citySegmentLength = 60;
  private citySegments: THREE.Group[] = [];

  // Phase 1: Foreground Bottom-Edge Player Turrets (supports 1 to 8 players dynamically)
  private turretsGroup = new THREE.Group();
  private turretUnits: PlayerTurretUnit[] = [];
  private lookHelper = new THREE.Object3D();
  private lastShotsByPlayerId: Map<string, number> = new Map();
  private lastLaserTimeBySlot: Map<number, number> = new Map();

  // Shared Procedural Textures
  private roadTexture!: THREE.CanvasTexture;
  private buildingTextures: THREE.CanvasTexture[] = [];
  private billboardTextures: THREE.CanvasTexture[] = [];
  private bioHazardTextures: THREE.CanvasTexture[] = [];

  // Phase 5: Config-driven Stage Prop Groups & Background Focal Cores
  private downtownGroups: THREE.Group[] = [];
  private biolabGroups: THREE.Group[] = [];
  private citadelGroups: THREE.Group[] = [];
  private roadMaterials: THREE.MeshStandardMaterial[] = [];
  private sidewalkMaterials: THREE.MeshStandardMaterial[] = [];
  private downtownMoon!: THREE.Mesh;
  private biolabReactorGroup = new THREE.Group();
  private citadelCoreGroup = new THREE.Group();
  private biolabBubbles: THREE.Mesh[] = [];
  private biolabSteamClouds: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseY: number; phase: number }[] = [];

  // Lighting & Atmosphere
  private dirLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private fog!: THREE.FogExp2;
  private neonPinkLight!: THREE.PointLight;
  private neonCyanLight!: THREE.PointLight;
  private policeLightRed!: THREE.PointLight;
  private policeLightBlue!: THREE.PointLight;
  private emergencyBeaconsRed: THREE.Mesh[] = [];
  private emergencyBeaconsBlue: THREE.Mesh[] = [];
  private forcefieldRailMat!: THREE.MeshBasicMaterial;

  // Barricade at z = -1.8 where zombies attack (no longer occluded by turrets)
  private barricadeGroup = new THREE.Group();

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Detect Software WebGL
    this.isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();

    // 2. Initialize Three.js Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.1,
      140
    );
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(this.baseCamLook);

    // 3. Native 4K UHD Renderer with Hardware MSAA & Zero Bloom/Glow Blur
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    const targetDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2.5);
    this.renderer.setPixelRatio(targetDpr);
    this.maxAnisotropy = this.isSoftwareGl
      ? 1
      : Math.min(16, this.renderer.capabilities.getMaxAnisotropy() || 8);

    const initialWidth = container.clientWidth || window.innerWidth;
    const initialHeight = container.clientHeight || window.innerHeight;
    this.renderer.setSize(initialWidth, initialHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    if (this.isSoftwareGl) {
      this.qualityMode = 'low';
    }

    // 4. Studio Environment Reflection via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 5. Generate Procedural City Textures
    this.generateCityTextures();

    // 6. Lighting & Fog Rig
    this.setupLighting();

    // 7. Build Moving City Environment (Buildings, Trees, Alleys, Cars & Patrol Turret)
    this.buildWorldEnvironment();

    // 8. Subsystems
    this.zombieManager = new ZombieManager(this.scene);
    this.particleSystem = new ParticleSystem(this.scene);

    // 9. Start loop and handle resize
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.onWindowResize);

    this.startLoop();
  }

  private generateCityTextures() {
    // 1. High-Resolution 4K-Ready Multi-Lane Asphalt Road Texture (1024x1024 with 16x Anisotropy)
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 1024;
    roadCanvas.height = 1024;
    const rCtx = roadCanvas.getContext('2d')!;
    rCtx.fillStyle = '#141829';
    rCtx.fillRect(0, 0, 1024, 1024);

    for (let i = 0; i < 3600; i++) {
      rCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
      rCtx.fillRect(Math.random() * 1024, Math.random() * 1024, 4, 4);
    }

    rCtx.fillStyle = 'rgba(56, 189, 248, 0.55)';
    rCtx.fillRect(48, 0, 10, 1024);
    rCtx.fillStyle = 'rgba(244, 63, 94, 0.55)';
    rCtx.fillRect(966, 0, 10, 1024);

    rCtx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    for (let y = 40; y < 1024; y += 128) {
      rCtx.fillRect(280, y, 10, 68);
      rCtx.fillRect(734, y, 10, 68);
    }

    rCtx.fillStyle = '#facc15';
    for (let y = 24; y < 1024; y += 128) {
      rCtx.fillRect(500, y, 8, 76);
      rCtx.fillRect(516, y, 8, 76);
    }

    this.roadTexture = new THREE.CanvasTexture(roadCanvas);
    this.roadTexture.wrapS = THREE.RepeatWrapping;
    this.roadTexture.wrapT = THREE.RepeatWrapping;
    this.roadTexture.repeat.set(1, 5);
    this.roadTexture.anisotropy = this.maxAnisotropy;
    this.roadTexture.colorSpace = THREE.SRGBColorSpace;

    // 2. High-Resolution Skyscraper Window Grid Facade Textures (512x1024)
    const facadePalettes = [
      { wall: '#171936', trim: '#252954', litA: '#fde68a', litB: '#38bdf8' },
      { wall: '#24123b', trim: '#381c5c', litA: '#fbcfe8', litB: '#fde047' },
      { wall: '#112240', trim: '#1d3557', litA: '#a7f3d0', litB: '#fde68a' },
    ];

    facadePalettes.forEach((pal) => {
      const bCanvas = document.createElement('canvas');
      bCanvas.width = 512;
      bCanvas.height = 1024;
      const bCtx = bCanvas.getContext('2d')!;

      bCtx.fillStyle = pal.wall;
      bCtx.fillRect(0, 0, 512, 1024);

      bCtx.fillStyle = pal.trim;
      for (let y = 0; y < 1024; y += 96) {
        bCtx.fillRect(0, y, 512, 12);
      }

      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 4; col++) {
          const wx = 36 + col * 116;
          const wy = 28 + row * 96;
          const rand = Math.sin(row * 7.3 + col * 3.1);
          if (rand > 0.15) {
            bCtx.fillStyle = rand > 0.65 ? pal.litB : pal.litA;
          } else {
            bCtx.fillStyle = '#090d16';
          }
          bCtx.fillRect(wx, wy, 80, 52);

          bCtx.strokeStyle = pal.trim;
          bCtx.lineWidth = 4;
          bCtx.strokeRect(wx, wy, 80, 52);
        }
      }

      const tex = new THREE.CanvasTexture(bCanvas);
      tex.anisotropy = this.maxAnisotropy;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.buildingTextures.push(tex);
    });

    // 3. High-Resolution Arcade Storefront Billboard Textures (1024x256)
    const signs = [
      { text: 'TIMEZONE ARENA', bg: '#1e1b4b', border: '#38bdf8', color: '#ffffff' },
      { text: 'CYBER BOWL 24H', bg: '#1e1b4b', border: '#facc15', color: '#facc15' },
      { text: 'NEO TOKYO PLAZA', bg: '#0f172a', border: '#f43f5e', color: '#38bdf8' },
      { text: 'LASER ZONE VIP', bg: '#0f172a', border: '#34d399', color: '#ffffff' },
    ];

    signs.forEach((s) => {
      const sCanvas = document.createElement('canvas');
      sCanvas.width = 1024;
      sCanvas.height = 256;
      const sCtx = sCanvas.getContext('2d')!;

      sCtx.fillStyle = s.bg;
      sCtx.fillRect(0, 0, 1024, 256);

      sCtx.strokeStyle = s.border;
      sCtx.lineWidth = 18;
      sCtx.strokeRect(16, 16, 992, 224);

      sCtx.fillStyle = s.color;
      sCtx.font = 'bold 84px "Chakra Petch", sans-serif';
      sCtx.textAlign = 'center';
      sCtx.textBaseline = 'middle';
      sCtx.fillText(s.text, 512, 132);

      const tex = new THREE.CanvasTexture(sCanvas);
      tex.anisotropy = this.maxAnisotropy;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.billboardTextures.push(tex);
    });

    // 4. High-Resolution Stage 2 Bio-Lab Reactor Hazard Signs (1024x256)
    const hazardSigns = [
      { text: '☢ BIO-HAZARD SECTOR B-12', bg: '#052e16', border: '#4ade80', color: '#dcfce7' },
      { text: '⚠ CONTAINMENT CHAMBER', bg: '#0f291e', border: '#facc15', color: '#fef08a' },
      { text: '⚡ REACTOR CORE COOLANT', bg: '#042f2e', border: '#2dd4bf', color: '#ccfbf1' },
    ];
    hazardSigns.forEach((hs) => {
      const hCanvas = document.createElement('canvas');
      hCanvas.width = 1024;
      hCanvas.height = 256;
      const hCtx = hCanvas.getContext('2d')!;

      hCtx.fillStyle = hs.bg;
      hCtx.fillRect(0, 0, 1024, 256);

      hCtx.strokeStyle = hs.border;
      hCtx.lineWidth = 18;
      hCtx.strokeRect(16, 16, 992, 224);

      hCtx.fillStyle = hs.color;
      hCtx.font = 'bold 68px "Chakra Petch", sans-serif';
      hCtx.textAlign = 'center';
      hCtx.textBaseline = 'middle';
      hCtx.fillText(hs.text, 512, 132);

      const tex = new THREE.CanvasTexture(hCanvas);
      tex.anisotropy = this.maxAnisotropy;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.bioHazardTextures.push(tex);
    });
  }

  private setupLighting() {
    this.scene.background = new THREE.Color(0x0f172a);
    // Low fog density so 4K TV displays remain crystal clear into the distance without atmospheric glow/haze
    this.fog = new THREE.FogExp2(0x0f172a, 0.007);
    this.scene.fog = this.fog;

    this.hemiLight = new THREE.HemisphereLight(0x94a3b8, 0x0f172a, 1.05);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffbeb, 1.45);
    this.dirLight.position.set(12, 22, 10);
    if (!this.isSoftwareGl) {
      this.dirLight.castShadow = true;
      // 2048x2048 shadow map for crisp shadows on 4K TV screens
      this.dirLight.shadow.mapSize.width = 2048;
      this.dirLight.shadow.mapSize.height = 2048;
      this.dirLight.shadow.camera.near = 1;
      this.dirLight.shadow.camera.far = 65;
      this.dirLight.shadow.camera.left = -22;
      this.dirLight.shadow.camera.right = 22;
      this.dirLight.shadow.camera.top = 22;
      this.dirLight.shadow.camera.bottom = -5;
      this.dirLight.shadow.bias = -0.0005;
      this.dirLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.dirLight);

    // Subtle non-glowing fill lights (toned down so they never create neon glare on screen)
    this.neonPinkLight = new THREE.PointLight(0xe2e8f0, 0.45, 20);
    this.neonPinkLight.position.set(-8.5, 5.5, -12);
    this.scene.add(this.neonPinkLight);

    this.neonCyanLight = new THREE.PointLight(0xbae6fd, 0.45, 20);
    this.neonCyanLight.position.set(8.5, 5.5, -16);
    this.scene.add(this.neonCyanLight);

    this.policeLightRed = new THREE.PointLight(0xff0044, 0.8, 12);
    this.policeLightRed.position.set(-5.8, 2.2, -16.5);
    this.scene.add(this.policeLightRed);

    this.policeLightBlue = new THREE.PointLight(0x0088ff, 0.2, 12);
    this.policeLightBlue.position.set(-5.0, 2.2, -16.5);
    this.scene.add(this.policeLightBlue);
  }

  public applyStageAtmosphere(stageIdx: number, isKids: boolean) {
    const stage = STAGES[stageIdx] || STAGES[0];
    this.currentStageIndex = stageIdx;
    this.isKidsMode = isKids;
    this.zombieManager.setKidsMode(isKids);

    // Phase 5: Toggle config-driven 3D stage prop sets (Downtown vs Bio-Lab Reactor vs Cyber Citadel)
    const isDowntown = stage.propSet === 'downtown';
    const isBiolab = stage.propSet === 'biolab';
    const isCitadel = stage.propSet === 'citadel';

    this.downtownGroups.forEach((g) => {
      g.visible = isDowntown;
    });
    this.biolabGroups.forEach((g) => {
      g.visible = isBiolab;
    });
    this.citadelGroups.forEach((g) => {
      g.visible = isCitadel;
    });

    if (this.downtownMoon) this.downtownMoon.visible = isDowntown;
    this.biolabReactorGroup.visible = isBiolab;
    this.citadelCoreGroup.visible = isCitadel;

    for (const rMat of this.roadMaterials) {
      rMat.color.set(stage.roadColor || '#141829');
    }
    for (const sMat of this.sidewalkMaterials) {
      sMat.color.set(stage.sidewalkColor || '#1e293b');
    }

    if (isKids) {
      this.scene.background = new THREE.Color(isBiolab ? 0x0b3b2e : 0x1b4332);
      this.fog.color = new THREE.Color(isBiolab ? 0x0b3b2e : 0x1b4332);
      this.fog.density = 0.006;
      this.hemiLight.color = new THREE.Color(isBiolab ? 0x86efac : 0x7dd3fc);
      this.hemiLight.groundColor = new THREE.Color(0x334155);
      this.dirLight.color = new THREE.Color(0xfffae0);
      this.dirLight.intensity = 1.45;
    } else {
      this.scene.background = new THREE.Color(stage.skyColor);
      this.fog.color = new THREE.Color(stage.fogColor);
      this.fog.density = 0.007;
      this.hemiLight.color = new THREE.Color(stage.ambientColor);
      this.hemiLight.groundColor = new THREE.Color(isBiolab ? 0x052e16 : 0x0f172a);
      this.dirLight.color = new THREE.Color(stage.directionalLightColor);
      this.dirLight.intensity = isBiolab ? 1.3 : 1.4;
      this.neonCyanLight.color = new THREE.Color(stage.accentLightColor);
      this.neonPinkLight.color = new THREE.Color(isBiolab ? 0x5eead4 : 0xcbd5e1);
    }
  }

  public applyModeAtmosphere(isKids: boolean) {
    this.applyStageAtmosphere(Math.max(0, this.currentStageIndex), isKids);
  }

  public setQualityMode(quality: PostProcessingQuality) {
    if (this.isSoftwareGl) {
      this.qualityMode = 'low';
      return;
    }
    this.qualityMode = quality;
  }

  public getQualityMode(): PostProcessingQuality {
    return this.qualityMode;
  }

  // Phase A: Short Hit-Stop freeze on heavy hits / headshots / weak points
  public triggerHitStop(durationMs = 45) {
    this.hitStopRemainingMs = Math.max(this.hitStopRemainingMs, durationMs);
  }

  public screenToWorldAtDepth(normX: number, normY: number, zTarget = -14): THREE.Vector3 {
    const aspect =
      (this.container.clientWidth || window.innerWidth) /
      (this.container.clientHeight || window.innerHeight);
    const focalY = 0.940363;
    const focalX = focalY / aspect;

    const zCam = 5.0 - zTarget;
    const xCam = ((normX - 0.5) * zCam) / focalX;
    const yCam = ((0.5 - normY) * zCam) / focalY;

    const worldX = xCam;
    const worldY = 2.4 + yCam * 0.998642 - zCam * 0.052103;
    return new THREE.Vector3(worldX, worldY, zTarget);
  }

  public firePlayerLaser(
    slot: number,
    normX: number,
    normY: number,
    colorHex: string,
    hitPos?: { x: number; y: number; z: number }
  ) {
    this.lastLaserTimeBySlot.set(slot, performance.now());

    // Find the foreground turret assigned to this player's slot (or fallback slot index)
    let unit = this.turretUnits.find((u) => u.root.visible && u.assignedSlot === slot);
    if (!unit && this.turretUnits.length > 0) {
      unit = this.turretUnits[(Math.max(1, slot) - 1) % this.turretUnits.length];
    }

    const target = hitPos
      ? new THREE.Vector3(hitPos.x, hitPos.y + 1.9, hitPos.z)
      : this.screenToWorldAtDepth(normX, normY, -22);

    const muzzlePos = new THREE.Vector3();
    if (unit) {
      // Trigger barrel recoil kickback and 3D muzzle flash burst
      unit.recoil = 0.095;
      unit.flashTimer = 0.075;
      unit.flashMat.color.set(colorHex);
      unit.flashMat.opacity = 1.0;
      unit.muzzleFlashGroup.visible = true;
      unit.muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
      unit.muzzleFlashGroup.scale.setScalar(1.15);

      const swivelWorldPos = new THREE.Vector3();
      unit.swivelHead.getWorldPosition(swivelWorldPos);
      this.lookHelper.position.copy(swivelWorldPos);
      this.lookHelper.lookAt(target);
      unit.targetQuat.copy(this.lookHelper.quaternion);
      unit.swivelHead.quaternion.slerp(unit.targetQuat, 0.65);
      unit.swivelHead.updateMatrixWorld(true);
      unit.muzzleTip.getWorldPosition(muzzlePos);
    } else {
      const fallbackPos = this.screenToWorldAtDepth(0.5, 0.9, 3.25);
      muzzlePos.copy(fallbackPos);
    }

    this.particleSystem.spawnLaserTracer(
      muzzlePos.x,
      muzzlePos.y,
      muzzlePos.z,
      target.x,
      target.y,
      target.z,
      colorHex
    );
  }

  private createCityTree(scale = 1.0, isNeonAccent = false): THREE.Group {
    const treeGroup = new THREE.Group();

    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      roughness: 0.85,
    });
    const foliageDarkMat = new THREE.MeshStandardMaterial({
      color: 0x1b4332,
      roughness: 0.6,
    });
    const foliageMidMat = new THREE.MeshStandardMaterial({
      color: 0x2d6a4f,
      roughness: 0.55,
    });
    const foliageBrightMat = new THREE.MeshStandardMaterial({
      color: isNeonAccent ? 0x52b788 : 0x40916c,
      roughness: 0.5,
    });

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.8, 8), trunkMat);
    trunk.position.y = 0.9;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    const bottomCone = new THREE.Mesh(new THREE.ConeGeometry(1.45, 2.2, 8), foliageDarkMat);
    bottomCone.position.y = 2.4;
    bottomCone.castShadow = true;
    treeGroup.add(bottomCone);

    const midCone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.9, 8), foliageMidMat);
    midCone.position.y = 3.5;
    midCone.castShadow = true;
    treeGroup.add(midCone);

    const topCone = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 8), foliageBrightMat);
    topCone.position.y = 4.5;
    topCone.castShadow = true;
    treeGroup.add(topCone);

    // Phase 4 Fix: Removed stray DodecahedronGeometry bush offset that appeared as an unidentified polygon on the right side of the frame
    treeGroup.scale.setScalar(scale);
    return treeGroup;
  }

  private createScrollingCitySegment(zOffset: number): THREE.Group {
    const seg = new THREE.Group();
    seg.position.z = zOffset;

    const roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0.25,
    });
    this.roadMaterials.push(roadMat);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(20, this.citySegmentLength),
      roadMat
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -this.citySegmentLength / 2;
    road.receiveShadow = true;
    seg.add(road);

    // Phase 4 Fix: Narrower, darker metallic walkways so no flat gray slab protrudes on the right edge of the frame
    const sidewalkGeom = new THREE.BoxGeometry(5.5, 0.24, this.citySegmentLength);
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x161b2e,
      roughness: 0.65,
      metalness: 0.35,
    });
    this.sidewalkMaterials.push(sidewalkMat);

    const sidewalkL = new THREE.Mesh(sidewalkGeom, sidewalkMat);
    sidewalkL.position.set(-12.75, 0.12, -this.citySegmentLength / 2);
    sidewalkL.receiveShadow = true;
    seg.add(sidewalkL);

    const sidewalkR = new THREE.Mesh(sidewalkGeom, sidewalkMat);
    sidewalkR.position.set(12.75, 0.12, -this.citySegmentLength / 2);
    sidewalkR.receiveShadow = true;
    seg.add(sidewalkR);

    // =========================================================================
    // STAGE 1 PROP SET: NEON DOWNTOWN ('downtown')
    // =========================================================================
    const downtownGroup = new THREE.Group();
    const buildingConfigs = [
      { x: -15.5, z: -8, h: 12, d: 8.5, texIdx: 0, signIdx: 0, neonColor: 0xf72585 },
      { x: -15.5, z: -24, h: 15, d: 9.0, texIdx: 1, signIdx: 1, neonColor: 0xffbe0b },
      { x: -15.5, z: -42, h: 11, d: 8.5, texIdx: 2, signIdx: 2, neonColor: 0x00f5d4 },
      { x: -15.5, z: -55, h: 13, d: 7.5, texIdx: 0, signIdx: 3, neonColor: 0x80ed99 },
      { x: 15.5, z: -10, h: 13, d: 8.5, texIdx: 2, signIdx: 2, neonColor: 0x00f5d4 },
      { x: 15.5, z: -27, h: 15, d: 9.0, texIdx: 0, signIdx: 3, neonColor: 0x80ed99 },
      { x: 15.5, z: -44, h: 12, d: 8.5, texIdx: 1, signIdx: 0, neonColor: 0xf72585 },
      { x: 15.5, z: -56, h: 14, d: 7.5, texIdx: 2, signIdx: 1, neonColor: 0xffbe0b },
    ];

    buildingConfigs.forEach((cfg) => {
      const bGroup = new THREE.Group();
      const facadeTex = this.buildingTextures[cfg.texIdx % this.buildingTextures.length];
      const bMesh = new THREE.Mesh(
        new THREE.BoxGeometry(7, cfg.h, cfg.d),
        new THREE.MeshStandardMaterial({
          map: facadeTex,
          roughness: 0.55,
          metalness: 0.3,
        })
      );
      bMesh.position.y = cfg.h / 2;
      bGroup.add(bMesh);

      const signSide = cfg.x < 0 ? 3.56 : -3.56;
      const neonMat = new THREE.MeshBasicMaterial({ color: cfg.neonColor });
      const billboardTex = this.billboardTextures[cfg.signIdx % this.billboardTextures.length];

      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 1.35, cfg.d * 0.72),
        new THREE.MeshBasicMaterial({ map: billboardTex })
      );
      sign.position.set(signSide, 4.1, 0);
      bGroup.add(sign);

      const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.3, cfg.d + 0.2), neonMat);
      roofTrim.position.y = cfg.h + 0.15;
      bGroup.add(roofTrim);

      bGroup.position.set(cfg.x, 0, cfg.z);
      downtownGroup.add(bGroup);
    });

    const treePlacements = [
      { x: -10.8, z: -4.5, scale: 1.05, neon: true },
      { x: -11.4, z: -16.0, scale: 1.25, neon: false },
      { x: -10.6, z: -33.0, scale: 1.15, neon: true },
      { x: -11.2, z: -49.0, scale: 1.2, neon: false },
      { x: 10.8, z: -4.0, scale: 1.15, neon: false },
      { x: 11.4, z: -18.5, scale: 1.3, neon: true },
      { x: 10.6, z: -35.5, scale: 1.1, neon: false },
      { x: 11.2, z: -50.0, scale: 1.25, neon: true },
    ];

    treePlacements.forEach((tp) => {
      const tree = this.createCityTree(tp.scale, tp.neon);
      tree.position.set(tp.x, 0, tp.z);
      if (tp.x > 0) tree.rotation.y = Math.PI;
      downtownGroup.add(tree);
    });

    // Phase 4 Fix: Cruiser cabin now uses dark tinted glass (0x0f172a) with cyan neon trim instead of a bright white floating block (0xf8f9fa)
    const cruiserGroup = new THREE.Group();
    const carBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.75, 4.0),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.75 })
    );
    carBody.position.y = 0.65;
    cruiserGroup.add(carBody);

    const carCabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 0.55, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.85 })
    );
    carCabin.position.set(0, 1.24, -0.2);
    cruiserGroup.add(carCabin);

    const beaconRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.18, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff0044 })
    );
    beaconRed.position.set(-0.38, 1.62, -0.2);
    cruiserGroup.add(beaconRed);
    this.emergencyBeaconsRed.push(beaconRed);

    const beaconBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.18, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x0088ff })
    );
    beaconBlue.position.set(0.38, 1.62, -0.2);
    cruiserGroup.add(beaconBlue);
    this.emergencyBeaconsBlue.push(beaconBlue);

    cruiserGroup.position.set(-7.6, 0, -21);
    cruiserGroup.rotation.y = 0.32;
    downtownGroup.add(cruiserGroup);

    const postGeom = new THREE.CylinderGeometry(0.11, 0.15, 6.0, 8);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.8,
      roughness: 0.3,
    });

    [-9.8, 9.8].forEach((xSide, sideIdx) => {
      [-12, -28, -45].forEach((zPos, idx) => {
        const post = new THREE.Mesh(postGeom, postMat);
        post.position.set(xSide, 3.0, zPos);
        downtownGroup.add(post);

        const bulbColor = (sideIdx + idx) % 2 === 0 ? 0x00f5d4 : 0xf72585;
        const lampHead = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 10, 10),
          new THREE.MeshBasicMaterial({ color: bulbColor })
        );
        lampHead.position.set(xSide, 6.0, zPos);
        downtownGroup.add(lampHead);
      });
    });

    this.downtownGroups.push(downtownGroup);
    seg.add(downtownGroup);

    // =========================================================================
    // STAGE 2 PROP SET: BIO-LAB REACTOR ('biolab') — Phase 5
    // Containment tubes with glowing liquid, hazard signs, steam vents, metal walkways
    // =========================================================================
    const biolabGroup = new THREE.Group();
    biolabGroup.visible = false;

    const labWallMat = new THREE.MeshStandardMaterial({
      color: 0x0b261f,
      roughness: 0.4,
      metalness: 0.75,
    });
    const metalFrameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.3,
      metalness: 0.85,
    });
    const bioLiquidGreenMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.45,
      metalness: 0.15,
      transparent: true,
      opacity: 0.72,
    });
    const bioLiquidTealMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      roughness: 0.45,
      metalness: 0.15,
      transparent: true,
      opacity: 0.68,
    });
    const glassTubeMat = new THREE.MeshStandardMaterial({
      color: 0xa7f3d0,
      roughness: 0.2,
      metalness: 0.2,
      transparent: true,
      opacity: 0.28,
    });

    // Reinforced Bio-Lab Corridor Walls & Hazard Signs
    [-15.2, 15.2].forEach((wallX, sideIdx) => {
      [-10, -26, -42, -55].forEach((zPos, idx) => {
        const wallBlock = new THREE.Mesh(new THREE.BoxGeometry(5.5, 12.5, 11.5), labWallMat);
        wallBlock.position.set(wallX, 6.25, zPos);
        biolabGroup.add(wallBlock);

        // Bio-Lab coolant conduit strips along walls (non-glowing matte finish)
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.24, 11.2),
          idx % 2 === 0 ? bioLiquidGreenMat : bioLiquidTealMat
        );
        strip.position.set(wallX < 0 ? wallX + 2.82 : wallX - 2.82, 2.2, zPos);
        biolabGroup.add(strip);

        // Bio-Hazard Sign Boards
        const signTex = this.bioHazardTextures[(sideIdx + idx) % this.bioHazardTextures.length];
        if (signTex) {
          const hazardSign = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, 1.3, 4.8),
            new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, metalness: 0.1 })
          );
          hazardSign.position.set(wallX < 0 ? wallX + 2.85 : wallX - 2.85, 5.2, zPos);
          biolabGroup.add(hazardSign);
        }
      });
    });

    // Cylindrical Containment Tubes with Bio-Liquid & Rising Bubbles
    [-10.4, 10.4].forEach((tubeX, sideIdx) => {
      [-9, -23, -38, -52].forEach((tubeZ, idx) => {
        const vatGroup = new THREE.Group();
        vatGroup.position.set(tubeX, 0, tubeZ);

        // Metal base & top cap
        const baseCap = new THREE.Mesh(
          new THREE.CylinderGeometry(1.3, 1.4, 0.65, 16),
          metalFrameMat
        );
        baseCap.position.y = 0.32;
        vatGroup.add(baseCap);

        const topCap = new THREE.Mesh(
          new THREE.CylinderGeometry(1.35, 1.3, 0.6, 16),
          metalFrameMat
        );
        topCap.position.y = 6.2;
        vatGroup.add(topCap);

        // Bio-Liquid Core inside tube (shaded non-glowing material)
        const liquidMat = (sideIdx + idx) % 2 === 0 ? bioLiquidGreenMat : bioLiquidTealMat;
        const liquidCore = new THREE.Mesh(
          new THREE.CylinderGeometry(0.95, 0.95, 5.2, 14),
          liquidMat
        );
        liquidCore.position.y = 3.25;
        vatGroup.add(liquidCore);

        // Outer translucent glass cylinder
        const glassShell = new THREE.Mesh(
          new THREE.CylinderGeometry(1.18, 1.18, 5.4, 16),
          glassTubeMat
        );
        glassShell.position.y = 3.25;
        vatGroup.add(glassShell);

        // Rising bio-bubbles inside containment tube
        for (let b = 0; b < 3; b++) {
          const bubble = new THREE.Mesh(
            new THREE.SphereGeometry(0.14 + b * 0.04, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x86efac, roughness: 0.4 })
          );
          bubble.position.set(
            (b - 1) * 0.32,
            1.2 + ((idx + b) % 4) * 1.1,
            0.25
          );
          vatGroup.add(bubble);
          this.biolabBubbles.push(bubble);
        }

        biolabGroup.add(vatGroup);
      });
    });

    // Elevated Metal Grating Walkways & Overhead Reactor Gantries
    [-16, -36, -54].forEach((gantryZ) => {
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(22, 0.45, 1.8),
        metalFrameMat
      );
      bridge.position.set(0, 7.8, gantryZ);
      biolabGroup.add(bridge);

      const hazardRail = new THREE.Mesh(
        new THREE.BoxGeometry(21, 0.16, 1.9),
        bioLiquidGreenMat
      );
      hazardRail.position.set(0, 8.15, gantryZ);
      biolabGroup.add(hazardRail);
    });

    // Floor Steam Vents & Rising Vapor Clouds
    [-8.6, 8.6].forEach((ventX) => {
      [-14, -31, -47].forEach((ventZ, idx) => {
        const steamMat = new THREE.MeshBasicMaterial({
          color: 0x5eead4,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        });
        const steamMesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 8), steamMat);
        steamMesh.scale.set(1.4, 0.9, 1.2);
        steamMesh.position.set(ventX, 0.8, ventZ);
        biolabGroup.add(steamMesh);
        this.biolabSteamClouds.push({
          mesh: steamMesh,
          mat: steamMat,
          baseY: 0.6,
          phase: idx * 2.1 + (ventX > 0 ? 1.0 : 0.0),
        });
      });
    });

    this.biolabGroups.push(biolabGroup);
    seg.add(biolabGroup);

    // =========================================================================
    // STAGE 3 PROP SET: CYBER CITADEL ROOFTOP ('citadel') — Phase 5
    // =========================================================================
    const citadelGroup = new THREE.Group();
    citadelGroup.visible = false;

    const spireMat = new THREE.MeshStandardMaterial({
      color: 0x1f081e,
      roughness: 0.3,
      metalness: 0.85,
    });
    const magentaLaserMat = new THREE.MeshBasicMaterial({ color: 0xf72585 });

    [-11.2, 11.2].forEach((pylonX) => {
      [-10, -24, -38, -52].forEach((pylonZ) => {
        const spire = new THREE.Mesh(
          new THREE.ConeGeometry(1.35, 11.5, 6),
          spireMat
        );
        spire.position.set(pylonX, 5.75, pylonZ);
        citadelGroup.add(spire);

        const laserRing = new THREE.Mesh(
          new THREE.TorusGeometry(1.15, 0.07, 8, 18),
          magentaLaserMat
        );
        laserRing.rotation.x = Math.PI / 2;
        laserRing.position.set(pylonX, 3.8, pylonZ);
        citadelGroup.add(laserRing);
      });
    });

    this.citadelGroups.push(citadelGroup);
    seg.add(citadelGroup);

    return seg;
  }

  private buildWorldEnvironment() {
    // Stage 1 Background Centerpiece: Distant Moon (Matte shaded, non-glowing)
    this.downtownMoon = new THREE.Mesh(
      new THREE.SphereGeometry(4.5, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.75, metalness: 0.1 })
    );
    this.downtownMoon.position.set(0, 19, -68);
    this.scene.add(this.downtownMoon);

    // Stage 2 Background Centerpiece: Industrial Bio-Lab Reactor Turbine (Shaded metal, non-glowing)
    this.biolabReactorGroup.position.set(0, 13.5, -62);
    this.biolabReactorGroup.visible = false;
    const reactorSphere = new THREE.Mesh(
      new THREE.SphereGeometry(4.0, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.45, metalness: 0.65 })
    );
    this.biolabReactorGroup.add(reactorSphere);

    const reactorRingA = new THREE.Mesh(
      new THREE.TorusGeometry(6.0, 0.32, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0x0d9488, roughness: 0.35, metalness: 0.75 })
    );
    reactorRingA.rotation.x = 0.55;
    this.biolabReactorGroup.add(reactorRingA);

    const reactorRingB = new THREE.Mesh(
      new THREE.TorusGeometry(7.4, 0.24, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.85 })
    );
    reactorRingB.rotation.y = 0.75;
    this.biolabReactorGroup.add(reactorRingB);
    this.scene.add(this.biolabReactorGroup);

    // Stage 3 Background Centerpiece: Omega Citadel Core
    this.citadelCoreGroup.position.set(0, 15.0, -64);
    this.citadelCoreGroup.visible = false;
    const omegaOcta = new THREE.Mesh(
      new THREE.OctahedronGeometry(4.8, 1),
      new THREE.MeshStandardMaterial({ color: 0xbe185d, wireframe: true, roughness: 0.4 })
    );
    this.citadelCoreGroup.add(omegaOcta);
    this.scene.add(this.citadelCoreGroup);

    const segA = this.createScrollingCitySegment(15);
    const segB = this.createScrollingCitySegment(15 - this.citySegmentLength);
    this.citySegments.push(segA, segB);
    this.scene.add(segA);
    this.scene.add(segB);

    const armorPlateGeom = new THREE.BoxGeometry(1.75, 0.78, 0.45);
    const armorPlateMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.8,
    });

    const hazardStripeMat = new THREE.MeshStandardMaterial({
      color: 0xffbe0b,
      roughness: 0.4,
      metalness: 0.4,
    });

    this.forcefieldRailMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });

    for (let x = -8.0; x <= 8.0; x += 2.0) {
      const shield = new THREE.Mesh(armorPlateGeom, armorPlateMat);
      shield.position.set(x, 0.38, -1.8);
      this.barricadeGroup.add(shield);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.5), hazardStripeMat);
      trim.position.set(x, 0.66, -1.8);
      this.barricadeGroup.add(trim);

      const energyRail = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 0.07, 0.11),
        this.forcefieldRailMat
      );
      energyRail.position.set(x, 0.92, -1.7);
      this.barricadeGroup.add(energyRail);
    }

    this.scene.add(this.barricadeGroup);

    // Phase 1: Build 8 foreground bottom-edge player turrets (close to camera at z = 3.25)
    for (let idx = 0; idx < 8; idx++) {
      const defaultColorHex = PLAYER_COLORS[idx % PLAYER_COLORS.length].hex;
      const root = new THREE.Group();

      // Compact foreground turret pedestal at the bottom edge of the screen
      const basePedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.12, 14),
        armorPlateMat
      );
      basePedestal.position.y = -0.04;
      root.add(basePedestal);

      const ringMat = new THREE.MeshBasicMaterial({ color: defaultColorHex });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 20), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      root.add(ring);

      const swivelHead = new THREE.Group();
      swivelHead.position.set(0, 0.06, 0);

      const barrelGroup = new THREE.Group();
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.09, 0.18),
        armorPlateMat
      );
      barrelGroup.add(housing);

      const visorMat = new THREE.MeshBasicMaterial({ color: defaultColorHex });
      const energyCore = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.022, 0.15),
        visorMat
      );
      energyCore.position.set(0, 0.052, 0.01);
      barrelGroup.add(energyCore);

      const barrelMat = new THREE.MeshBasicMaterial({ color: defaultColorHex });
      const barrelJacketMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.3,
        metalness: 0.85,
      });

      [-0.044, 0.044].forEach((bx) => {
        const jacket = new THREE.Mesh(
          new THREE.CylinderGeometry(0.022, 0.026, 0.22, 8),
          barrelJacketMat
        );
        jacket.rotation.x = Math.PI / 2;
        jacket.position.set(bx, 0.005, 0.14);
        barrelGroup.add(jacket);

        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.017, 0.32, 8),
          barrelMat
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(bx, 0.005, 0.19);
        barrelGroup.add(barrel);
      });

      // Muzzle tip & 3D Muzzle Flash at the front of the twin barrels (+Z in lookAt space)
      const muzzleTip = new THREE.Object3D();
      muzzleTip.position.set(0, 0.005, 0.36);
      barrelGroup.add(muzzleTip);

      const muzzleFlashGroup = new THREE.Group();
      muzzleFlashGroup.position.set(0, 0.005, 0.37);
      muzzleFlashGroup.visible = false;

      const flashMat = new THREE.MeshBasicMaterial({
        color: defaultColorHex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });

      const flashCore = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 8), flashMat);
      muzzleFlashGroup.add(flashCore);

      const flashCone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.19, 6), flashMat);
      flashCone.rotation.x = Math.PI / 2;
      flashCone.position.z = 0.08;
      muzzleFlashGroup.add(flashCone);

      const flashStarA = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.022), flashMat);
      muzzleFlashGroup.add(flashStarA);

      const flashStarB = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.18, 0.022), flashMat);
      muzzleFlashGroup.add(flashStarB);

      barrelGroup.add(muzzleFlashGroup);
      swivelHead.add(barrelGroup);
      root.add(swivelHead);

      // Position initially for 4 default slots along the bottom foreground edge
      const initScreenX = getTurretScreenX(idx, 4);
      const initPos = this.screenToWorldAtDepth(initScreenX, 0.9, 3.25);
      root.position.copy(initPos);
      root.visible = idx === 0;

      const aimCenter = this.screenToWorldAtDepth(initScreenX, 0.5, -16);
      this.lookHelper.position.copy(initPos).add(new THREE.Vector3(0, 0.06, 0));
      this.lookHelper.lookAt(aimCenter);
      swivelHead.quaternion.copy(this.lookHelper.quaternion);

      this.turretsGroup.add(root);
      this.turretUnits.push({
        root,
        swivelHead,
        barrelGroup,
        muzzleTip,
        muzzleFlashGroup,
        ringMat,
        barrelMat,
        visorMat,
        flashMat,
        targetQuat: swivelHead.quaternion.clone(),
        targetWorldPos: initPos.clone(),
        recoil: 0,
        flashTimer: 0,
        assignedSlot: idx + 1,
        colorHex: defaultColorHex,
      });
    }

    this.scene.add(this.turretsGroup);
  }

  private measuredFps = 60;
  private fpsFrameCount = 0;
  private fpsLastCheck = performance.now();

  public triggerBarricadeHit() {
    this.shakeIntensity = 0.45;
  }

  public triggerCameraShake(intensity = 0.65) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  public toggleHitboxDebug(): boolean {
    return this.zombieManager.toggleHitboxDebug();
  }

  public getMeasuredFps(): number {
    return this.measuredFps;
  }

  public isSoftwareRenderer(): boolean {
    return this.isSoftwareGl;
  }

  public updateState(world: GameWorldState, dt: number) {
    this.currentPhase = world.phase;
    this.slowMoActive = (world.slowMoRemainingMs || 0) > 0;

    if (world.settings?.postProcessingQuality && !this.isSoftwareGl) {
      this.qualityMode = world.settings.postProcessingQuality;
    }

    const stageIdx = world.stageIndex ?? 0;
    const isKids = world.settings?.mode === 'kids';
    if (stageIdx !== this.currentStageIndex || isKids !== this.isKidsMode) {
      this.applyStageAtmosphere(stageIdx, isKids);
    }

    const effectiveDt =
      this.hitStopRemainingMs > 0
        ? 0.001
        : this.slowMoActive
        ? dt * 0.35
        : dt;

    this.zombieManager.syncZombies(world.zombies, effectiveDt);
    this.particleSystem.syncPowerUps(world.powerups, effectiveDt);
    this.particleSystem.update(effectiveDt);

    // Phase 1: Sync 1 to 8 foreground bottom-edge player turrets
    const connected = world.players
      .filter((p) => p.isConnected)
      .sort((a, b) => a.slot - b.slot)
      .slice(0, 8);
    const totalActive = connected.length;
    const turretScale = totalActive >= 6 ? 0.8 : totalActive >= 4 ? 0.9 : 1.0;

    for (let i = 0; i < this.turretUnits.length; i++) {
      const unit = this.turretUnits[i];
      if (i < totalActive) {
        const player = connected[i];
        unit.root.visible = true;
        unit.root.scale.setScalar(turretScale);
        unit.assignedSlot = player.slot;

        if (unit.colorHex !== player.color) {
          unit.colorHex = player.color;
          unit.ringMat.color.set(player.color);
          unit.barrelMat.color.set(player.color);
          unit.visorMat.color.set(player.color);
          unit.flashMat.color.set(player.color);
        }

        // Compute foreground bottom-edge world position for this turret
        const screenX = getTurretScreenX(i, totalActive);
        const worldPos = this.screenToWorldAtDepth(screenX, 0.9, 3.25);
        unit.targetWorldPos.copy(worldPos);

        // Compute target rotation pointing smoothly toward the player's crosshair
        const aimWorld = this.screenToWorldAtDepth(
          player.crosshair.x,
          player.crosshair.y,
          -16
        );
        this.lookHelper.position.copy(worldPos).add(new THREE.Vector3(0, 0.06, 0));
        this.lookHelper.lookAt(aimWorld);
        unit.targetQuat.copy(this.lookHelper.quaternion);

        // Trigger recoil + muzzle flash + upward tracer when player fires (even on misses)
        const prevShots = this.lastShotsByPlayerId.get(player.id);
        if (prevShots !== undefined && player.stats.shotsFired > prevShots) {
          const lastLaser = this.lastLaserTimeBySlot.get(player.slot) || 0;
          if (performance.now() - lastLaser > 45) {
            this.firePlayerLaser(
              player.slot,
              player.crosshair.x,
              player.crosshair.y,
              player.color
            );
          }
        }
        this.lastShotsByPlayerId.set(player.id, player.stats.shotsFired);
      } else {
        unit.root.visible = false;
      }
    }
  }

  private startLoop() {
    let lastTime = performance.now();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;

    const afterDraw = (cb: () => void) => {
      if (!gl || typeof gl.fenceSync !== 'function') {
        this.frameId = window.setTimeout(cb, 50);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.isDestroyed) return;
        const status = gl.clientWaitSync(sync!, 0, 0);
        if (status === gl.CONDITION_SATISFIED || status === gl.ALREADY_SIGNALED) {
          gl.deleteSync(sync);
          cb();
        } else {
          this.frameId = window.setTimeout(poll, 16);
        }
      };
      this.frameId = window.setTimeout(poll, 16);
    };

    const tick = () => {
      if (this.isDestroyed) return;

      const now = performance.now();
      const rawDt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (this.hitStopRemainingMs > 0) {
        this.hitStopRemainingMs = Math.max(0, this.hitStopRemainingMs - rawDt * 1000);
      }

      const dt =
        this.hitStopRemainingMs > 0
          ? 0.0
          : this.slowMoActive
          ? rawDt * 0.35
          : rawDt;

      this.fpsFrameCount++;
      if (now - this.fpsLastCheck >= 1000) {
        this.measuredFps = Math.round(
          (this.fpsFrameCount * 1000) / (now - this.fpsLastCheck)
        );
        this.fpsFrameCount = 0;
        this.fpsLastCheck = now;

        // Auto-adjust 4K pixel ratio if FPS dips below 40 on integrated graphics
        if (!this.isSoftwareGl && this.qualityMode === 'high') {
          if (this.measuredFps < 40) {
            this.lowFpsCounter++;
            if (this.lowFpsCounter >= 3) {
              this.qualityMode = 'low';
              this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
            }
          } else {
            this.lowFpsCounter = 0;
          }
        }
      }

      // 1. Scroll the City Segments toward the camera
      const scrollSpeed =
        this.currentPhase === 'PLAYING' || this.currentPhase === 'BONUS_ROUND'
          ? 6.2
          : this.currentPhase === 'COUNTDOWN' || this.currentPhase === 'WAVE_CLEARED'
          ? 4.5
          : 3.2;

      for (const seg of this.citySegments) {
        seg.position.z += scrollSpeed * dt;
        if (seg.position.z >= 15 + this.citySegmentLength) {
          seg.position.z -= this.citySegmentLength * 2;
        }
      }

      // 2. Animate Foreground Bottom-Edge Turrets (Smooth Position, Smooth Aim Slerp, Recoil & Muzzle Flash)
      this.barricadeGroup.position.y = Math.sin(now * 0.008) * 0.035;
      for (let i = 0; i < this.turretUnits.length; i++) {
        const unit = this.turretUnits[i];
        if (!unit.root.visible) continue;

        unit.root.position.lerp(unit.targetWorldPos, Math.min(1, rawDt * 14));
        unit.swivelHead.quaternion.slerp(unit.targetQuat, Math.min(1, rawDt * 18));

        if (unit.recoil > 0.001) {
          unit.barrelGroup.position.z = -unit.recoil;
          unit.recoil = THREE.MathUtils.damp(unit.recoil, 0, 18, rawDt);
        } else {
          unit.barrelGroup.position.z = 0;
        }

        if (unit.flashTimer > 0) {
          unit.flashTimer -= rawDt;
          if (unit.flashTimer <= 0) {
            unit.muzzleFlashGroup.visible = false;
          } else {
            const flashRatio = unit.flashTimer / 0.075;
            unit.flashMat.opacity = flashRatio;
            unit.muzzleFlashGroup.scale.setScalar(0.65 + flashRatio * 0.55);
          }
        }
      }

      // 3. Animate Police Cruiser Emergency Lights & Stage Lights (Subtle, non-glowing)
      const strobe = Math.floor(now / 180) % 2 === 0;
      if (this.policeLightRed && this.policeLightBlue) {
        this.policeLightRed.intensity = strobe ? 0.85 : 0.1;
        this.policeLightBlue.intensity = strobe ? 0.1 : 0.85;
      }

      for (const bRed of this.emergencyBeaconsRed) {
        bRed.scale.setScalar(strobe ? 1.15 : 0.9);
      }
      for (const bBlue of this.emergencyBeaconsBlue) {
        bBlue.scale.setScalar(strobe ? 0.9 : 1.15);
      }

      // Phase 5: Animate Stage 2 Bio-Lab Reactor Core, Containment Tube Bubbles & Rising Steam Clouds
      if (this.biolabReactorGroup.visible) {
        this.biolabReactorGroup.rotation.z = now * 0.0005;
        this.biolabReactorGroup.children.forEach((child, idx) => {
          if (idx === 1) child.rotation.y = now * 0.0012;
          if (idx === 2) child.rotation.x = -now * 0.0009;
        });

        for (let i = 0; i < this.biolabBubbles.length; i++) {
          const b = this.biolabBubbles[i];
          b.position.y += dt * (1.1 + (i % 3) * 0.35);
          if (b.position.y > 5.4) {
            b.position.y = 0.9;
          }
        }

        for (const steam of this.biolabSteamClouds) {
          const cycle = ((now * 0.0007 + steam.phase) % 1.0);
          steam.mesh.position.y = steam.baseY + cycle * 3.2;
          const s = 1.0 + cycle * 1.4;
          steam.mesh.scale.set(s * 1.3, s * 0.85, s);
          steam.mat.opacity = Math.sin(cycle * Math.PI) * 0.18;
        }
      }

      if (this.citadelCoreGroup.visible) {
        this.citadelCoreGroup.rotation.y = now * 0.0008;
        this.citadelCoreGroup.rotation.x = now * 0.0004;
      }

      // 4. Camera Choreography
      if (this.currentPhase === 'LOBBY') {
        const swayX = Math.sin(now * 0.0006) * 0.85;
        const swayY = Math.cos(now * 0.0004) * 0.2;
        this.camera.position.x = THREE.MathUtils.damp(
          this.camera.position.x,
          this.baseCamPos.x + swayX,
          4,
          rawDt
        );
        this.camera.position.y = THREE.MathUtils.damp(
          this.camera.position.y,
          this.baseCamPos.y + swayY,
          4,
          rawDt
        );
        this.camera.lookAt(this.baseCamLook);
      } else if (this.shakeIntensity > 0.001) {
        this.camera.position.x =
          this.baseCamPos.x + (Math.random() - 0.5) * this.shakeIntensity;
        this.camera.position.y =
          this.baseCamPos.y + (Math.random() - 0.5) * this.shakeIntensity;
        this.shakeIntensity = THREE.MathUtils.damp(this.shakeIntensity, 0, 8, rawDt);
        this.camera.lookAt(this.baseCamLook);
      } else {
        this.camera.position.copy(this.baseCamPos);
        this.camera.lookAt(this.baseCamLook);
      }

      // Render directly with hardware MSAA and native 4K resolution (no bloom/glow pass)
      this.renderer.render(this.scene, this.camera);
      if (this.isSoftwareGl) {
        afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  private onWindowResize() {
    if (!this.container || this.isDestroyed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const targetDpr =
      this.isSoftwareGl
        ? 1
        : this.qualityMode === 'low'
        ? Math.min(window.devicePixelRatio || 1, 1.5)
        : Math.min(window.devicePixelRatio || 1, 2.5);
    this.renderer.setPixelRatio(targetDpr);
    this.renderer.setSize(width, height);
  }

  public dispose() {
    this.isDestroyed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.onWindowResize);

    this.zombieManager.dispose();
    this.particleSystem.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
