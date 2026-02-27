# Okiru Server

A Node.js/Express backend API for the Okiru B-BBEE (Broad-Based Black Economic Empowerment) scorecard platform. Serves as the multi-tenant backend for user authentication, session management, and client data CRUD. The Excel import pipeline has been moved to the frontend (Vercel).

## Architecture

- **Runtime**: Node.js 20 with TypeScript (via `tsx` in dev)
- **Framework**: Express 5
- **Database**: MongoDB (via Mongoose) — connection provided via `MONGO_URI` secret
- **Session Store**: `connect-mongo` (sessions stored in MongoDB)
- **File uploads**: Multer (in-memory, images only — profile pictures and client logos)

## Project Structure

```
index.ts          - Main server entry point (Express setup, CORS, Helmet, middleware)
routes.ts         - All API route handlers (auth, clients, CRUD, import/export logs)
storage.ts        - Data access layer (MongoDB operations)
models.ts         - Mongoose models
db.ts             - MongoDB connection logic
schema.ts         - Zod validation schemas
tsconfig.json     - TypeScript configuration
```

## API Endpoints

### Auth
- `POST /api/auth/register` — Register user + organization
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `GET /api/auth/me` — Get current user
- `PATCH /api/profile` — Update profile
- `POST /api/profile/picture` — Upload profile picture

### Clients (multi-tenant, org-scoped)
- `GET /api/clients` — List clients
- `POST /api/clients` — Create client
- `GET /api/clients/:id` — Get client
- `PATCH /api/clients/:id` — Update client
- `DELETE /api/clients/:id` — Delete client + all related data
- `POST /api/clients/:id/logo` — Upload client logo
- `GET /api/clients/:id/data` — Get all client data (aggregated)

### Client Sub-entities (CRUD)
- Shareholders: `POST/PATCH/DELETE /api/shareholders/:id`, `POST /api/clients/:id/shareholders`
- Employees: `POST/DELETE /api/employees/:id`, `POST /api/clients/:id/employees`
- Training: `POST/DELETE /api/training-programs/:id`, `POST /api/clients/:id/training-programs`
- Suppliers: `POST/DELETE /api/suppliers/:id`, `POST /api/clients/:id/suppliers`
- Procurement: `PATCH /api/clients/:id/procurement`
- ESD: `POST/DELETE /api/esd-contributions/:id`, `POST /api/clients/:id/esd-contributions`
- SED: `POST/DELETE /api/sed-contributions/:id`, `POST /api/clients/:id/sed-contributions`
- Ownership: `PATCH /api/clients/:id/ownership`
- Scenarios: `POST/DELETE /api/scenarios/:id`, `POST /api/clients/:id/scenarios`
- Financial Years: `POST/DELETE /api/financial-years/:id`, `POST /api/clients/:id/financial-years`

### Logging
- `GET /api/import-logs` — Import history
- `POST /api/export-log` — Log an export
- `GET /api/clients/:id/export-logs` — Export history

### System
- `GET /api/health` — Health check
- `GET /` — Backend info

## Environment Variables / Secrets

| Key              | Description                                              |
|------------------|----------------------------------------------------------|
| `MONGO_URI`      | MongoDB Atlas connection string                          |
| `SESSION_SECRET` | Secret for express-session signing                       |
| `PORT`           | Server port (defaults to 5000)                           |
| `NODE_ENV`       | Environment mode                                         |
| `CORS_ORIGIN`    | Comma-separated allowed origins (e.g. https://www.okiru.pro,https://okiru.pro) |

## Deployment

- **Render**: Deployed from GitHub `main` branch at `https://okirudotpro-backend.onrender.com`
- **Frontend**: React app on Vercel at `https://www.okiru.pro`
- Render env vars: `MONGO_URI`, `SESSION_SECRET`, `CORS_ORIGIN`, `NODE_ENV=production`

## Running

- **Dev**: `npm run dev` — starts on port 5000 with `tsx`
- **Build**: `npm run build` — compiles TypeScript to `dist/`
- **Production**: `npm run start` — runs compiled output from `dist/`
