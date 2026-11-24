import math
import os
import sys
import bpy
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
    decimate_parts_to_budget,
    export_runtime_glb,
    pack_parts_to_atlas,
    render_pose_verification_sheet,
    rotate_bone_world,
    smoothstep,
    sync_seam_weights,
    triangulate_mesh,
)

# Isolated anatomical part buckets so limbs have ZERO cross-bleed with head/torso/other limbs
ARM_L_PARTS = ["tripo_part_6", "tripo_part_14", "tripo_part_3", "tripo_part_15", "tripo_part_21", "tripo_part_22", "tripo_part_25"]
ARM_R_PARTS = ["tripo_part_7", "tripo_part_13", "tripo_part_2", "tripo_part_11", "tripo_part_20", "tripo_part_23", "tripo_part_24"]
LEG_L_PARTS = ["tripo_part_4"]
LEG_R_PARTS = ["tripo_part_5"]
HEAD_PARTS = ["tripo_part_18", "tripo_part_8", "tripo_part_9"]
TORSO_PARTS = ["tripo_part_0", "tripo_part_1", "tripo_part_10", "tripo_part_12", "tripo_part_16", "tripo_part_17", "tripo_part_19", "tripo_part_26"]

ARM_L_PTS = [(0.16, -0.13, 0.56), (0.28, -0.11, 0.52), (0.34, -0.14, 0.27), (0.35, -0.22, 0.08), (0.33, -0.32, 0.00)]
ARM_R_PTS = [(-0.16, -0.13, 0.56), (-0.28, -0.11, 0.52), (-0.34, -0.14, 0.27), (-0.35, -0.22, 0.08), (-0.33, -0.32, 0.00)]
LEG_L_PTS = [(0.11, 0.21, 0.42), (0.18, 0.30, 0.20), (0.19, 0.33, 0.06), (0.19, 0.30, 0.00)]
LEG_R_PTS = [(-0.11, 0.21, 0.42), (-0.18, 0.30, 0.20), (-0.19, 0.33, 0.06), (-0.19, 0.30, 0.00)]


def magmir_emissive(rgba):
    r, g, b = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
    molten = (r > 0.46) & (g > 0.20) & (b < 0.18) & (r > g * 1.30)
    em = np.zeros_like(rgba)
    em[molten, 0] = np.clip(r[molten] * 1.45, 0.0, 1.0)
    em[molten, 1] = np.clip(g[molten] * 1.15, 0.0, 1.0)
    em[molten, 2] = b[molten] * 0.25
    em[:, :, 3] = 1.0
    return em


def build_armature():
    arm_data = bpy.data.armatures.new("Magmir_ArmatureData")
    arm_obj = bpy.data.objects.new("Magmir_Armature", arm_data)
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

    add_b("Root", None, (0.0, 0.0, 0.0), (0.0, -0.22, 0.0))
    add_b("Pelvis", "Root", (0.0, 0.22, 0.42), (0.0, 0.08, 0.48))
    add_b("Spine_Mid", "Pelvis", (0.0, 0.08, 0.48), (0.0, -0.06, 0.52))
    add_b("Chest", "Spine_Mid", (0.0, -0.06, 0.52), (0.0, -0.22, 0.55))
    add_b("Neck", "Chest", (0.0, -0.22, 0.55), (0.0, -0.32, 0.51))
    add_b("Head", "Neck", (0.0, -0.32, 0.51), (0.0, -0.46, 0.48))
    add_b("Horn_L", "Chest", (0.10, -0.22, 0.54), (0.24, -0.34, 0.50))
    add_b("Horn_R", "Chest", (-0.10, -0.22, 0.54), (-0.24, -0.34, 0.50))

    # Left & Right Massive Gorilla Forelimbs
    for pref, pts in [("Arm_L", ARM_L_PTS), ("Arm_R", ARM_R_PTS)]:
        add_b(f"{pref}_Clavicle", "Chest", pts[0], pts[1])
        add_b(f"{pref}_Upper", f"{pref}_Clavicle", pts[1], pts[2])
        add_b(f"{pref}_Forearm", f"{pref}_Upper", pts[2], pts[3])
        add_b(f"{pref}_Hand", f"{pref}_Forearm", pts[3], pts[4])
        side = 1.0 if pref.endswith("L") else -1.0
        add_b(f"Fist_Socket_{'L' if side > 0 else 'R'}", f"{pref}_Hand", pts[4], (pts[4][0], pts[4][1] - 0.08, 0.03))

    # Supporting Hindlimbs
    for pref, pts in [("Leg_L", LEG_L_PTS), ("Leg_R", LEG_R_PTS)]:
        add_b(f"{pref}_Thigh", "Pelvis", pts[0], pts[1])
        add_b(f"{pref}_Shin", f"{pref}_Thigh", pts[1], pts[2])
        add_b(f"{pref}_Foot", f"{pref}_Shin", pts[2], pts[3])

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


