# Brings Website

Brings is a local-first, canvas-native vector editor for independent creators.
This repository owns its VectoJS application scene, browser input and storage,
accessibility projection, automation, and Cloudflare Pages deployment.

It contains one product canvas and one VectoJS Scene. Visible editor UI is
rendered as retained VectoJS entities with explicit numeric layout; the browser
host only provides the mounting root, canvas, and VectoJS-managed semantic/input
projection.

## Status

The foundation provides the responsive application shell and owns a Core-backed
document session with Frame/Rectangle creation and frontmost canvas selection.
Select-tool drags render a transient VectoJS preview, commit exactly one Core
transform command on `pointerup`, and roll back without history on
`pointercancel`. The focusable VMT design region routes Ctrl/Cmd+Z,
Ctrl/Cmd+Shift+Z, and Ctrl+Y to transactional Core undo/redo. Delete and
Backspace atomically delete the normalized selection as one Core command, with
selection restoration on undo and native-editor yielding for every shortcut.
The app consumes exact published `@vectojs/brings-core@0.7.0`,
`@vectojs/core@1.6.2`, `@vectojs/ui@1.7.2`, and
`@vectojs/devtools@0.4.2` registry dependencies, never local workspace links.
Interaction slices render and mutate only Core-owned state.

## Development

```bash
bun install --frozen-lockfile
just verify
```

## Deployment

The canonical application URL is `https://brings-website.vectojs.org/`.
`pages.dev` remains a deployment fallback.

`just deploy` creates a Pages preview for the current checked-out branch. Only
the protected `main` branch may use `just deploy-production`; CI performs that
production deployment after all verification jobs succeed. The deployment
workflow associates the canonical Pages domain, creates its missing CNAME only
when no conflicting record exists, retries validation, and waits for the domain
to become active before reporting success.

## License

MIT. See [LICENSE](./LICENSE).
