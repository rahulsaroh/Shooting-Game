import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ZombieManager } from './ZombieManager.ts';
import { ParticleSystem } from './ParticleSystem.ts';
import { GamePhase, GameWorldState, PostProcessingQuality } from '../../shared/types.ts';
import { STAGES } from '../../shared/config.ts';

/**
 * Phase D: Custom Post-Processing Shader (Vignette + Subtle Film Grain + Kids/Adult Color Grading)
 */
const ArcadePostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0.0 },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.032 },
    uKidsMode: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uKidsMode;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;

      // Color grading: Kids Mode = bright warm saturation boost; Adult Mode = high-contrast cyber cinema
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      if (uKidsMode > 0.5) {
        col = mix(vec3(luma), col, 1.28);
        col *= vec3(1.04, 1.05, 1.02);
      } else {
        col = mix(vec3(luma), col, 1.12);
        col = pow(max(col, vec3(0.0)), vec3(1.03));
        col *= vec3(0.98, 0.99, 1.04);
      }

      // Subtle animated film grain
      float noise = (rand(vUv + fract(uTime * 0.17)) - 0.5) * uGrain;
      col += noise;

      // Vignette
      vec2 centered = vUv - 0.5;
      float dist = length(centered);
      float vig = smoothstep(0.78, 0.32, dist * (0.75 + uVignette));
      col *= mix(1.0 - uVignette * 0.65, 1.0, vig);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), texel.a);
    }
  `,
};

export class ThreeScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private arcadeShaderPass: ShaderPass | null = null;
  private qualityMode: PostProcessingQuality = 'high';
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

  // Interactive 3D Player Turret Cannons that track player aim & recoil on fire
  private turretHeads: THREE.Group[] = [];
  private turretRecoils: number[] = [0, 0, 0, 0];

  // Shared Procedural Textures
  private roadTexture!: THREE.CanvasTexture;
  private buildingTextures: THREE.CanvasTexture[] = [];
  private billboardTextures: THREE.CanvasTexture[] = [];

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

  // Player Patrol Vehicle Turret Barricade
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

    // 3. Renderer with ACES Tone Mapping & Crisp Exposure
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    const initialWidth = container.clientWidth || window.innerWidth;
    const initialHeight = container.clientHeight || window.innerHeight;
    this.renderer.setSize(initialWidth, initialHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    // 3b. Post-Processing Pipeline (Bloom + Vignette + Film Grain + Color Grading)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(initialWidth, initialHeight),
        0.22,
        0.25,
        0.88
      );
      this.composer.addPass(this.bloomPass);

      this.arcadeShaderPass = new ShaderPass(ArcadePostShader);
      this.composer.addPass(this.arcadeShaderPass);

      const outputPass = new OutputPass();
      this.composer.addPass(outputPass);
    } else {
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
    // 1. Detailed Multi-Lane Asphalt Road Texture
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 512;
    roadCanvas.height = 512;
    const rCtx = roadCanvas.getContext('2d')!;
    rCtx.fillStyle = '#141829';
    rCtx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 1800; i++) {
      rCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
      rCtx.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
    }

    rCtx.fillStyle = 'rgba(0, 245, 212, 0.45)';
    rCtx.fillRect(24, 0, 6, 512);
    rCtx.fillStyle = 'rgba(247, 37, 133, 0.45)';
    rCtx.fillRect(482, 0, 6, 512);

    rCtx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    for (let y = 20; y < 512; y += 64) {
      rCtx.fillRect(140, y, 5, 34);
      rCtx.fillRect(367, y, 5, 34);
    }

    rCtx.fillStyle = '#ffbe0b';
    for (let y = 12; y < 512; y += 64) {
      rCtx.fillRect(250, y, 4, 38);
      rCtx.fillRect(258, y, 4, 38);
    }

    this.roadTexture = new THREE.CanvasTexture(roadCanvas);
    this.roadTexture.wrapS = THREE.RepeatWrapping;
    this.roadTexture.wrapT = THREE.RepeatWrapping;
    this.roadTexture.repeat.set(1, 5);
    this.roadTexture.colorSpace = THREE.SRGBColorSpace;

    // 2. Skyscraper Window Grid Facade Textures
    const facadePalettes = [
      { wall: '#171936', trim: '#252954', litA: '#fde68a', litB: '#38bdf8' },
      { wall: '#24123b', trim: '#381c5c', litA: '#fbcfe8', litB: '#fde047' },
      { wall: '#112240', trim: '#1d3557', litA: '#a7f3d0', litB: '#fde68a' },
    ];

    facadePalettes.forEach((pal) => {
      const bCanvas = document.createElement('canvas');
      bCanvas.width = 256;
      bCanvas.height = 512;
      const bCtx = bCanvas.getContext('2d')!;

      bCtx.fillStyle = pal.wall;
      bCtx.fillRect(0, 0, 256, 512);

      bCtx.fillStyle = pal.trim;
      for (let y = 0; y < 512; y += 48) {
        bCtx.fillRect(0, y, 256, 6);
      }

      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 4; col++) {
          const wx = 18 + col * 58;
          const wy = 14 + row * 48;
          const rand = Math.sin(row * 7.3 + col * 3.1);
          if (rand > 0.15) {
            bCtx.fillStyle = rand > 0.65 ? pal.litB : pal.litA;
          } else {
            bCtx.fillStyle = '#090d16';
          }
          bCtx.fillRect(wx, wy, 40, 26);

          bCtx.strokeStyle = pal.trim;
          bCtx.lineWidth = 2;
          bCtx.strokeRect(wx, wy, 40, 26);
        }
      }

      const tex = new THREE.CanvasTexture(bCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.buildingTextures.push(tex);
    });

    // 3. Illuminated Arcade Storefront Billboard Textures
    const signs = [
      { text: 'TIMEZONE ARENA', bg: '#240046', border: '#00f5d4', color: '#ffffff' },
      { text: 'CYBER BOWL 24H', bg: '#3b0764', border: '#ffbe0b', color: '#ffbe0b' },
      { text: 'NEO TOKYO PLAZA', bg: '#0f172a', border: '#f72585', color: '#00f5d4' },
      { text: 'LASER ZONE VIP', bg: '#1e1b4b', border: '#80ed99', color: '#ffffff' },
    ];

    signs.forEach((s) => {
      const sCanvas = document.createElement('canvas');
      sCanvas.width = 512;
      sCanvas.height = 128;
      const sCtx = sCanvas.getContext('2d')!;

      sCtx.fillStyle = s.bg;
      sCtx.fillRect(0, 0, 512, 128);

      sCtx.strokeStyle = s.border;
      sCtx.lineWidth = 10;
      sCtx.strokeRect(8, 8, 496, 112);

      sCtx.fillStyle = s.color;
      sCtx.font = 'bold 42px "Chakra Petch", sans-serif';
      sCtx.textAlign = 'center';
      sCtx.textBaseline = 'middle';
      sCtx.fillText(s.text, 256, 66);

      const tex = new THREE.CanvasTexture(sCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.billboardTextures.push(tex);
    });
  }

  private setupLighting() {
    this.scene.background = new THREE.Color(0x130b29);
    this.fog = new THREE.FogExp2(0x130b29, 0.019);
    this.scene.fog = this.fog;

    this.hemiLight = new THREE.HemisphereLight(0x7b2cbf, 0x0f172a, 0.85);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff1d0, 1.35);
    this.dirLight.position.set(12, 22, 10);
    if (!this.isSoftwareGl) {
      this.dirLight.castShadow = true;
      this.dirLight.shadow.mapSize.width = 1024;
      this.dirLight.shadow.mapSize.height = 1024;
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

    this.neonPinkLight = new THREE.PointLight(0xf72585, 2.0, 24);
    this.neonPinkLight.position.set(-8.5, 5.5, -12);
    this.scene.add(this.neonPinkLight);

    this.neonCyanLight = new THREE.PointLight(0x00f5d4, 2.0, 24);
    this.neonCyanLight.position.set(8.5, 5.5, -16);
    this.scene.add(this.neonCyanLight);

    const neonGoldLight = new THREE.PointLight(0xffbe0b, 1.8, 24);
    neonGoldLight.position.set(-8.5, 6.0, -26);
    this.scene.add(neonGoldLight);

    this.policeLightRed = new THREE.PointLight(0xff0044, 2.2, 16);
    this.policeLightRed.position.set(-5.8, 2.2, -16.5);
    this.scene.add(this.policeLightRed);

    this.policeLightBlue = new THREE.PointLight(0x0088ff, 0.2, 16);
    this.policeLightBlue.position.set(-5.0, 2.2, -16.5);
    this.scene.add(this.policeLightBlue);
  }

  public applyStageAtmosphere(stageIdx: number, isKids: boolean) {
    const stage = STAGES[stageIdx] || STAGES[0];
    this.currentStageIndex = stageIdx;
    this.isKidsMode = isKids;
    this.zombieManager.setKidsMode(isKids);

    if (this.arcadeShaderPass) {
      this.arcadeShaderPass.uniforms.uKidsMode.value = isKids ? 1.0 : 0.0;
      this.arcadeShaderPass.uniforms.uVignette.value = isKids ? 0.16 : 0.36;
      this.arcadeShaderPass.uniforms.uGrain.value = isKids ? 0.012 : 0.032;
    }

    if (isKids) {
      this.scene.background = new THREE.Color(0x1b4332);
      this.fog.color = new THREE.Color(0x1b4332);
      this.fog.density = 0.013;
      this.hemiLight.color = new THREE.Color(0x4cc9f0);
      this.hemiLight.groundColor = new THREE.Color(0x52b788);
      this.dirLight.color = new THREE.Color(0xfffae0);
      this.dirLight.intensity = 1.5;
      if (this.bloomPass) {
        this.bloomPass.strength = 0.14;
        this.bloomPass.threshold = 0.9;
      }
    } else {
      this.scene.background = new THREE.Color(stage.skyColor);
      this.fog.color = new THREE.Color(stage.fogColor);
      this.fog.density = stage.fogDensity;
      this.hemiLight.color = new THREE.Color(stage.ambientColor);
      this.hemiLight.groundColor = new THREE.Color(0x0f172a);
      this.dirLight.color = new THREE.Color(stage.directionalLightColor);
      this.dirLight.intensity = 1.35;
      this.neonCyanLight.color = new THREE.Color(stage.accentLightColor);
      if (this.bloomPass) {
        this.bloomPass.strength = 0.22;
        this.bloomPass.threshold = 0.88;
      }
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
    const turretIdx = (slot - 1) % 4;
    const turretOffsets = [-4.2, -1.4, 1.4, 4.2, -5.6, 5.6, -2.8, 2.8];
    const startX = turretOffsets[(slot - 1) % turretOffsets.length];
    const startY = 1.35;
    const startZ = -1.3;

    // Trigger barrel recoil kick on the 3D turret cannon
    this.turretRecoils[turretIdx] = 0.22;

    const target = hitPos
      ? new THREE.Vector3(hitPos.x, hitPos.y + 1.9, hitPos.z)
      : this.screenToWorldAtDepth(normX, normY, -24);

    if (this.turretHeads[turretIdx]) {
      this.turretHeads[turretIdx].lookAt(target);
    }

    this.particleSystem.spawnLaserTracer(
      startX,
      startY,
      startZ,
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

    const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 1), foliageMidMat);
    bush.scale.set(1.3, 0.75, 1.1);
    bush.position.set(0.45, 0.45, 0.35);
    treeGroup.add(bush);

    treeGroup.scale.setScalar(scale);
    return treeGroup;
  }

  private createScrollingCitySegment(zOffset: number): THREE.Group {
    const seg = new THREE.Group();
    seg.position.z = zOffset;

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(20, this.citySegmentLength),
      new THREE.MeshStandardMaterial({
        map: this.roadTexture,
        roughness: 0.42,
        metalness: 0.25,
      })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -this.citySegmentLength / 2;
    road.receiveShadow = true;
    seg.add(road);

    const sidewalkGeom = new THREE.BoxGeometry(9, 0.28, this.citySegmentLength);
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x2b2d42,
      roughness: 0.75,
      metalness: 0.15,
    });
    const sidewalkL = new THREE.Mesh(sidewalkGeom, sidewalkMat);
    sidewalkL.position.set(-14.5, 0.14, -this.citySegmentLength / 2);
    sidewalkL.receiveShadow = true;
    seg.add(sidewalkL);

    const sidewalkR = new THREE.Mesh(sidewalkGeom, sidewalkMat);
    sidewalkR.position.set(14.5, 0.14, -this.citySegmentLength / 2);
    sidewalkR.receiveShadow = true;
    seg.add(sidewalkR);

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
      seg.add(bGroup);
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
      seg.add(tree);
    });

    const archGroup = new THREE.Group();
    const archPillarGeom = new THREE.BoxGeometry(1.2, 8.8, 1.2);
    const archPillarMat = new THREE.MeshStandardMaterial({
      color: 0x240046,
      roughness: 0.35,
      metalness: 0.6,
    });
    const leftPillar = new THREE.Mesh(archPillarGeom, archPillarMat);
    leftPillar.position.set(-9.5, 4.4, -34);
    archGroup.add(leftPillar);

    const rightPillar = new THREE.Mesh(archPillarGeom, archPillarMat);
    rightPillar.position.set(9.5, 4.4, -34);
    archGroup.add(rightPillar);

    const archHeader = new THREE.Mesh(
      new THREE.BoxGeometry(20.5, 1.1, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.7 })
    );
    archHeader.position.set(0, 9.0, -34);
    archGroup.add(archHeader);

    const archNeonStrip = new THREE.Mesh(
      new THREE.BoxGeometry(19, 0.28, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x00f5d4 })
    );
    archNeonStrip.position.set(0, 8.35, -34);
    archGroup.add(archNeonStrip);
    seg.add(archGroup);

    const cruiserGroup = new THREE.Group();
    const carBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.75, 4.0),
      new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.3, metalness: 0.75 })
    );
    carBody.position.y = 0.65;
    cruiserGroup.add(carBody);

    const carCabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.62, 2.0),
      new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.25, metalness: 0.5 })
    );
    carCabin.position.set(0, 1.28, -0.2);
    cruiserGroup.add(carCabin);

    const beaconRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.18, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff0044 })
    );
    beaconRed.position.set(-0.38, 1.68, -0.2);
    cruiserGroup.add(beaconRed);
    this.emergencyBeaconsRed.push(beaconRed);

    const beaconBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.18, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x0088ff })
    );
    beaconBlue.position.set(0.38, 1.68, -0.2);
    cruiserGroup.add(beaconBlue);
    this.emergencyBeaconsBlue.push(beaconBlue);

    cruiserGroup.position.set(-7.6, 0, -21);
    cruiserGroup.rotation.y = 0.32;
    seg.add(cruiserGroup);

    const barrelGeom = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0xffbe0b,
      roughness: 0.4,
      metalness: 0.5,
    });
    [
      { x: 8.1, z: -14.0 },
      { x: 7.5, z: -15.2 },
      { x: 8.2, z: -41.0 },
      { x: -8.2, z: -46.0 },
    ].forEach((pos) => {
      const barrel = new THREE.Mesh(barrelGeom, barrelMat);
      barrel.position.set(pos.x, 0.6, pos.z);
      seg.add(barrel);
    });

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
        seg.add(post);

        const bulbColor = (sideIdx + idx) % 2 === 0 ? 0x00f5d4 : 0xf72585;
        const lampHead = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 10, 10),
          new THREE.MeshBasicMaterial({ color: bulbColor })
        );
        lampHead.position.set(xSide, 6.0, zPos);
        seg.add(lampHead);
      });
    });

    return seg;
  }

  private buildWorldEnvironment() {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(5.0, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffbe0b })
    );
    moon.position.set(0, 19, -68);
    this.scene.add(moon);

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

    const turretColors = [0x00f5d4, 0xf72585, 0xfee440, 0x70e000];
    [-4.2, -1.4, 1.4, 4.2].forEach((tx, idx) => {
      const podGroup = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.44, 0.4, 12),
        armorPlateMat
      );
      base.position.y = 0.88;
      podGroup.add(base);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.05, 8, 16),
        new THREE.MeshBasicMaterial({ color: turretColors[idx] })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.06;
      podGroup.add(ring);

      const swivelHead = new THREE.Group();
      swivelHead.position.set(0, 1.18, 0);

      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.22, 0.38),
        armorPlateMat
      );
      swivelHead.add(housing);

      const barrelMat = new THREE.MeshBasicMaterial({ color: turretColors[idx] });
      const barrelL = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.06, 0.72, 8),
        barrelMat
      );
      barrelL.rotation.x = Math.PI / 2;
      barrelL.position.set(-0.11, 0, 0.36);
      swivelHead.add(barrelL);

      const barrelR = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.06, 0.72, 8),
        barrelMat
      );
      barrelR.rotation.x = Math.PI / 2;
      barrelR.position.set(0.11, 0, 0.36);
      swivelHead.add(barrelR);

      podGroup.add(swivelHead);
      podGroup.position.set(tx, 0, -1.4);
      this.turretHeads.push(swivelHead);
      this.barricadeGroup.add(podGroup);
    });

    this.scene.add(this.barricadeGroup);
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

    // Rotate 3D turret barrels to track each connected player's live crosshair!
    for (const player of world.players) {
      if (!player.isConnected) continue;
      const turretIdx = (player.slot - 1) % this.turretHeads.length;
      const head = this.turretHeads[turretIdx];
      if (head) {
        const aimWorld = this.screenToWorldAtDepth(
          player.crosshair.x,
          player.crosshair.y,
          -16
        );
        head.lookAt(aimWorld);
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

        // Phase D: Auto-fallback to low post-processing quality if FPS drops below 38 on real hardware
        if (!this.isSoftwareGl && this.qualityMode === 'high') {
          if (this.measuredFps < 38) {
            this.lowFpsCounter++;
            if (this.lowFpsCounter >= 3) {
              this.qualityMode = 'low';
            }
          } else {
            this.lowFpsCounter = 0;
          }
        }
      }

      if (this.arcadeShaderPass) {
        this.arcadeShaderPass.uniforms.uTime.value = now * 0.001;
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

      // 2. Animate Turret Recoil Kickback & Patrol Hood Suspension Bob
      this.barricadeGroup.position.y = Math.sin(now * 0.008) * 0.035;
      for (let i = 0; i < this.turretHeads.length; i++) {
        if (this.turretRecoils[i] > 0.001) {
          this.turretHeads[i].position.z = this.turretRecoils[i];
          this.turretRecoils[i] = THREE.MathUtils.damp(this.turretRecoils[i], 0, 14, rawDt);
        } else {
          this.turretHeads[i].position.z = 0;
        }
      }

      // 3. Animate Police Cruiser Emergency Lights & Stage Flickering Lights
      const strobe = Math.floor(now / 180) % 2 === 0;
      if (this.policeLightRed && this.policeLightBlue) {
        this.policeLightRed.intensity = strobe ? 2.4 : 0.15;
        this.policeLightBlue.intensity = strobe ? 0.15 : 2.4;
      }
      const stage = STAGES[Math.max(0, this.currentStageIndex)] || STAGES[0];
      if (!this.isKidsMode && this.neonPinkLight) {
        const flicker =
          Math.sin(now * 0.023) * Math.cos(now * 0.067) > 0.72
            ? 2.0 * (1 - stage.flickerIntensity)
            : 2.0;
        this.neonPinkLight.intensity = flicker;
      }

      for (const bRed of this.emergencyBeaconsRed) {
        bRed.scale.setScalar(strobe ? 1.3 : 0.85);
      }
      for (const bBlue of this.emergencyBeaconsBlue) {
        bBlue.scale.setScalar(strobe ? 0.85 : 1.3);
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

      if (this.isSoftwareGl || !this.composer || this.qualityMode === 'low') {
        this.renderer.render(this.scene, this.camera);
        if (this.isSoftwareGl) {
          afterDraw(tick);
        } else {
          this.frameId = requestAnimationFrame(tick);
        }
      } else {
        this.composer.render();
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
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
    this.bloomPass?.resolution.set(width, height);
  }

  public dispose() {
    this.isDestroyed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.onWindowResize);

    this.zombieManager.dispose();
    this.particleSystem.dispose();
    this.composer?.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
