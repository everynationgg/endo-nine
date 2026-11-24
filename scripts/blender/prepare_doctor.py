import math
import os
import shutil
import bpy
import bmesh
import mathutils
import numpy as np

SRC_GLB = r"C:\Users\yoggn\Downloads\Endo Nine\New Animation\NEW Doctor 3D Model.glb"
PROJECT_ROOT = r"c:\Users\yoggn\Desktop\Ender Nine"
EXPORT_GAME_READY_DIR = os.path.join(PROJECT_ROOT, "exports", "game_ready")
EXPORT_RIGGED_GLB = os.path.join(EXPORT_GAME_READY_DIR, "Doctor_Rigged.glb")
EXPORT_BACKUP_GLB = os.path.join(EXPORT_GAME_READY_DIR, "Doctor_Rigged_Backup.glb")
EXPORT_ANIM_GLB = os.path.join(PROJECT_ROOT, "exports", "doctor_3d_animated.glb")
POSE_SHEET_PATH = (
    r"C:\Users\yoggn\.gemini\antigravity\brain\dd6a0935-cf4d-4669-8438-4787ff8d83ff\scratch\verify_doctor_rig_poses.png"
)

BODY_GEAR_PARTS = [
    "tripo_part_2",
    "tripo_part_3",
    "tripo_part_4",
    "tripo_part_5",
    "tripo_part_6",
    "tripo_part_7",
    "tripo_part_8",
    "tripo_part_9",
    "tripo_part_10",
    "tripo_part_11",
    "tripo_part_12",
    "tripo_part_13",
    "tripo_part_14",
    "tripo_part_15",
    "tripo_part_16",
]

# Native lossless packing into 4096 x 2048 (BL origin pixels for Blender bottom-up image coordinates)
ATLAS_W = 4096
ATLAS_H = 2048
ATLAS_LAYOUT = {
    "tripo_part_2": (0, 0, 1024, 1024),
    "tripo_part_3": (1024, 0, 1024, 1024),
    "tripo_part_4": (2048, 0, 1024, 1024),
    "tripo_part_5": (0, 1024, 512, 512),
    "tripo_part_6": (512, 1024, 512, 512),
    "tripo_part_7": (1024, 1024, 512, 512),
    "tripo_part_10": (1536, 1024, 512, 512),
    "tripo_part_11": (2048, 1024, 512, 512),
    "tripo_part_8": (2560, 1024, 256, 256),
    "tripo_part_9": (2816, 1024, 256, 256),
    "tripo_part_12": (2560, 1280, 256, 256),
    "tripo_part_13": (2816, 1280, 256, 256),
    "tripo_part_14": (3072, 1024, 128, 128),
    "tripo_part_15": (3200, 1024, 128, 128),
    "tripo_part_16": (3328, 1024, 128, 128),
}


def find_material_images(mat):
    base_img = None
    norm_img = None
    if not mat or not mat.node_tree:
        return None, None
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image:
            n = node.image.name.lower()
            if "normal" in n or n.endswith("_norm"):
                norm_img = node.image
            elif "basecolor" in n or "albedo" in n or "diffuse" in n:
                base_img = node.image
    if base_img is None:
        for link in mat.node_tree.links:
            if link.to_node.type == "BSDF_PRINCIPLED" and link.to_socket.name == "Base Color":
                if link.from_node.type == "TEX_IMAGE":
                    base_img = link.from_node.image
    return base_img, norm_img


def wire_pbr_material(mat, base_img, norm_img, normal_strength=0.65, roughness=0.62):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.35
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    if base_img:
        base_img.colorspace_settings.name = "sRGB"
        tex_c = nt.nodes.new("ShaderNodeTexImage")
        tex_c.image = base_img
        tex_c.location = (-350, 180)
        nt.links.new(tex_c.outputs["Color"], bsdf.inputs["Base Color"])

    if norm_img:
        norm_img.colorspace_settings.name = "Non-Color"
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.image = norm_img
        tex_n.location = (-420, -140)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        nmap.location = (-160, -140)
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])


def pack_doctor_body_atlas(meshes_by_name):
    atlas_base_buf = np.zeros((ATLAS_H, ATLAS_W, 4), dtype=np.float32)
    atlas_norm_buf = np.zeros((ATLAS_H, ATLAS_W, 4), dtype=np.float32)
    # Neutral normal fill (0.5, 0.5, 1.0, 1.0)
    atlas_norm_buf[:, :, 0] = 0.5
    atlas_norm_buf[:, :, 1] = 0.5
    atlas_norm_buf[:, :, 2] = 1.0
    atlas_norm_buf[:, :, 3] = 1.0

    for pname in BODY_GEAR_PARTS:
        obj = meshes_by_name[pname]
        tx, ty, tw, th = ATLAS_LAYOUT[pname]
        mat = obj.material_slots[0].material if obj.material_slots else None
        base_img, norm_img = find_material_images(mat)

        if base_img:
            bw, bh = base_img.size
            arr = np.empty(bw * bh * 4, dtype=np.float32)
            base_img.pixels.foreach_get(arr)
            arr = arr.reshape((bh, bw, 4))
            copy_h = min(th, bh)
            copy_w = min(tw, bw)
            atlas_base_buf[ty : ty + copy_h, tx : tx + copy_w, :] = arr[:copy_h, :copy_w, :]

        if norm_img:
            nw, nh = norm_img.size
            arr = np.empty(nw * nh * 4, dtype=np.float32)
            norm_img.pixels.foreach_get(arr)
            arr = arr.reshape((nh, nw, 4))
            copy_h = min(th, nh)
            copy_w = min(tw, nw)
            atlas_norm_buf[ty : ty + copy_h, tx : tx + copy_w, :] = arr[:copy_h, :copy_w, :]

        # Remap UVs cleanly into atlas sub-rect with 2px margin
        uv_layer = obj.data.uv_layers.active
        if uv_layer:
            pad_u = 2.0 / ATLAS_W
            pad_v = 2.0 / ATLAS_H
            u0 = tx / ATLAS_W + pad_u
            v0 = ty / ATLAS_H + pad_v
            uspan = max(1e-5, tw / ATLAS_W - 2.0 * pad_u)
            vspan = max(1e-5, th / ATLAS_H - 2.0 * pad_v)
            for loop_uv in uv_layer.data:
                u = max(0.0, min(1.0, loop_uv.uv.x))
                v = max(0.0, min(1.0, loop_uv.uv.y))
                loop_uv.uv.x = u0 + u * uspan
                loop_uv.uv.y = v0 + v * vspan

    img_base = bpy.data.images.new("Doctor_BodyGear_BaseColor", width=ATLAS_W, height=ATLAS_H, alpha=False)
    img_base.colorspace_settings.name = "sRGB"
    img_base.pixels.foreach_set(atlas_base_buf.ravel())
    img_base.pack()

    img_norm = bpy.data.images.new("Doctor_BodyGear_Normal", width=ATLAS_W, height=ATLAS_H, alpha=False)
    img_norm.colorspace_settings.name = "Non-Color"
    img_norm.pixels.foreach_set(atlas_norm_buf.ravel())
    img_norm.pack()

    atlas_mat = bpy.data.materials.new("Doctor_BodyGear_Mat")
    wire_pbr_material(atlas_mat, img_base, img_norm, normal_strength=0.65, roughness=0.58)
    for pname in BODY_GEAR_PARTS:
        obj = meshes_by_name[pname]
        obj.data.materials.clear()
        obj.data.materials.append(atlas_mat)
    return atlas_mat


