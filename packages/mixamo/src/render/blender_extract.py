#!/usr/bin/env python3
"""
Blender headless OpenPose extractor for mixamo-sprite.

Blender FBX import uses Z-up, Y-forward convention:
  +X = character's anatomical LEFT  (screen right in front view)
  -X = character's anatomical RIGHT (screen left  in front view)
  +Z = up
  -Y = forward (toward camera in front view)

Run via:
  blender --background --python blender_extract.py -- '<JSON opts>'
"""
import sys, os, json, math
import bpy
import numpy as np

# ─── BODY_25 spec ─────────────────────────────────────────────────────────────
# Blender FBX import adds "mixamorig:" prefix (with colon) to bone names.

MIXAMO_DIRECT = {
    'mixamorig:Neck':          1,
    'mixamorig:RightArm':      2,   # RShoulder
    'mixamorig:RightForeArm':  3,   # RElbow
    'mixamorig:RightHand':     4,   # RWrist
    'mixamorig:LeftArm':       5,   # LShoulder
    'mixamorig:LeftForeArm':   6,   # LElbow
    'mixamorig:LeftHand':      7,   # LWrist
    'mixamorig:Hips':          8,   # MidHip
    'mixamorig:RightUpLeg':    9,
    'mixamorig:RightLeg':      10,
    'mixamorig:RightFoot':     11,
    'mixamorig:LeftUpLeg':     12,
    'mixamorig:LeftLeg':       13,
    'mixamorig:LeftFoot':      14,
    'mixamorig:LeftToeBase':   19,
    'mixamorig:RightToeBase':  22,
}

APPROX_KPS = {0, 15, 16, 17, 18, 20, 21, 23, 24}

BBOX_BONES = [
    'mixamorig:Head', 'mixamorig:Neck', 'mixamorig:Hips',
    'mixamorig:RightShoulder', 'mixamorig:LeftShoulder',
    'mixamorig:RightHand', 'mixamorig:LeftHand',
    'mixamorig:RightFoot', 'mixamorig:LeftFoot',
    'mixamorig:RightToeBase', 'mixamorig:LeftToeBase',
]

BODY25_LIMBS = [
    (1, 8,  255, 0,   85),
    (1, 2,  255, 0,   0),
    (1, 5,  255, 85,  0),
    (2, 3,  255, 170, 0),
    (3, 4,  255, 255, 0),
    (5, 6,  170, 255, 0),
    (6, 7,  85,  255, 0),
    (8, 9,  0,   255, 0),
    (9, 10, 0,   255, 85),
    (10,11, 0,   255, 170),
    (8, 12, 0,   255, 255),
    (12,13, 0,   170, 255),
    (13,14, 0,   85,  255),
    (1, 0,  0,   0,   255),
    (0, 15, 85,  0,   255),
    (15,17, 170, 0,   255),
    (0, 16, 255, 0,   255),
    (16,18, 255, 0,   170),
    (14,19, 0,   255, 255),
    (19,20, 0,   255, 255),
    (14,21, 0,   255, 255),
    (11,22, 0,   255, 0),
    (22,23, 255, 255, 0),
    (11,24, 255, 255, 0),
]

KP_COLORS = [
    (255,0,85),(255,0,0),(255,85,0),(255,170,0),(255,255,0),
    (170,255,0),(85,255,0),(0,255,0),(255,0,0),(0,255,85),
    (0,255,170),(0,255,255),(0,170,255),(0,85,255),(0,0,255),
    (255,0,170),(170,0,255),(255,0,255),(85,0,255),
    (0,0,255),(0,0,255),(0,0,255),
    (0,255,255),(0,255,255),(0,255,255),
]

# ─── Drawing ──────────────────────────────────────────────────────────────────

