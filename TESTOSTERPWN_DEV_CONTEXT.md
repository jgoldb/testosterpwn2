# TESTOSTERPWN: The Reckoning of Man — Development Context

## Overview

A Doom-style first-person shooter with **single player** and **multiplayer** modes, built as a **Node.js project** using **Express**, **Socket.IO**, **Phaser 3.60**, and a **custom raycasting engine**. The aesthetic is futuristic/cyberpunk with neon accents. Everything is procedurally generated — no external assets.

The game has a working single player mode (shoot static NPCs) and a full multiplayer system: user registration/login, a lobby with real-time chat, game room creation (1v1, 2v2, FFA), and networked PvP combat on the same map.

---

## Project Structure

```
testosterpwn2/
├── package.json              # Node.js project — express, socket.io, bcryptjs, uuid
├── server.js                 # Express + Socket.IO server (auth, lobby, game logic)
├── .gitignore                # Ignores node_modules/ and data/
├── public/
│   ├── index.html            # Login / Register page
│   ├── menu.html             # Mode selection (single player / multiplayer)
│   ├── game.html             # Single player game (Phaser + raycaster, self-contained)
│   ├── lobby.html            # Multiplayer lobby (chat, player list, game rooms)
│   ├── mp-game.html          # Multiplayer game (networked PvP, based on game.html)
│   └── css/
│       └── style.css         # Shared cyberpunk styles (login, menu, lobby)
├── data/                     # Created at runtime, gitignored
│   └── users.json            # User accounts (bcrypt-hashed passwords)
├── testosterpwn.html         # Original single-file prototype (legacy, preserved)
└── TESTOSTERPWN_DEV_CONTEXT.md
```

### How to Run

```
npm install
npm start          # starts server on http://localhost:3000
```

---

## Tech Stack & Architecture

### Server (`server.js`)

- **Express** serves static files from `public/`
- **REST API** for auth: `POST /api/register`, `POST /api/login`, `GET /api/verify`, `POST /api/logout`
- **Socket.IO** handles real-time lobby chat, game room management, and in-game state relay
- Users stored in `data/users.json` with bcrypt-hashed passwords
- Sessions are in-memory UUID tokens stored in a `Map<token, { username }>`

### Auth System

- Username + password registration and login
- Passwords hashed with **bcryptjs** (10 rounds)
- Session tokens are UUIDs stored in **`sessionStorage`** (per-tab, not shared across tabs)
- `sessionStorage` was chosen over `localStorage` specifically so that multiple tabs can be logged in as different users simultaneously (critical for testing and for users who want separate sessions)
- All protected pages verify the token against the server on load; invalid tokens redirect to login
- Socket.IO connections include the token in `handshake.auth` for server-side validation

### Client Pages

| Page | Purpose | Auth Required |
|------|---------|---------------|
| `index.html` (`/`) | Login / Register with tabbed form | No |
| `menu.html` | Choose Single Player or Multiplayer | Yes |
| `game.html` | Single player FPS (identical to original prototype) | Yes |
| `lobby.html` | Multiplayer lobby: chat, player list, game rooms | Yes |
| `mp-game.html` | Multiplayer PvP game | Yes (+ gameId) |

### Why Phaser + Custom Raycaster

Phaser provides the game loop (`update(time, delta)`), scene management, and timing. **All rendering bypasses Phaser's rendering pipeline** — we draw to an offscreen canvas via raw `ImageData` pixel manipulation and Canvas 2D API, then copy the result into a Phaser `CanvasTexture` each frame. Phaser's input system is **fully disabled** (`this.input.mouse.enabled = false`) — all input uses raw DOM event listeners.

### Rendering Pipeline (per frame, in order)

1. **`castRays()`** — Writes walls, ceiling, and floor into `frameImgData` (an `ImageData` object). Does NOT call `putImageData` — the buffer stays open for sprites.
2. **`renderNPCs()`** (single player) / **`renderRemotePlayers()`** (multiplayer) — Writes sprite pixels directly into `frameImgData` with alpha blending, depth testing against `depthBuffer`, and distance fog.
3. **`renderCtx.putImageData(frameImgData, 0, 0)`** — Commits the combined pixel buffer to the offscreen canvas.
4. **`renderWeapon()`** — Draws the weapon model, muzzle flash, and crosshair using Canvas 2D API on top of the pixel buffer.
5. **`renderHUD()`** — Draws health bars, ammo counter, kill tracker / alive count, damage/muzzle screen flashes.
6. **`renderMinimap()`** — Conditional (TAB toggle). Draws top-down map overlay with wall colors, player/NPC dots, player direction.
7. **`this.textures.get('render').update()`** — Tells Phaser the canvas texture changed so it redraws.

