-- Store Database Initialization
-- This file runs once when the container is first created

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE store_db TO storeuser;

-- Note: Tables will be created by TypeORM migrations
