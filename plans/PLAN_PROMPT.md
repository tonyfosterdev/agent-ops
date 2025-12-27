# Role
You are a Principal Software Architect specializing in Event-Driven Architectures and TypeScript/Node.js. You are helping me enahcne a "Bookstore Ops Agent" from a fragile prototype into a robust, event-sourced system.

# The Context
I currently have a Hono (Node.js) backend where an AI agent helps with Ops tasks.
* **Current State:** It uses "Sessions" and blocking HTTP requests. It is "chatty" and loses context easily.
* **The Problem:** The "Session" abstraction is causing state drift. Sub-agents talk to the user too much. Human-in-the-Loop (HITL) is difficult to manage across server restarts.

# The Goal
I want to refactor this into a **"Durable Run" Architecture**.
* A "Run" is a long-lived, persistable object that represents a single logical task (e.g., "Fix the DB").
* **Journaling:** The state of a Run is derived entirely from a linear history of typed Events stored in a database (Postgres).
* **Headless Sub-Agents:** Sub-agents (LogAnalyzer, CodingAgent) must return structured JSON reports, not chat.
* **Decoupled UI:** A React-based dashboard to visualize the run state and handle approvals.

# Phase 1: The Core Infrastructure (Backend)
                 
## 1. Define the Event Schema
We need to replace the chat history array with a strict Event Log. Please define a TypeScript union type `JournalEvent` with exactly these types:
1.  `RUN_STARTED`: (Payload: prompt, user_id)
2.  `AGENT_THOUGHT`: (Payload: text_content) - Captures reasoning before tool use.
3.  `TOOL_PROPOSED`: (Payload: tool_name, args, call_id) - The "Intent".
4.  `RUN_SUSPENDED`: (Payload: reason) - Used when a dangerous tool is proposed.
5.  `RUN_RESUMED`: (Payload: decision, feedback) - Used when human approves/rejects.
6.  `TOOL_RESULT`: (Payload: call_id, output_data, status)
7.  `RUN_COMPLETED`: (Payload: summary)
8.  `SYSTEM_ERROR`: (Payload: error_details)

## 2. The "Durable Loop"
Design a `runAgentStep(runId)` function that:
1.  Loads the Event Journal from the DB.
2.  Projects the Events into an LLM Prompt (filtering out old thoughts/suspensions).
3.  Generates the next step.
4.  If a Dangerous Tool is proposed -> Saves `RUN_SUSPENDED` event and exits.
5.  If Safe -> Executes, saves `TOOL_RESULT`, and recursively calls itself.

# Phase 2: The Isolated Sub-Agents (Development Plan)

I want to develop and test each agent in isolation before connecting them.

## Agent 1: LogAnalyzer
* **Role:** Read-only investigator.
* **Constraint:** Must return `AgentReport` JSON. Max 3 queries.
* **Test Harness:** Create a script `scripts/test-log-agent.ts` that runs this agent against a hardcoded prompt ("Check warehouse-alpha").

## Agent 2: CodingAgent
* **Role:** Root cause analysis and patch proposal.
* **Constraint:** Must return `AgentReport` JSON.
* **Test Harness:** Create a script `scripts/test-coding-agent.ts` that feeds it a specific error log and file context.

## Agent 3: Orchestrator
* **Role:** The Product Manager. The only one allowed to synthesize text for the user.
* **Task:** Calls sub-agents, reads their JSON reports, and updates the Journal.

# Phase 3: The Frontend Dashboard (Client)

I want a lightweight React Client (Vite + Tailwind) to visualize the agent's thinking process.

## 1. Tech Stack
* **Vite:** For fast bundling.
* **Tailwind CSS:** For styling.
* **SWR / React Query:** For polling the run state.

## 2. Key Components
* **Timeline View:** A vertical list rendering the `JournalEvent` stream.
    * `AGENT_THOUGHT` should be rendered as blue text.
    * `TOOL_PROPOSED` should be a distinct card showing the tool name and args.
    * `TOOL_RESULT` should show success/failure icons.
* **Approval Modal:** A fixed overlay that appears ONLY when the run status is `SUSPENDED`.
    * Must display *what* tool is waiting for approval.
    * Must have "Approve" and "Reject" buttons that POST to the Hono backend.

## 3. Integration
* The Client runs on port 5173 (Vite default).
* The Backend runs on port 3000 (Hono).
* Ensure the plan includes configuring CORS on the Hono server to allow this connection.

# Your Task
Please generate a **Step-by-Step Refactoring Plan** (Markdown) that I can follow.
1.  **Architecture:** Show the DB Schema for the `runs` table and the `JournalEvent` types.
2.  **Communication:** Define the `AgentReport` interface that sub-agents must return.
3.  **Development:** Write the code for the `scripts/test-harness.ts` pattern so I can iterate on agents without running the full UI.
4.  **Frontend:** Provide the `App.tsx` and `useRun` hook code to scaffold the dashboard.