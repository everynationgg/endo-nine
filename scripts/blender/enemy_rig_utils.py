import math
import os
import shutil
import bpy
import bmesh
import mathutils
import numpy as np

BLENDER_EXE = r"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"
SRC_GLB_DIR = r"C:\Users\yoggn\Downloads\Endo Nine\Enemies\3D\GLB"
PROJECT_ROOT = r"c:\Users\yoggn\Desktop\Ender Nine"
BACKUP_DIR = os.path.join(PROJECT_ROOT, "exports", "originals_backup")
RUNTIME_MODELS_DIR = os.path.join(PROJECT_ROOT, "public", "assets", "models")
SCRATCH_DIR = r"C:\Users\yoggn\.gemini\antigravity\brain\8217db9b-18ef-43dc-919e-cb57fca4ea9c\scratch"


def ensure_dirs():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    os.makedirs(RUNTIME_MODELS_DIR, exist_ok=True)
    os.makedirs(SCRATCH_DIR, exist_ok=True)


def backup_original_glb(filename: str) -> str:
    """Copy original source GLB into exports/originals_backup untouched if not already present."""
    ensure_dirs()
    src = os.path.join(SRC_GLB_DIR, filename)
    dst = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(src):
        raise FileNotFoundError(f"Source GLB missing: {src}")
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
        shutil.copy2(src, dst)
    return src


def clean_imported_gltf():
    """Remove Tripo Icosphere helper, detach meshes with world transform baked, clear old armatures/groups."""
    for rem in ("Icosphere",):
        if rem in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[rem], do_unlink=True)

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    for m in meshes:
        for mod in list(m.modifiers):
            if mod.type == "ARMATURE":
                m.modifiers.remove(mod)
        m.vertex_groups.clear()

    for a in arms:
        a.animation_data_clear()
        bpy.data.objects.remove(a, do_unlink=True)

    return meshes


def find_part_images(mat):
    """Extract BaseColor, RM (Roughness/Metallic), and Normal images from a material node tree."""
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
            if (
                l.to_node.type == "BSDF_PRINCIPLED"
                and l.to_socket.name == "Base Color"
                and l.from_node.type == "TEX_IMAGE"
            ):
                base_img = l.from_node.image
    return base_img, rm_img, norm_img


