import math
import os
import sys
import bpy
import bmesh
import mathutils
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enemy_rig_utils import (
    RUNTIME_MODELS_DIR,
    SCRATCH_DIR,
    assign_weights_dict,
    backup_original_glb,
    build_nla_action,
    clean_imported_gltf,
    clear_pose,
    closest_param_on_polyline,
    decimate_mesh,
    export_runtime_glb,
    find_part_images,
    resize_image_rgba,
    render_pose_verification_sheet,
    rotate_bone_world,
    smoothstep,
    sync_seam_weights,
    triangulate_mesh,
    wire_pbr_material,
)

# Serpentine centerline from Torso rear -> coiled anaconda tail tip
TAIL_WAYPOINTS = [
    (0.00, 0.16, 0.37),
    (-0.06, 0.33, 0.28),
    (-0.14, 0.40, 0.17),
    (-0.25, 0.33, 0.12),
    (-0.27, 0.14, 0.12),
    (-0.17, -0.02, 0.12),
    (0.00, -0.07, 0.12),
    (0.16, -0.05, 0.13),
    (0.32, -0.03, 0.14),
]

ARM_L_WAYPOINTS = [
    (0.12, -0.17, 0.40),
    (0.18, -0.22, 0.20),
    (0.22, -0.25, 0.08),
    (0.27, -0.18, 0.00),
]

ARM_R_WAYPOINTS = [
    (-0.15, -0.17, 0.40),
    (-0.19, -0.21, 0.20),
    (-0.21, -0.31, 0.07),
    (-0.27, -0.24, 0.00),
]


def remove_static_smoke_geometry(mesh_obj):
    """Remove baked static green/yellow smoke plume geometry from dorsal vents while preserving the entire body."""
    mat = mesh_obj.material_slots[0].material
    base_img, _, _ = find_part_images(mat)
    iw, ih = base_img.size
    px = np.empty(iw * ih * 4, dtype=np.float32)
    base_img.pixels.foreach_get(px)
    rgba = px.reshape((ih, iw, 4))

    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    # Weld vertices first (keeps per-loop UVs intact!) so island detection sees the true body vs floating smoke bits
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    uv_lay = bm.loops.layers.uv.active
    vert_uv = {}
    for f in bm.faces:
        for lp in f.loops:
            if lp.vert.index not in vert_uv and uv_lay:
                vert_uv[lp.vert.index] = (lp[uv_lay].uv.x, lp[uv_lay].uv.y)

    # Identify frozen green-yellow smoke vertices on dorsal upper chimney area
    smoke_verts = set()
    for v in bm.verts:
        co = v.co
        if co.z < 0.505:
            continue
        uv = vert_uv.get(v.index)
        is_smoke_col = False
        if uv is not None:
            ix = max(0, min(iw - 1, int(uv[0] * (iw - 1))))
            iy = max(0, min(ih - 1, int(uv[1] * (ih - 1))))
            r, g, b, _ = rgba[iy, ix]
            is_smoke_col = (g > 0.27 and g > b * 1.40 and r < g * 1.40)
        if is_smoke_col and co.y > -0.18:
            smoke_verts.add(v.index)
        elif co.z > 0.625 and co.y > -0.08:
            smoke_verts.add(v.index)

    # Delete only faces touching smoke vertices
    faces_del = [f for f in bm.faces if any(v.index in smoke_verts for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces_del, context="FACES")

    # Remove only small disconnected floating smoke fragments (< 120 verts, keeping largest main body)
    bm.verts.ensure_lookup_table()
    seen = set()
    islands = []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp = []
        st = [v]
        seen.add(v.index)
        while st:
            cur = st.pop()
            comp.append(cur)
            for e in cur.link_edges:
                nb = e.other_vert(cur)
                if nb.index not in seen:
                    seen.add(nb.index)
                    st.append(nb)
        islands.append(comp)
    islands.sort(key=len, reverse=True)
    if len(islands) > 1:
        drop_verts = [v for comp in islands[1:] if len(comp) < 120 for v in comp]
        if drop_verts:
            bmesh.ops.delete(bm, geom=drop_verts, context="VERTS")

    # Identify a dark organic cavity texel from the source image so vent caps match shadowed interior flesh (never bright emissive orange)
    dark_uv = None
    if uv_lay is not None:
        best_score = 999.0
        for f in bm.faces:
            for lp in f.loops:
                u, v = lp[uv_lay].uv.x % 1.0, lp[uv_lay].uv.y % 1.0
                ix = max(0, min(iw - 1, int(u * (iw - 1))))
                iy = max(0, min(ih - 1, int(v * (ih - 1))))
                r, g, b, _ = rgba[iy, ix]
                if r < 0.30 and g < 0.16 and b < 0.18:
                    score = float(r + g + b)
                    if 0.04 < score < best_score:
                        best_score = score
                        dark_uv = lp[uv_lay].uv.copy()

    # Cap chimney boundary loops cleanly with a recessed concave throat (-Z) and dark organic cavity UV
    bm.edges.ensure_lookup_table()
    border_edges = [e for e in bm.edges if e.is_boundary]
    if border_edges:
        edge_set = set(border_edges)
        while edge_set:
            start_e = next(iter(edge_set))
            comp_edges = []
            stack = [start_e]
            edge_set.remove(start_e)
            while stack:
                ce = stack.pop()
                comp_edges.append(ce)
                for cv in ce.verts:
                    for ne in cv.link_edges:
                        if ne in edge_set:
                            edge_set.remove(ne)
                            stack.append(ne)
            if len(comp_edges) < 3:
                continue
            comp_verts = list({v for e in comp_edges for v in e.verts})
            center_co = sum((v.co for v in comp_verts), mathutils.Vector((0.0, 0.0, 0.0))) / float(len(comp_verts))
            center_co.z -= 0.048
            vc = bm.verts.new(center_co)
            uv_sample = dark_uv if dark_uv is not None else mathutils.Vector((0.08, 0.08))
            for e in comp_edges:
                try:
                    nf = bm.faces.new((e.verts[0], e.verts[1], vc))
                    if uv_lay:
                        for lp in nf.loops:
                            lp[uv_lay].uv = uv_sample
                except ValueError:
                    pass

    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh_obj.data)
    bm.free()
    mesh_obj.data.polygons.foreach_set("use_smooth", [True] * len(mesh_obj.data.polygons))
    mesh_obj.data.validate(clean_customdata=False)
    mesh_obj.data.update()


