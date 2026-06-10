Migration Plan (Non-destructive)

Principles
- Make changes in the new layered folders first.
- Do not delete or overwrite original files during initial migration.
- Create small compatibility index files (`index.js`) in original locations that re-export from the new layer when a feature is fully migrated.
- Run syntax checks and basic smoke tests after moving each feature.

Phase 1 — Scaffolding
- Create layered folders (done).
- Add `ARCHITECTURE.md` and this `MIGRATION_PLAN.md` (done).

Phase 2 — Auth
- Copy `frontend/src/components/AuthModal.js` to `frontend/src/components/AuthModal.js` (new) and update imports in `frontend/src/app.js` to prefer the new path.
- Add `backend/src/controllers/authController.js` and `backend/src/services/authService.js` that call existing `backend/src/services/authService.js` until fully migrated.

Phase 3 — Products & Categories
- Move product routes to `backend/src/routes/products.js`, controllers to `backend/src/controllers/productsController.js`, repo logic to `backend/src/repositories/productRepository.js`.

Phase 4 — Admin Frontend
- Organize `frontend/admin.html` related scripts into `frontend/src/pages/Admin/*` and `frontend/src/components/Admin/*`.

Phase 5 — Quality
- Add ESLint, Prettier, and a basic GitHub Actions workflow to run `node --check` and tests.

Rollback
- As original files are retained, rollback is restoring original import paths or removing the new compatibility `index.js`.

Notes
- I will create compatibility placeholders and a small `AppError` example in `backend/src/errors` to demonstrate the pattern.
