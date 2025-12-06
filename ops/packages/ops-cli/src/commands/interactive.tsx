import React from 'react';
import { render } from 'ink';
import { App } from '../ui/App.js';

export async function interactiveCommand() {
  // Clear screen and move cursor to top
  console.clear();
  render(<App />);
}
