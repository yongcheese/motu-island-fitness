# SPDX-License-Identifier: Apache-2.0
#
# FIX THE CHARACTER SOURCE, IN BLENDER.
#
#   blender -b <first.blend> --python scripts/fix-character-blend.py -- --save --export <out.glb>
#
# The .blend is `<Desktop>/blender/first.blend` and there is only one of them — older versions
# live in `blender/archive/`. Keep it that way: a backup left beside the file it backs up gets
# opened by mistake, and then two files are both half-current. See docs/character-authored-model.md.
#
# Run with no flags it is a DRY RUN: it measures, prints exactly what it would change, and
# writes nothing. `--save` overwrites the .blend, `--export` writes a fresh .glb.
#
# ---------------------------------------------------------------------------
# WHY THESE EDITS ARE HERE AND NOT IN THE SPLITTER
# ---------------------------------------------------------------------------
#
# `scripts/split-character-glb.mjs` can repair the export — it turns inside-out geometry the
# right way round and centres the eyes — but every one of those repairs runs AGAIN on every
# re-cut, because the source it reads from is still wrong. Worse, they are invisible to whoever
# opens the .blend next: the file on the modeller's screen does not match the character in the
# game. These edits move the fixes upstream to the one file a person actually edits.
#
# ---------------------------------------------------------------------------
# WHAT IT CHANGES
# ---------------------------------------------------------------------------
#
# 1. EYES CENTRED. The pair sits off the face's centreline; each eye is otherwise an exact
#    mirror of the other. Fixed by translating BOTH eye islands by the pair's own offset, which
#    is a rigid move of the pair rather than a re-placement of either eye.
#
# 2. THE RIGHT EYE TURNED RIGHT SIDE OUT. Mirrored with a negative scale and applied without
#    recalculating, so its faces wind inward: backface culling makes it INVISIBLE in the game
#    while it looks perfectly fine in Blender's solid view. Detected by signed volume, per
#    connected island, so it cannot mistake a concave shape for an inverted one.
#
# 3. THE TWO BODY SEAMS CLOSED — and closed WITHOUT resizing the torso, which is a design
#    decision this script does not get to make. Both seams are geometric, not aesthetic:
#
#      SHOULDER  the upper arm's axis passed OUTSIDE the torso's widest point, so near the top
#                of the arm — where the capsule's cap narrows towards its tip — the arm became
#                thinner than the distance to the body and daylight opened between the two.
#                Fixed by bringing the arm IN until its tip sits under the head, which is broad
#                enough at that height to cover it. Widening the torso would also have worked
#                and would have cost the character the body it was drawn with.
#      HIP       the thighs are nearly as wide as the torso and nearly touching each other, so
#                the torso's bottom cap was both narrower than they are — the notch either side
#                of the crotch — and wedged into a 4 mm crack between them. Fixed by slimming
#                the legs, which shrinks the step and opens an honest gap in one move.
#
#    Slimming the legs also slims the TROUSERS, because a trouser cannot be thinner than the leg
#    it covers and `attachments.leg` derives its scale from that radius. There is no separate
#    trouser number.
#
# The numbers are stated once below and everything else is derived. Re-run
# `npm run split:character` afterwards and re-paste what it prints.

import sys
import math
import bmesh
import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# THE NUMBERS
# ---------------------------------------------------------------------------

# Torso scale — None means DO NOT TOUCH IT, which is the setting this file ships with.
#
# The body's size is a design decision, not a defect, and this script does not get to overrule
# it. There is a sharper reason to leave it at None as well: setting it writes a UNIFORM scale,
# and the torso is not uniformly scaled any more (0.769 wide / 0.680 tall / 0.662 deep — it was
# deliberately flattened front-to-back). A number here would silently undo that. The guard below
# refuses rather than letting it happen quietly, but None is the honest default.
#
# What leaving it costs, stated plainly so it is not rediscovered later: the thigh's outer edge
# sits within ~8 mm of world of the torso's widest point, so the instant the bottom cap starts to
# taper it is narrower than the legs and the thighs stand outside it instead of emerging from
# under it. That is the notch either side of the crotch. It is closed from the LEG end instead —
# see LEG_SCALE.
TORSO_SCALE = None

# Where the arm attaches, as an ABSOLUTE distance from the centreline in source units. None
# means leave it where the modeller put it, which is the setting this file ships with.
#
# It was 0.108 for one export, to close a shoulder gap: the arm's axis passed outside the body's
# widest point, so where the capsule tapered to its tip it became thinner than the distance
# across and daylight opened between the two. The model has since solved that itself — the arm
# mesh was moved down inside its own group so its top no longer reaches above the torso — so
# forcing the attachment inward now would move an arm that is already where it belongs.
#
# Absolute rather than "move in by N" whenever it IS set: a relative inset moves the arms further
# in on every re-run, which goes unnoticed until they are through the chest.
ARM_X = None

