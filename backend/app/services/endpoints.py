"""Custom AI endpoints (Ollama, vLLM, LM Studio, a company gateway, ...).

A key is optional for any custom URL: self-hosted models often have none. Only the big hosted
APIs below always need one.

When this server runs in Docker, "localhost" is the container itself, not the machine it runs
on. A model on the same machine is reached at host.docker.internal instead (docker-compose maps
that name to the host).
"""
import os
from typing import Optional
from urllib.parse import urlparse, urlunparse

HOSTED_API_HOSTS = (
    "api.openai.com",
    "api.anthropic.com",
    "api.x.ai",
    "api.groq.com",
    "api.deepseek.com",
    "generativelanguage.googleapis.com",
    "api.mistral.ai",
    "openrouter.ai",
    "api.together.xyz",
    "api.fireworks.ai",
    "api.cohere.ai",
    "api.cohere.com",
    "api.perplexity.ai",
    "api.stability.ai",
    "fal.run",
    "queue.fal.run",
)
DOCKER_HOST = "host.docker.internal"
_LOOPBACK = ("localhost", "127.0.0.1", "0.0.0.0", "::1")


def _host(url: Optional[str]) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "http://" + raw
    try:
        return (urlparse(raw).hostname or "").lower()
    except ValueError:
        return ""


def is_self_hosted(url: Optional[str]) -> bool:
    """A custom endpoint, where a key is optional: any URL that is not a known hosted API."""
    host = _host(url)
    if not host:
        return False
    return not any(host == h or host.endswith("." + h) for h in HOSTED_API_HOSTS)


def in_docker() -> bool:
    return os.path.exists("/.dockerenv") or os.environ.get("RUNNING_IN_DOCKER") == "1"


def docker_host_alternative(url: Optional[str]) -> Optional[str]:
    """The same URL with localhost swapped for the Docker host, when that is what the user
    most likely meant (this server is in a container and the URL points at itself)."""
    if not in_docker() or _host(url) not in _LOOPBACK:
        return None
    raw = str(url).strip()
    if "://" not in raw:
        raw = "http://" + raw
    parts = urlparse(raw)
    netloc = DOCKER_HOST + (f":{parts.port}" if parts.port else "")
    return urlunparse(parts._replace(netloc=netloc))
