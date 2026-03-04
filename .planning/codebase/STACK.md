# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- TypeScript 5.9.x - All source code in `src/` (17 modules)

**Secondary:**
- None - single-language codebase

## Runtime

**Environment:**
- Node.js >= 22 (enforced via `engines` in `package.json`)
- Tested against Node.js 22.13.1

**Package Manager:**
- npm 10.9.x
- Lockfile: `package-lock.json` present (committed)

## Frameworks

**CLI:**
- commander 14.x - CLI argument parsing, flag definitions, action handlers (`src/cli.ts`)

**Testing:**
- vitest 4.x - Test runner with `describe`/`it`/`expect` API; config at `vitest.config.ts`

**Build/Dev:**
- tsup 8.x - Bundles `src/cli.ts` to `dist/cli.js` as ESM with shebang; config at `tsup.config.ts`
- tsx 4.x - Dev-mode TypeScript execution (`npx tsx src/cli.ts`)

## Key Dependencies

**Critical (runtime, 4 total):**
- `@octokit/rest` 22.x - GitHub REST API client; used exclusively in `src/github.ts`
- `commander` 14.x - CLI framework; used in `src/cli.ts`
- `zod` 4.x - Schema validation for Claude CLI JSON responses; used in `src/schemas.ts` and `src/analyzer.ts`
- `picocolors` 1.x - Terminal color output; used in `src/output.ts` and `src/cli.ts`

**Dev-only:**
- `typescript` 5.9.x - Compiler (lint via `tsc --noEmit`, no separate linter)
- `@types/node` 25.x - Node.js type definitions
- `tsup` 8.x - Build bundler
- `tsx` 4.x - Dev runner
- `vitest` 4.x - Test runner

## Configuration

**TypeScript (`tsconfig.json`):**
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- `strict: true` - All strict checks enabled
- `resolveJsonModule: true` - Used for JSON fixture imports in tests
- `declaration: true`, `sourceMap: true`
- `outDir: dist`, `rootDir: src`

**Build (`tsup.config.ts`):**
- Entry: `src/cli.ts`
- Format: ESM only (`esm`)
- Target: `node22`
- Prepends `#!/usr/bin/env node` shebang automatically
- Outputs to `dist/`

**Test (`vitest.config.ts`):**
- Excludes `.codereview/**` from test runs (clone working directory)
- No other custom configuration

**Module system (`package.json`):**
- `"type": "module"` - ESM-only; `import`/`export` throughout; `require()` forbidden except `createRequire` for JSON fixture loading in tests

## Platform Requirements

**Development:**
- Node.js >= 22
- `gh` CLI authenticated (`gh auth login`) - required at runtime, not build time
- `claude` CLI installed - required at runtime, not build time

**Production / Distribution:**
- Published as npm binary: `codereview` command maps to `dist/cli.js`
- No bundled server or daemon - pure CLI tool
- User must have `gh` and `claude` CLI tools installed and authenticated

---

*Stack analysis: 2026-03-04*
