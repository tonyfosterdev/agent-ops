# Building an AI Ops Agent Part 3: Scaling with Inngest AgentKit

In [Part 1](https://tonyfoster.dev/building-an-ai-ops-agent), I started my journey into building an autonomous AI Ops agent—a digital teammate capable of diagnosing and fixing issues in a distributed system. I established a multi-agent architecture to separate concerns, using specialized agents for log analysis and coding tasks.

In [Part 2](https://tonyfoster.dev/build-an-ai-ops-agent-human-in-the-loop-with-event-driven-agentic-architectures), I built a custom event-driven architecture with a "durable loop" to manage agent state and execution. While it worked, it revealed a hard truth about building agentic systems: **the plumbing is heavy.** Managing state persistence, retries, concurrency, and race conditions took more code than the actual agent logic.

Today, I'm refactoring for production. I'm moving from my custom durable loop to the **Inngest AgentKit**, a framework designed specifically to handle the "hard parts" of durable AI execution.

## Why a Framework?

Building a reliable agent system isn't just about the LLM calls. It's about what happens *between* the calls.
*   **Durability:** What if the server crashes while the agent is thinking?
*   **State:** How do I persist conversation history and tool outputs reliably?
*   **Human-in-the-Loop (HITL):** How do I pause execution for approval without holding open an HTTP connection for hours?

There are other great frameworks emerging in this space. **LangChain/LangGraph** is a popular choice, offering a massive ecosystem, though its complex abstractions can sometimes obscure the underlying logic. **AutoGen** from Microsoft is fantastic for multi-agent conversations but is primarily Python-centric.

I chose the **Inngest AgentKit** for a few key reasons:
1.  **Native TypeScript Support:** It fits perfectly into my existing stack.
2.  **Infrastructure-Level Durability:** Unlike library-level solutions, Inngest manages the execution state at the infrastructure level, handling retries, state persistence, and long-running workflows automatically.
3.  **Developer Experience:** It provides a built-in dashboard for inspecting runs, managing events, and debugging steps.
4.  **OpenTelemetry Support:** It integrates deeply with Otel, which is crucial for observing my agents in production.
5.  **Serverless & Long-Running Compatibility:** Standard HTTP handlers timeout after a few seconds. Inngest detaches execution from the request, allowing agents to run for minutes or hours without timeouts, which is critical for complex tasks.

*[Screenshot Suggestion: The new Inngest-based Architecture Diagram (User -> Hono API -> Inngest Server -> Agents -> Tools)]*

## The Architecture

In this new version, the architecture is distributed across four distinct layers: a **React client** for the UI, a **Hono API** for orchestration, the **Inngest AgentKit** for durable logic, and the **Infrastructure** (Postgres and the Inngest Server) that keeps it all running. Here is how these pieces fit together:

```mermaid
graph TD
    subgraph "Agent Ops Client"
        Dashboard[React Dashboard]
    end

        subgraph "Agent Ops API"
            API[Hono API Server]
        end
        
        subgraph "Durable Async Worker - Inngest AgentKit"
            Function[Inngest Function]
            Network[Agent Network]
            Router[LLM Router]        KV[KV State - Memory]
        HistoryAdapter[History Adapter]
        AgentA[Coding Agent]
        AgentB[Log Analyzer]
        ToolsA[Shell / File Tools]
        ToolsB[Loki / Read Tools]
    end

    subgraph "Infrastructure"
        DB[Postgres]
        InngestSrv[Inngest Server]
    end

    %% Request Flow
    Dashboard -->|POST /api/chat| API
    API -->|Triggers Event| InngestSrv
    API -->|Creates Threads| HistoryAdapter
    HistoryAdapter -->|Persists to| DB
    InngestSrv -->|Invokes| Function
    Function -->|Runs| Network
    Network -->|Reads/Writes| KV
    Network -->|Uses| HistoryAdapter
    Network -->|Consults| Router
    Router -->|Routes to| AgentA
    Router -->|Routes to| AgentB
    AgentA -->|Uses| ToolsA
    AgentB -->|Uses| ToolsB

    %% Real-time Streaming
    Function -->|publish| InngestSrv
    InngestSrv -->|WebSocket| Dashboard
    Dashboard -->|GET /api/realtime/token| API

    %% HITL Approval Flow
    Dashboard -->|POST /api/approve-tool| API
    API -->|Approval Event| InngestSrv
```

### 1. The Trigger: Hono API
Everything starts with a standard web request. I use **Hono** as my API server to handle the initial chat request, authentication, and WebSocket token generation.

When the dashboard sends a message to `/api/chat`, Hono doesn't run the agent directly. Instead, it pushes an event to Inngest and immediately responds with the thread ID. This keeps the API snappy and resilient.

```typescript
// ops/src/server.ts
app.post('/api/chat', async (c) => {
  // ... validation ...
  
  // Send event to Inngest for durable execution
  await inngest.send({
    name: 'agent/chat.requested',
    data: { threadId, userMessage, userId },
  });

  return c.json({ success: true, threadId });
});
```

### 2. The Container: Inngest Function
The event triggers the Inngest Function. This provides the execution context, retries, and durability. If the server restarts, this function ensures we resume exactly where we left off.

```typescript
// ops/src/inngest/functions.ts
export const agentChat = inngest.createFunction(
  { id: 'agent-chat' },
  { event: 'agent/chat.requested' },
  async ({ event, step }) => {
    // The entry point for every agent interaction
    // We instantiate the network here and run it
  }
);
```

### 2. The Brain: Agent Network
Inside the function, we instantiate the **Network**. This is the "meeting room" that holds shared state (memory) and manages the conversation history.

**State & Persistence:**
The network manages two types of state:
1.  **Long-term History:** Using a `historyAdapter`, it automatically loads and saves the conversation to our Postgres database. This ensures that when the agent wakes up, it remembers everything that was said.
2.  **Ephemeral State (KV):** The `network.state.kv` store allows agents to pass data to each other. For example, the `LogAnalyzer` finds an error and puts it in the KV store; the `CodingAgent` then reads that error to know what to fix.

```typescript
// ops/src/network.ts
export function createAgentNetwork({ publish }: FactoryContext) {
  return createNetwork({
    name: 'ops-network',
    agents: [codingAgent, logAnalyzer],
    
    // Built-in History Management
    history: {
      createThread: async ({ state }) => { /* ... */ },
      get: async ({ threadId }) => {
        // Load history from Postgres via our adapter
        const messages = await historyAdapter.get(threadId);
        return convertToAgentResults(messages);
      },
      appendUserMessage: async ({ threadId, userMessage }) => { /* ... */ },
      appendResults: async ({ threadId, newResults }) => { /* ... */ },
    }
  });
}
```

### 3. The Decision Maker: Router
We use an **LLM-based router** to orchestrate the agents. Instead of hardcoding "if X then Y," we let a fast model (`claude-3-5-haiku`) analyze the conversation state and decide which agent is best suited for the next step.

```typescript
    // LLM-based routing logic
    router: async ({ network, input }) => {
      // ... logic for completion checks, sticky routing, etc. ...
      
      // Use a fast model to classify intent
      const decision = await classifyIntentWithLLM(input);
      return decision.agent === 'coding' ? codingAgent : logAnalyzer;
    },
```

### 4. The Workers: Agents
We define our agents using a **factory pattern**. This allows us to inject dependencies—specifically, a `publish` function that I'll use later for streaming real-time updates and requesting human approval.

Here is my **Coding Agent**, which specializes in analysis and repairs:

```typescript
// ops/src/agents/coding.ts
export function createCodingAgent({ publish }: FactoryContext) {
  return createAgent({
    name: 'coding',
    description: 'Code analysis, debugging, and repairs...',
    system: ({ network }) => {
      // Access shared state from other agents
      const logFindings = network?.state.kv.get(STATE_KEYS.LOG_FINDINGS);
      return codingSystemPrompt({ logFindings });
    },
    tools: [
      // Safe tools (read-only)
      readFileTool,
      searchCodeTool,
      // Dangerous tools (require HITL, injected with publish function)
      createShellExecuteTool({ publish }),
      createWriteFileTool({ publish }),
    ],
  });
}

### 5. The Hands: Tools
Finally, agents need to interact with the world. In AgentKit, tools are simply functions that define a schema and a handler. Crucially, because these tools run inside the Inngest context, they can pause execution indefinitely—a feature I leverage heavily for the 'Human-in-the-Loop' safety checks below.

We separate these into "safe" and "dangerous" categories. Safe tools, like `readFile` or `searchCode`, are read-only and can be called autonomously by the agent. Dangerous tools, like `shell_command_execute`, are injected with the `publish` function to trigger the approval flow.

If this hierarchy—Functions, Network, Router, Agents, Tools—sounds familiar, it is because these are the exact same building blocks I hacked together in Part 2. The difference is that I didn't have to write the orchestration engine, the state manager, or the retry logic this time. The framework **formalized** the patterns I was already using, swapping my fragile "glue code" for vetted, production-ready primitives.
```

## Real-Time Updates: From Homegrown SSE to Managed Streaming

In Part 2, I wired up a custom Server-Sent Events (SSE) endpoint to push updates to the client. It worked, but it meant managing connections, heartbeats, and client state myself. The implementation was "push," but it was *my* push implementation to maintain.

In this version, I've replaced that manual plumbing with Inngest's streaming capabilities. I didn't have to spin up a separate Socket.io server or manage connection state. I still push updates, but now I simply call publish within my agent loop...

In my main chat function, I inject a custom `publish` handler into the agent network:

```typescript
// ops/src/inngest/functions.ts
export const agentChat = inngest.createFunction(
  { id: 'agent-chat' },
  { event: 'agent/chat.requested' },
  async ({ event, publish }) => {
    // ... setup
    
    const agentNetwork = createAgentNetwork({ 
      publish: async (chunk) => {
        // Push every token, tool call, and status update to the client via WebSocket
        await publish({
          channel: `user:${userId}`,
          topic: AGENT_STREAM_TOPIC,
          data: { ...chunk, timestamp: Date.now() },
        });
      }
    });

    // Run the network
    await agentNetwork.run(userMessage.content, { /* ... */ });
  }
);
```

The frontend subscribes to this channel using a token generated by my server, creating a snappy, chat-like experience even though the backend is executing complex, long-running durable functions.

## Human-in-the-Loop: A More Intuitive Approach

Allowing an AI to execute shell commands (`rm -rf /` anyone?) requires strict guardrails. In the previous version, I had to manually strip methods and manage state to "pause" the agent. With Inngest, this flow is built-in and significantly more intuitive.

Using `step.waitForEvent`, the agent simply pauses, dehydrates its state, and waits for a specific approval signal. The function effectively "sleeps" in the cloud. We aren't paying for compute while the human is at lunch, and it resumes exactly where it left off once the user clicks "Approve" in the dashboard.

Here is the implementation of my `shell_command_execute` tool:

```typescript
// ops/src/tools/shell-tools.ts
export function createShellExecuteTool({ publish }: FactoryContext) {
  return createTool({
    name: 'shell_command_execute',
    handler: async ({ command }, { step }) => {
      // 1. Generate a unique ID for this specific tool call
      const toolCallId = await step.run('gen-id', () => crypto.randomUUID());

      // 2. Notify the user (via dashboard) that approval is needed
      await step.run('request-approval', async () => {
        await publish(createHitlRequestedEvent({ 
          requestId: toolCallId, 
          toolInput: { command } 
        }));
      });

      // 3. Pause and wait for the 'tool.approval' event
      // This can wait for hours or days!
      const approval = await step.waitForEvent('wait-for-approval', {
        event: 'agentops/tool.approval',
        if: `async.data.toolCallId == "${toolCallId}"`, // Match this specific call
        timeout: '4h',
      });

      if (!approval.data.approved) {
        throw new Error('Command rejected by user');
      }

      // 4. Execute only if approved
      return execSync(command);
    },
  });
}
```

This pattern is incredibly powerful. It gives me safety without sacrificing the autonomy of the agent logic.

## Observability with OpenTelemetry

Finally, you can't improve what you can't measure. I use **OpenTelemetry (Otel)** to trace every thought, tool call, and routing decision my agent makes.

I configure the NodeSDK to include the `InngestSpanProcessor`, which links Inngest's function traces with my application traces.

```typescript
// ops/src/telemetry.ts
sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'agentops',
  }),
  spanProcessors: [
    new BatchSpanProcessor(traceExporter), // Export to Tempo
    new InngestSpanProcessor(inngest),     // Link with Inngest
  ],
});
```

This gives a waterfall view of the entire agent lifecycle. I can see exactly how long the router took, which tools were called, and where latency spikes are occurring.

*[Screenshot Suggestion: Trace Waterfall View in Jaeger/Tempo showing an agent run]*

## What's Next?

I've moved from a custom, brittle loop to a robust, scalable framework. I have real-time streaming, secure human-in-the-loop execution, and deep observability.

But is the agent actually *good* at its job?

In the next part, I'll focus on **Evaluation**. I'll use this foundation to build a testing suite that measures the quality of my agent's decisions and prevents regression as I iterate on its prompts and tools.