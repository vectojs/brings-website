# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Reworked the editor into a professional local-first shell with a slim
  document bar, fixed desktop Pages/Layers and Properties panels, a compact
  viewport-owned tool dock, projected local-save and history state, and a
  navigation-only narrow-screen mode.
- Upgraded to Brings Core 0.13.0, VectoJS Core 1.9.1, and VectoJS UI 1.9.1 to
  use the latest document-opening, retained primitive, ContextMenu, and dynamic
  accessibility-state fixes.
- Extracted reusable editor chrome entities from the interaction-heavy shell so
  command surfaces, camera status, projected labels, and responsive notices can
  evolve independently from document behavior.
- Added deterministic edge and centre snapping for move and axis-aligned
  resize interactions, including dynamic Shift/Alt modifier sampling,
  canvas-native alignment guides, exact one-command commits, cancellation
  cleanup, and undo/redo browser coverage across Chromium, Firefox, WebKit,
  high-DPR rendering, and emulated page scale.
- Upgraded to Brings Core 0.10.1 so move-guide extents are derived from the
  final snapped geometry shown on the canvas.
- Corrected CI and local deployment to target the existing Cloudflare Pages
  project `brings` while retaining `brings-website.pages.dev` and
  `brings-website.vectojs.org` as the public domains.
- Upgraded to Brings Core 0.8.0, VectoJS Core 1.8.0, and VectoJS UI 1.9.0.
- Added exact intersection marquee selection, dynamic Shift union, Shift-click
  toggle, selected-object movement, and Escape/`pointercancel` rollback through
  branded VectoJS logical/page coordinates. Read-only frozen diagnostics now
  cover Chromium, Firefox, WebKit, high-DPR rendering, and CDP page-scale input;
  CDP scale is tested as coordinate emulation rather than Ctrl+/- semantic zoom.
- Extended first-time Pages domain activation polling to three minutes and
  accepted activation returned by the final allowed status refresh.
- Added VMT-routed Delete and Backspace selection deletion as one undoable Core
  command, including selection-restoring undo/redo, native-editor yielding, and
  finalized DevTools keyboard-route coverage.
- Upgraded to Brings Core 0.7.0.
- Added focusable VMT design-canvas undo/redo shortcuts with native editor
  yielding and finalized DevTools keyboard-route assertions.
- Upgraded to VectoJS Core 1.6.2 and DevTools 0.4.2.
- Added transactional Select-tool dragging with transient previews, one-command
  commits, undo, and `pointercancel` rollback diagnostics.
- Upgraded to Brings Core 0.6.0, VectoJS Core 1.6.1, UI 1.7.2, and DevTools
  0.4.1.
- Reconciled the production Pages domain, canonical CNAME, and activation state
  as one tested deployment invariant.
- Established the VectoJS-native Brings Website foundation.
