# The Python side of a SMAK job in Blender (src/blender.mjs, runBlenderJob). SMAK runs
#
#   blender -b --factory-startup --python-exit-code 1 --python-expr "<this folder on sys.path; import blender_job>"
#           --python script.py -- job.json outdir
#
# so a job script finds this module already imported and can say:
#
#   from blender_job import read_job, write_result, fail, out_path, say
#   job = read_job()                    the job SMAK gave, as Python's dicts and lists
#   ...                                 its work; files it makes go to out_path("name")
#   write_result({"made": 3})           the answer SMAK reads back (result.json in the output folder)
#   fail("no armature in the file")     stops the job: SMAK throws an Error with this message
#
# An exception the script does not catch comes back the same way, as an Error with its last line and the
# traceback. Each result.json also carries Blender's version (bpy.app.version).
import json
import os
import sys
import traceback

try:
    import bpy

    VERSION = list(bpy.app.version)
except ImportError:  # outside Blender (never in a job): no version to give
    VERSION = None

_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
JOB_FILE = _args[0] if len(_args) > 0 else None
OUT_DIR = _args[1] if len(_args) > 1 else None
_written = False


def read_job():
    """The job SMAK wrote as JSON."""
    if not JOB_FILE:
        raise RuntimeError("blender_job: no job given (run by SMAK's runBlenderJob)")
    with open(JOB_FILE, encoding="utf8") as f:
        return json.load(f)


def out_dir():
    """The folder SMAK reads the result and files from."""
    os.makedirs(OUT_DIR, exist_ok=True)
    return OUT_DIR


def out_path(name):
    """A file's place in the output folder (its folders made)."""
    path = os.path.join(out_dir(), name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def say(*a):
    """A line SMAK keeps in `lines` (it begins with [smak])."""
    print("[smak]", *a, flush=True)


def _write(body):
    global _written
    body["version"] = VERSION
    with open(os.path.join(out_dir(), "result.json"), "w", encoding="utf8") as f:
        json.dump(body, f)
    _written = True


def write_result(result=None):
    """The job's answer: anything JSON can hold."""
    _write({"ok": True, "result": result})


def fail(message):
    """Ends the job with a message SMAK throws as an Error."""
    _write({"ok": False, "error": str(message)})
    print("[smak] failed:", message, flush=True)
    raise SystemExit(1)


def _hook(kind, value, tb):
    # a script's uncaught exception: its message and traceback written for SMAK, then Blender's own report
    text = "".join(traceback.format_exception(kind, value, tb))
    if OUT_DIR and not (_written and kind is SystemExit):
        message = "".join(traceback.format_exception_only(kind, value)).strip()
        _write({"ok": False, "error": message, "traceback": text})
    sys.__excepthook__(kind, value, tb)


sys.excepthook = _hook
