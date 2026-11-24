import math
import os
import shutil
import bpy
import bmesh
import mathutils
import numpy as np

SRC_GLB = r"C:\Users\yoggn\Downloads\Endo Nine\New Animation\NEW Rift Stalker 3D Model.glb"
PROJECT_ROOT = r"c:\Users\yoggn\Desktop\Ender Nine"
EXPORT_GAME_READY_DIR = os.path.join(PROJECT_ROOT, "exports", "game_ready")
EXPORT_RIGGED_GLB = os.path.join(EXPORT_GAME_READY_DIR, "RiftStalker_Rigged.glb")
EXPORT_BACKUP_GLB = os.path.join(EXPORT_GAME_READY_DIR, "RiftStalker_Rigged_Backup.glb")
EXPORT_RUNTIME_GLB = os.path.join(PROJECT_ROOT, "public", "assets", "models", "rift_stalker_3d.glb")
POSE_SHEET_PATH = (
    r"C:\Users\yoggn\.gemini\antigravity\brain\dd6a0935-cf4d-4669-8438-4787ff8d83ff\scratch\verify_riftstalker_rig_poses.png"
)

# Keep 6 canonical legs (remove tucked redundant inner pair tripo_part_8 and tripo_part_9)
KEPT_LEGS = {
    "tripo_part_5": {
        "prefix": "Leg_Front_L",
        "joints": [(0.075, -0.098, 0.295), (0.112, -0.142, 0.376), (0.188, -0.256, 0.106), (0.152, -0.346, 0.032)],
    },
    "tripo_part_6": {
        "prefix": "Leg_Front_R",
        "joints": [(-0.088, -0.038, 0.340), (-0.125, -0.102, 0.388), (-0.205, -0.182, 0.072), (-0.169, -0.320, 0.036)],
    },
    "tripo_part_3": {
        "prefix": "Leg_MidSlash_L",
        "joints": [(0.062, -0.086, 0.338), (0.212, -0.028, 0.430), (0.405, -0.068, 0.215), (0.413, -0.067, 0.013)],
    },
    "tripo_part_7": {
        "prefix": "Leg_MidSlash_R",
        "joints": [(-0.052, -0.084, 0.408), (-0.198, -0.038, 0.474), (-0.406, -0.014, 0.238), (-0.412, 0.021, 0.000)],
    },
    "tripo_part_4": {
        "prefix": "Leg_Rear_L",
        "joints": [(0.080, 0.032, 0.356), (0.105, 0.014, 0.395), (0.184, 0.146, 0.190), (0.085, 0.158, 0.035)],
    },
    "tripo_part_2": {
        "prefix": "Leg_Rear_R",
        "joints": [(-0.078, 0.038, 0.380), (-0.098, 0.082, 0.425), (-0.185, 0.163, 0.105), (-0.079, 0.203, 0.040)],
    },
}

# Tail centerline waypoints (base -> arch -> forward terminal emitter head)
TAIL_POINTS = [
    (0.000, -0.098, 0.390),  # Tail_01 head
    (-0.004, -0.095, 0.515),  # Tail_02 head
    (-0.007, -0.082, 0.655),  # Tail_03 head
    (-0.007, -0.086, 0.790),  # Tail_04 head
    (-0.007, -0.092, 0.895),  # Tail_05 head
    (-0.007, -0.175, 0.825),  # Tail_Head head
    (-0.008, -0.278, 0.680),  # Tail_LaserEmitter head (tip of predatory terminal head)
    (-0.008, -0.345, 0.655),  # Tail_LaserEmitter tail
]

LEG_ATLAS_W = 3072
LEG_ATLAS_H = 2048
LEG_ATLAS_LAYOUT = {
    "tripo_part_2": (0, 0, 1024, 1024),
    "tripo_part_3": (1024, 0, 1024, 1024),
    "tripo_part_4": (2048, 0, 1024, 1024),
    "tripo_part_5": (0, 1024, 1024, 1024),
    "tripo_part_6": (1024, 1024, 1024, 1024),
    "tripo_part_7": (2048, 1024, 1024, 1024),
}


def find_rs_images(mat):
    base_img = norm_img = rm_img = None
    if not mat or not mat.node_tree:
        return None, None, None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            nm = n.image.name.lower()
            if "normal" in nm:
                norm_img = n.image
            elif "_rm" in nm or "rough" in nm or "metal" in nm:
                rm_img = n.image
            elif "basecolor" in nm:
                base_img = n.image
    if base_img is None:
        for l in mat.node_tree.links:
            if l.to_node.type == "BSDF_PRINCIPLED" and l.to_socket.name == "Base Color" and l.from_node.type == "TEX_IMAGE":
                base_img = l.from_node.image
    return base_img, rm_img, norm_img


