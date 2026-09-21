#!/bin/bash
set -e

# Auto-setup logrotate for Docker logs (3-day rotation, 500KB max)
LOGROTATE_CONFIG="/etc/logrotate.d/docker-aivhub"

if [ ! -f "$LOGROTATE_CONFIG" ]; then
    echo "Setting up logrotate config for Docker logs (auto-cleanup after 3 days, 500KB max)..."
    cat > "$LOGROTATE_CONFIG" << 'EOF'
/var/lib/docker/containers/*/*.log {
    rotate 0
    maxage 3
    missingok
    notifempty
    compress
    copytruncate
    size 500k
}
EOF
    echo "✓ Logrotate config installed at $LOGROTATE_CONFIG"
fi

echo "Starting FastAPI backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
