// A port held to its original in s&box's own editor: the compiled model read back there and played, frame by frame,
// and each bone's place set beside where GoldSrc's animation puts it.
//
//   probeCode(vmdl, samples)                       the C# that reads a compiled model and poses it (run_csharp)
//   expectedOf(src, port, { groups, samples })     what the original says: its bones' names, animations' lengths,
//                                                  parts, skins, attachments, hit boxes, and its poses
//   compareSbox(expected, read, { tolerance })     -> { passed, faults, said, worst }
//   physicsProbeCode(vmdl, poses), comparePhysics(expected, read)   its physics read back, and tried
//   soundProbeCode(vmdl, sounds, soundEvents), compareSounds(expected, read)   its sounds read back, played, heard
//   lookViewsOf(framed), lookKitOf(src, looks), lookProbeCode(vmdl, views), compareLooks(kit, sbox, { skip })
//                                                  how it looks, beside the kit's own
//                                                  picture of the original
//   checkSboxPort(file, { project, name, folder, kind, collision, surfaceprop, mass, sbox, perSequence, look, shot })
//                                                  -> the whole check, in the editor
//
// WHAT IS HELD. The compiled model must have every bone of the port, under its parent; every animation, of its
// length ((frames - 1) / fps); every bodypart with its choices; a material group a skin (none when one); every
// attachment and hit box. Then each animation is played at its first frame and its middle one (more with
// perSequence), stopped there, and every bone's place in the model's space read: it must be where GoldSrc's frame
// puts it (mdl.poseAt), within `tolerance` units. A model turned, a bone misnamed (its channel then moves nothing),
// a bone dropped, a walk whose travel was not taken out all show as bones off their place. Each blend after an
// animation's first is held so too, as the animation of its own it is. And a model whose animations blend has its
// graph played (graph.mjs): each such animation chosen by the graph's `sequence` and held at its first frame at its
// blends' start, middle and end, where GoldSrc's renderer would put it (blendedPoseAt: StudioSlerpBones, each bone's
// turn slerped and its place mixed), within the same tolerance.
//
// ITS MATERIALS: each one the port wrote compiled by the editor (its asset_compile asked; s&box draws one that did not
// compile red, and says so nowhere else: v_9mmhandgun's gloves, in a project whose folder ran their textures' paths
// past 260 characters).
//
// HOW IT LOOKS (`look`, unless false): the model drawn by s&box in a scene of its own (a white ambient light its
// only light, so a texture shows as it is), in its first animation's first frame, from four views round it
// (LOOK), and by the kit's own renderer (render.mjs, `light: false`) from the same eyes. Its silhouette must be
// the original's (LOOK_SHAPE of the model's pixels in either picture in the other) and its colours too, region by
// region (no more than LOOK_COLOUR of the regions another colour; a chrome texture's pixels left out, the kit
// drawing it from the eye and the port from one place). A material that did not compile, a texture lost or wrong,
// holes filled, a part missing or one too many, a model turned all show here; the bones' check sees none of them.
//
// ITS SOUNDS (sound.mjs), when its events play any: each .sound read back as the editor compiled it, playing its
// file, as long as the original (within SOUND_LENGTH), heard as far as GoldSrc heard it (its Distance, its falloff a
// line from 1 to 0), with no occlusion or reverb, and as loud, window by window, as the original
// (soundEnvelope: correlated SOUND_LIKENESS or more). Then each played, far off so that none is heard: one that
// loops still playing after its length, one that does not stopped. And each animation with sound events played
// through, by a renderer of its own: the sounds it is heard to play (SkinnedModelRenderer.OnSoundEvent) its events',
// as many of each; a loop's played looping (s&box fires an event at a held animation's last frame not at all, a
// looping one's each time round, as GoldSrc), each of its sounds heard and no other.
//
// THE EDITOR. The check runs in the project's editor (editor.mjs: the one open, else one opened and closed
// after). Its probe object is made in the scene being edited and removed before the check ends; the scene is not
// saved. Its picture (`shot`): the kit's four views above s&box's.
import { readStudio, sequenceFilesOf } from "../studio-file.mjs";
import { sequenceGroups, poseAt, sequences as sequencesOf, readSequence, frameValues, boneParents, boneMatrices } from "../mdl.mjs"; // prettier-ignore
import { qofAngles, qslerp, anglesOf } from "../animate.mjs";
import { GRAPH_SEQUENCE } from "./graph.mjs";
import { portToSbox } from "./port.mjs";
import { sourceName } from "../source/port.mjs";
import { soundFoldersOf } from "../source/gmod.mjs";
import { editorFor, runCsharp, sboxCall, projectFolder, compileAssets } from "./editor.mjs";
import { render, framing, posed } from "../render.mjs";
import { png, unpng } from "../image.mjs";
import { compileVmdl, findSbox } from "./compile.mjs";
import { restOf, insideLimits, jointStretch, quaternionOfTurn } from "./physics.mjs";
import { soundEnvelope, ENVELOPE_WINDOW } from "./sound.mjs";
import { readWav } from "../audio/wav.mjs";
import { compileSounds } from "./compile.mjs";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How far a bone may be from GoldSrc's place, in units: s&box compresses its animations (Half-Life's barney,
 * houndeye, scientist and hgrunt, 918 poses: 0.025 at most). */
export const POSE_TOLERANCE = 0.1;
/** And how much farther, per unit of the bone's chain (its links to the root, end to end, in the pose): a rotation
 * compressed turns a long chain's end by more (all 210 of Half-Life's models: tentacle2's, nihilanth's, the osprey's
 * and the loader's ends of chain up to 0.19 off). 0.0005 is a turn of 0.03 degrees; a model turned by one degree
 * is 35 times that. */
export const REACH_TOLERANCE = 0.0005;
/** The probe object's name in the scene, and where it stands: away from anything of the person's. */
const PROBE = "smak_sbox_check";
const PROBE_AT = [0, 0, -10000];

const csString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Every bone's matrix at one frame of an animation that blends, `share` of the way from its first blend to its
 * second (0 to 1), as GoldSrc's renderer mixes the two (StudioSlerpBones): each bone's turn slerped, its place
 * mixed. (GoldSrc's game code gives the share as a byte, 0 to 255; a graph's parameter is not so stepped.)
 */
export function blendedPoseAt(src, seq, frame, share, groups) {
  const [first, second] = [0, 1].map((blend) => frameValues(src, seq, frame, blend, groups));
  const values = first.map((six, i) => {
    const other = second[i];
    const turn = qslerp(qofAngles(six.slice(3)), qofAngles(other.slice(3)), share);
    return [...[0, 1, 2].map((k) => six[k] + (other[k] - six[k]) * share), ...anglesOf(turn)];
  });
  return boneMatrices(boneParents(src).map((parent) => ({ parent })), values);
}

/** How fast the graph plays when it is held: so slowly that it stays at an animation's first frame (at 0 it is not
 * played at all). */
const GRAPH_HELD = 0.0001;

/**
 * The C# that reads the compiled model at `vmdl` and poses it at each of `samples` ([{ sequence, time }]), and its
 * graph at each of `graphSamples` ([{ sequence, set: [[parameter, value]] }]: a renderer of its own each, told them
 * before it starts, so that its graph starts on that animation, and played at GRAPH_HELD). It returns { error } or
 * { bones, sequences, parts, groups, attachments, hitboxes, poses, graph, graphParameters, graphPoses }; the probe
 * object is left posed at the first sample for a picture, and removed by removeProbeCode.
 */
