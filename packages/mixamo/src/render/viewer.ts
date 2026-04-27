export function buildViewerHtml(opts: {
  bgColor?: string;
  view?: "side" | "front" | "back";
  frustumHeight?: number;
}): string {
  const { bgColor = "#00FF00", view = "side" } = opts;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; overflow:hidden; background:#000; }
  canvas { display:block; position:absolute; top:0; left:0; }
  #status { position:fixed; bottom:8px; left:8px; color:#fff; font:11px monospace;
            background:rgba(0,0,0,.6); padding:2px 6px; border-radius:3px; z-index:99; }
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.min.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<div id="status">loading...</div>
<script type="module">
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const params    = new URLSearchParams(location.search);
const charUrl   = params.get('char');
const animUrl   = params.get('anim');
const fbxUrl    = params.get('fbx');
const openpose  = params.get('mode') === 'openpose';
const bgHex     = openpose ? '#000000' : (params.get('bg') || ${JSON.stringify(bgColor)});
const camView   = params.get('view') || (openpose ? 'front' : ${JSON.stringify(view)});
// 'global': fixed camera across all frames (shows root motion)
// 'frame':  per-frame normalization (character always fills canvas)
const normalize = params.get('normalize') || 'global';

const log = m => { console.log(m); document.getElementById('status').textContent = m; };

// ═══════════════════════════════════════════════════════════════════════════════
// OpenPose BODY_25 spec
// Keypoint indices & colors: https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/include/openpose/pose/poseParametersRender.hpp
// Output format (JSON layout): https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/doc/02_output.md
// ControlNet COCO-18 limb colors: https://github.com/lllyasviel/ControlNet/blob/main/annotator/openpose/__init__.py
// ═══════════════════════════════════════════════════════════════════════════════

// Mixamo bone → BODY_25 keypoint index (direct mappings only)
// Bone.getWorldPosition() returns the bone's HEAD (joint origin), not tail.
//   mixamorigRightArm     = upper arm bone  → HEAD is at SHOULDER joint
//   mixamorigRightForeArm = forearm bone    → HEAD is at ELBOW joint
//   mixamorigRightHand    = hand bone       → HEAD is at WRIST joint
const MIXAMO_DIRECT = {
  mixamorigNeck:          1,
  mixamorigRightArm:      2,   // RShoulder (glenohumeral joint)
  mixamorigRightForeArm:  3,   // RElbow
  mixamorigRightHand:     4,   // RWrist
  mixamorigLeftArm:       5,   // LShoulder
  mixamorigLeftForeArm:   6,   // LElbow
  mixamorigLeftHand:      7,   // LWrist
  mixamorigHips:          8,   // MidHip
  mixamorigRightUpLeg:    9,
  mixamorigRightLeg:      10,
  mixamorigRightFoot:     11,  // RAnkle
  mixamorigLeftUpLeg:     12,
  mixamorigLeftLeg:       13,
  mixamorigLeftFoot:      14,  // LAnkle
  mixamorigLeftToeBase:   19,  // LBigToe
  mixamorigRightToeBase:  22,  // RBigToe
};

// Approximate keypoints derived from available bones:
// 0  Nose    ← Head bone, shifted down ~30% of head length
// 15 REye    ← Head ±lateral offset
// 16 LEye
// 17 REar    ← Head ±wider lateral
// 18 LEar
// 20 LSmallToe ← LeftToeBase + small lateral offset
// 21 LHeel    ← LeftFoot (ankle as heel approximation)
// 23 RSmallToe ← RightToeBase + small lateral
// 24 RHeel    ← RightFoot

