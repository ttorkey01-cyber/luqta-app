---
name: GitHub API pushes
description: Repo synchronization caution when GitHub writes use the connected API instead of a configured git remote.
---

The workspace can have Replit internal git remotes without a GitHub remote even while the GitHub integration has write access. A GitHub Git Data API commit built from the remote main tree and verified local files advances GitHub main, but has a different commit hash and history from the workspace's local checkpoint commits.

**Why:** Reporting the local hash as pushed, or force-pushing the divergent local branch later, could misstate the release or overwrite unrelated remote history.

**How to apply:** Inspect both histories before a subsequent GitHub push. Treat the remote GitHub commit hash as the pushed hash, verify the main ref after writes, and never force-push merely to align the local branch. Prefer a deliberate merge or synchronization of histories when conventional git operations are needed.