export function probeCode(vmdl, samples, graphSamples = []) {
  const list = samples.map((s) => `(${csString(s.sequence)}, ${Number(s.time).toFixed(6)}f)`).join(", ");
  const graphed = graphSamples
    .map((s) => `{
	var g = scene.CreateObject();
	g.Name = ${csString(PROBE)};
	g.WorldPosition = new Vector3( ${PROBE_AT.join(", ")} );
	var gr = g.Components.Create<SkinnedModelRenderer>( false );
	gr.Model = model;
	gr.UseAnimGraph = true;
	gr.PlaybackRate = ${GRAPH_HELD}f;
	gr.PlayAnimationsInEditorScene = true;
	gr.Set( ${csString(GRAPH_SEQUENCE)}, ${csString(s.sequence)} );
${s.set.map(([name, value]) => `\tgr.Set( ${csString(name)}, ${Number(value).toFixed(6)}f );`).join("\n")}
	gr.Enabled = true;
	graphed.Add( (g, gr) );
}`)
    .join("\n");
  return `
var model = Model.Load( ${csString(vmdl)} );
if ( model is null || model.IsError ) return new { error = "the model did not load: " + ${csString(vmdl)} };
var scene = Editor.SceneEditorSession.Active?.Scene ?? Game.ActiveScene;
foreach ( var old in scene.GetAllObjects( true ).Where( g => g.Name == ${csString(PROBE)} ).ToList() ) old.Destroy();
var r3 = ( Vector3 v ) => new[] { MathF.Round( v.x, 4 ), MathF.Round( v.y, 4 ), MathF.Round( v.z, 4 ) };
var bones = Enumerable.Range( 0, model.BoneCount ).Select( i => new object[] { model.GetBoneName( i ), model.GetBoneParent( i ) } ).ToArray();
var sequences = Enumerable.Range( 0, model.AnimationCount ).Select( i => model.GetAnimationName( i ) ).ToArray();
var parts = model.Parts.All.Select( p => new object[] { p.Name, p.Choices.Select( c => c.Name ).ToArray() } ).ToArray();
var groups = Enumerable.Range( 0, model.MaterialGroupCount ).Select( i => model.GetMaterialGroupName( i ) ).ToArray();
var attachments = Enumerable.Range( 0, model.AttachmentCount ).Select( i => model.GetAttachmentName( i ) ).ToArray();
var hitboxes = ( model.HitboxSet?.All ?? new HitboxSet.Box[0] ).Select( h => new object[] { h.Name, h.Bone?.Name, string.Join( ",", h.Tags?.TryGetAll() ?? new string[0] ) } ).ToArray();
var go = scene.CreateObject();
go.Name = ${csString(PROBE)};
go.WorldPosition = new Vector3( ${PROBE_AT.join(", ")} );
var r = go.Components.Create<SkinnedModelRenderer>();
r.Model = model;
r.UseAnimGraph = false;
r.PlayAnimationsInEditorScene = true;
var poses = new System.Collections.Generic.List<object>();
var durations = new System.Collections.Generic.Dictionary<string, float>();
var samples = new (string, float)[] { ${list} };
foreach ( var (name, time) in samples.Reverse() )
{
	r.Sequence.Name = name;
	r.Sequence.PlaybackRate = 0;
	// a looping renderer wraps an animation's very end to its start: not looping, it holds its last frame
	r.Sequence.Looping = false;
	var t = time;
	r.Sequence.Time = t;
	await Task.Delay( 40 );
	r.Sequence.Time = t;
	await Task.Delay( 40 );
	durations[name] = r.Sequence.Duration;
	var world = r.GetBoneTransforms( true );
	poses.Insert( 0, new { sequence = name, time, at = r.Sequence.Time, bones = world.Select( t => r3( t.Position - go.WorldPosition ) ).ToArray() } );
}
var graphed = new System.Collections.Generic.List<(GameObject, SkinnedModelRenderer)>();
${graphed}
if ( graphed.Count > 0 ) await Task.Delay( 300 );
var graph = graphed.Count > 0 ? graphed[0].Item2.SceneModel?.AnimationGraph : null;
var graphParameters = graph is null ? new string[0] : Enumerable.Range( 0, graph.ParamCount ).Select( i => graph.GetParameterName( i ) ).ToArray();
var graphPoses = graphed.Select( p => p.Item2.GetBoneTransforms( true ).Select( t => r3( t.Position - p.Item1.WorldPosition ) ).ToArray() ).ToArray();
foreach ( var (g, _) in graphed ) g.Destroy();
return new { bones, sequences, durations, parts, groups, attachments, hitboxes, poses, graph = graph?.Name, graphParameters, graphPoses };
`;
}

/** How far a ragdoll's pieces may move when held at rest with their collisions on, in units: none push another. */
export const REST_HOLD = 0.1;
/** How far a piece may move when the ragdoll is held in a pose inside its joints' limits (collisions off), in
 * units: s&box's joints swing in a cone, Source's turn about three axes, so a pose near a limit settles a little
 * (barney's, 0.4 at most). */
export const POSE_HOLD = 1;
/** How far inside every joint's limits a pose must be to be held, in degrees. */
export const LIMIT_MARGIN = 5;
/** How far a pose may move a joint's bone off the piece above and be held, in units (jointStretch). */
export const STRETCH_MOST = 0.5;
/** How far a hull's box may be from the port's, each way, in units (the compiler simplifies a hull). */
export const HULL_TOLERANCE = 0.5;
/**
 * Dropped: s&box's gravity (a scene's, 850 units a second each second), from this high above a floor, until it is
 * still (no piece has moved `still` units in the last second) or `most` seconds have gone: barney is still in 2,
 * osprey (1169 units long) in 8.
 */
const DROP = { gravity: 850, above: 20, still: 1, most: 15 };
/** How far a dropped model may sink into the floor, or its joints come apart, in units: 1, or a hundredth of its
 * size when that is more (loader's, 661 units, 3 apart under its own weight). */
export const DROP_TOLERANCE = { units: 1, share: 0.01 };

const csTransform = ([x, y, z, qx, qy, qz, qw]) =>
  `new Transform( new Vector3( ${[x, y, z].map((v) => `${v.toFixed(4)}f`).join(", ")} ), new Rotation( ${[qx, qy, qz, qw].map((v) => `${v.toFixed(6)}f`).join(", ")} ) )`; // prettier-ignore

/**
 * The C# that reads a compiled model's physics and tries it in worlds of its own (PhysicsWorld, made and deleted
 * here; the scene is not touched): held at rest with its collisions on, held in each of `poses` ([{ name, bodies:
 * { bone: [x, y, z, qx, qy, qz, qw] } }]) with them off, and dropped onto a floor. Returns { bodies, joints,
 * restMoved, held, dropped } ({ bodies: [] } when it has none).
 */