def enforce_seam_weight_parity(mesh_obj):
    """Ensure co-located split UV vertices share identical normalized skin weights (prevents seam cracking)."""
    mesh = mesh_obj.data
    verts = mesh.vertices
    if not verts:
        return
    kd = mathutils.kdtree.KDTree(len(verts))
    for i, v in enumerate(verts):
        kd.insert(v.co, i)
    kd.balance()

    visited = [False] * len(verts)
    for i, v in enumerate(verts):
        if visited[i]:
            continue
        cluster = [idx for (_, idx, _) in kd.find_range(v.co, 0.00018)]
        for c in cluster:
            visited[c] = True
        if len(cluster) <= 1:
            continue
        avg = {}
        for c in cluster:
            for g in verts[c].groups:
                if g.weight > 1e-5:
                    avg[g.group] = avg.get(g.group, 0.0) + g.weight
        tot = sum(avg.values())
        if tot <= 1e-6:
            continue
        inv = 1.0 / tot
        normalized = {vg_idx: w * inv for vg_idx, w in avg.items() if w * inv > 1e-4}
        tot2 = sum(normalized.values())
        if tot2 > 1e-6:
            normalized = {k: val / tot2 for k, val in normalized.items()}
        for c in cluster:
            for g in list(verts[c].groups):
                mesh_obj.vertex_groups[g.group].remove([c])
            for vg_idx, val in normalized.items():
                mesh_obj.vertex_groups[vg_idx].add([c], val, "REPLACE")


def reset_vertex_weights_dict(mesh_obj, per_vert_weights):
    mesh_obj.vertex_groups.clear()
    vg_cache = {}
    for bname_dict in per_vert_weights:
        for bname in bname_dict:
            if bname not in vg_cache:
                vg_cache[bname] = mesh_obj.vertex_groups.new(name=bname)
    for vidx, wdict in enumerate(per_vert_weights):
        tot = sum(w for w in wdict.values() if w > 1e-4)
        if tot <= 1e-6:
            continue
        for bname, w in wdict.items():
            nw = w / tot
            if nw > 1e-4:
                vg_cache[bname].add([vidx], nw, "REPLACE")


def read_existing_weights(mesh_obj):
    names = {vg.index: vg.name for vg in mesh_obj.vertex_groups}
    out = []
    for v in mesh_obj.data.vertices:
        d = {}
        for g in v.groups:
            if g.weight > 1e-5:
                bname = names.get(g.group)
                if bname:
                    d[bname] = g.weight
        out.append(d)
    return out


def refine_doctor_armature(arm_obj):
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_obj.data.edit_bones

    # Clear custom shapes & delete 40 unneeded finger phalanges + 3 leaf _End bones
    for b in list(eb):
        if (
            "Thumb" in b.name
            or "Index" in b.name
            or "Middle" in b.name
            or "Ring" in b.name
            or "Pinky" in b.name
            or b.name.endswith("_End")
        ):
            eb.remove(b)

    def add_bone(name, parent_name, head, tail, roll=0.0):
        b = eb.new(name)
        b.parent = eb[parent_name]
        b.use_connect = False
        b.head = mathutils.Vector(head)
        b.tail = mathutils.Vector(tail)
        b.roll = roll
        return b

    # Rigid weapon bones & muzzle emitter tips
    add_bone("Weapon_L", "mixamorig:LeftHand", (0.326, -0.050, 0.662), (0.472, -0.050, 0.680))
    add_bone("Muzzle_L", "Weapon_L", (0.472, -0.050, 0.692), (0.525, -0.050, 0.692))
    add_bone("Weapon_R", "mixamorig:RightHand", (-0.334, -0.049, 0.662), (-0.472, -0.049, 0.680))
    add_bone("Muzzle_R", "Weapon_R", (-0.472, -0.049, 0.692), (-0.525, -0.049, 0.692))

    # 3-bone flowing untied dorsal hair chain
    add_bone("Hair_01", "mixamorig:Head", (0.000, 0.020, 0.720), (0.000, 0.058, 0.618))
    add_bone("Hair_02", "Hair_01", (0.000, 0.058, 0.618), (0.000, 0.082, 0.515))
    add_bone("Hair_03", "Hair_02", (0.000, 0.082, 0.515), (0.000, 0.100, 0.405))

    # 4 Coat Skirt flare bones + 2 hip med-kit pouch bones
    add_bone("Coat_FL", "mixamorig:Hips", (0.075, -0.088, 0.485), (0.110, -0.115, 0.210))
    add_bone("Coat_FR", "mixamorig:Hips", (-0.075, -0.088, 0.485), (-0.110, -0.115, 0.210))
    add_bone("Coat_BL", "mixamorig:Hips", (0.075, 0.022, 0.485), (0.115, 0.088, 0.155))
    add_bone("Coat_BR", "mixamorig:Hips", (-0.075, 0.022, 0.485), (-0.115, 0.088, 0.155))
    add_bone("Pouch_L", "mixamorig:Hips", (0.138, -0.045, 0.485), (0.195, -0.045, 0.405))
    add_bone("Pouch_R", "mixamorig:Hips", (-0.138, -0.045, 0.485), (-0.195, -0.045, 0.405))

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.custom_shape = None
        pb.rotation_mode = "QUATERNION"


