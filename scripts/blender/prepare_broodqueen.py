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
    decimate_mesh,
    decimate_parts_to_budget,
    export_runtime_glb,
    pack_parts_to_atlas,
    render_pose_verification_sheet,
    rotate_bone_world,
    smoothstep,
    sync_seam_weights,
    triangulate_mesh,
)

# Strict isolated anatomical groups (0% wing<->body or wing<->wing cross bleed)
WING_L_PARTS = ["tripo_part_3", "tripo_part_5", "tripo_part_7", "tripo_part_10", "tripo_part_11"]
WING_R_PARTS = ["tripo_part_2", "tripo_part_4", "tripo_part_6"]
HEAD_PARTS = ["tripo_part_0", "tripo_part_9", "tripo_part_15", "tripo_part_16", "tripo_part_13"]
ABDOMEN_PARTS = ["tripo_part_12"]
THORAX_PARTS = ["tripo_part_1", "tripo_part_8", "tripo_part_14"]


def broodqueen_emissive(rgba):
    r, g, b = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
    magenta_sac = (r > 0.44) & (b > 0.36) & (g < 0.24)
    bright_pink = (r > 0.56) & (b > 0.44) & (g < r * 0.65)
    em = np.zeros_like(rgba)
    mask = magenta_sac | bright_pink
    em[mask, 0] = np.clip(r[mask] * 1.45, 0.0, 1.0)
    em[mask, 1] = np.clip(g[mask] * 0.55, 0.0, 1.0)
    em[mask, 2] = np.clip(b[mask] * 1.40, 0.0, 1.0)
    em[:, :, 3] = 1.0
    return em


def build_armature():
    arm_data = bpy.data.armatures.new("BroodQueen_ArmatureData")
    arm_obj = bpy.data.objects.new("BroodQueen_Armature", arm_data)
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

    add_b("Root", None, (0.0, 0.0, 0.0), (0.0, -0.20, 0.0))
    add_b("Thorax", "Root", (0.0, -0.06, 0.23), (0.0, -0.22, 0.30))
    add_b("Neck", "Thorax", (0.0, -0.22, 0.30), (0.0, -0.29, 0.34))
    add_b("Head_Crown", "Neck", (0.0, -0.29, 0.34), (0.0, -0.40, 0.38))
    add_b("Spike_Socket_L", "Head_Crown", (0.07, -0.32, 0.30), (0.10, -0.42, 0.29))
    add_b("Spike_Socket_R", "Head_Crown", (-0.07, -0.32, 0.30), (-0.10, -0.42, 0.29))

    # Articulated hanging reproductive abdomen + sacrificial brood birth socket
    add_b("Abdomen_01", "Thorax", (0.0, -0.02, 0.22), (0.0, 0.05, 0.16))
    add_b("Abdomen_02", "Abdomen_01", (0.0, 0.05, 0.16), (0.0, 0.11, 0.09))
    add_b("Abdomen_03", "Abdomen_02", (0.0, 0.11, 0.09), (0.0, 0.16, 0.03))
    add_b("Brood_Birth_Socket", "Abdomen_03", (0.0, 0.15, 0.02), (0.0, 0.22, -0.02))

    # Left & Right 7-Bone Wings with flexible trailing membrane bones
    for pref, sgn in [("Wing_L", 1.0), ("Wing_R", -1.0)]:
        add_b(f"{pref}_Shoulder", "Thorax", (0.05 * sgn, -0.14, 0.27), (0.14 * sgn, -0.06, 0.33))
        add_b(f"{pref}_Humerus", f"{pref}_Shoulder", (0.14 * sgn, -0.06, 0.33), (0.24 * sgn, 0.03, 0.40))
        add_b(f"{pref}_Forearm", f"{pref}_Humerus", (0.24 * sgn, 0.03, 0.40), (0.35 * sgn, 0.12, 0.43))
        add_b(f"{pref}_Manus", f"{pref}_Forearm", (0.35 * sgn, 0.12, 0.43), (0.45 * sgn, 0.20, 0.42))
        add_b(f"{pref}_Tip", f"{pref}_Manus", (0.45 * sgn, 0.20, 0.42), (0.50 * sgn, 0.28, 0.38))
        add_b(f"{pref}_Membrane_In", f"{pref}_Humerus", (0.21 * sgn, 0.06, 0.32), (0.22 * sgn, 0.26, 0.24))
        add_b(f"{pref}_Membrane_Out", f"{pref}_Forearm", (0.34 * sgn, 0.14, 0.34), (0.37 * sgn, 0.36, 0.24))

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


