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

// --- Maps ---
const MAPS = {
  'test-arena': {
    name: 'Test Arena',
    width: 24,
    height: 24,
    grid: [
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
    ],
    spawns: [
      { x: 1.5, y: 1.5, angle: Math.PI / 4 },
      { x: 22.5, y: 1.5, angle: (3 * Math.PI) / 4 },
      { x: 1.5, y: 22.5, angle: -Math.PI / 4 },
      { x: 22.5, y: 22.5, angle: (-3 * Math.PI) / 4 },
    ],
  },

  'the-spire': {
    name: 'The Spire',
    width: 24,
    height: 24,
    // Layout: L0 (south, h=0), L1 (center, h=1.0), L2 (north small, h=2.0)
    // West/east staircases connect L0-L1, center staircase connects L1-L2
    // South edge of L1: railings on sides, open ledge in center (can fall)
    grid: [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 0 border
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 1 L2/L1
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 2 L2/L1
      [1,0,0,0,0,0,0,0,7,7,7,0,0,7,7,7,0,0,0,0,0,0,0,1], // 3 wall barrier L1-L2 (gap at 11-12 for stairs)
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 4 L1 + stairs at 11-12
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 5 L1 + stairs at 11-12
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 6 L1
      [1,0,0,0,0,0,5,5,0,0,0,0,0,0,0,0,5,5,0,0,0,0,0,1], // 7 L1 cover
      [1,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,1], // 8 L1 cover
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 9 L1
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 10 L1
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 11 L1
      [1,0,0,0,12,12,12,12,0,0,0,0,0,0,0,0,12,12,12,12,0,0,0,1], // 12 L1 south edge: railings + open ledge center
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 13 transition (stairs at 2-3, 20-21)
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 14 stairs
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 15 stairs
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 16 stairs
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 17 L0
      [1,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,1], // 18 L0 cover
      [1,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,1], // 19 L0 cover
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 20 L0
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 21 L0
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 22 L0
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 23 border
    ],
    heightMap: [
      //0   1   2   3   4   5   6   7   8   9  10  11    12  13  14  15  16  17  18  19  20  21  22  23
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 0 border
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  2,  2,  2,    2,  2,  2,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 1 L1 + L2 cols 9-14
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  2,  2,  2,    2,  2,  2,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 2 L1 + L2 cols 9-14
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1.75, 1.75,1, 1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 3 barrier + stairs 11-12
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1.5,  1.5, 1, 1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 4 stairs 11-12
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1.25, 1.25,1, 1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 5 stairs 11-12
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 6 L1
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 7 L1
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 8 L1
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 9 L1
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 10 L1
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 11 L1
      [0,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  0  ], // 12 L1 (railings + open ledge)
      [0,  0,  1,  1,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  1,  1,  0,  0  ], // 13 stair tops at 2-3,20-21
      [0,  0,  .75,.75,0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  .75,.75,0,  0  ], // 14 stairs
      [0,  0,  .5, .5, 0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  .5, .5, 0,  0  ], // 15 stairs
      [0,  0,  .25,.25,0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  .25,.25,0,  0  ], // 16 stairs
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 17 L0
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 18 L0
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 19 L0
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 20 L0
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 21 L0
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 22 L0
      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0  ], // 23 border
    ],
    ceilingH: 3.0,
    spawns: [
      { x: 2.5, y: 20.5, angle: Math.PI / 4, z: 0 },           // L0 SW courtyard
      { x: 21.5, y: 20.5, angle: (3 * Math.PI) / 4, z: 0 },    // L0 SE courtyard
      { x: 12.5, y: 9.5, angle: -Math.PI / 2, z: 1.0 },        // L1 center platform
      { x: 12.5, y: 1.5, angle: Math.PI / 2, z: 2.0 },         // L2 sniper nest
    ],
  },

  'the-cage': {
    name: 'The Cage',
    width: 32,
    height: 32,
    grid: [
      //                                        Corner bunkers (7=concrete), Central fortress (8=steel, 4=amber),
      //                                        Side wings (6=blue), Cover (5=purple, 3=green),
      //                                        Doors (10), Windows (11), Core (2=red)
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,7,7,7,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,7,7,7,0,1],
      [1,0,7,0,0,7,0,0,0,0,0,0,0,0,5,0,0,5,0,0,0,0,0,0,0,0,7,0,0,7,0,1],
      [1,0,7,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,7,0,1],
      [1,0,7,11,10,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,10,11,7,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,1],
      [1,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,8,8,11,8,8,10,10,8,8,11,8,8,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,1],
      [1,0,5,0,0,0,0,0,0,0,8,0,0,4,4,10,10,4,4,0,0,8,0,0,0,0,0,0,0,5,0,1],
      [1,0,0,0,0,0,0,0,0,0,8,0,0,4,0,0,0,0,4,0,0,8,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,6,6,10,6,0,10,0,0,10,0,0,0,0,10,0,0,10,0,6,10,6,6,0,0,0,0,1],
      [1,0,0,0,0,6,0,0,6,0,8,0,0,4,0,2,2,0,4,0,0,8,0,6,0,0,6,0,0,0,0,1],
      [1,0,0,0,0,6,0,0,6,0,8,0,0,4,0,2,2,0,4,0,0,8,0,6,0,0,6,0,0,0,0,1],
      [1,0,0,0,0,6,6,10,6,0,10,0,0,10,0,0,0,0,10,0,0,10,0,6,10,6,6,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,8,0,0,4,0,0,0,0,4,0,0,8,0,0,0,0,0,0,0,0,0,1],
      [1,0,5,0,0,0,0,0,0,0,8,0,0,4,4,10,10,4,4,0,0,8,0,0,0,0,0,0,0,5,0,1],
      [1,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,8,8,11,8,8,10,10,8,8,11,8,8,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,0,1],
      [1,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,7,11,10,7,0,0,0,0,0,0,0,0,5,0,0,5,0,0,0,0,0,0,0,0,7,10,11,7,0,1],
      [1,0,7,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,7,0,1],
      [1,0,7,0,0,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,0,0,7,0,1],
      [1,0,7,7,7,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,7,7,7,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    spawns: [
      { x: 3.5, y: 3.5, angle: Math.PI / 4 },
      { x: 28.5, y: 3.5, angle: (3 * Math.PI) / 4 },
      { x: 3.5, y: 28.5, angle: -Math.PI / 4 },
      { x: 28.5, y: 28.5, angle: (-3 * Math.PI) / 4 },
    ],
  },
};

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
    mapId: g.mapId,
    mapName: g.mapName,
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
  const mapDef = MAPS[game.mapId] || MAPS['test-arena'];
  const spawnPoints = mapDef.spawns;
  if (game.mode === '1v1') {
    players[0].spawn = spawnPoints[0];
    players[1].spawn = spawnPoints[3];
  } else if (game.mode === '2v2') {
    const t0 = players.filter((p) => p.team === 0);
    const t1 = players.filter((p) => p.team === 1);
    t0.forEach((p, i) => (p.spawn = spawnPoints[i]));
    t1.forEach((p, i) => (p.spawn = spawnPoints[2 + i]));
  } else {
    players.forEach((p, i) => (p.spawn = spawnPoints[i]));
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

function hasLineOfSight(mapGrid, mapW, mapH, x0, y0, x1, y1, z0, z1, heightMap) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist * 4);
  const hasZ = z0 !== undefined && z1 !== undefined && heightMap;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const mx = Math.floor(x0 + dx * t);
    const my = Math.floor(y0 + dy * t);
    if (mx < 0 || mx >= mapW || my < 0 || my >= mapH) return false;
    const tile = mapGrid[my][mx];
    if (tile === 0 || tile === 11) continue; // empty/windows don't block
    if (tile === 12) {
      // Railing: check if LOS passes above it
      if (hasZ) {
        const railFloor = heightMap[my][mx];
        const railTop = railFloor + 0.5;
        const zAtPoint = z0 + (z1 - z0) * t;
        if (zAtPoint > railTop) continue;
      }
      continue; // railings don't block LOS (can shoot over)
    }
    if (tile > 0) return false;
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
      const clampedX = Math.max(0.5, Math.min(game.mapW - 0.5, data.x));
      const clampedY = Math.max(0.5, Math.min(game.mapH - 0.5, data.y));

      playerData.x = clampedX;
      playerData.y = clampedY;
      playerData.angle = data.angle;
      playerData.crouching = !!data.crouching;
      playerData.jumpZ = typeof data.jumpZ === 'number' ? Math.max(0, data.jumpZ) : 0;
      playerData.floorZ = typeof data.floorZ === 'number' ? Math.max(0, data.floorZ) : 0;
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
        floorZ: playerData.floorZ,
        moving: playerData.moving,
        onGround: playerData.onGround,
      });
    });

    // Player fired their weapon (for audio broadcast, separate from hit detection)
    socket.on('game:fire', () => {
      if (game.status !== 'playing' || !game.started || !playerData.alive) return;
      socket.to(roomName).emit('game:playerFire', { username: socket.username });
    });

    // Door interaction (E key)
    socket.on('game:interact', (data) => {
      if (game.status !== 'playing' || !game.started || !playerData.alive) return;
      const now = Date.now();

      // Find nearby door in the direction the player is facing
      const angle = playerData.angle;
      for (let dist = 0.5; dist <= 1.3; dist += 0.2) {
        const cx = Math.floor(playerData.x + Math.cos(angle) * dist);
        const cy = Math.floor(playerData.y + Math.sin(angle) * dist);
        if (cx >= 0 && cx < game.mapW && cy >= 0 && cy < game.mapH) {
          const key = cx + ',' + cy;
          if (game.doorPositions.has(key)) {
            // Per-door cooldown: reject if animation still in progress
            if (!game.doorLastToggle) game.doorLastToggle = new Map();
            const lastToggle = game.doorLastToggle.get(key) || 0;
            if (now - lastToggle < 1400) break;
            game.doorLastToggle.set(key, now);
            const isOpen = game.mapGrid[cy][cx] === 0;
            game.mapGrid[cy][cx] = isOpen ? 10 : 0;
            io.to(roomName).emit('game:doorToggle', { x: cx, y: cy, open: !isOpen });
            break;
          }
        }
      }
    });

    // Window break - projectile hit a window
    socket.on('game:shootWindow', (data) => {
      if (game.status !== 'playing' || !game.started || !playerData.alive) return;
      if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
      const wx = Math.floor(data.x), wy = Math.floor(data.y);
      if (wx < 0 || wx >= game.mapW || wy < 0 || wy >= game.mapH) return;
      if (game.mapGrid[wy][wx] !== 11) return;
      game.mapGrid[wy][wx] = 0;
      io.to(roomName).emit('game:windowBreak', { x: wx, y: wy });
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
      // Height-aware LOS for multi-level maps
      const mapDef = MAPS[game.mapId];
      const shooterZ = (playerData.floorZ || 0) + 0.5;
      const targetZ = (target.floorZ || 0) + 0.5;
      if (!hasLineOfSight(game.mapGrid, game.mapW, game.mapH, playerData.x, playerData.y, target.x, target.y, shooterZ, targetZ, mapDef.heightMap)) return;

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
        const rematchMapDef = MAPS[game.mapId] || MAPS['test-arena'];
        const rematchMapGrid = rematchMapDef.grid.map(row => [...row]);
        const rematchDoorPositions = new Set();
        for (let y = 0; y < rematchMapDef.height; y++) {
          for (let x = 0; x < rematchMapDef.width; x++) {
            if (rematchMapDef.grid[y][x] === 10) rematchDoorPositions.add(x + ',' + y);
          }
        }

        const newGame = {
          id: uuidv4().slice(0, 8),
          host: game.host,
          mode: game.mode,
          maxPlayers: game.maxPlayers,
          friendlyFire: game.friendlyFire,
          mapId: game.mapId,
          mapName: game.mapName,
          mapGrid: rematchMapGrid,
          mapW: rematchMapDef.width,
          mapH: rematchMapDef.height,
          doorPositions: rematchDoorPositions,
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
            floorZ: 0,
          });
        }

        // Assign spawns
        getSpawns(newGame);
        for (const p of newGame.players.values()) {
          p.x = p.spawn.x;
          p.y = p.spawn.y;
          p.angle = p.spawn.angle;
          p.floorZ = p.spawn.z || 0;
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
            z: p.spawn.z || 0,
          };
        }

        const rematchStartMapDef = MAPS[newGame.mapId] || MAPS['test-arena'];
        const startPayload = {
          gameId: newGame.id,
          spawnData,
          mode: newGame.mode,
          friendlyFire: newGame.friendlyFire,
          mapId: newGame.mapId,
          mapGrid: rematchStartMapDef.grid,
          mapWidth: rematchStartMapDef.width,
          mapHeight: rematchStartMapDef.height,
          heightMap: rematchStartMapDef.heightMap || null,
          ceilingH: rematchStartMapDef.ceilingH || null,
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

    // Map selection
    const mapId = (data.map && MAPS[data.map]) ? data.map : 'test-arena';
    const mapDef = MAPS[mapId];

    // Build per-game map state (deep copy for door toggling)
    const mapGrid = mapDef.grid.map(row => [...row]);
    const doorPositions = new Set();
    for (let y = 0; y < mapDef.height; y++) {
      for (let x = 0; x < mapDef.width; x++) {
        if (mapDef.grid[y][x] === 10) doorPositions.add(x + ',' + y);
      }
    }

    const game = {
      id: uuidv4().slice(0, 8),
      host: socket.username,
      mode,
      maxPlayers,
      friendlyFire,
      mapId,
      mapName: mapDef.name,
      mapGrid,
      mapW: mapDef.width,
      mapH: mapDef.height,
      doorPositions,
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
      floorZ: 0,
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
      floorZ: 0,
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
      p.floorZ = p.spawn.z || 0;
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
        z: p.spawn.z || 0,
      };
    }

    // Notify all players in the game room to load mp-game.html
    const mapDef = MAPS[game.mapId];
    const startingPayload = {
      gameId: game.id,
      spawnData,
      mode: game.mode,
      friendlyFire: game.friendlyFire,
      mapId: game.mapId,
      mapGrid: mapDef.grid,
      mapWidth: mapDef.width,
      mapHeight: mapDef.height,
      heightMap: mapDef.heightMap || null,
      ceilingH: mapDef.ceilingH || null,
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
