// @archigraph test.e2e.tools
// E2E tests for tools (requires full app bootstrap, run with electron test harness)

describe('Tools E2E', () => {
  describe('Line Tool', () => {
    test.todo('should draw a single edge');
    test.todo('should draw connected edges');
    test.todo('should create face when edges form closed loop');
    test.todo('should snap to axis with inference');
    test.todo('should accept VCB input for exact distance');
    test.todo('should snap to existing endpoints');
    test.todo('should cancel drawing with Escape');
  });

  describe('Rectangle Tool', () => {
    test.todo('should draw a rectangle on ground plane');
    test.todo('should accept VCB dimensions (width,height)');
    test.todo('should draw on detected face plane');
  });

  describe('Circle Tool', () => {
    test.todo('should draw a circle with specified segments');
    test.todo('should accept VCB radius input');
  });

  describe('Push/Pull Tool', () => {
    test.todo('should extrude a face along its normal');
    test.todo('should accept VCB distance input');
    test.todo('should create side faces during extrusion');
  });

  describe('Move Tool', () => {
    test.todo('should move selected entities');
    test.todo('should copy with Ctrl modifier');
    test.todo('should snap to inference points');
  });

  describe('Rotate Tool', () => {
    test.todo('should rotate selected entities around center');
    test.todo('should accept VCB angle input');
  });

  describe('Scale Tool', () => {
    test.todo('should scale selection uniformly');
    test.todo('should scale along single axis');
  });

  describe('Select Tool', () => {
    test.todo('should select entity on click');
    test.todo('should add to selection with Shift+click');
    test.todo('should box select with drag');
    test.todo('should clear selection with click on empty space');
    test.todo('should enter group with double-click');
  });

  describe('Orbit/Pan/Zoom', () => {
    test.todo('should orbit camera with drag');
    test.todo('should pan camera with drag');
    test.todo('should zoom with scroll');
    test.todo('should zoom extents');
  });

  describe('Eraser Tool', () => {
    test.todo('should delete edges on click');
    test.todo('should hide edges with Shift');
  });

  describe('Paint Tool', () => {
    test.todo('should apply material to face');
    test.todo('should sample material with Shift+click');
  });
});