export function physicsProbeCode(vmdl, poses) {
  const list = poses
    .map(
      (p) =>
        `( ${csString(p.name)}, new System.Collections.Generic.Dictionary<string, Transform> { ${Object.entries(
          p.bodies,
        )
          .map(([bone, t]) => `[${csString(bone)}] = ${csTransform(t)}`)
          .join(", ")} } )`,
    ) // prettier-ignore
    .join(",\n");
  return `
var model = Model.Load( ${csString(vmdl)} );
var phys = model?.Physics;
if ( phys is null || phys.Parts.Count == 0 ) return new { bodies = new object[0] };
var r3 = ( Vector3 v ) => new[] { MathF.Round( v.x, 4 ), MathF.Round( v.y, 4 ), MathF.Round( v.z, 4 ) };
var parts = phys.Parts.ToList();
var bodies = parts.Select( b => new { bone = b.BoneName, mass = b.Mass, surface = b.Hulls.FirstOrDefault()?.Surface?.ResourceName, points = b.Hulls.SelectMany( h => h.GetPoints().Select( p => r3( b.Transform.PointToWorld( p ) ) ) ).ToArray() } ).ToArray();
var joints = phys.Joints.Select( j => {
	var a = parts[j.Body1]; var b = parts[j.Body2];
	var f1 = a.Transform.ToWorld( j.Frame1 ); var f2 = b.Transform.ToWorld( j.Frame2 );
	return new { type = j.Type.ToString(), parent = a.BoneName, child = b.BoneName, at1 = r3( f1.Position ), at2 = r3( f2.Position ), z1 = r3( f1.Rotation.Up ), swing = j.SwingMax, twist = new[] { j.TwistMin, j.TwistMax } };
} ).ToArray();
var rest = parts.Select( b => b.Transform ).ToArray();
var hullPoints = parts.Select( b => b.Hulls.SelectMany( h => h.GetPoints() ).ToArray() ).ToArray();
(PhysicsWorld, System.Collections.Generic.List<PhysicsBody>) Make( Transform[] start, bool collide, Vector3 gravity )
{
	var world = new PhysicsWorld();
	world.Gravity = gravity;
	var made = world.SetupPhysicsFromModel( model, Transform.Zero, PhysicsMotionType.Dynamic ).Bodies.ToList();
	for ( int k = 0; k < made.Count; k++ )
	{
		made[k].Transform = start[k]; made[k].Velocity = 0; made[k].AngularVelocity = 0;
		if ( !collide ) foreach ( var shape in made[k].Shapes ) shape.EnableSolidCollisions = false;
	}
	return (world, made);
}
float Moved( System.Collections.Generic.List<PhysicsBody> made, Transform[] start ) => made.Select( ( b, k ) => b.Transform.Position.Distance( start[k].Position ) ).Max();
void Run( PhysicsWorld world, float seconds ) { for ( int s = 0; s < (int)( seconds * 60 ); s++ ) world.Step( 1f / 60f ); }
// held at rest, colliding with each other
var (atRest, restBodies) = Make( rest, true, Vector3.Zero );
Run( atRest, 1 );
var restMoved = Moved( restBodies, rest );
// what each body weighs to the physics (the description's mass is 0 when s&box works it out from its surface)
var weighs = restBodies.Select( b => b.Mass ).ToArray();
atRest.Delete();
// held in poses inside their joints' limits, not colliding
var poses = new (string, System.Collections.Generic.Dictionary<string, Transform>)[] { ${list} };
var held = new System.Collections.Generic.List<object>();
foreach ( var (name, pose) in poses )
{
	var start = parts.Select( ( b, k ) => pose.TryGetValue( b.BoneName, out var t ) ? t : rest[k] ).ToArray();
	var (posed, posedBodies) = Make( start, false, Vector3.Zero );
	Run( posed, 1 );
	var moved = posedBodies.Select( ( b, k ) => (b.Transform.Position.Distance( start[k].Position ), parts[k].BoneName) ).MaxBy( x => x.Item1 );
	held.Add( new { name, moved = moved.Item1, bone = moved.Item2 } );
	posed.Delete();
}
// dropped onto a floor at 0
var lift = ${DROP.above}f - parts.Select( ( b, k ) => hullPoints[k].Length == 0 ? b.Transform.Position.z : hullPoints[k].Min( p => b.Transform.PointToWorld( p ).z ) ).Min();
var (drop, dropBodies) = Make( rest.Select( t => t.WithPosition( t.Position + Vector3.Up * lift ) ).ToArray(), true, Vector3.Down * ${DROP.gravity}f );
drop.Body.AddBoxShape( new BBox( new Vector3( -100000, -100000, -100 ), new Vector3( 100000, 100000, 0 ) ), Rotation.Identity, false );
// still: no piece moved ${DROP.still} unit in the last second (a piece lying on the floor trembles, and goes nowhere)
float settled = -1;
var second = new System.Collections.Generic.Queue<Vector3[]>();
for ( int s = 0; s < ${DROP.most} * 60 && settled < 0; s++ )
{
	drop.Step( 1f / 60f );
	second.Enqueue( dropBodies.Select( b => b.Position ).ToArray() );
	if ( second.Count > 60 ) second.Dequeue();
	if ( second.Count == 60 )
	{
		var then = second.Peek();
		if ( dropBodies.Select( ( b, k ) => b.Position.Distance( then[k] ) ).Max() < ${DROP.still}f ) settled = ( s + 1 ) / 60f;
	}
}
var gaps = phys.Joints.Select( j => (dropBodies[j.Body1].Transform.ToWorld( j.Frame1 ).Position.Distance( dropBodies[j.Body2].Transform.ToWorld( j.Frame2 ).Position ), parts[j.Body2].BoneName) ).ToList();
var widest = gaps.Count > 0 ? gaps.MaxBy( g => g.Item1 ) : (0f, "");
var lows = dropBodies.Select( ( b, k ) => (hullPoints[k].Length == 0 ? b.Transform.Position.z : hullPoints[k].Min( p => b.Transform.PointToWorld( p ).z ), parts[k].BoneName) ).MinBy( x => x.Item1 );
var dropped = new { settled, speed = dropBodies.Max( b => b.Velocity.Length ), lowest = lows.Item1, lowestPiece = lows.Item2, gap = widest.Item1, gapAt = widest.Item2 };
drop.Delete();
return new { bodies, joints, restMoved, held, dropped, weighs };
`;
}

/** How far a sound's length may be from the original's, in seconds (s&box's compile keeps it to 0.0001). */
export const SOUND_LENGTH = 0.005;
/** How alike a sound's loudness, window by window, must be to the original's (the correlation of the two):
 * Half-Life's, compiled as Opus, are 0.9995 or more. */
export const SOUND_LIKENESS = 0.99;
/** How long an animation is played for its sound events, in seconds of the editor's: each is played that fast, or
 * at its own rate when it is shorter. */
const SOUND_EVENTS_IN = 1;
/** The longest sound played to see whether it loops, in seconds: one longer is not played. */
const SOUND_PLAYED_MOST = 10;
/** How long past the longest sound's length the played sounds are looked at, in seconds. */
const SOUND_LATE = 2;

/**
 * The C# that reads each of `sounds` ([{ sound, duration }]: a .sound, under Assets) as the editor compiled it, and
 * its file's loudness window by window (ENVELOPE_WINDOW seconds, at the rate it was compiled at); plays each (SOUND_PLAYED_MOST long at most) far off, to
 * see which still play after their length; and plays each of `soundEvents` ([{ sequence, duration, loops }]) through on
 * the model at `vmdl`, a renderer of its own each, hearing the sound events it fires. Returns { sounds: [{ sound,
 * missing } or { sound, file, valid, duration, distance, falloff, occlusion, reverb, envelope }], playing: { sound:
 * bool }, heard: [{ sequence, sound, attachment }] }.
 */
export function soundProbeCode(vmdl, sounds, soundEvents = []) {
  const played = sounds.filter((s) => s.duration <= SOUND_PLAYED_MOST);
  // past the longest's end by SOUND_LATE: started together, one may start late (scientist's 25 sounds: the 5.8 s
  // c1a2_sci_darkroom still played 0.5 s after its length), and a loop plays on whatever the wait
  const wait = Math.max(0, ...played.map((s) => s.duration)) + SOUND_LATE;
  const animations = soundEvents.map((e) => `(${csString(e.sequence)}, ${Math.max(1, e.duration / SOUND_EVENTS_IN).toFixed(4)}f, ${Boolean(e.loops)})`); // prettier-ignore
  return `
var scene = Editor.SceneEditorSession.Active?.Scene ?? Game.ActiveScene;
var sounds = new System.Collections.Generic.List<object>();
foreach ( var path in new string[] { ${sounds.map((s) => csString(s.sound)).join(", ")} } )
{
	var ev = ResourceLibrary.Get<SoundEvent>( path );
	if ( ev is null ) { sounds.Add( new { sound = path, missing = true } ); continue; }
	var sf = ev.Sounds?.FirstOrDefault();
	short[] samples = null;
	if ( sf is not null ) { await sf.LoadAsync(); samples = await sf.GetSamplesAsync(); }
	var envelope = new System.Collections.Generic.List<float>();
	// 10 ms by 10 ms at the rate it was compiled at (48000 as Opus, a small one's own as PCM), as soundEnvelope
	double step = ( sf?.Rate ?? 0 ) * ${ENVELOPE_WINDOW};
	if ( samples is not null && step > 0 )
		for ( int k = 0; (int)System.Math.Floor( ( k + 1 ) * step ) <= samples.Length; k++ )
		{
			int from = (int)System.Math.Floor( k * step ), to = (int)System.Math.Floor( ( k + 1 ) * step );
			double sum = 0;
			for ( int i = from; i < to; i++ ) { double v = samples[i] / 32768.0; sum += v * v; }
			envelope.Add( (float)System.Math.Round( System.Math.Sqrt( sum / ( to - from ) ), 5 ) );
		}
	sounds.Add( new { sound = path, file = sf?.ResourcePath, valid = sf?.IsValid ?? false, duration = sf?.Duration ?? 0, rate = sf?.Rate ?? 0, format = sf?.Format.ToString(), distance = ev.Distance,
		falloff = new[] { 0.25f, 0.5f, 0.75f }.Select( t => ev.Falloff.Evaluate( t ) ).ToArray(), occlusion = ev.OcclusionEnabled, reverb = ev.ReverbEnabled, envelope } );
}
// each played far off (heard by no one: past its Distance from the camera), to see which loop
var far = new Vector3( 0, 0, -100000 );
var handles = new string[] { ${played.map((s) => csString(s.sound)).join(", ")} }.Select( p => (p, ResourceLibrary.Get<SoundEvent>( p )) ).Where( x => x.Item2 is not null ).Select( x => (x.Item1, Sound.Play( x.Item2, far )) ).ToList();
if ( handles.Count > 0 ) await Task.Delay( ${Math.round(wait * 1000)} );
var playing = handles.ToDictionary( h => h.Item1, h => h.Item2.IsPlaying );
foreach ( var h in handles ) h.Item2.Stop();
// each animation with sound events played through, the sounds it fires heard
var model = Model.Load( ${csString(vmdl)} );
var heard = new System.Collections.Generic.List<object>();
var made = new System.Collections.Generic.List<GameObject>();
foreach ( var (name, rate, loops) in new (string, float, bool)[] { ${animations.join(", ")} } )
{
	var go = scene.CreateObject();
	go.Name = ${csString(PROBE)};
	go.WorldPosition = new Vector3( 0, 0, -100000 );
	var r = go.Components.Create<SkinnedModelRenderer>( false );
	r.Model = model;
	r.UseAnimGraph = false;
	r.PlayAnimationsInEditorScene = true;
	r.OnSoundEvent = ( e ) => heard.Add( new { sequence = name, sound = e.Name, attachment = e.AttachmentName } );
	r.Enabled = true;
	r.Sequence.Name = name;
	r.Sequence.Looping = loops;
	r.Sequence.PlaybackRate = rate;
	made.Add( go );
}
if ( made.Count > 0 ) await Task.Delay( ${Math.round((SOUND_EVENTS_IN + 1) * 1000)} );
foreach ( var g in made ) g.Destroy();
return new { sounds, playing, heard };
`;
}