// BODY_25 limb pairs [kp_a, kp_b, r, g, b]
// Colors follow the ControlNet / COCO-18 standard (controlnet_aux color table).
// BODY_25 additions (MidHip, feet) use the nearest COCO-18 analogues.
const BODY25_LIMBS = [
  [1, 8,  255, 0,   85 ],  // Neck-MidHip     (no COCO equiv; warm pink)
  [1, 2,  255, 0,   0  ],  // Neck-RShoulder  COCO colors[0]
  [1, 5,  255, 85,  0  ],  // Neck-LShoulder  COCO colors[1]
  [2, 3,  255, 170, 0  ],  // RShoulder-RElbow COCO colors[2]
  [3, 4,  255, 255, 0  ],  // RElbow-RWrist   COCO colors[3]
  [5, 6,  170, 255, 0  ],  // LShoulder-LElbow COCO colors[4]
  [6, 7,  85,  255, 0  ],  // LElbow-LWrist   COCO colors[5]
  [8, 9,  0,   255, 0  ],  // MidHip-RHip     ~COCO Neck-RHip colors[6]
  [9, 10, 0,   255, 85 ],  // RHip-RKnee      COCO colors[7]
  [10,11, 0,   255, 170],  // RKnee-RAnkle    COCO colors[8]
  [8, 12, 0,   255, 255],  // MidHip-LHip     ~COCO Neck-LHip colors[9]
  [12,13, 0,   170, 255],  // LHip-LKnee      COCO colors[10]
  [13,14, 0,   85,  255],  // LKnee-LAnkle    COCO colors[11]
  [1, 0,  0,   0,   255],  // Neck-Nose       COCO colors[12]
  [0, 15, 85,  0,   255],  // Nose-REye       COCO colors[13]
  [15,17, 170, 0,   255],  // REye-REar       COCO colors[14]
  [0, 16, 255, 0,   255],  // Nose-LEye       COCO colors[15]
  [16,18, 255, 0,   170],  // LEye-LEar       COCO colors[16]
  [14,19, 0,   255, 255],  // LAnkle-LBigToe  (cyan = left foot family)
  [19,20, 0,   255, 255],  // LBigToe-LSmallToe
  [14,21, 0,   255, 255],  // LAnkle-LHeel
  [11,22, 0,   255, 0  ],  // RAnkle-RBigToe  (green = right foot family)
  [22,23, 255, 255, 0  ],  // RBigToe-RSmallToe
  [11,24, 255, 255, 0  ],  // RAnkle-RHeel
];

// Per-keypoint dot colors — standard BODY_25 / POSE_BODY_25_COLORS_RENDER
const KP_COLORS = [
  '#ff0055', // 0  Nose       (255,0,85)
  '#ff0000', // 1  Neck       (255,0,0)
  '#ff5500', // 2  RShoulder  (255,85,0)
  '#ffaa00', // 3  RElbow     (255,170,0)
  '#ffff00', // 4  RWrist     (255,255,0)
  '#aaff00', // 5  LShoulder  (170,255,0)
  '#55ff00', // 6  LElbow     (85,255,0)
  '#00ff00', // 7  LWrist     (0,255,0)
  '#ff0000', // 8  MidHip     (255,0,0)
  '#00ff55', // 9  RHip       (0,255,85)
  '#00ffaa', // 10 RKnee      (0,255,170)
  '#00ffff', // 11 RAnkle     (0,255,255)
  '#00aaff', // 12 LHip       (0,170,255)
  '#0055ff', // 13 LKnee      (0,85,255)
  '#0000ff', // 14 LAnkle     (0,0,255)
  '#ff00aa', // 15 REye       (255,0,170)
  '#aa00ff', // 16 LEye       (170,0,255)
  '#ff00ff', // 17 REar       (255,0,255)
  '#5500ff', // 18 LEar       (85,0,255)
  '#0000ff', // 19 LBigToe    (0,0,255)
  '#0000ff', // 20 LSmallToe  (0,0,255)
  '#0000ff', // 21 LHeel      (0,0,255)
  '#00ffff', // 22 RBigToe    (0,255,255)
  '#00ffff', // 23 RSmallToe  (0,255,255)
  '#00ffff', // 24 RHeel      (0,255,255)
];

