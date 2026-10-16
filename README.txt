SPINDLE 0.0 — your installed PC games on a shelf
=================================================

Built the same way as Cartridge: an Electron app (Chromium + Node.js).
Shows every game it finds as a spinning DISC, a CASE with the disc sliding
out, or a SAVE icon (floppy disk with a handwritten label). Switch styles
with the buttons at the top, Tab, keys 1/2/3, or X on a controller.

RUN IT
1. Install Node.js LTS from https://nodejs.org (only once).
2. Double-click Run-Spindle.bat. The first run downloads Electron (~1 min).

MAKE A SINGLE .EXE
Double-click Build-Exe.bat. You get dist\Spindle-0.0.0-portable.exe, which
runs on its own without Node or this folder.

WHAT IT FINDS
- Steam: every library folder (libraryfolders.vdf), with Steam's own box
  art from its local cache, or Steam's servers if not cached.
- Epic Games: the launcher's install manifests. Launches through Epic.
- GOG: GOG Galaxy / offline installers (registry). Box art from GOG.
- Your folders: ... menu > Add a games folder (e.g. D:\Games). Each
  subfolder is one game; Spindle picks its main .exe.
- Single games: ... menu > Add a game (.exe).
Games without box art get a cover looked up online by name; you can also
pick your own with "Cover…". Rename and Hide work per game.

CONTROLS
Keyboard: arrows move, Enter plays, Tab changes style, / searches,
Q/E switch store, Ctrl + mouse wheel resizes, F5 rescans, F11 full screen.
Controller: D-pad/stick move, A play, X style, Y search, LB/RB store,
LT/RT size, Back rescans, Start full screen.

Your library, covers and settings live in %APPDATA%\Spindle.

FILES
main.js      window, launching, saving your library
scanner.js   finds Steam / Epic / GOG / folder games
preload.js   the bridge between the window and main.js
renderer/    the shelf itself (HTML, CSS, JS)
