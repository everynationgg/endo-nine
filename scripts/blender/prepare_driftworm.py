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

# 6 radial tendril chains descending around the lower organism
TENDRIL_CHAINS = {
    "Tendril_FL": ((0.09, -0.10, 0.56), (0.14, -0.13, 0.36), (0.10, -0.12, 0.16), (0.04, -0.10, 0.02)),
    "Tendril_FR": ((-0.09, -0.10, 0.56), (-0.14, -0.13, 0.36), (-0.10, -0.12, 0.16), (-0.04, -0.10, 0.02)),
    "Tendril_SL": ((0.18, 0.01, 0.56), (0.25, 0.03, 0.38), (0.20, 0.05, 0.20), (0.12, 0.06, 0.05)),
    "Tendril_SR": ((-0.18, 0.01, 0.56), (-0.25, 0.03, 0.38), (-0.20, 0.05, 0.20), (-0.12, 0.06, 0.05)),
    "Tendril_RL": ((0.08, 0.11, 0.55), (0.12, 0.16, 0.36), (0.08, 0.14, 0.18), (0.03, 0.10, 0.04)),
    "Tendril_RR": ((-0.08, 0.11, 0.55), (-0.12, 0.16, 0.36), (-0.08, 0.14, 0.18), (-0.03, 0.10, 0.04)),
}


def driftworm_emissive(rgba):
    r, g, b = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
    aqua_glow = (b > 0.58) & (g > 0.42) & (b > r * 1.45)
    violet_glow = (b > 0.55) & (r > 0.38) & (g < 0.38)
    em = np.zeros_like(rgba)
    em[aqua_glow, 0] = r[aqua_glow] * 0.45
    em[aqua_glow, 1] = np.clip(g[aqua_glow] * 1.45, 0.0, 1.0)
    em[aqua_glow, 2] = np.clip(b[aqua_glow] * 1.65, 0.0, 1.0)
    em[violet_glow, 0] = np.clip(r[violet_glow] * 1.10, 0.0, 1.0)
    em[violet_glow, 1] = g[violet_glow] * 0.50
    em[violet_glow, 2] = np.clip(b[violet_glow] * 1.35, 0.0, 1.0)
    em[:, :, 3] = 1.0
    return em


def build_armature():
    arm_data = bpy.data.armatures.new("Driftworm_ArmatureData")
    arm_obj = bpy.data.objects.new("Driftworm_Armature", arm_data)
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
    add_b("Mantle_Core", "Root", (0.0, 0.0, 0.56), (0.0, 0.0, 0.72))
    add_b("Upper_Crown", "Mantle_Core", (0.0, 0.0, 0.72), (0.0, 0.0, 0.96))
    add_b("Oral_Organ", "Mantle_Core", (0.0, -0.14, 0.56), (0.0, -0.25, 0.55))
    add_b("Spit_Socket", "Oral_Organ", (0.0, -0.25, 0.55), (0.0, -0.32, 0.54))

    for tname, pts in TENDRIL_CHAINS.items():
        add_b(f"{tname}_01", "Mantle_Core", pts[0], pts[1])
        add_b(f"{tname}_02", f"{tname}_01", pts[1], pts[2])
        add_b(f"{tname}_03", f"{tname}_02", pts[2], pts[3])

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm_obj


def skin_mesh(mesh_obj):
    chain_vecs = {k: [mathutils.Vector(p) for p in pts] for k, pts in TENDRIL_CHAINS.items()}
    per_v = []
    for v in mesh_obj.data.vertices:
        co = v.co
        # Upper mantle, crown, and frontal oral firing organ
        if co.z >= 0.57:
            oral_w = 0.0
            if co.y < -0.11 and abs(co.x) < 0.14 and 0.45 <= co.z <= 0.72:
                oral_w = max(0.0, min(1.0, (-0.11 - co.y) / 0.12))
            crown_w = max(0.0, min(1.0, (co.z - 0.66) / 0.18)) * (1.0 - oral_w)
            core_w = max(0.05, 1.0 - crown_w - oral_w)
            per_v.append({"Mantle_Core": core_w, "Upper_Crown": crown_w, "Oral_Organ": oral_w})
            continue

        # Flexible lower tendrils sorted cleanly onto nearest of the 6 tendril chains
        best_chain = None
        best_d2 = 1e12
        best_s = 0.0
        for tname, pts in chain_vecs.items():
            s = closest_param_on_polyline(co, pts)
            idx = min(len(pts) - 2, max(0, int(s)))
            frac = max(0.0, min(1.0, s - idx))
            proj = pts[idx].lerp(pts[idx + 1], frac)
            d2 = (co - proj).length_squared
            if d2 < best_d2:
                best_d2 = d2
                best_chain = tname
                best_s = s

        w01 = math.exp(-((best_s - 0.5) / 0.62) ** 2)
        w02 = math.exp(-((best_s - 1.5) / 0.62) ** 2)
        w03 = math.exp(-((best_s - 2.55) / 0.65) ** 2)
        wd = {f"{best_chain}_01": w01, f"{best_chain}_02": w02, f"{best_chain}_03": w03}
        if co.z > 0.46:
            root_blend = ((co.z - 0.46) / 0.11) * 0.45
            wd = {k: val * (1.0 - root_blend) for k, val in wd.items()}
            wd["Mantle_Core"] = root_blend
        per_v.append(wd)

    assign_weights_dict(mesh_obj, per_v)
    sync_seam_weights(mesh_obj)


