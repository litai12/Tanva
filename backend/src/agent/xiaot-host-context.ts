type UnknownRecord = Record<string, unknown>;

const MAX_QUERY_NODES = 12;
const MAX_QUERY_EDGES = 24;
const MAX_STRING_LENGTH = 1200;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined;
  if (typeof value === 'string') {
    if (/^(data:|blob:)/i.test(value) || value.length > MAX_STRING_LENGTH) {
      return `[内容已省略，原长度 ${value.length}]`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => safeValue(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 30)
      .map(([key, item]) => [key, safeValue(item, depth + 1)])
      .filter(([, item]) => item !== undefined),
  );
}

function getCanvasParts(canvasContext: unknown): {
  nodes: UnknownRecord[];
  edges: UnknownRecord[];
} {
  const context = asRecord(canvasContext);
  return {
    nodes: Array.isArray(context?.nodes)
      ? context.nodes.map(asRecord).filter((item): item is UnknownRecord => !!item)
      : [],
    edges: Array.isArray(context?.edges)
      ? context.edges.map(asRecord).filter((item): item is UnknownRecord => !!item)
      : [],
  };
}

function nodeId(node: UnknownRecord): string {
  return typeof node.id === 'string' ? node.id : '';
}

function nodeType(node: UnknownRecord): string {
  return typeof node.type === 'string' && node.type ? node.type : 'unknown';
}

function projectNode(node: UnknownRecord): UnknownRecord {
  return {
    id: nodeId(node),
    type: nodeType(node),
    ...(node.position ? { position: safeValue(node.position) } : {}),
    ...(node.data ? { data: safeValue(node.data) } : {}),
  };
}

function projectEdge(edge: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    ['id', 'source', 'target', 'sourceHandle', 'targetHandle', 'type']
      .filter((key) => typeof edge[key] === 'string')
      .map((key) => [key, edge[key]]),
  );
}

export function buildCanvasContextSummary(
  canvasContext: unknown,
  prompt = '',
): UnknownRecord {
  const { nodes, edges } = getCanvasParts(canvasContext);
  const suppliedSummary = asRecord(asRecord(canvasContext)?.summary);
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(nodeType(node), (counts.get(nodeType(node)) || 0) + 1);
  const selectedNodes = nodes.filter((node) => node.selected === true).slice(0, 6);
  const normalizedPrompt = prompt.toLowerCase();
  const inferredTypeHints = [
    ...(/提示词|prompt/.test(normalizedPrompt) ? ['prompt', 'text'] : []),
    ...(/图片|图像|image/.test(normalizedPrompt) ? ['image', 'generate'] : []),
    ...(/视频|video/.test(normalizedPrompt) ? ['video'] : []),
    ...(/音频|声音|audio/.test(normalizedPrompt) ? ['audio'] : []),
    ...(/ppt|演示|幻灯片|汇报|presentation|deck/.test(normalizedPrompt)
      ? ['htmlppt']
      : []),
  ];
  const relevantNodes = inferredTypeHints.length
    ? nodes
        .filter((node) => {
          const type = nodeType(node).toLowerCase();
          return inferredTypeHints.some((hint) => type.includes(hint));
        })
        .slice(0, 6)
    : [];
  const initialNodes = Array.from(
    new Map(
      [...selectedNodes, ...relevantNodes]
        .filter((node) => nodeId(node))
        .map((node) => [nodeId(node), node]),
    ).values(),
  ).slice(0, 8);
  const summary = {
    access: 'details_available_via_query_canvas',
    nodeCount:
      typeof suppliedSummary?.nodeCount === 'number'
        ? suppliedSummary.nodeCount
        : nodes.length,
    edgeCount:
      typeof suppliedSummary?.edgeCount === 'number'
        ? suppliedSummary.edgeCount
        : edges.length,
    nodeTypes: Array.isArray(suppliedSummary?.nodeTypes)
      ? safeValue(suppliedSummary.nodeTypes)
      : Array.from(counts, ([type, count]) => ({ type, count })),
    selectedNodeIds: Array.isArray(suppliedSummary?.selectedNodeIds)
      ? safeValue(suppliedSummary.selectedNodeIds)
      : selectedNodes.map(nodeId).filter(Boolean),
    includedNodeIds: initialNodes.map(nodeId),
  };
  // 上游宿主协议只接受 nodes/edges；把摘要放进一个只读虚拟节点，避免协议
  // 校验剥掉自定义 summary 字段。真正选中的节点可直接随首轮提供。
  return {
    nodes: [
      {
        id: '__tanva_canvas_summary__',
        type: 'tanvaCanvasSummary',
        data: summary,
      },
      ...initialNodes.map(projectNode),
    ],
    edges: [],
  };
}

