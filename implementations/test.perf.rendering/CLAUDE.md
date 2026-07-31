# Rendering Performance Tests

## What This Is

A performance benchmarking test suite that measures rendering efficiency and responsiveness of the 3D viewport and WebGL renderer under varying scene complexity. This suite quantifies frame rates, GPU memory consumption, draw call efficiency, and interaction latency across predefined test scenarios ranging from simple (1K faces) to stress-test (2M faces) models.

This test suite **does not run in CI** because it requires GPU hardware. It must be executed manually on target development or testing hardware to establish performance baselines and regression detection.

## Responsibilities

- Launch the Electron application in a controlled test environment with GPU access
- Load predefined test scenes of known complexity from Test Model Fixtures
- Measure and record frames per second (FPS) during interactive orbit navigation
- Capture GPU memory usage via WebGL extensions (e.g., `WEBGL_memory_info`)
- Count draw calls per frame through WebGL instrumentation or Three.js stats
- Measure orbit/zoom interaction latency (input event to frame update)
- Time render mode switching (wireframe, solid, textured) operations
- Record shader compilation time on first scene load
- Test instanced rendering efficiency with scenes containing many repeated components
- Generate performance reports with metrics across all test scenarios

## Test Scenarios

Must cover these fixture-based scenarios:

1. **Sparse Scene** — ~1K faces, baseline performance
2. **Dense Scene** — ~100K faces, typical working model
3. **Complex Scene** — ~500K faces, large project
4. **Stress Test** — ~2M faces, extreme complexity
5. **Instanced Components** — Scene with many repeated geometry instances to validate instancing optimization

## Performance Metrics

Must capture:

- **FPS** during continuous orbit navigation (minimum, average, 99th percentile)
- **Draw call count** per frame
- **GPU memory usage** (allocated texture memory, buffer memory)
- **Interaction latency** (time from mouse move to frame render)
- **Render mode switch time** (milliseconds to toggle wireframe/solid/textured)
- **Shader compilation time** (first-load initialization)
- **Instance rendering efficiency** (draw calls vs. object count ratio)

## Data Sources

- **Test Model Fixtures** (`test.fixture.models`): Pre-generated 3D geometry at known complexity levels
- **Main 3D Viewport** (`viewport.main`): The rendering surface under test
- **WebGL Renderer** (`renderer.webgl`): The rendering engine being benchmarked

## Test Framework

- Uses **Playwright** to launch and control the Electron application
- Written in **TypeScript**
- Test timeout: **120 seconds** (allows for complex scene loading and measurement)
- Requires GPU-capable environment (no headless/software rendering)

## API Surface

Must interact with:

- **Electron application launch**: Start app with specific test scene parameter or command-line flag
- **Scene loading API**: Trigger load of specific fixture by identifier
- **Navigation simulation**: Programmatically trigger orbit/pan/zoom via viewport APIs or event injection
- **Stats extraction**: Read frame timing and draw call data (possibly from Three.js stats, WebGL instrumentation, or exposed debug APIs)
- **GPU metrics**: Query WebGL context for memory info via extensions like `WEBGL_memory_info` or renderer-exposed metrics

## Dependencies

- **Playwright** (`lib.playwright`): Test automation framework
- **Main 3D Viewport** (`viewport.main`): Component under test
- **WebGL Renderer** (`renderer.webgl`): Component under test
- **Test Model Fixtures** (`test.fixture.models`): Source of geometry data

## Constraints

- **No CI execution**: This suite must not run in automated CI pipelines due to GPU requirements
- **Manual execution only**: Developers run this on local hardware or dedicated performance test machines
- **Non-blocking**: Failures in this suite do not block commits or deployments
- **Deterministic fixtures**: Test scenes must be pre-generated and version-controlled for reproducible results
- **Reporting**: Must produce machine-readable output (JSON) for historical comparison and regression tracking

## Security Considerations

- **Data classification**: Test fixtures and performance metrics are non-sensitive development data
- **No external dependencies**: All tests run locally within the Electron sandbox
- **Trust boundary**: Test code has full access to application internals for instrumentation

## Output Artifacts

Must produce:

- Console output with human-readable summary (FPS ranges, memory usage)
- JSON report file with detailed metrics per scenario
- Optional: Screenshot captures at key measurement points for visual verification
- Exit code indicating pass/fail based on configurable performance thresholds (if any)

## Sub-Components

All test implementation lives within this test suite:

- Scene loader helper (loads specific fixtures)
- Navigation simulator (drives viewport interaction)
- Metrics collector (samples FPS, draw calls, GPU memory)
- Report generator (formats and outputs results)
- Threshold validator (optional: compares metrics against baseline)