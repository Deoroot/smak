extends Node3D
# {{name}}, as packs/gltf wrote it, walked in first person. Written by packs/godot (docs/GODOT.md): the values under
# "filled in" are the map's; run the command again to change them, and put what is the map's own in own.gd.
#   1  baked: the game's light as hlrad compiled it (baked.glb)
#   2  lit: the map's lamps in real time, relief and roughness where a texture has a set (lit.glb)
#   H  the lamps' shadows on and off in 2
# WASD to walk, the mouse to look, Space to jump, Shift to run, Esc frees the mouse, F8 or closing the window quits.
#   --shots (after --): a picture of each way from each of SHOTS, shot-<name>-baked.png and shot-<name>-lit.png, then quits.
# The map's units are inches: 39.37 to the metre. A player there is 72 tall with the eye at 64.

const UNIT := 1.0 / 39.37
# ── filled in (the map's x, y, z in its own units; a yaw in degrees from +x towards +y) ──
const START := Vector3({{start}})   # where the feet stand
const START_YAW := {{yaw}}
const AMBIENT := Color({{ambient}})   # linear: the lit way's stand-in for the bounce light
const BACKGROUND := Color({{background}})
const TONEMAP := Environment.{{tonemap}}
const PROBE_AT := Vector3({{probeAt}})   # the reflection probe's box: its middle, its size, where it looks from
const PROBE_SIZE := Vector3({{probeSize}})
const PROBE_FROM := Vector3({{probeFrom}})
# the lit way's look: every lamp's energy times LAMPS; a texture light's cell lamp times CELLS besides; a lamp whose
# entity has the key _role times ROLES[its _role] (0: off); FINISH [a part of a material's name, its colour times
# this, its roughness or -1]; SSR screen-space reflections; FOG [density (0: none), r, g, b, and its box's x, y, z, sx, sy, sz (0: everywhere)]
const LAMPS := {{lamps}}
const CELLS := {{cells}}
const ROLES := {{roles}}
const FINISH := [{{finish}}]
const SSR := {{ssr}}
const FOG := [{{fog}}]
# the cameras of --shots: [name, from, yaw, pitch (degrees, up is positive), fov (degrees across)]
const SHOTS := [{{shots}}]
# ── the same for every map ──
const WAYS := [["res://baked.glb", "1: baked"], ["res://lit.glb", "2: lit in real time (H: shadows)"]]
const LIT := 1

var body: CharacterBody3D
var head: Camera3D
var pitch := 0.0
var scenes: Array[Node3D] = []
var way := LIT
var shadows := true
var env: Environment
var ambient := AMBIENT   # the lit way's: change it with set_ambient
var fog: FogVolume
var probe: ReflectionProbe
var label: Label
var own: Node   # res://own.gd when the author wrote one: a Node added last; its shown(way) is called last at each change of way

func to_gltf(v: Vector3) -> Vector3:
	return Vector3(v.x, v.z, -v.y) * UNIT

# a map yaw as a turn about Godot's up
func yaw_of(map_yaw: float) -> float:
	return deg_to_rad(map_yaw - 90.0)

# what a lamp of the lit way is: "cell" for a texture light's (no entity), else its entity's _role key ("" with none)
func role_of(light: Node) -> String:
	if not light.has_meta("extras"):
		return "cell"
	var keys = light.get_meta("extras").get("keys")
	return str(keys.get("_role", "")) if keys is Dictionary else ""

# the lit way's ambient, from own.gd at any time: the environment's and the probe's
func set_ambient(color: Color) -> void:
	ambient = color
	probe.ambient_color = color
	env.ambient_light_color = color if way == LIT else Color.BLACK

