// DraftDown Stairs Builder plugin.
//
// Two styles, picked from the "Style" field:
//
//   multi-flight (default) — any number of straight flights chained together with
//     optional L (90°) or U (180°) landing turns between them. Add / remove flights
//     dynamically; per-flight settings: number of steps, turn after this flight,
//     landing depth.
//
//   spiral — N pie-shaped treads sweeping around a central axis. Single continuous
//     run, no landings.
//
// All work commits in one undo step.

(function () {
  'use strict';

  const PARAMS_ID = 'com.draftdown.stairs';
  const STATE_KEY = 'draftdown:com.draftdown.stairs:state';

  // ─── Plugin-local flight state (rebuilt into the panel every refresh) ──

  let flights = [{ id: 0, steps: 12, turnAfter: 'none', landingDepth: 0 }];
  let nextFlightId = 1;

  // ─── Persistent values across tool activations ──
  // Stored in localStorage so the panel reopens with the user's last-entered
  // values for every field (including dynamic flight fields and flight layout).

  function loadSavedState() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch (e) {
      console.warn('[Stairs] loadSavedState failed:', e);
      return null;
    }
  }

  function saveCurrentState() {
    try {
      if (typeof localStorage === 'undefined') return;
      syncFlightsFromPanel();
      const values = UI.parameters.values(PARAMS_ID) || {};
      const state = {
        values,
        flights: flights.map(f => ({ ...f })),
        nextFlightId,
        version: 1,
      };
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[Stairs] saveCurrentState failed:', e);
    }
  }

  function syncFlightsFromPanel() {
    const v = UI.parameters.values(PARAMS_ID);
    if (!v) return;
    for (const f of flights) {
      if (v[`f${f.id}_steps`] !== undefined) f.steps = Math.max(1, Math.floor(+v[`f${f.id}_steps`] || 1));
      if (v[`f${f.id}_turn`] !== undefined) f.turnAfter = String(v[`f${f.id}_turn`]);
      if (v[`f${f.id}_land`] !== undefined) f.landingDepth = Math.max(0, +v[`f${f.id}_land`] || 0);
    }
  }

  function addFlight() {
    syncFlightsFromPanel();
    // The previously-last flight should have a turn set so the new flight makes sense.
    const last = flights[flights.length - 1];
    if (last && last.turnAfter === 'none') last.turnAfter = 'L-right';
    flights.push({ id: nextFlightId++, steps: 6, turnAfter: 'none', landingDepth: 0 });
    refreshPanel();
  }

  function removeFlight(id) {
    if (flights.length <= 1) return;
    syncFlightsFromPanel();
    const i = flights.findIndex(f => f.id === id);
    if (i >= 0) flights.splice(i, 1);
    // The new last flight must end the staircase — no further turn.
    flights[flights.length - 1].turnAfter = 'none';
    refreshPanel();
  }

  function totalSteps() { return flights.reduce((sum, f) => sum + Math.max(1, f.steps), 0); }

  // ─── Unit handling ─────────────────────────────────────────────────
  // The plugin authors numbers in METERS internally. The Parameters panel
  // shows them in the project's chosen unit ('mm' | 'cm' | 'm' | 'inches' | 'feet').
  // Defaults are converted out via toDisplay() and user input is converted
  // back via toInternal() before geometry is built.

  function projectUnit() {
    try { return DraftDown.activeModel.units || 'm'; } catch (e) { return 'm'; }
  }
  /** Round a display-unit value to a sensible precision for that unit. */
  function roundForDisplay(value, unit) {
    const decimals = unit === 'mm' ? 0 : unit === 'cm' ? 1 : unit === 'inches' ? 2 : unit === 'feet' ? 3 : 3;
    const f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
  }
  function unitLabel(unit) {
    return ({ mm: 'mm', cm: 'cm', m: 'm', inches: 'in', feet: 'ft' })[unit] || unit;
  }
  function defaultStep(unit) {
    return ({ mm: 1, cm: 0.5, m: 0.05, inches: 0.25, feet: 0.05 })[unit] ?? 0.05;
  }
  function fineStep(unit) {
    return ({ mm: 1, cm: 0.1, m: 0.005, inches: 0.0625, feet: 0.005 })[unit] ?? 0.005;
  }
  /** Convert meters → display unit, rounded for the unit. */
  function toUI(meters) { return roundForDisplay(DraftDown.activeModel.toDisplay(meters), projectUnit()); }
  /** Convert display-unit value back to meters. */
  function toMeters(displayValue) { return DraftDown.activeModel.toInternal(displayValue); }

  // ─── Parameters schema ─────────────────────────────────────────────

  function paramSchema() {
    const N = totalSteps();
    const u = projectUnit();
    const ul = unitLabel(u);
    const stepCoarse = defaultStep(u);
    const stepFine = fineStep(u);
    const fields = [
      { kind: 'header', text: `Dimensions (${ul})` },
      { kind: 'number',  key: 'totalHeight',    label: 'Total Height',    default: toUI(2.7),   min: toUI(0.05), step: stepCoarse, unit: ul,
        help: `Floor-to-floor height. Riser = total height ÷ total steps. (Total steps now: ${N})` },
      { kind: 'number',  key: 'width',          label: 'Width',           default: toUI(1.0),   min: toUI(0.1),  step: stepCoarse, unit: ul },
      { kind: 'number',  key: 'treadDepth',     label: 'Tread Depth',     default: toUI(0.28),  min: toUI(0.05), step: stepFine,   unit: ul },
      { kind: 'number',  key: 'noseLength',     label: 'Nose Length',     default: toUI(0.025), min: 0,          step: stepFine,   unit: ul },
      { kind: 'number',  key: 'treadThickness', label: 'Tread Thickness', default: 0,           min: 0,          step: stepFine,   unit: ul,
        help: 'Set > 0 for slab-style treads with an underside.' },
      { kind: 'boolean', key: 'topIsRiser',    label: 'Top is Riser (omit top tread)', default: false,
        help: 'End the staircase at the top of the final riser — the floor above acts as the top tread. Applies to the last flight only.' },

      { kind: 'separator' },
      { kind: 'header', text: 'Style' },
      { kind: 'select', key: 'style', label: 'Style', default: 'multi-flight', options: [
        { label: 'Multi-flight (straight runs + landings)', value: 'multi-flight' },
        { label: 'Spiral (winder, no landing)',             value: 'spiral' },
      ]},
    ];

    // Multi-flight specifics
    fields.push({ kind: 'separator' });
    fields.push({ kind: 'header', text: `Position (multi-flight, ${ul})` });
    fields.push({ kind: 'vec3',   key: 'origin',    label: 'Origin', default: { x: 0, y: 0, z: 0 }, unit: ul });
    fields.push({ kind: 'select', key: 'direction', label: 'Initial Climb Direction', default: '+x', options: [
      { label: '+X', value: '+x' }, { label: '-X', value: '-x' },
      { label: '+Z', value: '+z' }, { label: '-Z', value: '-z' },
    ]});

    fields.push({ kind: 'separator' });
    fields.push({ kind: 'header', text: `Flights — ${flights.length} (${N} steps total)` });
    flights.forEach((f, idx) => {
      fields.push({ kind: 'header', text: `▸ Flight ${idx + 1}` });
      fields.push({
        kind: 'integer', key: `f${f.id}_steps`, label: 'Steps', default: f.steps, min: 1, max: 200,
      });
      const isLast = idx === flights.length - 1;
      if (!isLast) {
        fields.push({
          kind: 'select', key: `f${f.id}_turn`, label: 'Turn after this flight', default: f.turnAfter, options: [
            { label: 'None (continue straight — no landing)', value: 'none' },
            { label: 'L-90° turn left',  value: 'L-left' },
            { label: 'L-90° turn right', value: 'L-right' },
            { label: 'U-180° switchback (next run on left)',  value: 'U-left' },
            { label: 'U-180° switchback (next run on right)', value: 'U-right' },
          ],
        });
        fields.push({
          kind: 'number', key: `f${f.id}_land`, label: 'Landing Depth',
          default: f.landingDepth, // already in display units (sourced from panel)
          min: 0, step: stepCoarse, unit: ul,
          help: '0 = use stair width (square landing).',
        });
      }
      if (flights.length > 1) {
        fields.push({ kind: 'button', label: `Remove Flight ${idx + 1}`, onClick: () => removeFlight(f.id) });
      }
      fields.push({ kind: 'separator' });
    });
    fields.push({ kind: 'button', label: '+ Add Flight', onClick: addFlight });

    // Spiral specifics
    fields.push({ kind: 'separator' });
    fields.push({ kind: 'header', text: `Spiral options (${ul})` });
    fields.push({ kind: 'integer', key: 'spiralSteps',    label: 'Spiral Treads',  default: 16,  min: 3, max: 200 });
    fields.push({ kind: 'number',  key: 'innerRadius',    label: 'Inner Radius',   default: toUI(0.15), min: 0, step: stepCoarse, unit: ul });
    fields.push({ kind: 'number',  key: 'totalAngleDeg',  label: 'Sweep Angle',    default: 270, min: 30, max: 720, step: 5, unit: '°' });
    fields.push({ kind: 'select',  key: 'spiralDirection', label: 'Spiral Direction', default: 'right', options: [
      { label: 'Right (clockwise from above)',        value: 'right' },
      { label: 'Left (counter-clockwise from above)', value: 'left' },
    ]});

    // Output
    fields.push({ kind: 'separator' });
    fields.push({ kind: 'header', text: 'Output' });
    fields.push({ kind: 'boolean', key: 'asGroup', label: 'Wrap result as Group', default: true });
    fields.push({ kind: 'separator' });
    fields.push({ kind: 'button', label: 'Build Stairs', primary: true, onClick: buildStairs });

    return {
      id: PARAMS_ID,
      title: 'Stairs Builder',
      footer: `Project unit: ${ul}. Total steps: ${N}. Riser height = Total Height ÷ ${N}.`,
      fields,
    };
  }

  function refreshPanel() {
    const schema = paramSchema();
    const saved = loadSavedState();
    if (saved && saved.values && typeof saved.values === 'object') {
      schema.values = saved.values;
    }
    schema.onChange = () => { saveCurrentState(); };
    UI.parameters.show(schema);
  }

  function openPanel() {
    // Restore flight layout from a previous session if available.
    const saved = loadSavedState();
    if (saved && Array.isArray(saved.flights) && saved.flights.length > 0) {
      flights = saved.flights.map(f => ({
        id: typeof f.id === 'number' ? f.id : 0,
        steps: Math.max(1, Math.floor(+f.steps || 1)),
        turnAfter: String(f.turnAfter || 'none'),
        landingDepth: Math.max(0, +f.landingDepth || 0),
      }));
      const maxId = flights.reduce((m, f) => Math.max(m, f.id), -1);
      nextFlightId = Math.max(saved.nextFlightId || 0, maxId + 1);
    } else if (flights.length === 0) {
      flights = [{ id: 0, steps: 12, turnAfter: 'none', landingDepth: 0 }];
      nextFlightId = 1;
    }
    refreshPanel();
  }

  // ─── Geometry helpers ──────────────────────────────────────────────

  function buildProfile(N, D, riser, nose, treadThickness, baseHeight, omitTopTread) {
    const pts = [];
    const yBase = baseHeight;
    const top = (i) => yBase + i * riser;

    // When omitTopTread is true, the staircase ends at the top of the final
    // riser — the floor above acts as the top tread. Footprint along the climb
    // axis shrinks from N*D to (N-1)*D, and we step down from i=N-1 instead
    // of i=N. There are still N risers; only N-1 tread surfaces.
    const lastRiserX = omitTopTread ? (N - 1) * D : N * D;
    const startStep = omitTopTread ? N - 1 : N;

    if (treadThickness <= 0) {
      pts.push([-nose, yBase]);
      pts.push([lastRiserX, yBase]);
      pts.push([lastRiserX, top(N)]);
      // When omitting the top tread, drop straight down the final riser to the
      // back of the (N-1)th tread before stepping forward. Without this point
      // the profile would slope diagonally from the top corner straight to the
      // (N-1)th leading edge.
      if (omitTopTread && N >= 1) {
        pts.push([lastRiserX, top(N - 1)]);
      }
      for (let i = startStep; i >= 1; i--) {
        pts.push([(i - 1) * D - nose, top(i)]);
        if (i > 1) pts.push([(i - 1) * D - nose, top(i - 1)]);
      }
      return pts;
    }

    pts.push([-nose, yBase]);
    pts.push([lastRiserX, yBase]);
    pts.push([lastRiserX, top(N)]);
    if (omitTopTread && N >= 1) {
      // Top riser face: drop straight down from top(N) to top(N-1) at the back
      // of the (N-1)th tread (the underside of the floor above sits at top(N)
      // minus treadThickness in slab mode).
      const topRiserBottomY = top(N - 1);
      pts.push([lastRiserX, topRiserBottomY]);
      pts.push([lastRiserX - 0, topRiserBottomY]); // back of (N-1)th tread top
    }
    for (let i = startStep; i >= 1; i--) {
      const treadTop = top(i);
      const treadBottom = treadTop - treadThickness;
      pts.push([(i - 1) * D - nose, treadTop]);
      pts.push([(i - 1) * D - nose, treadBottom]);
      if (i > 1) {
        pts.push([(i - 1) * D, treadBottom]);
        pts.push([(i - 1) * D, top(i - 1)]);
      }
    }
    return pts;
  }

  function transformByFrame(p2, origin, climbDir, widthDir, widthOffset) {
    const lx = p2[0], ly = p2[1];
    return [
      origin.x + climbDir.x * lx + widthDir.x * widthOffset,
      origin.y + ly,
      origin.z + climbDir.z * lx + widthDir.z * widthOffset,
    ];
  }

  function climbVec(direction) {
    switch (direction) {
      case '+x': return { x:  1, y: 0, z:  0 };
      case '-x': return { x: -1, y: 0, z:  0 };
      case '+z': return { x:  0, y: 0, z:  1 };
      case '-z': return { x:  0, y: 0, z: -1 };
      default:   return { x:  1, y: 0, z:  0 };
    }
  }
  /** Width axis = up × climb. Up = (0,1,0). */
  function widthVec(climbDir) {
    return { x: -climbDir.z, y: 0, z: climbDir.x };
  }
  function rotateY(v, angleDeg) {
    const a = angleDeg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
  }

  function emitRun(m, opts, run) {
    const { D, nose, treadThickness, W } = opts;
    const climb = run.climbDir;
    const width = widthVec(climb);
    const profile2D = buildProfile(run.steps, D, opts.riser, nose, treadThickness, run.baseHeight, !!run.omitTopTread);
    const worldPts = profile2D.map(p2 => transformByFrame(p2, run.origin, climb, width, run.widthOffset));
    const pts = worldPts.map(([x, y, z]) => new Geom.Point3d(x, y, z));
    const face = m.entities.addFace(pts);
    const dot = face.normal.x * width.x + face.normal.y * width.y + face.normal.z * width.z;
    face.pushpull(dot >= 0 ? W : -W);
  }

  /**
   * landing = {
   *   origin, climbDir,
   *   widthOffset,   // along widthAxis where the back face of the slab sits
   *   widthSpan,     // total width of the landing along widthAxis (defaults to opts.W)
   *   depthAlongClimb, top, bottom,
   * }
   */
  function emitLanding(m, opts, landing) {
    const span = landing.widthSpan || opts.W;
    const climb = landing.climbDir;
    const width = widthVec(climb);
    const profile2D = [
      [-opts.nose, landing.bottom],
      [landing.depthAlongClimb, landing.bottom],
      [landing.depthAlongClimb, landing.top],
      [-opts.nose, landing.top],
    ];
    const worldPts = profile2D.map(p2 => transformByFrame(p2, landing.origin, climb, width, landing.widthOffset));
    const pts = worldPts.map(([x, y, z]) => new Geom.Point3d(x, y, z));
    const face = m.entities.addFace(pts);
    const dot = face.normal.x * width.x + face.normal.y * width.y + face.normal.z * width.z;
    face.pushpull(dot >= 0 ? span : -span);
  }

  function emitSpiral(m, opts) {
    const { N, D, treadThickness, W } = opts;
    void D;
    const innerR = opts.innerRadius;
    const outerR = innerR + W;
    const totalAngle = (opts.spiralDirection === 'left' ? +1 : -1) * opts.totalAngleDeg;
    const anglePer = totalAngle / N;

    for (let i = 0; i < N; i++) {
      const yBottom = i * opts.riser;
      const treadTop = (i + 1) * opts.riser;
      const treadBottom = treadThickness > 0 ? treadTop - treadThickness : yBottom;

      const a0 = anglePer * i;
      const a1 = anglePer * (i + 1);
      const segs = Math.max(2, Math.ceil(Math.abs(anglePer) / 5));
      const ringInner = [], ringOuter = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const a = (a0 + (a1 - a0) * t) * Math.PI / 180;
        const cx = Math.cos(a), cz = Math.sin(a);
        ringInner.push({ x: opts.origin.x + innerR * cx, z: opts.origin.z + innerR * cz });
        ringOuter.push({ x: opts.origin.x + outerR * cx, z: opts.origin.z + outerR * cz });
      }
      const footprint = [
        ...ringOuter.map(p => [p.x, treadTop, p.z]),
        ...[...ringInner].reverse().map(p => [p.x, treadTop, p.z]),
      ];
      const points = footprint.map(([x, y, z]) => new Geom.Point3d(x, y, z));
      const face = m.entities.addFace(points);
      const thickness = treadTop - treadBottom;
      if (thickness > 1e-6) {
        const dist = face.normal.y > 0 ? -thickness : thickness;
        face.pushpull(dist);
      }
    }
    if (innerR > 1e-4) {
      m.api_.createCylinder(
        { x: opts.origin.x, y: opts.origin.y, z: opts.origin.z },
        innerR,
        N * opts.riser,
        Math.max(12, Math.ceil(opts.totalAngleDeg / 15)),
      );
    }
  }

  // ─── Build dispatcher ───────────────────────────────────────────

  function buildStairs() {
    syncFlightsFromPanel();
    saveCurrentState();

    const v = UI.parameters.values(PARAMS_ID);
    if (!v) return;

    // All length-like values come in as display units; convert to meters for
    // the geometry engine. Step counts, angles, and direction strings stay raw.
    const H = toMeters(+v.totalHeight);
    const W = toMeters(+v.width);
    const D = toMeters(+v.treadDepth);
    const nose = toMeters(+v.noseLength);
    const treadThickness = toMeters(+v.treadThickness || 0);
    const direction = String(v.direction || '+x');
    const originUI = v.origin || { x: 0, y: 0, z: 0 };
    const origin = { x: toMeters(originUI.x), y: toMeters(originUI.y), z: toMeters(originUI.z) };
    const asGroup = v.asGroup !== false;
    const style = String(v.style || 'multi-flight');

    if (![H, W, D].every(Number.isFinite) || H <= 0 || W <= 0 || D <= 0) {
      UI.messagebox('Stairs Builder: please supply positive Total Height, Width, and Tread Depth.');
      return;
    }
    if (nose < 0 || nose >= D) {
      UI.messagebox('Nose Length must be ≥ 0 and less than Tread Depth.');
      return;
    }

    if (style === 'spiral') {
      const N = Math.max(3, Math.floor(+v.spiralSteps || 16));
      const riser = H / N;
      if (treadThickness >= riser) {
        UI.messagebox(`Tread Thickness must be less than the per-step riser height (${toUI(riser).toFixed(3)} ${unitLabel(projectUnit())}).`);
        return;
      }
      const opts = {
        N, D, riser, nose, treadThickness, W, origin,
        innerRadius: Math.max(0, toMeters(+v.innerRadius || 0)),
        totalAngleDeg: +v.totalAngleDeg || 270,
        spiralDirection: String(v.spiralDirection || 'right'),
      };
      runInTransaction(`Build Spiral Stairs (${N} treads)`, asGroup, () => {
        emitSpiral(DraftDown.activeModel, opts);
        return `Built spiral · ${N} treads · ${opts.totalAngleDeg}° sweep · inner ${toUI(opts.innerRadius)}${unitLabel(projectUnit())}`;
      });
      return;
    }

    // Multi-flight
    const N = totalSteps();
    if (N < 1) { UI.messagebox('Add at least one flight with at least one step.'); return; }
    const riser = H / N;
    if (treadThickness >= riser) {
      UI.messagebox(`Tread Thickness must be less than the per-step riser height (${toUI(riser).toFixed(3)} ${unitLabel(projectUnit())}).`);
      return;
    }
    const opts = { D, riser, nose, treadThickness, W };

    // Validate landing depths.
    for (let i = 0; i < flights.length - 1; i++) {
      const f = flights[i];
      if (f.turnAfter !== 'none' && f.landingDepth > 0 && f.landingDepth < W * 0.5) {
        // Allow but warn (very small landing). No-op for now.
      }
    }

    const topIsRiser = !!v.topIsRiser;
    runInTransaction(`Build Stairs (${flights.length} flights, ${N} steps)`, asGroup, () => {
      const m = DraftDown.activeModel;
      let climbDir = climbVec(direction);
      let runOrigin = { x: origin.x, y: origin.y, z: origin.z };
      let baseHeight = 0;
      const widthOffset = -W / 2; // center each run on its own width axis

      for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        const isLastFlight = i === flights.length - 1;
        emitRun(m, opts, {
          steps: f.steps, baseHeight, origin: runOrigin, climbDir, widthOffset,
          omitTopTread: isLastFlight && topIsRiser,
        });
        baseHeight += f.steps * riser;

        if (f.turnAfter === 'none') break;

        // f.landingDepth is in display units (came from the panel); convert.
        const landDepthM = toMeters(f.landingDepth);
        const landDepth = landDepthM > 0 ? landDepthM : W;
        const landingTop = baseHeight;
        const landingBottom = treadThickness > 0 ? landingTop - treadThickness : 0;
        const landingOrigin = {
          x: runOrigin.x + climbDir.x * (f.steps * D),
          y: runOrigin.y,
          z: runOrigin.z + climbDir.z * (f.steps * D),
        };

        // Compute the next run's frame and the landing footprint per turn type.
        // Conventions (Y up, right-handed): facing +X, my LEFT is -Z, my RIGHT is +Z.
        //   widthAxis = up × climbDir = (-climbDir.z, 0, climbDir.x)  // points to my RIGHT.
        //   For climbDir=+X, widthAxis = +Z. For climbDir=+Z, widthAxis = -X. Etc.
        const widthAxis = widthVec(climbDir);
        let nextClimb;
        // runOrigin offsets relative to landingOrigin, decomposed along (climbDir, widthAxis):
        let nextOffClimb = 0;     // along climbDir
        let nextOffWidth = 0;     // along widthAxis
        // Landing footprint along widthAxis:
        let landWidthSpan = W;
        let landWidthOffset = -W / 2; // back face of slab, by default centered like run A

        switch (f.turnAfter) {
          case 'L-left': {
            // New climb is to my LEFT (-widthAxis side). Run B sits OFF the landing on
            // the -widthAxis edge (its back is at the landing edge nearest the user).
            nextClimb = rotateY(climbDir, 90);                  // = -widthAxis direction
            nextOffClimb = landDepth - W / 2;                   // center run B's X span on the landing's far half
            nextOffWidth = -W / 2;                              // run B's back at the -widthAxis landing edge
            landWidthSpan = W; landWidthOffset = -W / 2;        // square landing the size of run A
            break;
          }
          case 'L-right': {
            nextClimb = rotateY(climbDir, -90);                 // = +widthAxis direction
            nextOffClimb = landDepth - W / 2;
            nextOffWidth = +W / 2;
            landWidthSpan = W; landWidthOffset = -W / 2;
            break;
          }
          case 'U-left': {
            // 180° switchback to the LEFT. Next run is offset one full W to -widthAxis
            // and climbs back toward the start. Landing must span both flights → 2W,
            // shifted to cover [-3W/2, +W/2] along widthAxis.
            nextClimb = rotateY(climbDir, 180);
            nextOffClimb = landDepth;                           // run B's back at the landing's far climb edge
            nextOffWidth = -W;                                  // run B center at -W
            landWidthSpan = 2 * W; landWidthOffset = -3 * W / 2;
            break;
          }
          case 'U-right': {
            nextClimb = rotateY(climbDir, 180);
            nextOffClimb = landDepth;
            nextOffWidth = +W;                                  // run B center at +W
            landWidthSpan = 2 * W; landWidthOffset = -W / 2;    // covers [-W/2, +3W/2]
            break;
          }
          default:
            nextClimb = climbDir;
        }

        // Emit the landing using the per-turn-type footprint.
        emitLanding(m, opts, {
          origin: landingOrigin, climbDir,
          widthOffset: landWidthOffset, widthSpan: landWidthSpan,
          depthAlongClimb: landDepth, top: landingTop, bottom: landingBottom,
        });

        // Place the next run.
        runOrigin = {
          x: landingOrigin.x + climbDir.x * nextOffClimb + widthAxis.x * nextOffWidth,
          y: landingOrigin.y,
          z: landingOrigin.z + climbDir.z * nextOffClimb + widthAxis.z * nextOffWidth,
        };
        climbDir = nextClimb;
      }

      const turns = flights.slice(0, -1).filter(f => f.turnAfter !== 'none').length;
      return `Built ${flights.length} flights · ${N} steps · ${turns} turn(s) · width ${toUI(W)}${unitLabel(projectUnit())}`;
    });
  }

  /** Wrap a build callback in startOperation/commitOperation + Group-wrapping. */
  function runInTransaction(opName, asGroup, fn) {
    const m = DraftDown.activeModel;
    const beforeFaceIds = new Set(m.entities.toArray()
      .filter(e => e.typename && e.typename() === 'Face').map(e => e.id));
    const beforeEdgeIds = new Set(m.entities.toArray()
      .filter(e => e.typename && e.typename() === 'Edge').map(e => e.id));

    m.startOperation(opName, true);
    try {
      const summary = fn() || opName;
      let groupId = null;
      if (asGroup) {
        const newEntities = m.entities.toArray().filter(e => {
          if (!e.typename) return false;
          const t = e.typename();
          if (t === 'Face') return !beforeFaceIds.has(e.id);
          if (t === 'Edge') return !beforeEdgeIds.has(e.id);
          return false;
        });
        if (newEntities.length > 0) {
          const grp = m.entities.addGroup.apply(m.entities, newEntities);
          if (grp && grp.name !== undefined) grp.name = opName;
          groupId = grp ? grp.id : null;
        }
      }
      m.commitOperation();
      try { UI.notification(null, summary).show(); } catch (e) { console.warn('[Stairs] UI.notification failed:', e); }
      console.log('[Stairs Builder] ' + summary + (groupId ? ` · group=${groupId}` : ''));
    } catch (e) {
      try { m.abortOperation(); } catch (e) { console.warn('[Stairs] abortOperation failed:', e); }
      UI.messagebox('Stairs Builder failed: ' + (e && e.message ? e.message : e));
    }
  }

  // ─── Extension descriptor ───────────────────────────────────────

  const ext = {
    id: 'com.draftdown.stairs',
    name: 'Stairs Builder',
    version: '1.3.1',
    creator: 'DraftDown Examples',
    description:
      'Parametric stair builder. Supports any number of straight flights chained with ' +
      'L (90°) or U (180°) landing turns, plus a spiral mode. All work commits in one undo step.',

    onLoad: function () {
      UI.menu('Plugins').addItem('Stairs Builder…', openPanel);
      try {
        // NOTE: don't pass `parameters: paramSchema()` here — that captures the
        // schema at registration time, which freezes the project unit. Instead
        // rebuild the schema fresh on every activate so the panel always shows
        // the current `m.units`.
        DraftDown.activeModel.tools.registerTool({
          name: 'Stairs Builder',
          category: 'construct',
          cursor: 'crosshair',
          statusText: 'Stairs Builder — fill in the parameters and click Build Stairs.',
          icon: '🪜',
          activate: openPanel,
          deactivate: function () {
            try { UI.parameters.hide(PARAMS_ID); } catch (e) { console.warn('[Stairs] hide on deactivate failed:', e); }
          },
        });
      } catch (e) {
        console.warn('[Stairs Builder] Could not register tool:', e);
      }
    },

    onUnload: function () {
      try { UI.parameters.hide(PARAMS_ID); } catch (e) { console.warn('[Stairs] UI.parameters.hide failed:', e); }
    },
  };

  DraftDown.registerExtension(ext, true);
})();
