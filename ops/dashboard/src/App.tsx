/**
 * App Component - Root component for AgentOps Dashboard.
 *
 * Sets up the application with:
 * - AgentProvider for useAgents hook configuration
 * - Health check for server connectivity
 * - Theme provider with dark mode support
 * - Chat interface
 *
 * ## Architecture
 *
 * The dashboard uses @inngest/use-agent for communication:
 * - AgentProvider: Configures userId and baseUrl for the hook
 * - Chat.tsx: Main chat interface using useAgents
 * - MessageList.tsx: Message rendering with ConversationMessage types
 * - ToolApproval.tsx: HITL approval UI
 *
 * ## Future Improvements
 * - Add authentication
 * - Add thread history sidebar
 * - Add settings panel
 * - Support multiple concurrent threads
 */

import { useState, useEffect, createContext, useContext } from 'react';
import { AgentProvider } from '@inngest/use-agent';
import { Chat } from '@/components/Chat';
import { healthCheck } from '@/api/client';

// Theme context
type Theme = 'light' | 'dark';
interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check localStorage, default to dark
    const stored = localStorage.getItem('theme');
    return (stored as Theme) || 'dark';
  });

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Server status indicator.
 */
function ServerStatus({
  status,
}: {
  status: 'checking' | 'connected' | 'disconnected';
}) {
  const colors = {
    checking: 'bg-yellow-500',
    connected: 'bg-green-500',
    disconnected: 'bg-red-500',
  };

  const labels = {
    checking: 'Checking...',
    connected: 'Connected',
    disconnected: 'Disconnected',
  };

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      <span className={`w-2 h-2 rounded-full ${colors[status]}`} />
      <span>{labels[status]}</span>
    </div>
  );
}

/**
 * Connection error screen shown when server is unavailable.
 */
function ConnectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-red-600 dark:text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Cannot Connect to Agent Server
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          The agent server is not responding. Please ensure it is running on port
          3200.
        </p>
        <div className="space-y-3">
          <button
            onClick={onRetry}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Retry Connection
          </button>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            <p>To start the server, run:</p>
            <code className="bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded text-xs block mt-1">
              cd ops && npm run dev:server
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Loading screen shown during initial connection.
 */
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
        <p className="text-gray-600 dark:text-gray-400">Connecting to agent server...</p>
      </div>
    </div>
  );
}

function App() {
  // For now, use a hardcoded user ID
  // In production, this would come from authentication
  const userId = 'dashboard-user';

  const [serverStatus, setServerStatus] = useState<
    'checking' | 'connected' | 'disconnected'
  >('checking');

  const checkConnection = async () => {
    setServerStatus('checking');
    try {
      await healthCheck();
      setServerStatus('connected');
    } catch {
      setServerStatus('disconnected');
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  if (serverStatus === 'checking') {
    return <LoadingScreen />;
  }

  if (serverStatus === 'disconnected') {
    return <ConnectionError onRetry={checkConnection} />;
  }

  return (
    <ThemeProvider>
      <AgentProvider
        userId={userId}
        transport={{
          api: {
            sendMessage: '/api/chat',
            getRealtimeToken: '/api/realtime/token',
            fetchThreads: '/api/threads',
            fetchHistory: '/api/threads/{threadId}/history',
            createThread: '/api/threads',
            deleteThread: '/api/threads/{threadId}',
            approveToolCall: '/api/approve-tool',
          },
        }}
      >
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          {/* Status bar */}
          <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg px-3 py-2 z-50">
            <ServerStatus status={serverStatus} />
          </div>

          <Chat />
        </div>
      </AgentProvider>
    </ThemeProvider>
  );
}

export default App;
