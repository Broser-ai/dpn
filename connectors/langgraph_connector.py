import os
import subprocess
from typing import Any


def run_langgraph_workflow(graph_ref: str = "master_pipeline") -> Any:
    """Run a LangGraph workflow using the `langgraph` CLI.

    graph_ref: the graph key name configured in `langgraph.json` (defaults to master_pipeline).
    Returns the completed process object; raises on error.
    """
    cli = os.getenv("LANGGRAPH_CLI_PATH", "langgraph")
    cmd = [cli, "run", graph_ref]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"langgraph CLI failed: {proc.stderr}")
    return proc.stdout
