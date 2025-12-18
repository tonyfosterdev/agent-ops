#!/bin/bash

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==================================="
echo "  AgentOps Bookstore - Startup"
echo "==================================="
echo ""

# Step 1: Setup Loki plugin
echo "Step 1: Setting up logging plugin..."
"$SCRIPT_DIR/setup-logging.sh"
echo ""

# Step 2: Install agent-server dependencies if needed
AGENT_SERVER_DIR="$PROJECT_ROOT/ops/packages/agent-server"
if [ -d "$AGENT_SERVER_DIR" ] && [ ! -d "$AGENT_SERVER_DIR/node_modules" ]; then
    echo "Step 2: Installing agent-server dependencies..."
    cd "$AGENT_SERVER_DIR"
    npm install
    cd "$PROJECT_ROOT"
    echo ""
fi

# Step 3: Start services
echo "Step 3: Starting Docker Compose services..."
echo ""
echo "Services included:"
echo "  - Bookstore: store-api, warehouse-alpha, warehouse-beta, bookstore-ui"
echo "  - Infrastructure: traefik, loki, grafana"
echo "  - Databases: store-db, warehouse-alpha-db, warehouse-beta-db, ops-db"
echo "  - Agent Server: agent-server (Durable Run Architecture)"
echo ""

cd "$PROJECT_ROOT"

# Check if --build flag was passed
if [[ "$1" == "--build" ]]; then
    echo "Building and starting services..."
    docker compose up --build "${@:2}"
else
    echo "Starting services..."
    docker compose up "$@"
fi

echo ""
echo "==================================="
echo "  Access Points"
echo "==================================="
echo "  Bookstore UI:     http://localhost"
echo "  Store API:        http://api.localhost/store"
echo "  Warehouse Alpha:  http://api.localhost/warehouses/alpha"
echo "  Warehouse Beta:   http://api.localhost/warehouses/beta"
echo "  Agent Server:     http://api.localhost/agents"
echo "  Runs API:         http://localhost:3200/runs"
echo "  Traefik:          http://localhost:8080"
echo "  Grafana:          http://grafana.localhost"
echo "==================================="
