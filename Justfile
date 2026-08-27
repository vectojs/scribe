default:
    @just --list

dev:
    bun run dev

verify:
    @bun run format:check
    @bun run lint
    @bun run test
    @bun run build

build:
    bun run build

check:
    bun run check
