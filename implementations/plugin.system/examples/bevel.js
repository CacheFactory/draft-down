// DraftDown example plugin: Bevel (chamfer) selected edges.
// Demonstrates the extension pattern, menus, input, selection access, and
// the model operation API. See PLUGINS.md for the full API reference.

(function () {
  function bevelSelectedEdges() {
    const model = DraftDown.activeModel;
    if (!model) return;

    // Selected edge ids (selection contains faces/edges/components)
    const edgeIds = model.selection.edges().map(function (edge) { return edge.id; });

    if (edgeIds.length === 0) {
      UI.messagebox('Select one or more edges to bevel first.');
      return;
    }

    const result = UI.inputbox(['Bevel distance (m):'], ['0.1'], [], 'Bevel Edges');
    if (!result) return;
    const distance = parseFloat(result[0]);
    if (!(distance > 0)) {
      UI.messagebox('Distance must be a positive number.');
      return;
    }

    model.startOperation('Bevel Edges');
    let done = 0;
    let failed = 0;
    edgeIds.forEach(function (edgeId) {
      const r = model.api_.chamferEdge(edgeId, distance);
      if (r && r.success) done++;
      else failed++;
    });
    model.commitOperation();
    model.activeView.refresh();

    UI.messagebox('Beveled ' + done + ' edge(s)' + (failed ? ', ' + failed + ' failed (need 2 adjacent faces)' : '') + '.');
  }

  UI.menu('Plugins').addItem('Bevel Selected Edges', bevelSelectedEdges);

  DraftDown.registerExtension({
    id: 'draftdown.examples.bevel',
    name: 'Bevel',
    version: '1.0.0',
    description: 'Chamfer selected edges by a typed distance.',
    creator: 'DraftDown Examples',
  }, true);
})();
