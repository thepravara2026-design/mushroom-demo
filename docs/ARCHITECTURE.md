Project Architecture — Layered Design

Overview
- Goal: Move the repo to a layered, enterprise-ready structure separating concerns: API routes, controllers, services (business logic), repositories/DB logic, middlewares, config, and shared utilities.
- Non-destructive: original files remain in place. This scaffolding provides an organized target and migration plan.

Backend Layers
- src/config: environment and configuration loaders
- src/routes: Express router definitions (thin, maps to controllers)
- src/controllers: HTTP layer — validate request shape, call services, format responses
- src/services: Business logic, transactions, orchestration
- src/repositories: DB access and queries (single place for SQL/ORM)
- src/models: Data models / types / DTOs
- src/middleware: Auth, validation, error handling
- src/errors: Centralized AppError classes and typed errors
- src/utils: helpers, file handling, logging, validators
- migrations: DB schema and seed scripts
- tests: unit/integration tests

Frontend Layers
- src/pages: top-level page containers (Shop, Admin, Tracker)
- src/components: reusable UI components
- src/services: API wrappers and business helpers
- src/api: thin adapters (fetch helpers) and client configs
- src/store: centralized state management (localStorage wrappers)
- src/hooks: reusable hooks
- src/styles: modular styles and tokens
- src/utils: helpers and shared logic

Migration Guidance
- Copy files into the corresponding new folder gradually and update imports via compatibility index files.
- Keep original paths untouched until migration completes and tests pass.
- Use `docs/MIGRATION_PLAN.md` for planned moves and automated codemods.

Next steps
1. Create compatibility index files to export existing modules from new locations.
2. Move one feature at a time (e.g., auth) and run `node --check` and app flows.
3. Add linters, type checks, and CI pipelines.