export function queryCanvasContext(
  canvasContext: unknown,
  rawArguments: unknown,
): UnknownRecord {
  const { nodes, edges } = getCanvasParts(canvasContext);
  const args = asRecord(rawArguments) || {};
  const scope = typeof args.scope === 'string' ? args.scope : 'summary';
  const requestedIds = Array.isArray(args.nodeIds)
    ? new Set(args.nodeIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_QUERY_NODES))
    : new Set<string>();
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase().slice(0, 120) : '';

  if (scope === 'summary') return buildCanvasContextSummary(canvasContext);

  let matched: UnknownRecord[] = [];
  if (scope === 'selected') {
    matched = nodes.filter((node) => node.selected === true);
  } else if (scope === 'ids') {
    matched = nodes.filter((node) => requestedIds.has(nodeId(node)));
  } else if (scope === 'neighbors') {
    const neighborIds = new Set<string>(requestedIds);
    for (const edge of edges) {
      const source = typeof edge.source === 'string' ? edge.source : '';
      const target = typeof edge.target === 'string' ? edge.target : '';
      if (requestedIds.has(source) && target) neighborIds.add(target);
      if (requestedIds.has(target) && source) neighborIds.add(source);
    }
    matched = nodes.filter((node) => neighborIds.has(nodeId(node)));
  } else if (scope === 'search' && query) {
    matched = nodes.filter((node) =>
      JSON.stringify(safeValue(node)).toLowerCase().includes(query),
    );
  }

  matched = matched.slice(0, MAX_QUERY_NODES);
  const matchedIds = new Set(matched.map(nodeId));
  const relatedEdges = edges
    .filter((edge) => matchedIds.has(String(edge.source || '')) || matchedIds.has(String(edge.target || '')))
    .slice(0, MAX_QUERY_EDGES);
  return {
    scope,
    returnedNodeCount: matched.length,
    truncated: matched.length >= MAX_QUERY_NODES,
    nodes: matched.map(projectNode),
    edges: relatedEdges.map(projectEdge),
  };
}

export function buildCapabilityManifestSummary(manifest: unknown): UnknownRecord {
  const value = asRecord(manifest) || {};
  const hostTools = Array.isArray(value.hostTools)
    ? value.hostTools.map(asRecord).filter((item): item is UnknownRecord => !!item)
    : [];
  const specs = Array.isArray(value.nodeSpecs)
    ? value.nodeSpecs.map(asRecord).filter((item): item is UnknownRecord => !!item)
    : [];
  const desktopConnectors = Array.isArray(value.desktopTools)
    ? value.desktopTools.map(asRecord).filter((item): item is UnknownRecord => !!item)
    : [];
  return {
    protocol_version: value.protocol_version,
    host: value.host,
    patchOps: value.patchOps,
    ui: value.ui,
    // 宿主工具必须首轮可见，小T才能选择 create_presentation 等高层工具；
    // 仅保留调用所需的名称、说明和参数形状。
    hostTools: hostTools.slice(0, 12).map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: safeValue(tool.description) } : {}),
      ...(tool.parameters ? { parameters: safeValue(tool.parameters) } : {}),
    })),
    desktopConnectors: desktopConnectors.slice(0, 8).map((connector) => ({
      connectorId: connector.connectorId,
      connectorName: connector.connectorName,
      toolCount: Array.isArray(connector.tools) ? connector.tools.length : 0,
    })),
    // nodeSpecs 是宿主协议必填项。保留执行所需的结构字段，去掉长篇 purpose；
    // 这样创建节点不需要再拉完整 40KB 清单。
    nodeSpecs: specs.map((spec) => ({
      type: spec.type,
      label: spec.label,
      ...(spec.params ? { params: safeValue(spec.params) } : {}),
      ...(spec.inputs ? { inputs: safeValue(spec.inputs) } : {}),
      ...(spec.outputs ? { outputs: safeValue(spec.outputs) } : {}),
      ...(spec.constraints ? { constraints: safeValue(spec.constraints) } : {}),
    })),
    notes: [
      '默认只提供能力索引；需要节点参数、输入输出或规则时调用 query_capabilities。',
      '默认只提供画布摘要；需要节点正文、媒体 URL 或连线关系时调用 query_canvas。',
      "按需查询统一调用 host_tool；画布参数为 {name:'query_canvas',arguments:{scope,nodeIds?,query?}}，能力参数为 {name:'query_capabilities',arguments:{nodeTypes}}。",
      "桌面 MCP 工具必须先调用 {name:'query_desktop_tools',arguments:{connectorId,query?,toolNames?}} 查询真实名称、风险与参数，再调用 call_desktop_tool；每次执行仍需用户确认。",
      '禁止要求宿主返回整张画布，查询必须限定 scope、nodeIds 或 query。',
    ],
  };
}

