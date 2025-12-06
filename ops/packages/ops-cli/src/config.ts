import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get repo root directory (ops/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_FILE = path.join(REPO_ROOT, '.ops-config.json');

export interface CliConfig {
  serverUrl: string;
  username: string;
  password: string;
}

const DEFAULT_CONFIG: CliConfig = {
  serverUrl: 'http://localhost:3200',
  username: 'admin',
  password: 'admin123',
};

export function loadCliConfig(): CliConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveCliConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error loading config, using defaults:', error);
    return DEFAULT_CONFIG;
  }
}

export function saveCliConfig(config: CliConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`Config saved to: ${CONFIG_FILE}`);
}