// ── Hand keypoints (OpenPose HAND_21 per hand) ────────────────────────────────
// Bone order matches HAND_21: 0=wrist, 1-4=thumb, 5-8=index, 9-12=middle, 13-16=ring, 17-20=pinky
const HAND_BONES = {
  right: [
    'mixamorigRightHand',
    'mixamorigRightHandThumb1','mixamorigRightHandThumb2','mixamorigRightHandThumb3','mixamorigRightHandThumb4',
    'mixamorigRightHandIndex1','mixamorigRightHandIndex2','mixamorigRightHandIndex3','mixamorigRightHandIndex4',
    'mixamorigRightHandMiddle1','mixamorigRightHandMiddle2','mixamorigRightHandMiddle3','mixamorigRightHandMiddle4',
    'mixamorigRightHandRing1','mixamorigRightHandRing2','mixamorigRightHandRing3','mixamorigRightHandRing4',
    'mixamorigRightHandPinky1','mixamorigRightHandPinky2','mixamorigRightHandPinky3','mixamorigRightHandPinky4',
  ],
  left: [
    'mixamorigLeftHand',
    'mixamorigLeftHandThumb1','mixamorigLeftHandThumb2','mixamorigLeftHandThumb3','mixamorigLeftHandThumb4',
    'mixamorigLeftHandIndex1','mixamorigLeftHandIndex2','mixamorigLeftHandIndex3','mixamorigLeftHandIndex4',
    'mixamorigLeftHandMiddle1','mixamorigLeftHandMiddle2','mixamorigLeftHandMiddle3','mixamorigLeftHandMiddle4',
    'mixamorigLeftHandRing1','mixamorigLeftHandRing2','mixamorigLeftHandRing3','mixamorigLeftHandRing4',
    'mixamorigLeftHandPinky1','mixamorigLeftHandPinky2','mixamorigLeftHandPinky3','mixamorigLeftHandPinky4',
  ],
};
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],      // thumb
  [0,5],[5,6],[6,7],[7,8],      // index
  [0,9],[9,10],[10,11],[11,12], // middle
  [0,13],[13,14],[14,15],[15,16],// ring
  [0,17],[17,18],[18,19],[19,20],// pinky
];
// Per-finger color: thumb→red, index→orange, middle→yellow, ring→green, pinky→blue
const HAND_FINGER_COLORS = ['#ff3300','#ff9900','#ffff00','#33ff88','#3399ff'];
function fingerColorOf(kpIdx) {
  if (kpIdx <= 4)  return HAND_FINGER_COLORS[0];
  if (kpIdx <= 8)  return HAND_FINGER_COLORS[1];
  if (kpIdx <= 12) return HAND_FINGER_COLORS[2];
  if (kpIdx <= 16) return HAND_FINGER_COLORS[3];
  return HAND_FINGER_COLORS[4];
}

// Reference bones used to compute the normalisation bounding box
const BBOX_BONES = [
  'mixamorigHead','mixamorigNeck','mixamorigHips',
  'mixamorigRightShoulder','mixamorigLeftShoulder',
  'mixamorigRightHand','mixamorigLeftHand',
  'mixamorigRightFoot','mixamorigLeftFoot',
  'mixamorigRightToeBase','mixamorigLeftToeBase',
];

