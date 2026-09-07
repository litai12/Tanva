/**
 * Electron Codex harness.
 *
 * This is the single smoke-test entry point for the desktop host.  It runs
 * through the same DesktopCapabilityHost used by Electron, then hands the
 * resulting capability snapshot to the small-T (小T) sub-agent adapter.  The
 * adapter is deliberately injected so production can use the real Codex
 * sub-agent while CI remains offline and deterministic.
 */
import { fileURLToPath } from 'node:url';
import { DesktopCapabilityHost } from './capability-host.mjs';
import { computeUse } from './compute-use.mjs';

const fixture = fileURLToPath(new URL('./fixtures/mock-mcp-server.mjs', import.meta.url));

export async function runCodexElectronHarness({
  subagent = null,
  capabilities = {},
} = {}) {
  const host = new DesktopCapabilityHost({ connectTimeoutMs: 5_000 });
  try {
    const status = await host.connect('harness', {
      command: process.execPath,
      args: [fixture],
      env: {},
    });
    if (status.transport !== 'connected') {
      throw new Error(`Electron capability host failed: ${status.error || status.transport}`);
    }
    const tools = host.listTools('harness');
    const screenshotEnabled = capabilities.screenshot !== false && process.env.TANVA_DISABLE_SCREENSHOT !== '1';
    const computerUseEnabled = capabilities.computerUse !== false &&
      capabilities.computedUse !== false && process.env.TANVA_DISABLE_COMPUTER_USE !== '1';
    const capabilitySnapshot = {
      transport: status.transport,
      tools,
      screenshot: { supported: screenshotEnabled, source: 'electron-host' },
      // `computedUse` is retained as a compatibility alias for early clients
      // that used the misspelled capability name.
      computerUse: { supported: computerUseEnabled, source: 'electron-host' },
      computedUse: { supported: computerUseEnabled, source: 'electron-host' },
    };
    const result = await (typeof subagent === 'function'
      ? subagent({ capabilitySnapshot, host })
      : computeUse({
        host,
        connectorId: 'harness',
        toolName: 'inspect_fixture',
        args: { value: 'xiaot' },
        taskId: 'codex-harness-smoke',
      }));
    return { capabilitySnapshot, result };
  } finally {
    await host.disconnectAll();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runCodexElectronHarness();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
