# Brings Website

Brings is a local-first, canvas-native vector editor for independent creators.
This repository owns its VectoJS application scene, browser input and storage,
accessibility projection, automation, and Cloudflare Pages deployment.

It contains one product canvas and one VectoJS Scene. Visible editor UI is
rendered as retained VectoJS entities with explicit numeric layout; the browser
host only provides the mounting root, canvas, and VectoJS-managed semantic/input
projection.

## Status

The foundation provides the responsive application shell. It deliberately does
not link a local Core checkout; `@vectojs/brings-core` is added as an exact
registry dependency only after a useful Core release exists.

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
production deployment after all verification jobs succeed.

## License

MIT. See [LICENSE](./LICENSE).
