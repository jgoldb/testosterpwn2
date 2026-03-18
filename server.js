const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- User persistence ---
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- Sessions & State ---
const sessions = new Map(); // token -> { username }
const lobbyUsers = new Map(); // username -> Set<socketId>
const games = new Map(); // gameId -> GameRoom

// --- Map & Spawn Data ---
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,2,2,2,0,0,0,3,3,3,3,3,0,0,0,4,4,4,0,0,0,1],
  [1,0,0,2,0,0,0,0,0,3,0,0,0,3,0,0,0,0,0,4,0,0,0,1],
  [1,0,0,2,0,0,0,0,0,3,0,0,0,3,0,0,0,0,0,4,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,1],
  [1,0,0,0,0,0,5,5,0,0,0,0,0,0,0,5,5,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,5,5,0,0,0,0,0,0,0,5,5,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,6,0,0,0,0,0,0,6,6,6,0,0,0,0,0,0,6,0,0,0,1],
  [1,0,0,6,0,0,0,0,0,0,6,0,6,0,0,0,0,0,0,6,0,0,0,1],
  [1,0,0,6,0,0,0,0,0,0,0,0,6,0,0,0,0,0,0,6,0,0,0,1],
  [1,0,0,6,0,0,0,0,0,0,6,6,6,0,0,0,0,0,0,6,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,1],
  [1,0,0,2,2,0,0,0,0,4,4,0,0,4,4,0,0,0,0,2,2,0,0,1],
  [1,0,0,0,2,0,0,0,0,4,0,0,0,0,4,0,0,0,2,0,0,0,0,1],
  [1,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];
const MAP_W = 24, MAP_H = 24;

const SPAWN_POINTS = [
  { x: 1.5, y: 1.5, angle: Math.PI / 4 },         // top-left
  { x: 22.5, y: 1.5, angle: (3 * Math.PI) / 4 },  // top-right
  { x: 1.5, y: 22.5, angle: -Math.PI / 4 },        // bottom-left
  { x: 22.5, y: 22.5, angle: (-3 * Math.PI) / 4 }, // bottom-right
];

// --- Helpers ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function emitPlayerList() {
  const playerList = [];
  const seen = new Set();

  // Lobby users first (not in-game)
  for (const u of lobbyUsers.keys()) {
    seen.add(u);
    playerList.push({ username: u, inGame: false });
  }

  // Add in-game players who aren't already listed
  for (const g of games.values()) {
    if (g.status === 'waiting') continue; // waiting players still have lobby sockets
    for (const [uname] of g.players) {
      if (!seen.has(uname)) {
        seen.add(uname);
        playerList.push({ username: uname, inGame: true });
      }
    }
  }

  io.emit('lobby:players', playerList);
}

function serializeGame(g) {
  return {
    id: g.id,
    host: g.host,
    mode: g.mode,
    maxPlayers: g.maxPlayers,
    friendlyFire: g.friendlyFire,
    status: g.status,
    players: Array.from(g.players.values()).map((p) => ({
      username: p.username,
      team: p.team,
    })),
  };
}

function emitToUser(username, event, data) {
  const sockets = lobbyUsers.get(username);
  if (!sockets) return;
  for (const sid of sockets) {
    io.to(sid).emit(event, data);
  }
}

function broadcastGamesList() {
  const list = [];
  for (const g of games.values()) {
    if (g.status !== 'finished') list.push(serializeGame(g));
  }
  io.emit('lobby:games', list);
}

function assignTeam(game) {
  if (game.mode !== '2v2') return 0;
  const players = Array.from(game.players.values());
  const t0 = players.filter((p) => p.team === 0).length;
  const t1 = players.filter((p) => p.team === 1).length;
  return t0 <= t1 ? 0 : 1;
}

function getSpawns(game) {
  const players = Array.from(game.players.values());
  if (game.mode === '1v1') {
    // Diagonal opposites
    players[0].spawn = SPAWN_POINTS[0];
    players[1].spawn = SPAWN_POINTS[3];
  } else if (game.mode === '2v2') {
    // Team 0: top spawns, Team 1: bottom spawns
    const t0 = players.filter((p) => p.team === 0);
    const t1 = players.filter((p) => p.team === 1);
    t0.forEach((p, i) => (p.spawn = SPAWN_POINTS[i]));
    t1.forEach((p, i) => (p.spawn = SPAWN_POINTS[2 + i]));
  } else {
    // FFA: distribute all 4 spawn points
    players.forEach((p, i) => (p.spawn = SPAWN_POINTS[i]));
  }
}

