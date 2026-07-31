// DraftDown sample plugin — adds a "Plugins → Make Box" menu item that draws a
// 1×1×1 cube at the origin. Mirrors a DraftDown Ruby extension layout.
//
// In DraftDown Ruby this would look like:
//
//   require 'draftdown.rb'
//   require 'extensions.rb'
//
//   module Example
//     module SampleBox
//       def self.make_box
//         model = DraftDown.active_model
//         model.start_operation("Make Box", true)
//         pts = [
//           Geom::Point3d.new(0,0,0),
//           Geom::Point3d.new(1,0,0),
//           Geom::Point3d.new(1,0,1),
//           Geom::Point3d.new(0,0,1),
//         ]
//         face = model.entities.add_face(pts)
//         face.pushpull(1)
//         model.commit_operation
//       end
//
//       unless file_loaded?(__FILE__)
//         UI.menu("Plugins").add_item("Make Box") { make_box }
//         file_loaded(__FILE__)
//       end
//     end
//   end
//
// The DraftDown JS port below is a near-mechanical translation: snake_case → camelCase,
// `do … end` → `() => { … }`, `Geom::Point3d.new` → `new Geom.Point3d`.

(function () {
  'use strict';

  const ext = {
    id: 'com.draftdown.sample-box',
    name: 'Make Box',
    version: '1.0.0',
    creator: 'DraftDown Examples',
    description: 'Adds a Plugins → Make Box menu item to the active model.',

    onLoad: function () {
      UI.menu('Plugins').addItem('Make Box (1×1×1)', function () {
        const model = DraftDown.activeModel;
        model.startOperation('Make Box', true);
        try {
          const face = model.entities.addFace(
            new Geom.Point3d(0, 0, 0),
            new Geom.Point3d(1, 0, 0),
            new Geom.Point3d(1, 0, 1),
            new Geom.Point3d(0, 0, 1),
          );
          face.pushpull(1);
          model.commitOperation();
        } catch (e) {
          model.abortOperation();
          UI.messagebox('Make Box failed: ' + (e && e.message ? e.message : e));
        }
      });

      UI.menu('Plugins').addItem('Make Box from inputs…', function () {
        const ans = UI.inputbox(
          ['Width', 'Depth', 'Height'],
          ['1', '1', '1'],
          [],
          'Make Box',
        );
        if (ans === false) return;
        const w = parseFloat(ans[0]) || 1;
        const d = parseFloat(ans[1]) || 1;
        const h = parseFloat(ans[2]) || 1;

        const model = DraftDown.activeModel;
        model.startOperation('Make Box', true);
        try {
          const face = model.entities.addFace(
            new Geom.Point3d(0, 0, 0),
            new Geom.Point3d(w, 0, 0),
            new Geom.Point3d(w, 0, d),
            new Geom.Point3d(0, 0, d),
          );
          face.pushpull(h);
          model.commitOperation();
        } catch (e) {
          model.abortOperation();
          UI.messagebox('Make Box failed: ' + (e && e.message ? e.message : e));
        }
      });
    },

    onUnload: function () {
      // The host removes plugin-registered menu items automatically; nothing to do.
    },
  };

  DraftDown.registerExtension(ext, true);
})();