/** The port's sounds read back (soundProbeCode's answer) held to the originals. -> { faults, said } */
export function compareSounds(expected, read) {
  const faults = [];
  const got = new Map((read.sounds ?? []).map((s) => [s.sound, s]));
  let least = 1;
  let leastOf = "";
  for (const want of expected.sounds) {
    const s = got.get(want.sound);
    if (!s || s.missing) {
      faults.push(`${want.sound} did not load`);
      continue;
    }
    if (!s.valid || s.file !== want.vsnd) {
      faults.push(`${want.sound} plays ${s.file ?? "nothing"}${s.valid ? "" : " (not a sound s&box plays)"}, not ${want.vsnd}`); // prettier-ignore
      continue;
    }
    if (Math.abs(s.duration - want.duration) > SOUND_LENGTH)
      faults.push(`${want.sound} is ${s.duration.toFixed(3)} s long, not ${want.duration.toFixed(3)}`);
    if (Math.abs(s.distance - want.distance) > 0.01)
      faults.push(`${want.sound} is heard to ${s.distance} units, not ${want.distance} (GoldSrc's)`);
    if (s.falloff.some((f, k) => Math.abs(f - (1 - (k + 1) / 4)) > 0.001))
      faults.push(`${want.sound} falls off as ${s.falloff.map((f) => f.toFixed(3)).join(", ")} at a quarter, half and three quarters of its distance, not in a line (0.75, 0.5, 0.25)`); // prettier-ignore
    if (s.occlusion || s.reverb) faults.push(`${want.sound} has ${s.occlusion ? "occlusion" : "reverb"}, which GoldSrc's mixer had not`); // prettier-ignore
    const n = Math.min(want.envelope.length, s.envelope.length);
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      dot += want.envelope[i] * s.envelope[i];
      a += want.envelope[i] ** 2;
      b += s.envelope[i] ** 2;
    }
    // a silent file is like a silent one
    const likeness = a === 0 && b === 0 ? 1 : a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b);
    if (likeness < least) [least, leastOf] = [likeness, want.sound];
    if (likeness < SOUND_LIKENESS) faults.push(`${want.sound} is not as loud as the original window by window (correlated ${likeness.toFixed(4)}, not ${SOUND_LIKENESS} or more)`); // prettier-ignore
  }
  const played = expected.sounds.filter((s) => s.duration <= SOUND_PLAYED_MOST);
  const wrong = played.filter((s) => read.playing?.[s.sound] !== undefined && read.playing[s.sound] !== (s.loop !== null)); // prettier-ignore
  for (const s of wrong) faults.push(s.loop !== null ? `${s.sound} did not loop (GoldSrc's loops from ${s.loop.toFixed(3)} s)` : `${s.sound} still played after its length, as a loop (GoldSrc's does not loop)`); // prettier-ignore
  // each animation's sound events heard, as many as it has of each; a loop's, played round more than once, each
  // of its sounds and no other
  const key = (list) => [...list].sort().join(", ");
  let heard = 0;
  for (const e of expected.soundEvents) {
    const got = (read.heard ?? []).filter((h) => h.sequence === e.sequence).map((h) => h.sound);
    const [has, wants] = e.loops ? [[...new Set(got)], [...new Set(e.sounds)]] : [got, e.sounds];
    heard += e.loops ? e.sounds.filter((s) => has.includes(s)).length : got.length;
    if (key(has) !== key(wants)) faults.push(`${e.sequence} played ${got.length ? key(has) : "no sound"}, not ${key(wants)}${e.loops ? " (looping)" : ""}`); // prettier-ignore
  }
  const loops = expected.sounds.filter((s) => s.loop !== null).length;
  const said = [
    `${expected.sounds.length} sounds as .sound assets, heard as far as GoldSrc heard them${loops ? ` (${loops} looping)` : ""}; as loud as the originals window by window (correlated ${least.toFixed(4)} at least${leastOf ? `, ${leastOf}` : ""})`, // prettier-ignore
    `${expected.soundEvents.length} animations played through: ${heard} sound events heard, of ${expected.soundEvents.reduce((n, e) => n + e.sounds.length, 0)}`, // prettier-ignore
  ];
  return { faults, said };
}

// ── how it looks: s&box's picture beside the kit's own ──

/** The pictures of how a port looks: their side, field of view (degrees across), the colour behind the model, and
 * the views round it ([yaw, pitch]: from its front, left, back, and its right from above). */
export const LOOK = { size: 256, fov: 60, background: [0, 160, 255], views: [[0, 10], [90, 10], [180, 10], [270, 30]] };
/** A pixel is the model's when its colour is this far from the background's (the sum of the channels' distances). */
const LOOK_EDGE = 60;
/** Each picture is cut in this many regions each way to set its colours side by side. */
const LOOK_GRID = 16;
/** A region's colours are compared when this many of its pixels are the model's in both pictures. */
const LOOK_REGION_LEAST = 16;
/** A pixel of the model in one picture is in the other too when the other has the model this many pixels from it. */
const LOOK_REACH = 1;
/** A region's colours are another's when its mean colours are this far apart (255ths, the channels' mean). */
export const LOOK_REGION_FAR = 80;
/**
 * How alike the two must be: the share of the model's pixels in either that the other has too (its silhouette), and
 * the share of its regions whose colours may be another's. Measured on Half-Life's 205 models (2026-10-27): the
 * least silhouette 97.6% (uplant2's blade of grass), the most regions apart 8.7% (ventgibs, a fine black and white
 * texture seen edge on, which s&box's mipmaps make grey); each material of theirs drawn red by the kit, as s&box
 * draws one not compiled, 366 of 480 caught that are a twentieth of the model or more (an orange or red one drawn
 * red, the HEV suit's sleeves, flesh and blood, the most often missed).
 */
export const LOOK_SHAPE = 0.95;
export const LOOK_COLOUR = 0.12;

/** The views of a model for its pictures: each `{ yaw, pitch, eye, angles }`, all at the distance that fits the
 * model's first animation's first frame (`mid`, `far`: framing's) in LOOK.fov, and `dist`. */
export function lookViewsOf({ mid, far }, { fov = LOOK.fov, views = LOOK.views } = {}) {
  const dist = (Math.max(far, 1) / Math.tan((fov * Math.PI) / 360)) * 1.15;
  const d = Math.PI / 180;
  return {
    mid,
    dist,
    views: views.map(([yaw, pitch]) => {
      const back = [Math.cos(pitch * d) * Math.cos(yaw * d), Math.cos(pitch * d) * Math.sin(yaw * d), Math.sin(pitch * d)];
      // s&box's angles of a camera looking back at the middle: its pitch down
      return { yaw, pitch, eye: mid.map((v, a) => v + back[a] * dist), angles: [pitch, yaw + 180] };
    }),
  };
}

