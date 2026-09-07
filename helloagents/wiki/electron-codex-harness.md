# Electron Codex harness

`frontend/electron/codex-harness.mjs` is the desktop smoke-test entry point for
Codex integrations. It uses the same `DesktopCapabilityHost` instance as the
Electron main process, connects to a local MCP fixture, and exposes a compact
capability snapshot to the 小T sub-agent adapter.

Run it from `frontend/` with:

```bash
npm run verify:codex-harness
```

Production code should inject the real Codex sub-agent through the
`subagent({ capabilitySnapshot, host })` callback. The default path is offline
and deterministic, so CI can verify host connectivity without credentials or a
running model service. The snapshot reserves explicit `screenshot` and
`computedUse` capability flags; adapters can use these to decide whether to
request a screenshot or computed-style inspection from Electron.

External software protocols are extensible through
`registerComputeUseProtocol(id, actions)` in
`frontend/electron/compute-use-actions.mjs`. A Blender plugin can register
namespaced actions such as `blender.plugin/bake_texture` without changing the
core harness; execution still flows through the capability host and its
approval boundary.

`npm run verify:desktop` includes this harness test alongside the existing
desktop checks.

To let local Codex call remote 小T on demand, register
`frontend/electron/xiaot-agent-mcp-bridge.mjs` as a stdio MCP server and set
`TANVA_XIAOT_AGENT_URL` to the authenticated gateway endpoint. Codex then sees
one `xiaot_agent` tool; ordinary turns remain local and only explicit tool
calls leave the device.