def make_emissive_image(base_img, name, out_size=1024):
    w, h = base_img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    base_img.pixels.foreach_get(arr)
    rgba = arr.reshape((h, w, 4))
    step_y = max(1, h // out_size)
    step_x = max(1, w // out_size)
    sub = rgba[::step_y, ::step_x, :]
    sh, sw, _ = sub.shape
    r, g, b = sub[:, :, 0], sub[:, :, 1], sub[:, :, 2]

    cyan_mask = (b > 0.34) & (g > 0.26) & (b > r * 1.32)
    red_mask = (r > 0.30) & (r > g * 1.68) & (r > b * 1.45)

    em = np.zeros((sh, sw, 4), dtype=np.float32)
    em[cyan_mask, 0] = np.clip(r[cyan_mask] * 0.6, 0.0, 1.0)
    em[cyan_mask, 1] = np.clip(g[cyan_mask] * 1.35, 0.0, 1.0)
    em[cyan_mask, 2] = np.clip(b[cyan_mask] * 1.50, 0.0, 1.0)
    em[red_mask, 0] = np.clip(r[red_mask] * 1.65, 0.0, 1.0)
    em[red_mask, 1] = np.clip(g[red_mask] * 0.35, 0.0, 1.0)
    em[red_mask, 2] = np.clip(b[red_mask] * 0.45, 0.0, 1.0)
    em[:, :, 3] = 1.0

    im = bpy.data.images.new(name, width=sw, height=sh, alpha=False)
    im.colorspace_settings.name = "sRGB"
    im.pixels.foreach_set(em.ravel())
    im.pack()
    return im


def wire_rs_material(mat, base_img, rm_img, norm_img, em_img=None, normal_strength=0.70, emission_strength=1.35):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (450, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (120, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    if base_img:
        base_img.colorspace_settings.name = "sRGB"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = base_img
        t.location = (-360, 240)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])

    if rm_img:
        rm_img.colorspace_settings.name = "Non-Color"
        t_rm = nt.nodes.new("ShaderNodeTexImage")
        t_rm.image = rm_img
        t_rm.location = (-440, 20)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-180, 20)
        nt.links.new(t_rm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    if norm_img:
        norm_img.colorspace_settings.name = "Non-Color"
        t_n = nt.nodes.new("ShaderNodeTexImage")
        t_n.image = norm_img
        t_n.location = (-440, -200)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        nmap.location = (-160, -200)
        nt.links.new(t_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    if em_img:
        em_img.colorspace_settings.name = "sRGB"
        t_e = nt.nodes.new("ShaderNodeTexImage")
        t_e.image = em_img
        t_e.location = (-360, -400)
        nt.links.new(t_e.outputs["Color"], bsdf.inputs["Emission Color"])
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength


def pack_legs_atlas(meshes_by_name):
    """Pack 6 leg parts losslessly into 1 BaseColor/RM/Normal atlas (zero UV seam loss)."""
    base_buf = np.zeros((LEG_ATLAS_H, LEG_ATLAS_W, 4), dtype=np.float32)
    # RM + Normal at half-res 1536x1024 to preserve native 512x512 per leg without upscaling memory bloat
    HALF_W, HALF_H = 1536, 1024
    rm_buf = np.zeros((HALF_H, HALF_W, 4), dtype=np.float32)
    rm_buf[:, :, 1] = 0.5
    rm_buf[:, :, 3] = 1.0
    norm_buf = np.zeros((HALF_H, HALF_W, 4), dtype=np.float32)
    norm_buf[:, :, 0] = 0.5
    norm_buf[:, :, 1] = 0.5
    norm_buf[:, :, 2] = 1.0
    norm_buf[:, :, 3] = 1.0

    for pname, (tx, ty, tw, th) in LEG_ATLAS_LAYOUT.items():
        obj = meshes_by_name[pname]
        mat = obj.material_slots[0].material if obj.material_slots else None
        base_img, rm_img, norm_img = find_rs_images(mat)

        if base_img:
            bw, bh = base_img.size
            arr = np.empty(bw * bh * 4, dtype=np.float32)
            base_img.pixels.foreach_get(arr)
            arr = arr.reshape((bh, bw, 4))
            base_buf[ty : ty + min(th, bh), tx : tx + min(tw, bw), :] = arr[: min(th, bh), : min(tw, bw), :]

        hx, hy, hw, hh = tx // 2, ty // 2, tw // 2, th // 2
        if rm_img:
            rw, rh = rm_img.size
            arr = np.empty(rw * rh * 4, dtype=np.float32)
            rm_img.pixels.foreach_get(arr)
            arr = arr.reshape((rh, rw, 4))
            rm_buf[hy : hy + min(hh, rh), hx : hx + min(hw, rw), :] = arr[: min(hh, rh), : min(hw, rw), :]

        if norm_img:
            nw, nh = norm_img.size
            arr = np.empty(nw * nh * 4, dtype=np.float32)
            norm_img.pixels.foreach_get(arr)
            arr = arr.reshape((nh, nw, 4))
            norm_buf[hy : hy + min(hh, nh), hx : hx + min(hw, nw), :] = arr[: min(hh, nh), : min(hw, nw), :]

        uv_layer = obj.data.uv_layers.active
        if uv_layer:
            pad_u = 2.0 / LEG_ATLAS_W
            pad_v = 2.0 / LEG_ATLAS_H
            u0 = tx / LEG_ATLAS_W + pad_u
            v0 = ty / LEG_ATLAS_H + pad_v
            uspan = tw / LEG_ATLAS_W - 2.0 * pad_u
            vspan = th / LEG_ATLAS_H - 2.0 * pad_v
            for loop_uv in uv_layer.data:
                u = max(0.0, min(1.0, loop_uv.uv.x))
                v = max(0.0, min(1.0, loop_uv.uv.y))
                loop_uv.uv.x = u0 + u * uspan
                loop_uv.uv.y = v0 + v * vspan

    im_b = bpy.data.images.new("RiftStalker_Legs_BaseColor", width=LEG_ATLAS_W, height=LEG_ATLAS_H, alpha=False)
    im_b.pixels.foreach_set(base_buf.ravel())
    im_b.pack()

    im_rm = bpy.data.images.new("RiftStalker_Legs_RM", width=HALF_W, height=HALF_H, alpha=False)
    im_rm.colorspace_settings.name = "Non-Color"
    im_rm.pixels.foreach_set(rm_buf.ravel())
    im_rm.pack()

    im_n = bpy.data.images.new("RiftStalker_Legs_Normal", width=HALF_W, height=HALF_H, alpha=False)
    im_n.colorspace_settings.name = "Non-Color"
    im_n.pixels.foreach_set(norm_buf.ravel())
    im_n.pack()

    mat_legs = bpy.data.materials.new("RiftStalker_Legs_Mat")
    wire_rs_material(mat_legs, im_b, im_rm, im_n, None, normal_strength=0.68)
    for pname in LEG_ATLAS_LAYOUT:
        obj = meshes_by_name[pname]
        obj.data.materials.clear()
        obj.data.materials.append(mat_legs)
    return mat_legs


def build_rift_stalker_armature():
    arm_data = bpy.data.armatures.new("RiftStalker_ArmatureData")
    arm_obj = bpy.data.objects.new("RiftStalker_Armature", arm_data)
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

    # Root & Main Body
    add_b("Root", None, (0.0, 0.0, 0.0), (0.0, -0.18, 0.0))
    add_b("Body_COG", "Root", (0.0, 0.0, 0.29), (0.0, -0.09, 0.31))
    add_b("Thorax_Front", "Body_COG", (0.0, -0.09, 0.31), (0.0, -0.29, 0.31))
    add_b("Abdomen_Rear", "Body_COG", (0.0, 0.00, 0.30), (0.0, 0.25, 0.34))

    # 6 Independent 4-Bone Leg Chains
    for pname, info in KEPT_LEGS.items():
        pref = info["prefix"]
        p0, p1, p2, p3 = [mathutils.Vector(v) for v in info["joints"]]
        p_coxa_tail = p0.lerp(p1, 0.72)
        add_b(f"{pref}_Coxa", "Body_COG", p0, p_coxa_tail)
        add_b(f"{pref}_Femur", f"{pref}_Coxa", p1, p2)
        p_tibia_tail = p2.lerp(p3, 0.62)
        add_b(f"{pref}_Tibia", f"{pref}_Femur", p2, p_tibia_tail)
        add_b(f"{pref}_Tarsus", f"{pref}_Tibia", p_tibia_tail, p3)

    # 7-Bone Progressive Scorpion Tail + Terminal Laser Emitter
    tail_names = ["Tail_01", "Tail_02", "Tail_03", "Tail_04", "Tail_05", "Tail_Head", "Tail_LaserEmitter"]
    prev_t = "Body_COG"
    for i, tname in enumerate(tail_names):
        add_b(tname, prev_t, TAIL_POINTS[i], TAIL_POINTS[i + 1])
        prev_t = tname

    # Mandibles
    add_b("Mandible_L", "Thorax_Front", (0.065, -0.345, 0.235), (0.082, -0.495, 0.215))
    add_b("Mandible_R", "Thorax_Front", (-0.078, -0.345, 0.235), (-0.095, -0.495, 0.215))

    # 4 Sensory Antennae (2 segments each)
    add_b("Antenna_Upper_L_01", "Thorax_Front", (0.140, -0.335, 0.440), (0.215, -0.415, 0.535))
    add_b("Antenna_Upper_L_02", "Antenna_Upper_L_01", (0.215, -0.415, 0.535), (0.285, -0.490, 0.590))
    add_b("Antenna_Upper_R_01", "Thorax_Front", (-0.155, -0.335, 0.440), (-0.230, -0.415, 0.535))
    add_b("Antenna_Upper_R_02", "Antenna_Upper_R_01", (-0.230, -0.415, 0.535), (-0.300, -0.490, 0.590))

    add_b("Antenna_Lower_L_01", "Thorax_Front", (0.115, -0.315, 0.340), (0.220, -0.435, 0.410))
    add_b("Antenna_Lower_L_02", "Antenna_Lower_L_01", (0.220, -0.435, 0.410), (0.315, -0.550, 0.485))
    add_b("Antenna_Lower_R_01", "Thorax_Front", (-0.130, -0.315, 0.340), (-0.235, -0.435, 0.410))
    add_b("Antenna_Lower_R_02", "Antenna_Lower_R_01", (-0.235, -0.435, 0.410), (-0.330, -0.550, 0.485))

    # 4 Independent Dorsal Crystal Spine Clusters
    add_b("DorsalSpine_FL", "Thorax_Front", (0.095, -0.155, 0.395), (0.125, -0.175, 0.505))
    add_b("DorsalSpine_FR", "Thorax_Front", (-0.110, -0.155, 0.395), (-0.140, -0.175, 0.505))
    add_b("DorsalSpine_RL", "Abdomen_Rear", (0.085, 0.075, 0.395), (0.115, 0.110, 0.505))
    add_b("DorsalSpine_RR", "Abdomen_Rear", (-0.100, 0.075, 0.395), (-0.130, 0.110, 0.505))

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


def closest_param_on_polyline(pt, pts):
    """Return continuous index s in [0, len(pts)-1] closest to pt."""
    best_d2 = 1e12
    best_s = 0.0
    for i in range(len(pts) - 1):
        a = pts[i]
        b = pts[i + 1]
        ab = b - a
        l2 = ab.length_squared
        t = 0.0 if l2 < 1e-10 else max(0.0, min(1.0, (pt - a).dot(ab) / l2))
        proj = a + ab * t
        d2 = (pt - proj).length_squared
        if d2 < best_d2:
            best_d2 = d2
            best_s = i + t
    return best_s


def assign_weights_dict(obj, per_vert):
    obj.vertex_groups.clear()
    vg_map = {}
    for wd in per_vert:
        for bname in wd:
            if bname not in vg_map:
                vg_map[bname] = obj.vertex_groups.new(name=bname)
    for i, wd in enumerate(per_vert):
        tot = sum(w for w in wd.values() if w > 1e-4)
        if tot <= 1e-6:
            continue
        for bname, w in wd.items():
            nw = w / tot
            if nw > 1e-4:
                vg_map[bname].add([i], nw, "REPLACE")


def sync_seam_weights(mesh_obj):
    verts = mesh_obj.data.vertices
    kd = mathutils.kdtree.KDTree(len(verts))
    for i, v in enumerate(verts):
        kd.insert(v.co, i)
    kd.balance()
    seen = [False] * len(verts)
    for i, v in enumerate(verts):
        if seen[i]:
            continue
        cl = [idx for (_, idx, _) in kd.find_range(v.co, 0.00018)]
        for c in cl:
            seen[c] = True
        if len(cl) <= 1:
            continue
        avg = {}
        for c in cl:
            for g in verts[c].groups:
                if g.weight > 1e-5:
                    avg[g.group] = avg.get(g.group, 0.0) + g.weight
        tot = sum(avg.values())
        if tot <= 1e-6:
            continue
        norm = {g: w / tot for g, w in avg.items() if w / tot > 1e-4}
        tot2 = sum(norm.values())
        if tot2 > 1e-6:
            norm = {g: w / tot2 for g, w in norm.items()}
        for c in cl:
            for g in list(verts[c].groups):
                mesh_obj.vertex_groups[g.group].remove([c])
            for g, w in norm.items():
                mesh_obj.vertex_groups[g].add([c], w, "REPLACE")


def skin_rift_stalker(meshes_by_name):
    # 1. Six Isolated Walking/Slashing Legs (0% Cross-Bleed!)
    for pname, info in KEPT_LEGS.items():
        obj = meshes_by_name[pname]
        pref = info["prefix"]
        p0, p1, p2, p3 = [mathutils.Vector(v) for v in info["joints"]]
        p_coxa_end = p0.lerp(p1, 0.72)
        p_ank = p2.lerp(p3, 0.62)
        chain_pts = [p0, p1, p2, p_ank, p3]
        bnames = [f"{pref}_Coxa", f"{pref}_Femur", f"{pref}_Tibia", f"{pref}_Tarsus"]

        per_v = []
        for v in obj.data.vertices:
            s = closest_param_on_polyline(v.co, chain_pts)  # 0..4 -> map onto 4 bones centered at 0.35, 1.5, 2.5, 3.55
            centers = [0.35, 1.50, 2.50, 3.55]
            sigmas = [0.65, 0.65, 0.62, 0.60]
            wd = {}
            for bn, c, sig in zip(bnames, centers, sigmas):
                wd[bn] = math.exp(-((s - c) / sig) ** 2)
            # Innermost socket vertices get minor Body_COG anchor blend only if right next to thorax (< 2.5cm from p0)
            if (v.co - p0).length < 0.030:
                t_root = max(0.0, 1.0 - (v.co - p0).length / 0.030) * 0.25
                wd = {k: val * (1.0 - t_root) for k, val in wd.items()}
                wd["Body_COG"] = t_root
            per_v.append(wd)
        assign_weights_dict(obj, per_v)
        sync_seam_weights(obj)

    # 2. Scorpion Tail & Terminal Head (tripo_part_1 ONLY, 0% Leg Bleed!)
    tail_obj = meshes_by_name["tripo_part_1"]
    t_pts = [mathutils.Vector(p) for p in TAIL_POINTS[:7]]
    t_names = ["Tail_01", "Tail_02", "Tail_03", "Tail_04", "Tail_05", "Tail_Head"]
    per_t = []
    for v in tail_obj.data.vertices:
        s = closest_param_on_polyline(v.co, t_pts)  # 0..6 across 6 segments
        wd = {}
        # Sharp, progressive segmentation (each ring/head stays rigid enough without rubber-banding!)
        for idx, bn in enumerate(t_names):
            center = idx + 0.5 if idx < 5 else 5.45
            sigma = 0.58 if idx < 5 else 0.72
            wd[bn] = math.exp(-((s - center) / sigma) ** 2)
        if s < 0.35:
            anchor = max(0.0, (0.35 - s) / 0.35) * 0.35
            wd = {k: val * (1.0 - anchor) for k, val in wd.items()}
            wd["Body_COG"] = anchor
        per_t.append(wd)
    assign_weights_dict(tail_obj, per_t)
    sync_seam_weights(tail_obj)

    # 3. Main Armored Body + Mandibles + 4 Antennae + 4 Dorsal Crystal Spine Clusters (tripo_part_0)
    body_obj = meshes_by_name["tripo_part_0"]

    # Read vertex UV -> basecolor RGB so we can accurately identify cyan dorsal crystals!
    base_img, _, _ = find_rs_images(body_obj.material_slots[0].material)
    bw, bh = base_img.size
    px_arr = np.empty(bw * bh * 4, dtype=np.float32)
    base_img.pixels.foreach_get(px_arr)
    px_rgba = px_arr.reshape((bh, bw, 4))

    uv_layer = body_obj.data.uv_layers.active
    vert_uv = [None] * len(body_obj.data.vertices)
    for poly in body_obj.data.polygons:
        for li in poly.loop_indices:
            vi = body_obj.data.loops[li].vertex_index
            if vert_uv[vi] is None:
                vert_uv[vi] = uv_layer.data[li].uv.copy()

    def is_cyan_pixel(vi):
        uv = vert_uv[vi]
        if uv is None:
            return False
        ix = max(0, min(bw - 1, int(uv.x * (bw - 1))))
        iy = max(0, min(bh - 1, int(uv.y * (bh - 1))))
        r, g, b, _ = px_rgba[iy, ix]
        return (b > 0.32 and g > 0.24 and b > r * 1.18)

    # Connected component detection on welded bmesh to isolate Lower Antenna shells
    bm = bmesh.new()
    bm.from_mesh(body_obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00018)
    bm.verts.ensure_lookup_table()
    bm_seen = set()
    bm_shells = []
    for bv in bm.verts:
        if bv.index not in bm_seen:
            comp = []
            st = [bv]
            bm_seen.add(bv.index)
            while st:
                cur = st.pop()
                comp.append(cur)
                for e in cur.link_edges:
                    nb = e.other_vert(cur)
                    if nb.index not in bm_seen:
                        bm_seen.add(nb.index)
                        st.append(nb)
            bm_shells.append(comp)
    bm_shells.sort(key=len, reverse=True)

    # KDTree to map each raw vertex to its welded component & topological distance from peaks
    shell_kd = mathutils.kdtree.KDTree(len(bm.verts))
    bm_shell_id = {}
    for sid, comp in enumerate(bm_shells):
        for bv in comp:
            bm_shell_id[bv.index] = sid
            shell_kd.insert(bv.co, bv.index)
    shell_kd.balance()

    # Topological BFS for Dorsal Crystal Spines: seed from z > 0.43 cyan vertices (not frontal antennae)
    spine_seeds = set()
    for bv in bm.verts:
        if bm_shell_id[bv.index] != 0:
            continue
        # Exclude upper/lower frontal antennae (y < -0.27 or |x| > 0.23)
        if bv.co.y > -0.265 and abs(bv.co.x) < 0.235 and bv.co.z > 0.430:
            # Check raw vertex cyan or prominent upper dorsal ridge
            _, rvi, _ = shell_kd.find(bv.co)
            if bv.co.z > 0.445:
                spine_seeds.add(bv.index)

    # Also seed Dorsal Cyan vertices cleanly
    raw_kd = mathutils.kdtree.KDTree(len(body_obj.data.vertices))
    for i, rv in enumerate(body_obj.data.vertices):
        raw_kd.insert(rv.co, i)
    raw_kd.balance()

    for bv in bm.verts:
        if bm_shell_id[bv.index] == 0 and bv.co.y > -0.265 and abs(bv.co.x) < 0.235 and bv.co.z > 0.398:
            _, rvi, _ = raw_kd.find(bv.co)
            if is_cyan_pixel(rvi):
                spine_seeds.add(bv.index)

    # Expand 2 edge hops downward only above z > 0.382 so crystal bases transition smoothly without pulling belly plates
    spine_weight_bm = {vi: 1.0 for vi in spine_seeds}
    frontier = list(spine_seeds)
    for hop, decay in [(1, 0.55), (2, 0.22)]:
        nxt = []
        for vi in frontier:
            bv = bm.verts[vi]
            for e in bv.link_edges:
                nb = e.other_vert(bv)
                if nb.index not in spine_weight_bm and nb.co.z > 0.380 and nb.co.y > -0.275 and abs(nb.co.x) < 0.245:
                    spine_weight_bm[nb.index] = decay
                    nxt.append(nb.index)
        frontier = nxt

    per_b = []
    for vi, rv in enumerate(body_obj.data.vertices):
        co = rv.co
        _, bm_vi, _ = shell_kd.find(co)
        sid = bm_shell_id[bm_vi]

        # Isolated Lower Antennae shells (bm_shells[1] & bm_shells[2])
        if sid in (1, 2):
            side = "L" if co.x > 0 else "R"
            dist_factor = max(0.0, min(1.0, (abs(co.x) - 0.14) / 0.16))
            per_b.append({
                f"Antenna_Lower_{side}_01": 1.0 - dist_factor * 0.78,
                f"Antenna_Lower_{side}_02": dist_factor * 0.78,
                "Thorax_Front": 0.12 * (1.0 - dist_factor),
            })
            continue

        # Upper Antennae stalks (y < -0.28 and z > 0.425 and |x| > 0.125)
        if co.y < -0.280 and co.z > 0.420 and abs(co.x) > 0.125:
            side = "L" if co.x > 0 else "R"
            prog = max(0.0, min(1.0, (abs(co.x) - 0.125) / 0.165))
            root_blend = max(0.0, 1.0 - prog * 2.2) * 0.45
            per_b.append({
                "Thorax_Front": root_blend,
                f"Antenna_Upper_{side}_01": (1.0 - root_blend) * (1.0 - prog * 0.75),
                f"Antenna_Upper_{side}_02": (1.0 - root_blend) * (prog * 0.75),
            })
            continue

        # Frontal Mandibles (y < -0.355 and z < 0.340 and |x| > 0.015)
        if co.y < -0.355 and co.z < 0.340 and abs(co.x + 0.008) > 0.018:
            side = "L" if co.x > -0.008 else "R"
            m_t = max(0.0, min(1.0, (-0.355 - co.y) / 0.085))
            per_b.append({
                "Thorax_Front": 1.0 - m_t * 0.92,
                f"Mandible_{side}": m_t * 0.92,
            })
            continue

        # Spine vs Carapace regions
        sp_w = spine_weight_bm.get(bm_vi, 0.0)
        # Base body distribution: Thorax_Front (-0.36..0.0), Body_COG (-0.15..0.08), Abdomen_Rear (-0.02..0.28)
        w_thorax = math.exp(-((co.y - (-0.22)) / 0.16) ** 2)
        w_cog = math.exp(-((co.y - (-0.03)) / 0.14) ** 2)
        w_abd = math.exp(-((co.y - 0.16) / 0.15) ** 2)
        b_sum = max(1e-5, w_thorax + w_cog + w_abd)
        body_dict = {
            "Thorax_Front": (1.0 - sp_w) * (w_thorax / b_sum),
            "Body_COG": (1.0 - sp_w) * (w_cog / b_sum),
            "Abdomen_Rear": (1.0 - sp_w) * (w_abd / b_sum),
        }
        if sp_w > 1e-4:
            fb = "F" if co.y < -0.03 else "R"
            lr = "L" if co.x >= -0.008 else "R"
            body_dict[f"DorsalSpine_{fb}{lr}"] = sp_w
        per_b.append(body_dict)

    bm.free()
    assign_weights_dict(body_obj, per_b)
    sync_seam_weights(body_obj)


def orient_bone_delta(arm_obj, bone_name, desired_world_m3):
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    bpy.context.view_layer.update()
    rest_m3 = pb.bone.matrix_local.to_3x3()
    if pb.parent:
        parent_pose_m3 = pb.parent.matrix.to_3x3()
        parent_rest_m3 = pb.parent.bone.matrix_local.to_3x3()
        base_m3 = parent_pose_m3 @ parent_rest_m3.inverted() @ rest_m3
    else:
        base_m3 = rest_m3
    pb.rotation_quaternion = (base_m3.inverted() @ desired_world_m3).to_quaternion().normalized()


def rotate_bone_world(arm_obj, bone_name, rx_deg=0.0, ry_deg=0.0, rz_deg=0.0):
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    dq = mathutils.Euler((math.radians(rx_deg), math.radians(ry_deg), math.radians(rz_deg)), "ZYX").to_quaternion()
    orient_bone_delta(arm_obj, bone_name, dq.to_matrix() @ pb.bone.matrix_local.to_3x3())


def set_leg_tripod(arm_obj, leg_pref, step_fwd=0.0, lift=0.0, spread=0.0, slash_fwd=0.0, slash_out=0.0):
    """Apply clean leg articulation around coxa/femur/tibia without sliding or inverted Y-roll."""
    side = 1.0 if leg_pref.endswith("_L") else -1.0
    # In Z-up right-handed space, negative Ry lifts +X (Left) legs upward (+Z), positive Ry lifts -X (Right) legs upward (+Z).
    coxa_z = -step_fwd * 20.0 * side + slash_fwd * 38.0 * side
    coxa_y = -(lift * 16.0 + slash_out * 22.0) * side
    femur_y = -(lift * 24.0 + slash_out * 14.0 - spread * 10.0) * side
    tibia_y = (lift * 28.0 + spread * 14.0) * side
    rotate_bone_world(arm_obj, f"{leg_pref}_Coxa", rx_deg=slash_fwd * 12.0, ry_deg=coxa_y, rz_deg=coxa_z)
    rotate_bone_world(arm_obj, f"{leg_pref}_Femur", rx_deg=step_fwd * 8.0, ry_deg=femur_y, rz_deg=coxa_z * 0.55)
    rotate_bone_world(arm_obj, f"{leg_pref}_Tibia", ry_deg=tibia_y, rz_deg=coxa_z * 0.35)
    rotate_bone_world(arm_obj, f"{leg_pref}_Tarsus", ry_deg=-tibia_y * 0.55)


def clear_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def keyframe_all_bones(arm_obj, frame):
    for pb in arm_obj.pose.bones:
        if pb.name == "Body_COG":
            pb.keyframe_insert(data_path="location", frame=frame)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def build_action(arm_obj, name, duration_sec, fps, sampler_fn, cyclic=True):
    act = bpy.data.actions.new(name=name)
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    total_frames = max(2, int(round(duration_sec * fps)))
    step = 2 if total_frames >= 14 else 1
    frames = list(range(0, total_frames + 1, step))
    if frames[-1] != total_frames:
        frames.append(total_frames)
    for f in frames:
        u = 0.0 if (cyclic and f == total_frames) else (f / float(total_frames))
        sampler_fn(arm_obj, u)
        keyframe_all_bones(arm_obj, f)
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = name
    st = track.strips.new(name, 0, act)
    st.action_frame_start = 0
    st.action_frame_end = total_frames
    arm_obj.animation_data.action = None
    return act


def set_tail_curve(arm_obj, pitches_deg, yaws_deg):
    names = ["Tail_01", "Tail_02", "Tail_03", "Tail_04", "Tail_05", "Tail_Head"]
    acc_p = 0.0
    acc_y = 0.0
    for nm, dp, dy in zip(names, pitches_deg, yaws_deg):
        acc_p += dp
        acc_y += dy
        rotate_bone_world(arm_obj, nm, rx_deg=acc_p, rz_deg=acc_y)


def author_rift_stalker_animations(arm_obj):
    fps = 30.0
    legs_all = ["Leg_Front_L", "Leg_Front_R", "Leg_MidSlash_L", "Leg_MidSlash_R", "Leg_Rear_L", "Leg_Rear_R"]
    tripod_a = {"Leg_Front_L", "Leg_MidSlash_R", "Leg_Rear_L"}

    def sample_idle(arm, u):
        clear_pose(arm)
        b = math.sin(u * math.tau)
        arm.pose.bones["Body_COG"].location = (0.0, 0.0, 0.012 * b)
        rotate_bone_world(arm, "Body_COG", rx_deg=-2.5 * b)
        rotate_bone_world(arm, "Mandible_L", rz_deg=-4.0 - 5.0 * b)
        rotate_bone_world(arm, "Mandible_R", rz_deg=4.0 + 5.0 * b)
        for s in ("L", "R"):
            sgn = 1.0 if s == "L" else -1.0
            rotate_bone_world(arm, f"Antenna_Upper_{s}_01", rx_deg=4.0 * b, rz_deg=3.0 * b * sgn)
            rotate_bone_world(arm, f"Antenna_Upper_{s}_02", rx_deg=8.0 * b, rz_deg=6.0 * b * sgn)
            rotate_bone_world(arm, f"Antenna_Lower_{s}_01", rx_deg=-4.0 * b, rz_deg=-4.0 * b * sgn)
            rotate_bone_world(arm, f"Antenna_Lower_{s}_02", rx_deg=-8.0 * b)
        set_tail_curve(arm, [-3.0 * b, -2.0 * b, 1.5 * b, 3.0 * b, 2.0 * b, -1.5 * b], [3.0 * math.cos(u * math.tau), 2.0, -2.0, -2.0, 0.0, 0.0])

    def sample_walk_tripod(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        s = math.sin(ph)
        c = math.cos(ph)
        arm.pose.bones["Body_COG"].location = (0.014 * c, 0.0, -0.012 + 0.016 * abs(s))
        rotate_bone_world(arm, "Body_COG", rx_deg=2.5 * abs(c), ry_deg=3.5 * s)
        for lp in legs_all:
            phase_sign = 1.0 if lp in tripod_a else -1.0
            st = s * phase_sign
            lf = max(0.0, c * phase_sign)
            set_leg_tripod(arm, lp, step_fwd=st, lift=lf, spread=0.1)
        # Subtle independent tail counterbalance (NO leg participation!)
        set_tail_curve(arm, [2.0, 2.0 * abs(s), -2.0, -3.0, 2.0, 1.0], [-4.0 * s, -3.0 * s, 2.0 * s, 3.0 * s, 2.0 * s, 0.0])
        for s_tag in ("L", "R"):
            rotate_bone_world(arm, f"Antenna_Upper_{s_tag}_01", rx_deg=-6.0 * abs(c))
            rotate_bone_world(arm, f"Antenna_Lower_{s_tag}_01", rx_deg=5.0 * s)

    def sample_skill1_leap_slash(arm, u):
        # 1.65s: [0..0.25] crouch & coil -> [0.25..0.53] airborne leap -> [0.53..0.69] Slash 1 (R) -> [0.69..0.85] Slash 2 (L) -> recover
        clear_pose(arm)
        if u < 0.25:
            t = math.sin((u / 0.25) * math.pi * 0.5)
            arm.pose.bones["Body_COG"].location = (0.0, 0.04 * t, -0.095 * t)
            rotate_bone_world(arm, "Body_COG", rx_deg=-16.0 * t)
            for lp in legs_all:
                set_leg_tripod(arm, lp, lift=-0.45 * t, spread=0.65 * t)
            set_tail_curve(arm, [8.0 * t, 6.0 * t, 4.0 * t, 2.0 * t, -4.0 * t, -6.0 * t], [0.0] * 6)
        elif u < 0.53:
            t = (u - 0.25) / 0.28
            arch = math.sin(t * math.pi)
            arm.pose.bones["Body_COG"].location = (0.0, -0.05 * arch, 0.08 * arch)
            rotate_bone_world(arm, "Body_COG", rx_deg=24.0 * arch - 12.0 * (1.0 - t))
            set_leg_tripod(arm, "Leg_MidSlash_L", slash_fwd=0.55 * t, slash_out=0.75 * arch)
            set_leg_tripod(arm, "Leg_MidSlash_R", slash_fwd=0.75 * t, slash_out=0.85 * arch)
            for lp in ("Leg_Front_L", "Leg_Front_R", "Leg_Rear_L", "Leg_Rear_R"):
                set_leg_tripod(arm, lp, step_fwd=-0.45 * arch, lift=0.5 * arch)
            set_tail_curve(arm, [-12.0 * arch, -8.0 * arch, -4.0 * arch, 4.0 * arch, 6.0 * arch, 6.0 * arch], [0.0] * 6)
        elif u < 0.69:
            t = (u - 0.53) / 0.16
            sw = math.sin(t * math.pi)
            arm.pose.bones["Body_COG"].location = (0.0, -0.04 * sw, -0.04 * sw)
            rotate_bone_world(arm, "Body_COG", rx_deg=-8.0 * sw, rz_deg=22.0 * sw)
            set_leg_tripod(arm, "Leg_MidSlash_R", slash_fwd=1.25 * math.cos(t * math.pi), slash_out=0.55 * (1.0 - sw))
            set_leg_tripod(arm, "Leg_Front_R", slash_fwd=0.85 * sw, lift=0.45 * sw)
            set_leg_tripod(arm, "Leg_MidSlash_L", slash_fwd=-0.45, slash_out=0.65)
            rotate_bone_world(arm, "Mandible_L", rz_deg=-22.0 * sw)
            rotate_bone_world(arm, "Mandible_R", rz_deg=22.0 * sw)
        elif u < 0.85:
            t = (u - 0.69) / 0.16
            sw = math.sin(t * math.pi)
            arm.pose.bones["Body_COG"].location = (0.0, -0.04 * sw, -0.04 * sw)
            rotate_bone_world(arm, "Body_COG", rx_deg=-8.0 * sw, rz_deg=-24.0 * sw)
            set_leg_tripod(arm, "Leg_MidSlash_L", slash_fwd=1.30 * math.cos(t * math.pi), slash_out=0.55 * (1.0 - sw))
            set_leg_tripod(arm, "Leg_Front_L", slash_fwd=0.85 * sw, lift=0.45 * sw)
            rotate_bone_world(arm, "Mandible_L", rz_deg=-26.0 * sw)
            rotate_bone_world(arm, "Mandible_R", rz_deg=26.0 * sw)
        else:
            t = 1.0 - (u - 0.85) / 0.15
            arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.04 * t)
            rotate_bone_world(arm, "Body_COG", rx_deg=-6.0 * t)

    def sample_skill2_tail_sweep(arm, u):
        # 1.48s: [0..0.34] wide 6-leg brace & progressive tail wind-up -> [0.34..0.74] 150° progressive whip arc -> [0.74..1.0] return
        clear_pose(arm)
        if u < 0.34:
            t = math.sin((u / 0.34) * math.pi * 0.5)
            arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.055 * t)
            for lp in legs_all:
                set_leg_tripod(arm, lp, spread=0.75 * t, lift=-0.2 * t)
            # Progressive backward + lateral wind-up
            set_tail_curve(arm, [9.0 * t, 10.0 * t, 10.0 * t, 8.0 * t, 6.0 * t, 4.0 * t], [14.0 * t, 18.0 * t, 20.0 * t, 20.0 * t, 16.0 * t, 12.0 * t])
        elif u < 0.74:
            t = (u - 0.34) / 0.40
            # Progressive whip lag from base to terminal head!
            t1 = min(1.0, t * 1.45)
            t2 = max(0.0, min(1.0, (t - 0.12) * 1.45))
            t3 = max(0.0, min(1.0, (t - 0.24) * 1.45))
            arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.055)
            rotate_bone_world(arm, "Body_COG", rz_deg=18.0 * math.sin(t * math.pi))
            for lp in legs_all:
                set_leg_tripod(arm, lp, spread=0.80, lift=-0.22)
            # Whip across from +100 deg right to -90 deg left while dipping slightly forward
            pitches = [
                9.0 - 22.0 * math.sin(t1 * math.pi),
                10.0 - 20.0 * math.sin(t2 * math.pi),
                10.0 - 18.0 * math.sin(t2 * math.pi),
                8.0 - 14.0 * math.sin(t3 * math.pi),
                6.0 - 10.0 * math.sin(t3 * math.pi),
                4.0 - 8.0 * math.sin(t3 * math.pi),
            ]
            yaws = [
                14.0 - 30.0 * t1,
                18.0 - 36.0 * t1,
                20.0 - 40.0 * t2,
                20.0 - 42.0 * t2,
                16.0 - 38.0 * t3,
                12.0 - 32.0 * t3,
            ]
            set_tail_curve(arm, pitches, yaws)
        else:
            t = 1.0 - (u - 0.74) / 0.26
            e = t * t * (3.0 - 2.0 * t)
            arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.055 * e)
            for lp in legs_all:
                set_leg_tripod(arm, lp, spread=0.75 * e)
            set_tail_curve(arm, [0.0] * 6, [-16.0 * e, -18.0 * e, -20.0 * e, -22.0 * e, -22.0 * e, -20.0 * e])

    def sample_skill3_laser_posture(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.tau)
        arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.045)
        rotate_bone_world(arm, "Body_COG", rx_deg=-6.0 + 1.0 * s)
        for lp in legs_all:
            set_leg_tripod(arm, lp, spread=0.68, lift=-0.18)
        # Keep tail poised steadily forward with minimal breathing sway; runtime world-space head aim tracks player cleanly
        set_tail_curve(arm, [-5.0, -4.0, -1.5, 1.5, 3.5, 4.0], [0.0] * 6)
        rotate_bone_world(arm, "Mandible_L", rz_deg=-16.0)
        rotate_bone_world(arm, "Mandible_R", rz_deg=16.0)

    def sample_skill4_spine_barrage(arm, u):
        # 1.60s: [0..0.47] brace & lower/fold dorsal spines -> [0.47..0.70] flare launch -> [0.70..1.0] restore
        clear_pose(arm)
        if u < 0.47:
            t = min(1.0, (u / 0.47) * 1.1)
            fold = t * t * (3.0 - 2.0 * t)
            tremor = 0.008 * math.sin(u * 65.0) * fold
            arm.pose.bones["Body_COG"].location = (tremor, 0.0, -0.065 * fold)
            rotate_bone_world(arm, "Body_COG", rx_deg=8.0 * fold)
            for lp in legs_all:
                set_leg_tripod(arm, lp, spread=0.72 * fold, lift=-0.22 * fold)
            # Fold dorsal spines down & outward!
            rotate_bone_world(arm, "DorsalSpine_FL", rx_deg=-26.0 * fold, ry_deg=24.0 * fold)
            rotate_bone_world(arm, "DorsalSpine_FR", rx_deg=-26.0 * fold, ry_deg=-24.0 * fold)
            rotate_bone_world(arm, "DorsalSpine_RL", rx_deg=-28.0 * fold, ry_deg=26.0 * fold)
            rotate_bone_world(arm, "DorsalSpine_RR", rx_deg=-28.0 * fold, ry_deg=-26.0 * fold)
            set_tail_curve(arm, [6.0 * fold, 5.0 * fold, 4.0 * fold, 2.0 * fold, 0.0, 0.0], [0.0] * 6)
        elif u < 0.70:
            t = (u - 0.47) / 0.23
            pop = math.sin(t * math.pi * 0.5)
            arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.065 + 0.085 * pop)
            rotate_bone_world(arm, "Body_COG", rx_deg=8.0 - 18.0 * pop)
            for lp in legs_all:
                set_leg_tripod(arm, lp, spread=0.72 - 0.3 * pop)
            # Snap dorsal spines erect & upward to launch skyward crystal volley
            rotate_bone_world(arm, "DorsalSpine_FL", rx_deg=-26.0 + 36.0 * pop, ry_deg=24.0 * (1.0 - pop))
            rotate_bone_world(arm, "DorsalSpine_FR", rx_deg=-26.0 + 36.0 * pop, ry_deg=-24.0 * (1.0 - pop))
            rotate_bone_world(arm, "DorsalSpine_RL", rx_deg=-28.0 + 38.0 * pop, ry_deg=26.0 * (1.0 - pop))
            rotate_bone_world(arm, "DorsalSpine_RR", rx_deg=-28.0 + 38.0 * pop, ry_deg=-26.0 * (1.0 - pop))
        else:
            t = 1.0 - (u - 0.70) / 0.30
            arm.pose.bones["Body_COG"].location = (0.0, 0.0, 0.02 * t)
            rotate_bone_world(arm, "Body_COG", rx_deg=-10.0 * t)
            rotate_bone_world(arm, "DorsalSpine_FL", rx_deg=10.0 * t)
            rotate_bone_world(arm, "DorsalSpine_FR", rx_deg=10.0 * t)
            rotate_bone_world(arm, "DorsalSpine_RL", rx_deg=10.0 * t)
            rotate_bone_world(arm, "DorsalSpine_RR", rx_deg=10.0 * t)

    def sample_hit(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.pi)
        arm.pose.bones["Body_COG"].location = (0.0, 0.03 * s, 0.02 * s)
        rotate_bone_world(arm, "Body_COG", rx_deg=-14.0 * s, ry_deg=8.0 * s)
        set_tail_curve(arm, [8.0 * s, 6.0 * s, 4.0 * s, 0.0, -4.0 * s, -4.0 * s], [0.0] * 6)

    def sample_death(arm, u):
        clear_pose(arm)
        t = min(1.0, u / 0.78)
        e = t * t * (3.0 - 2.0 * t)
        arm.pose.bones["Body_COG"].location = (0.0, 0.0, -0.175 * e)
        rotate_bone_world(arm, "Body_COG", rx_deg=14.0 * e, ry_deg=16.0 * e)
        for lp in legs_all:
            set_leg_tripod(arm, lp, spread=0.95 * e, lift=-0.55 * e)
        set_tail_curve(arm, [14.0 * e, 16.0 * e, 14.0 * e, 12.0 * e, 10.0 * e, 8.0 * e], [8.0 * e, 6.0 * e, 0.0, 0.0, 0.0, 0.0])

    build_action(arm_obj, "Idle", 2.4, fps, sample_idle, cyclic=True)
    build_action(arm_obj, "Walk_Tripod", 0.84, fps, sample_walk_tripod, cyclic=True)
    build_action(arm_obj, "Skill1_Leap_Slash", 1.65, fps, sample_skill1_leap_slash, cyclic=False)
    build_action(arm_obj, "Skill2_Tail_Sweep", 1.48, fps, sample_skill2_tail_sweep, cyclic=False)
    build_action(arm_obj, "Skill3_Laser_Posture", 1.20, fps, sample_skill3_laser_posture, cyclic=True)
    build_action(arm_obj, "Skill4_Spine_Barrage", 1.60, fps, sample_skill4_spine_barrage, cyclic=False)
    build_action(arm_obj, "Hit_React", 0.22, fps, sample_hit, cyclic=False)
    build_action(arm_obj, "Death", 1.40, fps, sample_death, cyclic=False)
    clear_pose(arm_obj)


