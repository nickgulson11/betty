#!/bin/bash

# Betty Database Setup Script
# This script creates the database and applies the schema

set -e

DB_NAME="betty_dev"
DB_USER="${USER}"

echo "Setting up Betty database..."

# Check if PostgreSQL is running
if ! pg_isready -q; then
  echo "Error: PostgreSQL is not running"
  echo "Please start PostgreSQL first:"
  echo "  - On macOS with Homebrew: brew services start postgresql"
  echo "  - On Linux with systemd: sudo systemctl start postgresql"
  exit 1
fi

# Create database
echo "Creating database '$DB_NAME'..."
createdb "$DB_NAME" 2>/dev/null || echo "Database already exists"

# Apply schema
echo "Applying schema..."
psql -d "$DB_NAME" -f "$(dirname "$0")/schema.sql"

echo "✅ Database setup complete!"
echo ""
echo "Connection string: postgresql://localhost:5432/$DB_NAME"
echo "Add this to your .env file as DATABASE_URL"
