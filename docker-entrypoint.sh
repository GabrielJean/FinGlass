#!/bin/bash
set -eu -o pipefail

mkdir -p /app/data

echo "=== Running Migrations ==="
python -u manage.py migrate --noinput

if [ "${SEED_DEMO_DATA:-0}" = "1" ] || [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
    echo "=== Seeding Demo Data ==="
    python -u manage.py seed_demo_data || true
fi

if [ $# -gt 0 ]; then
    exec "$@"
fi

echo "=== Starting gunicorn ==="
exec gunicorn --bind 0.0.0.0:8000 \
    --workers=2 \
    --worker-class=gthread \
    --threads=4 \
    --timeout=120 \
    --graceful-timeout=30 \
    --keep-alive=2 \
    --access-logfile=- \
    --error-logfile=- \
    finglass_project.wsgi:application
