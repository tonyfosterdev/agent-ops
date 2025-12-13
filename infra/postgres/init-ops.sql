-- Ops Database Initialization
-- Used by the agent journaling system

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

GRANT ALL PRIVILEGES ON DATABASE ops_db TO opsuser;

-- Note: Tables will be created by TypeORM synchronize in development
-- or migrations in production
