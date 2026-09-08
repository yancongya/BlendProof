import bpy
import json
import os
import sys

args = sys.argv[sys.argv.index("--") + 1:]
glb_path, manifest_path = args

# Ensure data written by modifiers is evaluated before the native exporter runs.
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=False,
    export_cameras=True,
    export_lights=True,
    export_materials='EXPORT',
    export_yup=True,
)

manifest = {
    "scene": bpy.context.scene.name,
    "camera": bpy.context.scene.camera.name if bpy.context.scene.camera else None,
    "objects": [
        {"name": obj.name, "type": obj.type, "collections": [col.name for col in obj.users_collection]}
        for obj in bpy.context.scene.objects
    ],
    "collections": [collection.name for collection in bpy.data.collections],
    "export": {
        "sourceBytes": os.path.getsize(bpy.data.filepath),
        "glbBytes": os.path.getsize(glb_path),
        "objectCount": len(bpy.context.scene.objects),
    },
}
with open(manifest_path, "w", encoding="utf-8") as file:
    json.dump(manifest, file, ensure_ascii=False, indent=2)