# Objects whose local X is the arm's attachment. The `.00N` ones are the leftover duplicates
# from mirroring; they are not read by the splitter, but leaving them behind would put the
# viewport out of step with the game for whoever opens this file next.
ARM_OBJECTS = ['Arm_L', 'Arm_L.001', 'Arm_L.002', 'Arm_L.003']

# How much of its CROSS-SECTION each leg keeps. 1.0 is AS AUTHORED, and that is where it belongs.
#
# It was 0.85 for a while, to close a notch at the hip: the thighs are nearly as wide as the
# torso, so its bottom cap was narrower than they are almost immediately and they stood outside
# it instead of emerging from under it. Slimming them did fix that — and opened a worse problem
# at the other end, because the thighs are also nearly TOUCHING. Their axes do not move when they
# get thinner, so every millimetre off the radius is a millimetre of daylight added between them:
# 0.85 turned a 4 mm crack into a 43 mm slot running the whole length of the legs.
#
# THE REASON 1.0 WINS IS NOT GEOMETRY, IT IS WHAT IS ACTUALLY ON SCREEN. `hasFallbackShirt =
# !isAnyShirtEquipped` (character/outfit.ts): the game always puts a shirt on a bare torso, so the
# hip notch that 0.85 fixed is never visible to a player — it only exists in a bare-body preview.
# The slot it opened is visible constantly, because it is below the shirt's hem. Optimising the
# preview at the expense of the game is exactly backwards.
#
# If it is ever set below 1.0 again: the legs have to move INWARD by the same amount they thin,
# or the crotch opens. That is a model change, not a scale.
LEG_SCALE = 1.0

# The leg mesh's own scale is (width, depth, length) in Blender's axes; only the first two move.
LEG_OBJECTS = ['Leg_L_Upper', 'Leg_L_Upper.001']

TORSO_OBJECT = 'Torso'
HEAD_MESH_OBJECT = 'Head_Skin'
# As authored, so LEG_SCALE stays an absolute statement of the leg's width and re-running the
# script cannot slim the legs twice.
LEG_BASE_SCALE = (0.907971, 1.0)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DRY_RUN = '--save' not in argv and '--export' not in argv
EXPORT_TO = argv[argv.index('--export') + 1] if '--export' in argv else None

changes = []


def note(line):
    changes.append(line)


# ---------------------------------------------------------------------------
# 1 + 2. THE EYES
# ---------------------------------------------------------------------------

def face_islands(bm):
    """Connected groups of faces. An eye is one; the skull is another."""
    bm.faces.ensure_lookup_table()
    seen = set()
    out = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack = [face]
        seen.add(face.index)
        group = []
        while stack:
            current = stack.pop()
            group.append(current)
            for edge in current.edges:
                for neighbour in edge.link_faces:
                    if neighbour.index not in seen:
                        seen.add(neighbour.index)
                        stack.append(neighbour)
        out.append(group)
    return out


def signed_volume(faces):
    """Positive when a closed island is wound outward — the divergence theorem, by triangle fan."""
    total = 0.0
    for face in faces:
        vs = [v.co for v in face.verts]
        for k in range(1, len(vs) - 1):
            total += vs[0].dot(vs[k].cross(vs[k + 1])) / 6.0
    return total


def island_centre(faces):
    total = Vector((0, 0, 0))
    count = 0
    for face in faces:
        for vert in face.verts:
            total += vert.co
            count += 1
    return total / count


head = bpy.data.objects[HEAD_MESH_OBJECT]
mesh = head.data

if mesh.has_custom_normals:
    # Reversing a face's winding does not touch a custom split normal, so an inverted island
    # would come out lit from the wrong side even after its faces were turned. Clearing them
    # lets Blender derive normals from the winding, which is what a plain shaded model wants —
    # but it is a change to the whole mesh, so it is said out loud rather than done quietly.
    #
    # Through the operator rather than `mesh.free_normals_split()`: that method was removed in
    # Blender 4.1, when custom normals became an ordinary mesh attribute.
    note(f'{HEAD_MESH_OBJECT}: cleared custom split normals (they would survive a winding flip)')
    if not DRY_RUN:
        bpy.context.view_layer.objects.active = head
        head.select_set(True)
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        # The operator drops the object into edit mode; bmesh cannot write to a mesh that is
        # still open there, and the failure comes several steps later as a confusing
        # "Mesh is in editmode".
        if head.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        head.select_set(False)

bm = bmesh.new()
bm.from_mesh(mesh)

