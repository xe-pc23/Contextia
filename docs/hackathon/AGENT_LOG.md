# AGENT_LOG.md — Coding Agent / AWS Evidence Log

Do not store secrets, OAuth tokens, AWS credentials, Cognito passwords, or full private context here.

| Time (JST) | Agent | Task | AWS interaction | Result / commit / PR | Evidence |
|---|---|---|---|---|---|
| YYYY-MM-DD HH:MM | Codex / Claude Code |  |  |  |  |

## Evidence checklist

- [ ] Codex connected to AWS MCP Server
- [ ] Claude Code connected to AWS MCP Server
- [ ] agent performed a real AWS inspect/deploy/debug operation
- [ ] CloudTrail evidence captured if useful
- [ ] screenshot contains no secret/token
- [ ] resulting change is represented in CDK/repository where applicable
