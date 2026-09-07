import assert from 'node:assert/strict';
import test from 'node:test';
import { runCodexElectronHarness } from './codex-harness.mjs';

test('Electron Codex harness runs the 小T sub-agent adapter', async () => {
  const report = await runCodexElectronHarness({
    subagent: async ({ capabilitySnapshot, host }) => {
      assert.equal(capabilitySnapshot.screenshot.supported, true);
      assert.equal(capabilitySnapshot.computedUse.supported, true);
      return host.callTool('harness', 'inspect_fixture', { value: 'xiaot' });
    },
  });
  assert.equal(report.result.result.text, 'fixture:xiaot');
  assert.equal(report.capabilitySnapshot.tools[0].risk, 'read');
});

test('Electron Codex harness propagates disabled desktop capabilities', async () => {
  const report = await runCodexElectronHarness({
    capabilities: { screenshot: false, computerUse: false },
    subagent: async ({ capabilitySnapshot }) => capabilitySnapshot,
  });
  assert.equal(report.capabilitySnapshot.screenshot.supported, false);
  assert.equal(report.capabilitySnapshot.computerUse.supported, false);
  assert.equal(report.capabilitySnapshot.computedUse.supported, false);
});