**Critical**: Steps 1-2 share `frameImgData`. Walls and sprites are composited at the pixel level in the same buffer. The weapon/HUD/minimap are drawn as Canvas 2D overlays AFTER `putImageData`.

### Resolution & Scaling

- Internal render: **480×300** (`RENDER_W` × `RENDER_H`)
- Display: **960×600** (`SCREEN_W` × `SCREEN_H`) — 2× upscale via `renderTex.setDisplaySize()`
- This gives a chunky retro pixel look while keeping the raycasting performant

---

## Raycaster Details

### Algorithm

Standard **DDA (Digital Differential Analyzer)** raycasting, same core algorithm as Wolfenstein 3D / Doom:
- Casts `NUM_RAYS` (480) rays across the FOV (60°)
- Steps through the grid using DDA to find wall intersections
- Uses perpendicular distance for **fish-eye correction**
- Stores distance in `depthBuffer[rayIndex]` — used by sprite renderer for occlusion

### Wall Rendering

- 6 wall types (IDs 1-6), each with a procedurally generated **64×64 texture** stored as `ImageData`
- Textures have: base color, panel grid lines, neon accent strips, tech detail squares, noise/grain
- **Side shading**: walls hit on Y-axis are darkened to 0.7× brightness (gives 3D depth)
- **Distance fog**: brightness fades to black based on `dist / MAX_DEPTH`

### Pitch (Vertical Look)

Implemented by shifting the **horizon line** (`RENDER_H / 2 + player.pitch`). This shifts wall draw positions, ceiling/floor gradient, and sprite vertical positions. Classic Doom technique, clamped to `±RENDER_H * 0.75`.

---

## NPC System (Single Player Only)

### Types

