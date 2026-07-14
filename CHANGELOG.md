# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
