# Distance Constraint

## What This Component Is

The Distance Constraint is a numerical input and constraint system that allows users to specify exact distances during drawing, moving, and modeling operations. When a user types a number while a tool is active, the constraint locks the current operation to that precise distance value. This is DraftDown's implementation of the "Value Control Box" (VCB) pattern found in professional CAD applications.

The constraint displays the current measurement in the measurements panel at the bottom of the screen and accepts typed numeric input to snap operations to exact values.

## What This Component Must Do

### Core Responsibilities

- Accept numeric input from the keyboard while compatible tools are active
- Parse distance values with optional unit suffixes (e.g., "5m", "120cm", "3.5")
- Lock the active tool's operation to the specified distance
- Display the current/constrained distance in the measurements panel UI
- Clear constraint state when the operation completes or is canceled
- Support unit conversions based on the document's current unit system
- Validate that input values are positive and within reasonable bounds

### API Surface

#### Public Methods/Functions

The constraint must expose:

- **activate()** — Called when a tool begins an operation that supports distance constraints
- **deactivate()** — Called when the tool operation completes or is canceled
- **setValue(distance: number)** — Programmatically set the constraint distance (in document units)
- **getValue(): number | null** — Returns the current constrained distance, or null if not set
- **clearValue()** — Removes the constraint, allowing free movement again
- **formatForDisplay(distance: number): string** — Formats a distance value for display in the measurements panel
- **parseInput(input: string): number | null** — Parses user text input into a distance value

#### Events/Callbacks

The constraint must emit or provide callbacks for:

- **onConstraintSet(distance: number)** — Fires when user input sets a new constraint value
- **onConstraintCleared()** — Fires when the constraint is removed
- **onValueChanged(distance: number)** — Fires when the constraint value updates (for live display)

### Data Consumed

- **User keyboard input** — Raw text strings typed by the user during tool operations
- **Document unit settings** — The current project's base unit system (mm, cm, m, inches, feet)
- **Tool state** — Whether a compatible tool is currently active and in what phase
- **Current operation distance** — Live distance feedback from the active tool (for display before constraint is set)

### Data Produced

- **Constrained distance value** — A numeric distance in document units that the active tool must respect
- **Formatted display string** — The distance value formatted with appropriate units and precision for the measurements panel

### Data Storage

This is a transient constraint with no persistent storage requirements. State exists only during active tool operations:

- Current constraint value (number or null)
- Active state (boolean)
- Input buffer for incomplete numeric entry
- Last valid distance for display purposes

## Tool Integration

### Tools That Use This Constraint

The following tools consume this constraint (as indicated by incoming `uses` edges):

- **Line Tool** (`tool.line`) — Constrains the length of the line being drawn
- **Rectangle Tool** (`tool.rectangle`) — Constrains edge lengths during rectangle creation
- **Move Tool** (`tool.move`) — Constrains the distance of movement
- **Push/Pull Tool** (`tool.pushpull`) — Constrains the extrusion/offset distance
- **Circle Tool** (`tool.circle`) — Constrains the radius of the circle
- **Arc Tool** (`tool.arc`) — Constrains the radius or arc length
- **Polygon Tool** (`tool.polygon`) — Constrains the radius or edge length
- **Tape Measure Tool** (`tool.tape_measure`) — Creates construction geometry at a specific distance
- **Scale Tool** (`tool.scale`) — Constrains the scale factor as a distance
- **Offset Tool** (`tool.offset`) — Constrains the offset distance
- **Rotate Tool** (`tool.rotate`) — May use for radius-based rotation constraints

Each tool is responsible for querying this constraint and applying its value to their geometric calculations.

## Inference Engine Integration

The constraint **modifies** the **Inference Engine** (`engine.inference`) as indicated by outgoing `modifies` edges. Specifically:

- When a distance constraint is active, it must inform the inference engine to prioritize distance-locked inference points
- The inference engine should display temporary construction geometry showing the constrained distance
- The constraint may temporarily disable conflicting inferences (e.g., "On Face" inferences that would violate the distance constraint)

The constraint does not directly manipulate inference results but provides metadata that influences inference behavior.

## Input Handling Requirements

### Valid Input Formats

- Bare numbers: `5`, `12.5`, `0.25`
- Numbers with unit suffixes: `5m`, `120cm`, `3.5"`, `12'6"`
- Fractional inches: `5 1/2"`, `12-3/4"`
- Expressions (future): `10+5`, `3*4`

