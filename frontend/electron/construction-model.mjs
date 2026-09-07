import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 20_000;
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const finite = (value, label) => {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} 必须是有限数字`);
  return result;
};
const positive = (value, label) => {
  const result = finite(value, label);
  if (result <= 0) throw new Error(`${label} 必须大于 0`);
  return result;
};
const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} 无效`);
  return value;
};
const unitScale = (unit = 'm') => ({ m: 1, mm: 0.001, cm: 0.01, ft: 0.3048 }[String(unit).toLowerCase()] || (() => { throw new Error(`不支持的长度单位：${unit}`); })());
const points = (polygon, unit = 'm') => {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 10_000) throw new Error('polygon 至少需要 3 个点');
  const scale = unitScale(unit);
  const result = polygon.map((point, index) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error(`polygon[${index}] 无效`);
    return [round(finite(point[0], `polygon[${index}].x`) * scale), round(finite(point[1], `polygon[${index}].y`) * scale)];
  });
  const [first] = result; const last = result[result.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) result.pop();
  if (result.length < 3) throw new Error('polygon 不能退化');
  return result;
};
export const polygonArea = (polygon) => Math.abs(polygon.reduce((sum, point, i) => {
  const next = polygon[(i + 1) % polygon.length];
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0) / 2);
export const polygonPerimeter = (polygon) => polygon.reduce((sum, point, i) => {
  const next = polygon[(i + 1) % polygon.length]; return sum + Math.hypot(next[0] - point[0], next[1] - point[1]);
}, 0);
const checkPolygon = (polygon, label) => {
  const area = polygonArea(polygon); if (area < 1e-8) throw new Error(`${label} 面积为 0`);
  return { area: round(area), perimeter: round(polygonPerimeter(polygon)) };
};

export const normalizeGeometry = (geometry, label = 'geometry') => {
  if (!geometry || typeof geometry !== 'object') throw new Error(`${label} 无效`);
  const type = geometry.type || 'polygon';
  const unit = geometry.unit || 'm';
  if (type === 'polygon' || type === 'floor') {
    const polygon = points(geometry.polygon || geometry.points, unit); return { ...geometry, type, unit: 'm', polygon, ...checkPolygon(polygon, label) };
  }
  if (type === 'box' || type === 'column') {
    const scale = unitScale(unit); return { ...geometry, type, unit: 'm', width: positive(geometry.width, `${label}.width`) * scale, depth: positive(geometry.depth, `${label}.depth`) * scale, height: positive(geometry.height, `${label}.height`) * scale };
  }
  throw new Error(`${label} 不支持的几何类型：${type}`);
};
const ensureProject = (args) => {
  const projectId = identifier(args?.projectId, 'projectId');
  const taskId = identifier(args?.taskId, 'taskId');
  return { projectId, taskId, accountId: typeof args.accountId === 'string' ? identifier(args.accountId, 'accountId') : 'local-account' };
};
const stableDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const baseState = (scope) => ({ schemaVersion: 1, scope, updatedAt: new Date().toISOString(), revisions: [], bim: [], quantities: [], bom: [], renovationScopes: [], suppliers: [], quotes: [], purchaseRequests: [], purchaseOrders: [], deliveries: [], reconciliations: [], paymentHandovers: [], payments: [], changeOrders: [], schedules: [], inspections: [], rectificationOrders: [], drawingSets: [], reviews: [], handoverPackages: [], artifacts: [], idempotency: {} });

export class ConstructionStore {
  constructor(root) { this.root = root; this.locks = new Map(); }
  path(scope) { return join(this.root, 'construction', `${createHash('sha256').update(scope.accountId + ':' + scope.projectId).digest('hex')}.json`); }
  artifactPath(scope, extension) { return join(this.root, 'construction', createHash('sha256').update(scope.accountId + ':' + scope.projectId).digest('hex'), 'artifacts', `model-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`); }
  async withState(args, mutate) {
    const scope = ensureProject(args); const path = this.path(scope); const previous = this.locks.get(path) || Promise.resolve();
    const operation = previous.then(async () => {
      let state = baseState(scope);
      try {
        if (existsSync(path)) {
          const parsed = JSON.parse(await readFile(path, 'utf8'));
          state = { ...baseState(scope), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
          for (const key of ['revisions', 'bim', 'quantities', 'bom', 'renovationScopes', 'suppliers', 'quotes', 'purchaseRequests', 'purchaseOrders', 'deliveries', 'reconciliations', 'paymentHandovers', 'payments', 'changeOrders', 'schedules', 'inspections', 'rectificationOrders', 'drawingSets', 'reviews', 'handoverPackages', 'artifacts']) if (!Array.isArray(state[key])) state[key] = [];
          if (!state.idempotency || typeof state.idempotency !== 'object') state.idempotency = {};
        }
      } catch { state = baseState(scope); }
      const result = await mutate(state, scope);
      state.updatedAt = new Date().toISOString();
      const payload = JSON.stringify(state); if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new Error('项目工程状态超过 8MB 限制');
      await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, `${payload}\n`, { mode: 0o600 }); await rename(temp, path);
      return result;
    });
    const queued = operation.catch(() => {});
    this.locks.set(path, queued);
    try { return await operation; } finally { if (this.locks.get(path) === queued) this.locks.delete(path); }
  }
  async read(args) { return this.withState(args, (state) => ({ ...state, bim: state.bim.slice(-MAX_ITEMS), quantities: state.quantities.slice(-MAX_ITEMS), bom: state.bom.slice(-MAX_ITEMS), revisions: state.revisions.slice(-200), suppliers: state.suppliers.slice(-MAX_ITEMS), quotes: state.quotes.slice(-MAX_ITEMS), purchaseRequests: state.purchaseRequests.slice(-MAX_ITEMS), purchaseOrders: state.purchaseOrders.slice(-MAX_ITEMS), deliveries: state.deliveries.slice(-MAX_ITEMS), reconciliations: state.reconciliations.slice(-MAX_ITEMS), paymentHandovers: state.paymentHandovers.slice(-MAX_ITEMS), payments: state.payments.slice(-MAX_ITEMS), changeOrders: state.changeOrders.slice(-MAX_ITEMS), schedules: state.schedules.slice(-200), inspections: state.inspections.slice(-200), rectificationOrders: state.rectificationOrders.slice(-200), drawingSets: state.drawingSets.slice(-200), reviews: state.reviews.slice(-200), handoverPackages: state.handoverPackages.slice(-200), artifacts: state.artifacts.slice(-MAX_ITEMS) })); }
  async restore(args, snapshot) { return this.withState(args, (state) => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, JSON.parse(JSON.stringify(snapshot))); return true; }); }
  async idempotent(state, args, key, make) { const scoped = `${args.taskId}:${key}`; if (state.idempotency[scoped]) return state.idempotency[scoped]; const result = await make(); state.idempotency[scoped] = result; return result; }
  async analyzeSite(args) {
    return this.withState(args, async (_state, scope) => { const site = normalizeGeometry(args.site, 'site'); const buildings = Array.isArray(args.buildings) ? args.buildings : []; const metrics = buildings.map((building, i) => { const footprint = normalizeGeometry(building.footprint, `buildings[${i}].footprint`); const floors = Math.max(1, Math.floor(finite(building.floors ?? 1, `buildings[${i}].floors`))); const height = positive(building.height ?? floors * 3, `buildings[${i}].height`); return { id: building.id || `building-${i + 1}`, footprintArea: footprint.area, perimeter: footprint.perimeter, floors, height, grossFloorArea: round(footprint.area * floors), coverage: round(footprint.area / site.area, 6), far: round(footprint.area * floors / site.area, 6) }; }); return { action: 'analyze_site', ...scope, site: { ...site, area: round(site.area), perimeter: round(site.perimeter) }, buildings: metrics, totals: { siteArea: round(site.area), buildingFootprintArea: round(metrics.reduce((s, b) => s + b.footprintArea, 0)), grossFloorArea: round(metrics.reduce((s, b) => s + b.grossFloorArea, 0)), coverage: round(metrics.reduce((s, b) => s + b.footprintArea, 0) / site.area, 6), far: round(metrics.reduce((s, b) => s + b.grossFloorArea, 0) / site.area, 6) }, limitations: ['未执行地籍边界相交、地形高程或行政规范判断；需要在 constraints 中提供项目适用规则。'] }; });
  }
  async validatePlanning(args) {
    return this.withState(args, async (_state, scope) => { const metrics = args.metrics; if (!metrics || typeof metrics !== 'object') throw new Error('validate_planning_constraints 需要 analyze_site 返回的 metrics'); const constraints = args.constraints || {}; const checks = []; const add = (name, actual, limit, relation = 'max') => { if (limit === undefined || limit === null) return; const n = finite(limit, `${name}.limit`); const pass = relation === 'min' ? actual >= n : actual <= n; checks.push({ name, actual: round(actual), limit: n, relation, status: pass ? 'pass' : 'fail', evidence: `项目输入 constraints.${name}` }); }; add('coverage', metrics.coverage, constraints.maxCoverage); add('far', metrics.far, constraints.maxFar); add('grossFloorArea', metrics.grossFloorArea, constraints.maxGrossFloorArea); add('buildingFootprintArea', metrics.buildingFootprintArea, constraints.maxFootprintArea); add('siteArea', metrics.siteArea, constraints.minSiteArea, 'min'); return { action: 'validate_planning_constraints', ...scope, status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail', checks, assumptions: ['仅校验用户显式提供的阈值；不内置或推断任何地区规范数值。'] }; });
  }
  async validateSetbacks(args) {
    return this.withState(args, async (_state, scope) => {
      const site = normalizeGeometry(args.site, 'site');
      const buildings = Array.isArray(args.buildings) ? args.buildings : [];
      if (!buildings.length) throw new Error('validate_site_setbacks 需要 buildings');
      const required = args.requiredSetback == null ? {} : args.requiredSetback;
      const threshold = (side, fallback = 0) => Math.max(0, finite(required[side] ?? fallback, `requiredSetback.${side}`));
      const siteXs = site.polygon.map(([x]) => x); const siteYs = site.polygon.map(([, y]) => y);
      const bounds = { minX: Math.min(...siteXs), maxX: Math.max(...siteXs), minY: Math.min(...siteYs), maxY: Math.max(...siteYs) };
      const checks = buildings.map((building, index) => {
        const footprint = normalizeGeometry(building.footprint || building.geometry, `buildings[${index}].footprint`);
        const xs = footprint.polygon.map(([x]) => x); const ys = footprint.polygon.map(([, y]) => y);
        const actual = { left: round(Math.min(...xs) - bounds.minX), right: round(bounds.maxX - Math.max(...xs)), front: round(Math.min(...ys) - bounds.minY), rear: round(bounds.maxY - Math.max(...ys)) };
        const limits = { left: threshold('left', threshold('side')), right: threshold('right', threshold('side')), front: threshold('front'), rear: threshold('rear') };
        const violations = Object.keys(limits).filter((side) => actual[side] < limits[side]).map((side) => ({ side, actual: actual[side], required: limits[side] }));
        return { id: building.id || `building-${index + 1}`, actual, limits, status: violations.length ? 'fail' : 'pass', violations };
      });
      return { action: 'validate_site_setbacks', ...scope, status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail', checks, method: 'axis-aligned-site-bounds', note: '当前按场地和建筑包围盒计算退界；非正交地块、道路红线、角地和地区规则需专业规划工具复核。' };
    });
  }
  async validateParkingAccess(args) {
    return this.withState(args, async (_state, scope) => {
      const parking = args.parking && typeof args.parking === 'object' ? args.parking : {};
      const access = args.access && typeof args.access === 'object' ? args.access : {};
      const checks = [];
      const add = (code, actual, limit, relation = 'min', unit = null) => {
        if (limit === undefined || limit === null) return;
        const value = finite(actual ?? 0, `${code}.actual`); const threshold = finite(limit, `${code}.limit`);
        const pass = relation === 'max' ? value <= threshold : value >= threshold;
        checks.push({ code, actual: round(value), required: threshold, relation, unit, status: pass ? 'pass' : 'fail', evidence: `项目输入 ${code}` });
      };
      add('parkingSpaces', parking.provided ?? parking.count, parking.required, 'min', 'space');
      add('accessibleParkingSpaces', parking.accessibleProvided, parking.accessibleRequired, 'min', 'space');
      add('accessRoadWidth', access.roadWidth, access.minRoadWidth, 'min', 'm');
      add('fireLaneWidth', access.fireLaneWidth, access.minFireLaneWidth, 'min', 'm');
      add('turningRadius', access.turningRadius, access.minTurningRadius, 'min', 'm');
      return { action: 'validate_parking_access', ...scope, status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail', checks, nextAction: checks.some((check) => check.status === 'fail') ? 'revise_site_plan' : 'continue_design', note: '仅校验项目输入的停车与通行阈值；消防车道、转弯半径和无障碍车位仍需按当地规范及专业交通/消防审查确认。' };
    });
  }
  async estimateEnergyPerformance(args) {
    return this.withState(args, async (_state, scope) => {
      const envelope = args.envelope && typeof args.envelope === 'object' ? args.envelope : {};
      const grossFloorArea = positive(args.grossFloorArea ?? args.floorArea, 'grossFloorArea');
      const degreeDays = Math.max(0, finite(args.degreeDays ?? 1800, 'degreeDays'));
      const coolingDegreeDays = Math.max(0, finite(args.coolingDegreeDays ?? degreeDays, 'coolingDegreeDays'));
      const hoursPerDay = Math.max(1, Math.min(24, finite(args.hoursPerDay ?? 24, 'hoursPerDay')));
      const transmission = (area, uValue, degreeDayValue, code) => Math.max(0, finite(area ?? 0, `${code}.area`)) * Math.max(0, finite(uValue ?? 0, `${code}.uValue`)) * degreeDayValue * hoursPerDay / 1000;
      const wall = transmission(envelope.wallArea, envelope.wallUValue, degreeDays, 'wall');
      const roof = transmission(envelope.roofArea, envelope.roofUValue, degreeDays, 'roof');
      const window = transmission(envelope.windowArea, envelope.windowUValue, degreeDays, 'window');
      const lighting = grossFloorArea * Math.max(0, finite(args.lightingKwhPerM2 ?? 12, 'lightingKwhPerM2'));
      const equipment = grossFloorArea * Math.max(0, finite(args.equipmentKwhPerM2 ?? 15, 'equipmentKwhPerM2'));
      const heating = round(wall + roof + window + lighting + equipment, 2);
      const cooling = round((wall + roof + window) * (coolingDegreeDays / Math.max(1, degreeDays)) + lighting + equipment, 2);
      const annual = round(heating + cooling, 2);
      const eui = round(annual / grossFloorArea, 2);
      const checks = [];
      if (args.maxEui != null) {
        const maxEui = positive(args.maxEui, 'maxEui');
        checks.push({ code: 'eui', actual: eui, required: maxEui, relation: 'max', unit: 'kWh/m²·yr', status: eui <= maxEui ? 'pass' : 'fail', evidence: '项目输入 maxEui' });
      }
      return { action: 'estimate_energy_performance', ...scope, status: checks.length && checks.some((check) => check.status === 'fail') ? 'fail' : 'pass', grossFloorArea: round(grossFloorArea, 2), loads: { heating: round(heating, 2), cooling: round(cooling, 2), annual: round(annual, 2) }, eui, checks, units: { annual: 'kWh/year', eui: 'kWh/m²·yr' }, method: 'degree-day-envelope-screening', note: '这是方案阶段传热和内部负荷筛查，不替代逐时能耗模拟、绿色建筑评价或节能审查。' };
    });
  }
  async createSpaceProgram(args) { return this.withState(args, async (_state, scope) => { const spaces = (Array.isArray(args.spaces) ? args.spaces : []).map((space, i) => ({ id: identifier(space.id || `space-${i + 1}`, `spaces[${i}].id`), name: String(space.name || space.id || `空间 ${i + 1}`).slice(0, 200), area: positive(space.area, `spaces[${i}].area`), count: Math.max(1, Math.floor(finite(space.count ?? 1, `spaces[${i}].count`))), level: Number.isInteger(space.level) ? space.level : 1, required: space.required !== false })).map((space) => ({ ...space, totalArea: round(space.area * space.count) })); if (!spaces.length) throw new Error('spaces 不能为空'); return { action: 'create_space_program', ...scope, spaces, totalArea: round(spaces.reduce((sum, s) => sum + s.totalArea, 0)), unresolved: spaces.filter((s) => s.area <= 0).map((s) => s.id) }; }); }
  async generateRenovationScope(args) {
    return this.withState(args, async (state, scope) => {
      const input = Array.isArray(args.rooms) ? args.rooms : [];
      if (!input.length || input.length > 10_000) throw new Error('generate_renovation_scope 需要 1 到 10000 个房间');
      const defaultHeight = positive(args.defaultHeight ?? 2.8, 'defaultHeight');
      const defaultOpening = Math.max(0, finite(args.defaultOpeningArea ?? 0, 'defaultOpeningArea'));
      const surfaces = ['floor', 'wall', 'ceiling'];
      const lines = [];
      const rooms = input.map((room, i) => {
        const id = identifier(room.id || `room-${i + 1}`, `rooms[${i}].id`);
        const geometry = room.geometry || (Array.isArray(room.polygon) ? { type: 'polygon', unit: room.unit || 'm', polygon: room.polygon } : null);
        const normalized = geometry ? normalizeGeometry(geometry, `rooms[${i}].geometry`) : null;
        const area = positive(room.area ?? normalized?.area, `rooms[${i}].area`);
        const perimeter = positive(room.perimeter ?? normalized?.perimeter, `rooms[${i}].perimeter`);
        const height = positive(room.height ?? defaultHeight, `rooms[${i}].height`);
        const openingArea = Math.min(perimeter * height, Math.max(0, finite(room.openingArea ?? defaultOpening, `rooms[${i}].openingArea`)));
        const surfaceAreas = { floor: area, wall: round(perimeter * height - openingArea), ceiling: area };
        const finishes = room.finishes && typeof room.finishes === 'object' ? room.finishes : {};
        for (const surface of surfaces) {
          const finish = finishes[surface] && typeof finishes[surface] === 'object' ? finishes[surface] : {};
          const materialCode = identifier(finish.materialCode || `${surface}-finish`, `rooms[${i}].finishes.${surface}.materialCode`);
          const wasteRate = Math.min(0.5, Math.max(0, finite(finish.wasteRate ?? args.wasteRate ?? 0, `rooms[${i}].finishes.${surface}.wasteRate`)));
          const quantity = round(surfaceAreas[surface] * (1 + wasteRate));
          lines.push({ lineId: `${id}:${surface}`, roomId: id, surface, materialCode, description: String(finish.description || `${room.name || id}-${surface}`).slice(0, 200), quantity, baseQuantity: surfaceAreas[surface], wasteRate, unit: 'm²', unitPrice: finish.unitPrice == null ? null : round(Math.max(0, finite(finish.unitPrice, `rooms[${i}].finishes.${surface}.unitPrice`)), 2) });
        }
        return { id, name: String(room.name || id).slice(0, 200), area: round(area), perimeter: round(perimeter), height: round(height), openingArea: round(openingArea), surfaceAreas };
      });
      const renovationScope = { id: identifier(args.id || `renovation-${Date.now()}`, 'id'), projectId: scope.projectId, taskId: scope.taskId, rooms, lines, status: 'draft', createdAt: new Date().toISOString(), nextActions: ['generate_bom_from_model', 'blender.create_floor_plan_meshes', 'sketchup.create_room_geometry'] };
      if (state.renovationScopes.some((item) => item.id === renovationScope.id)) throw new Error(`装修范围已存在：${renovationScope.id}`);
      state.renovationScopes.push(renovationScope);
      return { action: 'generate_renovation_scope', ...scope, renovationScope, quantities: lines, totals: lines.reduce((map, line) => { const key = `${line.materialCode}:${line.unit}`; map[key] = round((map[key] || 0) + line.quantity); return map; }, {}) };
    });
  }
  async generateFloorPlan(args) {
    return this.withState(args, async (_state, scope) => {
      const program = Array.isArray(args.spaces) ? args.spaces : [];
      if (!program.length) throw new Error('generate_floor_plan 需要 spaces');
      const boundary = normalizeGeometry(args.boundary, 'boundary');
      const gap = Math.max(0, finite(args.gap ?? 0.2, 'gap'));
      const xs = boundary.polygon.map(([x]) => x); const ys = boundary.polygon.map(([, y]) => y);
      const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
      const width = maxX - minX; const height = maxY - minY;
      const rectangular = Math.abs(boundary.area - width * height) < Math.max(1e-6, boundary.area * 1e-6);
      if (!rectangular) return { action: 'generate_floor_plan', ...scope, status: 'unsupported_boundary', boundary, requestedArea: round(program.reduce((sum, s) => sum + positive(s.area, 'space.area') * Math.max(1, Math.floor(s.count ?? 1)), 0)), rooms: [], limitations: ['当前确定性排布器只接受轴对齐矩形边界；复杂边界应先由 CAD/SketchUp/Rhino 生成可用分区。'] };
      const rooms = []; let cursorX = minX; let cursorY = minY; let rowHeight = 0; let overflow = false;
      const expanded = program.flatMap((space, index) => Array.from({ length: Math.max(1, Math.floor(space.count ?? 1)) }, (_, count) => ({ ...space, id: `${space.id || `space-${index + 1}`}-${count + 1}`, targetArea: positive(space.area, 'space.area') })));
      expanded.sort((a, b) => b.targetArea - a.targetArea);
      for (const space of expanded) {
        const availableWidth = maxX - cursorX; const desiredWidth = Math.min(Math.sqrt(space.targetArea), width);
        const roomWidth = Math.max(0.01, desiredWidth); const roomHeight = space.targetArea / roomWidth;
        if (roomWidth > availableWidth + 1e-6) { cursorX = minX; cursorY += rowHeight + gap; rowHeight = 0; }
        if (cursorY + roomHeight > maxY + 1e-6 || roomWidth > width + 1e-6) { overflow = true; rooms.push({ id: space.id, name: space.name || space.id, targetArea: round(space.targetArea), status: 'unplaced' }); continue; }
        const polygon = [[round(cursorX), round(cursorY)], [round(cursorX + roomWidth), round(cursorY)], [round(cursorX + roomWidth), round(cursorY + roomHeight)], [round(cursorX), round(cursorY + roomHeight)]];
        rooms.push({ id: space.id, name: space.name || space.id, targetArea: round(space.targetArea), area: round(roomWidth * roomHeight), polygon, level: space.level || 1, status: 'placed' });
        cursorX += roomWidth + gap; rowHeight = Math.max(rowHeight, roomHeight);
      }
      return { action: 'generate_floor_plan', ...scope, boundary, requestedArea: round(expanded.reduce((sum, s) => sum + s.targetArea, 0)), usableArea: round(Math.max(0, width * height - gap * Math.max(0, expanded.length - 1) * Math.min(width, height))), status: overflow ? 'over_capacity' : 'feasible', rooms, limitations: ['这是带面积和边界的方案级矩形排布；墙体、门窗、结构、设备和规范施工图仍需专业软件复核。'] };
    });
  }
  async calculateAreas(args) { return this.withState(args, async (_state, scope) => { const items = (Array.isArray(args.items) ? args.items : []).map((item, i) => { const geometry = normalizeGeometry(item.geometry, `items[${i}].geometry`); const floors = Math.max(1, Math.floor(item.floors ?? 1)); return { id: item.id || `area-${i + 1}`, name: item.name || item.id || `区域 ${i + 1}`, area: round(geometry.area * floors), netArea: round(geometry.area * floors * Math.max(0, 1 - Math.min(0.95, Number(item.lossRate ?? 0)))), perimeter: geometry.perimeter, floors }; }); return { action: 'calculate_areas', ...scope, items, totals: { grossArea: round(items.reduce((s, x) => s + x.area, 0)), netArea: round(items.reduce((s, x) => s + x.netArea, 0)) }, unit: 'm²', note: '各 item 独立求和；未做重叠消除。' }; }); }
  async validateBuildingCode(args) { return this.withState(args, async (_state, scope) => { const checks = []; for (const rule of Array.isArray(args.rules) ? args.rules : []) { const actual = finite(args.metrics?.[rule.metric], `metrics.${rule.metric}`); const limit = finite(rule.limit, `rules.${rule.metric}.limit`); const pass = rule.operator === '>=' ? actual >= limit : rule.operator === '>' ? actual > limit : rule.operator === '<' ? actual < limit : actual <= limit; checks.push({ code: rule.code || rule.metric, metric: rule.metric, actual: round(actual), limit, operator: rule.operator || '<=', status: pass ? 'pass' : 'fail', source: rule.source || null }); } return { action: 'validate_building_code', ...scope, status: checks.every((x) => x.status === 'pass') ? 'pass' : 'fail', checks, note: '规则必须由项目提供 code/limit/source；系统不替代设计人员或审图机构。' }; }); }
  async analyzeDaylight(args) { return this.withState(args, async (_state, scope) => { const rooms = Array.isArray(args.rooms) ? args.rooms : []; const checks = rooms.map((room, i) => { const windowArea = positive(room.windowArea, `rooms[${i}].windowArea`); const floorArea = positive(room.floorArea, `rooms[${i}].floorArea`); const ratio = round(windowArea / floorArea, 6); const min = room.minWindowToFloorRatio == null ? null : finite(room.minWindowToFloorRatio, `rooms[${i}].minWindowToFloorRatio`); return { id: room.id || `room-${i + 1}`, windowToFloorRatio: ratio, minRequired: min, status: min == null ? 'unassessed' : ratio >= min ? 'pass' : 'fail', source: room.source || null }; }); return { action: 'analyze_daylight', ...scope, checks, method: 'window-to-floor-ratio', note: '这是几何比值筛查，不是全年气象模拟或日照时数认证。' }; }); }
  async validateFireEgress(args) { return this.withState(args, async (_state, scope) => { const checks = (Array.isArray(args.routes) ? args.routes : []).map((route, i) => { const length = positive(route.length, `routes[${i}].length`); const max = route.maxLength == null ? null : positive(route.maxLength, `routes[${i}].maxLength`); const width = positive(route.width, `routes[${i}].width`); const minWidth = route.minWidth == null ? null : positive(route.minWidth, `routes[${i}].minWidth`); const ok = (max == null || length <= max) && (minWidth == null || width >= minWidth); return { id: route.id || `route-${i + 1}`, length, width, status: max == null && minWidth == null ? 'unassessed' : ok ? 'pass' : 'fail', limits: { maxLength: max, minWidth }, source: route.source || null }; }); return { action: 'validate_fire_egress', ...scope, checks, note: '仅计算提供的路线长度/宽度，未判断防火分区、疏散人数和消防设施。' }; }); }
  async validateAccessibility(args) { return this.withState(args, async (_state, scope) => { const checks = (Array.isArray(args.routes) ? args.routes : []).map((route, i) => { const slope = finite(route.slope ?? 0, `routes[${i}].slope`); const width = positive(route.width, `routes[${i}].width`); const maxSlope = route.maxSlope == null ? null : finite(route.maxSlope, `routes[${i}].maxSlope`); const minWidth = route.minWidth == null ? null : positive(route.minWidth, `routes[${i}].minWidth`); return { id: route.id || `route-${i + 1}`, slope, width, status: maxSlope == null && minWidth == null ? 'unassessed' : (maxSlope == null || slope <= maxSlope) && (minWidth == null || width >= minWidth) ? 'pass' : 'fail', limits: { maxSlope, minWidth }, source: route.source || null }; }); return { action: 'validate_accessibility', ...scope, checks, note: '规范阈值由项目输入，未推断地区无障碍规范。' }; }); }
  async validateStructure(args) { return this.withState(args, async (_state, scope) => { const spans = Array.isArray(args.spans) ? args.spans : []; const maxSpan = args.maxSpan == null ? null : positive(args.maxSpan, 'maxSpan'); const minColumnSpacing = args.minColumnSpacing == null ? null : positive(args.minColumnSpacing, 'minColumnSpacing'); const checks = spans.map((span, i) => { const length = positive(span.length, `spans[${i}].length`); const columns = Math.max(0, Math.floor(finite(span.columnCount ?? 2, `spans[${i}].columnCount`))); const spanPass = maxSpan == null || length <= maxSpan; const spacing = columns > 1 ? length / (columns - 1) : null; const spacingPass = minColumnSpacing == null || (spacing != null && spacing >= minColumnSpacing); return { id: span.id || `span-${i + 1}`, length: round(length), columnCount: columns, columnSpacing: spacing == null ? null : round(spacing), status: spanPass && spacingPass ? 'pass' : 'fail', limits: { maxSpan, minColumnSpacing }, source: span.source || null }; }); return { action: 'validate_structure', ...scope, status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail', checks, method: 'span-and-column-grid-screening', note: '这是方案阶段的跨度与柱网筛查，不是结构计算、抗震验算或施工图审查。' }; }); }
  async estimateMepLoads(args) { return this.withState(args, async (_state, scope) => { const rooms = Array.isArray(args.rooms) ? args.rooms : []; if (!rooms.length) throw new Error('estimate_mep_loads 需要 rooms'); const totals = { area: 0, occupants: 0, electricalW: 0, coolingW: 0, waterLPerDay: 0 }; const normalized = rooms.map((room, i) => { const area = positive(room.area, `rooms[${i}].area`); const occupants = Math.max(0, finite(room.occupants ?? 0, `rooms[${i}].occupants`)); const lighting = Math.max(0, finite(room.lightingWPerM2 ?? args.lightingWPerM2 ?? 8, `rooms[${i}].lightingWPerM2`)); const plug = Math.max(0, finite(room.plugWPerM2 ?? args.plugWPerM2 ?? 12, `rooms[${i}].plugWPerM2`)); const cooling = Math.max(0, finite(room.coolingWPerM2 ?? args.coolingWPerM2 ?? 80, `rooms[${i}].coolingWPerM2`)); const water = Math.max(0, finite(room.waterLPerPerson ?? args.waterLPerPerson ?? 50, `rooms[${i}].waterLPerPerson`)); const electricalW = round(area * (lighting + plug)); const coolingW = round(area * cooling); const waterLPerDay = round(occupants * water); totals.area += area; totals.occupants += occupants; totals.electricalW += electricalW; totals.coolingW += coolingW; totals.waterLPerDay += waterLPerDay; return { id: room.id || `room-${i + 1}`, area: round(area), occupants: round(occupants), electricalW, coolingW, waterLPerDay }; }); return { action: 'estimate_mep_loads', ...scope, rooms: normalized, totals: { area: round(totals.area), occupants: round(totals.occupants), electricalW: round(totals.electricalW), coolingW: round(totals.coolingW), waterLPerDay: round(totals.waterLPerDay) }, units: { electrical: 'W', cooling: 'W', water: 'L/day' }, note: '这是方案阶段的机电容量估算；不替代暖通、给排水、电气专业设计和设备选型。' }; }); }
  async createBimElement(args) { return this.withState(args, async (state, scope) => { const id = identifier(args.element?.id || `bim-${randomUUID()}`, 'element.id'); const element = { ...args.element, id, type: identifier(args.element?.type || 'generic', 'element.type'), geometry: normalizeGeometry(args.element?.geometry, 'element.geometry'), properties: args.element?.properties && typeof args.element.properties === 'object' ? args.element.properties : {}, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; const existing = state.bim.find((item) => item.id === id); if (existing) throw new Error(`BIM 构件已存在：${id}`); state.bim.push(element); return { action: 'create_bim_element', ...scope, element }; }); }
  async updateBimElement(args) { return this.withState(args, async (state, scope) => { const id = identifier(args.id, 'id'); const index = state.bim.findIndex((item) => item.id === id); if (index < 0) throw new Error(`BIM 构件不存在：${id}`); const current = state.bim[index]; if (args.expectedRevision != null && current.revision !== args.expectedRevision) throw new Error('BIM 构件版本冲突，请重新读取后再更新'); const next = { ...current, ...(args.patch || {}) }; if (args.patch?.geometry) next.geometry = normalizeGeometry(args.patch.geometry, 'patch.geometry'); next.revision = current.revision + 1; next.updatedAt = new Date().toISOString(); state.bim[index] = next; return { action: 'update_bim_element', ...scope, element: next, previousRevision: current.revision }; }); }
  async syncBimProperties(args) { return this.withState(args, async (state, scope) => { const updates = Array.isArray(args.elements) ? args.elements : []; const results = updates.map((item) => { const current = state.bim.find((element) => element.id === item.id); if (!current) return { id: item.id, status: 'missing' }; current.properties = { ...current.properties, ...(item.properties || {}) }; current.revision += 1; current.updatedAt = new Date().toISOString(); return { id: item.id, revision: current.revision, status: 'updated' }; }); return { action: 'sync_bim_properties', ...scope, results }; }); }
  async extractQuantities(args) { return this.withState(args, async (state, scope) => { const source = Array.isArray(args.elements) ? args.elements : state.bim; if (source.length > MAX_ITEMS) throw new Error('构件数量超过限制'); const quantities = source.map((element, i) => { const geometry = normalizeGeometry(element.geometry, `elements[${i}].geometry`); const q = element.quantity || {}; let quantity; let unit; if (element.type === 'wall' || q.kind === 'wall') { const height = positive(q.height ?? element.properties?.height ?? 3, 'wall.height'); const thickness = positive(q.thickness ?? element.properties?.thickness ?? 0.2, 'wall.thickness'); const openings = (Array.isArray(q.openings) ? q.openings : []).reduce((sum, opening) => sum + positive(opening.width, 'opening.width') * positive(opening.height, 'opening.height') * Math.max(1, Math.floor(opening.count ?? 1)), 0); const gross = geometry.perimeter * height; if (openings > gross) throw new Error(`构件 ${element.id} 的洞口面积超过墙面面积`); quantity = round((gross - openings) * thickness); unit = 'm³'; } else if (element.type === 'slab' || q.kind === 'slab') { const thickness = positive(q.thickness ?? element.properties?.thickness ?? 0.12, 'slab.thickness'); quantity = round(geometry.area * thickness); unit = 'm³'; } else if (element.type === 'building-mass') { const height = positive(element.properties?.height ?? q.height ?? 3, 'building-mass.height'); quantity = round(geometry.area * height); unit = 'm³'; } else if (element.type === 'room') { quantity = round(geometry.area); unit = 'm²'; } else if (element.type === 'column' || geometry.type === 'column' || geometry.type === 'box') { quantity = round(geometry.width * geometry.depth * geometry.height); unit = 'm³'; } else { quantity = positive(q.quantity ?? element.properties?.quantity ?? 1, 'quantity'); unit = q.unit || element.properties?.unit || 'ea'; } const materialCode = identifier(q.materialCode || element.properties?.materialCode || element.type || 'unspecified', 'materialCode'); const wasteRate = Math.min(0.5, Math.max(0, finite(q.wasteRate ?? 0, 'wasteRate'))); return { id: `${element.id || `element-${i + 1}`}:${materialCode}`, elementId: element.id || null, materialCode, quantity: round(quantity * (1 + wasteRate)), baseQuantity: quantity, wasteRate, unit, sourceRevision: element.revision || null, properties: element.properties || {} }; }); state.quantities = quantities; return { action: 'extract_quantities', ...scope, quantities, totals: quantities.reduce((map, item) => { const key = `${item.materialCode}:${item.unit}`; map[key] = round((map[key] || 0) + item.quantity); return map; }, {}) }; }); }
  async createDesignRevision(args) { return this.withState(args, async (state, scope) => { const id = identifier(args.id || `revision-${Date.now()}`, 'id'); if (state.revisions.some((item) => item.id === id)) throw new Error(`设计版本已存在：${id}`); const revision = { id, label: String(args.label || id).slice(0, 200), parentId: args.parentId || null, status: 'draft', bimDigest: stableDigest(state.bim), quantityDigest: stableDigest(state.quantities), createdAt: new Date().toISOString(), note: String(args.note || '').slice(0, 2_000) }; state.revisions.push(revision); return { action: 'create_design_revision', ...scope, revision }; }); }
  async compareDesignRevisions(args) { return this.withState(args, async (state, scope) => { const a = state.revisions.find((item) => item.id === args.fromRevisionId); const b = state.revisions.find((item) => item.id === args.toRevisionId); if (!a || !b) throw new Error('设计版本不存在'); return { action: 'compare_design_revisions', ...scope, from: a, to: b, changed: { bim: a.bimDigest !== b.bimDigest, quantities: a.quantityDigest !== b.quantityDigest }, note: '版本差异基于持久化摘要；需要逐构件 diff 时应从模型重新读取。' }; }); }
  async generateBuildingMass(args) { return this.withState(args, async (state, scope) => { const buildings = Array.isArray(args.buildings) ? args.buildings : []; if (!buildings.length || buildings.length > 1000) throw new Error('buildings 必须是 1 到 1000 项'); const defaultFloorHeight = positive(args.floorHeight ?? 3, 'floorHeight'); const elements = []; const blenderMeshes = []; for (let i = 0; i < buildings.length; i += 1) { const building = buildings[i]; const id = identifier(building.id || `building-${i + 1}`, `buildings[${i}].id`); if (state.bim.some((element) => element.id === id)) throw new Error(`BIM 构件已存在：${id}`); const footprint = normalizeGeometry(building.footprint || building.geometry, `buildings[${i}].footprint`); const floors = Math.max(1, Math.floor(finite(building.floors ?? 1, `buildings[${i}].floors`))); const floorHeight = positive(building.floorHeight ?? defaultFloorHeight, `buildings[${i}].floorHeight`); const height = round(floors * floorHeight); const element = { id, type: 'building-mass', geometry: footprint, properties: { name: String(building.name || id).slice(0, 200), floors, floorHeight, height, grossFloorArea: round(footprint.area * floors) }, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; state.bim.push(element); elements.push(element); const n = footprint.polygon.length; const bottom = footprint.polygon.map(([x, y]) => [x, y, 0]); const top = footprint.polygon.map(([x, y]) => [x, y, height]); const vertices = [...bottom, ...top]; blenderMeshes.push({ id, name: element.properties.name, vertices, faces: [[...Array.from({ length: n }, (_, j) => j)].reverse(), Array.from({ length: n }, (_, j) => n + j), ...Array.from({ length: n }, (_, j) => [j, (j + 1) % n, n + (j + 1) % n, n + j])] }); } return { action: 'generate_building_mass', ...scope, elementIds: elements.map((element) => element.id), elements, blenderMeshes, nextAction: 'blender.create_mesh', note: '输出建筑体量级挤出模型；门窗、结构、机电和立面构造仍需专业软件深化。' }; }); }
  async generateSectionElevation(args) { return this.withState(args, async (state, scope) => { const source = Array.isArray(args.buildings) && args.buildings.length ? args.buildings : state.bim.filter((element) => element.type === 'building-mass'); if (!source.length) throw new Error('generate_section_elevation 需要 buildings 或已生成的建筑体量'); const defaultFloorHeight = positive(args.floorHeight ?? 3, 'floorHeight'); const views = source.map((item, i) => { const geometry = normalizeGeometry(item.footprint || item.geometry, `buildings[${i}].footprint`); const floors = Math.max(1, Math.floor(finite(item.floors ?? item.properties?.floors ?? 1, `buildings[${i}].floors`))); const floorHeight = positive(item.floorHeight ?? item.properties?.floorHeight ?? defaultFloorHeight, `buildings[${i}].floorHeight`); const height = positive(item.height ?? item.properties?.height ?? floors * floorHeight, `buildings[${i}].height`); const xs = geometry.polygon.map(([x]) => x); const ys = geometry.polygon.map(([, y]) => y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys); const id = identifier(item.id || `building-${i + 1}`, `buildings[${i}].id`); const line = (a, b, role) => ({ a: a.map((value) => round(value)), b: b.map((value) => round(value)), role }); return { id, name: String(item.name || item.properties?.name || id).slice(0, 200), height: round(height), elevation: { projection: 'x-z', lines: [line([minX, 0], [maxX, 0], 'ground'), line([minX, height], [maxX, height], 'roof'), line([minX, 0], [minX, height], 'edge'), line([maxX, 0], [maxX, height], 'edge')] }, section: { projection: 'y-z', lines: [line([minY, 0], [maxY, 0], 'ground'), line([minY, height], [maxY, height], 'roof'), line([minY, 0], [minY, height], 'edge'), line([maxY, 0], [maxY, height], 'edge')] }, levels: Array.from({ length: floors + 1 }, (_, level) => ({ level, elevation: round(level * floorHeight) })) }; }); return { action: 'generate_section_elevation', ...scope, views, format: 'structured-linework', nextActions: ['autocad.create_drawing', 'sketchup.create_room_geometry'], note: '输出方案阶段剖面/立面线稿数据；门窗、幕墙、节点、标注和正式图框需专业绘图软件深化。' }; }); }
  async generateConstructionSchedule(args) {
    return this.withState(args, async (state, scope) => {
      const input = Array.isArray(args.tasks) ? args.tasks : [];
      if (!input.length || input.length > 5000) throw new Error('tasks 必须是 1 到 5000 项');
      const tasks = input.map((task, index) => {
        const id = identifier(task.id || `task-${index + 1}`, `tasks[${index}].id`);
        if (!task.name || typeof task.name !== 'string') throw new Error(`tasks[${index}].name 不能为空`);
        const durationDays = Math.max(0, Math.floor(finite(task.durationDays ?? 1, `tasks[${index}].durationDays`)));
        const predecessors = Array.isArray(task.predecessors) ? task.predecessors.map((value) => identifier(value, `tasks[${index}].predecessors`)) : [];
        return { id, name: task.name.trim().slice(0, 200), discipline: String(task.discipline || 'construction').slice(0, 80), durationDays, predecessors, resource: String(task.resource || '').slice(0, 120) };
      });
      const taskIds = new Set(tasks.map((task) => task.id));
      for (const task of tasks) for (const predecessor of task.predecessors) if (!taskIds.has(predecessor)) throw new Error(`施工任务前置不存在：${predecessor}`);
      const start = args.startDate ? new Date(args.startDate) : new Date();
      if (!Number.isFinite(start.getTime())) throw new Error('startDate 无效');
      const byId = new Map(tasks.map((task) => [task.id, task])); const resolved = new Map(); const visiting = new Set();
      const resolve = (task) => {
        if (resolved.has(task.id)) return resolved.get(task.id);
        if (visiting.has(task.id)) throw new Error(`施工任务依赖存在循环：${task.id}`);
        visiting.add(task.id);
        const predecessorEnds = task.predecessors.map((id) => resolve(byId.get(id)).endMs);
        const startMs = predecessorEnds.length ? Math.max(start.getTime(), ...predecessorEnds) : start.getTime();
        const endMs = startMs + task.durationDays * 86_400_000;
        const item = { ...task, startDate: new Date(startMs).toISOString(), endDate: new Date(endMs).toISOString(), status: 'planned', progress: 0, endMs };
        visiting.delete(task.id); resolved.set(task.id, item); return item;
      };
      const schedule = tasks.map((task) => { const item = resolve(task); const { endMs, ...publicItem } = item; return publicItem; });
      const scheduleId = identifier(args.id || `schedule-${Date.now()}`, 'id'); const result = { id: scheduleId, name: String(args.name || '施工计划').slice(0, 200), startDate: new Date(Math.min(...schedule.map((task) => Date.parse(task.startDate)))).toISOString(), endDate: new Date(Math.max(...schedule.map((task) => Date.parse(task.endDate)))).toISOString(), tasks: schedule, createdAt: new Date().toISOString() };
      state.schedules.push(result);
      return { action: 'generate_construction_schedule', ...scope, schedule: result, durationDays: Math.max(0, Math.ceil((Date.parse(result.endDate) - Date.parse(result.startDate)) / 86_400_000)), note: '按任务依赖计算计划日期；实际资源冲突、天气、审批和现场进度需持续回填。' };
    });
  }
  async recordConstructionProgress(args) {
    return this.withState(args, async (state, scope) => {
      const schedule = state.schedules.find((item) => item.id === args.scheduleId);
      if (!schedule) throw new Error('施工计划不存在');
      const task = schedule.tasks.find((item) => item.id === args.taskId);
      if (!task) throw new Error('施工任务不存在');
      const progress = Math.max(0, Math.min(100, finite(args.progress, 'progress')));
      const predecessorIds = Array.isArray(task.predecessors) ? task.predecessors : [];
      const predecessors = schedule.tasks.filter((item) => predecessorIds.includes(item.id));
      if (progress > 0 && predecessors.some((item) => Number(item.progress || 0) < 100)) throw new Error('前置施工任务尚未完成，不能推进当前任务');
      const status = args.status === 'blocked' ? 'blocked' : progress >= 100 ? 'done' : progress > 0 ? 'in-progress' : 'planned';
      task.progress = round(progress, 2); task.status = status;
      if (args.actualStart) { const actualStart = new Date(args.actualStart); if (!Number.isFinite(actualStart.getTime())) throw new Error('actualStart 无效'); task.actualStart = actualStart.toISOString(); }
      if (args.actualEnd) { const actualEnd = new Date(args.actualEnd); if (!Number.isFinite(actualEnd.getTime())) throw new Error('actualEnd 无效'); task.actualEnd = actualEnd.toISOString(); }
      task.note = String(args.note || '').slice(0, 500); task.updatedAt = new Date().toISOString();
      schedule.progress = round(schedule.tasks.reduce((sum, item) => sum + Number(item.progress || 0), 0) / schedule.tasks.length, 2);
      schedule.status = schedule.tasks.every((item) => item.status === 'done') ? 'done' : schedule.tasks.some((item) => item.status === 'blocked') ? 'blocked' : schedule.progress > 0 ? 'in-progress' : 'planned';
      return { action: 'record_construction_progress', ...scope, scheduleId: schedule.id, task, scheduleProgress: schedule.progress, scheduleStatus: schedule.status };
    });
  }
  async recordSiteInspection(args) {
    return this.withState(args, async (state, scope) => {
      const checks = Array.isArray(args.checks) ? args.checks : [];
      if (!checks.length || checks.length > 500) throw new Error('checks 必须是 1 到 500 项');
      const normalized = checks.map((check, index) => {
        if (!check || typeof check !== 'object') throw new Error(`checks[${index}] 无效`);
        const status = check.status === 'pass' || check.status === 'fail' || check.status === 'na' ? check.status : null;
        if (!status) throw new Error(`checks[${index}].status 必须是 pass、fail 或 na`);
        return { code: identifier(check.code || `check-${index + 1}`, `checks[${index}].code`), label: String(check.label || check.code || `检查项 ${index + 1}`).slice(0, 200), status, detail: String(check.detail || '').slice(0, 500), evidence: typeof check.evidence === 'string' ? check.evidence.slice(0, 1_000) : null };
      });
      const inspection = { id: identifier(args.id || `inspection-${Date.now()}`, 'id'), category: String(args.category || 'quality').slice(0, 80), taskId: args.taskId || null, elementIds: Array.isArray(args.elementIds) ? args.elementIds.slice(0, 500).map((id) => identifier(id, 'elementId')) : [], inspector: String(args.inspector || scope.accountId).slice(0, 128), checks: normalized, status: normalized.some((check) => check.status === 'fail') ? 'fail' : 'pass', note: String(args.note || '').slice(0, 1_000), inspectedAt: args.inspectedAt || new Date().toISOString() };
      state.inspections.push(inspection);
      return { action: 'record_site_inspection', ...scope, inspection, failedChecks: normalized.filter((check) => check.status === 'fail').map((check) => check.code), nextAction: inspection.status === 'fail' ? 'create_rectification_order' : 'continue_construction' };
    });
  }
  async createRectificationOrder(args) {
    return this.withState(args, async (state, scope) => {
      const inspection = args.inspectionId ? state.inspections.find((item) => item.id === args.inspectionId) : null;
      const inputIssues = Array.isArray(args.issues) ? args.issues : inspection?.checks?.filter((check) => check.status === 'fail');
      if (!inputIssues?.length) throw new Error('create_rectification_order 需要 inspectionId 或 issues');
      const issues = inputIssues.map((issue, index) => ({ code: identifier(issue.code || `issue-${index + 1}`, `issues[${index}].code`), description: String(issue.description || issue.detail || issue.label || issue.code || `整改项 ${index + 1}`).slice(0, 500), status: 'open' }));
      const order = { id: identifier(args.id || `rectification-${Date.now()}`, 'id'), inspectionId: inspection?.id || null, taskId: args.taskId || null, title: String(args.title || '现场整改单').slice(0, 200), assignee: String(args.assignee || '').slice(0, 128), dueDate: args.dueDate || null, issues, status: 'open', createdAt: new Date().toISOString() };
      state.rectificationOrders.push(order);
      return { action: 'create_rectification_order', ...scope, order, nextAction: 'close_rectification_order' };
    });
  }
  async closeRectificationOrder(args) {
    return this.withState(args, async (state, scope) => {
      const order = state.rectificationOrders.find((item) => item.id === args.orderId);
      if (!order) throw new Error('整改单不存在');
      if (order.status === 'closed') throw new Error('整改单已经关闭');
      const result = args.result === 'reopen' ? 'reopen' : args.result === 'pass' ? 'pass' : null;
      if (!result) throw new Error('result 必须是 pass 或 reopen');
      order.status = result === 'pass' ? 'closed' : 'open'; order.closedBy = String(args.closedBy || scope.accountId).slice(0, 128); order.closedAt = result === 'pass' ? new Date().toISOString() : null; order.resolution = String(args.resolution || '').slice(0, 1_000);
      for (const issue of order.issues) issue.status = result === 'pass' ? 'closed' : 'open';
      return { action: 'close_rectification_order', ...scope, order, nextAction: result === 'pass' ? 'continue_construction' : 'record_site_inspection' };
    });
  }
  async materializeFloorPlanModel(args) { return this.withState(args, async (state, scope) => { const rooms = Array.isArray(args.rooms) ? args.rooms : []; if (!rooms.length || rooms.length > 10000) throw new Error('rooms 必须是 1 到 10000 项'); const height = positive(args.height ?? 3, 'height'); const elements = []; const blenderMeshes = []; for (let i = 0; i < rooms.length; i += 1) { const room = rooms[i]; const id = identifier(room.id || `room-${i + 1}`, `rooms[${i}].id`); if (state.bim.some((element) => element.id === id)) throw new Error(`BIM 构件已存在：${id}`); const geometry = normalizeGeometry({ type: 'polygon', unit: room.unit || 'm', polygon: room.polygon }, `rooms[${i}].polygon`); const element = { id, type: 'room', geometry, properties: { name: String(room.name || id).slice(0, 200), height, materialCode: room.materialCode || 'room-finish' }, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; state.bim.push(element); elements.push(element); const n = geometry.polygon.length; const bottom = geometry.polygon.map(([x, y]) => [x, y, 0]); const top = geometry.polygon.map(([x, y]) => [x, y, height]); const vertices = [...bottom, ...top]; blenderMeshes.push({ id, name: element.properties.name, vertices, faces: [[...Array.from({ length: n }, (_, j) => j)].reverse(), Array.from({ length: n }, (_, j) => n + j), ...Array.from({ length: n }, (_, j) => [j, (j + 1) % n, n + (j + 1) % n, n + j])] }); } return { action: 'materialize_floor_plan_model', ...scope, elementIds: elements.map((element) => element.id), elements, blenderMeshes, height, nextAction: 'blender.create_floor_plan_meshes' }; }); }
  async exportObj(args) { return this.withState(args, async (state, scope) => { if (!state.bim.length) throw new Error('没有可导出的 BIM 构件'); const lines = ['# Tanva project model export', `# projectId=${scope.projectId}`]; let vertexOffset = 1; for (const element of state.bim) { const geometry = element.geometry; lines.push(`g ${String(element.id).replace(/[^a-zA-Z0-9_.:-]/g, '_')}`); let vertices = []; if (geometry.type === 'polygon' || geometry.type === 'floor') { const height = Number(element.properties?.height || 0.01); vertices = geometry.polygon.flatMap(([x, y]) => [[x, y, 0], [x, y, height]]); } else if (geometry.type === 'box' || geometry.type === 'column') { const { width, depth, height } = geometry; vertices = [[0, 0, 0], [width, 0, 0], [width, depth, 0], [0, depth, 0], [0, 0, height], [width, 0, height], [width, depth, height], [0, depth, height]]; } else continue; for (const vertex of vertices) lines.push(`v ${vertex.map((value) => round(value)).join(' ')}`); if (geometry.type === 'polygon' || geometry.type === 'floor') { const n = geometry.polygon.length; lines.push(`f ${Array.from({ length: n }, (_, i) => vertexOffset + i * 2).join(' ')}`, `f ${Array.from({ length: n }, (_, i) => vertexOffset + i * 2 + 1).reverse().join(' ')}`); } else lines.push(`f ${vertexOffset} ${vertexOffset + 1} ${vertexOffset + 2} ${vertexOffset + 3}`, `f ${vertexOffset + 4} ${vertexOffset + 7} ${vertexOffset + 6} ${vertexOffset + 5}`); vertexOffset += vertices.length; } const path = this.artifactPath(scope, 'obj'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 }); const artifact = { id: `artifact-${randomUUID()}`, kind: 'obj', format: 'obj', path, elementCount: state.bim.length, createdAt: new Date().toISOString() }; state.artifacts.push(artifact); return { action: 'export_obj', ...scope, artifact, format: 'obj', uploadRequired: true, note: 'OBJ 已生成到项目受控目录；进入设计 JSON 或画布前仍需上传为远程资产引用。' }; }); }
  async exportDxf(args) { return this.withState(args, async (state, scope) => { if (!state.bim.length) throw new Error('没有可导出的 BIM 构件'); const lines = ['0', 'SECTION', '2', 'ENTITIES']; let entityCount = 0; for (const element of state.bim) { const geometry = element.geometry; let polygon = geometry.type === 'polygon' || geometry.type === 'floor' ? geometry.polygon : geometry.type === 'box' || geometry.type === 'column' ? [[0, 0], [geometry.width, 0], [geometry.width, geometry.depth], [0, geometry.depth]] : null; if (!polygon) continue; lines.push('0', 'LWPOLYLINE', '8', String(element.type || 'ARCHITECTURE').slice(0, 30), '90', String(polygon.length), '70', '1'); for (const [x, y] of polygon) lines.push('10', String(round(x)), '20', String(round(y))); entityCount += 1; } lines.push('0', 'ENDSEC', '0', 'EOF'); const path = this.artifactPath(scope, 'dxf'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 }); const artifact = { id: `artifact-${randomUUID()}`, kind: 'dxf', format: 'dxf', path, entityCount, elementCount: state.bim.length, createdAt: new Date().toISOString() }; state.artifacts.push(artifact); return { action: 'export_dxf', ...scope, artifact, format: 'dxf', uploadRequired: true, note: 'DXF 平面几何已生成，可由 AutoCAD/Rhino/SketchUp 继续编辑；三维实体和图框需专业软件补充。' }; }); }
  async exportIfc(args) { return this.withState(args, async (state, scope) => { if (!state.bim.length) throw new Error('没有可导出的 BIM 构件'); const safe = (value) => String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120); const guid = (value) => createHash('sha1').update(`${scope.projectId}:${value}`).digest('base64').replace(/[+/=]/g, '').slice(0, 22).padEnd(22, '0'); const lines = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Tanva structured BIM export'),'2;1');", "FILE_NAME('tanva.ifc','2026-01-01T00:00:00',('Tanva'),('Tanva'),'Tanva','Tanva','');", "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', `#1=IFCPROJECT('${guid('project')}',$,'${safe(scope.projectId)}',$,$,$,$,(#2),$);`, `#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-05,#3,$);`, `#3=IFCAXIS2PLACEMENT3D($,$,$);`, `#4=IFCSITE('${guid('site')}',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);`]; let id = 10; for (const element of state.bim) { lines.push(`#${id}=IFCBUILDINGELEMENTPROXY('${guid(element.id)}',$,'${safe(element.id)}','${safe(element.type)}',$,$,$,$);`); id += 1; } lines.push('ENDSEC;', 'END-ISO-10303-21;'); const path = this.artifactPath(scope, 'ifc'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 }); const artifact = { id: `artifact-${randomUUID()}`, kind: 'ifc', format: 'ifc', path, elementCount: state.bim.length, createdAt: new Date().toISOString() }; state.artifacts.push(artifact); return { action: 'export_ifc', ...scope, artifact, format: 'ifc', uploadRequired: true, note: 'IFC 结构化交付文件已生成；复杂实体几何和属性映射仍需专业 BIM 软件复核。' }; }); }
  async generateDrawingSet(args) { return this.withState(args, async (state, scope) => { const sheets = Array.isArray(args.sheets) ? args.sheets : []; if (!sheets.length) throw new Error('generate_drawing_set 需要 sheets'); const normalized = sheets.map((sheet, i) => ({ id: identifier(sheet.id || `sheet-${i + 1}`, `sheets[${i}].id`), number: String(sheet.number || `${i + 1}`).slice(0, 40), title: String(sheet.title || '未命名图纸').slice(0, 200), discipline: String(sheet.discipline || 'architecture').slice(0, 80), scale: String(sheet.scale || '').slice(0, 40), revisionId: sheet.revisionId || null, status: 'draft' })); const set = { id: identifier(args.id || `drawing-set-${Date.now()}`, 'id'), name: String(args.name || '图纸集').slice(0, 200), revisionId: args.revisionId || null, sheets: normalized, createdAt: new Date().toISOString() }; state.drawingSets.push(set); return { action: 'generate_drawing_set', ...scope, drawingSet: set, delivery: 'structured-sheet-manifest', note: '输出图纸目录与结构化字段；PDF/DWG 排版和盖章需由对应专业软件完成。' }; }); }
  async runDrawingReview(args) { return this.withState(args, async (state, scope) => { const set = state.drawingSets.find((item) => item.id === args.drawingSetId); const sheets = set?.sheets || args.sheets; if (!Array.isArray(sheets) || !sheets.length) throw new Error('run_drawing_review 需要 drawingSetId 或 sheets'); const issues = []; for (const sheet of sheets) { if (!sheet.number) issues.push({ sheetId: sheet.id, severity: 'error', code: 'missing_number', message: '图纸缺少编号' }); if (!sheet.title) issues.push({ sheetId: sheet.id, severity: 'error', code: 'missing_title', message: '图纸缺少标题' }); if (!sheet.revisionId && !(set?.revisionId || args.revisionId)) issues.push({ sheetId: sheet.id, severity: 'warning', code: 'missing_revision', message: '图纸未绑定设计版本' }); } const review = { id: `review-${Date.now()}`, drawingSetId: set?.id || null, status: issues.some((issue) => issue.severity === 'error') ? 'fail' : issues.length ? 'needs-review' : 'pass', issues, checkedAt: new Date().toISOString() }; state.reviews.push(review); return { action: 'run_drawing_review', ...scope, review, checks: ['编号', '标题', '版本绑定'] }; }); }
  async exportHandoverPackage(args) { return this.withState(args, async (state, scope) => { const revision = args.revisionId ? state.revisions.find((item) => item.id === args.revisionId) : state.revisions.at(-1); if (!revision) throw new Error('没有可交付的设计版本'); const drawingSet = args.drawingSetId ? state.drawingSets.find((item) => item.id === args.drawingSetId) : state.drawingSets.at(-1) || null; const pkg = { id: `handover-${Date.now()}`, revisionId: revision.id, drawingSetId: drawingSet?.id || null, manifest: { bimElements: state.bim.length, quantityLines: state.quantities.length, bomLines: state.bom.length, purchaseOrders: state.purchaseOrders.length, reviews: state.reviews.filter((item) => item.drawingSetId === drawingSet?.id).map((item) => ({ id: item.id, status: item.status })) }, createdAt: new Date().toISOString(), delivery: 'structured-manifest' }; state.handoverPackages.push(pkg); return { action: 'export_handover_package', ...scope, package: pkg, note: '交付包索引已生成；实际 PDF/DWG/IFC 文件仍需由已连接专业软件导出并上传项目资产。' }; }); }
}

export { ensureProject, identifier, positive, finite, round, stableDigest };
