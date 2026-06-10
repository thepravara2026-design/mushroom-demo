Layered Project Scaffolding — docs

Files and folders created:
- backend/src/{config,controllers,services,repositories,models,middleware,errors,utils}
- backend/migrations
- backend/tests
- frontend/src/{components,pages,api,services,store,hooks,styles,utils}
- docs/{ARCHITECTURE.md,MIGRATION_PLAN.md}

What I added:
- `backend/src/errors/AppError.js` (example AppError class)
- `backend/src/utils/errorHandler.js` (Express-style error handler)
- `frontend/src/api/client.js` already existed; central API helper pattern is recommended.

Next suggested steps:
1. Review the architecture doc in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
2. Approve moving one feature (suggest starting with Auth)
3. I will copy source files into new folders and create compatibility export files to avoid breaking imports.

Say which feature to migrate first, or approve a full-branch migration.
