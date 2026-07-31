# Material Manager

## Purpose

The Material Manager is responsible for all material definitions and texture assets used throughout the application. It provides a centralized system for creating, storing, and applying PBR (Physically Based Rendering) materials to geometry, including texture loading, material library management, and GPU resource synchronization.

## Responsibilities

- Define and manage PBR material properties (albedo, roughness, metalness, normal maps, opacity)
- Load, cache, and unload texture image files from disk
- Manage material libraries loaded from JSON files on the local filesystem
- Assign materials to faces in the Half-Edge Mesh geometry representation
- Synchronize material definitions with Three.js GPU materials for rendering
- Provide built-in material libraries (Colors, Wood, Metal, Glass, Concrete, Brick, Stone, Fabric)
- Support native colorized textures (tinting texture with base color)
- Generate and cache material thumbnails

## API Surface

### Material CRUD Operations

**`createMaterial(name: string, props?: Partial<Material>): Material`**
- Creates a new material with the given name and optional initial properties
- Generates a unique ID for the material
- Initializes all PBR properties with defaults if not provided
- Emits `material-created` event

**`deleteMaterial(material: Material): void`**
- Removes the material from internal storage
- Unloads associated textures if no longer referenced
- Emits `material-deleted` event

**`updateMaterial(material: Material, changes: Partial<Material>): void`**
- Applies property changes to an existing material
- Invalidates GPU material cache
- Emits `material-changed` event

**`getMaterial(id: string): Material | undefined`**
- Retrieves a material by its unique ID

**`getAllMaterials(): Material[]`**
- Returns all currently loaded materials

**`getDefaultMaterial(): Material`**
- Returns the default material (white color, no textures)

### Texture Management

**`loadTexture(filePath: string): Promise<TextureMap>`**
- Reads texture file from local filesystem
- Decodes image data into ImageBitmap
- Creates GPU texture handle (WebGLTexture)
- Caches the texture for reuse
- Returns texture metadata including dimensions, UV transforms

**`unloadTexture(texture: TextureMap): void`**
- Releases GPU resources
- Removes from cache
- Frees ImageBitmap memory

### Library Management

**`loadLibrary(filePath: string): Promise<MaterialLibrary>`**
- Reads JSON material library file from disk
- Loads all referenced texture files
- Creates Material instances for all definitions in the library
- Emits `library-loaded` event
- Returns the loaded library

**`saveLibrary(library: MaterialLibrary): Promise<void>`**
- Serializes library to JSON
- Writes to the specified filePath on local filesystem
- Does not embed texture data, only references

**`getBuiltInLibraries(): MaterialLibrary[]`**
- Returns all pre-installed material libraries
- Libraries include: Colors, Wood, Metal, Glass, Concrete, Brick, Stone, Fabric

### Face Assignment

**`assignToFace(face: Face, material: Material, backMaterial?: Material): void`**
- Sets the material for a face in the Half-Edge Mesh
- Optionally sets a different back-face material
- Updates mesh data structures to reference the material ID

**`sampleFromFace(face: Face): Material`**
- Retrieves the material currently assigned to a face

**`replaceAll(oldMaterial: Material, newMaterial: Material): number`**
- Finds all faces using `oldMaterial`
- Reassigns them to `newMaterial`
- Returns the count of faces updated

### GPU Synchronization

**`getThreeMaterial(material: Material): THREE.MeshStandardMaterial`**
- Converts a Material definition to a Three.js MeshStandardMaterial
- Maps PBR properties to Three.js equivalents
- Attaches loaded texture maps to Three.js material
- Caches the Three.js material instance

**`invalidateGPUMaterial(material: Material): void`**
- Marks the cached Three.js material as stale
- Forces re-creation on next `getThreeMaterial` call

### Event System

**`on(event: 'material-created' | 'material-changed' | 'material-deleted' | 'library-loaded', handler: (data: any) => void): void`**
- Registers event listener for material lifecycle events

**`off(event: string, handler: Function): void`**
- Unregisters event listener

## Data Structures

### Material

- **id**: Unique identifier (read-only, generated)
- **name**: Human-readable name
- **albedoColor**: Base color as RGB 0-1 (Color3)
- **albedoTexture**: Optional base color texture map
- **roughness**: Surface roughness 0 (mirror) to 1 (matte)
- **roughnessTexture**: Optional roughness texture map
- **metalness**: Metallic property 0 (dielectric) to 1 (metal)
- **metalnessTexture**: Optional metalness texture map
- **normalTexture**: Optional normal map for surface detail
- **opacity**: Transparency 0 (transparent) to 1 (opaque)
- **opacityTexture**: Optional opacity/alpha texture map
- **colorized**: Boolean flag for native texture tinting
- **thumbnail**: Cached preview image (ImageBitmap)

