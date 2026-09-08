import bpy
import json
import os
import sys
from mathutils import Vector

output_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(output_dir, exist_ok=True)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = 0.38
    return material


def point_camera(camera, target=(0.0, 0.0, 0.0)):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(name, location, target=(0.0, 0.0, 0.0), projection="PERSP"):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.active_object
    camera.name = name
    camera.data.type = projection
    if projection == "ORTHO":
        camera.data.ortho_scale = 7.0
    else:
        camera.data.lens = 52
    point_camera(camera, target)
    return camera


def add_scene_geometry():
    green = make_material("Green Body", (0.06, 0.42, 0.18))
    orange = make_material("Orange Part", (0.95, 0.24, 0.03))
    blue = make_material("Blue Marker", (0.04, 0.26, 0.8))
    floor_material = make_material("Floor", (0.055, 0.065, 0.08))

    bpy.ops.mesh.primitive_cube_add(location=(-1.7, 0.0, 0.0), scale=(0.8, 0.8, 0.8))
    bpy.context.active_object.name = "产品主体"
    bpy.context.active_object.data.materials.append(green)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(0.4, 0.0, 0.0))
    bpy.context.active_object.name = "可替换部件"
    bpy.context.active_object.data.materials.append(orange)

    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.75, radius2=0.15, depth=1.8, location=(2.0, 0.0, 0.1))
    bpy.context.active_object.name = "方向标记"
    bpy.context.active_object.data.materials.append(blue)

    bpy.ops.mesh.primitive_plane_add(size=9, location=(0.0, 0.0, -0.85))
    bpy.context.active_object.name = "展示底板"
    bpy.context.active_object.data.materials.append(floor_material)

    bpy.ops.object.light_add(type="AREA", location=(1.5, -3.5, 5.0))
    light = bpy.context.active_object
    light.name = "主灯"
    light.data.energy = 900
    light.data.shape = "DISK"
    light.data.size = 4.0


def create_fixture(slug, camera_specs):
    reset_scene()
    add_scene_geometry()
    cameras = [add_camera(**spec) for spec in camera_specs]
    bpy.context.scene.name = slug
    bpy.context.scene.camera = cameras[0] if cameras else None

    blend_path = os.path.join(output_dir, f"{slug}.blend")
    glb_path = os.path.join(output_dir, f"{slug}.glb")
    manifest_path = os.path.join(output_dir, f"{slug}.manifest.json")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=False,
        export_cameras=True,
        export_lights=True,
        export_materials="EXPORT",
        export_yup=True,
    )
    manifest = {
        "fixture": slug,
        "scene": bpy.context.scene.name,
        "activeCamera": bpy.context.scene.camera.name if bpy.context.scene.camera else None,
        "cameras": [
            {
                "name": camera.name,
                "projection": camera.data.type,
                "location": list(camera.location),
            }
            for camera in cameras
        ],
        "objects": [
            {"name": obj.name, "type": obj.type}
            for obj in bpy.context.scene.objects
        ],
        "sourceBytes": os.path.getsize(blend_path),
        "glbBytes": os.path.getsize(glb_path),
    }
    with open(manifest_path, "w", encoding="utf-8") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
    print(json.dumps({"fixture": slug, "cameraCount": len(cameras)}, ensure_ascii=False))


create_fixture("viewer-no-camera", [])
create_fixture(
    "viewer-single-camera",
    [
        {
            "name": "正面审稿相机",
            "location": (0.0, -10.0, 1.8),
            "target": (0.0, 0.0, 0.0),
            "projection": "PERSP",
        }
    ],
)
create_fixture(
    "viewer-multi-camera",
    [
        {
            "name": "低角度透视相机",
            "location": (-8.5, -7.5, 1.2),
            "target": (0.0, 0.0, 0.0),
            "projection": "PERSP",
        },
        {
            "name": "顶部正交相机",
            "location": (0.0, 0.0, 11.0),
            "target": (0.0, 0.0, 0.0),
            "projection": "ORTHO",
        },
    ],
)