def slythven_emissive(rgba):
    r, g, b = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
    bio_green = (g > 0.34) & (g > b * 1.40)
    amber_organ = (r > 0.56) & (g > 0.28) & (g < r * 0.85) & (b < 0.22)
    em = np.zeros_like(rgba)
    em[bio_green, 0] = r[bio_green] * 0.45
    em[bio_green, 1] = np.clip(g[bio_green] * 1.55, 0.0, 1.0)
    em[bio_green, 2] = b[bio_green] * 0.30
    em[amber_organ, 0] = np.clip(r[amber_organ] * 1.25, 0.0, 1.0)
    em[amber_organ, 1] = np.clip(g[amber_organ] * 0.90, 0.0, 1.0)
    em[amber_organ, 2] = b[amber_organ] * 0.20
    em[:, :, 3] = 1.0
    return em


def build_armature():
    arm_data = bpy.data.armatures.new("Slythven_ArmatureData")
    arm_obj = bpy.data.objects.new("Slythven_Armature", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def add_b(name, parent, head, tail):
        b = eb.new(name)
        if parent:
            b.parent = eb[parent]
        b.use_connect = False
        b.head = mathutils.Vector(head)
        b.tail = mathutils.Vector(tail)
        return b

    add_b("Root", None, (0.0, 0.0, 0.0), (0.0, -0.18, 0.0))
    add_b("Torso_Main", "Root", (0.0, 0.08, 0.38), (0.0, -0.14, 0.45))
    add_b("Neck_01", "Torso_Main", (0.0, -0.14, 0.45), (0.0, -0.25, 0.47))
    add_b("Head", "Neck_01", (0.0, -0.25, 0.47), (0.0, -0.40, 0.45))

    # Independent biological exhaust organs + anatomical socket tips (left=+X, right=-X in Blender import)
    add_b("Exhaust_L", "Torso_Main", (0.14, 0.05, 0.42), (0.15, 0.06, 0.51))
    add_b("Exhaust_Socket_L", "Exhaust_L", (0.15, 0.06, 0.51), (0.16, 0.07, 0.58))
    add_b("Exhaust_R", "Torso_Main", (-0.15, 0.05, 0.42), (-0.16, 0.06, 0.51))
    add_b("Exhaust_Socket_R", "Exhaust_R", (-0.16, 0.06, 0.51), (-0.17, 0.07, 0.58))

    # Two independent 4-bone forelimbs (NO hind legs)
    for pref, pts in [("Arm_L", ARM_L_WAYPOINTS), ("Arm_R", ARM_R_WAYPOINTS)]:
        sh = pts[0]
        add_b(f"{pref}_Shoulder", "Torso_Main", (sh[0] * 0.65, sh[1] + 0.03, sh[2] + 0.02), sh)
        add_b(f"{pref}_Upper", f"{pref}_Shoulder", pts[0], pts[1])
        add_b(f"{pref}_Forearm", f"{pref}_Upper", pts[1], pts[2])
        add_b(f"{pref}_Claw", f"{pref}_Forearm", pts[2], pts[3])

    # 8-Bone Muscular Serpentine Anaconda Rear Body
    prev = "Torso_Main"
    for i in range(8):
        bname = f"Tail_{i + 1:02d}"
        add_b(bname, prev, TAIL_WAYPOINTS[i], TAIL_WAYPOINTS[i + 1])
        prev = bname

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


def skin_mesh_topological(mesh_obj):
    """Separate front limbs from coiled serpentine tail using welded-bmesh geodesic labels so coils never cross-bleed."""
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00025)
    bm.verts.ensure_lookup_table()

    # Label vertices via shortest topological hop from anatomical anchors
    # Labels: 0=Torso/Head, 1=Arm_L, 2=Arm_R, 3=Serpentine_Tail
    labels = {}
    q = []

    for v in bm.verts:
        co = v.co
        # Arm_L hand / lower forearm clearly below torso & +X front
        if co.x > 0.14 and co.y < -0.10 and co.z < 0.26:
            labels[v.index] = (1, 0)
            q.append((v.index, 1, 0))
        # Arm_R hand / lower forearm
        elif co.x < -0.14 and co.y < -0.14 and co.z < 0.26:
            labels[v.index] = (2, 0)
            q.append((v.index, 2, 0))
        # Serpentine rear coil clearly on +Y or far +X rear tail tip
        elif co.y > 0.24 or (co.x > 0.12 and co.y > -0.10 and co.z < 0.22):
            labels[v.index] = (3, 0)
            q.append((v.index, 3, 0))
        # Upper head/neck/chest core stops arm/tail flood from crossing torso
        elif co.z > 0.34 or (abs(co.x) < 0.12 and co.y < -0.10 and co.z > 0.19):
            labels[v.index] = (0, 0)
            q.append((v.index, 0, 0))

    # Multi-source BFS on welded mesh stops arm & tail labels at torso boundary (0)
    head_i = 0
    while head_i < len(q):
        vi, lbl, dist_h = q[head_i]
        head_i += 1
        if lbl == 0 and dist_h >= 6:
            continue
        bv = bm.verts[vi]
        for e in bv.link_edges:
            nb = e.other_vert(bv)
            # Prevent arm labels jumping past shoulder height or tail jumping into chest
            if lbl in (1, 2) and nb.co.z > 0.44:
                continue
            if nb.index not in labels:
                labels[nb.index] = (lbl, dist_h + 1)
                q.append((nb.index, lbl, dist_h + 1))

    kd = mathutils.kdtree.KDTree(len(bm.verts))
    for v in bm.verts:
        kd.insert(v.co, v.index)
    kd.balance()

    arm_l_pts = [mathutils.Vector(p) for p in ARM_L_WAYPOINTS]
    arm_r_pts = [mathutils.Vector(p) for p in ARM_R_WAYPOINTS]
    tail_pts = [mathutils.Vector(p) for p in TAIL_WAYPOINTS]

    exhaust_l = mathutils.Vector((0.15, 0.06, 0.49))
    exhaust_r = mathutils.Vector((-0.16, 0.06, 0.49))

    per_v = []
    for v in mesh_obj.data.vertices:
        co = v.co
        _, bvi, _ = kd.find(co)
        lbl, _ = labels.get(bvi, (0, 0))

        # Check forelimb spatial safety: tail passes near y=-0.07, z=0.12 while arms pass outside z<0.38
        if lbl == 1:
            s = closest_param_on_polyline(co, arm_l_pts)
            wd = {
                "Arm_L_Shoulder": math.exp(-((s - 0.0) / 0.55) ** 2),
                "Arm_L_Upper": math.exp(-((s - 0.55) / 0.62) ** 2),
                "Arm_L_Forearm": math.exp(-((s - 1.55) / 0.62) ** 2),
                "Arm_L_Claw": math.exp(-((s - 2.65) / 0.60) ** 2),
            }
            if s < 0.35:
                t = (0.35 - s) / 0.35 * 0.45
                wd = {k: val * (1.0 - t) for k, val in wd.items()}
                wd["Torso_Main"] = t
            per_v.append(wd)
            continue

        if lbl == 2:
            s = closest_param_on_polyline(co, arm_r_pts)
            wd = {
                "Arm_R_Shoulder": math.exp(-((s - 0.0) / 0.55) ** 2),
                "Arm_R_Upper": math.exp(-((s - 0.55) / 0.62) ** 2),
                "Arm_R_Forearm": math.exp(-((s - 1.55) / 0.62) ** 2),
                "Arm_R_Claw": math.exp(-((s - 2.65) / 0.60) ** 2),
            }
            if s < 0.35:
                t = (0.35 - s) / 0.35 * 0.45
                wd = {k: val * (1.0 - t) for k, val in wd.items()}
                wd["Torso_Main"] = t
            per_v.append(wd)
            continue

        if lbl == 3 or co.y > 0.17 or (co.z < 0.21 and abs(co.x) < 0.16):
            s = closest_param_on_polyline(co, tail_pts)
            wd = {}
            for ti in range(8):
                wd[f"Tail_{ti + 1:02d}"] = math.exp(-((s - (ti + 0.5)) / 0.72) ** 2)
            if s < 0.55:
                anchor = ((0.55 - s) / 0.55) * 0.55
                wd = {k: val * (1.0 - anchor) for k, val in wd.items()}
                wd["Torso_Main"] = anchor
            per_v.append(wd)
            continue

        # Torso, Neck, Head & Two Dorsal Exhaust Organs
        d_el = (co - exhaust_l).length
        d_er = (co - exhaust_r).length
        if d_el < 0.11 and co.z > 0.40:
            ew = max(0.0, min(1.0, (0.11 - d_el) / 0.065))
            per_v.append({"Exhaust_L": ew, "Torso_Main": 1.0 - ew})
        elif d_er < 0.11 and co.z > 0.40:
            ew = max(0.0, min(1.0, (0.11 - d_er) / 0.065))
            per_v.append({"Exhaust_R": ew, "Torso_Main": 1.0 - ew})
        else:
            w_torso = math.exp(-((co.y - 0.02) / 0.18) ** 2)
            w_neck = math.exp(-((co.y - (-0.19)) / 0.11) ** 2)
            w_head = math.exp(-((co.y - (-0.34)) / 0.12) ** 2)
            per_v.append({"Torso_Main": w_torso, "Neck_01": w_neck, "Head": w_head})

    bm.free()
    assign_weights_dict(mesh_obj, per_v)
    sync_seam_weights(mesh_obj)


