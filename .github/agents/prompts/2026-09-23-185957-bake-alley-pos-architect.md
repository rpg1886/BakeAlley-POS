# Prompt Tracking: Bake Alley POS Architect

## Timestamp

2026-09-23 18:59:57 local time

## User Prompt

Create a reusable custom agent for a Lead Full-Stack Architect and Desktop POS Engineer specializing in the Bake Alley local-first baking-supply POS. The agent must cover Electron, React, TypeScript, Tailwind, Vite, better-sqlite3, PostgreSQL, Express, transactional outbox synchronization, UUID keys, decimal precision, FEFO lot tracking, UOM conversions, pricing tiers, scale and thermal-printer integrations, strict typing, and documentation updates. Also create or update `docs/Functional-design.md` and create a timestamped tracking file under `.github/agents/prompts`.

## Reasoning Summary

- The requested behavior is a workspace-specific reusable persona, so a `.github/agents/*.agent.md` custom agent is the correct customization primitive.
- The agent receives only the tools needed for implementation and validation: read, search, edit, and execute.
- Existing repository guidance in `instructions.md` was treated as the source of local architecture rules.
- The functional design records the canonical architecture, domain entities, numerical guarantees, FEFO behavior, transactional outbox workflow, and hardware boundaries.
- The existing `database/init.sql` is documented as the current baseline while noting that future schema work should converge on the canonical blueprint.

## Generated Artifacts

- `.github/agents/bake-alley-pos-architect.agent.md`
- `docs/Functional-design.md`
- `.github/agents/prompts/2026-09-23-185957-bake-alley-pos-architect.md`

## Validation

- Verified the requested workspace directories were created through the file edits.
- Existing SQLite validation remains available through the installed Python and SQLite tooling.

## Follow-up Implementation

The Phase 1 SQLite initializer was implemented in `src/db/schema.ts` using `better-sqlite3`. It defines UUID text keys, four-decimal quantity checks, catalog and UOM entities, product variants, pricing tiers, customers, inventory lots, orders, order items, the transactional outbox queue, and sync state. The functional design was updated to identify this file as the application initializer.

Validation completed:

- `npm run typecheck` passed under strict TypeScript settings.
- An in-memory `better-sqlite3` smoke test passed for table creation, tracked-lot enforcement, and quantity precision checks.