def skin_broodqueen(meshes_by_name):
    # 1. Left & Right Wings (zero cross-bleed to body/opposite wing)
    for parts, pref, sgn in [(WING_L_PARTS, "Wing_L", 1.0), (WING_R_PARTS, "Wing_R", -1.0)]:
        for pn in parts:
            if pn not in meshes_by_name:
                continue
            obj = meshes_by_name[pn]
            per_v = []
            for v in obj.data.vertices:
                ax = abs(v.co.x)
                y = v.co.y
                # Span wise progression Shoulder -> Tip
                w_sh = math.exp(-((ax - 0.10) / 0.075) ** 2)
                w_hu = math.exp(-((ax - 0.20) / 0.085) ** 2)
                w_fa = math.exp(-((ax - 0.31) / 0.090) ** 2)
                w_ma = math.exp(-((ax - 0.41) / 0.075) ** 2)
                w_tp = math.exp(-((ax - 0.48) / 0.060) ** 2)
                # Membrane trailing flap weights back along +Y wing edge
                trail = max(0.0, min(1.0, (y - 0.06) / 0.24)) * (1.0 - max(0.0, min(1.0, (v.co.z - 0.33) / 0.12)))
                in_m = math.exp(-((ax - 0.21) / 0.09) ** 2) * trail
                out_m = math.exp(-((ax - 0.37) / 0.10) ** 2) * trail
                wd = {
                    f"{pref}_Shoulder": w_sh,
                    f"{pref}_Humerus": w_hu * (1.0 - trail * 0.72),
                    f"{pref}_Forearm": w_fa * (1.0 - trail * 0.72),
                    f"{pref}_Manus": w_ma * (1.0 - trail * 0.50),
                    f"{pref}_Tip": w_tp,
                    f"{pref}_Membrane_In": in_m,
                    f"{pref}_Membrane_Out": out_m,
                }
                if ax < 0.08:
                    tb = (0.08 - ax) / 0.08 * 0.35
                    wd = {k: val * (1.0 - tb) for k, val in wd.items()}
                    wd["Thorax"] = tb
                per_v.append(wd)
            assign_weights_dict(obj, per_v)
            sync_seam_weights(obj)

    # 2. Head & Crown
    for pn in HEAD_PARTS:
        if pn not in meshes_by_name:
            continue
        obj = meshes_by_name[pn]
        per_v = []
        for v in obj.data.vertices:
            y = v.co.y
            hw = max(0.25, min(1.0, (-0.21 - y) / 0.14))
            per_v.append({"Head_Crown": hw, "Neck": 1.0 - hw})
        assign_weights_dict(obj, per_v)
        sync_seam_weights(obj)

    # 3. Reproductive Abdomen (segmented flexible hang)
    for pn in ABDOMEN_PARTS:
        if pn not in meshes_by_name:
            continue
        obj = meshes_by_name[pn]
        per_v = []
        for v in obj.data.vertices:
            y = v.co.y
            w1 = math.exp(-((y - (-0.01)) / 0.09) ** 2)
            w2 = math.exp(-((y - 0.08) / 0.085) ** 2)
            w3 = math.exp(-((y - 0.17) / 0.085) ** 2)
            wd = {"Abdomen_01": w1, "Abdomen_02": w2, "Abdomen_03": w3}
            if y < -0.02 and v.co.z > 0.16:
                wd["Thorax"] = 0.28
            per_v.append(wd)
        assign_weights_dict(obj, per_v)
        sync_seam_weights(obj)

    # 4. Thorax / Sternum
    for pn in THORAX_PARTS:
        if pn not in meshes_by_name:
            continue
        obj = meshes_by_name[pn]
        per_v = []
        for v in obj.data.vertices:
            y = v.co.y
            if y > 0.06:
                per_v.append({"Thorax": 0.45, "Abdomen_01": 0.55})
            elif y < -0.22:
                per_v.append({"Thorax": 0.55, "Neck": 0.45})
            else:
                per_v.append({"Thorax": 1.0})
        assign_weights_dict(obj, per_v)
        sync_seam_weights(obj)


