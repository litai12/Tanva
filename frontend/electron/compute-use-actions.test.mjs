import test from 'node:test';
import assert from 'node:assert/strict';
import { assertComputeUseAction, isComputeUseAction, registerComputeUseProtocol } from './compute-use-actions.mjs';

test('compute-use action contract allows approved modeling and procurement actions', () => {
  assert.equal(isComputeUseAction('sketchup', 'update_material'), true);
  assert.equal(isComputeUseAction('blender', 'render_scene'), true);
  assert.equal(isComputeUseAction('business', 'create_purchase_order'), true);
  assert.equal(isComputeUseAction('architecture', 'generate_building_mass'), true);
  assert.equal(isComputeUseAction('architecture', 'validate_site_setbacks'), true);
  assert.equal(isComputeUseAction('architecture', 'generate_renovation_scope'), true);
  assert.equal(isComputeUseAction('architecture', 'validate_parking_access'), true);
  assert.equal(isComputeUseAction('architecture', 'estimate_energy_performance'), true);
  assert.equal(isComputeUseAction('architecture', 'export_dxf'), true);
  assert.equal(isComputeUseAction('architecture', 'generate_section_elevation'), true);
  assert.equal(isComputeUseAction('architecture', 'estimate_mep_loads'), true);
  assert.equal(isComputeUseAction('architecture', 'run_construction_workflow'), true);
  assert.equal(isComputeUseAction('architecture', 'generate_construction_schedule'), true);
  assert.equal(isComputeUseAction('architecture', 'record_construction_progress'), true);
  assert.equal(isComputeUseAction('architecture', 'record_site_inspection'), true);
  assert.equal(isComputeUseAction('architecture', 'create_rectification_order'), true);
  assert.equal(isComputeUseAction('architecture', 'close_rectification_order'), true);
  assert.equal(isComputeUseAction('business', 'register_supplier'), true);
  assert.equal(isComputeUseAction('business', 'approve_change_order'), true);
  assert.equal(isComputeUseAction('business', 'reconcile_purchase_order'), true);
  assert.equal(isComputeUseAction('business', 'resolve_delivery_discrepancy'), true);
  assert.equal(isComputeUseAction('business', 'close_purchase_order'), true);
  assert.equal(isComputeUseAction('business', 'handover_to_accounts_payable'), true);
  assert.equal(isComputeUseAction('business', 'review_payment_handover'), true);
  assert.equal(isComputeUseAction('business', 'revise_payment_handover'), true);
  assert.equal(isComputeUseAction('business', 'record_payment'), true);
  assert.equal(isComputeUseAction('business', 'close_finance'), true);
  assert.equal(isComputeUseAction('sketchup', 'run_script'), false);
  assert.throws(() => assertComputeUseAction('blender', 'execute_python'), /不允许/);
});

test('compute-use protocols can be extended by an application plugin', () => {
  registerComputeUseProtocol('blender.plugin', ['bake_texture']);
  assert.equal(isComputeUseAction('blender.plugin', 'bake_texture'), true);
  assertComputeUseAction('blender.plugin', 'bake_texture');
});