function checkWinCondition(game) {
  const players = Array.from(game.players.values());
  const alive = players.filter((p) => p.alive);

  if (game.mode === '2v2') {
    const t0Alive = alive.filter((p) => p.team === 0);
    const t1Alive = alive.filter((p) => p.team === 1);
    if (t0Alive.length === 0 && t1Alive.length > 0) return { winnerTeam: 1 };
    if (t1Alive.length === 0 && t0Alive.length > 0) return { winnerTeam: 0 };
    return null;
  }

  // 1v1 or FFA: last player standing
  if (alive.length <= 1) {
    return { winner: alive.length === 1 ? alive[0].username : null };
  }
  return null;
}

function buildStats(game) {
  return Array.from(game.players.values()).map((p) => ({
    username: p.username,
    team: p.team,
    kills: p.kills,
    deaths: p.deaths,
    damageDealt: p.damageDealt,
    headshots: p.headshots,
  }));
}

function cleanupGame(gameId) {
  const game = games.get(gameId);
  if (!game) return;
  games.delete(gameId);
  broadcastGamesList();
  emitPlayerList();
}

function findGameForPlayer(username) {
  for (const g of games.values()) {
    if (g.status !== 'finished' && g.players.has(username)) return g;
  }
  return null;
}

function hasLineOfSight(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist * 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const mx = Math.floor(x0 + dx * t);
    const my = Math.floor(y0 + dy * t);
    if (mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H) return false;
    if (MAP[my][mx] > 0) return false;
  }
  return true;
}

// --- Auth Routes ---

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const users = loadUsers();
  if (users[username.toLowerCase()]) return res.status(409).json({ error: 'Username already taken' });

  const hash = await bcrypt.hash(password, 10);
  users[username.toLowerCase()] = { username, passwordHash: hash, createdAt: Date.now() };
  saveUsers(users);

  const token = uuidv4();
  sessions.set(token, { username });
  res.json({ token, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const users = loadUsers();
  const user = users[username.toLowerCase()];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = uuidv4();
  sessions.set(token, { username: user.username });
  res.json({ token, username: user.username });
});

app.get('/api/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Invalid session' });
  res.json({ username: sessions.get(token).username });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// --- Socket.IO ---

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const session = sessions.get(token);
  if (!session) return next(new Error('Authentication required'));
  socket.username = session.username;
  socket.gameId = socket.handshake.auth.gameId || null;
  next();
});

