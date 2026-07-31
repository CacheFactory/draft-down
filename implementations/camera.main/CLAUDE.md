# Main Camera

## Identity
- **ID**: `camera.main`
- **Kind**: camera
- **Layer**: rendering

## Purpose

The Main Camera is the viewport's viewpoint into the 3D scene. It provides native orbital navigation, projection switching (perspective/orthographic), standard view presets, and smooth animated transitions. The camera maintains an orbit center that updates based on user interaction with geometry, and supports view history for undo/redo of navigation states.

## Responsibilities

### Camera State Management
- Maintain current camera position, target (orbit center), up vector, field of view, clipping planes, and projection mode
- Expose perspective camera with 45° FOV, near plane at 0.1, far plane at 10,000
- Support switching between perspective and orthographic projection
- Track and update orbit center based on geometry interaction (defaults to scene center)

### Navigation Operations
- **Orbit**: Rotate camera around the orbit center (azimuth and elevation)
- **Pan**: Translate camera and orbit center in screen-space
- **Zoom**: Scale view toward the 3D point under the cursor (not just forward/back along view direction)
- **Dolly**: Move camera along its forward vector

### Standard Views
- Provide named view presets: `front`, `back`, `left`, `right`, `top`, `bottom`, `iso`
- Animate smooth transitions between views using slerp for rotation and lerp for position
- Support `zoomExtents` to frame a bounding box
- Support `zoomToSelection` to frame specific entities

### View History
- Maintain undo/redo stack of camera states
- Push current view state when user performs significant navigation
- Restore previous/next view states on undo/redo

### Screen-World Conversion
- Convert screen coordinates (pixels) to world-space positions
- Convert world positions to screen coordinates with depth
- Generate rays from screen coordinates for picking and snapping

### Configuration
- Allow adjustment of orbit speed, pan speed, zoom speed
- Enforce minimum and maximum camera distance from target
- Configure animation duration and easing curves

## API Surface

### TypeScript Interface

```typescript
export type CameraProjection = 'perspective' | 'orthographic';
export type StandardView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

export interface CameraState {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  fov: number;
  orthoScale: number;
  projection: CameraProjection;
  near: number;
  far: number;
}

export interface CameraAnimationOptions {
  duration: number; // milliseconds, default 300
  easing: 'linear' | 'ease-in-out' | 'ease-out'; // default 'ease-in-out'
}

export interface ICameraController {
  // State access
  getState(): CameraState;
  setState(state: Partial<CameraState>, animate?: boolean): void;
  getThreeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera;

  // Navigation
  orbit(deltaAzimuth: number, deltaElevation: number): void;
  pan(deltaX: number, deltaY: number): void;
  zoom(delta: number, cursorWorldPos?: Vector3): void;
  dolly(distance: number): void;

  // Standard views
  setStandardView(view: StandardView, animate?: boolean): void;
  zoomExtents(boundingBox: THREE.Box3, animate?: boolean): void;
  zoomToSelection(entities: any[], animate?: boolean): void;

  // Projection
  setProjection(projection: CameraProjection, animate?: boolean): void;
  toggleProjection(): void;

  // FOV
  setFOV(degrees: number): void;
  getFOV(): number;

  // View history
  pushViewState(): void;
  undoView(): void;
  redoView(): void;

  // Screen ↔ World
  screenToWorld(screenX: number, screenY: number, depth?: number): Vector3;
  worldToScreen(worldPos: Vector3): { x: number; y: number; depth: number };
  screenToRay(screenX: number, screenY: number): { origin: Vector3; direction: Vector3 };

  // Configuration
  setOrbitSpeed(speed: number): void;
  setPanSpeed(speed: number): void;
  setZoomSpeed(speed: number): void;
  setMinDistance(distance: number): void;
  setMaxDistance(distance: number): void;
}
```

## Dependencies

### Consumes
- **Middle Mouse Drag** (`gesture.middle_drag`): Triggers orbit operation based on pointer delta
- **Shift + Middle Mouse Drag** (`gesture.shift_middle_drag`): Triggers pan operation based on pointer delta
- **Scroll Wheel Gesture** (`gesture.scroll`): Triggers zoom operation with delta and cursor world position

### Used By
- **Main 3D Viewport** (`viewport.main`): Reads camera matrices for rendering, provides viewport dimensions for aspect ratio and screen-space calculations
- **Visual Regression Tests** (`test.visual.rendering`): Sets known camera states and standard views to capture deterministic test renders

## Data

### Read
- Viewport dimensions (width, height in pixels) from `viewport.main` for aspect ratio calculation
- Scene bounding box or entity bounds for zoom extents operations
- 3D cursor/intersection points from geometry picking for orbit center updates and zoom targeting

### Write
- Camera transformation matrices (view and projection) consumed by Three.js renderer
- View state history stack (in-memory only, no persistence required for MVP)

## Behavioral Constraints

### DraftDown-Style Orbit Behavior
- Orbit center must update to the last clicked 3D point on geometry (if available)
- If no geometry is hit, orbit center defaults to scene center
- Vertical orbit has soft limits to prevent camera flipping over poles
- Orbit wraps horizontally (azimuth) without limits

### Zoom Behavior
- Zoom must target the 3D point under the cursor, not just move forward/back
- If cursor is not over geometry, zoom toward orbit center
- Zoom speed should feel consistent regardless of distance from target

### Pan Behavior
- Pan speed scales with distance from orbit center (closer = slower, farther = faster)
- Pan operates in screen space (horizontal and vertical pixel deltas)

### Animation
- Transitions between views use slerp for rotation and lerp for position
- Default animation duration is 300ms with ease-in-out easing
- Animations can be disabled for immediate state changes

### Distance Limits
- Enforce minimum distance from orbit center (prevent camera from passing through target)
- Enforce maximum distance (prevent excessive zoom-out)

## Security & Trust

- **Data Classification**: No sensitive data — camera state is transient viewport information
- **Trust Boundaries**: Trusts gesture input events and viewport dimensions from rendering layer; no external network calls or user-controlled file I/O

## Framework & Tooling

- **Language**: TypeScript
- **Framework**: Three.js (provides `THREE.PerspectiveCamera`, `THREE.OrthographicCamera`, matrix utilities)
- **Math Types**: `Vector3` from `../math/types` (shared math utilities)

## Complexity

Moderate — camera logic involves geometric transformations, smooth interpolation, and coordination between multiple input gestures. The orbit center update and zoom-toward-cursor behavior require careful ray-world intersection handling.

---

**Related Components:**
- `../viewport.main/` — consumes camera for rendering
- `../test.visual.rendering/` — sets camera states for test captures