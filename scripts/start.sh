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

cd "$PROJECT_ROOT"

# Check if --build flag was passed
if [[ "$1" == "--build" ]]; then
    echo "Building and starting services..."
    docker compose up --build "${@:2}"
else
    echo "Starting services..."
    docker compose up "$@"
fi
