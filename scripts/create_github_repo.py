#!/usr/bin/env python3
"""Create a GitHub repo for the current workspace and push the current branch.

Usage:
  python scripts/create_github_repo.py --name my-repo --public

The script uses `GITHUB_TOKEN` environment variable if `--token` is not provided.
It will create a repo under the authenticated user and push the current git HEAD.
"""

from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
from typing import Optional

import requests


GITHUB_API = "https://api.github.com"


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"Command failed: {' '.join(cmd)}")
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(proc.returncode)


def create_github_repo(token: str, name: str, private: bool, description: Optional[str]) -> dict:
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
    }
    payload = {"name": name, "private": private}
    if description:
        payload["description"] = description

    resp = requests.post(f"{GITHUB_API}/user/repos", headers=headers, json=payload)
    if resp.status_code not in (200, 201):
        print("GitHub API error creating repo:", resp.status_code, resp.text)
        raise SystemExit(1)
    return resp.json()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--name", required=True, help="Repository name to create")
    p.add_argument("--token", help="GitHub personal access token (or set GITHUB_TOKEN)")
    p.add_argument("--private", action="store_true", help="Create as private repo")
    p.add_argument("--description", help="Repository description")
    p.add_argument("--push-branch", default=None, help="Local branch to push (defaults to current HEAD)")
    p.add_argument("--use-ssh", action="store_true", help="Use SSH remote URL instead of HTTPS")
    args = p.parse_args()

    token = args.token or os.getenv("GITHUB_TOKEN")
    if not token:
        print("Error: GitHub token not provided. Set GITHUB_TOKEN or pass --token.")
        raise SystemExit(1)

    print(f"Creating GitHub repo '{args.name}' (private={args.private})...")
    repo = create_github_repo(token, args.name, args.private, args.description)
    clone_url = repo.get("ssh_url") if args.use_ssh else repo.get("clone_url")
    if not clone_url:
        print("Could not determine clone URL from GitHub response")
        raise SystemExit(1)

    # Ensure git repo exists locally
    try:
        run(["git", "rev-parse", "--is-inside-work-tree"])
    except SystemExit:
        print("Not a git repository. Initializing git repo...")
        run(["git", "init"]) 

    # Add remote (remove existing origin if present)
    # If origin exists, replace it
    origin_exists = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True)
    if origin_exists.returncode == 0:
        print("Replacing existing 'origin' remote with new repo URL")
        run(["git", "remote", "remove", "origin"])

    run(["git", "remote", "add", "origin", clone_url])

    # Determine branch to push
    branch = args.push_branch
    if not branch:
        # try to get current branch name
        cur = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True)
        branch = cur.stdout.strip() or "main"

    print(f"Pushing local branch '{branch}' to origin as 'main' (remote: {clone_url})...")
    # Ensure branch is set to main remotely
    run(["git", "branch", "-M", branch, "main"]) 
    run(["git", "push", "-u", "origin", "main"]) 

    print("Repository created and pushed successfully:", repo.get("html_url"))


if __name__ == "__main__":
    main()
