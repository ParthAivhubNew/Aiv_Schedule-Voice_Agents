#!/bin/bash
set -e

# Auto-setup logrotate for Docker logs (3-day rotation, 500KB max)
# This runs every container startup to ensure config exists
LOGROTATE_CONFIG="/etc/logrotate.d/docker-aivhub"

if [ ! -f "$LOGROTATE_CONFIG" ]; then
    echo "Setting up logrotate config for Docker logs (auto-cleanup after 3 days, 500KB max)..."
    
    # Create the config file
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
    echo "  Logs will auto-cleanup: 3-day max age, 500KB size limit"
fi

# Start the FastAPI application
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
