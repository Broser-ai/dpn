import os
from typing import Any, Dict

try:
    from anthropic import Anthropic
except Exception:  # pragma: no cover - optional dependency
    Anthropic = None


def send_prompt(prompt: str, model: str = "claude-2") -> Dict[str, Any]:
    """Send a prompt to Anthropic Claude.

    Requires `ANTHROPIC_API_KEY` in the environment.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set in the environment")
    if Anthropic is None:
        raise RuntimeError("anthropic package is not installed. See requirements.txt")

    client = Anthropic(api_key=api_key)
    # This is a minimal example; users should adapt to their Anthropic client version.
    resp = client.completions.create(model=model, prompt=prompt)
    return resp
