# Preferences Window

## What This Is

A modal preferences dialog window that allows 3D designers to configure application-wide settings for DraftDown. This is an Electron renderer process window displayed as a non-resizable, modal dialog with dimensions 600x500 pixels.

## Responsibilities

- Present a user interface for configuring application preferences across multiple categories
- Load current preference values from persistent storage on window open
- Validate user input for all preference fields
- Save updated preferences when the user confirms changes
- Discard changes when the user cancels
- Provide immediate feedback for invalid settings
- Close the window after save or cancel operations

## Preference Categories

The window must provide controls for the following settings:

### Units & Measurements
- **Default Units**: Toggle between metric and imperial measurement systems
- **Grid Spacing**: Numeric input for grid spacing value (must be positive)

### Modeling Behavior
- **Snap Settings**: Configuration for snap-to-grid and snap tolerance
- **Push/Pull Defaults**: Default behavior for push/pull operations

### Rendering
- **Rendering Quality**: Selection among quality presets (low, medium, high, ultra)
- **Anti-aliasing**: Enable/disable setting
- **Shadow Quality**: Quality level for real-time shadows

### Workflow
- **Auto-save Interval**: Time interval in minutes (must be positive integer or disabled)
- **Undo Levels**: Maximum undo history depth

### Keyboard Shortcuts
- Display and allow customization of keyboard shortcuts
- Prevent conflicting shortcut assignments
- Provide reset to defaults option

### Plugin Management
- List installed plugins
- Enable/disable individual plugins
- Access to plugin settings (if applicable)

## Data

### Reads
- Current preference values from `service.preferences` (ID: `bLKtZ1S3`)
- Available keyboard shortcuts and their current bindings
- Installed plugin list and states

### Writes
- Updated preference values to `service.preferences` when user saves changes
- Modified keyboard shortcut bindings

### Data Shapes
All preference data conforms to the schema defined and validated by `service.preferences`. This window does not define preference schemas — it renders forms based on the schema provided by the preferences service.

## APIs Consumed

### Preferences Service (`service.preferences`)
- **Get all preferences**: Retrieve current values for all settings
- **Update preferences**: Save modified preference values (batch update)
- **Validate preference value**: Check if a proposed value is valid for a given preference key
- **Get preference schema**: Retrieve metadata about available preferences (labels, types, constraints, defaults)
- **Reset to defaults**: Reset all or specific preferences to factory defaults

### Plugin Manager (`service.plugin_manager`, ID: `C1T1M9Lw`)
- **List plugins**: Get all installed plugins with metadata (name, version, enabled state)
- **Enable plugin**: Activate a disabled plugin
- **Disable plugin**: Deactivate an enabled plugin
- **Get plugin settings**: Retrieve plugin-specific configuration UI if available

## User Interactions

- **Open**: Triggered by user selecting "Preferences" from application menu or keyboard shortcut
- **Edit**: User modifies preference values through form controls
- **Save**: User clicks "Save" or "OK" button — validate all changes, persist to storage, close window
- **Cancel**: User clicks "Cancel" button or closes window — discard all changes, close window
- **Reset**: User clicks "Reset to Defaults" for specific preference or all preferences — show confirmation dialog

## UI Requirements

- Must be implemented as a React application
- Must use modal layout (blocks interaction with main window)
- Window dimensions: 600x500 pixels, non-resizable
- Window title: "Preferences"
- Must organize preferences into logical sections (tabs or accordion)
- Must provide visual feedback for validation errors
- Must indicate when values differ from defaults
- Must show unsaved changes indicator
- Must include Save/Cancel buttons prominently

## Security & Data Classification

- Preference data is **INTERNAL** classification (stored locally, not sensitive)
- Keyboard shortcuts must not allow binding system-critical shortcuts that would break core application functionality
- Plugin enable/disable operations must not execute plugin code — only modify configuration state
- No authentication required (single-user desktop application)

## Dependencies

### Required Services
- **Preferences Service** (`service.preferences`, UUID: `bLKtZ1S3`): Provides CRUD operations for all application preferences
- **Plugin Manager** (`service.plugin_manager`, UUID: `C1T1M9Lw`): Provides plugin enumeration and state management

### Depends On This Window
- **3D Designer** (`actor.designer`): Opens this window to configure application settings

### Container
Runs in Electron renderer process, communicates with main process services via IPC.

## Testing

This window is covered by:
- **UI E2E Tests** (`test.e2e.ui`): End-to-end testing of user workflows, validation behavior, and data persistence

## Implementation Notes

- Process type: Electron renderer
- Implementation language: TypeScript
- UI framework: React
- Complexity: Simple
- DevTools: Not specified (inherit from application defaults)
- No cloud connectivity required — all operations are local

## Constraints

- Must not modify preferences directly — all changes go through `service.preferences` API
- Must validate all user input before allowing save
- Must handle service errors gracefully (e.g., if preference service is unavailable)
- Must prevent window close with unsaved changes without user confirmation
- Plugin list must reflect current installation state but must not install/uninstall plugins