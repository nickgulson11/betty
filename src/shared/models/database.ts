import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Get pool instance (for services that prefer a function)
export const getPool = () => pool;

// Handle unexpected database errors
pool.on('error', (err: Error) => {
  console.error('Unexpected database error:', err);
  // TODO: Alert admin via Slack DM or email in production
});

// Graceful shutdown
export const closePool = async () => {
  await pool.end();
  console.log('Database pool closed');
};

// Test connection
export const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connected successfully at', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
};
