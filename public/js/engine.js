// =============================================
// TESTOSTERPWN: Shared Game Engine
// Raycasting FPS engine shared by SP and MP modes
// =============================================

// --- Constants ---
const SCREEN_W = 960;
const SCREEN_H = 600;
const RENDER_W = 480;
const RENDER_H = 300;
const TEX_SIZE = 64;
const FOV = Math.PI / 3;
const HALF_FOV = FOV / 2;
const NUM_RAYS = RENDER_W;
const MAX_DEPTH = 30;
const BASE_ROT_SPEED = 0.004;

// --- Map ---
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
const MAP_H = MAP.length;
const MAP_W = MAP[0].length;

// --- Engine State (initialized by Engine.init) ---
let renderCtx = null;
let depthBuffer = null;
let frameImgData = null;
let wallTextures = null;

// --- Texture Generation ---
function generateTextures() {
  const textures = {};
  const types = {
    1: { base: [20, 30, 40], accent: [0, 255, 255] },
    2: { base: [40, 15, 15], accent: [255, 50, 50] },
    3: { base: [15, 35, 20], accent: [0, 255, 100] },
    4: { base: [35, 25, 10], accent: [255, 160, 0] },
    5: { base: [30, 20, 40], accent: [180, 50, 255] },
    6: { base: [15, 25, 35], accent: [50, 150, 255] },
  };
  for (const [id, t] of Object.entries(types)) {
    const c = document.createElement('canvas');
    c.width = TEX_SIZE; c.height = TEX_SIZE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${t.base[0]},${t.base[1]},${t.base[2]})`;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.strokeStyle = `rgba(${t.accent[0]},${t.accent[1]},${t.accent[2]},0.15)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < TEX_SIZE; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TEX_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(TEX_SIZE, i); ctx.stroke();
    }
    ctx.fillStyle = `rgba(${t.accent[0]},${t.accent[1]},${t.accent[2]},0.6)`;
    ctx.fillRect(0, 30, TEX_SIZE, 2);
    ctx.fillRect(0, 50, TEX_SIZE, 1);
    ctx.fillStyle = `rgba(${t.accent[0]},${t.accent[1]},${t.accent[2]},0.3)`;
    ctx.fillRect(0, 29, TEX_SIZE, 1);
    ctx.fillRect(0, 32, TEX_SIZE, 1);
    ctx.fillStyle = `rgba(${t.accent[0]},${t.accent[1]},${t.accent[2]},0.4)`;
    ctx.fillRect(4, 4, 8, 8); ctx.fillRect(52, 4, 8, 8);
    ctx.fillStyle = `rgba(${t.accent[0]},${t.accent[1]},${t.accent[2]},0.8)`;
    ctx.fillRect(6, 6, 4, 4); ctx.fillRect(54, 6, 4, 4);
    const imgData = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    for (let p = 0; p < imgData.data.length; p += 4) {
      const n = (Math.random() - 0.5) * 12;
      imgData.data[p] = Math.max(0, Math.min(255, imgData.data[p] + n));
      imgData.data[p+1] = Math.max(0, Math.min(255, imgData.data[p+1] + n));
      imgData.data[p+2] = Math.max(0, Math.min(255, imgData.data[p+2] + n));
    }
    ctx.putImageData(imgData, 0, 0);
    textures[id] = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  }
  return textures;
}

