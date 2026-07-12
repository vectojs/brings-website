default:
    @just --list

dev:
    @bun run dev

verify:
    @bun run verify

browser-verify project="chromium":
    @env CI=1 DEBUG=pw:webserver bun run test:e2e -- --project "{{project}}"

browser-verify-all:
    @env CI=1 DEBUG=pw:webserver bun run test:e2e

deploy: verify
    @bun run deploy

deploy-production: verify
    @bun run deploy:production