def remap_doctor_weights(meshes_by_name):
    # 1. Rigid pistols
    for pname, bname in [("tripo_part_8", "Weapon_R"), ("tripo_part_9", "Weapon_L")]:
        obj = meshes_by_name[pname]
        reset_vertex_weights_dict(obj, [{bname: 1.0} for _ in obj.data.vertices])

    # 2. Clean finger weights on remaining body parts (2..7, 10..16)
    for pname in BODY_GEAR_PARTS:
        if pname in ("tripo_part_8", "tripo_part_9"):
            continue
        obj = meshes_by_name[pname]
        raw = read_existing_weights(obj)
        cleaned = []
        for idx, d in enumerate(raw):
            nd = {}
            for b, w in d.items():
                if any(k in b for k in ("Thumb", "Index", "Middle", "Ring", "Pinky")):
                    target = "mixamorig:LeftHand" if "Left" in b else "mixamorig:RightHand"
                    nd[target] = nd.get(target, 0.0) + w
                elif b == "mixamorig:HeadTop_End":
                    nd["mixamorig:Head"] = nd.get("mixamorig:Head", 0.0) + w
                elif b == "mixamorig:LeftToe_End":
                    nd["mixamorig:LeftToeBase"] = nd.get("mixamorig:LeftToeBase", 0.0) + w
                elif b == "mixamorig:RightToe_End":
                    nd["mixamorig:RightToeBase"] = nd.get("mixamorig:RightToeBase", 0.0) + w
                else:
                    nd[b] = nd.get(b, 0.0) + w
            if not nd:
                nd["mixamorig:Hips"] = 1.0
            cleaned.append(nd)
        reset_vertex_weights_dict(obj, cleaned)
        enforce_seam_weight_parity(obj)

    # 3. Doctor_HeadHair (tripo_part_1): zero arm/shoulder bleed, add Hair_01..03 for dorsal strands
    hair_obj = meshes_by_name["tripo_part_1"]
    raw_h = read_existing_weights(hair_obj)
    clean_h = []
    for v, d in zip(hair_obj.data.vertices, raw_h):
        co = v.co
        # Strip any arm/shoulder/chest bleed
        base_head = d.get("mixamorig:Head", 0.0) + d.get("mixamorig:HeadTop_End", 0.0)
        base_neck = d.get("mixamorig:Neck", 0.0) + d.get("mixamorig:Spine2", 0.0) * 0.5
        if base_head + base_neck < 1e-4:
            base_head = 1.0

        # Long dorsal hair sits behind ear line (y > 0.015) and hangs below z = 0.695
        if co.y > 0.015 and co.z < 0.700:
            flow_t = max(0.0, min(1.0, (0.700 - co.z) / 0.115))
            w_h1 = math.exp(-((co.z - 0.620) / 0.075) ** 2)
            w_h2 = math.exp(-((co.z - 0.525) / 0.075) ** 2)
            w_h3 = math.exp(-((co.z - 0.420) / 0.085) ** 2)
            chain_sum = max(1e-5, w_h1 + w_h2 + w_h3)
            nd = {
                "mixamorig:Head": (1.0 - flow_t) * 0.92,
                "Hair_01": flow_t * (w_h1 / chain_sum),
                "Hair_02": flow_t * (w_h2 / chain_sum),
                "Hair_03": flow_t * (w_h3 / chain_sum),
            }
        else:
            nd = {"mixamorig:Head": base_head, "mixamorig:Neck": base_neck}
        clean_h.append(nd)
    reset_vertex_weights_dict(hair_obj, clean_h)
    enforce_seam_weight_parity(hair_obj)

    # 4. Doctor_Coat (tripo_part_0): strip ALL arm/shoulder/leg bleed, bind pouches & 4-quadrant skirt
    coat_obj = meshes_by_name["tripo_part_0"]
    raw_c = read_existing_weights(coat_obj)
    clean_c = []
    upper_allowed = {"mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:Neck"}
    for v, d in zip(coat_obj.data.vertices, raw_c):
        co = v.co
        # Filter only spine/neck from raw weights (completely remove Arm/Shoulder/UpLeg bleed!)
        spine_w = {k: val for k, val in d.items() if k in upper_allowed}
        if not spine_w:
            # Fallback by height on coat
            if co.z > 0.64:
                spine_w = {"mixamorig:Spine2": 1.0}
            elif co.z > 0.57:
                spine_w = {"mixamorig:Spine1": 1.0}
            else:
                spine_w = {"mixamorig:Spine": 1.0}
        st = sum(spine_w.values())
        spine_w = {k: val / st for k, val in spine_w.items()}

        if co.z >= 0.545:
            nd = spine_w
        elif co.z >= 0.485:
            # Smooth waist transition between Spine and Hips
            t = (0.545 - co.z) / (0.545 - 0.485)
            nd = {k: val * (1.0 - t) for k, val in spine_w.items()}
            nd["mixamorig:Hips"] = nd.get("mixamorig:Hips", 0.0) + t
        else:
            # Below waist (z < 0.485): blend Hips + Coat_FL/FR/BL/BR + lateral Pouches
            skirt_t = max(0.0, min(1.0, (0.485 - co.z) / 0.14))
            # Soft quadrant blending around coat center (x=0.0, y=-0.032)
            dy = co.y - (-0.032)
            f_ratio = 1.0 / (1.0 + math.exp(dy * 26.0))  # 1 = front (-Y), 0 = back (+Y)
            b_ratio = 1.0 - f_ratio
            l_ratio = 1.0 / (1.0 + math.exp(-co.x * 24.0))  # 1 = left (+X), 0 = right (-X)
            r_ratio = 1.0 - l_ratio

            # Hip med-kit pouches stick out laterally at |x| > 0.135, z in [0.36, 0.485]
            pouch_mask = 0.0
            if abs(co.x) > 0.132 and co.z > 0.355 and abs(co.y + 0.045) < 0.075:
                pouch_mask = max(0.0, min(1.0, (abs(co.x) - 0.132) / 0.035)) * max(
                    0.0, min(1.0, (co.z - 0.355) / 0.04)
                )

            nd = {
                "mixamorig:Hips": (1.0 - skirt_t) + skirt_t * 0.14 * (1.0 - pouch_mask),
                "Coat_FL": skirt_t * (1.0 - pouch_mask) * f_ratio * l_ratio * 0.86,
                "Coat_FR": skirt_t * (1.0 - pouch_mask) * f_ratio * r_ratio * 0.86,
                "Coat_BL": skirt_t * (1.0 - pouch_mask) * b_ratio * l_ratio * 0.86,
                "Coat_BR": skirt_t * (1.0 - pouch_mask) * b_ratio * r_ratio * 0.86,
            }
            if co.x >= 0:
                nd["Pouch_L"] = pouch_mask * 0.85
            else:
                nd["Pouch_R"] = pouch_mask * 0.85
        clean_c.append(nd)
    reset_vertex_weights_dict(coat_obj, clean_c)
    enforce_seam_weight_parity(coat_obj)


# ---------------------------------------------------------------------------
# World-space Twist-Free Hierarchical Bone Poser
# ---------------------------------------------------------------------------
def orient_bone_delta(arm_obj, bone_name, desired_world_m3):
    """Set PoseBone local quaternion so its world-space orientation equals desired_world_m3."""
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


def rotate_bone_world_euler(arm_obj, bone_name, pitch_deg=0.0, roll_deg=0.0, yaw_deg=0.0):
    """Apply world-space XYZ delta (pitch forward around -X, roll around Y, yaw around Z) onto bone rest orientation."""
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    # Positive pitch_deg leans forward (-Y), i.e. rotation around World X by -pitch_deg
    delta_q = mathutils.Euler(
        (math.radians(-pitch_deg), math.radians(roll_deg), math.radians(yaw_deg)),
        "ZYX",
    ).to_quaternion()
    desired_world_m3 = delta_q.to_matrix() @ pb.bone.matrix_local.to_3x3()
    orient_bone_delta(arm_obj, bone_name, desired_world_m3)


def aim_bone_world(arm_obj, bone_name, target_dir_world, target_up_world=None, blend=1.0):
    """Shortest-arc align PoseBone's Y-axis (head->tail) along target_dir_world without injecting spurious 90-deg twist."""
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    bpy.context.view_layer.update()
    rest_m3 = pb.bone.matrix_local.to_3x3()
    rest_y = (rest_m3 @ mathutils.Vector((0.0, 1.0, 0.0))).normalized()
    d = mathutils.Vector(target_dir_world).normalized()
    q_arc = rest_y.rotation_difference(d)
    desired_world_m3 = q_arc.to_matrix() @ rest_m3

    # Optional twist alignment so weapon slide-up stays upright (+Z world)
    if target_up_world is not None:
        desired_up = mathutils.Vector(target_up_world)
        desired_up_proj = desired_up - d * desired_up.dot(d)
        cur_up = (desired_world_m3 @ mathutils.Vector((0.0, 0.0, 1.0)))
        cur_up_proj = cur_up - d * cur_up.dot(d)
        if desired_up_proj.length_squared > 1e-5 and cur_up_proj.length_squared > 1e-5:
            q_twist = cur_up_proj.normalized().rotation_difference(desired_up_proj.normalized())
            desired_world_m3 = q_twist.to_matrix() @ desired_world_m3

    orient_bone_delta(arm_obj, bone_name, desired_world_m3)


