#!/bin/sh
set -e

echo "🌱 Running database seed..."
npm run seed || echo "⚠️ Seed failed (may be expected if data already exists)"

echo "🚀 Starting Store API..."
npm start
