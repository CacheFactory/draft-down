// @archigraph data.materials
// Procedural texture generator — creates canvas-based textures as data URLs
// for common building materials without requiring external image files.

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function generateTexture(width: number, height: number, draw: DrawFn): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, width, height);
  return canvas.toDataURL('image/png');
}

// Simulate noise with many semi-transparent random rectangles (no getImageData)
function noise(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number, baseColor: string) {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, w, h);
  const step = 4;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const n = (Math.random() - 0.5) * intensity;
      const alpha = Math.abs(n) / 255;
      ctx.fillStyle = n > 0 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, y, step, step);
    }
  }
}

// ─── Brick ───────────────────────────────────────────────────────

function drawBrick(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const mortarColor = '#b0a090';
  const brickColors = ['#8b4513', '#a0522d', '#7a3b10', '#944a1a', '#6b3410'];
  const brickH = h / 8;
  const brickW = w / 4;
  const mortar = 3;

  ctx.fillStyle = mortarColor;
  ctx.fillRect(0, 0, w, h);

  for (let row = 0; row < 8; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 5; col++) {
      const x = col * brickW + offset + mortar / 2;
      const y = row * brickH + mortar / 2;
      ctx.fillStyle = brickColors[Math.floor(Math.random() * brickColors.length)];
      ctx.fillRect(x, y, brickW - mortar, brickH - mortar);
      // Subtle per-brick variation using overlaid semi-transparent noise
      ctx.globalAlpha = 0.08;
      for (let ny = 0; ny < brickH - mortar; ny += 4) {
        for (let nx = 0; nx < brickW - mortar; nx += 4) {
          ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
          ctx.fillRect(x + nx, y + ny, 4, 4);
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}

// ─── Wood ────────────────────────────────────────────────────────

function drawWood(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Base color
  ctx.fillStyle = '#b8860b';
  ctx.fillRect(0, 0, w, h);

  // Horizontal bands
  for (let y = 0; y < h; y++) {
    const lightness = Math.sin(y * 0.15) * 15 + Math.sin(y * 0.4 + 2) * 8 + (Math.random() - 0.5) * 10;
    const r = Math.max(0, Math.min(255, Math.round(160 + lightness)));
    const g = Math.max(0, Math.min(255, Math.round(110 + lightness * 0.7)));
    const b = Math.max(0, Math.min(255, Math.round(50 + lightness * 0.3)));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, w, 1);
  }

  // Grain lines
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 12; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = '#4a2800';
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    ctx.moveTo(0, y);
    let cy = y;
    for (let x = 0; x < w; x += 5) {
      cy += (Math.random() - 0.5) * 2;
      ctx.lineTo(x, cy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ─── Concrete ────────────────────────────────────────────────────

function drawConcrete(ctx: CanvasRenderingContext2D, w: number, h: number) {
  noise(ctx, w, h, 30, '#a0a0a0');
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 15; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#666' : '#bbb';
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 10 + Math.random() * 30;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── Metal (brushed steel) ───────────────────────────────────────

function drawMetal(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#c8c8c8');
  gradient.addColorStop(0.5, '#d8d8d8');
  gradient.addColorStop(1, '#b8b8b8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = 0.06;
  for (let y = 0; y < h; y++) {
    ctx.strokeStyle = Math.random() > 0.5 ? '#fff' : '#999';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y + (Math.random() - 0.5));
    ctx.lineTo(w, y + (Math.random() - 0.5));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ─── Glass ───────────────────────────────────────────────────────

function drawGlass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const gradient = ctx.createLinearGradient(0, 0, w * 0.7, h);
  gradient.addColorStop(0, '#a0c8e8');
  gradient.addColorStop(0.4, '#c8e0f0');
  gradient.addColorStop(1, '#90b8d8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(w * 0.2, 0);
  ctx.lineTo(w * 0.35, 0);
  ctx.lineTo(w * 0.15, h);
  ctx.lineTo(w * 0.0, h);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ─── Stone ───────────────────────────────────────────────────────

function drawStone(ctx: CanvasRenderingContext2D, w: number, h: number) {
  noise(ctx, w, h, 25, '#8a8a7a');

  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const size = 15 + Math.random() * 40;
    ctx.fillStyle = Math.random() > 0.5 ? '#6a6a5a' : '#9a9a8a';
    ctx.beginPath();
    const pts = 5 + Math.floor(Math.random() * 4);
    for (let p = 0; p < pts; p++) {
      const angle = (p / pts) * Math.PI * 2;
      const r = size * (0.6 + Math.random() * 0.4);
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── Tile ────────────────────────────────────────────────────────

function drawTile(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const groutColor = '#c0b8b0';
  const tileSize = w / 4;
  const grout = 2;

  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, w, h);

  for (let row = 0; row < Math.ceil(h / tileSize); row++) {
    for (let col = 0; col < Math.ceil(w / tileSize); col++) {
      const x = col * tileSize + grout / 2;
      const y = row * tileSize + grout / 2;
      const v = (Math.random() - 0.5) * 10;
      ctx.fillStyle = `rgb(${Math.round(240 + v)},${Math.round(236 + v)},${Math.round(229 + v)})`;
      ctx.fillRect(x, y, tileSize - grout, tileSize - grout);
    }
  }
}

// ─── Grass ───────────────────────────────────────────────────────

function drawGrass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  noise(ctx, w, h, 30, '#4a8c3f');

  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 4 + Math.random() * 8;
    const lean = (Math.random() - 0.5) * 4;
    ctx.strokeStyle = Math.random() > 0.3 ? '#3a7030' : '#5aa04a';
    ctx.lineWidth = 0.5 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lean, y - len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ─── Asphalt ─────────────────────────────────────────────────────

function drawAsphalt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  noise(ctx, w, h, 20, '#3a3a3a');

  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 0.5 + Math.random() * 1.5;
    ctx.fillStyle = Math.random() > 0.5 ? '#555' : '#2a2a2a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── Plaster ─────────────────────────────────────────────────────

function drawPlaster(ctx: CanvasRenderingContext2D, w: number, h: number) {
  noise(ctx, w, h, 12, '#e8e0d4');
}

// ─── Roof Shingle ────────────────────────────────────────────────

function drawShingle(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(0, 0, w, h);

  const shingleH = h / 6;
  const shingleW = w / 4;

  for (let row = 0; row < 7; row++) {
    const offset = row % 2 === 0 ? 0 : shingleW / 2;
    for (let col = -1; col < 5; col++) {
      const x = col * shingleW + offset;
      const y = row * shingleH;
      const v = (Math.random() - 0.5) * 15;
      ctx.fillStyle = `rgb(${Math.round(65 + v)},${Math.round(60 + v)},${Math.round(55 + v)})`;
      ctx.beginPath();
      ctx.moveTo(x, y + shingleH);
      ctx.lineTo(x + shingleW * 0.5, y);
      ctx.lineTo(x + shingleW, y + shingleH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

// ─── Export: generate all building material definitions ───────────

export interface BuiltinMaterial {
  name: string;
  color: { r: number; g: number; b: number; a?: number };
  opacity: number;
  roughness: number;
  metalness: number;
  albedoMap: string;
}

export function generateBuiltinMaterials(): BuiltinMaterial[] {
  const size = 64;
  return [
    {
      name: 'Brick',
      color: { r: 0.7, g: 0.35, b: 0.15 },
      opacity: 1, roughness: 0.85, metalness: 0,
      albedoMap: generateTexture(size, size, drawBrick),
    },
    {
      name: 'Wood',
      color: { r: 0.72, g: 0.53, b: 0.2 },
      opacity: 1, roughness: 0.6, metalness: 0,
      albedoMap: generateTexture(size, size, drawWood),
    },
    {
      name: 'Concrete',
      color: { r: 0.63, g: 0.63, b: 0.63 },
      opacity: 1, roughness: 0.9, metalness: 0,
      albedoMap: generateTexture(size, size, drawConcrete),
    },
    {
      name: 'Metal',
      color: { r: 0.78, g: 0.78, b: 0.78 },
      opacity: 1, roughness: 0.3, metalness: 0.8,
      albedoMap: generateTexture(size, size, drawMetal),
    },
    {
      name: 'Glass',
      color: { r: 0.63, g: 0.78, b: 0.91 },
      opacity: 0.4, roughness: 0.05, metalness: 0.1,
      albedoMap: generateTexture(size, size, drawGlass),
    },
    {
      name: 'Stone',
      color: { r: 0.54, g: 0.54, b: 0.48 },
      opacity: 1, roughness: 0.85, metalness: 0,
      albedoMap: generateTexture(size, size, drawStone),
    },
    {
      name: 'Tile',
      color: { r: 0.94, g: 0.93, b: 0.9 },
      opacity: 1, roughness: 0.4, metalness: 0,
      albedoMap: generateTexture(size, size, drawTile),
    },
    {
      name: 'Grass',
      color: { r: 0.29, g: 0.55, b: 0.25 },
      opacity: 1, roughness: 0.9, metalness: 0,
      albedoMap: generateTexture(size, size, drawGrass),
    },
    {
      name: 'Asphalt',
      color: { r: 0.23, g: 0.23, b: 0.23 },
      opacity: 1, roughness: 0.95, metalness: 0,
      albedoMap: generateTexture(size, size, drawAsphalt),
    },
    {
      name: 'Plaster',
      color: { r: 0.91, g: 0.88, b: 0.83 },
      opacity: 1, roughness: 0.8, metalness: 0,
      albedoMap: generateTexture(size, size, drawPlaster),
    },
    {
      name: 'Roof Shingle',
      color: { r: 0.28, g: 0.26, b: 0.24 },
      opacity: 1, roughness: 0.85, metalness: 0,
      albedoMap: generateTexture(size, size, drawShingle),
    },
  ];
}
