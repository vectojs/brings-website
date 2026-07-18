# Brings Website

Brings is a local-first, canvas-native vector editor for independent creators.
This repository owns its VectoJS application scene, browser input and storage,
accessibility projection, automation, and Cloudflare Pages deployment.

It contains one product canvas and one VectoJS Scene. Visible editor UI is
rendered as retained VectoJS entities with explicit numeric layout; the browser
host only provides the mounting root, canvas, and VectoJS-managed semantic/input
projection.

## Status

The application provides a professional responsive editor shell with a local
document status bar, fixed desktop Pages/Layers and Properties panels, a
viewport-owned creation dock, and navigation-only authoring controls on narrow
screens. It owns a Core-backed document session with Frame, Rectangle, Ellipse,
Text, and Path creation, ordered layers, selected-node properties, grouping,
frontmost canvas selection, camera pan/zoom, and local undo/redo history.
Frame, Rectangle, and Ellipse tools use one transactional creation session:
click retains the documented default size, drag defines explicit page bounds,
Shift preserves the tool's default aspect ratio, and Alt expands from the
pointer-down center. Escape, `pointercancel`, tool changes, and authoring-mode
loss discard the live VectoJS preview without changing Core history.
Select-tool drags render a transient VectoJS preview, commit exactly one Core
transform command on `pointerup`, and roll back without history on
`pointercancel`. Move and axis-aligned resize previews snap object edges and
centres to nearby visible objects, render transient canvas-native alignment
guides, and commit the exact displayed transform as one undoable Core command.
Shift and Alt modifiers are sampled dynamically during resize without moving
interaction ownership out of Core. The focusable VMT design region routes
Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl+Y to transactional Core undo/redo.
Delete and Backspace atomically delete the normalized selection as one Core
command, with selection restoration on undo and native-editor yielding for
every shortcut. The canvas-native Pen tool adds straight or cubic anchors
without mutating the document during a draft. Click creates corners, click-drag
creates symmetric handles, clicking the first of at least three anchors closes
the contour, Enter commits an open contour, and Escape discards it. A successful
terminal gesture creates and selects one Core Path through one undoable command.
Unmodified V, F, R, O, P, and T switch the canvas-native Select, Frame,
Rectangle, Ellipse, Pen, and Text tools while native editors retain their keys.
Right-click opens a canvas-native command surface after resolving the frontmost
Core selection. Select all, nested Arrange, Group/Ungroup, and Delete share the
same controller commands as Ctrl/Cmd+A, bracket ordering shortcuts,
Ctrl/Cmd+G, Ctrl/Cmd+Shift+G, and Delete; outside click or Escape closes the
entire overlay chain without changing document history.

The app consumes exact published `@vectojs/brings-core@0.15.0`,
`@vectojs/core@1.11.1`, `@vectojs/ui@1.11.3`, and
`@vectojs/devtools@0.4.3` registry dependencies, never local workspace links.
Interaction slices render and mutate only Core-owned state.

## Development

```bash
bun install --frozen-lockfile
just verify
```

## Deployment

The canonical application URL is `https://brings-website.vectojs.org/`.
`pages.dev` remains a deployment fallback.

The Cloudflare Pages project is named `brings`; its stable Pages fallback is
`https://brings-website.pages.dev/`. The repository name and canonical domain
do not determine the Pages API project identifier. Domain reconciliation passes
both values explicitly because a renamed Pages project can retain its original
`pages.dev` hostname.

`just deploy` creates a Pages preview for the current checked-out branch. Only
the protected `main` branch may use `just deploy-production`; CI performs that
production deployment after all verification jobs succeed. The deployment
workflow associates the canonical Pages domain, creates its missing CNAME only
when no conflicting record exists, retries validation, and waits for the domain
to become active before reporting success.

## License

MIT. See [LICENSE](./LICENSE).
