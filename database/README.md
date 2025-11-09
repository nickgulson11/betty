# Database Setup

## Prerequisites

- PostgreSQL 15+ installed and running

## Setup Instructions

### 1. Start PostgreSQL

**macOS (Homebrew):**
```bash
brew services start postgresql
```

**Linux (systemd):**
```bash
sudo systemctl start postgresql
```

### 2. Run Setup Script

```bash
./database/setup.sh
```

This will:
- Create the `betty_dev` database
- Apply the schema from `schema.sql`
- Create all necessary tables and indexes

### 3. Update .env

Add the connection string to your `.env` file:
```
DATABASE_URL=postgresql://localhost:5432/betty_dev
```

## Manual Setup

If you prefer to set up manually:

```bash
# Create database
createdb betty_dev

# Apply schema
psql -d betty_dev -f database/schema.sql
```

## Docker Alternative

If you prefer to use Docker:

```bash
docker run --name betty-postgres \
  -e POSTGRES_DB=betty_dev \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:15

# Wait a few seconds for PostgreSQL to start
sleep 5

# Apply schema
psql -h localhost -U postgres -d betty_dev -f database/schema.sql
```

Then update your `.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/betty_dev
```
