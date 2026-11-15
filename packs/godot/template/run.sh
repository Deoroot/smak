#!/bin/sh
# Walks the project; the first time (no .godot folder) Godot imports the two .glb first. Pictures: ./run.sh -- --shots
# Godot is $GODOT when set, else what the command was told (--godot), else "godot" on the PATH.
here=$(cd "$(dirname "$0")" && pwd)
godot="${GODOT:-{{godot}}}"
[ -d "$here/.godot" ] || "$godot" --headless --path "$here" --import
exec "$godot" --path "$here" "$@"