def pose_forelimbs(arm, reach_l=0.0, lift_l=0.0, reach_r=0.0, lift_r=0.0, brace=0.0):
    for pref, reach, lift, side in [("Arm_L", reach_l, lift_l, 1.0), ("Arm_R", reach_r, lift_r, -1.0)]:
        rotate_bone_world(arm, f"{pref}_Shoulder", rx_deg=-reach * 14.0, ry_deg=-(lift * 10.0 - brace * 14.0) * side, rz_deg=reach * 18.0 * side)
        rotate_bone_world(arm, f"{pref}_Upper", rx_deg=-reach * 26.0, ry_deg=-(lift * 24.0 - brace * 18.0) * side, rz_deg=reach * 16.0 * side)
        rotate_bone_world(arm, f"{pref}_Forearm", rx_deg=reach * 18.0, ry_deg=(lift * 22.0 + brace * 14.0) * side)
        rotate_bone_world(arm, f"{pref}_Claw", rx_deg=reach * 12.0 - 10.0 * lift)


def pose_serpentine_tail(arm, wave_phase: float, wave_amp: float, yaw_bias_deg: float = 0.0):
    for i in range(8):
        prog = (i + 1) / 8.0
        yaw = yaw_bias_deg * (0.25 + 0.14 * i) + wave_amp * math.sin(wave_phase - i * 0.68) * (0.4 + 0.85 * prog)
        pitch = wave_amp * 0.25 * math.cos(wave_phase - i * 0.68)
        rotate_bone_world(arm, f"Tail_{i + 1:02d}", rx_deg=pitch, rz_deg=yaw)