/** A colour no texture is drawn in, to find a chrome texture's pixels by. */
const CHROME_KEY = [255, 0, 255];
const CHROME_EDGE = 2;

/**
 * The kit's pictures of the original (`src`) from `looks` (lookViewsOf's), its texture as it is, and for each the
 * pixels of a chrome texture (`skip`, compareLooks'): the model drawn again with chrome in CHROME_KEY. -> { kit, skip }
 */
export function lookKitOf(src, { views, dist, mid }) {
  const options = { dist, fov: LOOK.fov, target: mid, width: LOOK.size, height: LOOK.size, background: LOOK.background, light: false, seq: 0, frame: 0 }; // prettier-ignore
  const kit = views.map((v) => render(src, { ...options, yaw: v.yaw, pitch: v.pitch }));
  const { tris } = posed(src, options);
  if (!tris.some((t) => (t.tex?.flags ?? 0) & 2)) return { kit, skip: [] };
  const key = { name: "chrome", flags: 0, width: 1, height: 1, rgba: Uint8Array.of(...CHROME_KEY, 255) };
  const keyed = tris.map((t) => ((t.tex?.flags ?? 0) & 2 ? { ...t, tex: key } : t));
  const S = LOOK.size;
  const skip = views.map((v) => {
    const { rgba } = render(src, { ...options, yaw: v.yaw, pitch: v.pitch, tris: keyed });
    const keyedAt = Uint8Array.from({ length: S * S }, (_, k) => (CHROME_KEY.every((c, j) => Math.abs(rgba[k * 4 + j] - c) < 8) ? 1 : 0)); // prettier-ignore
    // and CHROME_EDGE pixels round it: its edges, the key blended with what is beside it
    const grown = new Uint8Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        if (keyedAt[y * S + x])
          for (let dy = -CHROME_EDGE; dy <= CHROME_EDGE; dy++)
            for (let dx = -CHROME_EDGE; dx <= CHROME_EDGE; dx++)
              if (x + dx >= 0 && y + dy >= 0 && x + dx < S && y + dy < S) grown[(y + dy) * S + x + dx] = 1;
    return grown;
  });
  return { kit, skip };
}

/**
 * The C# that draws the compiled model in a scene of its own (nothing of the project's: its only light a white
 * ambient one, so a texture shows as it is, as the kit's renderer draws it with `light: false`), posed in its first
 * animation's first frame, from each view: the pictures as PNG, base64.
 */
export function lookProbeCode(vmdl, views, { size = LOOK.size, fov = LOOK.fov, background = LOOK.background } = {}) {
  return `
var model = Model.Load( ${csString(vmdl)} );
if ( model is null || model.IsError ) return new { error = "the model did not load: " + ${csString(vmdl)} };
var scene = new Scene();
var pictures = new System.Collections.Generic.List<string>();
using ( scene.Push() )
{
	var go = new GameObject( true, "model" );
	var r = go.AddComponent<SkinnedModelRenderer>();
	r.Model = model;
	r.UseAnimGraph = false;
	if ( model.AnimationCount > 0 ) r.Sequence.Name = model.GetAnimationName( 0 );
	r.Sequence.Time = 0;
	r.Sequence.PlaybackRate = 0;
	new GameObject( true, "ambient" ).AddComponent<AmbientLight>().Color = Color.White;
	var cg = new GameObject( true, "camera" );
	var cc = cg.AddComponent<CameraComponent>();
	cc.BackgroundColor = new Color( ${background.map((c) => `${c / 255}f`).join(", ")}, 1 );
	cc.FieldOfView = ${fov};
	cc.ZNear = 1;
	cc.ZFar = 100000;
	// a scene of its own is ticked by no one: ticked here, or the model is drawn in its rest pose
	r.Sequence.Looping = false;
	for ( int tick = 0; tick < 3; tick++ )
	{
		r.Sequence.Time = 0;
		scene.GameTick( 0.001 );
	}
	foreach ( var v in new[] { ${views.map((v) => `new float[] { ${[...v.eye, ...v.angles].map((x) => `${+x.toFixed(4)}f`).join(", ")} }`).join(", ")} } )
	{
		cg.WorldPosition = new Vector3( v[0], v[1], v[2] );
		cg.WorldRotation = Rotation.From( v[3], v[4], 0 );
		using var bitmap = new Bitmap( ${size}, ${size} );
		cc.RenderToBitmap( bitmap, false );
		pictures.Add( System.Convert.ToBase64String( bitmap.ToPng() ) );
	}
}
scene.Destroy();
return new { pictures };
`;
}

/**
 * The kit's pictures and s&box's held side by side, view by view: `{ views: [{ shape, colour, regions }], shape (the
 * least), colour (the most), faults }`. `shape`: the share of the model's pixels in either picture that the other
 * has too, LOOK_REACH pixels away at most (a blade of grass a pixel wide drawn half a pixel over is the same blade);
 * `colour`: the share of the regions both draw whose mean colours are more than LOOK_REGION_FAR apart, and
 * `distances`, each region's (255ths, the channels' mean). `skip`:
 * for each view, the pixels (1 in a width by height array) whose colour is not compared: a chrome texture's, which
 * the kit draws as GoldSrc does, from where the eye is, and the port worked out once (port.mjs).
 */
export function compareLooks(kit, sbox, { background = LOOK.background, shapeLeast = LOOK_SHAPE, colourMost = LOOK_COLOUR, skip = [], grid = LOOK_GRID } = {}) {
  const views = kit.map((a, v) => {
    const b = sbox[v];
    const { width, height } = a;
    const isModel = (p, i) => Math.abs(p.rgba[i] - background[0]) + Math.abs(p.rgba[i + 1] - background[1]) + Math.abs(p.rgba[i + 2] - background[2]) > LOOK_EDGE; // prettier-ignore
    const sized = b.width === width && b.height === height;
    const masks = [a, b].map((p) => Uint8Array.from({ length: width * height }, (_, k) => (p === b && !sized ? 0 : isModel(p, k * 4) ? 1 : 0))); // prettier-ignore
    const near = (mask, x, y) => {
      for (let dy = -LOOK_REACH; dy <= LOOK_REACH; dy++)
        for (let dx = -LOOK_REACH; dx <= LOOK_REACH; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) return true;
        }
      return false;
    };
    let both = 0;
    let either = 0;
    const sums = Array.from({ length: grid * grid }, () => ({ n: 0, a: [0, 0, 0], b: [0, 0, 0] }));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const k = y * width + x;
        const i = k * 4;
        const [inA, inB] = [masks[0][k], masks[1][k]];
        either += inA + inB;
        both += (inA && near(masks[1], x, y) ? 1 : 0) + (inB && near(masks[0], x, y) ? 1 : 0);
        if (!(inA && inB) || skip[v]?.[k]) continue;
        const cell = sums[Math.floor((y * grid) / height) * grid + Math.floor((x * grid) / width)];
        cell.n++;
        for (let c = 0; c < 3; c++) {
          cell.a[c] += a.rgba[i + c];
          cell.b[c] += b.rgba[i + c];
        }
      }
    const regions = sums.filter((cell) => cell.n >= LOOK_REGION_LEAST);
    const distances = regions.map((cell) => [0, 1, 2].reduce((d, c) => d + Math.abs(cell.a[c] - cell.b[c]) / cell.n, 0) / 3); // prettier-ignore
    const apart = distances.length ? distances.filter((d) => d > LOOK_REGION_FAR).length / distances.length : 0;
    return { shape: either ? both / either : 1, colour: apart, regions: regions.length, distances };
  });
  const shape = Math.min(...views.map((v) => v.shape));
  const colour = Math.max(...views.map((v) => v.colour));
  const faults = [];
  views.forEach((v, k) => {
    if (v.shape < shapeLeast) faults.push(`seen from view ${k + 1}, its shape not the original's: ${(v.shape * 100).toFixed(0)}% of its pixels in both pictures (${shapeLeast * 100}% wanted)`); // prettier-ignore
    if (v.colour > colourMost) faults.push(`seen from view ${k + 1}, its colours not the original's: ${(v.colour * 100).toFixed(0)}% of its regions more than ${LOOK_REGION_FAR} apart (${colourMost * 100}% at most)`); // prettier-ignore
  });
  return { views, shape, colour, faults };
}