### Unit Suffix Parsing

Must support common unit abbreviations:
- Metric: `mm`, `cm`, `m`, `km`
- Imperial: `"` (inches), `'` (feet), `in`, `ft`

Convert all input to the document's base unit system before applying the constraint.

### Input Validation

- Reject negative values
- Reject zero for operations where it's meaningless (e.g., circle radius)
- Clamp extremely large values to reasonable bounds (e.g., 1km max)
- Provide user feedback for invalid input (via measurements panel or status bar)

## Display Requirements

### Measurements Panel

The constraint must integrate with the measurements panel UI component (location TBD in architecture). Display requirements:

- Show current distance in real-time during unconstrained operations
- Highlight/lock the display when a constraint is active
- Accept keyboard focus for numeric input
- Show unit suffix appropriate to document settings
- Use formatting: thousands separators, appropriate decimal precision

### Visual Feedback in Viewport

While the constraint itself doesn't render geometry, it should coordinate with the inference engine to show:

- A temporary dimension annotation at the constrained distance
- Highlighted inference points that satisfy the constraint
- Color-coded feedback (e.g., blue for active constraint)

## Keyboard Interaction

### Input Capture

- The constraint must capture numeric key presses when any compatible tool is active
- Capture must work regardless of which UI element has focus (global keyboard listener)
- Support backspace/delete for editing input
- Enter key commits the constraint
- Escape key clears the constraint and input buffer

### Input Buffer Management

- Maintain a string buffer of typed characters
- Parse the buffer continuously to provide live feedback
- Commit the buffer to a constraint value on Enter
- Clear the buffer on Escape or when the tool operation completes

## Constraints and Requirements

### Non-Parametric

The `parametric: false` flag indicates this constraint does **not** update dynamically when upstream geometry changes. Once set, the distance value remains fixed until the user clears it or completes the operation.

### Transient State

The constraint is ephemeral—it exists only during an active tool operation. State must be cleared when:

- The tool operation completes successfully
- The user cancels the operation (Escape or right-click)
- The user switches to a different tool
- The document is closed

### Unit System Independence

The constraint must work seamlessly with any document unit system. Internal calculations should be unit-agnostic (work in document base units), with unit conversion happening only at input parsing and display formatting boundaries.

### Performance

Input parsing and constraint application must be real-time responsive:

- Input parsing: < 1ms
- Constraint value updates: < 5ms
- No blocking operations on the main thread

## Dependencies

### Consumed Services/Components

- **Document Settings** — To retrieve current unit system
- **Keyboard Input System** — To capture global numeric key presses
- **Measurements Panel UI** — To display values and accept input focus
- **Inference Engine** (`engine.inference`) — To coordinate constraint-aware inference behavior

### Tool Coordination

The constraint does not directly call tools. Instead, tools query the constraint as part of their operation logic. The constraint must provide a simple polling API that tools can check during their update/preview phases.

## Security and Data Classification

- **Data Classification**: Unclassified — Distance values are user-generated design data with no special sensitivity
- **Trust Boundaries**: None — This component operates entirely within the trusted application boundary
- **Input Validation**: Required — User input must be sanitized to prevent injection of invalid numeric values or malformed unit strings
- **Encryption**: Not required
- **Authentication**: Not applicable — Feature is available to all users of the application

## Error Handling

The constraint must handle:

- **Invalid numeric input** — Display error in measurements panel, don't apply constraint
- **Conflicting constraints** — If multiple constraint types could apply, distance takes precedence
- **Tool state mismatches** — Gracefully handle activation/deactivation race conditions
- **Unit conversion failures** — Fall back to document base units

## Non-Functional Requirements

- **Language**: TypeScript (as specified in `x.impl.language`)
- **Complexity**: Simple (as specified in `x.impl.complexity`) — This is a focused, single-purpose constraint with minimal branching logic
- **Testability**: Must support unit testing of input parsing, unit conversion, and constraint application logic independent of UI and tool integration

## Out of Scope

The following are explicitly **not** responsibilities of this component:

- Geometric calculations using the constrained distance (tools' responsibility)
- Rendering dimension annotations (inference engine's responsibility)
- Undo/redo of constraint operations (handled by tool-level command history)
- Persistent constraint storage (this is not a parametric constraint)
- Complex expression evaluation (may be added later as a separate feature)