def draw_line(canvas, x0, y0, x1, y1, color, lw=2):
    H, W = canvas.shape[:2]
    steps = max(abs(x1-x0), abs(y1-y0), 1)
    hw = max(lw // 2, 0)
    xs = np.round(np.linspace(x0, x1, int(steps)+1)).astype(int)
    ys = np.round(np.linspace(y0, y1, int(steps)+1)).astype(int)
    for bx in range(-hw, hw+1):
        for by in range(-hw, hw+1):
            px = np.clip(xs+bx, 0, W-1)
            py = np.clip(ys+by, 0, H-1)
            canvas[py, px] = color

def draw_circle(canvas, cx, cy, r, color):
    H, W = canvas.shape[:2]
    y0 = max(0, cy-r); y1 = min(H, cy+r+1)
    x0 = max(0, cx-r); x1 = min(W, cx+r+1)
    if y0 >= y1 or x0 >= x1:
        return
    ys, xs = np.ogrid[y0:y1, x0:x1]
    canvas[y0:y1, x0:x1][(xs-cx)**2 + (ys-cy)**2 <= r**2] = color

# ─── Blender helpers ──────────────────────────────────────────────────────────

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_fbx(path):
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    return [o for o in bpy.data.objects if o.name not in before]

def set_frame(frame):
    bpy.context.scene.frame_set(int(round(frame)))
    bpy.context.view_layer.update()

def bone_world_pos(arm_obj, bone_name):
    """World-space position of a bone's head joint."""
    bone = arm_obj.pose.bones.get(bone_name)
    if bone is None:
        return None
    loc = (arm_obj.matrix_world @ bone.matrix).translation
    return (loc.x, loc.y, loc.z)  # x=horiz, y=depth, z=height

# ─── Coordinate system note ───────────────────────────────────────────────────
# Blender (Z-up, Y-forward) after FBX import:
#   x: char anatomical LEFT = +X, char anatomical RIGHT = -X
#   y: depth (negative = toward camera)
#   z: height (up)
#
# Screen mapping (front view, camera at +Y looking toward -Y):
#   screen_x = W/2 + (x - cx) * scale   (+X → screen right = char left ✓)
#   screen_y = H/2 - (z - cz) * scale   (+Z → screen up ✓)
#
# Side view (camera at +X, looking toward -X):
#   screen_x = W/2 + (y - cy) * scale   (+Y = depth → screen right)
#   screen_y = H/2 - (z - cz) * scale

def make_to_screen(cx, cy, cz, scale, view, W, H):
    if view == 'side':
        return lambda pos: (
            int(round(W/2 + (pos[1] - cy) * scale)),
            int(round(H/2 - (pos[2] - cz) * scale)),
        )
    elif view == 'back':
        return lambda pos: (
            int(round(W/2 - (pos[0] - cx) * scale)),
            int(round(H/2 - (pos[2] - cz) * scale)),
        )
    else:  # front
        return lambda pos: (
            int(round(W/2 + (pos[0] - cx) * scale)),
            int(round(H/2 - (pos[2] - cz) * scale)),
        )

# ─── Normalisation ────────────────────────────────────────────────────────────

def compute_global_norm(arm_obj, sample_frames, view, W, H, PAD=0.10):
    xs, ys, zs = [], [], []
    for fr in sample_frames:
        set_frame(fr)
        for bn in BBOX_BONES:
            pos = bone_world_pos(arm_obj, bn)
            if pos is None:
                continue
            xs.append(pos[0]); ys.append(pos[1]); zs.append(pos[2])

    if not xs:
        return make_to_screen(0, 0, 1, 100, view, W, H)

    cx = (min(xs)+max(xs))/2
    cy = (min(ys)+max(ys))/2
    cz = (min(zs)+max(zs))/2

    horiz = ys if view == 'side' else xs
    bbox_w = max(max(horiz)-min(horiz), 1e-6)
    bbox_h = max(max(zs)-min(zs), 1e-6)
    scale  = min(W*(1-2*PAD)/bbox_w, H*(1-2*PAD)/bbox_h)

    print(f'[blender] norm cx={cx:.3f} cy={cy:.3f} cz={cz:.3f} scale={scale:.1f}', flush=True)
    return make_to_screen(cx, cy, cz, scale, view, W, H)

# ─── Keypoints ────────────────────────────────────────────────────────────────

def compute_keypoints(arm_obj, to_screen):
    kps = [None] * 25
    wp  = {}

    for bn, idx in MIXAMO_DIRECT.items():
        pos = bone_world_pos(arm_obj, bn)
        if pos is None:
            continue
        wp[bn] = pos
        kps[idx] = to_screen(pos)

    head_pos = bone_world_pos(arm_obj, 'mixamorig:Head')
    neck_pos  = wp.get('mixamorig:Neck')
    if head_pos:
        wp['mixamorig:Head'] = head_pos

    if head_pos and neck_pos:
        hx, hy, hz = head_pos
        nx, ny, nz = neck_pos
        hl = math.sqrt((hx-nx)**2 + (hy-ny)**2 + (hz-nz)**2)

        # Nose: below head origin (lower Z)
        kps[0]  = to_screen((hx, hy, hz - hl*0.28))
        # Eyes: lateral offset in X
        # In Blender: char anatomical RIGHT = -X → REye at -X
        kps[15] = to_screen((hx - hl*0.18, hy, hz - hl*0.18))  # REye
        kps[16] = to_screen((hx + hl*0.18, hy, hz - hl*0.18))  # LEye
        kps[17] = to_screen((hx - hl*0.34, hy, hz - hl*0.22))  # REar
        kps[18] = to_screen((hx + hl*0.34, hy, hz - hl*0.22))  # LEar

    def foot_extras(toe_key, foot_key, x_sign, kp_small, kp_heel):
        if wp.get(toe_key) and wp.get(foot_key):
            t = wp[toe_key]; f = wp[foot_key]
            off = math.sqrt(sum((a-b)**2 for a,b in zip(t,f))) * 0.3
            kps[kp_small] = to_screen((t[0] + x_sign*off, t[1], t[2]))
        if wp.get(foot_key):
            kps[kp_heel] = to_screen(wp[foot_key])

    # In Blender: char LEFT=+X, char RIGHT=-X
    # LSmallToe = further +X from LBigToe
    # RSmallToe = further -X from RBigToe
    foot_extras('mixamorig:LeftToeBase',  'mixamorig:LeftFoot',  +1, 20, 21)
    foot_extras('mixamorig:RightToeBase', 'mixamorig:RightFoot', -1, 23, 24)

    return kps

# ─── Rendering ────────────────────────────────────────────────────────────────

def render_openpose(kps, W, H):
    canvas = np.zeros((H, W, 3), dtype=np.uint8)
    for a, b, r, g, bl in BODY25_LIMBS:
        if kps[a] and kps[b]:
            draw_line(canvas, kps[a][0], kps[a][1], kps[b][0], kps[b][1], (r, g, bl), lw=2)
    for i, kp in enumerate(kps):
        if kp:
            draw_circle(canvas, kp[0], kp[1], 3, KP_COLORS[i])
    return canvas

def save_png(canvas, path):
    H, W = canvas.shape[:2]
    name = os.path.basename(path)
    img = bpy.data.images.new(name, W, H, alpha=False)
    rgba = np.zeros((H, W, 4), dtype=np.float32)
    rgba[:, :, :3] = canvas[::-1].astype(np.float32) / 255.0  # flip Y (Blender bottom-to-top)
    rgba[:, :, 3]  = 1.0
    img.pixels = rgba.flatten().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)

