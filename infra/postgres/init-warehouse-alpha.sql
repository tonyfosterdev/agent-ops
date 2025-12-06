-- Warehouse Alpha Database Initialization
-- This file runs once when the container is first created

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE warehouse_alpha_db TO warehouseuser;

-- Note: Tables will be created by TypeORM migrations
