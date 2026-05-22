import os
from typing import Any, Dict

try:
    import openai
except Exception:  # pragma: no cover - optional dependency
    openai = None


def send_prompt(prompt: str, model: str = "gpt-4o") -> Dict[str, Any]:
    """Send a prompt to OpenAI/ChatGPT.

    Requires `OPENAI_API_KEY` in the environment or loaded from a .env file.
    Returns the raw API response object/dict.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set in the environment")
    if openai is None:
        raise RuntimeError("openai package is not installed. See requirements.txt")

    openai.api_key = api_key
    # Keep this simple and compatible with both ChatCompletion and new client styles
    try:
        resp = openai.ChatCompletion.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp
    except AttributeError:
        # Fallback for newer clients
        client = openai
        resp = client.chat.completions.create(model=model, messages=[{"role":"user","content":prompt}])
        return resp