def make_json(kps):
    flat = []
    for i, kp in enumerate(kps):
        flat.extend([float(kp[0]), float(kp[1]), 0.5 if i in APPROX_KPS else 1.0] if kp else [0.0,0.0,0.0])
    return {"version": 1.3, "people": [{"person_id": [-1],
        "pose_keypoints_2d": flat, "face_keypoints_2d": [],
        "hand_left_keypoints_2d": [], "hand_right_keypoints_2d": []}]}

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    argv = sys.argv
    if '--' not in argv:
        print('{"error":"missing args"}'); sys.exit(1)
    opts = json.loads(argv[argv.index('--') + 1])

    char_path  = opts['charPath']
    anim_path  = opts.get('animPath')
    output_dir = opts['outputDir']
    fps        = opts.get('fps')
    n_frames   = opts.get('frames', 8)
    W          = opts.get('width',  512)
    H          = opts.get('height', 1024)
    view       = opts.get('view',   'front')
    save_json  = opts.get('saveJson', False)

    os.makedirs(output_dir, exist_ok=True)
    reset_scene()

    import_fbx(char_path)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        print('RESULT:' + json.dumps({'error': 'No armature found'})); sys.exit(1)
    arm = arms[0]
    print(f'[blender] bones: {len(arm.pose.bones)}', flush=True)

    if anim_path:
        before = {o.name for o in bpy.data.objects if o.type == 'ARMATURE'}
        import_fbx(anim_path)
        new_arms = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name not in before]
        if new_arms:
            aa = new_arms[0]
            if aa.animation_data and aa.animation_data.action:
                if not arm.animation_data:
                    arm.animation_data_create()
                arm.animation_data.action = aa.animation_data.action
            else:
                bpy.data.objects.remove(aa, do_unlink=True)
                print('RESULT:' + json.dumps({'error': 'animFbx has no clips'})); sys.exit(1)
            bpy.data.objects.remove(aa, do_unlink=True)

    scene_fps = bpy.context.scene.render.fps
    action    = arm.animation_data.action if arm.animation_data else None
    if action:
        f_start  = int(action.frame_range[0])
        f_end    = int(action.frame_range[1])
        duration = (f_end - f_start) / scene_fps
    else:
        f_start = f_end = 1; duration = 0.0

    print(f'[blender] dur={duration:.3f}s  fps={scene_fps}', flush=True)

    if fps and duration > 0:
        total      = math.ceil(duration * fps)
        frame_list = [f_start + (i / fps) * scene_fps for i in range(total)]
    else:
        total      = n_frames
        span       = f_end - f_start
        frame_list = [f_start + (i / max(total-1, 1)) * span for i in range(total)]

    # Global normalisation
    N      = min(40, total)
    sample = [frame_list[int(i*(total-1)/max(N-1,1))] for i in range(N)]
    to_screen = compute_global_norm(arm, sample, view, W, H)
    set_frame(frame_list[0])

    # Render
    pad         = len(str(total - 1))
    frame_paths = []
    json_paths  = []

    for i, fr in enumerate(frame_list):
        set_frame(fr)
        kps    = compute_keypoints(arm, to_screen)
        canvas = render_openpose(kps, W, H)
        stem   = f"frame_{str(i).zfill(pad)}"

        png = os.path.join(output_dir, f"{stem}.png")
        save_png(canvas, png)
        frame_paths.append(png)

        if save_json:
            jp = os.path.join(output_dir, f"{stem}_keypoints.json")
            with open(jp, 'w') as f: json.dump(make_json(kps), f, indent=2)
            json_paths.append(jp)

        if i % 10 == 0 or i == total-1:
            t = (fr - f_start) / scene_fps
            print(f'[blender] frame {i+1}/{total} t={t:.3f}s', flush=True)

    print('RESULT:' + json.dumps({
        'framePaths': frame_paths, 'jsonPaths': json_paths,
        'frameWidth': W, 'frameHeight': H, 'duration': duration,
    }))

if __name__ == '__main__':
    main()
