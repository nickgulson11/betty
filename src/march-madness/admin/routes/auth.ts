import express, { Request, Response } from 'express';
import { validatePassword } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/auth/login
 * Authenticate admin user
 */
router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  if (validatePassword(password)) {
    res.json({
      success: true,
      token: password, // Simple token = password for now
      message: 'Login successful',
    });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal)
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