def skin_magmir(meshes_by_name):
    # 1. Forelimbs
    for pnames, pref, pts in [(ARM_L_PARTS, "Arm_L", ARM_L_PTS), (ARM_R_PARTS, "Arm_R", ARM_R_PTS)]:
        pvecs = [mathutils.Vector(p) for p in pts]
        bnames = [f"{pref}_Clavicle", f"{pref}_Upper", f"{pref}_Forearm", f"{pref}_Hand"]
        for pn in pnames:
            if pn not in meshes_by_name:
                continue
            obj = meshes_by_name[pn]
            per_v = []
            for v in obj.data.vertices:
                s = closest_param_on_polyline(v.co, pvecs)
                wd = {bn: math.exp(-((s - (idx + 0.5)) / 0.65) ** 2) for idx, bn in enumerate(bnames)}
                if s < 0.35:
                    cb = ((0.35 - s) / 0.35) * 0.45
                    wd = {k: val * (1.0 - cb) for k, val in wd.items()}
                    wd["Chest"] = cb
                per_v.append(wd)
            assign_weights_dict(obj, per_v)
            sync_seam_weights(obj)

    # 2. Hindlimbs
    for pnames, pref, pts in [(LEG_L_PARTS, "Leg_L", LEG_L_PTS), (LEG_R_PARTS, "Leg_R", LEG_R_PTS)]:
        pvecs = [mathutils.Vector(p) for p in pts]
        bnames = [f"{pref}_Thigh", f"{pref}_Shin", f"{pref}_Foot"]
        for pn in pnames:
            if pn not in meshes_by_name:
                continue
            obj = meshes_by_name[pn]
            per_v = []
            for v in obj.data.vertices:
                s = closest_param_on_polyline(v.co, pvecs)
                wd = {bn: math.exp(-((s - (idx + 0.5)) / 0.60) ** 2) for idx, bn in enumerate(bnames)}
                if s < 0.35:
                    pb_w = ((0.35 - s) / 0.35) * 0.45
                    wd = {k: val * (1.0 - pb_w) for k, val in wd.items()}
                    wd["Pelvis"] = pb_w
                per_v.append(wd)
            assign_weights_dict(obj, per_v)
            sync_seam_weights(obj)

    # 3. Head & Curved Magma Horns
    for pn in HEAD_PARTS:
        if pn not in meshes_by_name:
            continue
        obj = meshes_by_name[pn]
        if pn == "tripo_part_18":
            assign_weights_dict(obj, [{"Head": 0.90, "Neck": 0.10} for _ in obj.data.vertices])
        elif pn == "tripo_part_8":
            assign_weights_dict(obj, [{"Horn_L": 0.85, "Chest": 0.15} for _ in obj.data.vertices])
        else:
            assign_weights_dict(obj, [{"Horn_R": 0.85, "Chest": 0.15} for _ in obj.data.vertices])
        sync_seam_weights(obj)

    # 4. Torso / Spine
    for pn in TORSO_PARTS:
        if pn not in meshes_by_name:
            continue
        obj = meshes_by_name[pn]
        per_v = []
        for v in obj.data.vertices:
            y = v.co.y
            wp = math.exp(-((y - 0.22) / 0.20) ** 2)
            wm = math.exp(-((y - 0.02) / 0.18) ** 2)
            wc = math.exp(-((y - (-0.20)) / 0.18) ** 2)
            per_v.append({"Pelvis": wp, "Spine_Mid": wm, "Chest": wc})
        assign_weights_dict(obj, per_v)
        sync_seam_weights(obj)


