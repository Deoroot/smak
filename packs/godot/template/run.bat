@echo off
rem Walks the project; the first time (no .godot folder) Godot imports the two .glb first. Pictures: run.bat -- --shots
rem Godot is the GODOT variable when set, else what the command was told (--godot), else "godot" on the PATH.
if not defined GODOT set "GODOT={{godot}}"
if not exist "%~dp0.godot" "%GODOT%" --headless --path "%~dp0." --import
"%GODOT%" --path "%~dp0." %*