// ═══════════════════════════════════════════════════════════════════════════════
// WebGL renderer (used for 3D preview mode)
// ═══════════════════════════════════════════════════════════════════════════════
const W = window.innerWidth, H = window.innerHeight;
const glCanvas = document.createElement('canvas');
glCanvas.width = W; glCanvas.height = H;
document.body.appendChild(glCanvas);

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(bgHex);
scene.add(new THREE.AmbientLight(0xffffff, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 10, 5);
scene.add(sun);

// ═══════════════════════════════════════════════════════════════════════════════
// 2D OpenPose canvas
// ═══════════════════════════════════════════════════════════════════════════════
const opCanvas = document.createElement('canvas');
opCanvas.width = W; opCanvas.height = H;
opCanvas.style.zIndex = '10';
document.body.appendChild(opCanvas);
const ctx2d = opCanvas.getContext('2d');

// ═══════════════════════════════════════════════════════════════════════════════
// Camera (for 3D preview mode)
// ═══════════════════════════════════════════════════════════════════════════════
const aspect = W / H;
const camera = new THREE.OrthographicCamera(-100*aspect,100*aspect,100,-100,1,5000);
camera.position.set(0, 100, 1500);
camera.lookAt(0, 100, 0);

// ═══════════════════════════════════════════════════════════════════════════════
// Bone map
// ═══════════════════════════════════════════════════════════════════════════════
const boneMap = {};

function buildBoneMap(root) {
  root.traverse(obj => { if (obj.isBone) boneMap[obj.name] = obj; });
  log('bones: ' + Object.keys(boneMap).length);
}

// View-aware world → canvas transform.
// front: mirrors X (char +X → screen left)
// side:  uses Z as horizontal (char +Z = backward → screen left)
// back:  no mirror (char +X → screen right)
function makeToScreen(cx, cy, cz, scale) {
  if (camView === 'side') {
    return (wp) => ({
      x: W / 2 - (wp.z - cz) * scale,
      y: H / 2 - (wp.y - cy) * scale,
    });
  } else if (camView === 'back') {
    return (wp) => ({
      x: W / 2 + (wp.x - cx) * scale,
      y: H / 2 - (wp.y - cy) * scale,
    });
  } else {
    return (wp) => ({
      x: W / 2 - (wp.x - cx) * scale,
      y: H / 2 - (wp.y - cy) * scale,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Global normalisation — samples the full animation to build a fixed toScreen.
// Must be called after FBX + mixer are ready. Resets mixer to t=0 when done.
// ═══════════════════════════════════════════════════════════════════════════════
function computeGlobalNorm() {
  if (!mixer || animDuration <= 0) return;
  const N = 40;
  let gMinX = Infinity, gMaxX = -Infinity;
  let gMinZ = Infinity, gMaxZ = -Infinity;
  let gMinY = Infinity, gMaxY = -Infinity;

  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * animDuration;
    mixer.setTime(t);
    if (rootObj) rootObj.updateMatrixWorld(true);
    for (const bn of BBOX_BONES) {
      const bone = boneMap[bn];
      if (!bone) continue;
      const p = new THREE.Vector3();
      bone.getWorldPosition(p);
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue;
      if (p.x < gMinX) gMinX = p.x; if (p.x > gMaxX) gMaxX = p.x;
      if (p.z < gMinZ) gMinZ = p.z; if (p.z > gMaxZ) gMaxZ = p.z;
      if (p.y < gMinY) gMinY = p.y; if (p.y > gMaxY) gMaxY = p.y;
    }
  }

  // Reset to t=0 after sampling
  mixer.setTime(0);
  if (rootObj) rootObj.updateMatrixWorld(true);

  if (!isFinite(gMinX)) return; // no valid bones — fall back to per-frame

  const bboxCX = (gMinX + gMaxX) / 2;
  const bboxCY = (gMinY + gMaxY) / 2;
  const bboxCZ = (gMinZ + gMaxZ) / 2;
  const bboxHoriz = camView === 'side' ? Math.max(gMaxZ - gMinZ, 1) : Math.max(gMaxX - gMinX, 1);
  const bboxH     = Math.max(gMaxY - gMinY, 1);
  const PAD = 0.10;
  const availW = W * (1 - 2 * PAD);
  const availH = H * (1 - 2 * PAD);
  const scale = Math.min(availW / bboxHoriz, availH / bboxH);

  globalToScreen = makeToScreen(bboxCX, bboxCY, bboxCZ, scale);
  log('global norm · h=' + bboxH.toFixed(0) + ' scale=' + scale.toFixed(2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Keypoint computation — world-space bones → canvas pixels.
// Uses globalToScreen (fixed camera) when normalize=global, else per-frame bbox.
// ═══════════════════════════════════════════════════════════════════════════════
function computeKeypoints() {
  // 1. Collect bbox reference bone positions (always needed for per-frame fallback)
  const refPts = [];
  for (const bn of BBOX_BONES) {
    const bone = boneMap[bn];
    if (!bone) continue;
    const p = new THREE.Vector3();
    bone.getWorldPosition(p);
    if (isFinite(p.x) && isFinite(p.y)) refPts.push(p);
  }
  if (refPts.length === 0) return new Array(25).fill(null);

  // 2. Pick toScreen: global (fixed) or per-frame (always-fill)
  let toScreen;
  if (globalToScreen) {
    toScreen = globalToScreen;
  } else {
    // Per-frame bbox — track X, Z, Y to support all view directions
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of refPts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const bboxCX = (minX + maxX) / 2;
    const bboxCY = (minY + maxY) / 2;
    const bboxCZ = (minZ + maxZ) / 2;
    const bboxHoriz = camView === 'side' ? Math.max(maxZ - minZ, 1) : Math.max(maxX - minX, 1);
    const bboxH     = Math.max(maxY - minY, 1);
    const PAD = 0.10;
    const availW = W * (1 - 2 * PAD);
    const availH = H * (1 - 2 * PAD);
    const scale = Math.min(availW / bboxHoriz, availH / bboxH);
    toScreen = makeToScreen(bboxCX, bboxCY, bboxCZ, scale);
  }

  // 5. Direct bone mappings
  const kps = new Array(25).fill(null);
  const worldPos = {};

  for (const [bn, idx] of Object.entries(MIXAMO_DIRECT)) {
    const bone = boneMap[bn];
    if (!bone) continue;
    const p = new THREE.Vector3();
    bone.getWorldPosition(p);
    if (!isFinite(p.x)) continue;
    worldPos[bn] = p;
    kps[idx] = toScreen(p);
  }

  // Also get Head (used for approximations)
  const headBone = boneMap['mixamorigHead'];
  const neckBone = boneMap['mixamorigNeck'];
  if (headBone) { const p = new THREE.Vector3(); headBone.getWorldPosition(p); worldPos['mixamorigHead'] = p; }

  // 6. Approximate missing keypoints
  const headWP = worldPos['mixamorigHead'];
  const neckWP = worldPos['mixamorigNeck'];

  if (headWP && neckWP) {
    const headLen = headWP.distanceTo(neckWP);

    // Nose: below head top centre
    kps[0]  = toScreen(new THREE.Vector3(headWP.x, headWP.y - headLen * 0.28, headWP.z));

    // Eyes: R = character's +X side, L = character's -X side
    // (toScreen mirrors +X → screen left, so REye appears on screen left as expected)
    const eyeY    = headWP.y - headLen * 0.18;
    const eyeSpan = headLen * 0.18;
    kps[15] = toScreen(new THREE.Vector3(headWP.x + eyeSpan, eyeY, headWP.z)); // REye (+X = char right)
    kps[16] = toScreen(new THREE.Vector3(headWP.x - eyeSpan, eyeY, headWP.z)); // LEye (-X = char left)

    // Ears: same lateral convention as eyes
    const earY    = headWP.y - headLen * 0.22;
    const earSpan = headLen * 0.34;
    kps[17] = toScreen(new THREE.Vector3(headWP.x + earSpan, earY, headWP.z)); // REar (+X)
    kps[18] = toScreen(new THREE.Vector3(headWP.x - earSpan, earY, headWP.z)); // LEar (-X)
  }

  // Foot extras
  // SmallToe is lateral to BigToe: left foot pinky is at -X, right foot pinky is at +X.
  // Offset derived from foot-to-toebase distance for proportional scaling.
  if (worldPos['mixamorigLeftToeBase'] && worldPos['mixamorigLeftFoot']) {
    const lt  = worldPos['mixamorigLeftToeBase'];
    const lf  = worldPos['mixamorigLeftFoot'];
    const off = lt.distanceTo(lf) * 0.3;
    kps[20] = toScreen(new THREE.Vector3(lt.x - off, lt.y, lt.z)); // LSmallToe (-X = char left)
  }
  if (worldPos['mixamorigLeftFoot']) {
    kps[21] = toScreen(worldPos['mixamorigLeftFoot']); // LHeel ≈ ankle
  }
  if (worldPos['mixamorigRightToeBase'] && worldPos['mixamorigRightFoot']) {
    const rt  = worldPos['mixamorigRightToeBase'];
    const rf  = worldPos['mixamorigRightFoot'];
    const off = rt.distanceTo(rf) * 0.3;
    kps[23] = toScreen(new THREE.Vector3(rt.x + off, rt.y, rt.z)); // RSmallToe (+X = char right)
  }
  if (worldPos['mixamorigRightFoot']) {
    kps[24] = toScreen(worldPos['mixamorigRightFoot']); // RHeel ≈ ankle
  }

  return { kps, toScreen };
}

// Compute hand keypoints for one hand (21 pts) using the same normalisation toScreen
function computeHandKps(side, toScreen) {
  const bones = HAND_BONES[side];
  return bones.map(bn => {
    const bone = boneMap[bn];
    if (!bone) return null;
    const p = new THREE.Vector3();
    bone.getWorldPosition(p);
    if (!isFinite(p.x)) return null;
    return toScreen(p);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Draw OpenPose on 2D canvas
// ═══════════════════════════════════════════════════════════════════════════════
function drawOpenPose() {
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#000';
  ctx2d.fillRect(0, 0, W, H);

  const { kps, toScreen } = computeKeypoints();

  // ── Limb lines ──
  for (const [a, b, r, g, bl] of BODY25_LIMBS) {
    if (!kps[a] || !kps[b]) continue;
    ctx2d.strokeStyle = 'rgb(' + r + ',' + g + ',' + bl + ')';
    ctx2d.lineWidth   = 2;
    ctx2d.lineCap     = 'round';
    ctx2d.beginPath();
    ctx2d.moveTo(kps[a].x, kps[a].y);
    ctx2d.lineTo(kps[b].x, kps[b].y);
    ctx2d.stroke();
  }

  // ── Face circle (approximate 68-point face outline) ──
  if (kps[0] && kps[15] && kps[16]) {
    // Radius ≈ distance between eyes
    const eyeDist = Math.hypot(kps[15].x - kps[16].x, kps[15].y - kps[16].y);
    const faceR = eyeDist * 1.4;
    // Centre between nose and midpoint of ears
    const faceCX = kps[0].x;
    const faceCY = kps[0].y - eyeDist * 0.6;
    const NDOTS  = 14;
    ctx2d.fillStyle = '#ffffff';
    for (let i = 0; i < NDOTS; i++) {
      const angle = (i / NDOTS) * Math.PI * 2;
      const dx = Math.cos(angle) * faceR;
      const dy = Math.sin(angle) * faceR * 1.3; // slightly taller than wide
      ctx2d.beginPath();
      ctx2d.arc(faceCX + dx, faceCY + dy, 2, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  // ── Keypoint dots ──
  for (let i = 0; i < kps.length; i++) {
    if (!kps[i]) continue;
    ctx2d.fillStyle = KP_COLORS[i] ?? '#ffffff';
    ctx2d.beginPath();
    ctx2d.arc(kps[i].x, kps[i].y, 3, 0, Math.PI * 2);
    ctx2d.fill();
  }

  // ── Hand keypoints (HAND_21 × 2) ─────────────────────────────────────────
  for (const side of ['right', 'left']) {
    const hkps = computeHandKps(side, toScreen);
    // Lines
    for (const [a, b] of HAND_CONNECTIONS) {
      if (!hkps[a] || !hkps[b]) continue;
      ctx2d.strokeStyle = fingerColorOf(b);
      ctx2d.lineWidth   = 1.5;
      ctx2d.lineCap     = 'round';
      ctx2d.beginPath();
      ctx2d.moveTo(hkps[a].x, hkps[a].y);
      ctx2d.lineTo(hkps[b].x, hkps[b].y);
      ctx2d.stroke();
    }
    // Dots
    for (let i = 0; i < hkps.length; i++) {
      if (!hkps[i]) continue;
      ctx2d.fillStyle = i === 0 ? '#ffffff' : fingerColorOf(i);
      ctx2d.beginPath();
      ctx2d.arc(hkps[i].x, hkps[i].y, i === 0 ? 3 : 2, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3D camera fit — samples all animation frames to cover full root-motion extent.
// Resets mixer to t=0 when done.
// ═══════════════════════════════════════════════════════════════════════════════
function fitCamera3D(root) {
  const bbox = new THREE.Box3();
  const N = 30;
  for (let i = 0; i < N; i++) {
    if (mixer && animDuration > 0) {
      mixer.setTime((i / (N - 1)) * animDuration);
      if (rootObj) rootObj.updateMatrixWorld(true);
    }
    root.traverse(obj => {
      if (!obj.isBone) return;
      const p = new THREE.Vector3();
      obj.getWorldPosition(p);
      if (isFinite(p.x) && isFinite(p.y)) bbox.expandByPoint(p);
    });
  }
  if (mixer) { mixer.setTime(0); if (rootObj) rootObj.updateMatrixWorld(true); }

  if (bbox.isEmpty()) { camera.position.set(0,100,1500); camera.lookAt(0,100,0); return; }

  const center = bbox.getCenter(new THREE.Vector3());
  const size   = bbox.getSize(new THREE.Vector3());
  const screenH = size.y * 1.2;
  const screenW = (camView === 'side' ? size.z : size.x) * 1.25;
  const padH    = Math.max(screenH, screenW / aspect);
  camera.top = padH/2; camera.bottom = -padH/2;
  camera.left = -(padH*aspect)/2; camera.right = (padH*aspect)/2;

  if (camView === 'side') camera.position.set(center.x+1500, center.y, center.z);
  else                    camera.position.set(center.x, center.y, center.z+1500);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  log('3D camera fitted · h=' + padH.toFixed(0));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Animation state
// ═══════════════════════════════════════════════════════════════════════════════
let mixer = null, animDuration = 0, rootObj = null;

// Fixed toScreen computed once across all animation frames (global normalization).
// null until computeGlobalNorm() runs, then stays fixed for the whole session.
let globalToScreen = null;

// Approximated keypoints (lower confidence in JSON output)
const APPROX_KPS = new Set([0, 15, 16, 17, 18, 20, 21, 23, 24]);

window.__hf = {
  duration: 0,
  seek(t) {
    if (mixer) {
      mixer.setTime(Math.max(0, t));
      if (rootObj) rootObj.updateMatrixWorld(true);
    }
    if (openpose) drawOpenPose();
    else renderer.render(scene, camera);
  },
  getFrame() {
    return openpose
      ? opCanvas.toDataURL('image/png')
      : glCanvas.toDataURL('image/png');
  },
  // Returns OpenPose JSON payload for the current frame (openpose mode only).
  // pose_keypoints_2d: 25 × [x, y, confidence]  (direct bone = 1.0, approximated = 0.5)
  // hand_*_keypoints_2d: 21 × [x, y, confidence]
  getKeypoints() {
    if (!openpose) return null;
    const { kps, toScreen } = computeKeypoints();

    const flatKps = (arr, approxSet) => {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const kp = arr[i];
        out.push(kp ? kp.x : 0, kp ? kp.y : 0, kp ? (approxSet && approxSet.has(i) ? 0.5 : 1.0) : 0.0);
      }
      return out;
    };

    return {
      pose_keypoints_2d:        flatKps(kps, APPROX_KPS),
      hand_right_keypoints_2d:  flatKps(computeHandKps('right', toScreen), null),
      hand_left_keypoints_2d:   flatKps(computeHandKps('left',  toScreen), null),
      face_keypoints_2d:        [],
    };
  },
};
window.__fbxReady = false;
window.__fbxError = null;

// ═══════════════════════════════════════════════════════════════════════════════
// FBX loading
// ═══════════════════════════════════════════════════════════════════════════════
const loader = new FBXLoader();

function onReady(root, clips) {
  rootObj = root;
  buildBoneMap(root);

  if (!openpose) {
    const helper = new THREE.SkeletonHelper(root);
    scene.add(helper);
  }

  mixer = new THREE.AnimationMixer(root);
  if (clips && clips.length > 0) {
    animDuration = clips[0].duration;
    const action = mixer.clipAction(clips[0]);
    action.play();
    mixer.setTime(0);
    root.updateMatrixWorld(true);
  }

  animDuration = animDuration || 0;
  window.__hf.duration = animDuration;
  window.__fbxReady    = true;

  if (openpose) {
    if (normalize !== 'frame') computeGlobalNorm(); // samples all frames, resets to t=0
    drawOpenPose();
  } else {
    fitCamera3D(root); // samples all frames, resets to t=0
    renderer.render(scene, camera);
  }

  log('ready · ' + (openpose ? 'openpose BODY_25' : '3D') + ' · dur=' + animDuration.toFixed(2) + 's · bones=' + Object.keys(boneMap).length);
}

function onError(err) {
  window.__fbxError = err?.message ?? String(err);
  log('ERROR: ' + window.__fbxError);
}

if (charUrl || fbxUrl) {
  loader.load(charUrl || fbxUrl, (charFbx) => {
    charFbx.position.set(0, 0, 0);
    // updateMatrixWorld before bbox so root-level scale/rotation is accounted for
    charFbx.updateMatrixWorld(true);
    // Only centre if mesh exists (skeleton-only FBX has empty bbox)
    const bbox = new THREE.Box3().setFromObject(charFbx);
    if (!bbox.isEmpty()) {
      const c = bbox.getCenter(new THREE.Vector3());
      charFbx.position.x -= c.x;
      charFbx.position.z -= c.z;
      charFbx.position.y -= bbox.min.y;
    }
    charFbx.traverse(ch => { if (ch.isMesh) { ch.castShadow = ch.receiveShadow = true; } });
    scene.add(charFbx);

    if (animUrl) {
      loader.load(animUrl, (animFbx) => {
        if (!animFbx.animations || animFbx.animations.length === 0) {
          onError(new Error('animFbx contains no animation clips — check the FBX was exported with animation'));
          return;
        }
        log('anim clips: ' + animFbx.animations.length + ' · tracks: ' + animFbx.animations[0].tracks.length);
        onReady(charFbx, animFbx.animations);
      }, undefined, onError);
    } else {
      onReady(charFbx, charFbx.animations);
    }
  }, undefined, onError);
} else {
  window.__fbxError = 'No FBX URL (?char= or ?fbx=)';
}
</script>
</body>
</html>`;
}
