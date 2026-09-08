import bpy
import math
import os
import sys

destination = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = next(node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1.0)
    shader.inputs['Roughness'].default_value = 0.34
    return mat

green = material('Green finish', (0.12, 0.48, 0.29))
orange = material('Orange accent', (0.8, 0.2, 0.06))

bpy.ops.mesh.primitive_cube_add(location=(-1.15, 0, 0))
cube = bpy.context.active_object
cube.name = '产品主体'
cube.data.materials.append(green)
cube.scale = (0.7, 0.7, 0.7)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(1.15, 0, 0))
sphere = bpy.context.active_object
sphere.name = '可替换部件'
sphere.data.materials.append(orange)

bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -0.72))
floor = bpy.context.active_object
floor.name = '展示底板'
floor.data.materials.append(material('Floor', (0.07, 0.1, 0.08)))

bpy.ops.object.light_add(type='AREA', location=(1.5, -2.5, 3.5))
light = bpy.context.active_object
light.name = '主灯'
light.data.energy = 700
light.data.shape = 'DISK'
light.data.size = 4

bpy.ops.object.camera_add(location=(5.2, -6.2, 3.8))
camera = bpy.context.active_object
camera.name = '审稿相机'
bpy.context.scene.camera = camera
camera.rotation_euler = (math.radians(67), 0, math.radians(39))

bpy.context.scene.name = '简易审稿测试场景'
os.makedirs(os.path.dirname(destination), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=destination)
