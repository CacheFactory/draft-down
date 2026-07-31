# Materials Browser

## What This Component Is

The Materials Browser is a floating, resizable window that provides a visual library of materials for the 3D Designer to apply to geometry faces. It manages the display, selection, creation, and editing of PBR (Physically-Based Rendering) materials, each consisting of multiple texture maps and material properties.

## Responsibilities

- Display a browsable grid of material thumbnails from the material library
- Support drag-and-drop of materials onto geometry faces in the main viewport
- Allow creation of new materials with configurable PBR properties
- Enable editing of existing materials (albedo, roughness, metalness, normal maps)
- Store materials as JSON files with references to texture file paths
- Load and render material previews/thumbnails
- Provide search/filter capabilities for the material library
- Maintain material selection state for user interaction
- Handle material metadata (name, tags, categories)

## Window Configuration

**Window Identity:**
- Window ID: `window.materials`
- Process Type: `renderer` (Electron renderer process)

**Window Properties:**
- Width: 400px
- Height: 600px
- Title: "Materials"
- Resizable: yes
- Layout: floating (independent window, not docked)

## APIs Exposed

The Materials Browser must expose methods for:

- **Material Selection**: API to get/set currently selected material
- **Material Application**: Integration point for receiving drop targets from viewport
- **Material CRUD Operations**:
  - Create new material with specified properties
  - Read material properties and textures
  - Update existing material properties
  - Delete material from library
- **Material Export**: Export material data for application to geometry
- **Preview Generation**: Generate thumbnail previews for materials

## APIs Consumed

The Materials Browser depends on:

- **Electron BrowserWindow APIs**: For window lifecycle management
- **IPC Communication**: For coordinating with main viewport when materials are dragged
- **File System Access**: To read material JSON files and texture image files
- **Material Data Format**: Must parse/write material JSON specifications

## Data Read/Write

**Material Storage Location:**
- Materials are stored as JSON files in a materials library directory
- Each material JSON contains:
  - Material name and metadata (tags, categories, author)
  - PBR property values (base color, roughness value, metalness value)
  - Texture file references (relative or absolute paths):
    - Albedo/diffuse map
    - Roughness map
    - Metalness map
    - Normal map
    - Optional: AO map, height map, emission map
  - Creation/modification timestamps

**Texture Files:**
- Referenced texture images (PNG, JPG, etc.) stored alongside or in subdirectories
- Paths in JSON must resolve correctly from materials directory

**Thumbnail Cache:**
- May generate/cache thumbnail images for performance
- Cache location must be deterministic and cleanable

## PBR Material Properties

Each material must support these standard PBR properties:

- **Albedo/Base Color**: RGB color or texture map
- **Roughness**: 0-1 value or grayscale texture map
- **Metalness**: 0-1 value or grayscale texture map
- **Normal Map**: RGB texture for surface detail
- **Optional Maps**: Ambient occlusion, height/displacement, emission

## Drag-and-Drop Contract

When a material is dragged from the browser:

- Must provide material identification data (ID, name, or file path)
- Must communicate with main viewport to handle drop events
- Viewport receives material reference and applies to target face
- Drop operation must not block UI thread
- Visual feedback during drag operation

## Security Constraints

**Data Classification:**
- Material files and textures are user content (private)
- Material library may contain licensed/copyrighted textures
- No network transmission of material data

**File System Access:**
- Materials directory must be within user's local file system
- Validate file paths to prevent directory traversal
- Sanitize material names for safe file system operations
- Handle missing texture files gracefully

**Trust Boundaries:**
- Material JSON is user-provided data — validate on load
- Texture file paths must be validated before loading
- Preview generation must handle malformed images safely

## Component Dependencies

**This Component Depends On:**

- **Electron Framework**: For renderer process and window management
- **React**: UI framework for component rendering
- **Three.js** (likely): For material preview rendering
- **File System Module**: For reading material and texture files
- **IPC Module**: For inter-process communication with main process and viewport

**Components That Depend On This:**

- **3D Designer** (actor.designer): Uses this window to browse and apply materials
- **Main Viewport**: Receives material data via drag-and-drop operations
- **UI E2E Tests** (test.e2e.ui): Tests material browsing, selection, and application workflows

## Sub-Components to Implement

Within this codebase, implement:

1. **Material Grid View**: Scrollable grid displaying material thumbnails
2. **Material Preview Renderer**: Component that generates 3D preview of material properties
3. **Material Editor Panel**: Form/panel for editing material properties and texture assignments
4. **Drag Source Handler**: Manages drag initiation and data packaging
5. **Material File Manager**: Handles loading/saving material JSON files
6. **Texture Loader**: Loads and validates texture image files
7. **Search/Filter Bar**: UI for filtering materials by name, tags, or properties
8. **Material Creation Dialog**: Modal/panel for creating new materials
9. **Thumbnail Generator**: Generates preview images for materials without thumbnails

## UI Framework

- **Framework**: React
- **Language**: TypeScript
- **Complexity**: Moderate

## Constraints

- All operations must run locally — no cloud/network dependencies
- Material loading must be performant with large libraries (100+ materials)
- Preview rendering must not block UI interactions
- Window must maintain state across close/reopen cycles
- Must handle missing or corrupt material files gracefully
- Texture loading must support common image formats (PNG, JPG, TGA, etc.)
- Material JSON schema must be forward-compatible for future property additions

## Existing Code References

None specified. This is a new implementation.

## Notes

- Consider lazy-loading textures for performance with large libraries
- Material thumbnails should be generated with consistent lighting/geometry for comparison
- Support both procedural materials (properties only) and texture-based materials
- Material library organization (folders, categories) should be reflected in UI
- Undo/redo for material edits may be required depending on system-wide architecture