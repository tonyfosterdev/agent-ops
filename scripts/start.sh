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

# Step 2: Start services
echo "Step 2: Starting Docker Compose services..."
echo ""
echo "Services included:"
echo "  - Bookstore: store-api, warehouse-alpha, warehouse-beta, bookstore-ui"
echo "  - Infrastructure: traefik, loki, grafana, tempo"
echo "  - Databases: store-db, warehouse-alpha-db, warehouse-beta-db, ops-db"
echo "  - Agent Stack: agent-server, agent-dashboard, inngest-dev"
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
echo "  Agent Dashboard:  http://agents.localhost"
echo "  Agent API:        http://api.localhost/agents"
echo "  Inngest Dev:      http://inngest.localhost"
echo "  Traefik:          http://localhost:8080"
echo "  Grafana:          http://grafana.localhost"
echo "  Tempo:            http://tempo.localhost"
echo "==================================="
