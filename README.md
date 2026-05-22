# AI connectors scaffold

This repository contains minimal connector stubs to integrate projects with multiple LLM providers (OpenAI, Anthropic/Claude, LangGraph CLI).

Quick steps:

1. Copy `.env.example` to `.env` and fill in your API keys.
2. Create a virtualenv and install dependencies:

```bash
python -m venv .venv
.\.venv\Scripts\activate    # Windows
pip install -r requirements.txt
```

3. Example usage (Python):

```py
from connectors import send_openai_prompt, send_anthropic_prompt, run_langgraph_workflow

print(send_openai_prompt("Hello from OpenAI"))
print(send_anthropic_prompt("Hello from Claude"))
print(run_langgraph_workflow())
```

Notes:
- This scaffold uses environment variables for API keys. Do not commit secrets to Git.
- Pushing to GitHub requires a remote named `origin`; add it and push.