def set_arm(arm, pref, raise_deg=0.0, fwd_deg=0.0, out_deg=0.0, elbow_deg=0.0, wrist_deg=0.0):
    side = 1.0 if pref.endswith("L") else -1.0
    rotate_bone_world(arm, f"{pref}_Clavicle", rx_deg=-raise_deg * 0.28, ry_deg=out_deg * 0.3 * side, rz_deg=fwd_deg * 0.35 * side)
    rotate_bone_world(arm, f"{pref}_Upper", rx_deg=-raise_deg * 0.72 + fwd_deg * 0.65, ry_deg=-out_deg * side, rz_deg=fwd_deg * 0.45 * side)
    rotate_bone_world(arm, f"{pref}_Forearm", rx_deg=-raise_deg * 0.35 + fwd_deg * 0.35 + elbow_deg, ry_deg=-out_deg * 0.35 * side)
    rotate_bone_world(arm, f"{pref}_Hand", rx_deg=wrist_deg)


def set_leg(arm, pref, fwd_deg=0.0, lift_deg=0.0):
    side = 1.0 if pref.endswith("L") else -1.0
    rotate_bone_world(arm, f"{pref}_Thigh", rx_deg=fwd_deg, ry_deg=-lift_deg * 0.5 * side)
    rotate_bone_world(arm, f"{pref}_Shin", rx_deg=-abs(lift_deg) * 0.7 + fwd_deg * 0.4)
    rotate_bone_world(arm, f"{pref}_Foot", rx_deg=lift_deg * 0.4)