export function queryDesktopTools(
  manifest: unknown,
  rawArguments: unknown,
): UnknownRecord {
  const value = asRecord(manifest) || {};
  const args = asRecord(rawArguments) || {};
  const connectorId = typeof args.connectorId === 'string' ? args.connectorId.trim() : '';
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  const requestedNames = new Set(
    Array.isArray(args.toolNames)
      ? args.toolNames.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [],
  );
  const connectors = Array.isArray(value.desktopTools)
    ? value.desktopTools.map(asRecord).filter((item): item is UnknownRecord => !!item)
    : [];
  const connector = connectors.find((item) => item.connectorId === connectorId);
  if (!connector) {
    return { connectorId, error: 'desktop connector not found', tools: [] };
  }
  const tools = Array.isArray(connector.tools)
    ? connector.tools.map(asRecord).filter((item): item is UnknownRecord => !!item)
    : [];
  const matched = tools.filter((tool) => {
    const name = typeof tool.name === 'string' ? tool.name : '';
    if (requestedNames.size > 0) return requestedNames.has(name);
    if (!query) return true;
    const haystack = `${name} ${typeof tool.description === 'string' ? tool.description : ''}`.toLowerCase();
    return haystack.includes(query);
  });
  return {
    connectorId,
    connectorName: connector.connectorName,
    returnedToolCount: Math.min(matched.length, 24),
    truncated: matched.length > 24,
    tools: matched.slice(0, 24).map((tool) => ({
      name: tool.name,
      description: safeValue(tool.description),
      risk: tool.risk,
      inputSchema: safeValue(tool.inputSchema),
    })),
  };
}

export function queryCapabilityManifest(
  manifest: unknown,
  rawArguments: unknown,
): UnknownRecord {
  const value = asRecord(manifest) || {};
  const args = asRecord(rawArguments) || {};
  const requestedTypes = Array.isArray(args.nodeTypes)
    ? new Set(args.nodeTypes.filter((item): item is string => typeof item === 'string').slice(0, 12))
    : new Set<string>();
  const specs = Array.isArray(value.nodeSpecs)
    ? value.nodeSpecs.map(asRecord).filter((item): item is UnknownRecord => !!item)
    : [];
  const matched = requestedTypes.size
    ? specs.filter((spec) => typeof spec.type === 'string' && requestedTypes.has(spec.type))
    : [];
  return {
    nodeSpecs: matched.slice(0, 12).map((spec) => safeValue(spec)),
    notes: Array.isArray(value.notes)
      ? value.notes.slice(0, 12).map((note) => safeValue(note))
      : [],
  };
}

export function resolveLocalGreeting(prompt: string): string | null {
  const normalized = prompt.trim().toLowerCase().replace(/[\s!！?？。,.，～~]+/g, '');
  return /^(你好|您好|嗨|哈喽|在吗|hi|hello|hey)$/.test(normalized)
    ? '你好！有什么我可以帮你处理的吗？'
    : null;
}