io.on('connection', (socket) => {
  // ========================================
  // IN-GAME connection (mp-game.html)
  // ========================================
  if (socket.gameId) {
    const game = games.get(socket.gameId);
    if (!game || !game.players.has(socket.username)) {
      socket.emit('game:error', { message: 'Game not found' });
      socket.disconnect(true);
      return;
    }

    const roomName = 'game:' + game.id;
    socket.join(roomName);

    // Track socket for this player in the game
    const playerData = game.players.get(socket.username);
    playerData.socketId = socket.id;
    playerData.ready = false;

    // Player reports ready (finished loading)
    socket.on('game:ready', () => {
      playerData.ready = true;

      // Check if all players are ready
      const allReady = Array.from(game.players.values()).every((p) => p.ready);
      if (allReady && game.status === 'starting') {
        game.status = 'playing';
        io.to(roomName).emit('game:countdown');

        // 3-second countdown then go
        setTimeout(() => {
          if (game.status === 'playing') {
            io.to(roomName).emit('game:go');
            game.started = true;
          }
        }, 3000);
      }
    });

    // Position/state broadcasts (~20Hz from each client)
    // Uses volatile broadcast so stale position updates are dropped under backpressure
    // rather than queued, keeping latency low at the cost of occasional missed frames.
    socket.on('game:state', (data) => {
      if (game.status !== 'playing' || !playerData.alive) return;
      if (typeof data.x !== 'number' || typeof data.y !== 'number' || typeof data.angle !== 'number') return;

      // Basic bounds validation
      const clampedX = Math.max(0.5, Math.min(MAP_W - 0.5, data.x));
      const clampedY = Math.max(0.5, Math.min(MAP_H - 0.5, data.y));

      playerData.x = clampedX;
      playerData.y = clampedY;
      playerData.angle = data.angle;
      playerData.crouching = !!data.crouching;
      playerData.jumpZ = typeof data.jumpZ === 'number' ? Math.max(0, data.jumpZ) : 0;
      playerData.moving = !!data.moving;
      playerData.onGround = !!data.onGround;

      socket.volatile.to(roomName).emit('game:playerState', {
        username: socket.username,
        x: clampedX,
        y: clampedY,
        angle: data.angle,
        health: playerData.health,
        crouching: playerData.crouching,
        jumpZ: playerData.jumpZ,
        moving: playerData.moving,
        onGround: playerData.onGround,
      });
    });

    // Player fired their weapon (for audio broadcast, separate from hit detection)
    socket.on('game:fire', () => {
      if (game.status !== 'playing' || !game.started || !playerData.alive) return;
      socket.to(roomName).emit('game:playerFire', { username: socket.username });
    });

    // Shooting - client reports a hit
    socket.on('game:shoot', (data) => {
      if (game.status !== 'playing' || !game.started || !playerData.alive) return;
      if (!data || typeof data.target !== 'string') return;

      const target = game.players.get(data.target);
      if (!target || !target.alive) return;

      // 2v2 friendly fire check
      if (game.mode === '2v2' && !game.friendlyFire && playerData.team === target.team) return;

      // Basic distance/LOS sanity check using server-known positions
      const dx = target.x - playerData.x;
      const dy = target.y - playerData.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 30) return; // max render distance
      if (!hasLineOfSight(playerData.x, playerData.y, target.x, target.y)) return;

      // Apply damage (headshots deal double)
      const headshot = !!data.headshot;
      const damage = headshot ? 50 : 25;
      target.health = Math.max(0, target.health - damage);
      playerData.damageDealt += damage;

      io.to(roomName).emit('game:playerHit', {
        target: target.username,
        shooter: socket.username,
        newHealth: target.health,
        damage,
        headshot,
      });

      // Check for kill
      if (target.health <= 0) {
        target.alive = false;
        target.deaths++;
        playerData.kills++;
        if (headshot) playerData.headshots++;

        io.to(roomName).emit('game:playerKill', {
          victim: target.username,
          killer: socket.username,
          headshot,
        });

        // Check win condition
        const result = checkWinCondition(game);
        if (result) {
          game.status = 'finished';
          const stats = buildStats(game);
          io.to(roomName).emit('game:over', { result, stats, mode: game.mode });

          // Clean up game after a delay
          setTimeout(() => cleanupGame(game.id), 60000);
        }
      }
    });

    // Rematch voting
    socket.on('game:rematch', () => {
      if (game.status !== 'finished') return;
      if (!game.rematchVotes) game.rematchVotes = new Set();
      game.rematchVotes.add(socket.username);

      // Count how many players are still connected to this game room
      const connectedPlayers = [];
      for (const [uname, pd] of game.players) {
        if (pd.socketId) {
          const s = io.sockets.sockets.get(pd.socketId);
          if (s && s.connected) connectedPlayers.push(uname);
        }
      }

      const total = connectedPlayers.length;
      const count = connectedPlayers.filter(u => game.rematchVotes.has(u)).length;

      io.to(roomName).emit('game:rematchUpdate', { count, total });

      // All connected players voted — start a new game
      if (count >= total && total >= 2) {
        // Create new game with same settings
        const newGame = {
          id: uuidv4().slice(0, 8),
          host: game.host,
          mode: game.mode,
          maxPlayers: game.maxPlayers,
          friendlyFire: game.friendlyFire,
          status: 'starting',
          createdAt: Date.now(),
          started: false,
          players: new Map(),
        };

        // Re-add connected players with same teams
        for (const uname of connectedPlayers) {
          const oldPlayer = game.players.get(uname);
          newGame.players.set(uname, {
            username: uname,
            team: oldPlayer ? oldPlayer.team : 0,
            ready: false,
            alive: true,
            health: 100,
            x: 0, y: 0, angle: 0,
            kills: 0, deaths: 0, damageDealt: 0, headshots: 0,
            socketId: null,
            spawn: null,
            crouching: false,
            jumpZ: 0,
          });
        }

        // Assign spawns
        getSpawns(newGame);
        for (const p of newGame.players.values()) {
          p.x = p.spawn.x;
          p.y = p.spawn.y;
          p.angle = p.spawn.angle;
        }

        games.set(newGame.id, newGame);
        broadcastGamesList();

        // Build spawn data
        const spawnData = {};
        for (const [uname, p] of newGame.players) {
          spawnData[uname] = {
            x: p.spawn.x,
            y: p.spawn.y,
            angle: p.spawn.angle,
            team: p.team,
          };
        }

        const startPayload = {
          gameId: newGame.id,
          spawnData,
          mode: newGame.mode,
          friendlyFire: newGame.friendlyFire,
        };

        io.to(roomName).emit('game:rematchStarting', startPayload);

        // Timeout: abort if not all players ready within 15s
        setTimeout(() => {
          if (newGame.status === 'starting') {
            newGame.status = 'finished';
            const newRoomName = 'game:' + newGame.id;
            io.to(newRoomName).emit('game:error', { message: 'Not all players loaded in time. Game aborted.' });
            setTimeout(() => cleanupGame(newGame.id), 5000);
          }
        }, 15000);
      }
    });

    // Player disconnects during game
    socket.on('disconnect', () => {
      if (game.status === 'playing' && playerData.alive) {
        playerData.alive = false;
        playerData.deaths++;

        io.to(roomName).emit('game:playerKill', {
          victim: socket.username,
          killer: null, // disconnected
        });

        const result = checkWinCondition(game);
        if (result) {
          game.status = 'finished';
          const stats = buildStats(game);
          io.to(roomName).emit('game:over', { result, stats, mode: game.mode });
          setTimeout(() => cleanupGame(game.id), 60000);
        }
      } else if (game.status === 'starting') {
        // If someone disconnects before game starts, abort
        game.status = 'finished';
        io.to(roomName).emit('game:error', { message: `${socket.username} disconnected. Game aborted.` });
        setTimeout(() => cleanupGame(game.id), 5000);
      }

      // Update rematch vote count if game is finished
      if (game.status === 'finished' && game.rematchVotes) {
        game.rematchVotes.delete(socket.username);
        const connectedPlayers = [];
        for (const [uname, pd] of game.players) {
          if (pd.socketId && uname !== socket.username) {
            const s = io.sockets.sockets.get(pd.socketId);
            if (s && s.connected) connectedPlayers.push(uname);
          }
        }
        const total = connectedPlayers.length;
        const count = connectedPlayers.filter(u => game.rematchVotes.has(u)).length;
        if (total > 0) {
          io.to(roomName).emit('game:rematchUpdate', { count, total });
        }
      }
    });

    return; // Don't run lobby logic for in-game sockets
  }

  // ========================================
  // LOBBY connection (lobby.html)
  // ========================================

  // Track multiple sockets per user (multiple tabs OK)
  if (!lobbyUsers.has(socket.username)) {
    lobbyUsers.set(socket.username, new Set());
  }
  const userSockets = lobbyUsers.get(socket.username);
  const isNewUser = userSockets.size === 0;
  userSockets.add(socket.id);

  if (isNewUser) {
    emitPlayerList();
    io.emit('lobby:system', {
      message: `${socket.username} entered the lobby`,
      timestamp: Date.now(),
    });
  }

  // Send current games list to newly connected user
  broadcastGamesList();

  // --- Chat ---
  socket.on('chat:message', (msg) => {
    if (typeof msg !== 'string' || !msg.trim()) return;
    const sanitized = msg.trim().slice(0, 500);
    io.emit('chat:message', {
      username: socket.username,
      message: sanitized,
      timestamp: Date.now(),
    });
  });

  // --- Game Room CRUD ---

  socket.on('game:create', (data) => {
    if (!data || !['1v1', '2v2', 'ffa'].includes(data.mode)) return;

    // Can't create if already in a game
    if (findGameForPlayer(socket.username)) {
      socket.emit('game:error', { message: 'Already in a game' });
      return;
    }

    const mode = data.mode;
    const maxPlayers = mode === '1v1' ? 2 : 4;
    const friendlyFire = mode === '2v2' ? !!data.friendlyFire : false;

    const game = {
      id: uuidv4().slice(0, 8),
      host: socket.username,
      mode,
      maxPlayers,
      friendlyFire,
      status: 'waiting',
      createdAt: Date.now(),
      started: false,
      players: new Map(),
    };

    const team = assignTeam(game);
    game.players.set(socket.username, {
      username: socket.username,
      team,
      ready: false,
      alive: true,
      health: 100,
      x: 0, y: 0, angle: 0,
      kills: 0, deaths: 0, damageDealt: 0, headshots: 0,
      socketId: null,
      spawn: null,
      crouching: false,
      jumpZ: 0,
    });

    games.set(game.id, game);
    socket.emit('game:joined', serializeGame(game));
    broadcastGamesList();
  });

  socket.on('game:join', (data) => {
    if (!data || !data.gameId) return;
    const game = games.get(data.gameId);
    if (!game) { socket.emit('game:error', { message: 'Game not found' }); return; }
    if (game.status !== 'waiting') { socket.emit('game:error', { message: 'Game already started' }); return; }
    if (game.players.size >= game.maxPlayers) { socket.emit('game:error', { message: 'Game is full' }); return; }
    if (game.players.has(socket.username)) { socket.emit('game:error', { message: 'Already in this game' }); return; }
    if (findGameForPlayer(socket.username)) { socket.emit('game:error', { message: 'Already in another game' }); return; }

    const team = assignTeam(game);
    game.players.set(socket.username, {
      username: socket.username,
      team,
      ready: false,
      alive: true,
      health: 100,
      x: 0, y: 0, angle: 0,
      kills: 0, deaths: 0, damageDealt: 0, headshots: 0,
      socketId: null,
      spawn: null,
      crouching: false,
      jumpZ: 0,
    });

    // Notify all lobby users about the update
    socket.emit('game:joined', serializeGame(game));
    broadcastGamesList();

    // Notify other players in the room
    for (const [username] of game.players) {
      if (username === socket.username) continue;
      emitToUser(username, 'game:updated', serializeGame(game));
    }
  });

  socket.on('game:leave', (data) => {
    if (!data || !data.gameId) return;
    const game = games.get(data.gameId);
    if (!game || !game.players.has(socket.username)) return;

    game.players.delete(socket.username);

    if (game.players.size === 0) {
      games.delete(game.id);
    } else if (game.host === socket.username) {
      // Transfer host to next player
      game.host = game.players.keys().next().value;
      // Notify remaining players
      for (const [username] of game.players) {
        const sid = lobbyUsers.get(username);
        if (sid) io.to(sid).emit('game:updated', serializeGame(game));
      }
    } else {
      for (const [username] of game.players) {
        const sid = lobbyUsers.get(username);
        if (sid) io.to(sid).emit('game:updated', serializeGame(game));
      }
    }

    socket.emit('game:left');
    broadcastGamesList();
  });

  socket.on('game:start', (data) => {
    if (!data || !data.gameId) return;
    const game = games.get(data.gameId);
    if (!game) return;
    if (game.host !== socket.username) { socket.emit('game:error', { message: 'Only the host can start' }); return; }
    if (game.status !== 'waiting') return;

    // Check minimum players
    const count = game.players.size;
    if (game.mode === '1v1' && count !== 2) { socket.emit('game:error', { message: 'Need exactly 2 players' }); return; }
    if (game.mode === '2v2' && count !== 4) { socket.emit('game:error', { message: 'Need exactly 4 players' }); return; }
    if (game.mode === 'ffa' && count < 2) { socket.emit('game:error', { message: 'Need at least 2 players' }); return; }

    // Assign spawns
    getSpawns(game);

    // Set initial positions from spawns
    for (const p of game.players.values()) {
      p.x = p.spawn.x;
      p.y = p.spawn.y;
      p.angle = p.spawn.angle;
    }

    game.status = 'starting';

    // Build spawn data to send to clients
    const spawnData = {};
    for (const [username, p] of game.players) {
      spawnData[username] = {
        x: p.spawn.x,
        y: p.spawn.y,
        angle: p.spawn.angle,
        team: p.team,
      };
    }

    // Notify all players in the game room to load mp-game.html
    const startingPayload = {
      gameId: game.id,
      spawnData,
      mode: game.mode,
      friendlyFire: game.friendlyFire,
    };
    for (const [username] of game.players) {
      emitToUser(username, 'game:starting', startingPayload);
    }

    broadcastGamesList();

    // Timeout: if not all players ready within 15s, abort
    setTimeout(() => {
      if (game.status === 'starting') {
        game.status = 'finished';
        const roomName = 'game:' + game.id;
        io.to(roomName).emit('game:error', { message: 'Not all players loaded in time. Game aborted.' });
        setTimeout(() => cleanupGame(game.id), 5000);
      }
    }, 15000);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    // Remove this socket from the user's set
    const sockets = lobbyUsers.get(socket.username);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        // User has no more lobby sockets - fully gone
        lobbyUsers.delete(socket.username);

        // Remove from any waiting game
        const game = findGameForPlayer(socket.username);
        if (game && game.status === 'waiting') {
          game.players.delete(socket.username);
          if (game.players.size === 0) {
            games.delete(game.id);
          } else {
            if (game.host === socket.username) {
              game.host = game.players.keys().next().value;
            }
            for (const [uname] of game.players) {
              emitToUser(uname, 'game:updated', serializeGame(game));
            }
          }
          broadcastGamesList();
        }

        io.emit('lobby:system', {
          message: `${socket.username} left the lobby`,
          timestamp: Date.now(),
        });
        emitPlayerList();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`TESTOSTERPWN server running on http://localhost:${PORT}`);
});