func _ready() -> void:
	for each in WAYS:
		var scene: Node3D = load(each[0]).instantiate()
		add_child(scene)
		scenes.append(scene)
	# one set of walls to stand on: the two have the same geometry, the lit one in far fewer triangles
	for mesh in scenes[LIT].find_children("*", "MeshInstance3D", true, false):
		mesh.create_trimesh_collision()
	for light in scenes[LIT].find_children("*", "Light3D", true, false):
		var role := role_of(light)
		var factor: float = LAMPS * (CELLS if role == "cell" else float(ROLES.get(role, 1.0)))
		if factor != 1.0:
			light.light_energy *= factor
			light.visible = factor > 0.0
	var seen := {}
	for mesh in scenes[LIT].find_children("*", "MeshInstance3D", true, false) if FINISH.size() > 0 else []:
		for s in mesh.mesh.get_surface_count():
			var material = mesh.mesh.surface_get_material(s)
			if not (material is BaseMaterial3D) or seen.has(material):
				continue
			seen[material] = true
			for each in FINISH:
				if str(material.resource_name).contains(each[0]):
					material.albedo_color *= Color(each[1], each[1], each[1])
					if each[2] >= 0.0:
						material.roughness = each[2]   # times its set's roughness map where it has one

	var world := WorldEnvironment.new()
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = BACKGROUND
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.tonemap_mode = TONEMAP
	world.environment = env
	if SSR:   # what is on the screen, in a floor that is smooth enough: the sign's image goes when the sign leaves the view
		env.ssr_max_steps = 96
		env.ssr_fade_in = 0.1
		env.ssr_fade_out = 2.0
		env.ssr_depth_tolerance = 0.3
	if FOG[0] > 0:
		env.volumetric_fog_albedo = Color(FOG[1], FOG[2], FOG[3])
		env.volumetric_fog_density = FOG[0] if FOG[7] <= 0 else 0.0
	if FOG[0] > 0 and FOG[7] > 0:   # one space's: a volume its size, none elsewhere
		fog = FogVolume.new()
		fog.shape = RenderingServer.FOG_VOLUME_SHAPE_BOX
		fog.position = to_gltf(Vector3(FOG[4], FOG[5], FOG[6]))
		fog.size = Vector3(FOG[7], FOG[9], FOG[8]) * UNIT
		var haze := FogMaterial.new()
		haze.density = FOG[0]
		haze.albedo = Color(FOG[1], FOG[2], FOG[3])
		haze.edge_fade = 0.3
		fog.material = haze
		add_child(fog)
	add_child(world)

	# The lit way's metal and varnish reflect what is round them: a probe boxed to the map (or to the room asked).
	probe = ReflectionProbe.new()
	probe.position = to_gltf(PROBE_AT)
	probe.size = Vector3(PROBE_SIZE.x, PROBE_SIZE.z, PROBE_SIZE.y) * UNIT
	probe.origin_offset = to_gltf(PROBE_FROM - PROBE_AT)
	probe.box_projection = true
	probe.interior = true
	probe.ambient_mode = ReflectionProbe.AMBIENT_COLOR
	probe.ambient_color = AMBIENT
	probe.ambient_color_energy = 1.0
	probe.update_mode = ReflectionProbe.UPDATE_ONCE
	add_child(probe)

	var layer := CanvasLayer.new()
	label = Label.new()
	label.position = Vector2(12, 8)
	layer.add_child(label)
	add_child(layer)

	body = CharacterBody3D.new()
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 16 * UNIT
	capsule.height = 72 * UNIT
	shape.shape = capsule
	shape.position.y = 36 * UNIT
	body.add_child(shape)
	head = Camera3D.new()
	head.position.y = 64 * UNIT
	head.fov = 75
	head.near = 0.05
	head.far = 300
	body.add_child(head)
	body.floor_max_angle = deg_to_rad(46)
	body.position = to_gltf(START) + Vector3(0, 0.05, 0)
	body.rotation.y = yaw_of(START_YAW)
	add_child(body)
	head.current = true

	if ResourceLoader.exists("res://own.gd"):
		own = load("res://own.gd").new()
		own.name = "Own"
		add_child(own)
	show_way(way)

	if "--shots" in OS.get_cmdline_user_args():
		shots()
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func show_way(n: int) -> void:
	way = n
	for i in scenes.size():
		scenes[i].visible = i == n
	var lit := n == LIT
	probe.visible = lit
	env.ambient_light_color = ambient if lit else Color.BLACK
	env.ssr_enabled = lit and SSR
	env.volumetric_fog_enabled = lit and FOG[0] > 0
	if fog:
		fog.visible = lit
	env.ambient_light_energy = 1.0 if lit else 0.0
	for light in scenes[LIT].find_children("*", "Light3D", true, false):
		light.shadow_enabled = shadows
	label.text = WAYS[n][1] + ("" if not lit else ("  [shadows on]" if shadows else "  [shadows off]"))
	if own and own.has_method("shown"):
		own.shown(n)

# each camera, each way: the body stopped (no fall), the label off
func shots() -> void:
	set_physics_process(false)
	var shot := Camera3D.new()
	shot.keep_aspect = Camera3D.KEEP_WIDTH
	shot.near = 0.05
	shot.far = 300
	add_child(shot)
	shot.current = true
	label.visible = false
	for v in SHOTS:
		shot.position = to_gltf(v[1])
		shot.rotation = Vector3(deg_to_rad(v[3]), yaw_of(v[2]), 0)
		shot.fov = v[4]
		for n in WAYS.size():
			show_way(n)
			for f in 40:
				await get_tree().process_frame
			var file := "res://shot-%s-%s.png" % [v[0], "lit" if n == LIT else "baked"]
			get_viewport().get_texture().get_image().save_png(file)
			print("wrote ", ProjectSettings.globalize_path(file))
	get_tree().quit()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		body.rotate_y(-event.relative.x * 0.0025)
		pitch = clamp(pitch - event.relative.y * 0.0025, -1.5, 1.5)
		head.rotation.x = pitch
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_ESCAPE:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED
			KEY_F8: get_tree().quit()
			KEY_1: show_way(0)
			KEY_2: show_way(1)
			KEY_H:
				shadows = not shadows
				show_way(way)
	elif event is InputEventMouseButton and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _physics_process(delta: float) -> void:
	var wish := Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W): wish.z -= 1
	if Input.is_physical_key_pressed(KEY_S): wish.z += 1
	if Input.is_physical_key_pressed(KEY_A): wish.x -= 1
	if Input.is_physical_key_pressed(KEY_D): wish.x += 1
	var speed := (320.0 if Input.is_physical_key_pressed(KEY_SHIFT) else 190.0) * UNIT
	var move := (body.global_transform.basis * wish.normalized()) * speed
	body.velocity.x = move.x
	body.velocity.z = move.z
	if body.is_on_floor():
		body.velocity.y = 268 * UNIT if Input.is_physical_key_pressed(KEY_SPACE) else 0.0
	else:
		body.velocity.y -= 800 * UNIT * delta
	body.move_and_slide()
