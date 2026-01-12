/**
 * Prompt exports for agent system prompts.
 *
 * This module centralizes all system prompts used by agents and the router.
 * Each prompt is a function (or constant) that returns the prompt string,
 * allowing for dynamic context injection where needed.
 */

export { codingSystemPrompt, type CodingPromptContext } from './codingPrompt';
export { logAnalyzerSystemPrompt, type LogAnalyzerPromptContext } from './logAnalyzerPrompt';
export { ROUTER_SYSTEM_PROMPT } from './routerPrompt';
