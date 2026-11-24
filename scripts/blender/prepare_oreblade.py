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

# 4 Clawed Legs: (parts, upper_joint, knee_joint, foot_tip)
LEG_DEFS = {
    "Leg_FL": (["tripo_part_6", "tripo_part_14"], (0.14, -0.17, 0.25), (0.20, -0.27, 0.16), (0.21, -0.32, 0.0)),
    "Leg_FR": (["tripo_part_8", "tripo_part_17"], (-0.12, -0.21, 0.25), (-0.17, -0.30, 0.15), (-0.18, -0.34, 0.0)),
    "Leg_RL": (["tripo_part_13", "tripo_part_12"], (0.13, 0.18, 0.24), (0.18, 0.28, 0.15), (0.19, 0.32, 0.0)),
    "Leg_RR": (["tripo_part_2", "tripo_part_15"], (-0.10, 0.19, 0.24), (-0.16, 0.27, 0.15), (-0.17, 0.30, 0.0)),
}

# Armor/Body core parts
CORE_PARTS = [
    "tripo_part_0",
    "tripo_part_4",
    "tripo_part_11",
    "tripo_part_22",
    "tripo_part_23",
    "tripo_part_16",
    "tripo_part_18",
    "tripo_part_26",
    "tripo_part_27",
    "tripo_part_28",
    "tripo_part_29",
]

# Outer scythe/blade parts to repurpose into clean spinning equatorial scythe ring
BLADE_SOURCE_PARTS = [
    "tripo_part_5",
    "tripo_part_7",
    "tripo_part_9",
    "tripo_part_10",
    "tripo_part_1",
    "tripo_part_3",
    "tripo_part_19",
    "tripo_part_20",
    "tripo_part_21",
    "tripo_part_24",
    "tripo_part_25",
]


def oreblade_emissive(rgba):
    r, g, b = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
    cyan_eye = (b > 0.45) & (g > 0.35) & (b > r * 1.30)
    hot_crimson = (r > 0.48) & (r > g * 1.85) & (b > 0.22)
    em = np.zeros_like(rgba)
    em[cyan_eye, 0] = r[cyan_eye] * 0.55
    em[cyan_eye, 1] = np.clip(g[cyan_eye] * 1.45, 0.0, 1.0)
    em[cyan_eye, 2] = np.clip(b[cyan_eye] * 1.65, 0.0, 1.0)
    em[hot_crimson, 0] = np.clip(r[hot_crimson] * 1.35, 0.0, 1.0)
    em[hot_crimson, 1] = g[hot_crimson] * 0.25
    em[hot_crimson, 2] = np.clip(b[hot_crimson] * 1.25, 0.0, 1.0)
    em[:, :, 3] = 1.0
    return em


def build_armature():
    arm_data = bpy.data.armatures.new("Oreblade_ArmatureData")
    arm_obj = bpy.data.objects.new("Oreblade_Armature", arm_data)
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
    add_b("Body_Core", "Root", (0.0, 0.0, 0.35), (0.0, -0.16, 0.37))
    # Blade_Ring points straight up +Z so local Y rotation or world Z rotation spins blades smoothly around equator
    add_b("Blade_Ring", "Body_Core", (0.0, 0.0, 0.36), (0.0, 0.0, 0.54))

    for leg_name, (_, p_hip, p_knee, p_foot) in LEG_DEFS.items():
        add_b(f"{leg_name}_Upper", "Body_Core", p_hip, p_knee)
        add_b(f"{leg_name}_Lower", f"{leg_name}_Upper", p_knee, p_foot)

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