def wire_pbr_material(
    mat,
    base_img,
    norm_img=None,
    em_img=None,
    rm_img=None,
    roughness_val=0.58,
    metallic_val=0.08,
    normal_strength=0.70,
    emission_strength=1.35,
):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (450, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (120, 0)
    bsdf.inputs["Roughness"].default_value = roughness_val
    bsdf.inputs["Metallic"].default_value = metallic_val
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


def _resample_rgba(img, target_w: int, target_h: int) -> np.ndarray:
    bw, bh = img.size
    arr = np.empty(bw * bh * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    rgba = arr.reshape((bh, bw, 4))
    if bw == target_w and bh == target_h:
        return rgba
    ys = (np.arange(target_h) * bh) // target_h
    xs = (np.arange(target_w) * bw) // target_w
    return rgba[ys[:, None], xs[None, :], :]


def resize_image_rgba(img, target_w: int, target_h: int, name: str, colorspace: str = "sRGB"):
    arr = _resample_rgba(img, target_w, target_h)
    im = bpy.data.images.new(name, width=target_w, height=target_h, alpha=False)
    im.colorspace_settings.name = colorspace
    im.pixels.foreach_set(arr.ravel())
    im.pack()
    return im, arr


def pack_parts_to_atlas(
    mesh_objs,
    atlas_prefix: str,
    base_size: int = 2048,
    norm_size: int = 1024,
    em_size: int = 1024,
    emissive_fn=None,
    roughness_val: float = 0.58,
    metallic_val: float = 0.08,
    normal_strength: float = 0.68,
    emission_strength: float = 1.35,
):
    """Pack multiple part meshes into 1 BaseColor + 1 Normal + 1 Emissive texture atlas and assign shared material."""
    n = len(mesh_objs)
    cols = max(1, math.ceil(math.sqrt(n)))
    rows = max(1, math.ceil(n / cols))

    cell_bw = base_size // cols
    cell_bh = base_size // rows
    cell_nw = norm_size // cols
    cell_nh = norm_size // rows

    base_buf = np.zeros((base_size, base_size, 4), dtype=np.float32)
    base_buf[:, :, 3] = 1.0
    norm_buf = np.zeros((norm_size, norm_size, 4), dtype=np.float32)
    norm_buf[:, :, 0] = 0.5
    norm_buf[:, :, 1] = 0.5
    norm_buf[:, :, 2] = 1.0
    norm_buf[:, :, 3] = 1.0

    for idx, obj in enumerate(mesh_objs):
        col_i = idx % cols
        row_i = idx // cols
        bx0 = col_i * cell_bw
        by0 = row_i * cell_bh
        nx0 = col_i * cell_nw
        ny0 = row_i * cell_nh

        mat = obj.material_slots[0].material if obj.material_slots else None
        base_img, _rm_img, norm_img = find_part_images(mat)

        if base_img:
            sub_b = _resample_rgba(base_img, cell_bw, cell_bh)
            base_buf[by0 : by0 + cell_bh, bx0 : bx0 + cell_bw, :] = sub_b
        if norm_img:
            sub_n = _resample_rgba(norm_img, cell_nw, cell_nh)
            norm_buf[ny0 : ny0 + cell_nh, nx0 : nx0 + cell_nw, :] = sub_n

        uv_layer = obj.data.uv_layers.active
        if uv_layer:
            pad_u = 2.0 / base_size
            pad_v = 2.0 / base_size
            u0 = bx0 / base_size + pad_u
            v0 = by0 / base_size + pad_v
            uspan = cell_bw / base_size - 2.0 * pad_u
            vspan = cell_bh / base_size - 2.0 * pad_v
            for loop_uv in uv_layer.data:
                u = max(0.0, min(1.0, loop_uv.uv.x))
                v = max(0.0, min(1.0, loop_uv.uv.y))
                loop_uv.uv.x = u0 + u * uspan
                loop_uv.uv.y = v0 + v * vspan

    im_b = bpy.data.images.new(f"{atlas_prefix}_BaseColor", width=base_size, height=base_size, alpha=False)
    im_b.colorspace_settings.name = "sRGB"
    im_b.pixels.foreach_set(base_buf.ravel())
    im_b.pack()

    im_n = bpy.data.images.new(f"{atlas_prefix}_Normal", width=norm_size, height=norm_size, alpha=False)
    im_n.colorspace_settings.name = "Non-Color"
    im_n.pixels.foreach_set(norm_buf.ravel())
    im_n.pack()

    im_em = None
    if emissive_fn is not None:
        step_y = max(1, base_size // em_size)
        step_x = max(1, base_size // em_size)
        sub_base = base_buf[::step_y, ::step_x, :]
        sh, sw, _ = sub_base.shape
        em_arr = emissive_fn(sub_base)
        im_em = bpy.data.images.new(f"{atlas_prefix}_Emissive", width=sw, height=sh, alpha=False)
        im_em.colorspace_settings.name = "sRGB"
        im_em.pixels.foreach_set(em_arr.ravel())
        im_em.pack()

    shared_mat = bpy.data.materials.new(f"{atlas_prefix}_Mat")
    wire_pbr_material(
        shared_mat,
        im_b,
        norm_img=im_n,
        em_img=im_em,
        rm_img=None,
        roughness_val=roughness_val,
        metallic_val=metallic_val,
        normal_strength=normal_strength,
        emission_strength=emission_strength,
    )
    for obj in mesh_objs:
        obj.data.materials.clear()
        obj.data.materials.append(shared_mat)

    return shared_mat, im_b


def weld_mesh_vertices(mesh_obj, dist: float = 0.00015):
    """Weld duplicate glTF import vertices while preserving per-loop UVs so decimation and skinning stay watertight."""
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh_obj.data)
    bm.free()
    mesh_obj.data.polygons.foreach_set("use_smooth", [True] * len(mesh_obj.data.polygons))
    mesh_obj.data.validate(clean_customdata=False)
    mesh_obj.data.update()


def decimate_mesh(mesh_obj, ratio: float):
    """Weld seam-split vertices cleanly, apply UV-delimited collapse decimation, and ensure triangles."""
    weld_mesh_vertices(mesh_obj)
    if ratio < 0.995 and len(mesh_obj.data.polygons) > 60:
        mod = mesh_obj.modifiers.new(name="DecimateOpt", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.12, min(1.0, ratio))
        mod.use_collapse_triangulate = True
        if hasattr(mod, "delimit"):
            mod.delimit = {"UV"}
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_parts_to_budget(mesh_objs, target_total_faces: int, min_part_faces: int = 160):
    """Decimate a list of part meshes proportionally without tearing seams or destroying small parts."""
    for m in mesh_objs:
        weld_mesh_vertices(m)
    total_faces = sum(len(m.data.polygons) for m in mesh_objs)
    if total_faces <= target_total_faces or total_faces <= 0:
        return
    base_ratio = target_total_faces / float(total_faces)
    for m in mesh_objs:
        fcount = len(m.data.polygons)
        if fcount <= min_part_faces:
            continue
        r = max(min_part_faces / float(fcount), min(0.95, base_ratio))
        if r < 0.98:
            mod = m.modifiers.new(name="DecimateOpt", type="DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = max(0.15, min(1.0, r))
            mod.use_collapse_triangulate = True
            if hasattr(mod, "delimit"):
                mod.delimit = {"UV"}
            bpy.context.view_layer.objects.active = m
            bpy.ops.object.modifier_apply(modifier=mod.name)


def triangulate_mesh(mesh_obj):
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh_obj.data)
    bm.free()
    mesh_obj.data.update()


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


def sync_seam_weights(mesh_obj, radius: float = 0.00022):
    """Synchronize weights across duplicate UV-seam vertices so seams never crack during skeletal deformation."""
    verts = mesh_obj.data.vertices
    if len(verts) == 0:
        return
    kd = mathutils.kdtree.KDTree(len(verts))
    for i, v in enumerate(verts):
        kd.insert(v.co, i)
    kd.balance()
    seen = [False] * len(verts)
    for i, v in enumerate(verts):
        if seen[i]:
            continue
        cl = [idx for (_, idx, _) in kd.find_range(v.co, radius)]
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


def orient_bone_delta(arm_obj, bone_name: str, desired_world_m3):
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


def rotate_bone_world(arm_obj, bone_name: str, rx_deg=0.0, ry_deg=0.0, rz_deg=0.0):
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    dq = mathutils.Euler((math.radians(rx_deg), math.radians(ry_deg), math.radians(rz_deg)), "ZYX").to_quaternion()
    orient_bone_delta(arm_obj, bone_name, dq.to_matrix() @ pb.bone.matrix_local.to_3x3())


def rotate_bone_local_euler(arm_obj, bone_name: str, rx_deg=0.0, ry_deg=0.0, rz_deg=0.0):
    pb = arm_obj.pose.bones.get(bone_name)
    if not pb:
        return
    pb.rotation_quaternion = mathutils.Euler(
        (math.radians(rx_deg), math.radians(ry_deg), math.radians(rz_deg)), "XYZ"
    ).to_quaternion()


def clear_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def keyframe_all_bones(arm_obj, frame: int, loc_bones=("Root",), scale_bones=()):
    for pb in arm_obj.pose.bones:
        if pb.name in loc_bones:
            pb.keyframe_insert(data_path="location", frame=frame)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        if pb.name in scale_bones:
            pb.keyframe_insert(data_path="scale", frame=frame)


def build_nla_action(arm_obj, name: str, duration_sec: float, fps: float, sampler_fn, cyclic=True, loc_bones=(), scale_bones=()):
    act = bpy.data.actions.new(name=name)
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    total_frames = max(4, int(round(duration_sec * fps)))
    step = 2 if total_frames >= 16 else 1
    frames = list(range(0, total_frames + 1, step))
    if frames[-1] != total_frames:
        frames.append(total_frames)
    for f in frames:
        u = 0.0 if (cyclic and f == total_frames) else (f / float(total_frames))
        sampler_fn(arm_obj, u)
        keyframe_all_bones(arm_obj, f, loc_bones=loc_bones, scale_bones=scale_bones)
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = name
    st = track.strips.new(name, 0, act)
    st.action_frame_start = 0
    st.action_frame_end = total_frames
    arm_obj.animation_data.action = None
    return act


def smoothstep(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def render_pose_verification_sheet(arm_obj, out_png_path: str, cases):
    """Render 4-panel Blender Workbench sheet with texture lighting for anatomy/skin inspection."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    if not scene.world:
        scene.world = bpy.data.worlds.new("AuditWorld")
    scene.world.color = (0.09, 0.11, 0.15)

    cam_d = bpy.data.cameras.new("PoseCam")
    cam_d.lens = 42
    cam = bpy.data.objects.new("PoseCam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam

    out_dir = os.path.dirname(out_png_path)
    os.makedirs(out_dir, exist_ok=True)
    tmp = []
    for idx, (cname, pfn, (cpos, ctgt)) in enumerate(cases):
        pfn()
        bpy.context.view_layer.update()
        cam.location = mathutils.Vector(cpos)
        cam.rotation_euler = (mathutils.Vector(ctgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
        fp = os.path.join(out_dir, f"_tmp_pose_{idx}_{cname}.png")
        scene.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        tmp.append(fp)

    imgs = [bpy.data.images.load(p) for p in tmp]
    w, h = imgs[0].size
    grid = np.zeros((h * 2, w * 2, 4), dtype=np.float32)
    slots = [(0, h), (w, h), (0, 0), (w, 0)]
    for im, (gx, gy) in zip(imgs, slots):
        buf = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(buf)
        grid[gy : gy + h, gx : gx + w, :] = buf.reshape((h, w, 4))

    out_im = bpy.data.images.new("PoseGridOut", width=w * 2, height=h * 2, alpha=True)
    out_im.pixels.foreach_set(grid.ravel())
    out_im.filepath_raw = out_png_path
    out_im.file_format = "PNG"
    out_im.save()

    clear_pose(arm_obj)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cam_d)
    for im in imgs + [out_im]:
        bpy.data.images.remove(im)
    for p in tmp:
        if os.path.exists(p):
            os.remove(p)


def export_runtime_glb(arm_obj, meshes, out_glb_path: str):
    os.makedirs(os.path.dirname(out_glb_path), exist_ok=True)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    for m in meshes:
        m.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=out_glb_path,
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
    print(f"EXPORTED RUNTIME GLB: {out_glb_path} ({os.path.getsize(out_glb_path):,} bytes)")