def author_animations(arm_obj):
    fps = 30.0
    loc_b = ("Pelvis",)

    def sample_spawn(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        arm.pose.bones["Pelvis"].location = (0.0, 0.0, -0.28 * (1.0 - t) + 0.03 * math.sin(u * math.pi))
        rotate_bone_world(arm, "Chest", rx_deg=18.0 * (1.0 - t))
        set_arm(arm, "Arm_L", raise_deg=25.0 * (1.0 - t), out_deg=14.0 * (1.0 - t))
        set_arm(arm, "Arm_R", raise_deg=25.0 * (1.0 - t), out_deg=14.0 * (1.0 - t))

    def sample_idle(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        b = math.sin(ph)
        arm.pose.bones["Pelvis"].location = (0.014 * math.cos(ph), 0.0, 0.018 * b)
        rotate_bone_world(arm, "Spine_Mid", rx_deg=-2.5 * b)
        rotate_bone_world(arm, "Chest", rx_deg=-3.5 * b, ry_deg=3.0 * math.cos(ph))
        rotate_bone_world(arm, "Head", rx_deg=4.0 * b)
        set_arm(arm, "Arm_L", out_deg=3.0 * b)
        set_arm(arm, "Arm_R", out_deg=-3.0 * b)

    def sample_walk(arm, u):
        clear_pose(arm)
        # Heavy gorilla quadrupedal gait: diagonal weight transfer + shoulder roll + deliberate plant
        ph = u * math.tau
        s, c = math.sin(ph), math.cos(ph)
        lift_l = max(0.0, c)
        lift_r = max(0.0, -c)
        arm.pose.bones["Pelvis"].location = (0.026 * c, -0.02, -0.022 + 0.034 * abs(s))
        rotate_bone_world(arm, "Pelvis", ry_deg=6.0 * s, rz_deg=-6.0 * s)
        rotate_bone_world(arm, "Spine_Mid", rx_deg=4.0 * abs(c), rz_deg=9.0 * s)
        rotate_bone_world(arm, "Chest", ry_deg=-7.0 * s, rz_deg=11.0 * s)
        rotate_bone_world(arm, "Head", rz_deg=-8.0 * s)
        set_arm(arm, "Arm_L", raise_deg=22.0 * lift_l, fwd_deg=24.0 * s, out_deg=6.0)
        set_arm(arm, "Arm_R", raise_deg=22.0 * lift_r, fwd_deg=-24.0 * s, out_deg=6.0)
        set_leg(arm, "Leg_L", fwd_deg=-22.0 * s, lift_deg=22.0 * lift_r)
        set_leg(arm, "Leg_R", fwd_deg=22.0 * s, lift_deg=22.0 * lift_l)

    def sample_turn(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        s, c = math.sin(ph), math.cos(ph)
        arm.pose.bones["Pelvis"].location = (0.0, 0.0, 0.018 * abs(s))
        rotate_bone_world(arm, "Chest", ry_deg=8.0 * s)
        set_arm(arm, "Arm_L", raise_deg=14.0 * max(0.0, c), fwd_deg=14.0 * s, out_deg=10.0)
        set_arm(arm, "Arm_R", raise_deg=14.0 * max(0.0, -c), fwd_deg=-14.0 * s, out_deg=10.0)

    def sample_slam(arm, u):
        clear_pose(arm)
        # 1.38s: [0..0.44] massive windup rearing upper body + raising BOTH arms overhead -> [0.44..0.54] violent slam -> recover
        if u < 0.44:
            t = smoothstep(u / 0.44)
            arm.pose.bones["Pelvis"].location = (0.0, 0.05 * t, -0.04 * t + 0.09 * t)
            rotate_bone_world(arm, "Pelvis", rx_deg=-18.0 * t)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=-16.0 * t)
            rotate_bone_world(arm, "Chest", rx_deg=-20.0 * t)
            rotate_bone_world(arm, "Head", rx_deg=14.0 * t)
            set_arm(arm, "Arm_L", raise_deg=96.0 * t, fwd_deg=18.0 * t, out_deg=22.0 * t, elbow_deg=-26.0 * t)
            set_arm(arm, "Arm_R", raise_deg=96.0 * t, fwd_deg=18.0 * t, out_deg=22.0 * t, elbow_deg=-26.0 * t)
            set_leg(arm, "Leg_L", fwd_deg=12.0 * t)
            set_leg(arm, "Leg_R", fwd_deg=12.0 * t)
        elif u < 0.56:
            t = smoothstep((u - 0.44) / 0.12)
            arm.pose.bones["Pelvis"].location = (0.0, -0.06 * t, 0.05 - 0.145 * t)
            rotate_bone_world(arm, "Pelvis", rx_deg=-18.0 + 30.0 * t)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=-16.0 + 30.0 * t)
            rotate_bone_world(arm, "Chest", rx_deg=-20.0 + 38.0 * t)
            set_arm(arm, "Arm_L", raise_deg=96.0 * (1.0 - t) - 18.0 * t, fwd_deg=26.0, out_deg=10.0)
            set_arm(arm, "Arm_R", raise_deg=96.0 * (1.0 - t) - 18.0 * t, fwd_deg=26.0, out_deg=10.0)
        elif u < 0.72:
            # Impact hold / recoil absorb on ground
            trem = 0.012 * math.sin((u - 0.56) * 90.0)
            arm.pose.bones["Pelvis"].location = (trem, -0.06, -0.095)
            rotate_bone_world(arm, "Pelvis", rx_deg=12.0)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=14.0)
            rotate_bone_world(arm, "Chest", rx_deg=18.0)
            set_arm(arm, "Arm_L", raise_deg=-16.0, fwd_deg=26.0, out_deg=10.0)
            set_arm(arm, "Arm_R", raise_deg=-16.0, fwd_deg=26.0, out_deg=10.0)
        else:
            t = 1.0 - smoothstep((u - 0.72) / 0.28)
            arm.pose.bones["Pelvis"].location = (0.0, -0.06 * t, -0.095 * t)
            rotate_bone_world(arm, "Pelvis", rx_deg=12.0 * t)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=14.0 * t)
            rotate_bone_world(arm, "Chest", rx_deg=18.0 * t)
            set_arm(arm, "Arm_L", raise_deg=-16.0 * t, fwd_deg=26.0 * t, out_deg=10.0 * t)
            set_arm(arm, "Arm_R", raise_deg=-16.0 * t, fwd_deg=26.0 * t, out_deg=10.0 * t)

    def sample_punch(arm, u, strike_side: str):
        clear_pose(arm)
        sgn = 1.0 if strike_side == "L" else -1.0
        punch_arm = f"Arm_{strike_side}"
        brace_arm = "Arm_R" if strike_side == "L" else "Arm_L"
        # [0..0.38] pull punch shoulder deep back, twist torso & brace opposite hand -> [0.38..0.52] heavy punch -> recover
        if u < 0.38:
            t = smoothstep(u / 0.38)
            arm.pose.bones["Pelvis"].location = (0.03 * sgn * t, 0.04 * t, -0.045 * t)
            rotate_bone_world(arm, "Pelvis", rx_deg=-6.0 * t, rz_deg=-16.0 * sgn * t)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=-10.0 * t, rz_deg=-22.0 * sgn * t)
            rotate_bone_world(arm, "Chest", rx_deg=-12.0 * t, rz_deg=-28.0 * sgn * t)
            rotate_bone_world(arm, "Head", rz_deg=28.0 * sgn * t)
            set_arm(arm, punch_arm, raise_deg=55.0 * t, fwd_deg=-42.0 * t, out_deg=24.0 * t, elbow_deg=-48.0 * t)
            set_arm(arm, brace_arm, raise_deg=-10.0 * t, out_deg=14.0 * t)
        elif u < 0.56:
            t = smoothstep((u - 0.38) / 0.14)
            arm.pose.bones["Pelvis"].location = (-0.04 * sgn * t, -0.08 * t, -0.055 * t)
            rotate_bone_world(arm, "Pelvis", rx_deg=8.0 * t, rz_deg=(-16.0 + 38.0 * t) * sgn)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=12.0 * t, rz_deg=(-22.0 + 52.0 * t) * sgn)
            rotate_bone_world(arm, "Chest", rx_deg=16.0 * t, rz_deg=(-28.0 + 64.0 * t) * sgn)
            rotate_bone_world(arm, "Head", rz_deg=(28.0 - 44.0 * t) * sgn)
            set_arm(arm, punch_arm, raise_deg=55.0 - 22.0 * t, fwd_deg=-42.0 + 110.0 * t, out_deg=24.0 * (1.0 - t), elbow_deg=-48.0 * (1.0 - t))
            set_arm(arm, brace_arm, raise_deg=-10.0, fwd_deg=-18.0 * t, out_deg=18.0)
        else:
            t = 1.0 - smoothstep((u - 0.56) / 0.44)
            arm.pose.bones["Pelvis"].location = (-0.04 * sgn * t, -0.08 * t, -0.055 * t)
            rotate_bone_world(arm, "Pelvis", rx_deg=8.0 * t, rz_deg=22.0 * sgn * t)
            rotate_bone_world(arm, "Spine_Mid", rx_deg=12.0 * t, rz_deg=30.0 * sgn * t)
            rotate_bone_world(arm, "Chest", rx_deg=16.0 * t, rz_deg=36.0 * sgn * t)
            rotate_bone_world(arm, "Head", rz_deg=-16.0 * sgn * t)
            set_arm(arm, punch_arm, raise_deg=33.0 * t, fwd_deg=68.0 * t)
            set_arm(arm, brace_arm, raise_deg=-10.0 * t, fwd_deg=-18.0 * t, out_deg=18.0 * t)

    def sample_hit(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.pi)
        arm.pose.bones["Pelvis"].location = (0.0, 0.04 * s, 0.02 * s)
        rotate_bone_world(arm, "Chest", rx_deg=-14.0 * s, ry_deg=9.0 * s)
        rotate_bone_world(arm, "Head", rx_deg=-18.0 * s)

    def sample_death(arm, u):
        clear_pose(arm)
        e = smoothstep(min(1.0, u / 0.78))
        arm.pose.bones["Pelvis"].location = (0.0, 0.0, -0.26 * e)
        rotate_bone_world(arm, "Pelvis", rx_deg=20.0 * e, ry_deg=18.0 * e)
        rotate_bone_world(arm, "Chest", rx_deg=18.0 * e)
        set_arm(arm, "Arm_L", raise_deg=-25.0 * e, out_deg=32.0 * e)
        set_arm(arm, "Arm_R", raise_deg=-25.0 * e, out_deg=32.0 * e)

    build_nla_action(arm_obj, "Spawn", 0.95, fps, sample_spawn, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Idle", 2.40, fps, sample_idle, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Walk", 0.88, fps, sample_walk, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Turn", 0.80, fps, sample_turn, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Attack_Slam", 1.38, fps, sample_slam, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Attack_Punch_R", 1.08, fps, lambda a, u: sample_punch(a, u, "R"), cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Attack_Punch_L", 1.08, fps, lambda a, u: sample_punch(a, u, "L"), cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Hit_React", 0.22, fps, sample_hit, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Death", 1.15, fps, sample_death, cyclic=False, loc_bones=loc_b)
    clear_pose(arm_obj)


