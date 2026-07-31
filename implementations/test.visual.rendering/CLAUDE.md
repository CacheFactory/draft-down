# Visual Regression Tests

**Component ID:** `test.visual.rendering`  
**Kind:** test_suite  
**Layer:** testing

## Purpose

This test suite detects visual regressions in DraftDown's 3D rendering pipeline by capturing screenshots of predefined scenes and comparing them pixel-by-pixel against golden reference images. Any deviation beyond a configurable threshold indicates a regression in the renderer, shaders, or post-processing effects.

## Responsibilities

- Render predefined test scenes in all supported render modes
- Capture screenshots of the rendered output through the Main 3D Viewport
- Compare captured screenshots against golden reference images using pixel difference algorithms
- Fail tests when visual differences exceed configured thresholds
- Generate visual diff reports showing what changed
- Test all camera views and projection modes
- Verify correct rendering of materials, shadows, outlines, and overlays
- Run in CI/CD pipeline with 30-second timeout per test

## Test Coverage Requirements

### Render Modes
- Wireframe mode
- Shaded mode
- Textured mode
- X-ray mode

### Material Rendering
- PBR (Physically Based Rendering) materials with varying properties
- Material showcase scene demonstrating different material types
- Texture application and filtering

### Visual Features
- Edge outlines (visibility and appearance)
- Selection highlights (color, style, and overlay behavior)
- Section planes (clipping geometry correctly)
- Shadows (shadow map quality and placement)
- Grid and axes display (visibility and rendering)

### Camera Views
- Front view
- Back view
- Left view
- Right view
- Top view
- Isometric view
- Perspective projection
- Orthographic projection

## Test Fixtures

Must use scenes from the Test Model Fixtures component (`test.fixture.models`):

- **Reference cube scene**: Simple geometry for baseline rendering tests
- **Reference house scene**: Complex geometry with multiple surfaces and edges
- **Reference material showcase scene**: Materials with varying properties (metallic, roughness, transparency, colors)

## Dependencies

### Components Under Test
- **Main 3D Viewport** (`viewport.main`): The rendered output source
- **WebGL Renderer** (`renderer.webgl`): Rendering engine being validated
- **Main Camera** (`camera.main`): Camera positioning and projection modes

### Test Infrastructure
- **Playwright** (`lib.playwright`): Browser automation and screenshot capture
- **Test Model Fixtures** (`test.fixture.models`): Predefined test scenes

## Technical Constraints

- **Language**: TypeScript
- **Framework**: Playwright
- **Timeout**: 30,000ms per test
- **CI Execution**: Must run successfully in CI/CD pipeline
- **Complexity**: Complex (extensive coverage matrix)

## Test Execution Requirements

- Launch Electron application in headless mode (if supported) or visible mode
- Load each test fixture scene into the viewport
- Configure camera to each standard view
- Set each render mode
- Wait for rendering to complete and stabilize
- Capture screenshot at viewport native resolution
- Compare against golden reference image with pixel difference algorithm
- Report pass/fail based on threshold (threshold value must be configurable)
- Generate visual diff images showing changed pixels when tests fail

## Golden Reference Management

- Golden reference images must be stored in a versioned location
- New golden references must be generated when intentional visual changes occur
- Test must fail if no golden reference exists (with option to generate initial baseline)
- Different golden sets may be needed for different platforms if rendering differs

## Failure Reporting

When visual regression detected:
- Show which test scene failed
- Show which render mode/camera view failed
- Display pixel difference percentage
- Generate side-by-side comparison image (expected vs actual vs diff)
- Provide actionable information for debugging (threshold, total differing pixels, regions of difference)

## Security and Data Classification

- Test fixtures contain no sensitive data
- Screenshots are development artifacts, not production data
- CI artifacts (screenshots, diffs) are stored as build outputs

## Non-Requirements

This test suite does NOT:
- Test interactive manipulation (that's handled by integration tests)
- Validate geometric correctness (that's handled by unit tests)
- Test performance or frame rates (that's handled by performance tests)
- Test plugin rendering (that's handled by plugin integration tests)