| Type | Color | HP | Visual |
|------|-------|----|--------|
| drone | Cyan (#0ff) | 100 | Small, 32×48 body |
| sentinel | Orange (#f80) | 150 | Medium, 36×56 body |
| heavy | Magenta (#f0f) | 250 | Large, 44×60 body |

### Sprite Generation

NPCs are procedurally drawn to 64×64 canvases at startup (`generateNPCSprites()`). Each sprite has: body glow, legs/hover jets, torso with energy core, visor with eyes, shoulder plates, weapon arm. Stored as `{ canvas, data: ImageData }`.

### Rendering

- Sorted far-to-near (painter's algorithm)
- Rendered as **billboard sprites** — always face the player
- Each column checks `depthBuffer[sx]` for wall occlusion
- Pixels are alpha-blended into `frameImgData` with distance fog and optional hit-flash

### NPC State

Each NPC has: `x, y, type, alive, health, frame`. The `frame` counter drives the white hit flash effect. **NPCs are static** — no movement, no AI, no pathfinding.

---

## Combat

### Weapon

Single weapon: **Plasma Rifle**
- Hitscan (instant hit, no projectile)
- `shootCooldown: 8` frames between shots
- `muzzleFlash` / `weaponKick` timers for visual feedback
- 25 damage per hit

### Hitscan

- Single player: checks all alive NPCs against the center column of the screen
- Multiplayer: checks all alive remote players against the center column
- Calculates screen-space position and width based on distance
- Returns the **closest** target whose screen bounds overlap the crosshair
- **Line-of-sight check** (`hasLineOfSight()`): ray-marches at 4 samples/tile, rejects if any sample hits a wall

---

## Input System

### Pointer Lock

The game uses `requestPointerLock()` for mouse capture. Single player has a dual-mode fallback (clientX delta tracking) for sandboxed iframes. Multiplayer uses pointer lock only.

### Controls

| Input | Action |
|-------|--------|
| W/A/S/D | Move (forward/strafe) |
| Mouse move | Aim (yaw + pitch) |
| Left click | Fire weapon |
| Shift | Sprint (1.75× speed) |
| TAB | Toggle minimap |
| ESC | Pause / Resume (single player only) |

### Movement

- Collision detection uses a radius of 0.2 tiles — checks map grid independently on X/Y, allowing **wall sliding**
- Head bob: `bobPhase` advances while moving (faster when sprinting), `bobAmount` lerps toward 1 (moving) or 0 (stopped)

---

## Map

24×24 grid, values 0-6. `MAP[y][x]` where y=row, x=column. 0 = empty, 1-6 = wall types:

| ID | Name | Base Color | Accent |
|----|------|-----------|--------|
| 1 | Hull | Dark gray | Cyan |
| 2 | Danger | Dark red | Red |
| 3 | Bio | Dark green | Green |
| 4 | Energy | Dark brown | Orange |
| 5 | Void | Dark purple | Purple |
| 6 | Tech | Dark blue | Blue |

Single player spawns at `(12, 21)` facing north. The map has several rooms connected by corridors, with L-shaped walls, pillars (2×2 type-5 blocks), and an enclosed room (type-6).

### Multiplayer Spawn Points

4 fixed corner spawns used for multiplayer:

| Index | Position | Facing | Used by |
|-------|----------|--------|---------|
| 0 | (1.5, 1.5) | SE | 1v1 player 1, 2v2 team 0, FFA |
| 1 | (22.5, 1.5) | SW | 2v2 team 0, FFA |
| 2 | (1.5, 22.5) | NE | 2v2 team 1, FFA |
| 3 | (22.5, 22.5) | NW | 1v1 player 2, 2v2 team 1, FFA |

- **1v1**: players at indices 0 and 3 (diagonal opposites)
- **2v2**: team 0 at indices 0-1 (top), team 1 at indices 2-3 (bottom)
- **FFA**: all 4 distributed

---

## Multiplayer System

### Lobby (`lobby.html`)

Three-column layout: **Chat** (left) | **Games Panel** (center) | **Player List** (right).

**Chat**: Real-time messaging via Socket.IO. Messages sanitized to 500 chars. System messages for join/leave events.

**Player List**: Shows all users connected to the lobby (deduplicated by username — multiple tabs for the same user show as one entry). Online indicator dots, self highlighted in cyan.

**Games Panel**: Shows active game rooms. Users can:
- **Create** a game (choose mode: 1v1 / 2v2 / FFA; toggle friendly fire for 2v2)
- **Join** a waiting game (if not full)
- **View room details** when in a game (player list with team colors, host indicator)
- **Start** the game (host only, when player count requirements are met)
- **Leave** a game room

### Lobby Socket Tracking

`lobbyUsers` is a `Map<username, Set<socketId>>` — supports multiple sockets per user (multiple tabs). Join/leave system messages only fire when the first socket connects or the last disconnects. The player list is always deduplicated by username.

### Game Room Lifecycle

```
WAITING → STARTING → PLAYING → FINISHED
```

1. **WAITING**: Room is open. Players can join/leave. Host can start when requirements met.
2. **STARTING**: Host clicked start. Server assigns spawns, sends `game:starting` to all players. Players navigate to `mp-game.html`. 15-second timeout for all players to load.
3. **PLAYING**: All players reported `game:ready`. 3-second countdown, then `game:go`. Players can move, shoot, take damage.
4. **FINISHED**: Win condition met (or timeout/disconnect abort). Score screen shown. Game cleaned up after 60s.

### Game Room Server Data Structure

```js
{
  id: string,              // 8-char UUID prefix
  host: string,            // username of creator (transfers on leave)
  mode: '1v1' | '2v2' | 'ffa',
  maxPlayers: number,      // 2 for 1v1, 4 for 2v2/ffa
  friendlyFire: boolean,   // only for 2v2
  status: 'waiting' | 'starting' | 'playing' | 'finished',
  players: Map<username, {
    username, team, ready, alive, health,
    x, y, angle,           // server-known position (updated ~15Hz)
    kills, deaths, damageDealt,
    socketId, spawn
  }>
}
```

### Multiplayer Networking

**Architecture**: Client-authoritative movement, server-authoritative damage.

- Clients broadcast position/angle at **~15Hz** (`game:state` event)
- Server validates bounds, relays to other players in the room (`game:playerState`)
- Clients interpolate remote player positions with **30% lerp** per frame for smooth rendering
- Angle interpolation handles wrap-around correctly

**Shooting**: Client detects hit via hitscan, emits `game:shoot { target }`. Server validates:
1. Both shooter and target are alive
2. Target is within max render distance (30 tiles)
3. Line-of-sight check passes (server-side, using server-known positions)
4. Friendly fire rules respected (2v2)

Then applies 25 damage, broadcasts `game:playerHit` to all. On kill, broadcasts `game:playerKill`, checks win condition.

**Win Conditions**:
- **1v1 / FFA**: Last player alive wins
- **2v2**: All members of one team dead → other team wins

**Disconnect During Game**: Player treated as killed (increments deaths, triggers win condition check). During `starting` phase, any disconnect aborts the game.

### Multiplayer Game Page (`mp-game.html`)

Based on `game.html` with these key differences:
- **No NPCs** — replaced by networked remote players
- **No start screen or pause** — game starts immediately with countdown
- **Team-colored player sprites**: `generatePlayerSprite(colorCfg)` creates 64×64 sprites with configurable body/eye/glow colors
  - 2v2: Cyan (team 0) vs Magenta (team 1)
  - FFA: Cyan, Magenta, Orange, Green (assigned by player order)
- **`renderRemotePlayers()`** replaces `renderNPCs()` — same billboard rendering logic
- **Kill feed** (top-left): "Killer > Victim" entries, fade after 5 seconds
- **Player HUD** (top-right): All players' names and health bars with team colors
- **Death overlay**: "ELIMINATED" shown when killed, waits for match end
- **Score screen**: Full-screen overlay on game over — Victory/Defeat title, stats table (kills, deaths, damage), "Return to Lobby" button
- **Minimap**: Shows teammates only in 2v2 (opponents hidden for competitive play)

### Socket Events Reference

#### Lobby Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `lobby:players [names]` | Server → All | Deduplicated list of online usernames |
| `lobby:system { message, timestamp }` | Server → All | Join/leave notifications |
| `lobby:games [list]` | Server → All | All non-finished game rooms |
| `chat:message` | Both | Chat messages (client sends string, server broadcasts with username/timestamp) |
| `game:create { mode, friendlyFire }` | Client → Server | Create a new game room |
| `game:join { gameId }` | Client → Server | Join an existing room |
| `game:leave { gameId }` | Client → Server | Leave current room |
| `game:start { gameId }` | Client → Server | Host starts the game |
| `game:joined { game }` | Server → Client | Confirmation + room data |
| `game:updated { game }` | Server → Room | Room state changed (player joined/left, host changed) |
| `game:left` | Server → Client | Confirmation of leaving |
| `game:starting { gameId, spawnData, mode, friendlyFire }` | Server → Room | Navigate to mp-game.html |
| `game:error { message }` | Server → Client | Error message |

#### In-Game Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `game:ready` | Client → Server | Player finished loading mp-game.html |
| `game:countdown` | Server → Room | All players ready, 3-second countdown begins |
| `game:go` | Server → Room | Game starts, players can move/shoot |
| `game:state { x, y, angle }` | Client → Server | Position broadcast (~15Hz) |
| `game:playerState { username, x, y, angle, health }` | Server → Room (others) | Relayed position |
| `game:shoot { target }` | Client → Server | Hit report |
| `game:playerHit { target, shooter, newHealth, damage }` | Server → Room | Damage applied |
| `game:playerKill { victim, killer }` | Server → Room | Kill confirmed |
| `game:over { result, stats, mode }` | Server → Room | Game finished with final stats |

---

## Global State & Key Variables

### Single Player (`game.html`)

```
gameStarted    — boolean, true after clicking "Initiate Protocol"
gamePaused     — boolean, toggled by ESC / pointer lock loss
showMap        — boolean, toggled by TAB
keys           — object, keys[e.code] = true/false
player         — object with x, y, angle, pitch, health, armor, ammo, bob/shoot timers
NPCS           — array of {x, y, type, alive, health, frame} objects
wallTextures   — object keyed by wall ID (1-6), values are ImageData (64×64)
npcSprites     — object keyed by type name, values are {canvas, data: ImageData}
renderCtx      — CanvasRenderingContext2D for the offscreen render buffer
frameImgData   — ImageData shared between castRays and renderNPCs each frame
depthBuffer    — Float32Array[RENDER_W], wall distance per screen column
renderTex      — Phaser.GameObjects.Image displaying the render canvas
```

### Multiplayer (`mp-game.html`)

```
gameActive     — boolean, true after game:go event
gameOver       — boolean, true after game:over event
showMap        — boolean, toggled by TAB
keys           — object, keys[e.code] = true/false
player         — local player state (x, y, angle, pitch, health, ammo, alive, timers)
remotePlayers  — Map<username, {x, y, angle, targetX/Y/Angle, health, alive, team, color, hitFlash}>
playerSprites  — object keyed by username, values are {canvas, data: ImageData}
wallTextures   — same as single player
socket         — Socket.IO connection with { token, gameId } auth
mpUsername     — local player's username (from sessionStorage)
myTeam         — local player's team number
gameMode       — '1v1' | '2v2' | 'ffa'
friendlyFire   — boolean
```

### Server (`server.js`)

```
sessions       — Map<token, { username }> — active auth sessions
lobbyUsers     — Map<username, Set<socketId>> — lobby socket tracking (multi-tab safe)
games          — Map<gameId, GameRoom> — active game rooms
```

---

## Known Limitations & Technical Debt

1. **NPCs are static** — no AI, movement, or attack behavior (single player only)
2. **Single weapon only** — no weapon switching, no weapon variety
3. **No pickups** — health, armor, ammo are all static
4. **No doors or interactive elements** — E key is mapped but does nothing
5. **No audio** — Phaser audio is explicitly disabled (`noAudio: true`)
6. **No floor/ceiling textures** — just solid color gradients
7. **Pitch is fake** — horizon shift technique, not true vertical look. Works fine for the genre.
8. **No sprite animation** — all sprites are single-frame billboards
9. **Head bob affects sprite vertical position** — minor visual inconsistency
10. **Multiplayer is client-authoritative for movement** — position is trusted from clients, only damage is server-validated. Acceptable for a prototype but susceptible to teleport/speed cheats.
11. **No multiplayer respawning** — games are single-life elimination only
12. **~100ms effective lag on hit detection** — clients hitscan against interpolated positions, not true server positions. Acceptable for prototype.
13. **Sessions are in-memory** — server restart clears all login sessions (users must re-login). User accounts persist in `data/users.json`.
14. **No reconnection during game** — if a player's socket drops during a match, they're treated as dead
15. **Game room data is duplicated** — MAP array exists in both server.js and client HTML files

---

## Suggested Next Steps (in rough priority)

### Single Player
1. **NPC AI** — Basic state machine (idle → alert → chase → attack), pathfinding, NPCs shoot back
2. **Death animations** — NPC sprites collapse or explode when killed
3. **Weapon variety** — Shotgun (spread hitscan), rocket launcher (projectile), melee
4. **Pickups** — Health packs, armor shards, ammo crates placed on the map
5. **Doors** — Animated doors that open on approach or E key
6. **Audio** — Weapon sounds, NPC alert/death sounds, ambient music, footsteps

### Multiplayer
1. **Respawn modes** — Deathmatch with respawns, not just elimination
2. **Weapon pickups on map** — Multiple weapons scattered around the arena
3. **Health/ammo pickups** — Strategic resource placement
4. **Server-authoritative movement** — Prevent teleport/speed cheats (requires prediction + reconciliation)
5. **Lag compensation** — Server-side hit detection with rewind to improve fairness
6. **Spectator mode** — Dead players can cycle through remaining players' views
7. **Chat in-game** — Quick chat or text overlay during matches
8. **Persistent stats** — Win/loss record, kill/death ratio saved per user

### Both
1. **Audio** — Weapon sounds, hit markers, ambient music
2. **Sprite animation** — Multi-frame sprites for walk/attack/death
3. **Floor/ceiling textures** — Textured floor casting
4. **Multiple maps** — Map selection when creating a game
5. **HUD improvements** — Damage direction indicator, weapon icon, face portrait
