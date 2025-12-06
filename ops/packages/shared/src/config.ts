/**
 * Enhanced configuration loader with agent-specific overrides
 *
 * Configuration hierarchy:
 * 1. Base environment variables (shared)
 * 2. Agent-specific environment variables (override base)
 * 3. Runtime overrides (highest priority)
 */

import * as dotenv from 'dotenv';
import type { AgentConfig } from './types';
import { validateApiKey, sanitizeApiKey } from './utils/validators';

// Load environment variables
dotenv.config();

/**
 * Load base configuration (shared across all agents)
 */
function loadBaseConfig(): Partial<AgentConfig> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required. Please set it in your .env file.'
    );
  }

  validateApiKey(apiKey);

  const maxSteps = parseInt(process.env.MAX_STEPS || '10', 10);
  const workDir = process.env.WORK_DIR || process.cwd();
  const logLevel = (process.env.LOG_LEVEL || 'info') as 'info' | 'debug' | 'error';

  // Validate log level
  if (!['info', 'debug', 'error'].includes(logLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL: ${logLevel}. Must be one of: info, debug, error`
    );
  }

  return {
    apiKey,
    maxSteps,
    workDir,
    logLevel,
  };
}

/**
 * Load coding agent-specific configuration
 */
function loadCodingAgentConfig(base: Partial<AgentConfig>): AgentConfig {
  const model = process.env.CODING_MODEL || process.env.MODEL || 'claude-3-5-haiku-20241022';
  const maxSteps = process.env.CODING_MAX_STEPS
    ? parseInt(process.env.CODING_MAX_STEPS, 10)
    : base.maxSteps || 10;

  return {
    ...base,
    model,
    maxSteps,
    agentType: 'coding',
  } as AgentConfig;
}

/**
 * Load log analyzer agent-specific configuration
 */
function loadLogAnalyzerConfig(base: Partial<AgentConfig>): AgentConfig {
  const model = process.env.LOG_ANALYZER_MODEL || process.env.MODEL || 'claude-3-5-haiku-20241022';
  const maxSteps = process.env.LOG_ANALYZER_MAX_STEPS
    ? parseInt(process.env.LOG_ANALYZER_MAX_STEPS, 10)
    : base.maxSteps || 15;

  return {
    ...base,
    model,
    maxSteps,
    agentType: 'log-analyzer',
  } as AgentConfig;
}

/**
 * Load orchestration agent-specific configuration
 */
function loadOrchestrationConfig(base: Partial<AgentConfig>): AgentConfig {
  const model = process.env.ORCHESTRATION_MODEL || process.env.MODEL || 'claude-3-5-haiku-20241022';
  const maxSteps = process.env.ORCHESTRATION_MAX_STEPS
    ? parseInt(process.env.ORCHESTRATION_MAX_STEPS, 10)
    : 5; // Thin orchestrator - just routing, not execution

  return {
    ...base,
    model,
    maxSteps,
    agentType: 'orchestration',
  } as AgentConfig;
}

/**
 * Load configuration for a specific agent type
 *
 * @param agentType - Type of agent to configure
 * @param overrides - Optional runtime configuration overrides
 * @returns Complete AgentConfig for the specified agent
 */
export function loadConfig(
  agentType: 'coding' | 'log-analyzer' | 'orchestration',
  overrides?: Partial<AgentConfig>
): AgentConfig {
  const base = loadBaseConfig();

  let config: AgentConfig;

  switch (agentType) {
    case 'coding':
      config = loadCodingAgentConfig(base);
      break;
    case 'log-analyzer':
      config = loadLogAnalyzerConfig(base);
      break;
    case 'orchestration':
      config = loadOrchestrationConfig(base);
      break;
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }

  // Apply runtime overrides
  if (overrides) {
    config = { ...config, ...overrides };
  }

  return config;
}

/**
 * Display current configuration (with masked API key)
 */
export function displayConfig(config: AgentConfig): void {
  console.log(`\n${config.agentType.toUpperCase()} Agent Configuration:`);
  console.log(`  Model: ${config.model}`);
  console.log(`  Max Steps: ${config.maxSteps}`);
  console.log(`  Work Directory: ${config.workDir}`);
  console.log(`  Log Level: ${config.logLevel}`);
  console.log(`  API Key: ${sanitizeApiKey(config.apiKey)}`);
  console.log('');
}

/**
 * Get Loki configuration (for log analyzer agent)
 */
export function getLokiConfig() {
  return {
    url: process.env.LOKI_URL || 'http://loki.localhost',
    queryLimit: parseInt(process.env.LOKI_QUERY_LIMIT || '1000', 10),
  };
}

/**
 * Get path mapping configuration (for Docker-to-local path translation)
 */
export function getPathMappingConfig() {
  return {
    dockerWorkspace: process.env.DOCKER_WORKSPACE_PATH || '/workspace',
    localWorkspace: process.env.WORK_DIR || process.cwd(),
  };
}
