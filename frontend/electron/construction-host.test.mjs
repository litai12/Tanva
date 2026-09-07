import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConstructionCapabilityHost } from './construction-host.mjs';

const scope = { projectId: 'project-demo', taskId: 'task-demo' };
const square = (size = 10) => ({ type: 'polygon', unit: 'm', polygon: [[0, 0], [size, 0], [size, size], [0, size]] });
const call = (host, connectorId, toolName, args = {}) => host.callTool(connectorId, toolName, { ...scope, ...args }).then((result) => JSON.parse(result.result.content[0].text));

test('architecture chain calculates areas, quantities and rejects unsafe geometry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-construction-'));
  try {
    const host = new ConstructionCapabilityHost(root);
    const site = await call(host, 'architecture', 'analyze_site', { site: square(20), buildings: [{ id: 'house', footprint: square(10), floors: 2 }] });
    assert.equal(site.site.area, 400); assert.equal(site.totals.grossFloorArea, 200);
    const setbacks = await call(host, 'architecture', 'validate_site_setbacks', { site: square(20), buildings: [{ id: 'house', footprint: { type: 'polygon', unit: 'm', polygon: [[3, 3], [13, 3], [13, 13], [3, 13]] } }], requiredSetback: { side: 2, front: 2, rear: 2 } });
    assert.equal(setbacks.status, 'pass'); assert.equal(setbacks.checks[0].actual.left, 3);
    const access = await call(host, 'architecture', 'validate_parking_access', { parking: { provided: 12, required: 10, accessibleProvided: 2, accessibleRequired: 1 }, access: { roadWidth: 6, minRoadWidth: 5, fireLaneWidth: 4, minFireLaneWidth: 4, turningRadius: 9, minTurningRadius: 8 } });
    assert.equal(access.status, 'pass'); assert.equal(access.nextAction, 'continue_design');
    const failedAccess = await call(host, 'architecture', 'validate_parking_access', { parking: { provided: 8, required: 10 }, access: { roadWidth: 4, minRoadWidth: 5 } });
    assert.equal(failedAccess.status, 'fail'); assert.equal(failedAccess.nextAction, 'revise_site_plan');
    const energy = await call(host, 'architecture', 'estimate_energy_performance', { grossFloorArea: 100, degreeDays: 1800, coolingDegreeDays: 1200, maxEui: 250, envelope: { wallArea: 200, wallUValue: 0.5, roofArea: 100, roofUValue: 0.3, windowArea: 20, windowUValue: 2 } });
    assert.equal(energy.status, 'pass'); assert.equal(energy.units.eui, 'kWh/m²·yr'); assert.ok(energy.eui > 0);
    const inefficient = await call(host, 'architecture', 'estimate_energy_performance', { grossFloorArea: 100, maxEui: 50, envelope: { wallArea: 200, wallUValue: 0.5 } });
    assert.equal(inefficient.status, 'fail'); assert.equal(inefficient.checks[0].code, 'eui');
    const failedSetbacks = await call(host, 'architecture', 'validate_site_setbacks', { site: square(20), buildings: [{ id: 'house', footprint: { type: 'polygon', unit: 'm', polygon: [[1, 1], [11, 1], [11, 11], [1, 11]] } }], requiredSetback: { side: 2, front: 2, rear: 2 } });
    assert.equal(failedSetbacks.status, 'fail'); assert.ok(failedSetbacks.checks[0].violations.some((item) => item.side === 'left'));
    const plan = await call(host, 'architecture', 'generate_floor_plan', { boundary: square(10), gap: 0.2, spaces: [{ id: 'living', name: '客厅', area: 20 }, { id: 'bed', name: '卧室', area: 15 }] });
    assert.equal(plan.status, 'feasible'); assert.equal(plan.rooms.every((room) => room.status === 'placed'), true);
    assert.equal(plan.rooms[0].polygon.length, 4); assert.ok(plan.rooms[0].area >= 20);
    const renovation = await call(host, 'architecture', 'generate_renovation_scope', {
      id: 'renovation-demo', rooms: [{ id: 'living-finish', name: '客厅', polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], height: 2.8,
        finishes: { floor: { materialCode: 'floor-tile', wasteRate: 0.1 }, wall: { materialCode: 'wall-paint', wasteRate: 0.05 }, ceiling: { materialCode: 'ceiling-paint' } } }],
    });
    assert.equal(renovation.renovationScope.status, 'draft');
    assert.equal(renovation.quantities.length, 3);
    assert.equal(renovation.quantities.find((line) => line.surface === 'floor').materialCode, 'floor-tile');
    assert.equal(renovation.quantities.find((line) => line.surface === 'floor').quantity, 22);
    const mass = await call(host, 'architecture', 'generate_building_mass', { floorHeight: 3, buildings: [{ id: 'mass-a', name: '主楼', footprint: square(8), floors: 2 }] });
    assert.equal(mass.elements[0].properties.height, 6); assert.equal(mass.blenderMeshes[0].faces.length, 6);
    assert.deepEqual(mass.blenderMeshes[0].vertices.slice(0, 4).map((vertex) => vertex[2]), [0, 0, 0, 0]);
    const views = await call(host, 'architecture', 'generate_section_elevation', { floorHeight: 3, buildings: [{ id: 'view-a', footprint: square(8), floors: 2 }] });
    assert.equal(views.views[0].height, 6); assert.equal(views.views[0].levels.length, 3); assert.equal(views.format, 'structured-linework');
    const structure = await call(host, 'architecture', 'validate_structure', { maxSpan: 8, minColumnSpacing: 3, spans: [{ id: 'grid-a', length: 6, columnCount: 3 }] });
    assert.equal(structure.status, 'pass'); assert.equal(structure.checks[0].columnSpacing, 3);
    const mep = await call(host, 'architecture', 'estimate_mep_loads', { rooms: [{ id: 'living', area: 20, occupants: 3 }] });
    assert.equal(mep.totals.electricalW, 400); assert.equal(mep.totals.coolingW, 1600); assert.equal(mep.units.water, 'L/day');
    const materialized = await call(host, 'architecture', 'materialize_floor_plan_model', { rooms: plan.rooms, height: 3 });
    assert.equal(materialized.elementIds.length, 2); assert.equal(materialized.blenderMeshes[0].faces.length, 6);
    assert.equal(Math.max(...materialized.blenderMeshes[0].faces.flat()), materialized.blenderMeshes[0].vertices.length - 1);
    const element = await call(host, 'architecture', 'create_bim_element', { element: { id: 'wall-1', type: 'wall', geometry: square(10), quantity: { height: 3, thickness: 0.2, materialCode: 'concrete' } } });
    assert.equal(element.element.revision, 1);
    const quantities = await call(host, 'architecture', 'extract_quantities');
    assert.equal(quantities.quantities.find((item) => item.materialCode === 'concrete')?.quantity, 24);
    const obj = await call(host, 'architecture', 'export_obj');
    const dxf = await call(host, 'architecture', 'export_dxf');
    const ifc = await call(host, 'architecture', 'export_ifc');
    assert.equal(obj.artifact.format, 'obj'); assert.equal(dxf.artifact.format, 'dxf'); assert.equal(ifc.artifact.format, 'ifc');
    assert.ok(obj.artifact.path.endsWith('.obj')); assert.ok(ifc.artifact.path.endsWith('.ifc'));
    const bom = await call(host, 'business', 'generate_bom_from_model');
    assert.equal(bom.bom.find((item) => item.materialCode === 'concrete')?.materialCode, 'concrete');
    const request = await call(host, 'business', 'create_purchase_request', { title: '墙体材料', lines: bom.bom });
    const order = await call(host, 'business', 'create_purchase_order', { requestId: request.request.id, supplierId: 'supplier-a', lines: [{ lineId: 'wall-1:concrete', materialCode: 'concrete', quantity: 24, unit: 'm³', unitPrice: 500 }] });
    const delivery = await call(host, 'business', 'record_delivery', { orderId: order.order.id, receiver: 'qa-user', lines: [{ lineId: 'wall-1:concrete', quantity: 24, accepted: true }] });
    assert.equal(delivery.orderStatus, 'received');
    const reconciliation = await call(host, 'business', 'reconcile_purchase_order', { orderId: order.order.id });
    assert.equal(reconciliation.reconciliation.status, 'ready_to_close'); assert.equal(reconciliation.reconciliation.totalAccepted, 24); assert.equal(reconciliation.nextAction, 'close_purchase_order');
    const closedOrder = await call(host, 'business', 'close_purchase_order', { orderId: order.order.id, closedBy: 'buyer' });
    assert.equal(closedOrder.order.status, 'closed'); assert.equal(closedOrder.nextAction, 'handover_to_accounts_payable');
    const payable = await call(host, 'business', 'handover_to_accounts_payable', { orderId: order.order.id, invoiceNumber: 'INV-001', taxRate: 0.06, requestedBy: 'buyer' });
    assert.equal(payable.handover.status, 'pending'); assert.equal(payable.handover.payable, 12720); assert.equal(payable.nextAction, 'review_payment_handover');
    const reviewedPayable = await call(host, 'business', 'review_payment_handover', { handoverId: payable.handover.id, decision: 'approved', reviewedBy: 'finance' });
    assert.equal(reviewedPayable.handover.status, 'approved'); assert.equal(reviewedPayable.nextAction, 'record_payment');
    const partialPayment = await call(host, 'business', 'record_payment', { handoverId: payable.handover.id, amount: 6000, paidBy: 'cashier' });
    assert.equal(partialPayment.handover.status, 'partially_paid'); assert.equal(partialPayment.handover.balance, 6720);
    const finalPayment = await call(host, 'business', 'record_payment', { handoverId: payable.handover.id, amount: 6720, paidBy: 'cashier' });
    assert.equal(finalPayment.handover.status, 'paid'); assert.equal(finalPayment.nextAction, 'close_finance');
    const closedFinance = await call(host, 'business', 'close_finance', { handoverId: payable.handover.id, closedBy: 'finance' });
    assert.equal(closedFinance.handover.status, 'closed'); assert.equal(closedFinance.workflowStatus, 'complete'); assert.equal(closedFinance.nextAction, null);
    await assert.rejects(() => call(host, 'business', 'close_finance', { handoverId: payable.handover.id }), /已经关闭/);
    await assert.rejects(() => call(host, 'business', 'handover_to_accounts_payable', { orderId: order.order.id }), /已经生成/);
    await assert.rejects(() => call(host, 'business', 'close_purchase_order', { orderId: order.order.id }), /已经关闭/);
    const supplier = await call(host, 'business', 'register_supplier', { id: 'supplier-a', name: '示例供应商', leadTimeDays: 7, rating: 4.5 });
    assert.equal(supplier.supplier.status, 'active'); assert.equal(supplier.supplier.leadTimeDays, 7);
    const change = await call(host, 'business', 'create_change_order', { title: '墙厚调整', changes: [{ targetId: 'wall-1', field: 'thickness', before: 0.2, after: 0.24, reason: '结构优化' }] });
    const approved = await call(host, 'business', 'approve_change_order', { changeOrderId: change.changeOrder.id, decision: 'approved', reviewedBy: 'architect' });
    assert.equal(approved.changeOrder.status, 'approved');
    await assert.rejects(() => call(host, 'architecture', 'create_bim_element', { element: { id: 'bad', type: 'wall', geometry: { polygon: [[0, 0], [1, 1], [2, 2]] } } }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('all architecture and business tools are callable through the host', async () => {
  const host = new ConstructionCapabilityHost('/tmp/tanva-construction-contract-test');
  for (const connector of ['architecture', 'business']) {
    const tools = await host.listTools(connector);
    assert.ok(tools.length > 0);
    for (const tool of tools) assert.equal(tool.inputSchema.required.includes('projectId'), true);
  }
  const renovationTool = (await host.listTools('architecture')).find((tool) => tool.name === 'generate_renovation_scope');
  assert.equal(renovationTool.inputSchema.properties.rooms.type, 'array');
  const discrepancyTool = (await host.listTools('business')).find((tool) => tool.name === 'resolve_delivery_discrepancy');
  assert.equal(discrepancyTool.inputSchema.properties.disposition.type, 'string');
});

test('procurement exceptions resolve rejected goods and resubmit payable handover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-procurement-exceptions-'));
  try {
    const host = new ConstructionCapabilityHost(root);
    const order = await call(host, 'business', 'create_purchase_order', {
      id: 'po-exception', supplierId: 'supplier-exception',
      lines: [{ lineId: 'tile', materialCode: 'tile', quantity: 5, unit: 'm2', unitPrice: 100 }],
    });
    const delivery = await call(host, 'business', 'record_delivery', {
      id: 'delivery-rejected', orderId: order.order.id,
      lines: [{ lineId: 'tile', quantity: 5, accepted: false, lot: 'bad-lot' }],
    });
    let reconciliation = await call(host, 'business', 'reconcile_purchase_order', { orderId: order.order.id });
    assert.equal(reconciliation.reconciliation.status, 'inspection_required');
    const accepted = await call(host, 'business', 'resolve_delivery_discrepancy', {
      orderId: order.order.id, deliveryId: delivery.delivery.id, lineId: 'tile',
      disposition: 'accept', quantity: 2, resolvedBy: 'qa', id: 'resolution-accept-2',
    });
    assert.equal(accepted.lineLedger.accepted, 2); assert.equal(accepted.lineLedger.rejected, 3);
    const returned = await call(host, 'business', 'resolve_delivery_discrepancy', {
      orderId: order.order.id, deliveryId: delivery.delivery.id, lineId: 'tile',
      disposition: 'return', quantity: 3, resolvedBy: 'qa', id: 'resolution-return-3',
    });
    assert.equal(returned.lineLedger.returned, 3); assert.equal(returned.nextAction, 'record_delivery');
    const replacement = await call(host, 'business', 'record_delivery', {
      id: 'delivery-replacement', orderId: order.order.id,
      lines: [{ lineId: 'tile', quantity: 3, accepted: true, lot: 'good-lot' }],
    });
    assert.equal(replacement.orderStatus, 'received');
    reconciliation = await call(host, 'business', 'reconcile_purchase_order', { orderId: order.order.id });
    assert.equal(reconciliation.reconciliation.status, 'ready_to_close');
    assert.equal(reconciliation.reconciliation.lines[0].returned, 3);
    await call(host, 'business', 'close_purchase_order', { orderId: order.order.id });
    const payable = await call(host, 'business', 'handover_to_accounts_payable', { orderId: order.order.id, taxRate: 0.06 });
    const rejected = await call(host, 'business', 'review_payment_handover', { handoverId: payable.handover.id, decision: 'rejected', note: '发票抬头不完整' });
    assert.equal(rejected.nextAction, 'revise_payment_handover');
    const revised = await call(host, 'business', 'revise_payment_handover', { handoverId: payable.handover.id, invoiceNumber: 'INV-REVISED', paymentTerms: '月结30天', taxRate: 0.03, note: '已补齐发票信息' });
    assert.equal(revised.handover.status, 'pending'); assert.equal(revised.handover.revision, 1); assert.equal(revised.handover.payable, 515);
    const approved = await call(host, 'business', 'review_payment_handover', { handoverId: payable.handover.id, decision: 'approved' });
    assert.equal(approved.nextAction, 'record_payment');
    const paid = await call(host, 'business', 'record_payment', { handoverId: payable.handover.id });
    assert.equal(paid.handover.status, 'paid');
    const closed = await call(host, 'business', 'close_finance', { handoverId: payable.handover.id });
    assert.equal(closed.workflowStatus, 'complete'); assert.equal(closed.nextAction, null);
    await assert.rejects(() => call(host, 'business', 'record_delivery', { orderId: order.order.id, lines: [{ lineId: 'tile', quantity: 1 }] }), /已经关闭/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('construction workflow runs space planning through BOM generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-construction-workflow-'));
  try {
    const host = new ConstructionCapabilityHost(root);
    const result = await call(host, 'architecture', 'run_construction_workflow', {
      boundary: square(10), height: 3,
      idempotencyKey: 'workflow-demo-1',
      spaces: [{ id: 'living', name: '客厅', area: 20 }, { id: 'bed', name: '卧室', area: 15 }],
      renovationRooms: [{ id: 'living-finish', area: 20, perimeter: 18, finishes: { floor: { materialCode: 'floor-tile' } } }],
    });
    assert.equal(result.status, 'feasible');
    assert.equal(result.model.elementIds.length, 2);
    assert.equal(result.bom.bom.length, 5);
    assert.equal(result.renovation.quantities.find((line) => line.materialCode === 'floor-tile').quantity, 20);
    assert.deepEqual(result.steps, ['create_space_program', 'generate_floor_plan', 'materialize_floor_plan_model', 'extract_quantities', 'generate_renovation_scope', 'generate_bom_from_model']);
    const replay = await call(host, 'architecture', 'run_construction_workflow', {
      boundary: square(10), height: 3, idempotencyKey: 'workflow-demo-1',
      spaces: [{ id: 'living', name: '客厅', area: 20 }, { id: 'bed', name: '卧室', area: 15 }],
      renovationRooms: [{ id: 'living-finish', area: 20, perimeter: 18, finishes: { floor: { materialCode: 'floor-tile' } } }],
    });
    assert.equal(replay.replayed, true); assert.deepEqual(replay.model.elementIds, result.model.elementIds);
    const schedule = await call(host, 'architecture', 'generate_construction_schedule', {
      id: 'schedule-demo', startDate: '2026-09-07T00:00:00.000Z',
      tasks: [{ id: 'design', name: '设计深化', durationDays: 2 }, { id: 'procurement', name: '材料采购', durationDays: 3, predecessors: ['design'] }, { id: 'install', name: '现场安装', durationDays: 4, predecessors: ['procurement'] }],
    });
    assert.equal(schedule.durationDays, 9); assert.equal(schedule.schedule.tasks[2].startDate, '2026-09-12T00:00:00.000Z');
    await assert.rejects(() => call(host, 'architecture', 'record_construction_progress', { scheduleId: 'schedule-demo', taskId: 'install', progress: 10 }), /前置/);
    await call(host, 'architecture', 'record_construction_progress', { scheduleId: 'schedule-demo', taskId: 'design', progress: 100 });
    await call(host, 'architecture', 'record_construction_progress', { scheduleId: 'schedule-demo', taskId: 'procurement', progress: 100 });
    const progress = await call(host, 'architecture', 'record_construction_progress', { scheduleId: 'schedule-demo', taskId: 'install', progress: 50, status: 'in-progress' });
    assert.equal(progress.task.status, 'in-progress'); assert.equal(progress.scheduleStatus, 'in-progress'); assert.equal(progress.scheduleProgress, 83.33);
    const inspection = await call(host, 'architecture', 'record_site_inspection', { id: 'inspection-demo', category: '隐蔽工程', checks: [{ code: 'waterproofing', label: '防水层连续', status: 'pass' }, { code: 'slope', label: '排水坡度', status: 'fail', detail: '局部坡度不足' }] });
    assert.equal(inspection.inspection.status, 'fail'); assert.deepEqual(inspection.failedChecks, ['slope']); assert.equal(inspection.nextAction, 'create_rectification_order');
    const rectification = await call(host, 'architecture', 'create_rectification_order', { id: 'rectification-demo', inspectionId: 'inspection-demo', assignee: '施工班组', dueDate: '2026-09-20' });
    assert.equal(rectification.order.issues.length, 1); assert.equal(rectification.order.status, 'open');
    const closed = await call(host, 'architecture', 'close_rectification_order', { orderId: 'rectification-demo', result: 'pass', resolution: '已补做排水坡度并复验' });
    assert.equal(closed.order.status, 'closed'); assert.equal(closed.nextAction, 'continue_construction');
    await assert.rejects(() => call(host, 'architecture', 'generate_construction_schedule', { tasks: [{ id: 'a', name: 'A', durationDays: 1, predecessors: ['b'] }, { id: 'b', name: 'B', durationDays: 1, predecessors: ['a'] }] }), /循环/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed construction workflow restores the project engineering snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-construction-rollback-'));
  try {
    const host = new ConstructionCapabilityHost(root);
    await assert.rejects(() => call(host, 'architecture', 'run_construction_workflow', {
      boundary: square(10), height: 0, idempotencyKey: 'rollback-demo', spaces: [{ id: 'living', area: 20 }],
    }), /height/);
    const state = await host.store.read(scope);
    assert.equal(state.bim.length, 0); assert.equal(state.quantities.length, 0); assert.equal(state.bom.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