def apply_tendril_wave(arm, t_phase: float, amp: float, trail_pitch: float = 0.0, flare: float = 0.0):
    names = list(TENDRIL_CHAINS.keys())
    for idx, tname in enumerate(names):
        p_off = idx * (math.tau / 6.0)
        side = 1.0 if (tname.endswith("L") or tname == "Tendril_SL") else -1.0
        # Traveling fluid sine wave from base -> mid -> tip
        for seg, factor, lag in [(1, 0.55, 0.0), (2, 0.90, -0.85), (3, 1.25, -1.75)]:
            s = math.sin(t_phase + p_off + lag)
            c = math.cos(t_phase + p_off + lag)
            rx = trail_pitch * factor * (0.45 + 0.25 * seg) + amp * 12.0 * factor * s
            ry = (amp * 10.0 * factor * c + flare * 16.0) * side
            rz = amp * 6.0 * factor * math.sin(t_phase * 0.7 + p_off + lag)
            rotate_bone_world(arm, f"{tname}_0{seg}", rx_deg=rx, ry_deg=ry, rz_deg=rz)


def author_animations(arm_obj):
    fps = 30.0
    loc_b = ("Mantle_Core",)
    scale_b = ("Mantle_Core", "Upper_Crown", "Oral_Organ")

    def sample_spawn(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.0, -0.35 * (1.0 - t) + 0.05 * math.sin(u * math.pi))
        s = 0.35 + 0.65 * t
        arm.pose.bones["Mantle_Core"].scale = (s, s, s)
        apply_tendril_wave(arm, u * math.tau * 2.0, 1.1, trail_pitch=14.0 * (1.0 - t), flare=0.45 * (1.0 - t))

    def sample_idle(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        b = math.sin(ph)
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.0, 0.042 * b)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=3.5 * math.cos(ph), ry_deg=2.5 * math.sin(ph))
        pulse = 1.0 + 0.045 * math.sin(ph * 2.0)
        inv = 1.0 / math.sqrt(pulse)
        arm.pose.bones["Mantle_Core"].scale = (pulse, pulse, inv)
        arm.pose.bones["Upper_Crown"].scale = (1.0 + 0.03 * b, 1.0 + 0.03 * b, 1.0)
        apply_tendril_wave(arm, ph, 1.0)

    def sample_walk(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        s = math.sin(ph)
        arm.pose.bones["Mantle_Core"].location = (0.015 * math.cos(ph), -0.02, 0.032 * s)
        # Body pitches forward along travel velocity while tendrils lag softly behind
        rotate_bone_world(arm, "Mantle_Core", rx_deg=-15.0 + 4.0 * s, ry_deg=5.0 * math.cos(ph))
        pulse = 1.0 + 0.04 * math.sin(ph * 2.0)
        arm.pose.bones["Mantle_Core"].scale = (pulse, pulse, 1.0 / math.sqrt(pulse))
        apply_tendril_wave(arm, ph, 1.2, trail_pitch=16.0)

    def sample_turn(arm, u):
        clear_pose(arm)
        ph = u * math.tau
        s = math.sin(ph)
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.0, 0.03 * s)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=-6.0, ry_deg=11.0 * math.cos(ph))
        apply_tendril_wave(arm, ph, 1.15, trail_pitch=8.0, flare=0.25)

    def sample_attack_prep(arm, u):
        clear_pose(arm)
        t = smoothstep(u)
        # Contract firing organ & draw tendrils inward before spitting water bubble
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.05 * t, -0.04 * t)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=14.0 * t)
        arm.pose.bones["Mantle_Core"].scale = (1.0 + 0.09 * t, 1.0 - 0.08 * t, 1.0 + 0.06 * t)
        arm.pose.bones["Oral_Organ"].scale = (1.0 - 0.24 * t, 1.0 + 0.30 * t, 1.0 - 0.16 * t)
        apply_tendril_wave(arm, u * math.pi, 0.45, trail_pitch=-10.0 * t, flare=-0.55 * t)

    def sample_attack_exec(arm, u):
        clear_pose(arm)
        snap = math.sin(min(1.0, u * 1.45) * math.pi)
        # Subtle recoil backward (+Y) and upward pitch as water bubble launches
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.085 * snap, 0.04 * snap)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=-12.0 * (1.0 - u) + 18.0 * snap)
        arm.pose.bones["Oral_Organ"].scale = (1.0 + 0.28 * snap, 1.0 + 0.18 * snap, 1.0 + 0.22 * snap)
        arm.pose.bones["Mantle_Core"].scale = (1.0 - 0.06 * snap, 1.0 + 0.08 * snap, 1.0)
        apply_tendril_wave(arm, u * math.tau, 1.35, trail_pitch=-16.0 * snap, flare=0.75 * snap)

    def sample_attack_recover(arm, u):
        clear_pose(arm)
        t = 1.0 - smoothstep(u)
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.06 * t, 0.025 * t)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=12.0 * t)
        apply_tendril_wave(arm, u * math.pi, 0.9, trail_pitch=-8.0 * t, flare=0.35 * t)

    def sample_hit(arm, u):
        clear_pose(arm)
        s = math.sin(u * math.pi)
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.05 * s, 0.03 * s)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=16.0 * s, ry_deg=10.0 * s)
        apply_tendril_wave(arm, u * math.pi, 1.3, flare=0.6 * s)

    def sample_death(arm, u):
        clear_pose(arm)
        e = smoothstep(min(1.0, u / 0.80))
        arm.pose.bones["Mantle_Core"].location = (0.0, 0.0, -0.34 * e)
        rotate_bone_world(arm, "Mantle_Core", rx_deg=26.0 * e, ry_deg=22.0 * e)
        s = 1.0 - 0.22 * e
        arm.pose.bones["Mantle_Core"].scale = (1.0 + 0.12 * e, s, s)
        apply_tendril_wave(arm, u * math.pi, 0.4, flare=1.1 * e)

    build_nla_action(arm_obj, "Spawn", 0.85, fps, sample_spawn, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Idle", 2.60, fps, sample_idle, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Walk", 1.80, fps, sample_walk, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Turn", 1.20, fps, sample_turn, cyclic=True, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_Prep", 0.30, fps, sample_attack_prep, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_Exec", 0.25, fps, sample_attack_exec, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Attack_Recover", 0.35, fps, sample_attack_recover, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Hit_React", 0.22, fps, sample_hit, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    build_nla_action(arm_obj, "Death", 0.95, fps, sample_death, cyclic=False, loc_bones=loc_b, scale_bones=scale_b)
    clear_pose(arm_obj)


def main():
    src = backup_original_glb("Driftworm.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = clean_imported_gltf()

    shared_mat, _ = pack_parts_to_atlas(
        meshes,
        "Driftworm_Atlas",
        base_size=2048,
        norm_size=1024,
        em_size=1024,
        emissive_fn=driftworm_emissive,
        roughness_val=0.38,
        metallic_val=0.10,
        normal_strength=0.68,
        emission_strength=1.40,
    )

    decimate_parts_to_budget(meshes, 7200, min_part_faces=180)

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    body_obj = bpy.context.view_layer.objects.active
    body_obj.name = "Driftworm_Mesh"
    body_obj.data.name = "Driftworm_MeshData"
    body_obj.data.materials.clear()
    body_obj.data.materials.append(shared_mat)

    triangulate_mesh(body_obj)
    arm_obj = build_armature()
    skin_mesh(body_obj)

    body_obj.parent = arm_obj
    mod = body_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj

    def pose_idle():
        clear_pose(arm_obj)
        apply_tendril_wave(arm_obj, 0.8, 1.0)

    def pose_glide():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Mantle_Core", rx_deg=-15.0)
        apply_tendril_wave(arm_obj, 2.1, 1.2, trail_pitch=16.0)

    def pose_prep():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Mantle_Core", rx_deg=14.0)
        arm_obj.pose.bones["Oral_Organ"].scale = (0.76, 1.30, 0.84)
        apply_tendril_wave(arm_obj, 0.4, 0.45, flare=-0.55)

    def pose_spit():
        clear_pose(arm_obj)
        rotate_bone_world(arm_obj, "Mantle_Core", rx_deg=18.0)
        arm_obj.pose.bones["Oral_Organ"].scale = (1.28, 1.18, 1.22)
        apply_tendril_wave(arm_obj, 3.8, 1.35, trail_pitch=-16.0, flare=0.75)

    render_pose_verification_sheet(
        arm_obj,
        os.path.join(SCRATCH_DIR, "verify_driftworm.png"),
        [
            ("idle", pose_idle, ((0.75, -1.65, 0.85), (0.0, 0.0, 0.50))),
            ("glide", pose_glide, ((1.45, -0.95, 0.82), (0.0, 0.0, 0.50))),
            ("prep", pose_prep, ((-1.05, -1.35, 0.80), (0.0, 0.0, 0.50))),
            ("spit", pose_spit, ((1.10, 1.15, 0.95), (0.0, 0.0, 0.50))),
        ],
    )

    author_animations(arm_obj)
    export_runtime_glb(arm_obj, [body_obj], os.path.join(RUNTIME_MODELS_DIR, "driftworm_3d.glb"))


if __name__ == "__main__":
    main()
