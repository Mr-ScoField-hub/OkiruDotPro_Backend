# Okiru Server

A Node.js/Express backend API for the Okiru BEE (Broad-Based Black Economic Empowerment) scorecard platform.

## Architecture

- **Runtime**: Node.js 20 with TypeScript (via `tsx` in dev)
- **Framework**: Express 5
- **Database**: MongoDB (via Mongoose) — connection provided via `MONGODB_URI` secret
- **Session Store**: `connect-mongo` (sessions stored in MongoDB)
- **File uploads**: Multer (in-memory)
- **Excel parsing**: XLSX library via `pipeline/excelParser.ts`

## Project Structure

```
index.ts          - Main server entry point
routes.ts         - All API route handlers
storage.ts        - Data access layer (MongoDB operations)
models.ts         - Mongoose models
db.ts             - MongoDB connection logic
vite.ts           - (unused in current setup) Vite middleware stub
pipeline/         - BEE scorecard calculation pipeline
  index.ts        - Pipeline orchestrator
  types.ts        - Shared types
  calculators.ts  - Scorecard calculators
  entityExtractor.ts
  excelParser.ts
  industryNorms.ts
  levelDetermination.ts
  suggestions.ts
  textSimilarity.ts
  buildResult.ts
```

## Key Features

- Authentication (register/login/logout) with bcrypt + express-session
- Multi-tenant: users belong to organizations
- Client management with full BEE data (shareholders, employees, suppliers, etc.)
- Excel import pipeline to auto-extract BEE scorecard data
- Rate limiting on auth and API routes

## Environment Variables / Secrets

| Key              | Description                        |
|------------------|------------------------------------|
| `MONGODB_URI`    | MongoDB Atlas connection string    |
| `SESSION_SECRET` | Secret for express-session signing |
| `PORT`           | Server port (defaults to 5000)     |
| `CORS_ORIGIN`    | Comma-separated allowed origins    |

## Running

- **Dev**: `npm run dev` — starts on port 5000 with `tsx`
- **Build**: `npm run build` — bundles to `dist/`
- **Production**: `npm run start` — runs bundled output