def set_wing_flap(arm, pref, flap_phase: float, amp: float = 1.0, sweep_back: float = 0.0, pitch_deg: float = 0.0):
    """Organic progressive wingbeat: shoulder drives downstroke/upstroke while outer segments & membrane lag smoothly."""
    side = 1.0 if pref.endswith("L") else -1.0
    # Asymmetric beat waveform: crisper downstroke, buoyant lofted upstroke
    sh_s = math.sin(flap_phase)
    hu_s = math.sin(flap_phase - 0.42)
    fa_s = math.sin(flap_phase - 0.88)
    ma_s = math.sin(flap_phase - 1.32)
    tp_s = math.sin(flap_phase - 1.70)
    mem_s = math.cos(flap_phase - 0.65)

    rotate_bone_world(arm, f"{pref}_Shoulder", rx_deg=pitch_deg, ry_deg=sh_s * 24.0 * amp * side, rz_deg=sweep_back * 12.0 * side)
    rotate_bone_world(arm, f"{pref}_Humerus", rx_deg=pitch_deg * 0.5, ry_deg=hu_s * 18.0 * amp * side, rz_deg=(sh_s * 8.0 - sweep_back * 14.0) * side)
    rotate_bone_world(arm, f"{pref}_Forearm", ry_deg=fa_s * 16.0 * amp * side, rz_deg=-sweep_back * 10.0 * side)
    rotate_bone_world(arm, f"{pref}_Manus", ry_deg=ma_s * 14.0 * amp * side)
    rotate_bone_world(arm, f"{pref}_Tip", ry_deg=tp_s * 16.0 * amp * side)
    # Membrane billows upward on downstroke (lift compression) & streams on upstroke
    rotate_bone_world(arm, f"{pref}_Membrane_In", rx_deg=-16.0 * mem_s * amp, ry_deg=mem_s * 10.0 * side * amp)
    rotate_bone_world(arm, f"{pref}_Membrane_Out", rx_deg=-22.0 * mem_s * amp, ry_deg=mem_s * 14.0 * side * amp)


def pose_abdomen(arm, curl_deg: float, sway_deg: float):
    rotate_bone_world(arm, "Abdomen_01", rx_deg=curl_deg * 0.35, rz_deg=sway_deg * 0.4)
    rotate_bone_world(arm, "Abdomen_02", rx_deg=curl_deg * 0.45, rz_deg=sway_deg * 0.7)
    rotate_bone_world(arm, "Abdomen_03", rx_deg=curl_deg * 0.55, rz_deg=sway_deg * 1.0)


