# Mock LLM Server

A mock LLM server that provides deterministic responses for testing. Compatible with both OpenAI and Anthropic APIs.

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
npm start
```

## API Endpoints

### Health Check

```bash
curl http://localhost:3333/health
# {"status":"ok","service":"mock-llm","timestamp":"..."}
```

### List Fixtures

```bash
curl http://localhost:3333/fixtures
# {"fixtures":["default.json","dangerous-shell.json",...],"active":"default.json"}
```

### Set Active Fixture

```bash
curl -X POST http://localhost:3333/fixtures/set \
  -H "Content-Type: application/json" \
  -d '{"fixture":"dangerous-shell.json"}'
```

### Queue Multiple Fixtures

For tests that need multiple responses in sequence:

```bash
curl -X POST http://localhost:3333/fixtures/queue \
  -H "Content-Type: application/json" \
  -d '{"fixtures":["dangerous-shell.json","completion-after-tool.json"]}'
```

### Anthropic Messages API

```bash
curl -X POST http://localhost:3333/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### OpenAI Chat Completions API

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Fixtures

Fixtures are JSON files in the `fixtures/` directory. Each fixture defines the response the mock LLM will return.

### Available Fixtures

| Fixture | Description |
|---------|-------------|
| `default.json` | Simple text response |
| `safe-read-file.json` | Returns read_file tool use |
| `dangerous-shell.json` | Returns shell_command_execute tool use (triggers HITL) |
| `completion-after-tool.json` | Simple completion message after tool execution |
| `acknowledge-rejection.json` | Acknowledges rejected tool and suggests alternative |

### Fixture Format (Anthropic)

```json
{
  "content": [
    {"type": "text", "text": "I'll read the file."},
    {
      "type": "tool_use",
      "id": "call-123",
      "name": "read_file",
      "input": {"path": "/file.txt"}
    }
  ],
  "stop_reason": "tool_use",
  "usage": {"input_tokens": 100, "output_tokens": 50}
}
```

## Docker

```bash
# Build
docker build -t mock-llm .

# Run
docker run -p 3333:3333 mock-llm

# With custom fixture directory
docker run -p 3333:3333 -v $(pwd)/my-fixtures:/app/fixtures mock-llm
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3333 | Server port |
| `FIXTURE_DIR` | ./fixtures | Path to fixture directory |
| `DEFAULT_FIXTURE` | default.json | Default fixture to use |