def build_symmetrical_blade_ring(meshes_by_name, shared_mat):
    """Build a crisp, balanced 8-blade biological scythe ring around Body_Core at z ~ 0.36."""
    hero_blade = meshes_by_name["tripo_part_10"]
    decimate_mesh(hero_blade, 0.36)

    # Normalize hero_blade (currently at x~+0.40, y~-0.01, z~0.26) into a prominent horizontal scythe extending well outside Body_Core
    for v in hero_blade.data.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        rx = x * 1.32
        ry = y * 1.24
        rz = (z - 0.26) * 0.64 + 0.365
        v.co = (rx, ry, rz)
    hero_blade.data.update()

    # Duplicate 8 symmetrical curved scythe blades around the equator
    ring_parts = [hero_blade]
    for k in range(1, 8):
        dup = hero_blade.copy()
        dup.data = hero_blade.data.copy()
        dup.name = f"BladeSlice_{k}"
        bpy.context.scene.collection.objects.link(dup)
        ang = k * (math.tau / 8.0)
        rot_m = mathutils.Matrix.Rotation(ang, 4, "Z")
        pivot = mathutils.Vector((0.0, 0.0, 0.365))
        for v in dup.data.vertices:
            rel = v.co - pivot
            # Alternate slight tilt on even/odd blades for fierce serrated biological profile
            if k % 2 == 1:
                rel.z = -rel.z * 0.85
                rel.x *= 0.92
                rel.y *= 0.92
            v.co = (rot_m @ rel) + pivot
        dup.data.update()
        ring_parts.append(dup)

    # Remove unused redundant outer parts so they don't float motionless around the spinning ring
    for rem_name in BLADE_SOURCE_PARTS:
        if rem_name != "tripo_part_10" and rem_name in meshes_by_name:
            bpy.data.objects.remove(meshes_by_name[rem_name], do_unlink=True)
            del meshes_by_name[rem_name]

    bpy.ops.object.select_all(action="DESELECT")
    for rp in ring_parts:
        rp.select_set(True)
    bpy.context.view_layer.objects.active = hero_blade
    bpy.ops.object.join()
    blade_obj = bpy.context.view_layer.objects.active
    blade_obj.name = "Oreblade_Blades"
    blade_obj.data.name = "Oreblade_BladesMesh"
    blade_obj.data.materials.clear()
    blade_obj.data.materials.append(shared_mat)

    assign_weights_dict(blade_obj, [{"Blade_Ring": 1.0} for _ in blade_obj.data.vertices])
    triangulate_mesh(blade_obj)
    return blade_obj


def set_leg(arm, name, swing_fwd=0.0, lift=0.0, spread=0.0):
    side = 1.0 if name.endswith("L") else -1.0
    front = 1.0 if "_F" in name else -1.0
    rotate_bone_world(
        arm,
        f"{name}_Upper",
        rx_deg=front * swing_fwd * 24.0,
        ry_deg=-(lift * 22.0 - spread * 14.0) * side,
        rz_deg=swing_fwd * 18.0 * side,
    )
    rotate_bone_world(
        arm,
        f"{name}_Lower",
        rx_deg=front * swing_fwd * 14.0,
        ry_deg=(lift * 30.0 + spread * 16.0) * side,
    )