def author_animations(arm_obj):
    fps = 30.0
    loc_b = ("Thorax",)
    scale_b = ("Abdomen_02", "Abdomen_03")

    def sample_spawn(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        arm.pose.bones["Thorax"].location = (0.0, 0.0, -0.25 * (1.0 - t) + 0.04 * math.sin(u * math.pi))
        rotate_bone_world(arm, "Thorax", rx_deg=-20.0 * (1.0 - t))
        set_wing_flap(arm, "Wing_L", u * math.tau * 2.0, amp=1.25)
        set_wing_flap(arm, "Wing_R", u * math.tau * 2.0, amp=1.25)
        pose_abdomen(arm, 16.0 * (1.0 - t), 0.0)

    def sample_idle(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        # Peak wing downstroke lifts Thorax +Z cleanly for unmistakable impression of aerodynamic lift
        lift = -math.sin(ph - 0.35)
        arm.pose.bones["Thorax"].location = (0.0, 0.0, 0.038 * lift)
        rotate_bone_world(arm, "Thorax", rx_deg=-5.0 + 4.0 * math.cos(ph))
        rotate_bone_world(arm, "Head_Crown", rx_deg=5.0 - 4.0 * math.cos(ph))
        set_wing_flap(arm, "Wing_L", ph, amp=1.05, pitch_deg=-8.0 * math.sin(ph))
        set_wing_flap(arm, "Wing_R", ph, amp=1.05, pitch_deg=-8.0 * math.sin(ph))
        pose_abdomen(arm, 4.0 * math.sin(ph - 0.7), 3.5 * math.cos(ph))

    def sample_walk(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        lift = -math.sin(ph - 0.30)
        arm.pose.bones["Thorax"].location = (0.0, -0.02, 0.032 * lift)
        rotate_bone_world(arm, "Thorax", rx_deg=-18.0 + 4.0 * math.cos(ph))
        rotate_bone_world(arm, "Head_Crown", rx_deg=14.0)
        set_wing_flap(arm, "Wing_L", ph, amp=1.15, sweep_back=0.55, pitch_deg=-10.0 * math.sin(ph))
        set_wing_flap(arm, "Wing_R", ph, amp=1.15, sweep_back=0.55, pitch_deg=-10.0 * math.sin(ph))
        pose_abdomen(arm, -14.0 + 6.0 * math.sin(ph - 0.6), 4.0 * math.cos(ph))

    def sample_turn(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        lift = -math.sin(ph - 0.30)
        arm.pose.bones["Thorax"].location = (0.0, 0.0, 0.03 * lift)
        rotate_bone_world(arm, "Thorax", rx_deg=-10.0, ry_deg=12.0 * math.sin(ph))
        set_wing_flap(arm, "Wing_L", ph, amp=1.1, sweep_back=0.3)
        set_wing_flap(arm, "Wing_R", ph + 0.15, amp=1.1, sweep_back=0.3)
        pose_abdomen(arm, -6.0, 12.0 * math.sin(ph - 0.4))

    def sample_twin_spikes(arm, u):
        clear_pose(arm)
        # 1.10s: [0..0.72] braking wing flare + head/thorax coil -> [0.72..0.84] spit Twin Bone Spikes + recoil -> recover
        if u < 0.72:
            t = smoothstep(u / 0.72)
            arm.pose.bones["Thorax"].location = (0.0, 0.05 * t, 0.04 * t)
            rotate_bone_world(arm, "Thorax", rx_deg=14.0 * t)
            rotate_bone_world(arm, "Neck", rx_deg=12.0 * t)
            rotate_bone_world(arm, "Head_Crown", rx_deg=16.0 * t)
            set_wing_flap(arm, "Wing_L", u * math.tau * 1.5, amp=0.95, sweep_back=-0.45 * t, pitch_deg=12.0 * t)
            set_wing_flap(arm, "Wing_R", u * math.tau * 1.5, amp=0.95, sweep_back=-0.45 * t, pitch_deg=12.0 * t)
            pose_abdomen(arm, 10.0 * t, 0.0)
        elif u < 0.86:
            t = smoothstep((u - 0.72) / 0.14)
            snap = math.sin(t * math.pi)
            arm.pose.bones["Thorax"].location = (0.0, 0.05 + 0.04 * snap, 0.04 - 0.03 * snap)
            rotate_bone_world(arm, "Thorax", rx_deg=14.0 - 30.0 * snap)
            rotate_bone_world(arm, "Head_Crown", rx_deg=16.0 - 34.0 * snap)
            set_wing_flap(arm, "Wing_L", math.pi * 0.5 + t * 2.4, amp=1.25, sweep_back=0.55)
            set_wing_flap(arm, "Wing_R", math.pi * 0.5 + t * 2.4, amp=1.25, sweep_back=0.55)
            pose_abdomen(arm, 10.0 - 22.0 * snap, 0.0)
        else:
            t = 1.0 - smoothstep((u - 0.86) / 0.14)
            arm.pose.bones["Thorax"].location = (0.0, 0.03 * t, 0.02 * t)
            rotate_bone_world(arm, "Thorax", rx_deg=-8.0 * t)
            set_wing_flap(arm, "Wing_L", u * math.tau, amp=1.0)
            set_wing_flap(arm, "Wing_R", u * math.tau, amp=1.0)

    def sample_spawn_brood(arm, u):
        clear_pose(arm)
        # 1.25s: [0..0.62] upright reproductive contraction -> [0.62..0.76] drop broodling + lift beat -> recover
        if u < 0.62:
            t = smoothstep(u / 0.62)
            pulse = 1.0 + 0.22 * math.sin(u * math.tau * 3.0) * t
            arm.pose.bones["Thorax"].location = (0.0, 0.0, 0.055 * t)
            rotate_bone_world(arm, "Thorax", rx_deg=18.0 * t)
            set_wing_flap(arm, "Wing_L", u * math.tau * 2.0, amp=1.15)
            set_wing_flap(arm, "Wing_R", u * math.tau * 2.0, amp=1.15)
            pose_abdomen(arm, -24.0 * t, 0.0)
            arm.pose.bones["Abdomen_02"].scale = (pulse, pulse, 1.0 + 0.14 * t)
            arm.pose.bones["Abdomen_03"].scale = (pulse, pulse, 1.0 + 0.20 * t)
        elif u < 0.78:
            t = smoothstep((u - 0.62) / 0.16)
            pop = math.sin(t * math.pi)
            arm.pose.bones["Thorax"].location = (0.0, 0.0, 0.055 + 0.045 * pop)
            rotate_bone_world(arm, "Thorax", rx_deg=18.0 - 20.0 * pop)
            set_wing_flap(arm, "Wing_L", 1.2 + t * 2.8, amp=1.30)
            set_wing_flap(arm, "Wing_R", 1.2 + t * 2.8, amp=1.30)
            pose_abdomen(arm, -24.0 + 36.0 * pop, 0.0)
            arm.pose.bones["Abdomen_03"].scale = (1.28 * (1.0 - t) + t, 1.28 * (1.0 - t) + t, 1.0)
        else:
            t = 1.0 - smoothstep((u - 0.78) / 0.22)
            arm.pose.bones["Thorax"].location = (0.0, 0.0, 0.04 * t)
            rotate_bone_world(arm, "Thorax", rx_deg=10.0 * t)
            set_wing_flap(arm, "Wing_L", u * math.tau * 1.5, amp=1.05)
            set_wing_flap(arm, "Wing_R", u * math.tau * 1.5, amp=1.05)
            pose_abdomen(arm, 8.0 * t, 0.0)

    def sample_brood_dive(arm, u):
        clear_pose(arm)
        ph = u * math.tau * 2.0
        arm.pose.bones["Thorax"].location = (0.0, -0.025, 0.025 * math.sin(ph))
        rotate_bone_world(arm, "Thorax", rx_deg=-26.0)
        rotate_bone_world(arm, "Head_Crown", rx_deg=16.0)
        set_wing_flap(arm, "Wing_L", ph, amp=1.25, sweep_back=0.80)
        set_wing_flap(arm, "Wing_R", ph, amp=1.25, sweep_back=0.80)
        pose_abdomen(arm, -18.0 + 8.0 * math.sin(ph), 5.0 * math.cos(ph))

    def sample_hit(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.pi)
        arm.pose.bones["Thorax"].location = (0.0, 0.04 * s, 0.03 * s)
        rotate_bone_world(arm, "Thorax", rx_deg=18.0 * s, ry_deg=12.0 * s)
        set_wing_flap(arm, "Wing_L", u * math.pi, amp=1.2, sweep_back=-0.4)
        set_wing_flap(arm, "Wing_R", u * math.pi, amp=1.2, sweep_back=-0.4)

    def sample_death(arm, u):
        clear_pose(arm)
        e = smoothstep(min(1.0, u / 0.80))
        arm.pose.bones["Thorax"].location = (0.0, 0.0, -0.22 * e)
        rotate_bone_world(arm, "Thorax", rx_deg=28.0 * e, ry_deg=24.0 * e)
        set_wing_flap(arm, "Wing_L", 1.8 * e, amp=0.95)
        set_wing_flap(arm, "Wing_R", 2.1 * e, amp=0.95)
        pose_abdomen(arm, 16.0 * e, 10.0 * e)

    build_nla_action(arm_obj, "Spawn", 0.90, fps, sample_spawn, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Idle", 1.12, fps, sample_idle, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Walk", 0.88, fps, sample_walk, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Turn", 0.85, fps, sample_turn, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_TwinSpikes", 1.10, fps, sample_twin_spikes, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_SpawnBrood", 1.25, fps, sample_spawn_brood, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Brood_Dive", 0.52, fps, sample_brood_dive, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Hit_React", 0.24, fps, sample_hit, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Death", 1.10, fps, sample_death, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    clear_pose(arm_obj)


def run_build(out_filename: str, target_tris: int, atlas_size: int, norm_size: int, render_sheet: bool):
    src = backup_original_glb("Broodqueen.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = clean_imported_gltf()
    meshes_by_name = {m.name: m for m in meshes}

    shared_mat, _ = pack_parts_to_atlas(
        meshes,
        f"{os.path.splitext(out_filename)[0]}_Atlas",
        base_size=atlas_size,
        norm_size=norm_size,
        em_size=norm_size,
        emissive_fn=broodqueen_emissive,
        roughness_val=0.46,
        metallic_val=0.14,
        normal_strength=0.70,
        emission_strength=1.55 if "broodling" in out_filename else 1.40,
    )

    decimate_parts_to_budget(meshes, target_tris, min_part_faces=90)
    arm_obj = build_armature()
    skin_broodqueen(meshes_by_name)

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = f"{os.path.splitext(out_filename)[0]}_Mesh"
    body_obj.data.name = f"{os.path.splitext(out_filename)[0]}_MeshData"
    body_obj.data.materials.clear()
    body_obj.data.materials.append(shared_mat)
    triangulate_mesh(body_obj)

    body_obj.parent = arm_obj
    mod = body_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj

    if render_sheet:
        def pose_wings_down():
            clear_pose(arm_obj)
            set_wing_flap(arm_obj, "Wing_L", math.pi * 0.5, amp=1.15)
            set_wing_flap(arm_obj, "Wing_R", math.pi * 0.5, amp=1.15)

        def pose_wings_up():
            clear_pose(arm_obj)
            set_wing_flap(arm_obj, "Wing_L", -math.pi * 0.5, amp=1.15, sweep_back=0.5)
            set_wing_flap(arm_obj, "Wing_R", -math.pi * 0.5, amp=1.15, sweep_back=0.5)

        def pose_spikes_prep():
            clear_pose(arm_obj)
            rotate_bone_world(arm_obj, "Thorax", rx_deg=14.0)
            rotate_bone_world(arm_obj, "Head_Crown", rx_deg=16.0)
            set_wing_flap(arm_obj, "Wing_L", 0.4, amp=0.95, sweep_back=-0.45)
            set_wing_flap(arm_obj, "Wing_R", 0.4, amp=0.95, sweep_back=-0.45)

        def pose_birth():
            clear_pose(arm_obj)
            rotate_bone_world(arm_obj, "Thorax", rx_deg=18.0)
            pose_abdomen(arm_obj, -24.0, 0.0)
            arm_obj.pose.bones["Abdomen_02"].scale = (1.22, 1.22, 1.15)
            arm_obj.pose.bones["Abdomen_03"].scale = (1.25, 1.25, 1.20)
            set_wing_flap(arm_obj, "Wing_L", -0.8, amp=1.15)
            set_wing_flap(arm_obj, "Wing_R", -0.8, amp=1.15)

        render_pose_verification_sheet(
            arm_obj,
            os.path.join(SCRATCH_DIR, "verify_broodqueen.png"),
            [
                ("downstroke", pose_wings_down, ((0.35, -1.35, 0.72), (0.0, 0.0, 0.24))),
                ("upstroke", pose_wings_up, ((-1.15, -0.85, 0.65), (0.0, 0.0, 0.25))),
                ("spikes_prep", pose_spikes_prep, ((0.90, -1.05, 0.55), (0.0, -0.05, 0.26))),
                ("spawn_brood", pose_birth, ((1.10, 0.75, 0.52), (0.0, 0.05, 0.18))),
            ],
        )

    author_animations(arm_obj)
    export_runtime_glb(arm_obj, [body_obj], os.path.join(RUNTIME_MODELS_DIR, out_filename))


def main():
    run_build("brood_queen_3d.glb", target_tris=8200, atlas_size=2048, norm_size=1024, render_sheet=True)
    run_build("broodling_3d.glb", target_tris=2800, atlas_size=1024, norm_size=512, render_sheet=False)


if __name__ == "__main__":
    main()