// --- Sprite Direction ---
function getSpriteDir(entityAngle, vx, vy, ex, ey) {
  let r = Math.atan2(vy - ey, vx - ex) - entityAngle;
  r = ((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor((r + Math.PI / 8) / (Math.PI / 4)) % 8;
}

// --- 8-Directional Sprite Generation ---
function generateDirectionalSprites(bodyColor, eyeColor, glowColor, baseW) {
  const sprites = [];
  for (let d = 0; d < 8; d++) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const cx = 32, cy = 32;

    const bd = d <= 4 ? d : 8 - d;
    const flip = d > 4;
    const ws = bd === 2 ? 0.55 : (bd === 1 || bd === 3) ? 0.8 : 1.0;
    const w = Math.floor(baseW * ws);
    const front = bd <= 1, back = bd >= 3, side = bd === 2;

    if (flip) { ctx.translate(64, 0); ctx.scale(-1, 1); }

    // Body glow
    const grd = ctx.createRadialGradient(cx, cy + 4, 2, cx, cy + 4, w * 0.8);
    grd.addColorStop(0, `rgba(${glowColor},0.3)`);
    grd.addColorStop(1, `rgba(${glowColor},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);

    // Legs
    ctx.fillStyle = '#333';
    if (side) {
      ctx.fillRect(cx - 2, cy + 16, 5, 12);
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx - 1, cy + 26, 3, 2);
    } else {
      ctx.fillRect(cx - 5, cy + 16, 5, 12);
      ctx.fillRect(cx + 1, cy + 16, 5, 12);
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx - 4, cy + 26, 3, 2);
      ctx.fillRect(cx + 2, cy + 26, 3, 2);
    }

    // Torso
    const tw = w - (side ? 8 : 16);
    ctx.fillStyle = '#222';
    ctx.fillRect(cx - tw / 2, cy - 8, tw, 26);
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - tw / 2, cy - 8, tw, 26);

    if (front) {
      ctx.fillStyle = bodyColor;
      ctx.beginPath(); ctx.arc(cx, cy + 4, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (back) {
      ctx.fillStyle = bodyColor;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(cx - 5, cy - 2, 10, 14);
      ctx.globalAlpha = 1;
      ctx.fillRect(cx - 3, cy + 1, 6, 2);
      ctx.fillRect(cx - 3, cy + 6, 6, 2);
    }

    // Head
    const hw = Math.floor(20 * ws);
    ctx.fillStyle = '#181818';
    ctx.fillRect(cx - hw / 2, cy - 20, hw, 14);

    if (bd === 0) {
      ctx.fillStyle = eyeColor;
      ctx.fillRect(cx - 7, cy - 16, 5, 4);
      ctx.fillRect(cx + 2, cy - 16, 5, 4);
    } else if (bd === 1) {
      ctx.fillStyle = eyeColor;
      ctx.fillRect(cx - hw / 2 + 1, cy - 16, 4, 4);
      ctx.fillRect(cx - hw / 2 + 7, cy - 16, 5, 4);
    } else if (side) {
      ctx.fillStyle = eyeColor;
      ctx.fillRect(cx - hw / 2 + 1, cy - 16, 5, 4);
    }
    if (back) {
      ctx.fillStyle = bodyColor;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(cx - hw / 2 + 2, cy - 18, hw - 4, 2);
      ctx.globalAlpha = 1;
    }

    // Shoulders
    if (side) {
      ctx.fillStyle = '#333';
      ctx.fillRect(cx - w / 2, cy - 6, 5, 12);
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx - w / 2 + 1, cy - 4, 3, 2);
    } else {
      const sw = Math.max(4, Math.floor(7 * ws));
      ctx.fillStyle = '#333';
      ctx.fillRect(cx - w / 2 + 2, cy - 6, sw, 12);
      ctx.fillRect(cx + w / 2 - sw - 2, cy - 6, sw, 12);
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx - w / 2 + 3, cy - 4, Math.min(5, sw), 2);
      ctx.fillRect(cx + w / 2 - sw - 1, cy - 4, Math.min(5, sw), 2);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (d === 0 || d >= 5) {
      const wx = cx + Math.floor(w / 2) - 6;
      ctx.fillStyle = '#444';
      ctx.fillRect(wx, cy, 14, 4);
      ctx.fillStyle = eyeColor;
      ctx.fillRect(wx + 12, cy, 3, 4);
    }

    sprites.push({ canvas, data: ctx.getImageData(0, 0, 64, 64) });
  }
  return sprites;
}

// --- Line of Sight ---
function hasLineOfSight(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
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

// --- Raycasting ---
function castRays(player) {
  const imgData = renderCtx.createImageData(RENDER_W, RENDER_H);
  const data = imgData.data;
  const crouchShift = -player.crouchOffset * 25;
  const jumpShift = player.jumpZ * 55;
  const wallOffset = jumpShift + crouchShift;
  const horizonY = RENDER_H / 2 + player.pitch + crouchShift - jumpShift * 0.3;

  for (let y = 0; y < RENDER_H; y++) {
    let r, g, b;
    if (y < horizonY) {
      const t = Math.max(0, Math.min(1, 1 - y / Math.max(1, horizonY)));
      r = Math.floor(5 + t * 8); g = Math.floor(8 + t * 15); b = Math.floor(15 + t * 25);
    } else {
      const t = Math.max(0, Math.min(1, (y - horizonY) / Math.max(1, RENDER_H - horizonY)));
      r = Math.floor(8 + t * 12); g = Math.floor(12 + t * 8); b = Math.floor(10 + t * 5);
    }
    for (let x = 0; x < RENDER_W; x++) {
      const idx = (y * RENDER_W + x) * 4;
      data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
    }
  }

  for (let i = 0; i < NUM_RAYS; i++) {
    const rayAngle = player.angle - HALF_FOV + (i / NUM_RAYS) * FOV;
    const sin = Math.sin(rayAngle), cos = Math.cos(rayAngle);
    let wallType = 0, side = 0;
    let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
    const deltaDistX = Math.abs(1 / (cos || 0.0001));
    const deltaDistY = Math.abs(1 / (sin || 0.0001));
    const stepX = cos >= 0 ? 1 : -1, stepY = sin >= 0 ? 1 : -1;
    let sideDistX = cos >= 0 ? (mapX + 1 - player.x) * deltaDistX : (player.x - mapX) * deltaDistX;
    let sideDistY = sin >= 0 ? (mapY + 1 - player.y) * deltaDistY : (player.y - mapY) * deltaDistY;
    let hit = false;
    for (let step = 0; step < 64; step++) {
      if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
      else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
      if (mapX < 0 || mapX >= MAP_W || mapY < 0 || mapY >= MAP_H) break;
      if (MAP[mapY][mapX] > 0) { wallType = MAP[mapY][mapX]; hit = true; break; }
    }
    if (!hit) { depthBuffer[i] = MAX_DEPTH; continue; }

    let dist;
    if (side === 0) dist = (mapX - player.x + (1 - stepX) / 2) / (cos || 0.0001);
    else dist = (mapY - player.y + (1 - stepY) / 2) / (sin || 0.0001);
    dist = Math.max(dist, 0.01);
    depthBuffer[i] = dist;

    const lineHeight = Math.floor(RENDER_H / dist);
    const bobOffset = Math.sin(player.bobPhase) * 2 * player.bobAmount;
    const horizon = RENDER_H / 2 + player.pitch + bobOffset + wallOffset;
    const drawStart = Math.floor(horizon - lineHeight / 2);
    const drawEnd = Math.floor(horizon + lineHeight / 2);

    let wallX;
    if (side === 0) wallX = player.y + dist * sin;
    else wallX = player.x + dist * cos;
    wallX -= Math.floor(wallX);
    let texX = Math.floor(wallX * TEX_SIZE);
    if ((side === 0 && cos < 0) || (side === 1 && sin > 0)) texX = TEX_SIZE - texX - 1;

    const tex = wallTextures[wallType];
    if (!tex) continue;

    const yStart = Math.max(0, drawStart);
    const yEnd = Math.min(RENDER_H - 1, drawEnd);
    const fogFactor = Math.min(1, dist / MAX_DEPTH);

    for (let y = yStart; y <= yEnd; y++) {
      const texY = Math.floor(((y - drawStart) / lineHeight) * TEX_SIZE) & (TEX_SIZE - 1);
      const texIdx = (texY * TEX_SIZE + texX) * 4;
      let r = tex.data[texIdx], g = tex.data[texIdx + 1], b = tex.data[texIdx + 2];
      if (side === 1) { r *= 0.7; g *= 0.7; b *= 0.7; }
      r = Math.floor(r * (1 - fogFactor * 0.85));
      g = Math.floor(g * (1 - fogFactor * 0.85));
      b = Math.floor(b * (1 - fogFactor * 0.85));
      const idx = (y * RENDER_W + i) * 4;
      data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
    }
  }
  frameImgData = imgData;
}

// --- Sprite Rendering (billboard) ---
// Renders a sorted list of entities as billboard sprites into frameImgData.
// Each entity: { dist, dx, dy, spriteData (ImageData.data), hitFlash (0-1), jumpZ, crouching }
function renderSprites(player, entities) {
  if (!frameImgData) return;
  const data = frameImgData.data;
  const bobOffset = Math.sin(player.bobPhase) * 2 * player.bobAmount;
  const wallOffset = player.jumpZ * 55 - player.crouchOffset * 25;

  for (const ent of entities) {
    let angle = Math.atan2(ent.dy, ent.dx) - player.angle;
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    if (Math.abs(angle) > HALF_FOV + 0.2) continue;
    if (ent.dist < 0.3) continue;

    const screenX = (RENDER_W / 2) + (angle / HALF_FOV) * (RENDER_W / 2);
    const baseH = Math.min(RENDER_H * 1.5, (RENDER_H / ent.dist) * 0.8);
    const crouchScale = ent.crouching ? 0.6 : 1.0;
    const spriteH = baseH * crouchScale;
    const spriteW = baseH * 0.7;
    const remoteJumpOffset = (ent.jumpZ || 0) * 55 / Math.max(ent.dist, 0.3);
    const spriteTop = RENDER_H / 2 + baseH / 2 - spriteH + bobOffset + player.pitch + wallOffset - remoteJumpOffset;

    const spriteData = ent.spriteData;
    if (!spriteData) continue;

    const startX = Math.floor(screenX - spriteW / 2);
    const endX = Math.floor(screenX + spriteW / 2);
    const startY = Math.max(0, Math.floor(spriteTop));
    const endY = Math.min(RENDER_H - 1, Math.floor(spriteTop + spriteH));

    const fogFactor = Math.min(0.85, ent.dist / MAX_DEPTH);
    const brightness = 1 - fogFactor;
    const flashIntensity = ent.hitFlash > 0 ? Math.min(1, ent.hitFlash) : 0;

    for (let sx = startX; sx < endX; sx++) {
      if (sx < 0 || sx >= RENDER_W) continue;
      if (ent.dist >= depthBuffer[sx]) continue;
      const texX = Math.floor(((sx - startX) / (endX - startX)) * 64);
      if (texX < 0 || texX >= 64) continue;

      for (let sy = startY; sy <= endY; sy++) {
        const texY = Math.floor(((sy - spriteTop) / spriteH) * 64);
        if (texY < 0 || texY >= 64) continue;
        const srcIdx = (texY * 64 + texX) * 4;
        const sr = spriteData[srcIdx], sg = spriteData[srcIdx+1], sb = spriteData[srcIdx+2], sa = spriteData[srcIdx+3];
        if (sa < 10) continue;
        const dstIdx = (sy * RENDER_W + sx) * 4;
        const alpha = sa / 255;
        let r = sr * brightness, g = sg * brightness, b = sb * brightness;
        if (flashIntensity > 0) {
          r += (255 - r) * flashIntensity * 0.6;
          g += (255 - g) * flashIntensity * 0.6;
          b += (255 - b) * flashIntensity * 0.6;
        }
        data[dstIdx]     = Math.floor(data[dstIdx]     * (1 - alpha) + r * alpha);
        data[dstIdx + 1] = Math.floor(data[dstIdx + 1] * (1 - alpha) + g * alpha);
        data[dstIdx + 2] = Math.floor(data[dstIdx + 2] * (1 - alpha) + b * alpha);
      }
    }

    // Muzzle flash glow on remote player sprites
    if (ent.muzzleFlash && ent.muzzleFlash > 0) {
      const flashAlpha = Math.min(1, ent.muzzleFlash / 2);
      const flashRadius = Math.max(3, Math.floor(baseH * 0.12));
      const flashCx = Math.floor(screenX);
      const flashCy = Math.floor(spriteTop + spriteH * 0.35);

      for (let fy = -flashRadius; fy <= flashRadius; fy++) {
        for (let fx = -flashRadius * 2; fx <= flashRadius * 2; fx++) {
          const fpx = flashCx + fx, fpy = flashCy + fy;
          if (fpx < 0 || fpx >= RENDER_W || fpy < 0 || fpy >= RENDER_H) continue;
          if (ent.dist >= depthBuffer[fpx]) continue;
          const fd = Math.sqrt(fx * fx / 4 + fy * fy) / flashRadius;
          if (fd > 1) continue;
          const fa = flashAlpha * (1 - fd) * 0.8;
          const fi = (fpy * RENDER_W + fpx) * 4;
          data[fi] = Math.min(255, data[fi] + Math.floor(200 * fa));
          data[fi+1] = Math.min(255, data[fi+1] + Math.floor(255 * fa));
          data[fi+2] = Math.min(255, data[fi+2] + Math.floor(255 * fa));
        }
      }
    }
  }
}

// --- Projectile Rendering ---
function renderProjectiles(player, projectiles) {
  if (!frameImgData || projectiles.length === 0) return;
  const data = frameImgData.data;
  const bobOffset = Math.sin(player.bobPhase) * 2 * player.bobAmount;
  const wallOffset = player.jumpZ * 55 - player.crouchOffset * 25;
  const horizon = RENDER_H / 2 + player.pitch + bobOffset + wallOffset;

  for (const proj of projectiles) {
    const dx = proj.x - player.x;
    const dy = proj.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.3 || dist > MAX_DEPTH) continue;

    let angle = Math.atan2(dy, dx) - player.angle;
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    if (Math.abs(angle) > HALF_FOV + 0.1) continue;

    const screenX = (RENDER_W / 2) + (angle / HALF_FOV) * (RENDER_W / 2);
    const screenY = horizon;

    // Trail tail position in screen space
    const trailWorldLen = 0.6;
    const tailX = proj.x - Math.cos(proj.angle) * trailWorldLen;
    const tailY = proj.y - Math.sin(proj.angle) * trailWorldLen;
    const tailDx = tailX - player.x;
    const tailDy = tailY - player.y;
    let tailAngle = Math.atan2(tailDy, tailDx) - player.angle;
    while (tailAngle > Math.PI) tailAngle -= 2 * Math.PI;
    while (tailAngle < -Math.PI) tailAngle += 2 * Math.PI;
    const tailScreenX = (RENDER_W / 2) + (tailAngle / HALF_FOV) * (RENDER_W / 2);

    const headX = Math.floor(screenX);
    const tailSX = Math.floor(tailScreenX);
    const trailDir = headX > tailSX ? -1 : 1;
    const trailLen = Math.min(Math.abs(headX - tailSX), Math.floor(RENDER_H / dist * 0.6), 30);
    const dotSize = Math.max(1, Math.floor(2.5 / dist));

    for (let t = 0; t <= trailLen + dotSize; t++) {
      const px = headX + t * (-trailDir);
      if (px < 0 || px >= RENDER_W) continue;
      if (dist >= depthBuffer[px]) continue;

      const isHead = t <= dotSize;
      const trailFade = isHead ? 1 : Math.max(0, 1 - (t - dotSize) / Math.max(1, trailLen));

      for (let sy = -dotSize; sy <= dotSize; sy++) {
        const py = Math.floor(screenY) + sy;
        if (py < 0 || py >= RENDER_H) continue;

        const vertFade = 1 - Math.abs(sy) / (dotSize + 1);
        const a = trailFade * vertFade;

        const idx = (py * RENDER_W + px) * 4;
        if (isHead) {
          data[idx]   = Math.min(255, data[idx]   + Math.floor(220 * a));
          data[idx+1] = Math.min(255, data[idx+1] + Math.floor(255 * a));
          data[idx+2] = Math.min(255, data[idx+2] + Math.floor(255 * a));
        } else {
          data[idx]   = Math.min(255, data[idx]   + Math.floor(30 * a));
          data[idx+1] = Math.min(255, data[idx+1] + Math.floor(180 * a));
          data[idx+2] = Math.min(255, data[idx+2] + Math.floor(230 * a));
        }
      }
    }
  }
}

// --- Weapon Rendering ---
function renderWeapon(player) {
  const cx = RENDER_W / 2;
  const bobX = Math.sin(player.bobPhase) * 4 * player.bobAmount;
  const bobY = Math.abs(Math.cos(player.bobPhase)) * 3 * player.bobAmount;
  const kickY = player.weaponKick * 3;
  const baseX = cx + bobX, baseY = RENDER_H - 10 + bobY + kickY;

  renderCtx.save();
  renderCtx.fillStyle = '#1a1a2e';
  renderCtx.fillRect(baseX - 12, baseY - 60, 24, 60);
  renderCtx.fillStyle = '#16213e';
  renderCtx.fillRect(baseX - 6, baseY - 90, 12, 35);
  const pulse = Math.sin(Date.now() * 0.008) * 0.3 + 0.7;
  renderCtx.fillStyle = `rgba(0, 255, 255, ${pulse})`;
  renderCtx.fillRect(baseX - 4, baseY - 50, 8, 15);
  renderCtx.fillStyle = '#0a0a1a';
  renderCtx.fillRect(baseX - 16, baseY - 55, 4, 40);
  renderCtx.fillRect(baseX + 12, baseY - 55, 4, 40);
  renderCtx.fillStyle = '#0ff';
  renderCtx.globalAlpha = 0.7;
  renderCtx.fillRect(baseX - 15, baseY - 52, 2, 10);
  renderCtx.fillRect(baseX + 13, baseY - 52, 2, 10);
  renderCtx.globalAlpha = 1;

  if (player.muzzleFlash > 0) {
    const flashSize = player.muzzleFlash * 8;
    renderCtx.globalAlpha = player.muzzleFlash / 4;
    renderCtx.fillStyle = '#fff';
    renderCtx.beginPath(); renderCtx.arc(baseX, baseY - 90, flashSize, 0, Math.PI * 2); renderCtx.fill();
    renderCtx.fillStyle = '#0ff';
    renderCtx.beginPath(); renderCtx.arc(baseX, baseY - 90, flashSize * 1.5, 0, Math.PI * 2); renderCtx.fill();
    renderCtx.globalAlpha = 1;
  }
  renderCtx.restore();

  // Crosshair
  renderCtx.save();
  renderCtx.strokeStyle = '#0ff';
  renderCtx.lineWidth = 1;
  renderCtx.globalAlpha = 0.8;
  const chx = RENDER_W / 2, chy = RENDER_H / 2;
  const gap = 4 + (player.spread || 0) * 2, len = 8;
  renderCtx.beginPath();
  renderCtx.moveTo(chx - gap - len, chy); renderCtx.lineTo(chx - gap, chy);
  renderCtx.moveTo(chx + gap, chy); renderCtx.lineTo(chx + gap + len, chy);
  renderCtx.moveTo(chx, chy - gap - len); renderCtx.lineTo(chx, chy - gap);
  renderCtx.moveTo(chx, chy + gap); renderCtx.lineTo(chx, chy + gap + len);
  renderCtx.stroke();
  renderCtx.fillStyle = '#0ff';
  renderCtx.fillRect(chx - 1, chy - 1, 2, 2);
  renderCtx.restore();
}

// --- Base HUD (health bar, ammo, flashes) ---
// Returns after drawing shared elements; caller adds mode-specific elements before calling this.
function renderHUD(player, extras) {
  const ctx = renderCtx;
  ctx.save();

  // Bottom bar background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, RENDER_H - 30, RENDER_W, 30);
  ctx.fillStyle = 'rgba(0,255,255,0.15)';
  ctx.fillRect(0, RENDER_H - 30, RENDER_W, 1);
  ctx.font = '8px monospace';

  // Health
  ctx.fillStyle = player.health > 30 ? '#0f0' : '#f00';
  ctx.fillText('HP', 8, RENDER_H - 18);
  ctx.fillStyle = '#111';
  ctx.fillRect(24, RENDER_H - 24, 80, 10);
  ctx.fillStyle = player.health > 30 ? '#0f0' : '#f00';
  ctx.fillRect(24, RENDER_H - 24, Math.max(0, player.health) * 0.8, 10);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${Math.max(0, Math.floor(player.health))}`, 28, RENDER_H - 16);

  // Armor (SP only — passed in extras)
  if (extras && extras.armor !== undefined) {
    ctx.fillStyle = '#08f';
    ctx.fillText('AR', 8, RENDER_H - 6);
    ctx.fillStyle = '#111';
    ctx.fillRect(24, RENDER_H - 12, 80, 10);
    ctx.fillStyle = '#08f';
    ctx.fillRect(24, RENDER_H - 12, extras.armor * 0.8, 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${extras.armor}`, 28, RENDER_H - 4);
  }

  // Ammo
  ctx.fillStyle = '#ff0';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(`${player.ammo}`, RENDER_W - 50, RENDER_H - 10);
  ctx.font = '7px monospace';
  ctx.fillStyle = '#888';
  ctx.fillText('PLASMA', RENDER_W - 52, RENDER_H - 22);

  // Center info line (caller provides)
  if (extras && extras.centerTop) {
    ctx.fillStyle = extras.centerTopColor || '#0ff';
    ctx.font = '8px monospace';
    ctx.fillText(extras.centerTop, RENDER_W / 2 - 30, RENDER_H - 18);
  }
  if (extras && extras.centerBottom) {
    ctx.fillStyle = extras.centerBottomColor || '#f0a';
    ctx.font = '8px monospace';
    ctx.fillText(extras.centerBottom, RENDER_W / 2 - 30, RENDER_H - 6);
  }

  // Damage flash
  if (player.damageFlash > 0) {
    ctx.fillStyle = `rgba(255,0,0,${player.damageFlash * 0.1})`;
    ctx.fillRect(0, 0, RENDER_W, RENDER_H);
  }
  // Muzzle screen flash
  if (player.muzzleFlash > 2) {
    ctx.fillStyle = `rgba(0,255,255,${(player.muzzleFlash - 2) * 0.04})`;
    ctx.fillRect(0, 0, RENDER_W, RENDER_H);
  }

  ctx.restore();
}

// --- Minimap ---
// mapEntities: array of { x, y, color } for dots on the map
function renderMinimap(player, mapEntities) {
  const ctx = renderCtx;
  const size = 3, ox = 6, oy = 6;
  ctx.save();
  ctx.globalAlpha = 0.75;

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(ox - 2, oy - 2, MAP_W * size + 4, MAP_H * size + 4);
  ctx.strokeStyle = '#0ff';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox - 2, oy - 2, MAP_W * size + 4, MAP_H * size + 4);

  const wallColors = { 1: '#088', 2: '#800', 3: '#080', 4: '#860', 5: '#408', 6: '#068' };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (MAP[y][x] > 0) {
        ctx.fillStyle = wallColors[MAP[y][x]] || '#444';
        ctx.fillRect(ox + x * size, oy + y * size, size, size);
      }
    }
  }

  // Entities on map
  if (mapEntities) {
    for (const e of mapEntities) {
      ctx.fillStyle = e.color;
      ctx.fillRect(ox + e.x * size - 1, oy + e.y * size - 1, 3, 3);
    }
  }

  // Player
  const playerColor = (mapEntities && mapEntities.length > 0 && mapEntities[0].isMP) ? '#fff' : '#0f0';
  ctx.fillStyle = playerColor;
  ctx.fillRect(ox + player.x * size - 1.5, oy + player.y * size - 1.5, 3, 3);
  ctx.strokeStyle = playerColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + player.x * size, oy + player.y * size);
  ctx.lineTo(ox + (player.x + Math.cos(player.angle) * 2) * size,
             oy + (player.y + Math.sin(player.angle) * 2) * size);
  ctx.stroke();

  ctx.restore();
}

// --- Movement ---
// entities: array of { x, y, alive } to collide with (NPCs or remote players)
function handleMovement(player, keys, dt, entities, masterVolume, jumpAudio) {
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
  player.crouching = !!keys['KeyC'];
  const speed = (player.crouching ? player.crouchSpeed : sprint ? player.sprintSpeed : player.speed) * dt;
  let moving = false;
  let dx = 0, dy = 0;

  if (keys['KeyW']) { dx += Math.cos(player.angle) * speed; dy += Math.sin(player.angle) * speed; moving = true; }
  if (keys['KeyS']) { dx -= Math.cos(player.angle) * speed; dy -= Math.sin(player.angle) * speed; moving = true; }
  if (keys['KeyA']) { dx += Math.cos(player.angle - Math.PI/2) * speed; dy += Math.sin(player.angle - Math.PI/2) * speed; moving = true; }
  if (keys['KeyD']) { dx += Math.cos(player.angle + Math.PI/2) * speed; dy += Math.sin(player.angle + Math.PI/2) * speed; moving = true; }

  // Wall collision with sliding
  const r = 0.2;
  let newX = player.x, newY = player.y;
  if (MAP[Math.floor(player.y)][Math.floor(player.x + dx + Math.sign(dx) * r)] === 0) newX += dx;
  if (MAP[Math.floor(newY + dy + Math.sign(dy) * r)][Math.floor(newX)] === 0) newY += dy;

  // Entity collision (circle-vs-circle, slide around)
  const colR = 0.4;
  for (const ent of entities) {
    if (!ent.alive) continue;
    const ex = ent.x - newX, ey = ent.y - newY;
    const dist = Math.sqrt(ex * ex + ey * ey);
    if (dist < colR && dist > 0.001) {
      const push = (colR - dist) / dist;
      newX -= ex * push;
      newY -= ey * push;
    }
  }

  player.x = newX;
  player.y = newY;

  // Jump
  if (keys['Space'] && player.onGround) {
    player.jumpVel = 0.25;
    player.onGround = false;
    jumpAudio.currentTime = 0;
    jumpAudio.volume = 0.5 * masterVolume;
    jumpAudio.play().catch(() => {});
  }
  if (!player.onGround) {
    player.jumpZ += player.jumpVel * dt;
    player.jumpVel -= 0.010 * dt;
    if (player.jumpZ <= 0) {
      player.jumpZ = 0;
      player.jumpVel = 0;
      player.onGround = true;
    }
  }

  player.moving = moving && !player.crouching && player.onGround;

  // Crouch interpolation
  const crouchTarget = player.crouching ? 1 : 0;
  player.crouchOffset += (crouchTarget - player.crouchOffset) * 0.2 * dt;

  // Head bob
  const bobSpeed = player.crouching ? 0.08 : (sprint ? 0.18 : 0.12);
  if (moving) {
    player.bobPhase += bobSpeed * dt;
    player.bobAmount = Math.min(player.bobAmount + 0.1 * dt, 1);
  } else {
    player.bobAmount = Math.max(player.bobAmount - 0.08 * dt, 0);
  }

  // Spread from movement — pushes toward target, decay in tickShootingVisuals pulls back
  if (moving) {
    const spreadTarget = player.crouching ? 1.5 : (sprint ? 9 : 5);
    player.spread = (player.spread || 0) + (spreadTarget - (player.spread || 0)) * 0.2 * dt;
  }
}

// --- Shooting Timer/Visual Management ---
function tickShootingVisuals(player, dt) {
  if (player.shootTimer > 0) player.shootTimer -= dt;
  if (player.muzzleFlash > 0) player.muzzleFlash -= dt;
  if (player.weaponKick > 0) player.weaponKick -= dt * 0.3;
  if (player.damageFlash > 0) player.damageFlash -= dt;
  // Spread decay (multiplicative — fast snap back to tight when idle)
  if (player.spread > 0) {
    player.spread *= Math.pow(0.88, dt);
    if (player.spread < 0.05) player.spread = 0;
  }
}

function fireWeapon(player, shootAudio, masterVolume) {
  player.ammo--;
  player.shootTimer = player.shootCooldown;
  player.muzzleFlash = 4;
  player.weaponKick = 6;
  player.spread = Math.min(14, (player.spread || 0) + 4);
  shootAudio.currentTime = 0;
  shootAudio.volume = 0.5 * masterVolume;
  shootAudio.play().catch(() => {});
}

// --- Input System Setup ---
// Sets up pointer lock, keyboard, mouse look. Returns a cleanup function.
// opts: { gameCanvas, container, player, getKeys, setKeys, isPaused, onPause, onResume, onTab }
function setupInput(opts) {
  const { gameCanvas, container, player } = opts;
  const MAX_PITCH = RENDER_H * 0.75;

  document.addEventListener('keydown', function _kd(e) {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (opts.shouldIgnoreInput && opts.shouldIgnoreInput()) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (opts.onEscape) opts.onEscape(e);
      return;
    }
    if (opts.isPaused && opts.isPaused()) return;
    if (e.code === 'Tab') { if (opts.onTab) opts.onTab(); return; }
    opts.getKeys()[e.code] = true;
  }, true);

  document.addEventListener('keyup', function _ku(e) {
    opts.getKeys()[e.code] = false;
  }, true);

  document.addEventListener('mousemove', function _mm(e) {
    if (opts.shouldIgnoreMouseMove && opts.shouldIgnoreMouseMove()) return;
    if (document.pointerLockElement === gameCanvas) {
      player.angle += e.movementX * player.rotSpeed;
      player.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH,
        player.pitch - e.movementY * player.rotSpeed * 450));
    } else if (opts.useFallbackMouse) {
      // Fallback mode for SP
      if (opts._lastClientX !== undefined && opts._lastClientX !== null) {
        const dx = e.clientX - opts._lastClientX;
        const dy = e.clientY - opts._lastClientY;
        player.angle += dx * player.rotSpeed;
        player.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH,
          player.pitch - dy * player.rotSpeed * 450));
      }
      opts._lastClientX = e.clientX;
      opts._lastClientY = e.clientY;
    }
  }, true);

  document.addEventListener('mousedown', function _md(e) {
    if (opts.onMouseDown) {
      opts.onMouseDown(e);
    } else {
      if (opts.shouldIgnoreMouseMove && opts.shouldIgnoreMouseMove()) return;
      player.shooting = true;
    }
  }, true);

  document.addEventListener('mouseup', function _mu() {
    player.shooting = false;
  }, true);
}

// --- Phaser Init Helper ---
// Creates the Phaser game with the render canvas and returns { game, renderTex }
function initPhaser(parentId, createCallback, updateCallback) {
  const config = {
    type: Phaser.CANVAS,
    width: SCREEN_W, height: SCREEN_H,
    parent: parentId,
    backgroundColor: '#000000',
    scene: { preload: function(){}, create: createCallback, update: updateCallback },
    audio: { noAudio: true },
    banner: false,
    fps: { target: 60, forceSetTimeOut: false },
    render: { pixelArt: true, antialias: false },
  };
  return new Phaser.Game(config);
}

// Called inside Phaser create() to set up the offscreen render canvas
function initRenderCanvas(phaserScene) {
  wallTextures = generateTextures();

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = RENDER_W; renderCanvas.height = RENDER_H;
  renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
  depthBuffer = new Float32Array(RENDER_W);

  phaserScene.textures.addCanvas('render', renderCanvas);
  const renderTex = phaserScene.add.image(SCREEN_W / 2, SCREEN_H / 2, 'render');
  renderTex.setDisplaySize(SCREEN_W, SCREEN_H);

  try { phaserScene.input.mouse.enabled = false; } catch(e) {}

  return renderTex;
}

// --- Commit frame ---
function commitFrame(phaserScene) {
  renderCtx.putImageData(frameImgData, 0, 0);
}

function updatePhaserTexture(phaserScene) {
  phaserScene.textures.get('render').update();
}

// --- Smooth Interpolation Utilities (for MP) ---

// Frame-rate independent exponential interpolation.
// smoothing: how much to smooth per "reference frame" (e.g. 0.15 = 85% smoothed per 16.6ms)
// dt: delta time normalized to 16.6ms (i.e., delta / 16.666)
function smoothLerp(current, target, smoothing, dt) {
  // At 60fps dt=1, at 120fps dt=0.5, at 30fps dt=2
  // This ensures identical visual results regardless of frame rate
  return current + (target - current) * (1 - Math.pow(1 - smoothing, dt));
}

// Frame-rate independent angle interpolation (handles wrap-around)
function smoothLerpAngle(current, target, smoothing, dt) {
  let diff = target - current;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return current + diff * (1 - Math.pow(1 - smoothing, dt));
}

// Hermite interpolation for smoother curves between network updates.
// Uses position + estimated velocity for cubic interpolation.
// t: progress 0-1 between prev and target
// p0, p1: positions, v0, v1: velocities
function hermite(t, p0, p1, v0, v1) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2*t3 - 3*t2 + 1;
  const h10 = t3 - 2*t2 + t;
  const h01 = -2*t3 + 3*t2;
  const h11 = t3 - t2;
  return h00*p0 + h10*v0 + h01*p1 + h11*v1;
}

// --- Escape HTML utility ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Export as global Engine namespace ---
window.Engine = {
  // Constants
  SCREEN_W, SCREEN_H, RENDER_W, RENDER_H, TEX_SIZE,
  FOV, HALF_FOV, NUM_RAYS, MAX_DEPTH, BASE_ROT_SPEED,
  MAP, MAP_W, MAP_H,

  // State accessors
  getRenderCtx: () => renderCtx,
  getDepthBuffer: () => depthBuffer,
  getFrameImgData: () => frameImgData,
  getWallTextures: () => wallTextures,

  // Generation
  generateTextures,
  getSpriteDir,
  generateDirectionalSprites,

  // Rendering
  castRays,
  renderSprites,
  renderProjectiles,
  renderWeapon,
  renderHUD,
  renderMinimap,
  commitFrame,
  updatePhaserTexture,

  // Game logic
  hasLineOfSight,
  handleMovement,
  tickShootingVisuals,
  fireWeapon,

  // Setup
  initPhaser,
  initRenderCanvas,
  setupInput,

  // Interpolation (MP)
  smoothLerp,
  smoothLerpAngle,
  hermite,

  // Utility
  escapeHtml,
};
