import { useState } from 'react';

interface CreateRunFormProps {
  onCreated: (runId: string) => void;
  onCreate: (prompt: string, userId: string) => Promise<string>;
}

export function CreateRunForm({ onCreated, onCreate }: CreateRunFormProps) {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const runId = await onCreate(prompt.trim(), 'dashboard-user');
      onCreated(runId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift for newlines)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="prompt" className="block text-sm font-medium text-gray-300 mb-1">
          Task Prompt
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={3}
          placeholder="Describe the task for the agent... (Press Enter to run, Shift+Enter for new line)"
        />
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !prompt.trim()}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Starting...' : 'Start Run'}
      </button>
    </form>
  );
}