def author_animations(arm_obj):
    fps = 30.0
    all_legs = list(LEG_DEFS.keys())
    diag_a = {"Leg_FL", "Leg_RR"}
    loc_b = ("Body_Core",)

    def sample_spawn(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        arm.pose.bones["Body_Core"].location = (0.0, 0.0, -0.22 * (1.0 - t) + 0.04 * math.sin(u * math.pi))
        rotate_bone_world(arm, "Body_Core", rx_deg=18.0 * (1.0 - t))
        for ln in all_legs:
            set_leg(arm, ln, spread=(1.0 - t) * 0.75, lift=-0.4 * (1.0 - t))
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 360.0)

    def sample_idle(arm, u):
        clear_pose(arm)
        b = math.sin(u * math.tau)
        arm.pose.bones["Body_Core"].location = (0.0, 0.0, 0.015 * b)
        rotate_bone_world(arm, "Body_Core", rx_deg=-2.5 * b)
        for ln in all_legs:
            set_leg(arm, ln, spread=0.08 + 0.05 * b)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 360.0)

    def sample_walk(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        s, c = math.sin(ph), math.cos(ph)
        arm.pose.bones["Body_Core"].location = (0.012 * c, -0.015, 0.018 * abs(s))
        rotate_bone_world(arm, "Body_Core", rx_deg=-10.0 + 3.0 * abs(c), ry_deg=4.5 * s)
        for ln in all_legs:
            sgn = 1.0 if ln in diag_a else -1.0
            set_leg(arm, ln, swing_fwd=s * sgn * 1.15, lift=max(0.0, c * sgn) * 0.95, spread=0.12)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 360.0)

    def sample_turn(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.tau)
        c = math.cos(u * math.tau)
        arm.pose.bones["Body_Core"].location = (0.0, 0.0, 0.014 * abs(s))
        rotate_bone_world(arm, "Body_Core", ry_deg=7.5 * s)
        for ln in all_legs:
            sgn = 1.0 if ln in diag_a else -1.0
            set_leg(arm, ln, swing_fwd=0.55 * s * sgn, lift=max(0.0, c * sgn) * 0.75, spread=0.20)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 360.0)

    def sample_attack_prep(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        trem = 0.008 * math.sin(u * 42.0) * t
        arm.pose.bones["Body_Core"].location = (trem, 0.045 * t, -0.075 * t)
        rotate_bone_world(arm, "Body_Core", rx_deg=12.0 * t)
        for ln in all_legs:
            set_leg(arm, ln, spread=0.72 * t, lift=-0.38 * t, swing_fwd=-0.3 * t)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 720.0)

    def sample_attack_exec(arm, u):
        clear_pose(arm)
        ph = u * math.tau * 2.0
        s, c = math.sin(ph), math.cos(ph)
        arm.pose.bones["Body_Core"].location = (0.0, -0.045, 0.02 + 0.018 * abs(s))
        rotate_bone_world(arm, "Body_Core", rx_deg=-20.0, ry_deg=5.0 * s)
        for ln in all_legs:
            sgn = 1.0 if ln in diag_a else -1.0
            set_leg(arm, ln, swing_fwd=s * sgn * 1.35, lift=max(0.0, c * sgn) * 1.1, spread=0.22)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 1080.0)

    def sample_attack_recover(arm, u):
        clear_pose(arm)
        t = 1.0 - smoothstep(u)
        arm.pose.bones["Body_Core"].location = (0.0, -0.03 * t, -0.05 * t)
        rotate_bone_world(arm, "Body_Core", rx_deg=-14.0 * t + 8.0 * math.sin(u * math.pi))
        for ln in all_legs:
            set_leg(arm, ln, spread=0.52 * t, swing_fwd=0.35 * t, lift=-0.22 * t)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 360.0)

    def sample_hit(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.pi)
        arm.pose.bones["Body_Core"].location = (0.0, 0.04 * s, 0.025 * s)
        rotate_bone_world(arm, "Body_Core", rx_deg=18.0 * s, ry_deg=9.0 * s)
        for ln in all_legs:
            set_leg(arm, ln, spread=0.35 * s)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=u * 270.0)

    def sample_death(arm, u):
        clear_pose(arm)
        e = smoothstep(min(1.0, u / 0.78))
        arm.pose.bones["Body_Core"].location = (0.0, 0.0, -0.20 * e)
        rotate_bone_world(arm, "Body_Core", rx_deg=22.0 * e, ry_deg=16.0 * e)
        for ln in all_legs:
            set_leg(arm, ln, spread=1.05 * e, lift=-0.65 * e)
        rotate_bone_world(arm, "Blade_Ring", rz_deg=(1.0 - e) * 180.0)

    build_nla_action(arm_obj, "Spawn", 0.75, fps, sample_spawn, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Idle", 1.60, fps, sample_idle, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Walk", 0.48, fps, sample_walk, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Turn", 0.45, fps, sample_turn, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Attack_Prep", 0.42, fps, sample_attack_prep, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Attack_Exec", 0.46, fps, sample_attack_exec, cyclic=True, loc_bones=loc_b)
    build_nla_action(arm_obj, "Attack_Recover", 0.45, fps, sample_attack_recover, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Hit_React", 0.20, fps, sample_hit, cyclic=False, loc_bones=loc_b)
    build_nla_action(arm_obj, "Death", 0.90, fps, sample_death, cyclic=False, loc_bones=loc_b)
    clear_pose(arm_obj)


def main():
    src = backup_original_glb("Oreblade.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = clean_imported_gltf()
    meshes_by_name = {m.name: m for m in meshes}

    # Pack all parts into 1 crisp 2048x2048 BaseColor + 1024x1024 Normal + Emissive atlas BEFORE modifying geometry
    shared_mat, _ = pack_parts_to_atlas(
        meshes,
        "Oreblade_Atlas",
        base_size=2048,
        norm_size=1024,
        em_size=1024,
        emissive_fn=oreblade_emissive,
        roughness_val=0.45,
        metallic_val=0.18,
        normal_strength=0.72,
        emission_strength=1.40,
    )

    # Plant the 4 lower leg parts flush to z=0.000 smoothly
    for leg_name, (pnames, (hx, hy, hz), _, _) in LEG_DEFS.items():
        all_v = [v for pn in pnames for v in meshes_by_name[pn].data.vertices]
        min_z = min(v.co.z for v in all_v)
        if abs(min_z) > 0.0005:
            span = max(0.05, hz - min_z)
            for pn in pnames:
                obj = meshes_by_name[pn]
                for v in obj.data.vertices:
                    w = max(0.0, min(1.0, (hz - v.co.z) / span))
                    v.co.z -= min_z * (w ** 1.15)
                obj.data.update()

    # Gently keep rounded organic dome on tripo_part_0 while tapering extreme top spire above z=0.62
    p0 = meshes_by_name["tripo_part_0"]
    for v in p0.data.vertices:
        if v.co.z > 0.62:
            v.co.z = 0.62 + (v.co.z - 0.62) * 0.68
    p0.data.update()

    # Build symmetrical spinning scythe ring (consumes blade source parts cleanly)
    blade_obj = build_symmetrical_blade_ring(meshes_by_name, shared_mat)

    # Decimate core & legs cleanly within budget (~3,600 tris body + ~1,600 tris blades)
    body_parts = [meshes_by_name[pn] for pn in CORE_PARTS if pn in meshes_by_name]
    leg_part_objs = [meshes_by_name[pn] for _, (pns, _, _, _) in LEG_DEFS.items() for pn in pns if pn in meshes_by_name]
    decimate_parts_to_budget(body_parts + leg_part_objs, 3400, min_part_faces=110)

    # Skin central body to Body_Core cleanly
    for bo in body_parts:
        assign_weights_dict(bo, [{"Body_Core": 1.0} for _ in bo.data.vertices])
        sync_seam_weights(bo)

    # Skin each leg strictly to its 2 bones (0% cross-leg bleed)
    for leg_name, (pnames, p_hip, p_knee, p_foot) in LEG_DEFS.items():
        v_hip = mathutils.Vector(p_hip)
        v_knee = mathutils.Vector(p_knee)
        v_foot = mathutils.Vector(p_foot)
        span_u = max(0.04, (v_hip - v_knee).length)
        span_l = max(0.04, (v_knee - v_foot).length)
        for pn in pnames:
            obj = meshes_by_name[pn]
            per_v = []
            for v in obj.data.vertices:
                du = (v.co - v_hip).dot((v_knee - v_hip).normalized()) / span_u
                if du < 0.15:
                    w_body = max(0.0, (0.15 - du) * 2.0) * 0.45
                    w_up = 1.0 - w_body
                    per_v.append({"Body_Core": w_body, f"{leg_name}_Upper": w_up})
                elif du < 0.72:
                    per_v.append({f"{leg_name}_Upper": 1.0})
                elif du < 1.10:
                    t = (du - 0.72) / 0.38
                    per_v.append({f"{leg_name}_Upper": 1.0 - t, f"{leg_name}_Lower": t})
                else:
                    per_v.append({f"{leg_name}_Lower": 1.0})
            assign_weights_dict(obj, per_v)
            sync_seam_weights(obj)

    # Join all body + leg parts into single Oreblade_Body SkinnedMesh
    bpy.ops.object.select_all(action="DESELECT")
    to_join = body_parts + leg_part_objs
    for o in to_join:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes_by_name["tripo_part_0"]
    bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = "Oreblade_Body"
    body_obj.data.name = "Oreblade_BodyMesh"
    body_obj.data.materials.clear()
    body_obj.data.materials.append(shared_mat)
    triangulate_mesh(body_obj)

    arm_obj = build_armature()
    final_meshes = [body_obj, blade_obj]
    for m in final_meshes:
        m.parent = arm_obj
        mod = m.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj

    def pose_idle():
        clear_pose(arm_obj)

    def pose_walk():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Body_Core", rx_deg=-10.0)
        rotate_bone_world(arm_obj, "Blade_Ring", rz_deg=24.0)
        set_leg(arm_obj, "Leg_FL", swing_fwd=1.0, lift=0.8)
        set_leg(arm_obj, "Leg_RR", swing_fwd=1.0, lift=0.8)
        set_leg(arm_obj, "Leg_FR", swing_fwd=-0.8, lift=0.0)

    def pose_prep():
        clear_pose(arm_obj)
        arm_obj.pose.bones["Body_Core"].location = (0.0, 0.04, -0.075)
        rotate_bone_world(arm_obj, "Body_Core", rx_deg=12.0)
        rotate_bone_world(arm_obj, "Blade_Ring", rz_deg=45.0)
        for ln in LEG_DEFS:
            set_leg(arm_obj, ln, spread=0.72, lift=-0.35)

    def pose_ram():
        clear_pose(arm_obj)
        arm_obj.pose.bones["Body_Core"].location = (0.0, -0.045, 0.02)
        rotate_bone_world(arm_obj, "Body_Core", rx_deg=-20.0)
        rotate_bone_world(arm_obj, "Blade_Ring", rz_deg=68.0)

    render_pose_verification_sheet(
        arm_obj,
        os.path.join(SCRATCH_DIR, "verify_oreblade.png"),
        [
            ("idle", pose_idle, ((0.65, -1.25, 0.62), (0.0, 0.0, 0.34))),
            ("walk", pose_walk, ((1.05, -0.85, 0.58), (0.0, 0.0, 0.34))),
            ("prep", pose_prep, ((-0.85, -1.05, 0.65), (0.0, 0.0, 0.32))),
            ("ram", pose_ram, ((0.20, -1.25, 0.85), (0.0, 0.0, 0.34))),
        ],
    )

    author_animations(arm_obj)
    export_runtime_glb(arm_obj, final_meshes, os.path.join(RUNTIME_MODELS_DIR, "oreblade_3d.glb"))


if __name__ == "__main__":
    main()
