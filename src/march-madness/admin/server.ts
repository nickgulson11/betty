import express from 'express';
import path from 'path';
import cors from 'cors';
import { requireAuth } from './middleware/auth';

// Import routes
import authRoutes from './routes/auth';
import poolRoutes from './routes/pool';
import participantRoutes from './routes/participants';
import pickRoutes from './routes/picks';
import bettyRoutes from './routes/betty';
import teamRoutes from './routes/teams';

export function setupAdminRoutes(app: express.Application): void {
  // Middleware
  app.use(express.json());
  app.use(cors());

  // Serve static files (admin frontend)
  const publicPath = path.join(__dirname, 'public');
  app.use('/admin', express.static(publicPath));

  // Serve index.html at /admin root
  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/pool', requireAuth, poolRoutes);
  app.use('/api/participants', requireAuth, participantRoutes);
  app.use('/api/picks', requireAuth, pickRoutes);
  app.use('/api/betty', requireAuth, bettyRoutes);
  app.use('/api/teams', requireAuth, teamRoutes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Betty March Madness' });
  });

  console.log('✅ Admin routes configured');
}
