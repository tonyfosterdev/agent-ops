-- Agent Database Schema
-- Creates tables for conversation persistence following AgentKit starter patterns.
-- This schema is designed for the dedicated agent-db PostgreSQL instance.

-- Thread table stores conversation threads
CREATE TABLE IF NOT EXISTS agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT,  -- Optional thread title for display
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message table stores individual messages within threads
-- Enhanced for multi-agent attribution and deduplication
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('user', 'agent', 'tool')),
  agent_name TEXT,  -- NULL for user messages, agent name for agent/tool messages
  role TEXT NOT NULL,
  content JSONB NOT NULL,
  checksum TEXT,  -- For deduplication of identical messages
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Prevent duplicate messages within a thread (based on content checksum)
  UNIQUE (thread_id, checksum)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_messages_thread ON agent_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON agent_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_threads_user ON agent_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated ON agent_threads(updated_at);

-- Function to automatically update updated_at timestamp on threads
CREATE OR REPLACE FUNCTION update_thread_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE agent_threads SET updated_at = NOW() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update thread timestamp when messages are added
DROP TRIGGER IF EXISTS trigger_update_thread_timestamp ON agent_messages;
CREATE TRIGGER trigger_update_thread_timestamp
  AFTER INSERT ON agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_timestamp();
