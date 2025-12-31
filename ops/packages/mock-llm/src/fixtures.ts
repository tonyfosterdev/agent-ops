import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_DIR = process.env.FIXTURE_DIR || path.join(__dirname, '..', 'fixtures');
const DEFAULT_FIXTURE = process.env.DEFAULT_FIXTURE || 'default.json';

// State for active fixture (can be set via API)
let activeFixture: string = DEFAULT_FIXTURE;

// Queue of fixtures to return in sequence
let fixtureQueue: string[] = [];

export interface LLMFixture {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  // For OpenAI-compatible format
  message?: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  finish_reason?: string;
}

/**
 * Set the active fixture to use for subsequent requests
 */
export function setActiveFixture(fixture: string): void {
  activeFixture = fixture;
}

/**
 * Queue multiple fixtures to return in sequence
 */
export function queueFixtures(fixtures: string[]): void {
  fixtureQueue = [...fixtures];
}

/**
 * Get the active fixture name
 */
export function getActiveFixture(): string {
  return activeFixture;
}

/**
 * Clear the fixture queue
 */
export function clearQueue(): void {
  fixtureQueue = [];
}

/**
 * Load and parse a fixture file
 */
export function loadFixture(): LLMFixture {
  // If queue has items, pop and use next fixture
  let fixtureToLoad = activeFixture;
  if (fixtureQueue.length > 0) {
    fixtureToLoad = fixtureQueue.shift()!;
  }

  const fixturePath = path.join(FIXTURE_DIR, fixtureToLoad);

  try {
    const content = fs.readFileSync(fixturePath, 'utf-8');
    return JSON.parse(content) as LLMFixture;
  } catch (error) {
    console.error(`Failed to load fixture: ${fixturePath}`, error);
    // Return a default response if fixture not found
    return {
      content: [
        {
          type: 'text',
          text: `Fixture not found: ${fixtureToLoad}. Using default response.`,
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }
}

/**
 * List all available fixtures
 */
export function listFixtures(): string[] {
  try {
    const files = fs.readdirSync(FIXTURE_DIR);
    return files.filter((f) => f.endsWith('.json'));
  } catch (error) {
    console.error('Failed to list fixtures:', error);
    return [];
  }
}