def render_rs_pose_sheet(arm_obj):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.world = bpy.data.worlds.new("AuditWorld")
    scene.world.color = (0.08, 0.09, 0.14)

    cam_d = bpy.data.cameras.new("PoseCam")
    cam_d.lens = 45
    cam = bpy.data.objects.new("PoseCam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def pose_walk_check():
        clear_pose(arm_obj)
        set_leg_tripod(arm_obj, "Leg_Front_L", step_fwd=0.8, lift=0.8)
        set_leg_tripod(arm_obj, "Leg_MidSlash_R", step_fwd=0.8, lift=0.8)
        set_leg_tripod(arm_obj, "Leg_Rear_L", step_fwd=0.8, lift=0.8)

    def pose_tail_whip_check():
        clear_pose(arm_obj)
        set_tail_curve(arm_obj, [-8.0, -6.0, 2.0, 8.0, 10.0, 10.0], [15.0, 18.0, 22.0, 22.0, 16.0, 12.0])

    def pose_spine_fold_check():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "DorsalSpine_FL", rx_deg=-26.0, ry_deg=24.0)
        rotate_bone_world(arm_obj, "DorsalSpine_FR", rx_deg=-26.0, ry_deg=-24.0)
        rotate_bone_world(arm_obj, "DorsalSpine_RL", rx_deg=-28.0, ry_deg=26.0)
        rotate_bone_world(arm_obj, "DorsalSpine_RR", rx_deg=-28.0, ry_deg=-26.0)

    def pose_dual_slash_check():
        clear_pose(arm_obj)
        set_leg_tripod(arm_obj, "Leg_MidSlash_L", slash_fwd=1.2, slash_out=0.7)
        set_leg_tripod(arm_obj, "Leg_MidSlash_R", slash_fwd=1.2, slash_out=0.7)
        rotate_bone_world(arm_obj, "Mandible_L", rz_deg=-24.0)
        rotate_bone_world(arm_obj, "Mandible_R", rz_deg=24.0)

    cases = [
        ("01_tripod_walk", pose_walk_check, ((0.85, -1.65, 0.85), (0.0, -0.05, 0.35))),
        ("02_tail_sweep", pose_tail_whip_check, ((1.55, -0.45, 0.85), (0.0, -0.05, 0.42))),
        ("03_spine_fold", pose_spine_fold_check, ((-1.45, -0.80, 0.95), (0.0, -0.05, 0.40))),
        ("04_dual_slash", pose_dual_slash_check, ((0.20, -1.75, 0.72), (0.0, -0.05, 0.38))),
    ]
    out_dir = os.path.dirname(POSE_SHEET_PATH)
    tmp = []
    for cname, pfn, (cpos, ctgt) in cases:
        pfn()
        bpy.context.view_layer.update()
        cam.location = mathutils.Vector(cpos)
        cam.rotation_euler = (mathutils.Vector(ctgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
        fp = os.path.join(out_dir, f"_rs_pose_{cname}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        tmp.append(fp)

    imgs = [bpy.data.images.load(p) for p in tmp]
    w, h = imgs[0].size
    grid = np.zeros((h * 2, w * 2, 4), dtype=np.float32)
    for im, (gx, gy) in zip(imgs, [(0, h), (w, h), (0, 0), (w, 0)]):
        buf = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(buf)
        grid[gy : gy + h, gx : gx + w, :] = buf.reshape((h, w, 4))
    out_im = bpy.data.images.new("RSPoseGrid", width=w * 2, height=h * 2, alpha=True)
    out_im.pixels.foreach_set(grid.ravel())
    out_im.filepath_raw = POSE_SHEET_PATH
    out_im.file_format = "PNG"
    out_im.save()

    clear_pose(arm_obj)
    bpy.data.objects.remove(cam, do_unlink=True)
    for im in imgs + [out_im]:
        bpy.data.images.remove(im)
    for p in tmp:
        if os.path.exists(p):
            os.remove(p)


def main():
    os.makedirs(EXPORT_GAME_READY_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(EXPORT_RUNTIME_GLB), exist_ok=True)
    os.makedirs(os.path.dirname(POSE_SHEET_PATH), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC_GLB)

    # Remove Tripo helper Icosphere & redundant 4th leg pair (tripo_part_8 & tripo_part_9)
    for rem in ("Icosphere", "tripo_part_8", "tripo_part_9"):
        if rem in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[rem], do_unlink=True)

    old_arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    kept_meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # Detach meshes while keeping exact world transform, then remove broken 86-bone Tripo Armature
    bpy.ops.object.select_all(action="DESELECT")
    for m in kept_meshes:
        m.select_set(True)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for m in kept_meshes:
        for mod in list(m.modifiers):
            if mod.type == "ARMATURE":
                m.modifiers.remove(mod)
        m.vertex_groups.clear()

    old_arm.animation_data_clear()
    bpy.data.objects.remove(old_arm, do_unlink=True)

    meshes_by_name = {m.name: m for m in kept_meshes}

    # Plant all 6 leg claw tips flush to ground z = 0.000 smoothly from hip socket downward so no leg floats
    for pname, info in KEPT_LEGS.items():
        obj = meshes_by_name[pname]
        min_z = min(v.co.z for v in obj.data.vertices)
        if abs(min_z) > 0.0005:
            hip_z = info["joints"][0][2]
            span = max(0.05, hip_z - min_z)
            for v in obj.data.vertices:
                w = max(0.0, min(1.0, (hip_z - v.co.z) / span))
                v.co.z -= min_z * (w ** 1.15)
            obj.data.update()
            new_joints = []
            for jx, jy, jz in info["joints"]:
                w = max(0.0, min(1.0, (hip_z - jz) / span))
                new_joints.append((jx, jy, jz - min_z * (w ** 1.15)))
            new_joints[-1] = (new_joints[-1][0], new_joints[-1][1], 0.0)
            info["joints"] = new_joints

    # Build clean 48-bone custom RiftStalker Armature & compute zero-cross-bleed skin weights
    arm_obj = build_rift_stalker_armature()
    skin_rift_stalker(meshes_by_name)

    # Wire PBR + Normal + Emissive materials on Body & Tail, and pack 6 legs into 1 atlas
    for mname, clean_name in [("tripo_part_0", "RiftStalker_Body"), ("tripo_part_1", "RiftStalker_Tail")]:
        obj = meshes_by_name[mname]
        obj.name = clean_name
        mat = obj.material_slots[0].material
        mat.name = f"{clean_name}_Mat"
        b_im, rm_im, n_im = find_rs_images(mat)
        em_im = make_emissive_image(b_im, f"{clean_name}_Emissive", out_size=1024)
        wire_rs_material(mat, b_im, rm_im, n_im, em_im, normal_strength=0.72, emission_strength=1.45)

    pack_legs_atlas(meshes_by_name)

    # Join the 6 kept leg parts into RiftStalker_Legs
    bpy.ops.object.select_all(action="DESELECT")
    for lname in KEPT_LEGS:
        meshes_by_name[lname].select_set(True)
    bpy.context.view_layer.objects.active = meshes_by_name["tripo_part_2"]
    bpy.ops.object.join()
    legs_obj = bpy.context.view_layer.objects.active
    legs_obj.name = "RiftStalker_Legs"
    legs_obj.data.name = "RiftStalker_LegsMesh"

    # Parent all 3 meshes to RiftStalker_Armature with Armature modifiers
    final_meshes = [bpy.data.objects["RiftStalker_Body"], bpy.data.objects["RiftStalker_Tail"], legs_obj]
    for m in final_meshes:
        m.parent = arm_obj
        mod = m.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj

    bpy.ops.outliner.orphans_purge(do_recursive=True)

    # Export clean un-animated game-ready RiftStalker_Rigged.glb + Backup
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for m in final_meshes:
        m.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=EXPORT_RIGGED_GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_animations=False,
        export_skins=True,
        export_all_influences=False,
        export_normals=True,
        export_tangents=True,
    )
    shutil.copy2(EXPORT_RIGGED_GLB, EXPORT_BACKUP_GLB)

    # Pose stress-test renders BEFORE final animated export
    render_rs_pose_sheet(arm_obj)

    # Author custom animations & export runtime GLB to public/assets/models/rift_stalker_3d.glb
    author_rift_stalker_animations(arm_obj)

    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for m in final_meshes:
        m.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=EXPORT_RUNTIME_GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_animations=True,
        export_nla_strips=True,
        export_def_bones=True,
        export_skins=True,
        export_all_influences=False,
        export_normals=True,
        export_tangents=True,
        export_animation_mode="NLA_TRACKS",
    )
    print("RIFT STALKER PIPELINE COMPLETE:", EXPORT_RIGGED_GLB, EXPORT_RUNTIME_GLB)


if __name__ == "__main__":
    main()