def clear_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def pose_doctor(
    arm_obj,
    hips_dz=0.0,
    hips_dy=0.0,
    torso_pitch_deg=0.0,  # + bends forward (-Y)
    torso_yaw_deg=0.0,
    head_pitch_deg=0.0,
    head_yaw_deg=0.0,
    leg_l_dir=(0.04, -0.03, -1.0),
    knee_l_dir=(0.04, 0.04, -1.0),
    foot_l_pitch_deg=0.0,
    leg_r_dir=(-0.04, -0.03, -1.0),
    knee_r_dir=(-0.04, 0.04, -1.0),
    foot_r_pitch_deg=0.0,
    arm_l_dir=(0.45, -0.35, -0.82),
    fore_l_dir=(0.04, -0.96, 0.28),
    gun_l_dir=(0.0, -1.0, 0.04),
    arm_r_dir=(-0.45, -0.35, -0.82),
    fore_r_dir=(-0.04, -0.96, 0.28),
    gun_r_dir=(0.0, -1.0, 0.04),
    hair_trail_deg=0.0,
    coat_flare_deg=0.0,
    coat_back_trail_deg=0.0,
):
    clear_pose(arm_obj)
    pb_hips = arm_obj.pose.bones["mixamorig:Hips"]
    # Hips local axes: X=(0,-1,0), Y=(0,0,1), Z=(-1,0,0) -> loc Y moves up/down, loc X moves fwd/back
    pb_hips.location = (hips_dy, hips_dz, 0.0)

    # Spine & Head preserve rest -Y facing via twist-free world-Euler delta
    rotate_bone_world_euler(arm_obj, "mixamorig:Hips", pitch_deg=0.0, yaw_deg=0.0)
    rotate_bone_world_euler(arm_obj, "mixamorig:Spine", pitch_deg=torso_pitch_deg * 0.35, yaw_deg=torso_yaw_deg * 0.3)
    rotate_bone_world_euler(arm_obj, "mixamorig:Spine1", pitch_deg=torso_pitch_deg * 0.35, yaw_deg=torso_yaw_deg * 0.35)
    rotate_bone_world_euler(arm_obj, "mixamorig:Spine2", pitch_deg=torso_pitch_deg * 0.30, yaw_deg=torso_yaw_deg * 0.35)
    rotate_bone_world_euler(arm_obj, "mixamorig:Neck", pitch_deg=torso_pitch_deg * 0.15 + head_pitch_deg * 0.3, yaw_deg=head_yaw_deg * 0.3)
    rotate_bone_world_euler(arm_obj, "mixamorig:Head", pitch_deg=head_pitch_deg * 0.7, yaw_deg=head_yaw_deg * 0.7)

    # Hair chain trailing backward (+Y, i.e. negative forward pitch)
    for i, hname in enumerate(("Hair_01", "Hair_02", "Hair_03")):
        ang = -hair_trail_deg * (0.35 + 0.18 * i)
        rotate_bone_world_euler(arm_obj, hname, pitch_deg=ang, yaw_deg=head_yaw_deg * 0.3)

    # Legs (shortest-arc from vertical downward, zero twist)
    aim_bone_world(arm_obj, "mixamorig:LeftUpLeg", leg_l_dir)
    aim_bone_world(arm_obj, "mixamorig:LeftLeg", knee_l_dir)
    rotate_bone_world_euler(arm_obj, "mixamorig:LeftFoot", pitch_deg=foot_l_pitch_deg)

    aim_bone_world(arm_obj, "mixamorig:RightUpLeg", leg_r_dir)
    aim_bone_world(arm_obj, "mixamorig:RightLeg", knee_r_dir)
    rotate_bone_world_euler(arm_obj, "mixamorig:RightFoot", pitch_deg=foot_r_pitch_deg)

    # Coat Skirt auto-flare coupled to thigh flexion + velocity trail
    fl_flare = max(0.0, -leg_l_dir[1] * 28.0) + coat_flare_deg * 0.55
    fr_flare = max(0.0, -leg_r_dir[1] * 28.0) + coat_flare_deg * 0.55
    bl_flare = max(0.0, leg_l_dir[1] * 26.0) + coat_back_trail_deg * 0.65 + coat_flare_deg * 0.35
    br_flare = max(0.0, leg_r_dir[1] * 26.0) + coat_back_trail_deg * 0.65 + coat_flare_deg * 0.35

    rotate_bone_world_euler(arm_obj, "Coat_FL", pitch_deg=fl_flare, roll_deg=-coat_flare_deg * 0.3)
    rotate_bone_world_euler(arm_obj, "Coat_FR", pitch_deg=fr_flare, roll_deg=coat_flare_deg * 0.3)
    rotate_bone_world_euler(arm_obj, "Coat_BL", pitch_deg=-bl_flare, roll_deg=-coat_flare_deg * 0.25)
    rotate_bone_world_euler(arm_obj, "Coat_BR", pitch_deg=-br_flare, roll_deg=coat_flare_deg * 0.25)
    rotate_bone_world_euler(arm_obj, "Pouch_L", pitch_deg=-coat_back_trail_deg * 0.3, roll_deg=-coat_flare_deg * 0.35)
    rotate_bone_world_euler(arm_obj, "Pouch_R", pitch_deg=-coat_back_trail_deg * 0.3, roll_deg=coat_flare_deg * 0.35)

    # Arms & Dual Pistols
    aim_bone_world(arm_obj, "mixamorig:LeftArm", arm_l_dir)
    aim_bone_world(arm_obj, "mixamorig:LeftForeArm", fore_l_dir)
    aim_bone_world(arm_obj, "mixamorig:LeftHand", gun_l_dir)
    aim_bone_world(arm_obj, "Weapon_L", gun_l_dir, target_up_world=(0.0, 0.0, 1.0))

    aim_bone_world(arm_obj, "mixamorig:RightArm", arm_r_dir)
    aim_bone_world(arm_obj, "mixamorig:RightForeArm", fore_r_dir)
    aim_bone_world(arm_obj, "Weapon_R", gun_r_dir, target_up_world=(0.0, 0.0, 1.0))


def keyframe_all_bones(arm_obj, frame):
    for pb in arm_obj.pose.bones:
        if pb.name == "mixamorig:Hips":
            pb.keyframe_insert(data_path="location", frame=frame)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def build_action_from_sampler(arm_obj, name, duration_sec, fps, sampler_fn, cyclic=True):
    act = bpy.data.actions.new(name=name)
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    total_frames = max(2, int(round(duration_sec * fps)))
    sample_step = 2 if total_frames >= 12 else 1
    frames = list(range(0, total_frames + 1, sample_step))
    if frames[-1] != total_frames:
        frames.append(total_frames)
    for f in frames:
        u = f / float(total_frames)
        if cyclic and f == total_frames:
            u = 0.0
        sampler_fn(arm_obj, u)
        keyframe_all_bones(arm_obj, f)

    # Push to NLA track for clean glTF multi-clip export
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    strip.action_frame_start = 0
    strip.action_frame_end = total_frames
    arm_obj.animation_data.action = None
    return act


