SPINDLE 0.1 — your games, movies and music on a shelf
======================================================

Built the same way as Cartridge: an Electron app (Chromium + Node.js).
Three separate libraries — Games, Movies, Music — switched with the tabs at
the top (Ctrl + Tab, Alt + 1/2/3, or LT/RT on a controller).
Everything is shown as a spinning DISC, a CASE with the disc sliding out, or
a SAVE icon (floppy disk with a handwritten label). Switch styles with the
buttons at the top, Tab, keys 1/2/3, or X on a controller.

RUN IT
1. Install Node.js LTS from https://nodejs.org (only once).
2. Double-click Run-Spindle.bat. The first run downloads Electron (~1 min).

MAKE A SINGLE .EXE
Double-click Build-Exe.bat. You get dist\Spindle-0.1.0-portable.exe, which
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

MOVIES & TV
- Looks in your Videos folder; add more with ... menu > Add a movies / TV folder.
- "Movie Name (2019).mkv" or a folder "Movie Name (2019)" becomes one movie;
  files shorter than ~40 MB (clips, samples) are skipped.
- "Show S01E02.mkv" / "Show 1x02.mkv" episodes are grouped into one TV show
  with an episode list.
- Covers: poster.jpg / folder.jpg / <movie name>-poster.jpg next to the file
  (Kodi / Jellyfin / Plex style), otherwise looked up online by title.
- Watch opens the file in your default video player (VLC, Films & TV...).

MUSIC
- Looks in your Music folder; add more with ... menu > Add a music folder.
- Every folder of tracks is one album (a CD in a square jewel case). Artist,
  album, year and track titles come from the files' tags; covers from
  cover.jpg / folder.jpg, the art embedded in the tracks, or online.
- Plays inside Spindle: track list, shuffle, seek, volume, and Windows'
  media keys. Space = pause, , and . = previous / next track.

CONTROLS
Keyboard: arrows move, Enter plays, Tab changes style, / searches,
Q/E switch filter, Ctrl + Tab switches library, Ctrl + mouse wheel resizes,
F5 rescans, F11 full screen.
Controller: D-pad/stick move, A play, X style, Y search, LB/RB filter,
LT/RT switch library, Back rescans, Start full screen.

Your library, covers and settings live in %APPDATA%\Spindle.

FILES
main.js      window, launching, saving your library
scanner.js   finds Steam / Epic / GOG / folder games
media.js     finds movies, TV shows and music albums
preload.js   the bridge between the window and main.js
renderer/    the shelf itself (HTML, CSS, JS)
