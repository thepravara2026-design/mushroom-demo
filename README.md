# Sporekart — Mushroom Shop

Local development and testing instructions for the Sporekart application.

## Run the application (development)
- Start both backend and frontend concurrently:

```bash
npm run dev
```

- Frontend (Vite) will open on `http://localhost:3001/` (or next available port).
- Backend (Express) runs on `http://localhost:5001/` (or next available port).

## Run backend tests

```bash
cd backend
npm install
npm run test
```

## Linting & Formatting

- Fix lint issues automatically (ESLint):

```bash
npx eslint . --ext .js --fix
```

- Format code with Prettier:

```bash
npx prettier --write "**/*.{js,json,md,html,css}"
```

## SonarQube

A `sonar-project.properties` file is included at the repo root. To run a scan, configure a SonarQube server and token and then:

```bash
sonar-scanner -Dsonar.login=YOUR_TOKEN
```

## Notes
- The API responses use a standardized wrapper: `{ success: boolean, data: any, meta: {} }`.
- Validation middleware (`backend/src/middleware/validate.js`) was added and applied to category and product creation endpoints.

If you'd like, I can continue with further improvements: add TypeScript, strengthen tests, or auto-fix remaining ESLint warnings. Let me know which you'd like next.