/** The C# that removes the probe object. */
export const removeProbeCode = () =>
  `var scene = Editor.SceneEditorSession.Active?.Scene ?? Game.ActiveScene;
foreach ( var old in scene.GetAllObjects( true ).Where( g => g.Name == ${csString(PROBE)} ).ToList() ) old.Destroy();
return "removed";`;

/**
 * What the original says the compiled model must hold, from its bytes (`src`) and its port (portToSbox's). The
 * samples: each animation at its first frame and its middle one, `perSequence` frames in all (1 to its length),
 * each blend of it too; and its graph's, when it has one: each animation that blends at its first frame, at its
 * blends' start, middle and end (one that blends on two axes at its four corners).
 */
export function expectedOf(src, port, { groups, perSequence = 2 } = {}) {
  const list = sequencesOf(src);
  const samples = [];
  const poses = [];
  const physics = physicsExpected(port);
  const names = port.facts.bones;
  const graphSamples = [];
  const graphPoses = [];
  const durations = [];
  const placesOf = (matrices) => matrices.map((m) => [m[0][3], m[1][3], m[2][3]]);
  port.parts.sequences.forEach((s, n) => {
    const index = s.index;
    if (index === undefined) return;
    const frames = readSequence(src, index, 0, groups).frames.length;
    const graphed = port.graphed.sequences[n];
    graphed.files.forEach((name) => durations.push({ name, duration: (frames - 1) / s.fps }));
    const picks = [...new Set(Array.from({ length: Math.min(perSequence, frames) }, (_, k) => Math.round((k * (frames - 1)) / Math.max(1, perSequence - 1))))]; // prettier-ignore
    for (const [blend, animation] of graphed.files.entries()) for (const frame of picks) {
      const time = frame / s.fps;
      const matrices = poseAt(src, index, frame, blend, groups);
      const pose = placesOf(matrices);
      samples.push({ sequence: animation, time });
      poses.push({ name: blend ? animation : list[index].name, frame, bones: pose });
      // a ragdoll held in the pose (an animation's first blend's), when every joint is well inside its limits there
      // and holds its bone where the pose has it
      if (physics?.limits.length && !blend) {
        const turns = matrices.map((m) => m.map((row) => row.slice(0, 3)));
        const placed = turns.map((turn, i) => ({ turn, at: pose[i] }));
        const inside = Math.min(...physics.limits.map((j) => insideLimits(j.limits, physics.rest.map((p) => p.turn), turns, j.above, j.bone))); // prettier-ignore
        const stretch = Math.max(
          ...physics.limits.map((j) => jointStretch(physics.rest, placed, j.above, j.bone)),
        );
        if (inside >= LIMIT_MARGIN && stretch <= STRETCH_MOST)
          physics.poses.push({
            name: `${list[index].name} frame ${frame}`,
            bodies: Object.fromEntries(physics.shapes.map((shape) => {
              const i = names.indexOf(shape.bone);
              return [shape.bone, [...pose[i], ...quaternionOfTurn(turns[i])]];
            })),
          }); // prettier-ignore
      }
    }
    // the graph: at its first frame, at its blends' start, middle and end (on two axes, its four corners)
    const { blends } = graphed;
    if (blends.length === 1) {
      const [{ pose, start, end }] = blends;
      for (const share of [0, 0.5, 1]) {
        const value = start + (end - start) * share;
        graphSamples.push({ sequence: graphed.name, set: [[pose, value]] });
        graphPoses.push({ name: `${graphed.name} at ${pose} ${+value.toFixed(3)}`, frame: 0, bones: placesOf(blendedPoseAt(src, index, 0, share, groups)) }); // prettier-ignore
      }
    } else if (blends.length === 2)
      graphed.files.forEach((_, k) => {
        const set = [[blends[0].pose, k % 2 ? blends[0].end : blends[0].start], [blends[1].pose, k < 2 ? blends[1].start : blends[1].end]]; // prettier-ignore
        graphSamples.push({ sequence: graphed.name, set });
        graphPoses.push({ name: `${graphed.name} at ${set.map(([p, v]) => `${p} ${v}`).join(", ")}`, frame: 0, bones: placesOf(poseAt(src, index, 0, k, groups)) }); // prettier-ignore
      });
  });
  return {
    bones: port.facts.bones.map((name, i) => [name, port.parts.bones[i].parent]),
    sequences: durations,
    parts: port.facts.bodygroups,
    skins: port.facts.skins,
    attachments: port.facts.attachments,
    hitboxes: port.facts.hitboxes,
    samples,
    poses,
    physics,
    // its animation graph, when it has one: its .vanmgrph, its parameters, and its poses as samples are
    graph: port.graph,
    graphParameters: port.graph ? [GRAPH_SEQUENCE, ...port.graphed.poses.map((p) => p.name)] : [],
    graphSamples,
    graphPoses,
    // its sounds, when its events play any: each as written, and its loudness window by window at s&box's rate;
    // and each animation with sound events, how long it is and the sounds it plays
    sounds: (port.sounds ?? []).map((s) => {
      const wav = readWav(port.files.find((f) => f.path === s.wav).data);
      return { ...s, envelope: soundEnvelope(wav.x, wav.rate) };
    }),
    soundEvents: (port.soundEvents ?? []).map((e) => ({
      ...e,
      duration: durations.find((d) => d.name === e.sequence)?.duration ?? 0,
    })),
  };
}

/**
 * What the port's physics must be, from what it wrote (port.physics): its pieces' hulls on their bones, masses,
 * surfaces, and its joints with their anchors at the child bone's place at rest and their axes on its axis. The
 * poses to hold it in are added by expectedOf. Null when it collides as nothing.
 */
function physicsExpected(port) {
  const { physics } = port;
  if (!physics) return null;
  const collision = port.parts.collision;
  const names = port.facts.bones;
  const placed = restOf(port.parts.bones, port.parts.smd.get(collision.file).frames[0]);
  const original = new Map(collision.pieces.map((piece, k) => [piece.bone, physics.shapes[k].bone]));
  return {
    shapes: physics.shapes.map((s) => ({ bone: s.bone, surface: s.surface, points: s.points })),
    masses: physics.bodies,
    joints: physics.joints.map((j) => {
      const child = placed[names.indexOf(j.child)];
      return { ...j, at: child.at, along: child.turn.map((row) => row[j.axis]) };
    }),
    // each joint's limits as Source's port measured them, against the piece above, for the poses
    limits: collision.joints.map((j) => ({
      limits: j.limits,
      above: names.indexOf(original.get(j.above)),
      bone: names.indexOf(original.get(j.bone)),
    })),
    rest: placed,
    poses: [],
  };
}

const far3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const boxOf = (points) =>
  [0, 1, 2].map((a) => [Math.min(...points.map((p) => p[a])), Math.max(...points.map((p) => p[a]))]);

