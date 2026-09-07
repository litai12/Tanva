/** Canonical external-software actions exposed to the Tanva harness. */
export const COMPUTE_USE_ACTIONS = Object.freeze({
  sketchup: Object.freeze([
    'inspect_model', 'create_room_geometry', 'update_material',
    'extract_model_quantities', 'export_scene_preview', 'save_model_revision',
  ]),
  blender: Object.freeze([
    'inspect_scene', 'create_scene', 'create_collection', 'create_mesh', 'create_floor_plan_meshes',
    'assign_material', 'configure_camera', 'configure_lighting',
    'render_scene', 'export_glb', 'save_scene_revision',
  ]),
  rhino: Object.freeze(['inspect_document', 'create_geometry', 'update_geometry', 'export_model']),
  autocad: Object.freeze(['inspect_document', 'create_drawing', 'update_drawing', 'export_drawing']),
  revit: Object.freeze(['inspect_model', 'create_element', 'update_element', 'extract_quantities', 'export_model']),
  '3dsmax': Object.freeze(['inspect_scene', 'create_object', 'assign_material', 'configure_camera', 'render_scene', 'export_model']),
  photoshop: Object.freeze(['inspect_document', 'create_layer', 'update_layer', 'apply_adjustment', 'export_asset']),
  illustrator: Object.freeze(['inspect_document', 'create_artboard', 'create_vector', 'update_vector', 'export_asset']),
  indesign: Object.freeze(['inspect_document', 'create_page', 'place_asset', 'update_text', 'export_document']),
  grasshopper: Object.freeze(['inspect_definition', 'set_input', 'solve_definition', 'bake_geometry', 'export_geometry']),
  windows: Object.freeze(['inspect_window', 'open_file', 'save_file', 'capture_window']),
  knowledge: Object.freeze(['index_project_documents', 'search_project_knowledge', 'get_source_excerpt', 'rebuild_project_index']),
  runtime: Object.freeze(['inspect_runtime', 'run_isolated_task', 'cancel_task', 'collect_task_artifacts']),
  updates: Object.freeze(['check_manifest', 'download_update', 'verify_update', 'rollback_update']),
  business: Object.freeze([
    'register_supplier', 'generate_bom_from_model', 'compare_supplier_quotes', 'calculate_budget',
    'create_purchase_request', 'create_purchase_order', 'record_delivery', 'reconcile_purchase_order', 'resolve_delivery_discrepancy', 'close_purchase_order', 'handover_to_accounts_payable', 'review_payment_handover', 'revise_payment_handover', 'record_payment', 'close_finance',
    'create_change_order', 'approve_change_order',
  ]),
  architecture: Object.freeze([
    'analyze_site', 'validate_planning_constraints', 'validate_site_setbacks', 'validate_parking_access', 'estimate_energy_performance', 'create_space_program',
    'generate_floor_plan', 'generate_renovation_scope', 'generate_building_mass', 'generate_section_elevation', 'run_construction_workflow', 'generate_construction_schedule', 'record_construction_progress', 'record_site_inspection', 'create_rectification_order', 'close_rectification_order', 'materialize_floor_plan_model', 'calculate_areas', 'validate_building_code',
    'analyze_daylight', 'validate_fire_egress', 'validate_accessibility', 'validate_structure', 'estimate_mep_loads',
    'create_bim_element', 'update_bim_element', 'sync_bim_properties',
    'extract_quantities', 'generate_drawing_set', 'run_drawing_review',
    'create_design_revision', 'compare_design_revisions', 'export_obj', 'export_dxf', 'export_ifc', 'export_handover_package',
  ]),
});

const extensionActions = new Map();

/** Register an application protocol action supplied by a plugin or MCP adapter. */
export function registerComputeUseProtocol(protocolId, actions) {
  if (typeof protocolId !== 'string' || !/^[a-z][a-z0-9._-]{1,63}$/i.test(protocolId)) {
    throw new Error('compute-use 协议标识无效');
  }
  if (!Array.isArray(actions) || actions.length === 0 ||
      actions.some((action) => typeof action !== 'string' || !/^[a-z][a-z0-9._-]{1,63}$/i.test(action))) {
    throw new Error('compute-use 协议动作无效');
  }
  extensionActions.set(protocolId, new Set(actions));
  return [...extensionActions.get(protocolId)];
}

export function isComputeUseAction(connectorId, action) {
  return typeof connectorId === 'string' &&
    typeof action === 'string' &&
    (Boolean(COMPUTE_USE_ACTIONS[connectorId]?.includes(action)) ||
      Boolean(extensionActions.get(connectorId)?.has(action)));
}

export function assertComputeUseAction(connectorId, action) {
  if (!isComputeUseAction(connectorId, action)) {
    throw new Error(`不允许的 compute-use 动作：${connectorId}/${action}`);
  }
  return action;
}
