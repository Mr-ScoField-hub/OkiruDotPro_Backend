import type { Express, NextFunction } from "express";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage.js";
import multer from "multer";
import bcrypt from "bcrypt";
import session from "express-session";
import MongoStore from "connect-mongo";
import {
  ShareholderModel, OwnershipDataModel, EmployeeModel, TrainingProgramModel,
  SupplierModel, ProcurementDataModel, EsdContributionModel, SedContributionModel,
  ScenarioModel, FinancialYearModel, ImportLogModel, ExportLogModel,
} from "./models.js";

type Request = ExpressRequest<Record<string, string>, any, any, Record<string, string>>;
type Response = ExpressResponse;

const isProd = process.env.NODE_ENV === "production";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ];
    if (allowed.includes(file.mimetype) || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Only images are allowed.'));
    }
  },
});

declare module 'express-session' {
  interface SessionData {
    userId: string;
    organizationId: string;
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: { message: "Too many requests, please slow down bitchhhhhh." },
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

async function verifyClientAccess(req: Request, res: Response): Promise<boolean> {
  const clientId = req.params.id;
  if (!clientId) return true;
  const client = await storage.getClient(clientId);
  if (!client) {
    res.status(404).json({ message: "Client not found" });
    return false;
  }
  if (client.organizationId !== req.session.organizationId) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const sessionSecret = process.env.SESSION_SECRET;
  if (isProd && !sessionSecret) {
    console.error("[SECURITY] SESSION_SECRET environment variable is required in production!");
    process.exit(1);
  }

  app.use(session({
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      ttl: 7 * 24 * 60 * 60,
    }),
    secret: sessionSecret || 'okiru-dev-secret-local-only',
    resave: false,
    saveUninitialized: false,
    name: 'okiru.sid',
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: 'none' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use('/api/', apiLimiter);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: isProd ? 'production' : 'development',
    });
  });

  app.get('/', (_req: Request, res: Response) => {
    return res.json({ status: "ok", name: "Okiru Backend", version: "1.0.0" });
  });

  app.post('/api/auth/register', authLimiter, async (req: Request, res: Response) => {
    try {
      const { username, password, fullName, email, organizationName } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      if (username.length < 3 || username.length > 50) {
        return res.status(400).json({ message: "Username must be 3-50 characters" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already taken" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const org = await storage.createOrganization({ name: organizationName || `${username}'s Organization` });
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        fullName: fullName || username,
        email: email || null,
        organizationId: org.id,
      });

      req.session.userId = user.id;
      req.session.organizationId = org.id;

      return res.json({
        user: { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, organizationId: org.id, profilePicture: user.profilePicture },
        organization: org,
      });
    } catch (error: any) {
      console.error('Register error:', error);
      return res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      req.session.userId = user.id;
      req.session.organizationId = user.organizationId || '';

      return res.json({
        user: { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, organizationId: user.organizationId, profilePicture: user.profilePicture },
      });
    } catch (error: any) {
      console.error('Login error:', error);
      return res.status(500).json({ message: "Login failed" });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.clearCookie('okiru.sid');
      res.json({ message: "Logged out" });
    });
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    return res.json({
      user: { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, organizationId: user.organizationId, profilePicture: user.profilePicture },
    });
  });

  app.patch('/api/profile', requireAuth, async (req: Request, res: Response) => {
    try {
      const { fullName, email } = req.body;
      const updated = await storage.updateUser(req.session.userId!, { fullName, email });
      if (!updated) return res.status(404).json({ message: "User not found" });
      return res.json({ user: { id: updated.id, username: updated.username, fullName: updated.fullName, email: updated.email, role: updated.role, organizationId: updated.organizationId, profilePicture: updated.profilePicture } });
    } catch (error: any) {
      return res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post('/api/profile/picture', requireAuth, upload.single('picture'), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const updated = await storage.updateUser(req.session.userId!, { profilePicture: base64 });
      if (!updated) return res.status(404).json({ message: "User not found" });
      return res.json({ user: { id: updated.id, username: updated.username, fullName: updated.fullName, email: updated.email, role: updated.role, organizationId: updated.organizationId, profilePicture: updated.profilePicture } });
    } catch (error: any) {
      return res.status(500).json({ message: "Failed to upload picture" });
    }
  });

  app.get('/api/clients', requireAuth, async (req: Request, res: Response) => {
    const orgId = req.session.organizationId!;
    const result = await storage.getClientsByOrg(orgId);
    return res.json(result);
  });

  app.post('/api/clients', requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.organizationId!;
      const client = await storage.createClient({ ...req.body, organizationId: orgId });
      return res.json(client);
    } catch (error: any) {
      console.error('Create client error:', error);
      return res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.get('/api/clients/:id', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const client = await storage.getClient(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    return res.json(client);
  });

  app.patch('/api/clients/:id', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const client = await storage.updateClient(req.params.id, req.body);
    if (!client) return res.status(404).json({ message: "Client not found" });
    return res.json(client);
  });

  app.delete('/api/clients/:id', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const clientId = req.params.id;
    await Promise.all([
      ShareholderModel.deleteMany({ clientId }),
      OwnershipDataModel.deleteMany({ clientId }),
      EmployeeModel.deleteMany({ clientId }),
      TrainingProgramModel.deleteMany({ clientId }),
      SupplierModel.deleteMany({ clientId }),
      ProcurementDataModel.deleteMany({ clientId }),
      EsdContributionModel.deleteMany({ clientId }),
      SedContributionModel.deleteMany({ clientId }),
      ScenarioModel.deleteMany({ clientId }),
      FinancialYearModel.deleteMany({ clientId }),
      ImportLogModel.deleteMany({ clientId }),
      ExportLogModel.deleteMany({ clientId }),
    ]);
    await storage.deleteClient(clientId);
    return res.json({ message: "Deleted" });
  });

  app.post('/api/clients/:id/logo', requireAuth, upload.single('logo'), async (req: Request, res: Response) => {
    try {
      if (!(await verifyClientAccess(req, res))) return;
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const updated = await storage.updateClient(req.params.id, { logo: base64 } as any);
      if (!updated) return res.status(404).json({ message: "Client not found" });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: "Failed to upload logo" });
    }
  });

  app.get('/api/clients/:id/data', requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await verifyClientAccess(req, res))) return;
      const clientId = req.params.id;
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const [
        financialYearsData, shareholdersData, ownershipDataResult,
        employeesData, trainingProgramsData, suppliersData, procurementDataResult,
        esdData, sedData, scenariosData
      ] = await Promise.all([
        storage.getFinancialYears(clientId),
        storage.getShareholdersByClient(clientId),
        storage.getOwnershipData(clientId),
        storage.getEmployeesByClient(clientId),
        storage.getTrainingProgramsByClient(clientId),
        storage.getSuppliersByClient(clientId),
        storage.getProcurementData(clientId),
        storage.getEsdContributions(clientId),
        storage.getSedContributions(clientId),
        storage.getScenariosByClient(clientId),
      ]);

      return res.json({
        client,
        financialYears: financialYearsData,
        ownership: {
          ...(ownershipDataResult || { companyValue: 0, outstandingDebt: 0, yearsHeld: 0 }),
          shareholders: shareholdersData,
        },
        management: { employees: employeesData },
        skills: { leviableAmount: client.leviableAmount || 0, trainingPrograms: trainingProgramsData },
        procurement: { tmps: procurementDataResult?.tmps || 0, suppliers: suppliersData },
        esd: { contributions: esdData },
        sed: { contributions: sedData },
        scenarios: scenariosData,
      });
    } catch (error: any) {
      console.error('Get client data error:', error);
      return res.status(500).json({ message: "Failed to load client data" });
    }
  });

  app.post('/api/clients/:id/shareholders', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createShareholder({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/shareholders/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteShareholder(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.patch('/api/shareholders/:id', requireAuth, async (req: Request, res: Response) => {
    const result = await storage.updateShareholder(req.params.id, req.body);
    return res.json(result);
  });

  app.patch('/api/clients/:id/ownership', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.upsertOwnershipData(req.params.id, req.body);
    return res.json(result);
  });

  app.post('/api/clients/:id/employees', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createEmployee({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/employees/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteEmployee(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.post('/api/clients/:id/training-programs', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createTrainingProgram({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/training-programs/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteTrainingProgram(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.post('/api/clients/:id/suppliers', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createSupplier({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/suppliers/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteSupplier(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.patch('/api/clients/:id/procurement', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.upsertProcurementData(req.params.id, req.body.tmps);
    return res.json(result);
  });

  app.post('/api/clients/:id/esd-contributions', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createEsdContribution({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/esd-contributions/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteEsdContribution(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.post('/api/clients/:id/sed-contributions', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createSedContribution({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/sed-contributions/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteSedContribution(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.post('/api/clients/:id/scenarios', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createScenario({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/scenarios/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteScenario(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.post('/api/clients/:id/financial-years', requireAuth, async (req: Request, res: Response) => {
    if (!(await verifyClientAccess(req, res))) return;
    const result = await storage.createFinancialYear({ ...req.body, clientId: req.params.id });
    return res.json(result);
  });

  app.delete('/api/financial-years/:id', requireAuth, async (req: Request, res: Response) => {
    await storage.deleteFinancialYear(req.params.id);
    return res.json({ message: "Deleted" });
  });

  app.get('/api/import-logs', requireAuth, async (req: Request, res: Response) => {
    try {
      const logs = await storage.getImportLogsByUser(req.session.userId!);
      return res.json(logs);
    } catch (error: any) {
      console.error('Get import logs error:', error);
      return res.status(500).json({ message: "Failed to fetch import logs" });
    }
  });

  app.post('/api/export-log', requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await storage.createExportLog({
        ...req.body,
        userId: req.session.userId!,
      });
      return res.json(result);
    } catch (error: any) {
      console.error('Export log error:', error);
      return res.status(500).json({ message: "Failed to log export" });
    }
  });

  app.get('/api/clients/:id/export-logs', requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await verifyClientAccess(req, res))) return;
      const logs = await storage.getExportLogs(req.params.id);
      return res.json(logs);
    } catch (error: any) {
      console.error('Get export logs error:', error);
      return res.status(500).json({ message: "Failed to fetch export logs" });
    }
  });

  return httpServer;
}
