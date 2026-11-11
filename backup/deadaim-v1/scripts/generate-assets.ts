/**
 * Asset Generator for DeadAim
 * Generates spec-compliant glTF 2.0 binary (.glb) animated 3D zombie models
 * in /public/models/<theme>/ and 16-bit PCM (.wav) horror/arcade sound files
 * in /public/audio/<category>/ matching shared/themes.json and shared/audio.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function hexToRgba(hex: string, alpha = 1.0): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b, alpha];
}

function eulerToQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const cx = Math.cos(rx * 0.5);
  const sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5);
  const sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5);
  const sz = Math.sin(rz * 0.5);

  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

interface BoxPart {
  sx: number;
  sy: number;
  sz: number;
  ox?: number;
  oy?: number;
  oz?: number;
}

function createBoxGeometryData(parts: BoxPart[]) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const part of parts) {
    const hx = part.sx * 0.5;
    const hy = part.sy * 0.5;
    const hz = part.sz * 0.5;
    const ox = part.ox || 0;
    const oy = part.oy || 0;
    const oz = part.oz || 0;

    // 6 faces of a box (with slight bevel taper on top for organic silhouette)
    const faces = [
      // +Z front
      {
        n: [0, 0, 1],
        v: [
          [-hx, -hy, hz],
          [hx, -hy, hz],
          [hx, hy, hz],
          [-hx, hy, hz],
        ],
      },
      // -Z back
      {
        n: [0, 0, -1],
        v: [
          [hx, -hy, -hz],
          [-hx, -hy, -hz],
          [-hx, hy, -hz],
          [hx, hy, -hz],
        ],
      },
      // +Y top
      {
        n: [0, 1, 0],
        v: [
          [-hx, hy, hz],
          [hx, hy, hz],
          [hx, hy, -hz],
          [-hx, hy, -hz],
        ],
      },
      // -Y bottom
      {
        n: [0, -1, 0],
        v: [
          [-hx, -hy, -hz],
          [hx, -hy, -hz],
          [hx, -hy, hz],
          [-hx, -hy, hz],
        ],
      },
      // +X right
      {
        n: [1, 0, 0],
        v: [
          [hx, -hy, hz],
          [hx, -hy, -hz],
          [hx, hy, -hz],
          [hx, hy, hz],
        ],
      },
      // -X left
      {
        n: [-1, 0, 0],
        v: [
          [-hx, -hy, -hz],
          [-hx, -hy, hz],
          [-hx, hy, hz],
          [-hx, hy, -hz],
        ],
      },
    ];

    for (const f of faces) {
      for (const vert of f.v) {
        positions.push(vert[0] + ox, vert[1] + oy, vert[2] + oz);
        normals.push(f.n[0], f.n[1], f.n[2]);
      }
      indices.push(
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 3
      );
      vertexOffset += 4;
    }
  }

  const posArray = new Float32Array(positions);
  const normArray = new Float32Array(normals);
  const idxArray = new Uint16Array(indices);

  const minPos = [Infinity, Infinity, Infinity];
  const maxPos = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    minPos[0] = Math.min(minPos[0], positions[i]);
    minPos[1] = Math.min(minPos[1], positions[i + 1]);
    minPos[2] = Math.min(minPos[2], positions[i + 2]);
    maxPos[0] = Math.max(maxPos[0], positions[i]);
    maxPos[1] = Math.max(maxPos[1], positions[i + 1]);
    maxPos[2] = Math.max(maxPos[2], positions[i + 2]);
  }

  return { posArray, normArray, idxArray, minPos, maxPos };
}

function buildZombieGlb(
  themeKey: 'classic' | 'cartoon' | 'robot',
  typeKey: 'normal' | 'fast' | 'tank' | 'boss',
  palette: {
    skin: string;
    clothes: string;
    accent: string;
    pants: string;
    eyes: string;
  }
): Buffer {
  const isBoss = typeKey === 'boss';
  const isTank = typeKey === 'tank';
  const isFast = typeKey === 'fast';

  const torsoY = isBoss ? 2.1 : isTank ? 1.45 : isFast ? 0.98 : 1.15;
  const headOffsetY = isBoss ? 1.25 : isTank ? 0.85 : isFast ? 0.48 : 0.57;
  const armX = isBoss ? 1.12 : isTank ? 0.86 : 0.44;
  const armY = isBoss ? 0.65 : isTank ? 0.42 : 0.28;
  const legX = isBoss ? 0.52 : isTank ? 0.38 : 0.18;
  const legY = isBoss ? -0.8 : isTank ? -0.52 : -0.4;

  // Define geometries for the 6 articulated parts:
  // 0: Torso + Chest Armor
  const torsoGeom = createBoxGeometryData(
    isBoss
      ? [
          { sx: 1.65, sy: 1.55, sz: 0.92, oy: 0 },
          { sx: 1.78, sy: 0.45, sz: 1.0, oy: 0.35 },
          { sx: 0.55, sy: 0.55, sz: 1.04, oy: 0.2 },
        ]
      : isTank
      ? [
          { sx: 1.28, sy: 1.12, sz: 0.8, oy: 0 },
          { sx: 1.42, sy: 0.36, sz: 0.86, oy: 0.32 },
        ]
      : [
          { sx: 0.64, sy: 0.78, sz: 0.4, oy: 0 },
          { sx: 0.72, sy: 0.25, sz: 0.44, oy: 0.2 },
        ]
  );

  // 1: Head + Brow + Horns/Crest
  const headParts: BoxPart[] = isBoss
    ? [
        { sx: 0.86, sy: 0.88, sz: 0.82, oy: 0 },
        { sx: 0.92, sy: 0.18, sz: 0.88, oy: 0.22 },
        { sx: 0.22, sy: 0.55, sz: 0.22, ox: -0.45, oy: 0.55 },
        { sx: 0.22, sy: 0.55, sz: 0.22, ox: 0.45, oy: 0.55 },
      ]
    : isTank
    ? [
        { sx: 0.62, sy: 0.62, sz: 0.62, oy: 0 },
        { sx: 0.68, sy: 0.22, sz: 0.68, oy: -0.18, oz: 0.04 },
      ]
    : [
        { sx: 0.46, sy: 0.48, sz: 0.46, oy: 0 },
        { sx: 0.12, sy: 0.22, sz: 0.48, oy: 0.3 },
      ];
  const headGeom = createBoxGeometryData(headParts);

  // 2: Glowing Eyes Mesh (child of Head)
  const eyeW = isBoss ? 0.22 : isTank ? 0.16 : 0.12;
  const eyeX = isBoss ? 0.22 : isTank ? 0.16 : 0.12;
  const eyeZ = isBoss ? 0.42 : isTank ? 0.32 : 0.24;
  const eyesGeom = createBoxGeometryData([
    { sx: eyeW, sy: 0.1, sz: 0.06, ox: -eyeX, oy: 0.05, oz: eyeZ },
    { sx: eyeW, sy: 0.1, sz: 0.06, ox: eyeX, oy: 0.05, oz: eyeZ },
  ]);

  // 3: Arm + Forearm + Claws
  const armLen = isBoss ? 1.15 : isTank ? 0.86 : 0.68;
  const armThick = isBoss ? 0.42 : isTank ? 0.34 : 0.2;
  const armGeom = createBoxGeometryData([
    { sx: armThick * 1.15, sy: armThick, sz: armThick * 1.15, oy: 0 },
    { sx: armThick, sy: armLen, sz: armThick, oy: -armLen * 0.5, oz: 0.08 },
    { sx: armThick * 0.85, sy: 0.18, sz: armThick * 1.3, oy: -armLen, oz: 0.14 },
  ]);

  // 4: Leg + Boot
  const legLen = isBoss ? 1.05 : isTank ? 0.78 : 0.68;
  const legThick = isBoss ? 0.46 : isTank ? 0.36 : 0.23;
  const legGeom = createBoxGeometryData([
    { sx: legThick, sy: legLen, sz: legThick, oy: -legLen * 0.5 },
    { sx: legThick * 1.1, sy: 0.18, sz: legThick * 1.35, oy: -legLen + 0.05, oz: 0.06 },
  ]);

  const geomList = [torsoGeom, headGeom, eyesGeom, armGeom, legGeom];

  // Binary buffer chunks
  const binChunks: Buffer[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  let byteOffset = 0;

  function appendTypedArray(
    arr: Float32Array | Uint16Array,
    target?: number
  ): number {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    const padded = pad > 0 ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;

    const viewIdx = bufferViews.length;
    const viewDef: any = {
      buffer: 0,
      byteOffset,
      byteLength: buf.length,
    };
    if (target) viewDef.target = target;
    bufferViews.push(viewDef);

    binChunks.push(padded);
    byteOffset += padded.length;
    return viewIdx;
  }

  // Materials:
  // 0: Clothes / Armor
  // 1: Skin
  // 2: Glowing Eyes / Visor
  // 3: Pants / Boots
  const metal = themeKey === 'robot' ? 0.7 : 0.15;
  const rough = themeKey === 'robot' ? 0.32 : 0.55;
  const materials = [
    {
      name: 'ClothesMat',
      pbrMetallicRoughness: {
        baseColorFactor: hexToRgba(palette.clothes),
        metallicFactor: metal,
        roughnessFactor: rough,
      },
    },
    {
      name: 'SkinMat',
      pbrMetallicRoughness: {
        baseColorFactor: hexToRgba(palette.skin),
        metallicFactor: metal * 0.8,
        roughnessFactor: rough,
      },
    },
    {
      name: 'EyesMat',
      pbrMetallicRoughness: {
        baseColorFactor: hexToRgba(palette.eyes),
        metallicFactor: 0.1,
        roughnessFactor: 0.2,
      },
      emissiveFactor: hexToRgba(palette.eyes).slice(0, 3),
    },
    {
      name: 'PantsMat',
      pbrMetallicRoughness: {
        baseColorFactor: hexToRgba(palette.pants),
        metallicFactor: 0.2,
        roughnessFactor: 0.7,
      },
    },
  ];

  const geomMatMap = [0, 1, 2, 1, 3];
  const meshes: any[] = [];

  for (let i = 0; i < geomList.length; i++) {
    const g = geomList[i];
    const posView = appendTypedArray(g.posArray, 34962);
    const normView = appendTypedArray(g.normArray, 34962);
    const idxView = appendTypedArray(g.idxArray, 34963);

    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: g.posArray.length / 3,
      type: 'VEC3',
      min: g.minPos,
      max: g.maxPos,
    });

    const normAcc = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: 5126,
      count: g.normArray.length / 3,
      type: 'VEC3',
    });

    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5123, // UNSIGNED_SHORT
      count: g.idxArray.length,
      type: 'SCALAR',
    });

    meshes.push({
      name: `Mesh_${i}`,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: normAcc },
          indices: idxAcc,
          material: geomMatMap[i],
        },
      ],
    });
  }

  // Nodes hierarchy:
  // 0: Root
  // 1: Torso (mesh 0) -> children [2, 4, 5, 6, 7]
  // 2: Head (mesh 1) -> children [3]
  // 3: Eyes (mesh 2)
  // 4: LeftArm (mesh 3)
  // 5: RightArm (mesh 3)
  // 6: LeftLeg (mesh 4)
  // 7: RightLeg (mesh 4)
  const nodes = [
    { name: 'Root', children: [1], translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
    {
      name: 'Torso',
      mesh: 0,
      children: [2, 4, 5, 6, 7],
      translation: [0, torsoY, 0],
      rotation: [0, 0, 0, 1],
    },
    {
      name: 'Head',
      mesh: 1,
      children: [3],
      translation: [0, headOffsetY, 0],
      rotation: [0, 0, 0, 1],
    },
    { name: 'Eyes', mesh: 2, translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
    {
      name: 'LeftArm',
      mesh: 3,
      translation: [-armX, armY, 0],
      rotation: eulerToQuat(-0.9, 0, 0),
    },
    {
      name: 'RightArm',
      mesh: 3,
      translation: [armX, armY, 0],
      rotation: eulerToQuat(-0.9, 0, 0),
    },
    {
      name: 'LeftLeg',
      mesh: 4,
      translation: [-legX, legY, 0],
      rotation: [0, 0, 0, 1],
    },
    {
      name: 'RightLeg',
      mesh: 4,
      translation: [legX, legY, 0],
      rotation: [0, 0, 0, 1],
    },
  ];

  // Helper to create keyframe animation tracks
  function addQuatTrack(times: number[], quats: [number, number, number, number][]) {
    const tArr = new Float32Array(times);
    const qFlat: number[] = [];
    for (const q of quats) qFlat.push(q[0], q[1], q[2], q[3]);
    const qArr = new Float32Array(qFlat);

    const tView = appendTypedArray(tArr);
    const qView = appendTypedArray(qArr);

    const tAcc = accessors.length;
    accessors.push({
      bufferView: tView,
      componentType: 5126,
      count: times.length,
      type: 'SCALAR',
      min: [times[0]],
      max: [times[times.length - 1]],
    });

    const qAcc = accessors.length;
    accessors.push({
      bufferView: qView,
      componentType: 5126,
      count: quats.length,
      type: 'VEC4',
    });

    return { input: tAcc, output: qAcc };
  }

  function addVec3Track(times: number[], vecs: [number, number, number][]) {
    const tArr = new Float32Array(times);
    const vFlat: number[] = [];
    for (const v of vecs) vFlat.push(v[0], v[1], v[2]);
    const vArr = new Float32Array(vFlat);

    const tView = appendTypedArray(tArr);
    const vView = appendTypedArray(vArr);

    const tAcc = accessors.length;
    accessors.push({
      bufferView: tView,
      componentType: 5126,
      count: times.length,
      type: 'SCALAR',
      min: [times[0]],
      max: [times[times.length - 1]],
    });

    const vAcc = accessors.length;
    accessors.push({
      bufferView: vView,
      componentType: 5126,
      count: vecs.length,
      type: 'VEC3',
    });

    return { input: tAcc, output: vAcc };
  }

  const animations: any[] = [];

  // 1. Walk Animation Clip ("Walk")
  {
    const times = [0, 0.25, 0.5, 0.75, 1.0];
    const swing = isFast ? 1.05 : 0.65;
    const armBase = isFast ? -0.6 : -1.05;
    const lLeg = addQuatTrack(times, [
      eulerToQuat(0, 0, 0),
      eulerToQuat(swing, 0, 0),
      eulerToQuat(0, 0, 0),
      eulerToQuat(-swing, 0, 0),
      eulerToQuat(0, 0, 0),
    ]);
    const rLeg = addQuatTrack(times, [
      eulerToQuat(0, 0, 0),
      eulerToQuat(-swing, 0, 0),
      eulerToQuat(0, 0, 0),
      eulerToQuat(swing, 0, 0),
      eulerToQuat(0, 0, 0),
    ]);
    const lArm = addQuatTrack(times, [
      eulerToQuat(armBase, 0, 0),
      eulerToQuat(armBase - 0.4, 0, -0.1),
      eulerToQuat(armBase, 0, 0),
      eulerToQuat(armBase + 0.4, 0, 0.05),
      eulerToQuat(armBase, 0, 0),
    ]);
    const rArm = addQuatTrack(times, [
      eulerToQuat(armBase, 0, 0),
      eulerToQuat(armBase + 0.4, 0, -0.05),
      eulerToQuat(armBase, 0, 0),
      eulerToQuat(armBase - 0.4, 0, 0.1),
      eulerToQuat(armBase, 0, 0),
    ]);
    const torsoRot = addQuatTrack(times, [
      eulerToQuat(0.12, 0, -0.08),
      eulerToQuat(0.18, 0.08, 0),
      eulerToQuat(0.12, 0, 0.08),
      eulerToQuat(0.18, -0.08, 0),
      eulerToQuat(0.12, 0, -0.08),
    ]);
    const headRot = addQuatTrack(times, [
      eulerToQuat(0, -0.12, 0.08),
      eulerToQuat(-0.08, 0, -0.06),
      eulerToQuat(0, 0.12, -0.08),
      eulerToQuat(0.08, 0, 0.06),
      eulerToQuat(0, -0.12, 0.08),
    ]);

    animations.push({
      name: 'Walk',
      samplers: [
        { ...lLeg, interpolation: 'LINEAR' },
        { ...rLeg, interpolation: 'LINEAR' },
        { ...lArm, interpolation: 'LINEAR' },
        { ...rArm, interpolation: 'LINEAR' },
        { ...torsoRot, interpolation: 'LINEAR' },
        { ...headRot, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 6, path: 'rotation' } },
        { sampler: 1, target: { node: 7, path: 'rotation' } },
        { sampler: 2, target: { node: 4, path: 'rotation' } },
        { sampler: 3, target: { node: 5, path: 'rotation' } },
        { sampler: 4, target: { node: 1, path: 'rotation' } },
        { sampler: 5, target: { node: 2, path: 'rotation' } },
      ],
    });
  }

  // 2. Attack Animation Clip ("Attack")
  {
    const times = [0, 0.18, 0.38, 0.58, 0.75];
    const lArm = addQuatTrack(times, [
      eulerToQuat(-1.4, 0, -0.2),
      eulerToQuat(-2.35, -0.25, -0.45),
      eulerToQuat(-0.55, 0.35, 0.25),
      eulerToQuat(-1.95, -0.15, -0.3),
      eulerToQuat(-1.4, 0, -0.2),
    ]);
    const rArm = addQuatTrack(times, [
      eulerToQuat(-1.4, 0, 0.2),
      eulerToQuat(-0.6, -0.35, -0.25),
      eulerToQuat(-2.35, 0.25, 0.45),
      eulerToQuat(-0.55, -0.3, -0.2),
      eulerToQuat(-1.4, 0, 0.2),
    ]);
    const torsoRot = addQuatTrack(times, [
      eulerToQuat(0.15, 0, 0),
      eulerToQuat(0.38, 0.18, -0.12),
      eulerToQuat(0.42, -0.18, 0.12),
      eulerToQuat(0.35, 0.1, -0.08),
      eulerToQuat(0.15, 0, 0),
    ]);
    const headRot = addQuatTrack(times, [
      eulerToQuat(0.1, 0, 0),
      eulerToQuat(0.35, -0.22, 0.1),
      eulerToQuat(0.35, 0.22, -0.1),
      eulerToQuat(0.25, 0, 0),
      eulerToQuat(0.1, 0, 0),
    ]);

    animations.push({
      name: 'Attack',
      samplers: [
        { ...lArm, interpolation: 'LINEAR' },
        { ...rArm, interpolation: 'LINEAR' },
        { ...torsoRot, interpolation: 'LINEAR' },
        { ...headRot, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 4, path: 'rotation' } },
        { sampler: 1, target: { node: 5, path: 'rotation' } },
        { sampler: 2, target: { node: 1, path: 'rotation' } },
        { sampler: 3, target: { node: 2, path: 'rotation' } },
      ],
    });
  }

  // 3. Death Animation Clip ("Death")
  {
    const times = [0, 0.25, 0.55, 0.7];
    const rootRot = addQuatTrack(times, [
      eulerToQuat(0, 0, 0),
      eulerToQuat(-0.45, 0.15, 0.1),
      eulerToQuat(-1.35, 0.25, 0.2),
      eulerToQuat(-1.55, 0.3, 0.22),
    ]);
    const rootPos = addVec3Track(times, [
      [0, 0, 0],
      [0, 0.15, -0.25],
      [0, -0.45, -0.65],
      [0, -0.65, -0.8],
    ]);
    const lArm = addQuatTrack(times, [
      eulerToQuat(-1.0, 0, 0),
      eulerToQuat(-2.2, 0, -0.6),
      eulerToQuat(-2.7, 0, -0.8),
      eulerToQuat(-2.8, 0, -0.85),
    ]);
    const rArm = addQuatTrack(times, [
      eulerToQuat(-1.0, 0, 0),
      eulerToQuat(-2.1, 0, 0.6),
      eulerToQuat(-2.6, 0, 0.8),
      eulerToQuat(-2.75, 0, 0.85),
    ]);

    animations.push({
      name: 'Death',
      samplers: [
        { ...rootRot, interpolation: 'LINEAR' },
        { ...rootPos, interpolation: 'LINEAR' },
        { ...lArm, interpolation: 'LINEAR' },
        { ...rArm, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 0, path: 'rotation' } },
        { sampler: 1, target: { node: 0, path: 'translation' } },
        { sampler: 2, target: { node: 4, path: 'rotation' } },
        { sampler: 3, target: { node: 5, path: 'rotation' } },
      ],
    });
  }

  // 4. Hit Reaction Clip ("Hit")
  {
    const times = [0, 0.08, 0.22];
    const torsoRot = addQuatTrack(times, [
      eulerToQuat(0.12, 0, 0),
      eulerToQuat(-0.42, 0.15, -0.15),
      eulerToQuat(0.12, 0, 0),
    ]);
    const headRot = addQuatTrack(times, [
      eulerToQuat(0, 0, 0),
      eulerToQuat(-0.5, -0.25, 0.18),
      eulerToQuat(0, 0, 0),
    ]);

    animations.push({
      name: 'Hit',
      samplers: [
        { ...torsoRot, interpolation: 'LINEAR' },
        { ...headRot, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 1, path: 'rotation' } },
        { sampler: 1, target: { node: 2, path: 'rotation' } },
      ],
    });
  }

  // 5. Idle Clip ("Idle")
  {
    const times = [0, 0.6, 1.2];
    const torsoRot = addQuatTrack(times, [
      eulerToQuat(0.05, 0, -0.04),
      eulerToQuat(0.12, 0, 0.04),
      eulerToQuat(0.05, 0, -0.04),
    ]);
    const headRot = addQuatTrack(times, [
      eulerToQuat(0, -0.1, 0),
      eulerToQuat(0.08, 0.1, 0),
      eulerToQuat(0, -0.1, 0),
    ]);

    animations.push({
      name: 'Idle',
      samplers: [
        { ...torsoRot, interpolation: 'LINEAR' },
        { ...headRot, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 1, path: 'rotation' } },
        { sampler: 1, target: { node: 2, path: 'rotation' } },
      ],
    });
  }

  const binBuffer = Buffer.concat(binChunks);
  const gltfJson = {
    asset: { version: '2.0', generator: 'DeadAim Asset Builder' },
    scene: 0,
    scenes: [{ name: `Zombie_${themeKey}_${typeKey}`, nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.length }],
    animations,
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded =
    jsonPad > 0 ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]) : jsonBuf;

  const totalLength = 12 + 8 + jsonPadded.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuffer.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binBuffer]);
}

// Write 16-bit mono PCM WAV file from float samples [-1, 1]
function writeWavFile(filePath: string, samples: Float32Array, sampleRate = 22050) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  buf.writeUInt16LE(2, 32); // Block align
  buf.writeUInt16LE(16, 34); // Bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intVal = clamped < 0 ? clamped * 32768 : clamped * 32767;
    buf.writeInt16LE(Math.round(intVal), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buf);
}

// Generate horror/arcade waveform samples
function synthSamples(
  durationSec: number,
  fn: (t: number, i: number, sr: number) => number,
  sr = 22050
): Float32Array {
  const len = Math.floor(durationSec * sr);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] = fn(t, i, sr);
  }
  return out;
}

function generateAllAssets() {
  console.log('Generating GLB 3D Zombie Models...');
  const themes: Record<
    'classic' | 'cartoon' | 'robot',
    { skin: string; clothes: string; accent: string; pants: string; eyes: string }
  > = {
    classic: {
      skin: '#52b788',
      clothes: '#e63946',
      accent: '#ffb703',
      pants: '#1d3557',
      eyes: '#ffea00',
    },
    cartoon: {
      skin: '#80ed99',
      clothes: '#7209b7',
      accent: '#f72585',
      pants: '#3a0ca3',
      eyes: '#ffffff',
    },
    robot: {
      skin: '#adb5bd',
      clothes: '#00b4d8',
      accent: '#ff9e00',
      pants: '#2b2d42',
      eyes: '#ff0055',
    },
  };

  const types: ('normal' | 'fast' | 'tank' | 'boss')[] = ['normal', 'fast', 'tank', 'boss'];

  for (const themeKey of Object.keys(themes) as ('classic' | 'cartoon' | 'robot')[]) {
    for (const typeKey of types) {
      const outPath = path.join(PUBLIC_DIR, 'models', themeKey, `zombie_${typeKey}.glb`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const glbBuf = buildZombieGlb(themeKey, typeKey, themes[themeKey]);
      fs.writeFileSync(outPath, glbBuf);
    }
  }

  console.log('Generating WAV Audio Soundscape Files...');

  // 1. Weapons
  [1, 2, 3].forEach((v) => {
    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/shot_0${v}.wav`),
      synthSamples(0.22, (t) => {
        const env = Math.exp(-t * (18 + v * 2));
        const noise = (Math.random() * 2 - 1) * 0.65;
        const punch = Math.sin(2 * Math.PI * (160 - t * 480) * t) * 0.8;
        return (noise + punch) * env;
      })
    );

    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/laser_pew_0${v}.wav`),
      synthSamples(0.16, (t) => {
        const env = Math.exp(-t * 16);
        const freq = 920 * Math.exp(-t * 12) + v * 45;
        return Math.sin(2 * Math.PI * freq * t) * env * 0.75;
      })
    );

    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/headshot_ding_0${v}.wav`),
      synthSamples(0.28, (t) => {
        const env = Math.exp(-t * 11);
        const chime =
          Math.sin(2 * Math.PI * (1680 + v * 60) * t) * 0.6 +
          Math.sin(2 * Math.PI * (2520 + v * 90) * t) * 0.4;
        const crunch = t < 0.05 ? (Math.random() * 2 - 1) * 0.4 : 0;
        return (chime + crunch) * env;
      })
    );

    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/body_hit_0${v}.wav`),
      synthSamples(0.14, (t) => {
        const env = Math.exp(-t * 22);
        const thud = Math.sin(2 * Math.PI * (140 - t * 600) * t) * 0.75;
        const splat = (Math.random() * 2 - 1) * 0.35;
        return (thud + splat) * env;
      })
    );

    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/boing_hit_0${v}.wav`),
      synthSamples(0.22, (t) => {
        const env = Math.exp(-t * 10);
        const freq = 260 + Math.sin(t * 55) * 140 + v * 25;
        return Math.sin(2 * Math.PI * freq * t) * env * 0.7;
      })
    );
  });

  // Alias headshot_crunch_02.wav
  fs.copyFileSync(
    path.join(PUBLIC_DIR, 'audio/weapons/headshot_ding_02.wav'),
    path.join(PUBLIC_DIR, 'audio/weapons/headshot_crunch_02.wav')
  );

  [1, 2].forEach((v) => {
    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/empty_click_0${v}.wav`),
      synthSamples(0.06, (t) => {
        const env = Math.exp(-t * 65);
        return Math.sin(2 * Math.PI * (950 + v * 120) * t) * env * 0.7;
      })
    );

    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/reload_0${v}.wav`),
      synthSamples(0.45, (t) => {
        const click1 = t < 0.08 ? Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 35) : 0;
        const click2 =
          t >= 0.18 && t < 0.28
            ? Math.sin(2 * Math.PI * 680 * (t - 0.18)) * Math.exp(-(t - 0.18) * 35)
            : 0;
        const click3 =
          t >= 0.32
            ? Math.sin(2 * Math.PI * 920 * (t - 0.32)) * Math.exp(-(t - 0.32) * 30)
            : 0;
        return (click1 + click2 + click3) * 0.8;
      })
    );

    writeWavFile(
      path.join(PUBLIC_DIR, `audio/weapons/barricade_impact_0${v}.wav`),
      synthSamples(0.32, (t) => {
        const env = Math.exp(-t * 10);
        const crunch = (Math.random() * 2 - 1) * 0.55;
        const bass = Math.sin(2 * Math.PI * (78 - t * 140) * t) * 0.75;
        return (crunch + bass) * env;
      })
    );
  });

  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/weapons/powerup_chime_01.wav'),
    synthSamples(0.42, (t) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const idx = Math.min(3, Math.floor(t / 0.1));
      const localT = t - idx * 0.1;
      return Math.sin(2 * Math.PI * notes[idx] * t) * Math.exp(-localT * 14) * 0.75;
    })
  );

  // 2. Zombie Voices (normal, fast, tank, boss + kids)
  const basePitch: Record<string, number> = {
    normal: 105,
    fast: 195,
    tank: 68,
    boss: 48,
  };

  for (const zType of ['normal', 'fast', 'tank', 'boss']) {
    const f0 = basePitch[zType];
    const states = ['idle', 'aggro', 'attack', 'hit', 'death'];
    for (const st of states) {
      const count = zType === 'normal' && (st === 'idle' || st === 'attack' || st === 'death') ? 4 : 3;
      for (let v = 1; v <= count; v++) {
        const dur = st === 'hit' ? 0.25 : st === 'death' ? 0.65 : 0.48;
        writeWavFile(
          path.join(PUBLIC_DIR, `audio/zombies/${zType}_${st}_0${v}.wav`),
          synthSamples(dur, (t) => {
            const env = Math.sin((Math.min(t, dur) / dur) * Math.PI);
            const vibrato = Math.sin(2 * Math.PI * (6 + v) * t) * (st === 'attack' ? 18 : 8);
            const freq =
              st === 'death'
                ? f0 * (1 - (t / dur) * 0.45)
                : st === 'attack'
                ? f0 * 1.25 + vibrato
                : f0 + vibrato + v * 4;
            // Growl harmonics + rasp
            const saw =
              Math.sin(2 * Math.PI * freq * t) * 0.5 +
              Math.sin(2 * Math.PI * freq * 2 * t) * 0.3 +
              Math.sin(2 * Math.PI * freq * 3 * t) * 0.15;
            const rasp = (Math.random() * 2 - 1) * 0.22;
            return (saw + rasp) * env * 0.85;
          })
        );
      }
    }
  }

  // Boss Entrance Roar
  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/zombies/boss_entrance_roar_01.wav'),
    synthSamples(1.35, (t) => {
      const env = Math.sin((t / 1.35) * Math.PI);
      const rumble = Math.sin(2 * Math.PI * (46 + Math.sin(t * 14) * 12) * t) * 0.65;
      const sub = Math.sin(2 * Math.PI * 28 * t) * 0.45;
      const roarNoise = (Math.random() * 2 - 1) * 0.35;
      return (rumble + sub + roarNoise) * env;
    })
  );

  // Kids Silly Voices
  const kidsMap: Record<string, string> = {
    idle: 'kids_goofy_groan',
    aggro: 'kids_squeak',
    attack: 'kids_chomp',
    hit: 'kids_boing',
    death: 'kids_pop',
  };
  for (const [st, prefix] of Object.entries(kidsMap)) {
    for (let v = 1; v <= 3; v++) {
      writeWavFile(
        path.join(PUBLIC_DIR, `audio/zombies/${prefix}_0${v}.wav`),
        synthSamples(0.32, (t) => {
          const env = Math.exp(-t * 8);
          const f =
            st === 'aggro'
              ? 580 + Math.sin(t * 45) * 160
              : st === 'hit'
              ? 320 + t * 480
              : 280 + Math.sin(t * 25) * 90 + v * 20;
          return Math.sin(2 * Math.PI * f * t) * env * 0.75;
        })
      );
    }
  }

  // 3. Ambience & Dynamic Music Layers
  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/ambience/horror_wind_moans_loop.wav'),
    synthSamples(2.4, (t) => {
      const env = 0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 2.4);
      const drone =
        Math.sin(2 * Math.PI * 55 * t) * 0.35 + Math.sin(2 * Math.PI * 82.4 * t) * 0.25;
      const wind = (Math.random() * 2 - 1) * 0.12;
      return (drone + wind) * env;
    })
  );

  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/ambience/kids_arcade_breeze_loop.wav'),
    synthSamples(2.0, (t) => {
      const shimmer =
        Math.sin(2 * Math.PI * 261.63 * t) * 0.25 + Math.sin(2 * Math.PI * 329.63 * t) * 0.2;
      return shimmer * (0.6 + 0.3 * Math.sin(2 * Math.PI * t));
    })
  );

  // Music Layers (calm, tense, intense, heartbeat, kids_loop)
  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/music/layer_calm_loop.wav'),
    synthSamples(2.0, (t) => {
      const notes = [110, 110, 103.83, 98];
      const step = Math.floor((t / 2.0) * 4) % 4;
      const localT = t % 0.5;
      return Math.sin(2 * Math.PI * notes[step] * t) * Math.exp(-localT * 4.5) * 0.55;
    })
  );

  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/music/layer_tense_loop.wav'),
    synthSamples(2.0, (t) => {
      const notes = [110, 123.47, 116.54, 103.83, 110, 130.81, 116.54, 98];
      const step = Math.floor((t / 2.0) * 8) % 8;
      const localT = t % 0.25;
      const osc =
        Math.sin(2 * Math.PI * notes[step] * t) * 0.5 +
        Math.sin(2 * Math.PI * notes[step] * 2 * t) * 0.3;
      return osc * Math.exp(-localT * 7) * 0.65;
    })
  );

  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/music/layer_intense_loop.wav'),
    synthSamples(2.0, (t) => {
      const notes = [110, 164.81, 116.54, 174.61, 110, 155.56, 103.83, 146.83];
      const step = Math.floor((t / 2.0) * 8) % 8;
      const localT = t % 0.25;
      const pulse =
        Math.sin(2 * Math.PI * notes[step] * t) * 0.55 +
        Math.sin(2 * Math.PI * notes[step] * 3 * t) * 0.3;
      const kick = localT < 0.08 ? Math.sin(2 * Math.PI * (120 - localT * 900) * localT) * 0.5 : 0;
      return (pulse * Math.exp(-localT * 8) + kick) * 0.75;
    })
  );

  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/music/heartbeat_low_hp_loop.wav'),
    synthSamples(1.0, (t) => {
      const beat1 = t < 0.14 ? Math.sin(2 * Math.PI * 52 * t) * Math.exp(-t * 18) : 0;
      const beat2 =
        t >= 0.22 && t < 0.38
          ? Math.sin(2 * Math.PI * 46 * (t - 0.22)) * Math.exp(-(t - 0.22) * 20)
          : 0;
      return (beat1 + beat2) * 0.9;
    })
  );

  writeWavFile(
    path.join(PUBLIC_DIR, 'audio/music/kids_upbeat_loop.wav'),
    synthSamples(2.0, (t) => {
      const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 392.0];
      const step = Math.floor((t / 2.0) * 8) % 8;
      const localT = t % 0.25;
      return Math.sin(2 * Math.PI * notes[step] * t) * Math.exp(-localT * 6) * 0.55;
    })
  );

  // 4. Stingers & Announcer
  const stingers: Record<string, number[]> = {
    stinger_wave_start: [220, 277.18, 329.63, 440],
    stinger_wave_cleared: [329.63, 392, 523.25, 659.25],
    stinger_boss_arrival: [110, 103.83, 98, 73.42],
    stinger_victory: [261.63, 329.63, 392, 523.25],
    stinger_defeat: [196, 185, 174.61, 130.81],
  };

  for (const [name, chord] of Object.entries(stingers)) {
    writeWavFile(
      path.join(PUBLIC_DIR, `audio/stingers/${name}.wav`),
      synthSamples(0.85, (t) => {
        const idx = Math.min(3, Math.floor((t / 0.85) * 4));
        const freq = chord[idx];
        return (
          (Math.sin(2 * Math.PI * freq * t) * 0.55 +
            Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.3) *
          Math.exp(-(t % 0.21) * 5)
        );
      })
    );
  }

  const announcerFiles = [
    'announcer_wave_start',
    'announcer_boss_incoming',
    'announcer_barricade_low',
    'announcer_victory',
    'announcer_defeat',
  ];

  announcerFiles.forEach((name, idx) => {
    writeWavFile(
      path.join(PUBLIC_DIR, `audio/announcer/${name}.wav`),
      synthSamples(0.75, (t) => {
        // Stylized radio-comm cadence + formant synth
        const f1 = 165 + idx * 15 + Math.sin(t * 28) * 35;
        const f2 = f1 * 2.4;
        const env = Math.sin((t / 0.75) * Math.PI) * (0.75 + 0.25 * Math.sin(t * 42));
        return (
          (Math.sin(2 * Math.PI * f1 * t) * 0.55 + Math.sin(2 * Math.PI * f2 * t) * 0.3) *
          env *
          0.8
        );
      })
    );
  });

  console.log('All GLB models and WAV sound files generated in /public!');
}

generateAllAssets();
