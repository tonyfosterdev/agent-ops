#!/bin/bash

set -e

echo "==================================="
echo "  Loki Docker Plugin Setup"
echo "==================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running or not installed"
    echo "   Please start Docker and try again"
    exit 1
fi

# Check if Loki plugin is already installed
if docker plugin ls | grep -q "loki.*true"; then
    echo "✓ Loki Docker plugin is already installed and enabled"
    exit 0
fi

# Check if plugin exists but is disabled
if docker plugin ls | grep -q "loki"; then
    echo "⚠ Loki plugin exists but is disabled. Enabling..."
    docker plugin enable loki
    echo "✓ Loki Docker plugin enabled successfully"
    exit 0
fi

# Install the plugin
echo "📦 Installing Loki Docker plugin..."
echo "   This may take a moment..."
echo ""

if docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions; then
    echo ""
    echo "✓ Loki Docker plugin installed successfully!"
    echo ""
else
    echo ""
    echo "❌ Failed to install Loki Docker plugin"
    echo "   Please check your Docker installation and try again"
    echo "   Or install manually with:"
    echo "   docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions"
    exit 1
fi
