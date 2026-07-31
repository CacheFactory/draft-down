// @archigraph tool.base
// classic-CAD-style tool cursors: small SVG glyphs with a crosshair-ish hotspot.
// Each is a CSS cursor value with a built-in fallback.

function svgCursor(svg: string, hotX: number, hotY: number, fallback: string): string {
  const encoded = encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
  return `url('data:image/svg+xml;utf8,${encoded}') ${hotX} ${hotY}, ${fallback}`;
}

const STROKE = `stroke="#111" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
const WHITE = `stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"`;

/** Pencil — line/freehand drawing. Hotspot at the tip (bottom-left). */
export const CURSOR_PENCIL = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M4 20 L6 14 L16 4 L20 8 L10 18 Z" ${WHITE}/>
    <path d="M4 20 L6 14 L16 4 L20 8 L10 18 Z" ${STROKE}/>
    <path d="M6 14 L10 18" ${STROKE}/>
  </svg>`, 4, 20, 'crosshair');

/** Paint bucket. Hotspot at the pour point. */
export const CURSOR_PAINT = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M5 12 L12 5 L19 12 L12 19 Z" ${WHITE}/>
    <path d="M5 12 L12 5 L19 12 L12 19 Z" ${STROKE}/>
    <path d="M12 5 L12 2" ${STROKE}/>
    <path d="M20 16 q1.6 2.6 0 4 q-1.6 1.4-3 0 q-1.4-2.6 1.5-5 Z" stroke="#111" stroke-width="1.2" fill="#fff"/>
  </svg>`, 12, 12, 'pointer');

/** Eraser block. Hotspot at the rubbing corner. */
export const CURSOR_ERASER = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M4 16 L12 8 L20 16 L14 22 L8 22 Z" ${WHITE}/>
    <path d="M4 16 L12 8 L20 16 L14 22 L8 22 Z" ${STROKE}/>
    <path d="M8 12 L16 20" ${STROKE}/>
  </svg>`, 4, 18, 'pointer');

/** Push/Pull — box with an up arrow. Hotspot center. */
export const CURSOR_PUSHPULL = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M6 14 L12 11 L18 14 L12 17 Z M6 14 L6 19 L12 22 L18 19 L18 14 M12 17 L12 22" ${WHITE}/>
    <path d="M6 14 L12 11 L18 14 L12 17 Z M6 14 L6 19 L12 22 L18 19 L18 14 M12 17 L12 22" ${STROKE}/>
    <path d="M12 9 L12 2 M9 5 L12 2 L15 5" ${WHITE}/>
    <path d="M12 9 L12 2 M9 5 L12 2 L15 5" ${STROKE}/>
  </svg>`, 12, 12, 'ns-resize');

/** Rotate — circular arrows. Hotspot center. */
export const CURSOR_ROTATE = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M19 12 a7 7 0 1 1 -2.05 -4.95" ${WHITE}/>
    <path d="M19 12 a7 7 0 1 1 -2.05 -4.95" ${STROKE}/>
    <path d="M17 2 L17 7 L12 7" ${WHITE}/>
    <path d="M17 2 L17 7 L12 7" ${STROKE}/>
  </svg>`, 12, 12, 'crosshair');

/** Tape measure. Hotspot at the lead point. */
export const CURSOR_TAPE = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <circle cx="14" cy="10" r="6" ${WHITE}/>
    <circle cx="14" cy="10" r="6" ${STROKE}/>
    <circle cx="14" cy="10" r="2" ${STROKE}/>
    <path d="M9 15 L3 21 M3 21 L3 17 M3 21 L7 21" ${WHITE}/>
    <path d="M9 15 L3 21 M3 21 L3 17 M3 21 L7 21" ${STROKE}/>
  </svg>`, 3, 21, 'crosshair');

/** Four-way move arrows. Hotspot center. */
export const CURSOR_MOVE = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M12 2 L12 22 M2 12 L22 12 M12 2 L9.5 5 M12 2 L14.5 5 M12 22 L9.5 19 M12 22 L14.5 19 M2 12 L5 9.5 M2 12 L5 14.5 M22 12 L19 9.5 M22 12 L19 14.5" ${WHITE}/>
    <path d="M12 2 L12 22 M2 12 L22 12 M12 2 L9.5 5 M12 2 L14.5 5 M12 22 L9.5 19 M12 22 L14.5 19 M2 12 L5 9.5 M2 12 L5 14.5 M22 12 L19 9.5 M22 12 L19 14.5" ${STROKE}/>
  </svg>`, 12, 12, 'move');

/** Scale — diagonal corner arrows. Hotspot center. */
export const CURSOR_SCALE = svgCursor(`
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M4 20 L20 4 M4 20 L4 14 M4 20 L10 20 M20 4 L14 4 M20 4 L20 10" ${WHITE}/>
    <path d="M4 20 L20 4 M4 20 L4 14 M4 20 L10 20 M20 4 L14 4 M20 4 L20 10" ${STROKE}/>
  </svg>`, 12, 12, 'nwse-resize');
