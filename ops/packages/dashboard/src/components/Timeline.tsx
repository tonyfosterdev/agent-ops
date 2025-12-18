import type { JournalEvent } from '../types/journal';

interface TimelineProps {
  events: JournalEvent[];
}

export function Timeline({ events }: TimelineProps) {
  if (events.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        No events yet. Start a run to see the timeline.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => (
        <TimelineEntry key={event.id} event={event} />
      ))}
    </div>
  );
}

function TimelineEntry({ event }: { event: JournalEvent }) {
  const timestamp = new Date(event.created_at).toLocaleTimeString();

  switch (event.type) {
    case 'RUN_STARTED': {
      const payload = event.payload as { prompt: string; user_id: string };
      return (
        <div className="border-l-4 border-green-500 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs">
              RUN STARTED
            </span>
          </div>
          <div className="mt-1 text-gray-700">
            <strong>Prompt:</strong> {payload.prompt}
          </div>
        </div>
      );
    }

    case 'AGENT_THOUGHT': {
      const payload = event.payload as { text_content: string };
      return (
        <div className="border-l-4 border-blue-500 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">
              THOUGHT
            </span>
          </div>
          <div className="mt-1 text-blue-600 whitespace-pre-wrap">
            {payload.text_content}
          </div>
        </div>
      );
    }

    case 'TOOL_PROPOSED': {
      const payload = event.payload as {
        tool_name: string;
        args: Record<string, unknown>;
        call_id: string;
      };
      return (
        <div className="border-l-4 border-yellow-500 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs">
              TOOL PROPOSED
            </span>
          </div>
          <div className="mt-2 bg-yellow-50 rounded p-4 border border-yellow-200">
            <div className="font-semibold text-yellow-800">{payload.tool_name}</div>
            <pre className="mt-2 text-sm text-gray-600 overflow-x-auto">
              {JSON.stringify(payload.args, null, 2)}
            </pre>
          </div>
        </div>
      );
    }

    case 'RUN_SUSPENDED': {
      const payload = event.payload as { reason: string };
      return (
        <div className="border-l-4 border-orange-500 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded text-xs">
              SUSPENDED
            </span>
          </div>
          <div className="mt-1 text-orange-600">{payload.reason}</div>
        </div>
      );
    }

    case 'RUN_RESUMED': {
      const payload = event.payload as { decision: string; feedback?: string };
      const isApproved = payload.decision === 'approved';
      return (
        <div
          className={`border-l-4 ${isApproved ? 'border-green-500' : 'border-red-500'} pl-4 py-2`}
        >
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                isApproved
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {isApproved ? 'APPROVED' : 'REJECTED'}
            </span>
          </div>
          {payload.feedback && (
            <div className="mt-1 text-gray-600 italic">{payload.feedback}</div>
          )}
        </div>
      );
    }

    case 'TOOL_RESULT': {
      const payload = event.payload as {
        call_id: string;
        output_data: unknown;
        status: string;
      };
      const isSuccess = payload.status === 'success';
      return (
        <div
          className={`border-l-4 ${isSuccess ? 'border-green-500' : 'border-red-500'} pl-4 py-2`}
        >
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                isSuccess
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              {isSuccess ? 'SUCCESS' : 'ERROR'}
            </span>
          </div>
          <div className="mt-2 bg-gray-50 rounded p-2 border">
            <pre className="text-sm text-gray-600 overflow-x-auto max-h-48">
              {typeof payload.output_data === 'string'
                ? payload.output_data.slice(0, 500)
                : JSON.stringify(payload.output_data, null, 2).slice(0, 500)}
            </pre>
          </div>
        </div>
      );
    }

    case 'RUN_COMPLETED': {
      const payload = event.payload as { summary: string };
      return (
        <div className="border-l-4 border-green-600 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-green-600 text-white px-2 py-0.5 rounded text-xs">
              COMPLETED
            </span>
          </div>
          <div className="mt-1 text-green-700">{payload.summary}</div>
        </div>
      );
    }

    case 'SYSTEM_ERROR': {
      const payload = event.payload as { error_details: string };
      return (
        <div className="border-l-4 border-red-600 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs">
              ERROR
            </span>
          </div>
          <div className="mt-1 text-red-600">{payload.error_details}</div>
        </div>
      );
    }

    default:
      return (
        <div className="border-l-4 border-gray-300 pl-4 py-2">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-mono">{timestamp}</span>
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">
              {event.type}
            </span>
          </div>
          <pre className="mt-1 text-sm text-gray-600">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      );
  }
}