def author_doctor_animations(arm_obj):
    fps = 30.0

    def sample_idle(arm, u):
        b = math.sin(u * math.tau)
        pose_doctor(
            arm,
            hips_dz=-0.014 + 0.004 * b,
            torso_pitch_deg=3.0 + 1.2 * b,
            leg_l_dir=(0.06, -0.04, -1.0),
            knee_l_dir=(0.05, 0.06, -1.0),
            leg_r_dir=(-0.06, 0.03, -1.0),
            knee_r_dir=(-0.05, 0.08, -1.0),
            # Relaxed arms hanging down along sides matching front silhouette (no outstretched waist pose)
            arm_l_dir=(0.24, 0.04 + 0.02 * b, -0.97),
            fore_l_dir=(0.14, -0.26 + 0.03 * b, -0.95),
            gun_l_dir=(0.06, -0.44 + 0.02 * b, -0.89),
            arm_r_dir=(-0.24, 0.04 - 0.02 * b, -0.97),
            fore_r_dir=(-0.14, -0.26 - 0.03 * b, -0.95),
            gun_r_dir=(-0.06, -0.44 - 0.02 * b, -0.89),
            hair_trail_deg=4.0 + 2.5 * b,
            coat_flare_deg=3.0 + 1.2 * b,
        )

    def make_locomotion(stride_amp, arm_swing, speed_lean_deg, bob_amp, is_run=False):
        def eval_leg_kinematics(u_leg, side_x):
            u_w = u_leg % 1.0
            if not is_run:
                # Brisk walk with distinct knee bend on recovery swing & soft contact cushion
                ph = u_w * math.tau
                s = math.sin(ph)
                c = math.cos(ph)
                th_fwd = stride_amp * s
                lift_f = max(0.0, c)
                th_alpha = math.atan2(th_fwd + lift_f * 0.16, 1.0)
                bend = math.radians(10.0 + 30.0 * lift_f + 12.0 * max(0.0, -s))
                foot_p = -14.0 * s
            else:
                # 4-phase athletic run cycle: Contact/Cushion -> Push-Off -> High-Knee Recovery -> Pre-Strike Unfold
                if u_w < 0.18:
                    k = u_w / 0.18
                    th_alpha = math.radians(26.0 - 20.0 * k)
                    bend = math.radians(15.0 + 19.0 * math.sin(k * math.pi * 0.5))
                    foot_p = -10.0 * (1.0 - k)
                elif u_w < 0.42:
                    k = (u_w - 0.18) / 0.24
                    th_alpha = math.radians(6.0 - 36.0 * k)
                    bend = math.radians(34.0 - 20.0 * k)
                    foot_p = 24.0 * k
                elif u_w < 0.72:
                    k = (u_w - 0.42) / 0.30
                    e = 0.5 - 0.5 * math.cos(k * math.pi)
                    th_alpha = math.radians(-30.0 + 74.0 * e)
                    bend = math.radians(14.0 + 60.0 * math.sin(k * math.pi * 0.72))
                    foot_p = 24.0 * (1.0 - 0.55 * e)
                else:
                    k = (u_w - 0.72) / 0.28
                    th_alpha = math.radians(44.0 + 6.0 * math.sin(k * math.pi) - 18.0 * (k ** 1.35))
                    bend = math.radians(68.0 * (1.0 - k) + 15.0 * k)
                    foot_p = 10.0 * (1.0 - k) - 10.0 * k

            sh_alpha = th_alpha - bend
            th_dir = (side_x * 0.06, -math.sin(th_alpha), -math.cos(th_alpha))
            sh_dir = (side_x * 0.05, -math.sin(sh_alpha), -math.cos(sh_alpha))
            return th_dir, sh_dir, foot_p

        def sampler(arm, u):
            ph = u * math.tau
            s = math.sin(ph)
            c = math.cos(ph)
            l_th, l_sh, l_fp = eval_leg_kinematics(u, 1.0)
            r_th, r_sh, r_fp = eval_leg_kinematics(u + 0.5, -1.0)

            dz = (-0.030 - bob_amp * 0.5 * math.cos(ph * 2.0)) if is_run else (-0.022 + bob_amp * abs(c))
            # Natural bent-elbow runner arm pump opposite legs
            arm_l_fwd = -arm_swing * math.cos(ph)
            arm_r_fwd = arm_swing * math.cos(ph)
            l_arm_ang = math.atan2(arm_l_fwd, 0.92)
            r_arm_ang = math.atan2(arm_r_fwd, 0.92)
            fore_bend = math.radians(74.0 if is_run else 42.0)
            l_fore_ang = l_arm_ang + fore_bend
            r_fore_ang = r_arm_ang + fore_bend

            pose_doctor(
                arm,
                hips_dz=dz,
                torso_pitch_deg=speed_lean_deg + (2.5 * math.sin(ph * 2.0) if is_run else 1.8 * abs(c)),
                torso_yaw_deg=(-8.0 if is_run else -5.0) * math.cos(ph),
                head_pitch_deg=-speed_lean_deg * 0.45,
                leg_l_dir=l_th,
                knee_l_dir=l_sh,
                foot_l_pitch_deg=l_fp,
                leg_r_dir=r_th,
                knee_r_dir=r_sh,
                foot_r_pitch_deg=r_fp,
                arm_l_dir=(0.28, -math.sin(l_arm_ang), -math.cos(l_arm_ang)),
                fore_l_dir=(0.12, -math.sin(l_fore_ang), -math.cos(l_fore_ang)),
                gun_l_dir=(0.06, -math.sin(l_fore_ang + 0.12), -math.cos(l_fore_ang + 0.12)),
                arm_r_dir=(-0.28, -math.sin(r_arm_ang), -math.cos(r_arm_ang)),
                fore_r_dir=(-0.12, -math.sin(r_fore_ang), -math.cos(r_fore_ang)),
                gun_r_dir=(-0.06, -math.sin(r_fore_ang + 0.12), -math.cos(r_fore_ang + 0.12)),
                hair_trail_deg=14.0 + speed_lean_deg * 0.7 + 7.0 * abs(c),
                coat_flare_deg=7.0 + stride_amp * 16.0,
                coat_back_trail_deg=12.0 + speed_lean_deg * 0.85,
            )
        return sampler

    def sample_jump_takeoff(arm, u):
        t = math.sin(u * math.pi * 0.5)
        pose_doctor(
            arm,
            hips_dz=-0.065 * (1.0 - t) + 0.02 * t,
            torso_pitch_deg=10.0 * (1.0 - t) - 4.0 * t,
            leg_l_dir=(0.08, -0.24, -0.95),
            knee_l_dir=(0.06, 0.35 * (1.0 - t) + 0.05 * t, -1.0),
            leg_r_dir=(-0.08, -0.18, -0.95),
            knee_r_dir=(-0.06, 0.35 * (1.0 - t) + 0.05 * t, -1.0),
            arm_l_dir=(0.55, -0.22, -0.60 + 0.45 * t),
            fore_l_dir=(0.10, -0.90, 0.42),
            gun_l_dir=(0.0, -1.0, 0.15),
            arm_r_dir=(-0.55, -0.22, -0.60 + 0.45 * t),
            fore_r_dir=(-0.10, -0.90, 0.42),
            gun_r_dir=(0.0, -1.0, 0.15),
            hair_trail_deg=12.0,
            coat_flare_deg=14.0,
        )

    def sample_jump_ascend(arm, u):
        s = math.sin(u * math.tau)
        pose_doctor(
            arm,
            hips_dz=0.02 + 0.008 * s,
            torso_pitch_deg=-3.0,
            leg_l_dir=(0.09, -0.34, -0.92),
            knee_l_dir=(0.07, 0.46, -0.88),
            leg_r_dir=(-0.09, 0.08, -0.98),
            knee_r_dir=(-0.07, 0.24, -0.96),
            arm_l_dir=(0.58, -0.18, -0.25),
            fore_l_dir=(0.05, -0.94, 0.35),
            gun_l_dir=(0.0, -1.0, 0.12),
            arm_r_dir=(-0.58, -0.18, -0.25),
            fore_r_dir=(-0.05, -0.94, 0.35),
            gun_r_dir=(0.0, -1.0, 0.12),
            hair_trail_deg=10.0,
            coat_flare_deg=16.0,
            coat_back_trail_deg=8.0,
        )

    def sample_jump_descend(arm, u):
        s = math.sin(u * math.tau)
        pose_doctor(
            arm,
            hips_dz=0.0,
            torso_pitch_deg=8.0,
            leg_l_dir=(0.10, -0.18, -0.96),
            knee_l_dir=(0.08, 0.34, -0.92),
            leg_r_dir=(-0.10, -0.12, -0.98),
            knee_r_dir=(-0.08, 0.28, -0.94),
            arm_l_dir=(0.66, -0.15, -0.22 + 0.05 * s),
            fore_l_dir=(0.10, -0.90, 0.42),
            gun_l_dir=(0.0, -1.0, 0.05),
            arm_r_dir=(-0.66, -0.15, -0.22 - 0.05 * s),
            fore_r_dir=(-0.10, -0.90, 0.42),
            gun_r_dir=(0.0, -1.0, 0.05),
            hair_trail_deg=-10.0,  # hair floats up during fall!
            coat_flare_deg=24.0,
            coat_back_trail_deg=22.0,
        )

    def sample_jump_land(arm, u):
        c = math.sin(u * math.pi)
        pose_doctor(
            arm,
            hips_dz=-0.06 * c,
            torso_pitch_deg=14.0 * c,
            leg_l_dir=(0.09, -0.22 * c, -0.95),
            knee_l_dir=(0.08, 0.36 * c, -0.92),
            leg_r_dir=(-0.09, -0.20 * c, -0.95),
            knee_r_dir=(-0.08, 0.36 * c, -0.92),
            arm_l_dir=(0.48, -0.28, -0.78),
            fore_l_dir=(0.0, -0.96, 0.24),
            gun_l_dir=(0.0, -1.0, 0.05),
            arm_r_dir=(-0.48, -0.28, -0.78),
            fore_r_dir=(0.0, -0.96, 0.24),
            gun_r_dir=(0.0, -1.0, 0.05),
            hair_trail_deg=12.0 * c,
            coat_flare_deg=16.0 * c,
        )

    def sample_glide(arm, u):
        s = math.sin(u * math.tau)
        pose_doctor(
            arm,
            hips_dz=0.01 * s,
            torso_pitch_deg=15.0,
            leg_l_dir=(0.08, 0.14, -0.98),
            knee_l_dir=(0.08, 0.38, -0.92),
            foot_l_pitch_deg=22.0,
            leg_r_dir=(-0.08, 0.24, -0.96),
            knee_r_dir=(-0.08, 0.44, -0.90),
            foot_r_pitch_deg=25.0,
            arm_l_dir=(0.56, -0.30, -0.70),
            fore_l_dir=(0.06, -0.96, 0.28),
            gun_l_dir=(0.0, -1.0, 0.05),
            arm_r_dir=(-0.56, -0.30, -0.70),
            fore_r_dir=(-0.06, -0.96, 0.28),
            gun_r_dir=(0.0, -1.0, 0.05),
            hair_trail_deg=28.0 + 5.0 * s,
            coat_flare_deg=18.0,
            coat_back_trail_deg=26.0 + 4.0 * s,
        )

    def sample_lmb_shoot(arm, u):
        # Quick alternating recoil kick between Left (0..0.5) and Right (0.5..1.0)
        kick_l = max(0.0, math.sin(u * math.tau)) * 0.28
        kick_r = max(0.0, -math.sin(u * math.tau)) * 0.28
        pose_doctor(
            arm,
            hips_dz=-0.015,
            torso_pitch_deg=6.0,
            leg_l_dir=(0.07, -0.06, -1.0),
            knee_l_dir=(0.06, 0.08, -1.0),
            leg_r_dir=(-0.07, 0.04, -1.0),
            knee_r_dir=(-0.06, 0.08, -1.0),
            arm_l_dir=(0.30, -0.68, -0.58 + kick_l * 0.25),
            fore_l_dir=(-0.10, -0.96, 0.24 + kick_l),
            gun_l_dir=(0.0, -1.0, 0.10 + kick_l * 0.8),
            arm_r_dir=(-0.30, -0.68, -0.58 + kick_r * 0.25),
            fore_r_dir=(0.10, -0.96, 0.24 + kick_r),
            gun_r_dir=(0.0, -1.0, 0.10 + kick_r * 0.8),
            hair_trail_deg=6.0,
            coat_flare_deg=4.0,
        )

    def sample_rmb_throw(arm, u):
        # Wind back (0..0.32), snap left arm overhead-forward to toss poison grenade (0.32..0.62), recover
        if u < 0.32:
            t = u / 0.32
            yaw = -24.0 * t
            l_arm = (0.45, 0.35 * t, 0.45 * t - 0.35 * (1.0 - t))
            l_fore = (0.25, 0.20, 0.90)
        elif u < 0.65:
            t = (u - 0.32) / 0.33
            yaw = -24.0 + 44.0 * t
            l_arm = (0.25, -0.92 * t + 0.35 * (1.0 - t), 0.35 - 0.60 * t)
            l_fore = (-0.05, -0.95, 0.25 - 0.35 * t)
        else:
            t = (u - 0.65) / 0.35
            yaw = 20.0 * (1.0 - t)
            l_arm = (0.35, -0.55, -0.72)
            l_fore = (0.0, -0.96, 0.24)
        pose_doctor(
            arm,
            hips_dz=-0.02,
            torso_pitch_deg=8.0,
            torso_yaw_deg=yaw,
            leg_l_dir=(0.08, -0.10, -1.0),
            knee_l_dir=(0.06, 0.12, -1.0),
            leg_r_dir=(-0.08, 0.08, -1.0),
            knee_r_dir=(-0.06, 0.12, -1.0),
            arm_l_dir=l_arm,
            fore_l_dir=l_fore,
            gun_l_dir=(0.0, -1.0, 0.05),
            arm_r_dir=(-0.40, -0.35, -0.82),
            fore_r_dir=(0.05, -0.96, 0.24),
            gun_r_dir=(0.0, -1.0, 0.08),
            hair_trail_deg=12.0,
            coat_flare_deg=8.0,
        )

    def sample_dash(arm, u):
        s = math.sin(u * math.pi)
        pose_doctor(
            arm,
            hips_dz=-0.055 * s - 0.03,
            torso_pitch_deg=32.0 * s + 10.0,
            head_pitch_deg=-18.0 * s,
            leg_l_dir=(0.08, -0.45 * s, -0.88),
            knee_l_dir=(0.07, 0.32 * s, -0.92),
            leg_r_dir=(-0.08, 0.42 * s, -0.88),
            knee_r_dir=(-0.07, 0.20 * s, -0.95),
            arm_l_dir=(0.48, 0.45 * s - 0.1, -0.75),
            fore_l_dir=(0.25, 0.55 * s - 0.2, -0.70),
            gun_l_dir=(0.15, 0.65 * s - 0.3, -0.60),
            arm_r_dir=(-0.48, 0.45 * s - 0.1, -0.75),
            fore_r_dir=(-0.25, 0.55 * s - 0.2, -0.70),
            gun_r_dir=(-0.15, 0.65 * s - 0.3, -0.60),
            hair_trail_deg=38.0 * s + 14.0,
            coat_flare_deg=20.0 * s + 6.0,
            coat_back_trail_deg=34.0 * s + 12.0,
        )

    def sample_ultimate(arm, u):
        # Rise arms upward in Sanctuary Cross medical invocation (peak at 0.35..0.72)
        env = math.sin(min(1.0, u / 0.30) * math.pi * 0.5) if u < 0.30 else (
            1.0 if u < 0.72 else math.cos((u - 0.72) / 0.28 * math.pi * 0.5)
        )
        pose_doctor(
            arm,
            hips_dz=0.03 * env,
            torso_pitch_deg=-8.0 * env,
            head_pitch_deg=-10.0 * env,
            leg_l_dir=(0.09, -0.04, -1.0),
            knee_l_dir=(0.08, 0.06, -1.0),
            leg_r_dir=(-0.09, -0.04, -1.0),
            knee_r_dir=(-0.08, 0.06, -1.0),
            arm_l_dir=(0.55, -0.22, -0.55 + 1.35 * env),
            fore_l_dir=(0.25, -0.35, 0.90 * env + 0.15),
            gun_l_dir=(0.15, -0.30, 0.94 * env + 0.1),
            arm_r_dir=(-0.55, -0.22, -0.55 + 1.35 * env),
            fore_r_dir=(-0.25, -0.35, 0.90 * env + 0.15),
            gun_r_dir=(-0.15, -0.30, 0.94 * env + 0.1),
            hair_trail_deg=18.0 * env,
            coat_flare_deg=22.0 * env,
            coat_back_trail_deg=16.0 * env,
        )

    def sample_hit(arm, u):
        s = math.sin(u * math.pi)
        pose_doctor(
            arm,
            hips_dz=-0.02 * s,
            torso_pitch_deg=-16.0 * s,
            torso_yaw_deg=12.0 * s,
            head_pitch_deg=-14.0 * s,
            arm_l_dir=(0.52, -0.15, -0.78),
            fore_l_dir=(0.1, -0.92, 0.32),
            arm_r_dir=(-0.52, -0.15, -0.78),
            fore_r_dir=(-0.1, -0.92, 0.32),
            hair_trail_deg=15.0 * s,
            coat_flare_deg=8.0 * s,
        )

    def sample_death(arm, u):
        t = min(1.0, u / 0.78)
        e = t * t * (3.0 - 2.0 * t)
        pose_doctor(
            arm,
            hips_dz=-0.42 * e,
            hips_dy=-0.12 * e,
            torso_pitch_deg=76.0 * e,
            head_pitch_deg=35.0 * e,
            leg_l_dir=(0.18 * e + 0.05, 0.85 * e, -1.0 + 0.75 * e),
            knee_l_dir=(0.15, 0.92 * e + 0.08, -1.0 + 0.75 * e),
            leg_r_dir=(-0.18 * e - 0.05, 0.85 * e, -1.0 + 0.75 * e),
            knee_r_dir=(-0.15, 0.92 * e + 0.08, -1.0 + 0.75 * e),
            arm_l_dir=(0.65, -0.15 - 0.4 * e, -0.60 - 0.25 * e),
            fore_l_dir=(0.35, -0.65, -0.45 * e),
            gun_l_dir=(0.25, -0.75, -0.35 * e),
            arm_r_dir=(-0.65, -0.15 - 0.4 * e, -0.60 - 0.25 * e),
            fore_r_dir=(-0.35, -0.65, -0.45 * e),
            gun_r_dir=(-0.25, -0.75, -0.35 * e),
            hair_trail_deg=24.0 * e,
            coat_flare_deg=18.0 * e,
        )

    build_action_from_sampler(arm_obj, "Idle", 2.4, fps, sample_idle, cyclic=True)
    build_action_from_sampler(arm_obj, "Walk", 0.84, fps, make_locomotion(0.28, 0.24, 7.0, 0.014, is_run=False), cyclic=True)
    build_action_from_sampler(arm_obj, "Run", 0.56, fps, make_locomotion(0.46, 0.44, 15.0, 0.026, is_run=True), cyclic=True)
    build_action_from_sampler(arm_obj, "Jump_Takeoff", 0.22, fps, sample_jump_takeoff, cyclic=False)
    build_action_from_sampler(arm_obj, "Jump_Ascend", 0.50, fps, sample_jump_ascend, cyclic=True)
    build_action_from_sampler(arm_obj, "Jump_Descend", 0.60, fps, sample_jump_descend, cyclic=True)
    build_action_from_sampler(arm_obj, "Jump_Land", 0.24, fps, sample_jump_land, cyclic=False)
    build_action_from_sampler(arm_obj, "Glide", 1.00, fps, sample_glide, cyclic=True)
    build_action_from_sampler(arm_obj, "LMB_Shoot", 0.34, fps, sample_lmb_shoot, cyclic=True)
    build_action_from_sampler(arm_obj, "RMB_Throw", 0.42, fps, sample_rmb_throw, cyclic=False)
    build_action_from_sampler(arm_obj, "Dash", 0.26, fps, sample_dash, cyclic=False)
    build_action_from_sampler(arm_obj, "Ultimate_Cast", 0.80, fps, sample_ultimate, cyclic=False)
    build_action_from_sampler(arm_obj, "Hit_React", 0.20, fps, sample_hit, cyclic=False)
    build_action_from_sampler(arm_obj, "Death", 1.10, fps, sample_death, cyclic=False)
    clear_pose(arm_obj)


