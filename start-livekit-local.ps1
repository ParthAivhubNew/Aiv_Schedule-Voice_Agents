# ============================================================================
# AIVHub Voice AI - Start LiveKit for Local Development
# ============================================================================
# This script starts the LiveKit Docker container and verifies the connection
# Usage: .\start-livekit-local.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " AIVHub - Starting LiveKit Container" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "[1/5] Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker is not installed or not in PATH" -ForegroundColor Red
        Write-Host "Please install Docker Desktop: https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
        exit 1
    }
    Write-Host "   ✓ Docker found: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Cannot execute Docker commands" -ForegroundColor Red
    exit 1
}

# Check if Docker daemon is running
Write-Host ""
Write-Host "[2/5] Checking Docker daemon..." -ForegroundColor Yellow
try {
    docker ps >$null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker daemon is not running" -ForegroundColor Red
        Write-Host "Please start Docker Desktop and try again" -ForegroundColor Red
        exit 1
    }
    Write-Host "   ✓ Docker daemon is running" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Cannot connect to Docker daemon" -ForegroundColor Red
    exit 1
}

# Start LiveKit container
Write-Host ""
Write-Host "[3/5] Starting LiveKit container..." -ForegroundColor Yellow
docker-compose up -d livekit
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start LiveKit container" -ForegroundColor Red
    exit 1
}
Write-Host "   ✓ LiveKit container started" -ForegroundColor Green

# Wait a moment for container to initialize
Write-Host ""
Write-Host "[4/5] Waiting for LiveKit to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
Write-Host "   ✓ Initialization complete" -ForegroundColor Green

# Check container status
Write-Host ""
Write-Host "[5/5] Verifying LiveKit status..." -ForegroundColor Yellow
$status = docker-compose ps livekit | Select-String "Up"
if ($status) {
    Write-Host "   ✓ LiveKit is running on port 7880" -ForegroundColor Green
} else {
    Write-Host "WARNING: LiveKit container might not be running properly" -ForegroundColor Yellow
    Write-Host "Run 'docker-compose logs livekit' to see logs" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " LiveKit Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor White
Write-Host "1. Start your backend:  cd backend && uvicorn app.main:app --reload" -ForegroundColor White
Write-Host "2. Start your frontend: cd frontend && npm run dev" -ForegroundColor White
Write-Host "3. Open http://localhost:5173 in your browser" -ForegroundColor White
Write-Host "4. Go to Connections tab and configure:" -ForegroundColor White
Write-Host "   - Add STT provider (Deepgram, Whisper, etc.)" -ForegroundColor White
Write-Host "   - Add LLM provider (DeepSeek, OpenAI, Claude, etc.)" -ForegroundColor White
Write-Host "   - Add TTS provider (Cartesia, ElevenLabs, etc.)" -ForegroundColor White
Write-Host "5. Go to 'What Runs Where' section" -ForegroundColor White
Write-Host "6. Select 'LiveKit (self-hosted)' in Voice Orchestration" -ForegroundColor White
Write-Host "7. Choose your STT/LLM/TTS models from the dropdowns" -ForegroundColor White
Write-Host "8. Click 'Test Call in Web (LiveKit)' button" -ForegroundColor White
Write-Host ""
Write-Host "LiveKit Configuration:" -ForegroundColor Cyan
Write-Host "  WebSocket URL: ws://localhost:7880" -ForegroundColor White
Write-Host "  API Key: devkey" -ForegroundColor White
Write-Host "  API Secret: secret1234567890abcdef1234567890abcdef" -ForegroundColor White
Write-Host ""
Write-Host "View Logs:" -ForegroundColor Cyan
Write-Host "  docker-compose logs -f livekit" -ForegroundColor White
Write-Host ""
Write-Host "Stop LiveKit:" -ForegroundColor Cyan
Write-Host "  docker-compose stop livekit" -ForegroundColor White
Write-Host ""