def author_animations(arm_obj):
    fps = 30.0
    loc_b = ("Torso_Main",)
    scale_b = ("Exhaust_L", "Exhaust_R", "Torso_Main")

    def sample_spawn(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        arm.pose.bones["Torso_Main"].location = (0.0, 0.04 * (1.0 - t), -0.26 * (1.0 - t))
        rotate_bone_world(arm, "Torso_Main", rx_deg=24.0 * (1.0 - t))
        pose_forelimbs(arm, reach_l=0.6 * (1.0 - t), reach_r=0.6 * (1.0 - t), brace=0.8 * (1.0 - t))
        pose_serpentine_tail(arm, u * math.tau, 8.0)

    def sample_idle(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        b = math.sin(ph)
        arm.pose.bones["Torso_Main"].location = (0.0, 0.0, 0.015 * b)
        rotate_bone_world(arm, "Torso_Main", rx_deg=-3.0 * b)
        rotate_bone_world(arm, "Neck_01", rx_deg=4.0 * b, rz_deg=4.0 * math.cos(ph))
        rotate_bone_world(arm, "Head", rx_deg=-3.0 * b, rz_deg=6.0 * math.cos(ph))
        es = 1.0 + 0.06 * math.sin(ph * 2.0)
        arm.pose.bones["Exhaust_L"].scale = (es, es, 1.0 + 0.08 * math.sin(ph * 2.0))
        arm.pose.bones["Exhaust_R"].scale = (es, es, 1.0 + 0.08 * math.sin(ph * 2.0))
        pose_serpentine_tail(arm, ph, 5.5)

    def sample_walk(arm, u):
        clear_pose(arm)
        # Forelimbs pull the heavy serpentine body forward in alternating power strokes
        ph = u * math.tau
        s, c = math.sin(ph), math.cos(ph)
        arm.pose.bones["Torso_Main"].location = (0.022 * c, -0.028 * abs(s), -0.016 + 0.022 * abs(s))
        rotate_bone_world(arm, "Torso_Main", rx_deg=-6.0 + 5.0 * abs(c), ry_deg=6.0 * s, rz_deg=-8.0 * s)
        rotate_bone_world(arm, "Neck_01", rz_deg=5.0 * s)
        rotate_bone_world(arm, "Head", rz_deg=4.0 * s)
        pose_forelimbs(arm, reach_l=s * 1.15, lift_l=max(0.0, c), reach_r=-s * 1.15, lift_r=max(0.0, -c))
        pose_serpentine_tail(arm, ph, 13.0)

    def sample_turn(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        s, c = math.sin(ph), math.cos(ph)
        arm.pose.bones["Torso_Main"].location = (0.0, 0.0, 0.015 * abs(s))
        rotate_bone_world(arm, "Torso_Main", ry_deg=7.0 * s)
        pose_forelimbs(arm, reach_l=0.6 * s, lift_l=max(0.0, c) * 0.7, reach_r=-0.6 * s, lift_r=max(0.0, -c) * 0.7, brace=0.25)
        pose_serpentine_tail(arm, ph, 10.0, yaw_bias_deg=12.0 * s)

    def sample_attack_prep(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        # Stops, plants wide front limbs firmly on ground, swells dorsal exhaust organs
        arm.pose.bones["Torso_Main"].location = (0.0, 0.03 * t, -0.055 * t)
        rotate_bone_world(arm, "Torso_Main", rx_deg=14.0 * t)
        rotate_bone_world(arm, "Neck_01", rx_deg=-10.0 * t)
        rotate_bone_world(arm, "Head", rx_deg=-10.0 * t)
        pose_forelimbs(arm, brace=0.85 * t)
        sw = 1.0 + 0.34 * t
        arm.pose.bones["Exhaust_L"].scale = (sw, sw, 1.0 + 0.42 * t)
        arm.pose.bones["Exhaust_R"].scale = (sw, sw, 1.0 + 0.42 * t)
        rotate_bone_world(arm, "Exhaust_L", ry_deg=-10.0 * t)
        rotate_bone_world(arm, "Exhaust_R", ry_deg=10.0 * t)
        pose_serpentine_tail(arm, u * math.pi, 7.0)

    def sample_attack_exec(arm, u):
        clear_pose(arm)
        ph = u * math.tau * 2.0
        pump = 0.5 + 0.5 * math.sin(ph)
        # Sustained braced toxic vent exhalation with rhythmic thoracic compression
        arm.pose.bones["Torso_Main"].location = (0.0, 0.025 - 0.03 * pump, -0.05 + 0.025 * pump)
        rotate_bone_world(arm, "Torso_Main", rx_deg=14.0 - 10.0 * pump)
        rotate_bone_world(arm, "Neck_01", rx_deg=-8.0 + 6.0 * pump)
        pose_forelimbs(arm, brace=0.90)
        vw = 1.24 + 0.16 * math.sin(ph)
        arm.pose.bones["Exhaust_L"].scale = (vw, vw, 1.32 + 0.18 * math.sin(ph))
        arm.pose.bones["Exhaust_R"].scale = (vw, vw, 1.32 + 0.18 * math.sin(ph))
        rotate_bone_world(arm, "Exhaust_L", ry_deg=-14.0 + 6.0 * pump)
        rotate_bone_world(arm, "Exhaust_R", ry_deg=14.0 - 6.0 * pump)
        pose_serpentine_tail(arm, u * math.tau, 9.0)

    def sample_attack_recover(arm, u):
        clear_pose(arm)
        t = 1.0 - smoothstep(u)
        arm.pose.bones["Torso_Main"].location = (0.0, 0.02 * t, -0.04 * t)
        rotate_bone_world(arm, "Torso_Main", rx_deg=10.0 * t)
        pose_forelimbs(arm, brace=0.7 * t)
        sw = 1.0 + 0.24 * t
        arm.pose.bones["Exhaust_L"].scale = (sw, sw, sw)
        arm.pose.bones["Exhaust_R"].scale = (sw, sw, sw)
        pose_serpentine_tail(arm, u * math.pi, 6.0)

    def sample_hit(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.pi)
        arm.pose.bones["Torso_Main"].location = (0.0, 0.04 * s, 0.03 * s)
        rotate_bone_world(arm, "Torso_Main", rx_deg=15.0 * s, ry_deg=10.0 * s)
        rotate_bone_world(arm, "Head", rx_deg=14.0 * s)
        pose_serpentine_tail(arm, u * math.pi, 10.0)

    def sample_death(arm, u):
        clear_pose(arm)
        e = smoothstep(min(1.0, u / 0.80))
        arm.pose.bones["Torso_Main"].location = (0.0, 0.0, -0.22 * e)
        rotate_bone_world(arm, "Torso_Main", rx_deg=18.0 * e, ry_deg=24.0 * e)
        rotate_bone_world(arm, "Neck_01", rx_deg=22.0 * e)
        pose_forelimbs(arm, brace=0.95 * e)
        pose_serpentine_tail(arm, 0.4, 4.0)

    build_nla_action(arm_obj, "Spawn", 0.90, fps, sample_spawn, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Idle", 2.40, fps, sample_idle, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Walk", 0.92, fps, sample_walk, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Turn", 0.80, fps, sample_turn, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_Prep", 0.55, fps, sample_attack_prep, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_Exec", 0.85, fps, sample_attack_exec, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_Recover", 0.50, fps, sample_attack_recover, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Hit_React", 0.24, fps, sample_hit, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Death", 1.05, fps, sample_death, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    clear_pose(arm_obj)


def main():
    src = backup_original_glb("Slythven.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = clean_imported_gltf()
    mesh_obj = max(meshes, key=lambda o: len(o.data.polygons))
    mesh_obj.name = "Slythven_Mesh"
    mesh_obj.data.name = "Slythven_MeshData"

    # 1. Remove baked static green/yellow smoke plume geometry safely and cap vent rims
    remove_static_smoke_geometry(mesh_obj)

    # 2. Downsize 4096 basecolor -> 2048 & normal -> 1024 + generate Emissive map for ribs/vents
    mat = mesh_obj.material_slots[0].material
    mat.name = "Slythven_Mat"
    b_im, _, n_im = find_part_images(mat)
    b_2k, _ = resize_image_rgba(b_im, 2048, 2048, "Slythven_BaseColor", "sRGB")
    n_1k, _ = resize_image_rgba(n_im, 1024, 1024, "Slythven_Normal", "Non-Color")
    _, em_src = resize_image_rgba(b_im, 1024, 1024, "_tmp_slythven_em_src", "sRGB")
    em_arr = slythven_emissive(em_src)
    em_im = bpy.data.images.new("Slythven_Emissive", width=1024, height=1024, alpha=False)
    em_im.colorspace_settings.name = "sRGB"
    em_im.pixels.foreach_set(em_arr.ravel())
    em_im.pack()
    wire_pbr_material(mat, b_2k, norm_img=n_1k, em_img=em_im, roughness_val=0.52, metallic_val=0.06, normal_strength=0.72, emission_strength=1.35)

    # 3. Decimate to crisp game-ready ~8,500 tris
    decimate_mesh(mesh_obj, 8500.0 / max(1, len(mesh_obj.data.polygons)))
    triangulate_mesh(mesh_obj)
    mesh_obj.data.validate(clean_customdata=False)

    # 4. Plant lowest forelimb claws flush to z=0.000 smoothly
    min_z = min(v.co.z for v in mesh_obj.data.vertices)
    if abs(min_z) > 0.0005:
        for v in mesh_obj.data.vertices:
            v.co.z -= min_z
        mesh_obj.data.update()

    arm_obj = build_armature()
    skin_mesh_topological(mesh_obj)

    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj

    def pose_clean_vents():
        clear_pose(arm_obj)

    def pose_haul():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Torso_Main", rx_deg=-6.0, rz_deg=-10.0)
        pose_forelimbs(arm_obj, reach_l=1.1, lift_l=0.9, reach_r=-0.9, lift_r=0.0)
        pose_serpentine_tail(arm_obj, 1.4, 14.0)

    def pose_exhale():
        clear_pose(arm_obj)
        arm_obj.pose.bones["Torso_Main"].location = (0.0, 0.025, -0.05)
        rotate_bone_world(arm_obj, "Torso_Main", rx_deg=12.0)
        pose_forelimbs(arm_obj, brace=0.9)
        arm_obj.pose.bones["Exhaust_L"].scale = (1.35, 1.35, 1.45)
        arm_obj.pose.bones["Exhaust_R"].scale = (1.35, 1.35, 1.45)
        pose_serpentine_tail(arm_obj, 2.5, 10.0)

    def pose_top_tail():
        clear_pose(arm_obj)
        pose_forelimbs(arm_obj, reach_l=-0.6, reach_r=0.8)
        pose_serpentine_tail(arm_obj, 0.5, 15.0, yaw_bias_deg=14.0)

    render_pose_verification_sheet(
        arm_obj,
        os.path.join(SCRATCH_DIR, "verify_slythven.png"),
        [
            ("clean_vents", pose_clean_vents, ((1.10, -0.95, 0.85), (0.0, 0.0, 0.34))),
            ("forelimb_haul", pose_haul, ((-1.15, -0.95, 0.72), (0.0, 0.0, 0.32))),
            ("exhale", pose_exhale, ((0.30, -1.35, 0.80), (0.0, 0.0, 0.34))),
            ("top_tail", pose_top_tail, ((0.10, -0.25, 1.55), (0.0, 0.05, 0.25))),
        ],
    )

    author_animations(arm_obj)
    export_runtime_glb(arm_obj, [mesh_obj], os.path.join(RUNTIME_MODELS_DIR, "slythven_3d.glb"))


if __name__ == "__main__":
    main()