def render_pose_verification_sheet(arm_obj):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.world = bpy.data.worlds.new("AuditWorld")
    scene.world.color = (0.09, 0.11, 0.16)

    cam_data = bpy.data.cameras.new("PoseCam")
    cam_data.lens = 45
    cam = bpy.data.objects.new("PoseCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    poses = [
        ("01_idle", lambda: pose_doctor(arm_obj, torso_pitch_deg=3.0, arm_l_dir=(0.24, 0.04, -0.97), fore_l_dir=(0.14, -0.26, -0.95), gun_l_dir=(0.06, -0.44, -0.89), arm_r_dir=(-0.24, 0.04, -0.97), fore_r_dir=(-0.14, -0.26, -0.95), gun_r_dir=(-0.06, -0.44, -0.89))),
        ("02_run_stride", lambda: pose_doctor(arm_obj, hips_dz=-0.03, torso_pitch_deg=15.0, leg_l_dir=(0.06, -0.71, -0.70), knee_l_dir=(0.05, 0.34, -0.94), foot_l_pitch_deg=12.0, leg_r_dir=(-0.06, 0.45, -0.89), knee_r_dir=(-0.05, 0.64, -0.77), arm_l_dir=(0.28, 0.36, -0.89), fore_l_dir=(0.12, -0.62, -0.78), gun_l_dir=(0.06, -0.72, -0.69), arm_r_dir=(-0.28, -0.36, -0.89), fore_r_dir=(-0.12, -0.98, 0.16), gun_r_dir=(-0.06, -0.96, 0.28), hair_trail_deg=24.0, coat_flare_deg=16.0, coat_back_trail_deg=22.0)),
        ("03_ult_cast", lambda: pose_doctor(arm_obj, arm_l_dir=(0.50, -0.25, 0.82), fore_l_dir=(0.20, -0.35, 0.92), gun_l_dir=(0.15, -0.30, 0.94), arm_r_dir=(-0.50, -0.25, 0.82), fore_r_dir=(-0.20, -0.35, 0.92), gun_r_dir=(-0.15, -0.30, 0.94), hair_trail_deg=16.0, coat_flare_deg=20.0)),
        ("04_back_coat", lambda: pose_doctor(arm_obj, torso_pitch_deg=12.0, arm_l_dir=(0.24, 0.04, -0.97), fore_l_dir=(0.14, -0.26, -0.95), gun_l_dir=(0.06, -0.44, -0.89), arm_r_dir=(-0.24, 0.04, -0.97), fore_r_dir=(-0.14, -0.26, -0.95), gun_r_dir=(-0.06, -0.44, -0.89), hair_trail_deg=18.0, coat_flare_deg=14.0, coat_back_trail_deg=20.0)),
    ]

    temp_files = []
    # Camera views: first 3 front-3/4, 4th rear-3/4, full head-to-toe framing
    cam_views = [
        ((0.65, -2.05, 0.72), (0.0, -0.02, 0.48)),
        ((-1.75, -1.35, 0.68), (0.0, -0.02, 0.48)),
        ((0.55, -2.10, 0.74), (0.0, -0.02, 0.49)),
        ((-0.65, 2.05, 0.72), (0.0, -0.02, 0.48)),
    ]
    out_dir = os.path.dirname(POSE_SHEET_PATH)
    for (pname, fn), (cpos, ctgt) in zip(poses, cam_views):
        fn()
        bpy.context.view_layer.update()
        cam.location = mathutils.Vector(cpos)
        direction = mathutils.Vector(ctgt) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(out_dir, f"_doc_pose_{pname}.png")
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        temp_files.append(p)

    # Composite 2x2 grid into POSE_SHEET_PATH using numpy & bpy.data.images
    imgs = [bpy.data.images.load(p) for p in temp_files]
    w, h = imgs[0].size
    grid = np.zeros((h * 2, w * 2, 4), dtype=np.float32)
    coords = [(0, h), (w, h), (0, 0), (w, 0)]
    for im, (gx, gy) in zip(imgs, coords):
        buf = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(buf)
        grid[gy : gy + h, gx : gx + w, :] = buf.reshape((h, w, 4))
    out_img = bpy.data.images.new("PoseGrid", width=w * 2, height=h * 2, alpha=True)
    out_img.pixels.foreach_set(grid.ravel())
    out_img.filepath_raw = POSE_SHEET_PATH
    out_img.file_format = "PNG"
    out_img.save()

    clear_pose(arm_obj)
    bpy.data.objects.remove(cam, do_unlink=True)
    for im in imgs + [out_img]:
        bpy.data.images.remove(im)
    for p in temp_files:
        if os.path.exists(p):
            os.remove(p)