def main():
    src = backup_original_glb("Magmir.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = clean_imported_gltf()
    meshes_by_name = {m.name: m for m in meshes}

    shared_mat, _ = pack_parts_to_atlas(
        meshes,
        "Magmir_Atlas",
        base_size=2048,
        norm_size=1024,
        em_size=1024,
        emissive_fn=magmir_emissive,
        roughness_val=0.62,
        metallic_val=0.14,
        normal_strength=0.75,
        emission_strength=1.55,
    )

    # Plant lowest knuckle/foot vertices flush to z=0.000
    min_z = min(v.co.z for m in meshes for v in m.data.vertices)
    if abs(min_z) > 0.0005:
        for m in meshes:
            for v in m.data.vertices:
                v.co.z -= min_z
            m.data.update()

    decimate_parts_to_budget(meshes, 10500, min_part_faces=220)
    arm_obj = build_armature()
    skin_magmir(meshes_by_name)

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = "Magmir_Mesh"
    body_obj.data.name = "Magmir_MeshData"
    body_obj.data.materials.clear()
    body_obj.data.materials.append(shared_mat)
    triangulate_mesh(body_obj)

    body_obj.parent = arm_obj
    mod = body_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj

    def pose_walk():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Chest", ry_deg=-7.0, rz_deg=11.0)
        set_arm(arm_obj, "Arm_L", raise_deg=22.0, fwd_deg=24.0, out_deg=6.0)
        set_arm(arm_obj, "Arm_R", raise_deg=0.0, fwd_deg=-24.0, out_deg=6.0)
        set_leg(arm_obj, "Leg_L", fwd_deg=-22.0, lift_deg=0.0)
        set_leg(arm_obj, "Leg_R", fwd_deg=22.0, lift_deg=22.0)

    def pose_slam_raise():
        clear_pose(arm_obj)
        arm_obj.pose.bones["Pelvis"].location = (0.0, 0.05, 0.05)
        rotate_bone_world(arm_obj, "Pelvis", rx_deg=-18.0)
        rotate_bone_world(arm_obj, "Spine_Mid", rx_deg=-16.0)
        rotate_bone_world(arm_obj, "Chest", rx_deg=-20.0)
        set_arm(arm_obj, "Arm_L", raise_deg=96.0, fwd_deg=18.0, out_deg=22.0, elbow_deg=-26.0)
        set_arm(arm_obj, "Arm_R", raise_deg=96.0, fwd_deg=18.0, out_deg=22.0, elbow_deg=-26.0)

    def pose_slam_hit():
        clear_pose(arm_obj)
        arm_obj.pose.bones["Pelvis"].location = (0.0, -0.06, -0.095)
        rotate_bone_world(arm_obj, "Pelvis", rx_deg=12.0)
        rotate_bone_world(arm_obj, "Spine_Mid", rx_deg=14.0)
        rotate_bone_world(arm_obj, "Chest", rx_deg=18.0)
        set_arm(arm_obj, "Arm_L", raise_deg=-16.0, fwd_deg=26.0, out_deg=10.0)
        set_arm(arm_obj, "Arm_R", raise_deg=-16.0, fwd_deg=26.0, out_deg=10.0)

    def pose_punch_r():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Pelvis", rx_deg=8.0, rz_deg=-22.0)
        rotate_bone_world(arm_obj, "Spine_Mid", rx_deg=12.0, rz_deg=-30.0)
        rotate_bone_world(arm_obj, "Chest", rx_deg=16.0, rz_deg=-36.0)
        set_arm(arm_obj, "Arm_R", raise_deg=33.0, fwd_deg=68.0)
        set_arm(arm_obj, "Arm_L", raise_deg=-10.0, fwd_deg=-18.0, out_deg=18.0)

    render_pose_verification_sheet(
        arm_obj,
        os.path.join(SCRATCH_DIR, "verify_magmir.png"),
        [
            ("walk", pose_walk, ((1.15, -1.10, 0.85), (0.0, 0.0, 0.42))),
            ("slam_raise", pose_slam_raise, ((0.95, -1.45, 0.90), (0.0, 0.0, 0.48))),
            ("slam_impact", pose_slam_hit, ((-1.05, -1.35, 0.78), (0.0, 0.0, 0.36))),
            ("punch_r", pose_punch_r, ((0.20, -1.55, 0.78), (0.0, 0.0, 0.44))),
        ],
    )

    author_animations(arm_obj)
    export_runtime_glb(arm_obj, [body_obj], os.path.join(RUNTIME_MODELS_DIR, "magmir_3d.glb"))


if __name__ == "__main__":
    main()