/** The compiled model's physics (physicsProbeCode's answer) held to what the port wrote. -> { faults, said } */
export function comparePhysics(expected, read) {
  const faults = [];
  const bodies = new Map(read.bodies.map((b) => [b.bone, b]));
  const missing = expected.shapes.filter((s) => !bodies.has(s.bone)).map((s) => s.bone);
  if (missing.length) faults.push(`no physics body on ${missing.join(", ")}`);
  if (read.bodies.length !== expected.shapes.length)
    faults.push(`${read.bodies.length} physics bodies, not ${expected.shapes.length}`);
  // each hull's box against the port's, each way
  let hullOff = { off: 0 };
  for (const shape of expected.shapes) {
    const body = bodies.get(shape.bone);
    if (!body) continue;
    if (body.surface !== shape.surface)
      faults.push(`${shape.bone} collides as ${body.surface}, not ${shape.surface}`);
    if (!body.points.length) {
      faults.push(`${shape.bone} has no hull`);
      continue;
    }
    const want = boxOf(shape.points);
    const got = boxOf(body.points);
    const off = Math.max(
      ...[0, 1, 2].flatMap((a) => [Math.abs(got[a][0] - want[a][0]), Math.abs(got[a][1] - want[a][1])]),
    );
    if (off > hullOff.off) hullOff = { off, bone: shape.bone };
  }
  if (hullOff.off > HULL_TOLERANCE)
    faults.push(`${hullOff.bone}'s hull ${hullOff.off.toFixed(2)} units off the port's`);
  for (const { bone, mass } of expected.masses) {
    const body = bodies.get(bone);
    const weighs = read.weighs?.[read.bodies.indexOf(body)];
    if (body && !(Math.abs(weighs - mass) <= 0.01 * mass + 0.01))
      faults.push(`${bone} weighs ${weighs?.toFixed(2)} kg, not ${mass.toFixed(2)}`);
  }
  // each joint between its pieces, of its kind and limits, at the child's place at rest, about its axis
  for (const j of expected.joints) {
    const got = read.joints.find((r) => r.parent === j.parent && r.child === j.child);
    if (!got) {
      faults.push(`no joint from ${j.parent} to ${j.child}`);
      continue;
    }
    const kind = j.kind === "hinge" ? "Hinge" : "Ball";
    if (got.type !== kind) faults.push(`${j.child}'s joint a ${got.type}, not a ${kind}`);
    const limitsOff =
      j.kind === "hinge"
        ? Math.abs(got.twist[1] - got.twist[0] - (j.max - j.min))
        : Math.max(Math.abs(got.swing - j.swing), Math.abs(got.twist[0] - j.twist[0]), Math.abs(got.twist[1] - j.twist[1])); // prettier-ignore
    if (limitsOff > 0.05) faults.push(`${j.child}'s joint's limits ${limitsOff.toFixed(2)} degrees off`);
    const anchorOff = Math.max(far3(got.at1, j.at), far3(got.at2, j.at));
    if (anchorOff > 0.05) faults.push(`${j.child}'s joint ${anchorOff.toFixed(2)} units off the bone`);
    if (got.z1[0] * j.along[0] + got.z1[1] * j.along[1] + got.z1[2] * j.along[2] < 0.999)
      faults.push(`${j.child}'s joint turns about another axis than its bone's ${"xyz"[j.axis]}`);
  }
  if (read.joints.length !== expected.joints.length)
    faults.push(`${read.joints.length} joints, not ${expected.joints.length}`);
  // tried: at rest, in poses, dropped
  if (read.restMoved > REST_HOLD)
    faults.push(`held at rest, its pieces pushed each other ${read.restMoved.toFixed(2)} units`);
  const slipped = (read.held ?? []).filter((h) => h.moved > POSE_HOLD);
  if (slipped.length) faults.push(`${slipped.length} of ${read.held.length} poses inside its joints' limits not held: ${slipped.slice(0, 4).map((h) => `${h.name} (${h.bone} ${h.moved.toFixed(1)} units)`).join("; ")}`); // prettier-ignore
  const dropped = read.dropped;
  if (dropped) {
    // what a model of its size may sink or stretch
    const points = expected.shapes.flatMap((s) => s.points);
    const size = points.length ? Math.max(...[0, 1, 2].map((a) => Math.max(...points.map((p) => p[a])) - Math.min(...points.map((p) => p[a])))) : 0; // prettier-ignore
    const allowed = Math.max(DROP_TOLERANCE.units, DROP_TOLERANCE.share * size);
    if (dropped.settled < 0)
      faults.push(`dropped, still moving after ${DROP.most} s (${dropped.speed.toFixed(0)} units a second)`);
    if (dropped.lowest < -allowed) faults.push(`dropped, ${dropped.lowestPiece} went ${(-dropped.lowest).toFixed(1)} units through the floor`); // prettier-ignore
    if (dropped.gap > allowed)
      faults.push(`dropped, ${dropped.gapAt}'s joint came ${dropped.gap.toFixed(1)} units apart`);
  }
  const heldMost = Math.max(0, ...(read.held ?? []).map((h) => h.moved));
  const weight = (read.weighs ?? []).reduce((sum, m) => sum + m, 0);
  const said = [
    `physics: ${read.bodies.length} bodies (${weight.toFixed(1)} kg), ${read.joints.length} joints; hulls within ${hullOff.off.toFixed(2)} units of the port's`,
    `at rest its pieces moved ${(read.restMoved ?? 0).toFixed(2)} units; ${(read.held ?? []).length} poses held within ${heldMost.toFixed(2)}; dropped, ${dropped?.settled >= 0 ? `it was still in ${dropped.settled.toFixed(1)} s` : "it did not come to rest"}, its lowest point at ${dropped ? dropped.lowest.toFixed(1) : "?"} (the floor at 0), its joints within ${dropped ? dropped.gap.toFixed(2) : "?"}`, // prettier-ignore
  ];
  return { faults, said };
}

/** The compiled model read back (`read`, probeCode's answer) held to `expected`. */
export function compareSbox(expected, read, { tolerance = POSE_TOLERANCE } = {}) {
  const faults = [];
  if (read.error) return { passed: false, faults: [read.error], said: [], worst: null };
  const names = read.bones.map(([name]) => name);
  const missing = expected.bones.filter(([name]) => !names.includes(name)).map(([name]) => name);
  if (missing.length)
    faults.push(
      `${missing.length} bones of the port not in the compiled model: ${missing.slice(0, 6).join(", ")}`,
    );
  const reparented = expected.bones.filter(([name, parent]) => {
    const at = names.indexOf(name);
    if (at < 0) return false;
    const want = parent < 0 ? null : expected.bones[parent][0];
    const has = read.bones[at][1] < 0 ? null : names[read.bones[at][1]];
    return want !== has;
  });
  if (reparented.length)
    faults.push(
      `bones under another parent than the port's: ${reparented
        .map(([n]) => n)
        .slice(0, 6)
        .join(", ")}`,
    );
  const lost = expected.sequences.filter((s) => !read.sequences.includes(s.name)).map((s) => s.name);
  if (lost.length)
    faults.push(`${lost.length} animations not in the compiled model: ${lost.slice(0, 6).join(", ")}`);
  const longer = expected.sequences.filter((s) => read.durations[s.name] !== undefined && Math.abs(read.durations[s.name] - s.duration) > 0.002); // prettier-ignore
  if (longer.length) faults.push(`animations of another length: ${longer.slice(0, 4).map((s) => `${s.name} ${read.durations[s.name].toFixed(3)} s, not ${s.duration.toFixed(3)}`).join("; ")}`); // prettier-ignore
  const choices = expected.parts.map((g) => {
    const part = read.parts.find(([name]) => name === g.name);
    return part
      ? part[1].length === g.choices
        ? null
        : `${g.name} has ${part[1].length} choices, not ${g.choices}`
      : `bodygroup ${g.name} not there`;
  });
  faults.push(...choices.filter(Boolean));
  const groups = expected.skins > 1 ? expected.skins : read.groups.length <= 1 ? read.groups.length : -1;
  if (read.groups.length !== groups)
    faults.push(`${read.groups.length} material groups, not ${expected.skins} (a skin each)`);
  const attachmentsLost = expected.attachments.filter((a) => !read.attachments.includes(a));
  if (attachmentsLost.length) faults.push(`attachments not there: ${attachmentsLost.join(", ")}`);
  if ((read.hitboxes ?? []).length !== expected.hitboxes)
    faults.push(`${read.hitboxes.length} hit boxes, not ${expected.hitboxes}`);
  // the poses: each bone of the port where GoldSrc's frame puts it, within `tolerance` and REACH_TOLERANCE of its
  // chain's length in that pose
  const link = (pose, i) => {
    const parent = expected.bones[i][1];
    return parent < 0 ? 0 : Math.hypot(...[0, 1, 2].map((a) => pose.bones[i][a] - pose.bones[parent][a]));
  };
  const held = (wants, gots, labelOf) => {
    let worst = { off: 0 };
    const off = [];
    wants.forEach((want, k) => {
      const got = gots?.[k];
      if (!got) return;
      const chain = [];
      expected.bones.forEach(
        ([, parent], i) => (chain[i] = (parent < 0 ? 0 : (chain[parent] ?? 0)) + link(want, i)),
      );
      let most = 0;
      let over = 0;
      let bone = "";
      let overBone = "";
      expected.bones.forEach(([name], i) => {
        const at = names.indexOf(name);
        if (at < 0 || !got[at]) return;
        const d = Math.hypot(...[0, 1, 2].map((a) => got[at][a] - want.bones[i][a]));
        if (d > most) [most, bone] = [d, name];
        const beyond = d - (tolerance + REACH_TOLERANCE * chain[i]);
        if (beyond > over) [over, overBone] = [beyond, `${name} ${d.toFixed(2)} units off`];
      });
      if (most > worst.off) worst = { off: most, bone, at: labelOf(k) };
      if (over > 0) off.push(`${labelOf(k)}: ${overBone}`);
    });
    return { worst, off };
  };
  const posed = held(expected.poses, read.poses?.map((p) => p.bones), (k) => `${expected.samples[k].sequence} frame ${expected.poses[k].frame}`); // prettier-ignore
  const worst = posed.worst;
  // whose poses they are held to: GoldSrc's frames unless the expected says (a glTF's own nodes: glb.mjs)
  const theirs = expected.source ?? "GoldSrc's";
  if (posed.off.length) faults.push(`${posed.off.length} of ${expected.samples.length} poses with a bone off ${theirs} place: ${posed.off.slice(0, 5).join("; ")}`); // prettier-ignore
  // the graph: there, with its parameters, and each animation that blends where GoldSrc's blend puts it
  let graphed = null;
  if (expected.graph) {
    if (read.graph !== expected.graph) faults.push(`its animation graph is ${read.graph ?? "none"}, not ${expected.graph}`); // prettier-ignore
    const lacking = expected.graphParameters.filter((p) => !(read.graphParameters ?? []).includes(p));
    if (read.graph && lacking.length) faults.push(`its graph has no parameter ${lacking.join(", ")}`);
    graphed = held(expected.graphPoses, read.graphPoses, (k) => expected.graphPoses[k].name);
    if (graphed.off.length) faults.push(`${graphed.off.length} of ${expected.graphPoses.length} blends played by its graph with a bone off GoldSrc's place: ${graphed.off.slice(0, 5).join("; ")}`); // prettier-ignore
  }
  const physics = expected.physics
    ? comparePhysics(expected.physics, read.physics ?? { bodies: [], joints: [] })
    : null;
  if (physics) faults.push(...physics.faults);
  const sounds = expected.sounds?.length ? compareSounds(expected, read.sounds ?? {}) : null;
  if (sounds) faults.push(...sounds.faults);
  const said = [
    `${read.bones.length} bones, ${read.sequences.length} animations, ${read.parts.length} bodygroups, ${read.groups.length} material groups, ${read.attachments.length} attachments, ${read.hitboxes.length} hit boxes`, // prettier-ignore
    `${expected.samples.length} poses held to ${theirs}: the farthest bone ${worst.off.toFixed(3)} units off${worst.bone ? ` (${worst.bone}, ${worst.at})` : ""}`, // prettier-ignore
    ...(graphed ? [`${expected.graphPoses.length} blends played by its graph (${expected.graph}) held to GoldSrc's: the farthest bone ${graphed.worst.off.toFixed(3)} units off${graphed.worst.bone ? ` (${graphed.worst.bone}, ${graphed.worst.at})` : ""}`] : []), // prettier-ignore
    ...(physics?.said ?? []),
    ...(sounds?.said ?? []),
  ];
  return { passed: !faults.length, faults, said, worst };
}

