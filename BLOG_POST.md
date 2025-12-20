# Building Durable AI Agents with Event Sourcing and Human-in-the-Loop

*What if AI agents could pause mid-task, wait for human approval, and resume exactly where they left off—even after a server crash?*

---

Building on my [previous ops agent project](https://tonyfoster.dev/building-an-ai-ops-agent), I wanted to solve a fundamental problem: **how do you give AI agents real power without giving them too much rope?**

The answer came from an unexpected place—event sourcing, a pattern I'd used for years in distributed systems. By treating agent execution as a series of immutable events rather than ephemeral state, I could build agents that are durable, auditable, and interruptible.

## The Problem: Autonomous Agents Are Dangerous

When I first built my ops agent framework, agents could execute shell commands, modify files, and restart services. This is powerful—an agent could genuinely debug and fix a production issue. But it's also terrifying.

What happens when the agent decides to run `rm -rf` on the wrong directory? Or makes a "fix" that breaks everything worse? The agent has no concept of "wait, let me think about this more carefully."

The traditional solutions felt inadequate:
- **Sandboxing**: Limits what agents can do, defeating the purpose
- **Confirmation dialogs**: Interrupt the flow, lose context
- **"Safe mode"**: Agents become useless

I needed agents that could *propose* dangerous actions, *pause* for human review, and *resume* seamlessly after approval—without losing any state.

## The Solution: Event-Sourced Agents

Here's the key insight: if you record every action as an immutable event in a journal, you get durability and human-in-the-loop for free.

```
┌─────────────────────────────────────────────────┐
│                Event Journal                     │
│  ┌──────────────────────────────────────────┐   │
│  │ 1. RUN_STARTED { prompt: "Fix the bug" } │   │
│  │ 2. AGENT_THOUGHT { text: "I'll check..." }│  │
│  │ 3. TOOL_PROPOSED { shell: "npm test" }   │   │
│  │ 4. RUN_SUSPENDED { reason: "Dangerous" }  │   │
│  │    ─── waiting for human ───              │   │
│  │ 5. RUN_RESUMED { decision: "approved" }   │   │
│  │ 6. TOOL_RESULT { output: "All pass" }     │   │
│  │ 7. RUN_COMPLETED { summary: "Fixed!" }    │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

The journal becomes the single source of truth. To know the current state, replay the events. To resume after a crash, replay the events. To audit what happened, read the events.

This is event sourcing applied to AI agents.

## The State Machine

Every agent run follows a simple state machine:

```
          ┌──────────────────────────────────────┐
          │                                      │
          ▼                                      │
      ┌───────┐     RUN_STARTED     ┌─────────┐  │
─────▶│pending│────────────────────▶│ running │  │
      └───────┘                     └────┬────┘  │
                                         │       │
              ┌──────────────────────────┼───────┘
              │                          │
              │ dangerous tool           │ agent done
              ▼                          ▼
        ┌───────────┐              ┌───────────┐
        │ suspended │              │ completed │
        └─────┬─────┘              └───────────┘
              │
              │ approved/rejected
              │
              └──────▶ running
```

Five states, clear transitions, fully deterministic. The magic happens in the `suspended` state—that's where human oversight lives.

## The DurableLoop: One Step at a Time

The core execution engine—I call it the DurableLoop—has one crucial constraint:

```typescript
const result = await generateText({
  model: anthropic('claude-sonnet-4-20250514'),
  maxSteps: 1,  // Execute exactly ONE step
  system: getSystemPrompt(),
  messages,
  tools: preparedTools,
});
```

**`maxSteps: 1`**. This is the key.

After every single LLM interaction, we persist state to the journal. If the server crashes, we lose nothing—just replay the journal and pick up where we left off.

This is different from the typical "let the LLM run until it's done" approach. That approach is fragile. Memory is volatile. A crash means starting over. And there's no opportunity to intervene.

With single-step execution:
1. LLM produces response
2. We record events to journal
3. If tool is dangerous, we suspend
4. Human reviews, approves/rejects
5. We record decision to journal
6. Execution continues

Every step is a checkpoint.

## Tool Stripping: The Clever Bit

How do you let the LLM *propose* a dangerous tool without *executing* it? You strip the `execute` function.

```typescript
for (const [name, tool] of Object.entries(allTools)) {
  if (isDangerousTool(name)) {
    // Remove the execute function entirely
    const { execute, ...rest } = tool;
    preparedTools[name] = rest;
  } else {
    preparedTools[name] = tool;
  }
}
```

The Vercel AI SDK still sends the tool definition to the LLM—it knows the tool exists, what parameters it takes, when to use it. But when the LLM tries to call it, there's no `execute` function, so it returns immediately with a tool call proposal but no result.

The DurableLoop catches this:

```typescript
if (isDangerousTool(toolCall.toolName)) {
  // Record the proposal
  await journal.appendEvent({ type: 'TOOL_PROPOSED', ... });
  // Suspend the run
  await journal.appendEvent({ type: 'RUN_SUSPENDED', ... });
  await journal.updateStatus('suspended');
  return; // Stop here, wait for human
}
```

The agent proposes, the human disposes.

## The Approval UI

When a run suspends, the Dashboard shows an inline approval component:

**[Screenshot recommendation: Dashboard showing suspended run with orange APPROVAL REQUIRED banner, shell_command_execute tool with "npm run build" arguments, Approve/Reject buttons]**

The interface is intentionally simple:
- Orange highlight screams "PAY ATTENTION"
- Full tool arguments displayed (no hidden surprises)
- Optional feedback field for rejections
- Two buttons: Approve or Reject

When rejected, the feedback gets injected as a user message. The agent sees: "Tool execution was rejected: Please don't run build commands, just read the tests." It can then reconsider its approach.

## Real-Time Event Streaming

How does the Dashboard know when to show the approval UI? Server-Sent Events (SSE).

```typescript
// Client connects to SSE stream
const eventSource = new EventSource(`/runs/${runId}/events`);

eventSource.addEventListener('event', (e) => {
  const event = JSON.parse(e.data);

  if (event.type === 'RUN_SUSPENDED') {
    showApprovalUI(event.pendingTool);
  }
});
```

The server streams events as they're written to the journal. New thought? Streamed. Tool proposed? Streamed. Run suspended? Streamed immediately.

I chose polling-based SSE over WebSockets for simplicity. The server polls the journal for new events every 500ms and streams any new ones. The journal is the source of truth, not the WebSocket connection state. If a client disconnects and reconnects, it just replays from the last event ID it saw.

This is the event sourcing mindset: the journal knows everything, everyone else just subscribes to it.

## Relating to Event Sourcing

If you've worked with event sourcing in distributed systems, this architecture should feel familiar:

| Traditional Event Sourcing | Agent Event Sourcing |
|---------------------------|---------------------|
| Events are facts | Every agent action is an event |
| State is derived | Run state computed from events |
| Append-only log | Journal is immutable |
| Event replay | Resume suspended runs |
| Projections | Message reconstruction for LLM |

The `projectToPrompt()` function is essentially an event projection—it transforms the raw event stream into the format the LLM expects (user messages, assistant messages, tool calls, tool results).

```typescript
function projectToPrompt(events, originalPrompt): CoreMessage[] {
  const messages = [{ role: 'user', content: originalPrompt }];

  for (const event of events) {
    switch (event.type) {
      case 'AGENT_THOUGHT':
        // Becomes assistant message
        break;
      case 'TOOL_PROPOSED':
        // Becomes tool_call in assistant message
        break;
      case 'TOOL_RESULT':
        // Becomes tool result message
        break;
    }
  }

  return messages;
}
```

Different projections could give you different views: a timeline for the UI, a conversation for the LLM, an audit log for compliance.

## Agent Isolation Through Orchestration

When the Orchestration Agent delegates to the Coding Agent, how do we keep their events separate? Simple: sub-agents don't write to the journal at all.

```typescript
// In the orchestrator's delegation tool
execute: async ({ task }) => {
  const agent = await createCodingAgent(config);
  const result = await agent.run(task);  // Returns AgentResult, not events
  await agent.shutdown();
  return result;  // Passed back as tool result
}
```

The sub-agent runs to completion and returns a structured result. The orchestrator sees this as a tool result, records it to its journal, and continues. No cross-agent event contamination.

This is intentional. The orchestrator is the coordinator—it maintains the durable state. Sub-agents are workers—they execute and return results. If a sub-agent needs HITL, that's a future enhancement (nested durable runs).

## What Happened: A Real Example

Let me walk through a real debugging session:

**1. User submits prompt**
```
"The store-api is returning 500 errors on the /orders endpoint. Fix it."
```

**2. RUN_STARTED**
```json
{ "type": "RUN_STARTED", "payload": { "prompt": "...", "user_id": "admin" }}
```

**3. Agent thinks**
```json
{ "type": "AGENT_THOUGHT", "payload": {
  "text_content": "I'll query Loki for recent errors from store-api..."
}}
```

**4. Safe tool executes automatically**
```json
{ "type": "TOOL_PROPOSED", "payload": { "tool_name": "loki_query", "args": {...} }}
{ "type": "TOOL_RESULT", "payload": { "output_data": "TypeError: Cannot read property..." }}
```

**5. Agent proposes dangerous tool**
```json
{ "type": "TOOL_PROPOSED", "payload": {
  "tool_name": "write_file",
  "args": { "path": "src/routes/orders.ts", "content": "..." }
}}
{ "type": "RUN_SUSPENDED", "payload": { "reason": "Dangerous tool requires approval" }}
```

**6. Human reviews, approves**

The Dashboard shows the diff. The fix looks correct. Click "Approve."

```json
{ "type": "RUN_RESUMED", "payload": { "decision": "approved" }}
{ "type": "TOOL_RESULT", "payload": { "output_data": { "success": true }}}
```

**7. Agent proposes restart**
```json
{ "type": "TOOL_PROPOSED", "payload": { "tool_name": "restart_service", "args": { "service": "store-api" }}}
{ "type": "RUN_SUSPENDED", "payload": { "reason": "Dangerous tool requires approval" }}
```

**8. Human approves again**

```json
{ "type": "RUN_RESUMED", "payload": { "decision": "approved" }}
{ "type": "TOOL_RESULT", "payload": { "output_data": { "success": true }}}
```

**9. Run completes**
```json
{ "type": "RUN_COMPLETED", "payload": { "summary": "Fixed null reference error in orders.ts" }}
```

Total events: 12. Total human interventions: 2. The agent did the investigation and proposed the fix. The human just verified it was correct.

## Key Design Decisions

### Why `maxSteps: 1`?

Crash recovery. If we let the LLM run for 10 steps before persisting, and crash after step 7, we lose steps 1-7. With `maxSteps: 1`, we persist after every step. Maximum overhead, maximum durability.

Is it slower? Yes. Is it worth it? For operations work where a single bad command can cause an outage, absolutely.

### Why Strip Execute Instead of Using Permissions?

Simpler mental model. The LLM doesn't know about permissions—it just knows "I have these tools." By stripping `execute`, we don't need to teach the LLM about approval flows. It proposes tools naturally, and the infrastructure handles the rest.

### Why Polling Instead of Real-Time Notifications?

The journal is the source of truth. If we add a separate notification channel (WebSocket push, message queue), we now have two sources of truth that can diverge. Polling the journal ensures consistency—the same events the Dashboard sees are the same events that will be replayed on recovery.

500ms polling latency is acceptable for human review. If you need sub-100ms latency, you're probably building a different kind of system.

## Graphics Recommendations

For a visual version of this post, I'd suggest:

1. **State Machine Diagram**: Mermaid or custom graphic showing the 5 states and transitions
2. **Event Timeline Screenshot**: Dashboard showing a real run with color-coded events (green for start/complete, blue for thoughts, yellow for tool proposals, orange for suspended)
3. **Approval UI Screenshot**: The inline approval component with the orange highlight and Approve/Reject buttons
4. **Architecture Diagram**: System overview showing CLI, Dashboard, Server, DurableLoop, and Journal
5. **Sequence Diagram**: Full event flow from user prompt to completion

## What's Next

This architecture enables some interesting future work:

- **Approval Policies**: Auto-approve `npm test` but require approval for `npm publish`
- **Nested Durable Runs**: Sub-agents with their own HITL flows
- **Time Travel Debugging**: Replay events to any point in the run
- **Collaborative Approval**: Multiple humans must approve high-risk operations

The foundation is solid. Event sourcing gives us durability, auditability, and extensibility. Human-in-the-loop gives us safety. Together, they let us build AI agents that are genuinely useful for operations work without being genuinely dangerous.

---

The full source code is available at [github.com/yourusername/agentops](https://github.com/yourusername/agentops). The key files are:

- `ops/packages/agent-server/src/services/DurableLoop.ts` - Core state machine
- `ops/packages/agent-server/src/types/journal.ts` - Event type definitions
- `ops/packages/dashboard/src/components/Timeline.tsx` - Approval UI

Questions? Find me on Twitter [@yourhandle](https://twitter.com/yourhandle).