islands = face_islands(bm)
# The eyes are the small islands; the skull is the big one. Told apart by face count rather than
# by material, so re-assigning a material in Blender cannot break this.
eyes = sorted((g for g in islands if len(g) < len(mesh.polygons) / 2), key=lambda g: island_centre(g).x)

if len(eyes) == 2:
    centres = [island_centre(g) for g in eyes]
    offset = (centres[0].x + centres[1].x) / 2
    if abs(offset) > 1e-5:
        note(
            f'eyes: centred the pair — both moved {-offset:+.6f} in x '
            f'({centres[0].x:.6f} / {centres[1].x:.6f} → ±{abs(centres[0].x - offset):.6f})'
        )
        if not DRY_RUN:
            moved = set()
            for group in eyes:
                for face in group:
                    for vert in face.verts:
                        if vert.index not in moved:
                            moved.add(vert.index)
                            vert.co.x -= offset
    else:
        note('eyes: already centred')
else:
    note(f'eyes: expected 2 small islands, found {len(eyes)} — left alone')

for i, group in enumerate(islands):
    volume = signed_volume(group)
    if volume < 0:
        centre = island_centre(group)
        note(
            f'island at x {centre.x:+.4f} ({len(group)} faces): was wound inside-out '
            f'(volume {volume:+.8f}) — reversed'
        )
        if not DRY_RUN:
            bmesh.ops.reverse_faces(bm, faces=group)

if not DRY_RUN:
    bm.to_mesh(mesh)
    mesh.update()
bm.free()

# ---------------------------------------------------------------------------
# 3. THE SEAMS
# ---------------------------------------------------------------------------

torso = bpy.data.objects[TORSO_OBJECT]
if TORSO_SCALE is not None:
    was = tuple(torso.scale)
    spread = max(was) - min(was)
    if spread > 1e-4:
        # Refusing rather than obeying. A single number can only express a uniform scale, so
        # applying one here would flatten a torso that was deliberately given different width,
        # height and depth — and it would do it silently, as a side effect of a setting that
        # looks like it is about size.
        note(
            f'{TORSO_OBJECT}: REFUSED to set scale {TORSO_SCALE} — the torso is non-uniformly '
            f'scaled ({was[0]:.5f}, {was[1]:.5f}, {was[2]:.5f}) and a single number would undo '
            f'that. Set TORSO_SCALE back to None, or change the torso in Blender.'
        )
    elif abs(was[0] - TORSO_SCALE) > 1e-6:
        note(f'{TORSO_OBJECT}: scale {was[0]:.5f} → {TORSO_SCALE:.5f} (uniform)')
        if not DRY_RUN:
            torso.scale = (TORSO_SCALE, TORSO_SCALE, TORSO_SCALE)

for name in LEG_OBJECTS:
    leg = bpy.data.objects.get(name)
    if leg is None:
        continue
    target = (LEG_BASE_SCALE[0] * LEG_SCALE, LEG_BASE_SCALE[1] * LEG_SCALE, leg.scale.z)
    if max(abs(leg.scale[i] - target[i]) for i in range(3)) < 1e-6:
        continue
    note(
        f'{name}: cross-section {leg.scale.x:.6f}×{leg.scale.y:.6f} → '
        f'{target[0]:.6f}×{target[1]:.6f} (length unchanged)'
    )
    if not DRY_RUN:
        leg.scale = target

for name in ARM_OBJECTS if ARM_X is not None else []:
    arm = bpy.data.objects.get(name)
    if arm is None:
        continue
    # The mirrored duplicates hang off a parent with a negative x scale, so giving them all the
    # same local x puts them on the same side of their own parent and they stay in step.
    before = arm.location.x
    after = math.copysign(ARM_X, before)
    if abs(before - after) < 1e-6:
        continue
    note(f'{name}: x {before:+.6f} → {after:+.6f}')
    if not DRY_RUN:
        arm.location.x = after

# ---------------------------------------------------------------------------
# REPORT, SAVE, EXPORT
# ---------------------------------------------------------------------------

print('')
print('=== fix-character-blend ' + ('(DRY RUN — nothing written)' if DRY_RUN else '') + ' ===')
for line in changes:
    print('  · ' + line)
print('')

if not DRY_RUN:
    if EXPORT_TO:
        bpy.ops.export_scene.gltf(
            filepath=EXPORT_TO,
            export_format='GLB',
            export_yup=True,
            use_selection=False,
            export_cameras=False,
            export_lights=False,
            export_apply=False,
        )
        print(f'  exported {EXPORT_TO}')
    if '--save' in argv:
        bpy.ops.wm.save_mainfile()
        print(f'  saved {bpy.data.filepath}')
print('')