/** The kit's pictures in a row above s&box's, each LOOK.size square. */
function looksSideBySide(kit, sbox) {
  const side = LOOK.size;
  const width = side * kit.length;
  const rgba = new Uint8Array(width * side * 2 * 4);
  [kit, sbox].forEach((row, r) =>
    row.forEach((p, c) => {
      for (let y = 0; y < Math.min(side, p.height); y++)
        rgba.set(p.rgba.subarray(y * p.width * 4, (y * p.width + Math.min(side, p.width)) * 4), ((r * side + y) * width + c * side) * 4); // prettier-ignore
    }),
  );
  return png(width, side * 2, rgba);
}

/**
 * The whole check of a model's port in s&box: the port made again (as sbox-port made it: same name, folder and
 * kind), compiled if its .vmdl_c is not there, read back and posed in the project's editor, and held to the
 * original. `look: false` leaves how it looks unpictured. `shot`: a file to save the kit's pictures of it and
 * s&box's to. Returns { passed, faults, said, worst, looks, shot }.
 */
export async function checkSboxPort(
  file,
  { project, name, folder, kind, collision, surfaceprop, mass, sounds, sbox, perSequence = 2, look = true, shot, tolerance } = {},
) {
  const engine = sbox ?? findSbox();
  const root = projectFolder(project);
  const assets = join(root, "Assets");
  const { src } = readStudio(file);
  const groups = sequenceGroups(src).length > 1 ? sequenceFilesOf(file, src) : undefined;
  const own = String(file).replace(/\\/g, "/").split("/").pop();
  const port = portToSbox(src, {
    name: name ?? sourceName(own),
    folder,
    groups,
    kind,
    collision,
    surfaceprop,
    mass,
    sounds: sounds ?? soundFoldersOf(file),
  });
  if (!existsSync(join(assets, port.vmdl)))
    throw new Error(
      `${port.vmdl} is not in ${assets}: port it there first (smak sbox-port ${own} -o ${assets})`,
    );
  const materials = port.files.map((f) => f.path).filter((path) => path.endsWith(".vmat"));
  if (!existsSync(join(assets, `${port.vmdl}_c`))) compileVmdl(assets, port.vmdl, { sbox: engine, materials });
  if (port.graph && !existsSync(join(assets, `${port.graph}_c`))) compileVmdl(assets, port.graph, { sbox: engine });
  const lacking = port.sounds.filter((s) => !existsSync(join(assets, s.wav)));
  if (lacking.length) throw new Error(`${lacking[0].wav} is not in ${assets}: port the model there again (smak sbox-port ${own} -o ${assets})`); // prettier-ignore
  const uncompiled = port.sounds.filter((s) => !existsSync(join(assets, `${s.vsnd}_c`))).map((s) => s.wav);
  if (uncompiled.length) compileSounds(assets, uncompiled, { sbox: engine });
  const expected = expectedOf(src, port, { groups, perSequence });
  const editor = await editorFor(root, { sbox: engine });
  try {
    // the editor compiles what changed on disk; asked again, so the check reads this port's compile
    sboxCall(root, "asset_compile", { path: port.vmdl }, { sbox: engine });
    if (port.graph) sboxCall(root, "asset_compile", { path: port.graph }, { sbox: engine });
    // its sounds' .sound assets, which only the editor compiles
    if (port.sounds.length)
      sboxCall(root, "call_tools", { calls: port.sounds.map((s) => ({ name: "asset_compile", arguments: { path: s.sound } })) }, { sbox: engine }); // prettier-ignore
    const read = runCsharp(root, probeCode(port.vmdl, expected.samples, expected.graphSamples), { sbox: engine });
    if (expected.physics && !read.error)
      read.physics = runCsharp(root, physicsProbeCode(port.vmdl, expected.physics.poses), { sbox: engine });
    if (expected.sounds.length && !read.error)
      read.sounds = runCsharp(root, soundProbeCode(port.vmdl, expected.sounds, expected.soundEvents), { sbox: engine }); // prettier-ignore
    const result = compareSbox(expected, read, { tolerance });
    // its materials, each compiled by the editor
    const failed = compileAssets(root, materials, { sbox: engine });
    if (failed.length) result.faults.push(`${failed.length} of its ${materials.length} materials not compiled (s&box draws them red): ${failed.slice(0, 6).join(", ")}`); // prettier-ignore
    // how it looks, beside the kit's own picture of the original
    if (look && !read.error) {
      const views = lookViewsOf(framing(src, [{ seq: 0, frame: 0 }]));
      const { kit, skip } = lookKitOf(src, views);
      const drawn = runCsharp(root, lookProbeCode(port.vmdl, views.views), { sbox: engine });
      if (drawn.error) result.faults.push(`not pictured: ${drawn.error}`);
      else {
        const pictures = drawn.pictures.map((b) => unpng(Buffer.from(b, "base64")));
        const looks = compareLooks(kit, pictures, { skip });
        result.faults.push(...looks.faults);
        result.said.push(`it looks as the original from ${looks.views.length} views: ${(looks.shape * 100).toFixed(0)}% of its silhouette shared at the least, ${(looks.colour * 100).toFixed(0)}% of its regions another colour at the most`); // prettier-ignore
        result.looks = looks;
        if (shot) {
          writeFileSync(shot, looksSideBySide(kit, pictures));
          result.shot = shot;
        }
      }
    }
    result.passed = !result.faults.length;
    runCsharp(root, removeProbeCode(), { sbox: engine });
    return { ...result, opened: editor.opened };
  } finally {
    await editor.close();
  }
}