def main():
    os.makedirs(EXPORT_GAME_READY_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(POSE_SHEET_PATH), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC_GLB)

    # Remove Tripo helper Icosphere & all existing Tripo actions
    if "Icosphere" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["Icosphere"], do_unlink=True)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)

    arm_obj = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    arm_obj.name = "Doctor_Armature"
    arm_obj.data.name = "Doctor_ArmatureData"
    arm_obj.animation_data_clear()
    for act in list(bpy.data.actions):
        act.use_fake_user = False
        bpy.data.actions.remove(act)

    meshes_by_name = {o.name: o for o in bpy.data.objects if o.type == "MESH"}

    # 1. Refine skeleton & weights
    refine_doctor_armature(arm_obj)
    remap_doctor_weights(meshes_by_name)

    # 2. Wire PBR + Normal maps on Coat & HeadHair, pack BodyGear atlas
    for mname, clean_name in [("tripo_part_0", "Doctor_Coat"), ("tripo_part_1", "Doctor_HeadHair")]:
        obj = meshes_by_name[mname]
        obj.name = clean_name
        mat = obj.material_slots[0].material
        mat.name = f"{clean_name}_Mat"
        b_img, n_img = find_material_images(mat)
        wire_pbr_material(mat, b_img, n_img, normal_strength=0.62, roughness=0.64)

    pack_doctor_body_atlas(meshes_by_name)

    # Join tripo_part_2..16 into Doctor_BodyGear
    bpy.ops.object.select_all(action="DESELECT")
    for pname in BODY_GEAR_PARTS:
        meshes_by_name[pname].select_set(True)
    bpy.context.view_layer.objects.active = meshes_by_name["tripo_part_2"]
    bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = "Doctor_BodyGear"
    body_obj.data.name = "Doctor_BodyGearMesh"

    # Purge unused orphan images/materials/meshes
    bpy.ops.outliner.orphans_purge(do_recursive=True)

    # 3. Export clean un-animated game-ready Doctor_Rigged.glb + Backup
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for cname in ("Doctor_Coat", "Doctor_HeadHair", "Doctor_BodyGear"):
        bpy.data.objects[cname].select_set(True)

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

    # 4. Render multi-pose deformation stress check BEFORE exporting animated GLB
    render_pose_verification_sheet(arm_obj)

    # 5. Author clean custom Blender Python animation suite & export exports/doctor_3d_animated.glb
    author_doctor_animations(arm_obj)

    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for cname in ("Doctor_Coat", "Doctor_HeadHair", "Doctor_BodyGear"):
        bpy.data.objects[cname].select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=EXPORT_ANIM_GLB,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_animations=True,
        export_nla_strips=True,
        export_nla_strips_merged_animation_name="NlaTrack",
        export_def_bones=True,
        export_skins=True,
        export_all_influences=False,
        export_normals=True,
        export_tangents=True,
        export_animation_mode="NLA_TRACKS",
    )
    print("DOCTOR PIPELINE COMPLETE:", EXPORT_RIGGED_GLB, EXPORT_ANIM_GLB)


if __name__ == "__main__":
    main()