### TextureMap

- **filePath**: Relative path to texture file on disk
- **width**: Pixel width
- **height**: Pixel height
- **scale**: UV tiling factor (Vector2)
- **offset**: UV offset (Vector2)
- **rotation**: UV rotation in radians
- **gpuTexture**: Cached WebGLTexture handle
- **imageData**: Cached ImageBitmap for CPU access

### MaterialLibrary

- **id**: Unique identifier (read-only)
- **name**: Library name (e.g., "Wood", "Metal")
- **materials**: Array of Material instances
- **filePath**: Path to JSON file on disk

## Data Storage

### Filesystem Operations

**Reads from Local File System:**
- Material library JSON files at user-specified paths
- Texture image files referenced by materials (PNG, JPG, etc.)
- Built-in library files from application assets directory

**Writes to Local File System:**
- Material library JSON files when saving user libraries
- No texture files are written (only referenced by path)

### Data Format

Material libraries are stored as JSON files with structure:
```
{
  "id": "library-unique-id",
  "name": "Library Name",
  "materials": [
    {
      "id": "material-unique-id",
      "name": "Material Name",
      "albedoColor": [r, g, b],
      "albedoTexture": { "filePath": "...", "scale": [...], ... },
      // ... all PBR properties
    }
  ]
}
```

Texture files remain as separate image files on disk, referenced by relative path.

## Dependencies

### Half-Edge Mesh (mesh.halfedge)

The Material Manager manages material assignments for faces in the Half-Edge Mesh. It:
- Reads face data structures to determine current material assignments
- Writes material IDs to face properties when assigning materials
- Must understand the Face type and its material reference fields

### Main Renderer Process (process.renderer)

The Material Manager is contained within the Main Renderer Process and:
- Runs in the Electron renderer process context
- Has access to WebGL contexts for GPU texture creation
- Can use renderer process APIs for file I/O via IPC or direct access

## Integration Points

### Three.js Rendering

Materials must be convertible to Three.js `MeshStandardMaterial` instances for GPU rendering. The conversion must map:
- `albedoColor` → `color`
- `roughness` → `roughness`
- `metalness` → `metalness`
- `opacity` → `opacity` / `transparent` flag
- Texture maps → corresponding Three.js texture properties

### GPU Resource Management

- WebGLTexture handles must be created using the renderer's WebGL context
- Texture uploads must happen on the main thread (or via appropriate synchronization)
- Cached GPU materials should be invalidated when material properties change

## Security & Trust

### Data Classification

Materials and textures are **user content**:
- User-created materials may reference arbitrary file paths on local disk
- Texture files are user-provided or from bundled asset libraries
- Material definitions may contain sensitive project information

### File Access Constraints

- All file paths must be validated to prevent directory traversal attacks
- Texture loading must reject absolute paths outside project directories
- Built-in libraries must be read from a trusted application assets directory
- User libraries must only write to explicitly selected save locations

### Trust Boundaries

- Material data crosses the trust boundary when loading external JSON files
- Texture images cross the boundary when loading user-selected image files
- Validate JSON structure before deserializing into Material objects
- Sanitize file paths to prevent malicious path injection

## Built-In Content

The Material Manager must ship with the following default material libraries as JSON files:

1. **Colors** — Basic solid colors (white, black, red, green, blue, etc.)
2. **Wood** — Oak, pine, walnut, cherry, bamboo
3. **Metal** — Steel, aluminum, copper, brass, chrome
4. **Glass** — Clear, tinted, frosted
5. **Concrete** — Various concrete finishes
6. **Brick** — Red brick, white brick, stone brick
7. **Stone** — Granite, marble, limestone
8. **Fabric** — Canvas, denim, leather

Each library is a separate JSON file with embedded texture file references pointing to bundled texture assets.

## Performance Considerations

- Texture loading is asynchronous and must not block the UI
- GPU texture uploads may be expensive; cache and reuse where possible
- Material replacement operations may affect large numbers of faces; consider progress feedback for large models
- ImageBitmap creation should use off-screen canvas or worker threads for large images
- Three.js material caching should prevent redundant GPU state updates

## Events

- **material-created**: Fired when a new material is created (data: Material)
- **material-changed**: Fired when material properties are updated (data: Material)
- **material-deleted**: Fired when a material is removed (data: { id: string })
- **library-loaded**: Fired when a material library is loaded (data: MaterialLibrary)