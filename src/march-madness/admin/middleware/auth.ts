import { Request, Response, NextFunction } from 'express';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

/**
 * Middleware to require authentication for admin routes
 * Expects: Authorization: Bearer <password>
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized - Missing token' });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (token !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
    return;
  }

  next();
}

/**
 * Validate login credentials
 */
export function validatePassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}
