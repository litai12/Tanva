import { assertComputeUseAction } from './compute-use-actions.mjs';
import { COMPUTE_USE_ACTIONS } from './compute-use-actions.mjs';

/**
 * The single execution boundary for external desktop software.
 *
 * Electron owns consent and presentation; compute-use owns the actual
 * operation through the Capability Host. Keeping this boundary explicit
 * prevents renderer or Electron UI code from growing ad-hoc SketchUp/
 * Blender/Rhino/OS process operations.
 */
export async function computeUse({ host, connectorId, toolName, args = {}, taskId = null, action = null }) {
  if (!host || typeof host.callTool !== 'function') {
    throw new Error('compute-use requires a capability host');
  }
  if (typeof connectorId !== 'string' || !connectorId.trim()) {
    throw new Error('compute-use requires connectorId');
  }
  if (typeof toolName !== 'string' || !toolName.trim()) {
    throw new Error('compute-use requires toolName');
  }
  if (action !== null) assertComputeUseAction(connectorId, action);

  const startedAt = new Date().toISOString();
  const execution = await host.callTool(connectorId, toolName, args);
  return {
    ...execution.result,
    computeUse: {
      connectorId,
      toolName,
      action,
      taskId: typeof taskId === 'string' ? taskId : null,
      startedAt,
      completedAt: new Date().toISOString(),
      host: 'tanva-capability-host',
    },
  };
}

/** Dispatch a canonical action without exposing connector-specific tool names to callers. */
export async function dispatchComputeUse({ host, connectorId, action, args = {}, taskId = null }) {
  if (!COMPUTE_USE_ACTIONS[connectorId]?.includes(action)) {
    throw new Error(`不允许的 compute-use 动作：${connectorId}/${action}`);
  }
  return computeUse({ host, connectorId, toolName: action, action, args, taskId });
}
