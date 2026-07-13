# 小T智能体接入 Tanva 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小T升级为"能力清单驱动"的开放画布 Agent 服务（OpenAI 兼容 facade），Tanva 经自家 new-api 渠道接入，实现对话+读画布+增删改节点/连线/驱动生成。

**Architecture:** TapCanvas-pro 侧在 hono 层加 `/public/v1/chat/completions` facade（复用 `runAgentsBridgeChatTask` SSE 链路），请求内 `<capability_manifest>`/`<canvas_context>` system 段驱动提示组装，画布操作以标准 `delta.tool_calls`（`flow_patch`）随流下发，终帧 usage=结算 quota。Tanva 侧后端 agent 模块加流式 run 分支（经 new-api 渠道），前端 patch applier 翻译成 window 事件桥落画布。

**Tech Stack:** Hono 4 + zod + vitest（TapCanvas）；NestJS 10/Fastify + 原生 fetch（Tanva 后端）；React + reactflow 11（Tanva 前端）；new-api 网关（纯配置）。

**仓库与分支：**
- TapCanvas-pro：`/Users/libiqiang/workspace/TapCanvas-pro`，新建分支 `feat/canvas-host-protocol`
- Tanva：`/Users/libiqiang/business/Tanva`，当前分支 `feature/agent`
- 联调基准：本地 Docker 栈（hono `:8788`，tanva-new-api `:4458`），测试 key 为用户提供的 `tc_sk_EPYQZg...`（不落代码/文档，用 shell 变量）

**执行顺序：** Part A（TapCanvas 侧，Task 1-7）→ Part B（Tanva 侧，Task 8-14）→ Task 15 端到端联调。每个 Task 结束跑对应验证再 commit。

**调研锚点提醒：** 计划中"Modify"的行号来自 2026-07-13 调研，动手前先用给出的 grep 锚点定位，行号漂移属正常。

---

## Part A · TapCanvas-pro 侧

### Task 1: 宿主协议 schema 与 messages 解析（新文件 + 单测）

**Files:**
- Create: `apps/hono-api/src/modules/task/host-canvas-protocol.ts`
- Test: `apps/hono-api/src/modules/task/host-canvas-protocol.test.ts`

- [ ] **Step 1: 建分支**

```bash
cd /Users/libiqiang/workspace/TapCanvas-pro && git checkout -b feat/canvas-host-protocol
```

- [ ] **Step 2: 写失败的测试**

```ts
// apps/hono-api/src/modules/task/host-canvas-protocol.test.ts
import { describe, expect, it } from "vitest";
import {
	HostCapabilityManifestSchema,
	extractHostSegments,
} from "./host-canvas-protocol";

const MANIFEST = {
	protocol_version: "1",
	host: "tanva",
	patchOps: ["addNode", "updateNodeData", "connectEdge", "focusNode", "placeImage", "runNode"],
	nodeSpecs: [
		{ type: "textNote", label: "便签", purpose: "画布上的纯文本便签", params: { text: { type: "string" } } },
	],
};

describe("HostCapabilityManifestSchema", () => {
	it("接受合法 manifest", () => {
		expect(HostCapabilityManifestSchema.safeParse(MANIFEST).success).toBe(true);
	});
	it("拒绝未知 patchOp", () => {
		const bad = { ...MANIFEST, patchOps: ["dropTable"] };
		expect(HostCapabilityManifestSchema.safeParse(bad).success).toBe(false);
	});
});

describe("extractHostSegments", () => {
	it("从 messages 中抽出 manifest/context/prompt/instructions", () => {
		const messages = [
			{ role: "system", content: `<capability_manifest>${JSON.stringify(MANIFEST)}</capability_manifest>` },
			{ role: "system", content: `<canvas_context>{"nodes":[{"id":"n1","type":"textNote"}],"edges":[]}</canvas_context>` },
			{ role: "system", content: "你叫小T，说话简洁。" },
			{ role: "user", content: "帮我加一个便签" },
		];
		const seg = extractHostSegments(messages);
		expect(seg.manifest?.host).toBe("tanva");
		expect(seg.canvasContext?.nodes).toHaveLength(1);
		expect(seg.instructions).toEqual(["你叫小T，说话简洁。"]);
		expect(seg.prompt).toBe("帮我加一个便签");
	});
	it("无 manifest 时返回 manifest undefined（回落原行为）", () => {
		const seg = extractHostSegments([{ role: "user", content: "hi" }]);
		expect(seg.manifest).toBeUndefined();
		expect(seg.prompt).toBe("hi");
	});
	it("manifest JSON 非法时抛出带 code 的错误", () => {
		expect(() =>
			extractHostSegments([
				{ role: "system", content: "<capability_manifest>{oops</capability_manifest>" },
				{ role: "user", content: "hi" },
			]),
		).toThrow(/capability_manifest/);
	});
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /Users/libiqiang/workspace/TapCanvas-pro && pnpm --filter @tapcanvas/api exec vitest run src/modules/task/host-canvas-protocol.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

```ts
// apps/hono-api/src/modules/task/host-canvas-protocol.ts
// 画布宿主开放协议（v1）：三方画布平台通过 OpenAI 兼容入口接入小T时，
// 用 system 消息段声明自己的节点能力清单与画布快照。
import { z } from "zod";

export const HOST_PATCH_OPS = [
	"addNode",
	"updateNodeData",
	"connectEdge",
	"focusNode",
	"placeImage",
	"runNode",
] as const;
export type HostPatchOp = (typeof HOST_PATCH_OPS)[number];

export const HostNodeSpecSchema = z.object({
	type: z.string().min(1).max(64),
	label: z.string().max(200).optional(),
	purpose: z.string().max(2000).optional(),
	// data 字段说明：JSON Schema 子集（properties 级即可，模型照此产 data）
	params: z.record(z.any()).optional(),
	inputs: z.array(z.object({ handle: z.string(), accepts: z.string().optional() })).optional(),
	outputs: z.array(z.object({ handle: z.string(), emits: z.string().optional() })).optional(),
	constraints: z.array(z.string().max(500)).optional(),
});
export type HostNodeSpec = z.infer<typeof HostNodeSpecSchema>;

export const HostCapabilityManifestSchema = z.object({
	protocol_version: z.literal("1"),
	host: z.string().min(1).max(64),
	patchOps: z.array(z.enum(HOST_PATCH_OPS)).min(1),
	nodeSpecs: z.array(HostNodeSpecSchema).min(1).max(64),
	notes: z.array(z.string().max(1000)).max(32).optional(),
});
export type HostCapabilityManifest = z.infer<typeof HostCapabilityManifestSchema>;

export const HostCanvasContextSchema = z.object({
	nodes: z.array(z.record(z.any())).max(500).default([]),
	edges: z.array(z.record(z.any())).max(1000).default([]),
});
export type HostCanvasContext = z.infer<typeof HostCanvasContextSchema>;

const OpenAiMessageSchema = z.object({
	role: z.enum(["system", "user", "assistant", "tool"]),
	content: z.union([z.string(), z.array(z.any()), z.null()]).optional(),
});
export type OpenAiMessage = z.infer<typeof OpenAiMessageSchema>;

const MANIFEST_RE = /<capability_manifest>([\s\S]*?)<\/capability_manifest>/;
const CONTEXT_RE = /<canvas_context>([\s\S]*?)<\/canvas_context>/;

function messageText(content: OpenAiMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((p) => (p && typeof p === "object" && typeof p.text === "string" ? p.text : ""))
			.join("");
	}
	return "";
}

function parseTagged<T>(raw: string, schema: z.ZodType<T>, tag: string): T {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`invalid ${tag}: not valid JSON`);
	}
	const result = schema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`invalid ${tag}: ${result.error.issues[0]?.message || "schema mismatch"}`);
	}
	return result.data;
}

export interface HostSegments {
	manifest?: HostCapabilityManifest;
	canvasContext?: HostCanvasContext;
	/** 非协议段的 system 内容（原样保留为附加指令） */
	instructions: string[];
	/** 最后一条 user 消息文本 → prompt */
	prompt: string;
	/** 历史（除末条 user 外的 user/assistant，可供后续多轮透传，v1 暂只透传 prompt） */
	history: Array<{ role: "user" | "assistant"; content: string }>;
}

export function extractHostSegments(rawMessages: unknown): HostSegments {
	const messages = z.array(OpenAiMessageSchema).parse(rawMessages ?? []);
	let manifest: HostCapabilityManifest | undefined;
	let canvasContext: HostCanvasContext | undefined;
	const instructions: string[] = [];
	const history: Array<{ role: "user" | "assistant"; content: string }> = [];
	let prompt = "";

	for (const msg of messages) {
		const text = messageText(msg.content).trim();
		if (msg.role === "system") {
			const m = text.match(MANIFEST_RE);
			if (m) {
				manifest = parseTagged(m[1], HostCapabilityManifestSchema, "capability_manifest");
			}
			const cx = text.match(CONTEXT_RE);
			if (cx) {
				canvasContext = parseTagged(cx[1], HostCanvasContextSchema, "canvas_context");
			}
			const rest = text.replace(MANIFEST_RE, "").replace(CONTEXT_RE, "").trim();
			if (rest) instructions.push(rest);
			continue;
		}
		if (msg.role === "user" || msg.role === "assistant") {
			if (text) history.push({ role: msg.role, content: text });
		}
	}
	for (let i = history.length - 1; i >= 0; i -= 1) {
		if (history[i].role === "user") {
			prompt = history[i].content;
			history.splice(i, 1);
			break;
		}
	}
	return { manifest, canvasContext, instructions, prompt, history };
}

/** 把宿主 manifest 渲染成给 agents-cli 的完整能力提示块 */
export function renderHostManifestPrompt(
	manifest: HostCapabilityManifest,
	canvasContext?: HostCanvasContext,
): string {
	const lines: string[] = [
		"## Host Canvas Capability (authoritative)",
		`host: ${manifest.host} · protocol v${manifest.protocol_version}`,
		"你正在为一个外部画布宿主工作。画布写入只能通过 flow_patch 工具，且只能使用下列 op 与节点类型，禁止编造：",
		`允许的 op: ${manifest.patchOps.join(", ")}`,
		"节点类型清单（type / 用途 / data 字段）：",
	];
	for (const spec of manifest.nodeSpecs) {
		lines.push(
			`- ${spec.type}${spec.label ? `（${spec.label}）` : ""}: ${spec.purpose || ""}` +
				(spec.params ? ` data=${JSON.stringify(spec.params)}` : "") +
				(spec.inputs?.length ? ` inputs=${spec.inputs.map((i) => i.handle).join("/")}` : "") +
				(spec.outputs?.length ? ` outputs=${spec.outputs.map((o) => o.handle).join("/")}` : "") +
				(spec.constraints?.length ? ` 约束: ${spec.constraints.join("；")}` : ""),
		);
	}
	if (manifest.notes?.length) lines.push(`宿主备注: ${manifest.notes.join("；")}`);
	lines.push(
		"flow_patch 调用约定：每次调用只含一个操作对象 {op, ...}；addNode 需给 node:{id,type,data,position?}，id 用你生成的短随机串；connectEdge 用 {source,target,sourceHandle?,targetHandle?}；updateNodeData 用 {id,patch}；runNode 用 {id}；focusNode 用 {id}；placeImage 用 {url,name?}。",
		"操作是乐观应用（fire-and-forget），宿主不回传每步结果；引用节点时优先用 canvas_context 里的真实 id。",
	);
	if (canvasContext) {
		lines.push(
			"<canvas_context readonly>",
			JSON.stringify(canvasContext).slice(0, 20_000),
			"</canvas_context>",
		);
	}
	return lines.join("\n");
}

/** 宿主模式下给 agents-cli 的唯一画布远程工具定义 */
export function buildHostFlowPatchTool(manifest: HostCapabilityManifest) {
	return {
		name: "flow_patch",
		description:
			`向宿主(${manifest.host})画布下发一个操作。允许的 op: ${manifest.patchOps.join(", ")}。` +
			"每次调用恰好一个操作；节点类型必须来自 Host Canvas Capability 清单。",
		parameters: {
			type: "object",
			properties: {
				op: { type: "string", enum: [...manifest.patchOps] },
				node: {
					type: "object",
					description: "addNode 时必填: {id,type,data,position?{x,y}}",
				},
				id: { type: "string", description: "updateNodeData/focusNode/runNode 的目标节点 id" },
				patch: { type: "object", description: "updateNodeData 的 data 增量" },
				source: { type: "string" },
				target: { type: "string" },
				sourceHandle: { type: "string" },
				targetHandle: { type: "string" },
				url: { type: "string", description: "placeImage 的图片 URL" },
				name: { type: "string" },
			},
			required: ["op"],
		},
	};
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter @tapcanvas/api exec vitest run src/modules/task/host-canvas-protocol.test.ts
```
Expected: PASS（5 个用例）

- [ ] **Step 6: Commit**

```bash
git add apps/hono-api/src/modules/task/host-canvas-protocol.* && git commit -m "feat(host-protocol): 画布宿主协议 schema 与 messages 解析"
```

---

### Task 2: bridge 宿主模式（remoteTools/manifest/系统提示注入）

**Files:**
- Modify: `apps/hono-api/src/modules/task/task.agents-bridge.ts`（锚点见下）
- Modify: `apps/hono-api/src/modules/task/agents-tool-bridge.routes.ts`（新增 host-execute 路由）

- [ ] **Step 1: 定位锚点**

```bash
cd /Users/libiqiang/workspace/TapCanvas-pro
grep -n "buildAgentsBridgeRemoteTools({" apps/hono-api/src/modules/task/task.agents-bridge.ts | head -3
grep -n "canvasCapabilityManifest ? { canvasCapabilityManifest }" apps/hono-api/src/modules/task/task.agents-bridge.ts
grep -n "effectiveFinalSystemPrompt = \[" apps/hono-api/src/modules/task/task.agents-bridge.ts
grep -n "agents/tools/execute" apps/hono-api/src/modules/task/agents-tool-bridge.routes.ts | head -3
```
Expected: 分别命中 ~9819 / ~9964 / ~9863 / ~491 附近（行号可漂移，以 grep 为准）。

- [ ] **Step 2: task.agents-bridge.ts 加宿主模式分支**

在文件顶部 import 区（`import { buildCanvasCapabilityManifest } ...` 附近）加：

```ts
import {
	HostCapabilityManifestSchema,
	buildHostFlowPatchTool,
	renderHostManifestPrompt,
	type HostCanvasContext,
	type HostCapabilityManifest,
} from "./host-canvas-protocol";
```

在 `runAgentsBridgeChatTask` 内读取 extras（`requestedSessionKey` 读取处附近，锚点 `extras.sessionKey`）后加：

```ts
const hostManifestRaw = (extras as Record<string, unknown>).hostCapabilityManifest;
const hostManifestParsed = hostManifestRaw
	? HostCapabilityManifestSchema.safeParse(hostManifestRaw)
	: null;
const hostManifest: HostCapabilityManifest | null = hostManifestParsed?.success
	? hostManifestParsed.data
	: null;
const hostCanvasContext = (extras as Record<string, unknown>).hostCanvasContext as
	| HostCanvasContext
	| undefined;
```

在 remoteTools/manifest 组装处（锚点 `buildAgentsBridgeRemoteTools({`）改为宿主模式优先：

```ts
const remoteTools = hostManifest
	? [buildHostFlowPatchTool(hostManifest)]
	: buildAgentsBridgeRemoteTools({ /* 原参数原样保留 */ });
```

在 `canvasCapabilityManifest` 计算处（锚点 `hasCanvasIntent`），宿主模式直接带上宿主 manifest（打 hostMode 标）：

```ts
const canvasCapabilityManifest = hostManifest
	? ({ ...hostManifest, hostMode: true } as Record<string, unknown>)
	: /* 原三元表达式原样保留 */;
```

在 `effectiveFinalSystemPrompt` 数组（锚点 `canvas_overview readonly`）首部插入宿主提示块：

```ts
const effectiveFinalSystemPrompt = [
	hostManifest ? renderHostManifestPrompt(hostManifest, hostCanvasContext) : null,
	finalSystemPrompt,
	// ...其余项原样保留
```

在 `remoteToolConfig` 组装处（锚点 `/public/agents/tools/execute`），宿主模式换端点：

```ts
endpoint: hostManifest
	? `${tapcanvasApiBaseUrl}/public/agents/tools/host-execute`
	: `${tapcanvasApiBaseUrl}/public/agents/tools/execute`,
```

- [ ] **Step 3: host-execute no-op 执行路由**

在 `agents-tool-bridge.routes.ts` 的 `registerPublicAgentsToolBridgeRoutes` 内、现有 `/agents/tools/execute` 路由旁新增（鉴权中间件随 publicApiRouter 已有）：

```ts
// 宿主模式画布工具执行：不落 TapCanvas 库，只做协议校验后放行。
// 真实画布写入由宿主前端消费聊天流里的 tool 事件（facade 翻成 tool_calls）完成。
router.post("/agents/tools/host-execute", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const args = (body?.args ?? {}) as Record<string, unknown>;
	const op = typeof args.op === "string" ? args.op : "";
	if (!op) {
		return c.json({ ok: false, error: "missing op" }, 400);
	}
	return c.json({
		ok: true,
		applied: true,
		op,
		note: "dispatched to host canvas via stream (fire-and-forget)",
	});
});
```

（`router` 为该文件注册函数现有参数名，对齐现有 `/agents/tools/execute` 的写法与鉴权。）

- [ ] **Step 4: 类型检查 + 既有测试回归**

```bash
pnpm --filter @tapcanvas/api exec tsc --noEmit -p apps/hono-api/tsconfig.json 2>/dev/null || pnpm --filter @tapcanvas/api build
pnpm --filter @tapcanvas/api test
```
Expected: 编译通过；既有测试（含 task.agents-bridge.*.test.ts）全绿——无 manifest 路径行为不变。

- [ ] **Step 5: Commit**

```bash
git add apps/hono-api/src/modules/task/task.agents-bridge.ts apps/hono-api/src/modules/task/agents-tool-bridge.routes.ts
git commit -m "feat(host-protocol): bridge 宿主模式——manifest 驱动 remoteTools/提示注入 + host-execute no-op"
```

---

### Task 3: agents-cli 宿主 manifest 完整展开

**Files:**
- Modify: `apps/agents-cli/src/core/context-source-providers.ts:179-201`（`canvasCapabilityContextProvider`）

- [ ] **Step 1: 修改 provider**

现状只注入 kind 名列表。改为：`manifest.hostMode === true` 时展开完整内容：

```ts
collect(input) {
	if (!input.toolContextMeta?.canvasCapabilityManifest) return [];
	const manifest = input.toolContextMeta.canvasCapabilityManifest as Record<string, unknown>;
	if (manifest.hostMode === true) {
		// 宿主模式：manifest 即权威节点契约，完整展开（宿主清单远小于 TapCanvas 全量 spec）
		return [{
			id: "canvas_capability",
			kind: "canvas_capability",
			summary: `host canvas manifest (${String(manifest.host || "unknown")})`,
			content: [
				"## Host Canvas Capability Manifest (authoritative, full)",
				JSON.stringify(
					{
						host: manifest.host,
						protocol_version: manifest.protocol_version,
						patchOps: manifest.patchOps,
						nodeSpecs: manifest.nodeSpecs,
						notes: manifest.notes,
					},
					null,
					1,
				),
				"画布写入仅可调用 flow_patch 工具，op 与节点 type 严格限于上述清单。",
			].join("\n"),
			budgetChars: CONTEXT_BUDGETS.canvas_capability,
		}];
	}
	// ↓ 原有 TapCanvas 摘要逻辑原样保留
	return [{ /* 原实现不动 */ }];
}
```

- [ ] **Step 2: 检查 CONTEXT_BUDGETS 预算是否够**

```bash
grep -n "canvas_capability" /Users/libiqiang/workspace/TapCanvas-pro/apps/agents-cli/src/core/context-source-providers.ts | head
grep -rn "CONTEXT_BUDGETS" /Users/libiqiang/workspace/TapCanvas-pro/apps/agents-cli/src --include="*.ts" -l | head -3
```
若 `canvas_capability` 预算 < 8000 字符，调到 8000（宿主 manifest JSON 需完整进提示）。

- [ ] **Step 3: agents-cli 类型检查 + 测试**

```bash
pnpm --filter agents-cli build 2>/dev/null || (cd apps/agents-cli && pnpm build)
pnpm --filter agents-cli test 2>/dev/null || true
```
Expected: 编译通过；若该包无 test script 跳过。

- [ ] **Step 4: Commit**

```bash
git add apps/agents-cli/src/core/context-source-providers.ts
git commit -m "feat(host-protocol): agents-cli 宿主模式完整展开 manifest 进系统提示"
```

---

### Task 4: OpenAI 兼容 facade `/public/v1/chat/completions`

**Files:**
- Create: `apps/hono-api/src/modules/task/public-openai-compat.ts`
- Modify: `apps/hono-api/src/modules/apiKey/apiKey.routes.ts`（注册路由，锚点 `handlePublicAgentsChatRoute` import 与 `publicApiRouter.post("/agents/chat/interrupt"` 附近）
- Test: `apps/hono-api/src/modules/task/public-openai-compat.test.ts`

- [ ] **Step 1: 写失败的测试（纯函数部分）**

```ts
// apps/hono-api/src/modules/task/public-openai-compat.test.ts
import { describe, expect, it } from "vitest";
import { buildChunk, translateStreamEvent } from "./public-openai-compat";

describe("buildChunk", () => {
	it("产出标准 chat.completion.chunk", () => {
		const c = buildChunk("req1", "xiaot-agent", 1720000000, { content: "你" }, null);
		expect(c.object).toBe("chat.completion.chunk");
		expect(c.choices[0].delta.content).toBe("你");
		expect(c.choices[0].finish_reason).toBeNull();
	});
});

describe("translateStreamEvent", () => {
	const ids = { req: "req1", model: "xiaot-agent", created: 1720000000 };
	it("content 事件 → delta.content", () => {
		const out = translateStreamEvent(ids, { event: "content", data: { delta: "好" } }, { toolIndex: 0 });
		expect(out?.choices[0].delta.content).toBe("好");
	});
	it("flow_patch tool 完成事件 → delta.tool_calls", () => {
		const out = translateStreamEvent(
			ids,
			{
				event: "tool",
				data: {
					toolCallId: "tc1",
					toolName: "flow_patch",
					phase: "completed",
					status: "success",
					input: { op: "addNode", node: { id: "n1", type: "textNote", data: { text: "hi" } } },
				},
			},
			{ toolIndex: 0 },
		);
		const tc = out?.choices[0].delta.tool_calls?.[0];
		expect(tc?.function?.name).toBe("flow_patch");
		expect(JSON.parse(tc!.function!.arguments!).op).toBe("addNode");
	});
	it("非 flow_patch 工具与其他事件返回 null（不下发）", () => {
		expect(
			translateStreamEvent(ids, { event: "tool", data: { toolName: "read_file", phase: "completed" } }, { toolIndex: 0 }),
		).toBeNull();
		expect(translateStreamEvent(ids, { event: "agent_role", data: {} }, { toolIndex: 0 })).toBeNull();
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @tapcanvas/api exec vitest run src/modules/task/public-openai-compat.test.ts
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 facade**

```ts
// apps/hono-api/src/modules/task/public-openai-compat.ts
// OpenAI 兼容 facade：三方画布宿主经 /public/v1/chat/completions 调小T。
// 上行: messages(含 <capability_manifest>/<canvas_context> system 段)；
// 下行: 标准 chat.completion.chunk（文本 delta + flow_patch tool_calls + 终帧 usage）。
import { streamSSE } from "hono/streaming";
import { AppError } from "../../shared/errors"; // 对齐现有 import 路径（grep "AppError" 同目录文件）
import type { AppContext } from "../../types"; // 对齐 public-agents-chat.ts 的实际 import
import { runAgentsBridgeChatTask } from "./task.agents-bridge";
import { extractHostSegments } from "./host-canvas-protocol";

interface ChunkIds { req: string; model: string; created: number }

export function buildChunk(
	req: string,
	model: string,
	created: number,
	delta: Record<string, unknown>,
	finish: string | null,
	usage?: Record<string, number>,
) {
	return {
		id: `chatcmpl-${req}`,
		object: "chat.completion.chunk" as const,
		created,
		model,
		choices: [{ index: 0, delta, finish_reason: finish }],
		...(usage ? { usage } : {}),
	};
}

export function translateStreamEvent(
	ids: ChunkIds,
	event: { event: string; data: Record<string, unknown> },
	state: { toolIndex: number },
) {
	if (event.event === "content") {
		const delta = typeof event.data?.delta === "string" ? event.data.delta : "";
		if (!delta) return null;
		return buildChunk(ids.req, ids.model, ids.created, { content: delta }, null);
	}
	if (event.event === "tool") {
		const d = event.data as Record<string, unknown>;
		if (d.toolName !== "flow_patch") return null;
		if (d.phase !== "completed" && d.status !== "success") return null;
		const args = d.input && typeof d.input === "object" ? d.input : {};
		const chunk = buildChunk(ids.req, ids.model, ids.created, {
			tool_calls: [{
				index: state.toolIndex,
				id: String(d.toolCallId || `fp_${state.toolIndex}`),
				type: "function",
				function: { name: "flow_patch", arguments: JSON.stringify(args) },
			}],
		}, null);
		state.toolIndex += 1;
		return chunk;
	}
	return null;
}

export async function handlePublicOpenAiChatRoute(c: AppContext) {
	const userId = String(c.get("userId") || "").trim();
	if (!userId) throw new AppError("Unauthorized", { status: 401, code: "unauthorized" });

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const model = typeof body.model === "string" && body.model ? body.model : "xiaot-agent";
	const wantsStream = body.stream !== false; // 默认流式
	const seg = extractHostSegments(body.messages);
	if (!seg.prompt) {
		return c.json({ error: { message: "messages 中缺少 user 消息", type: "invalid_request_error" } }, 400);
	}
	const sessionKey =
		typeof body.user === "string" && body.user.trim()
			? `host:${body.user.trim().slice(0, 120)}`
			: undefined;

	const extras: Record<string, unknown> = {
		mode: "chat",
		...(sessionKey ? { sessionKey } : {}),
		...(seg.instructions.length ? { systemPrompt: seg.instructions.join("\n\n") } : {}),
		...(seg.manifest ? { hostCapabilityManifest: seg.manifest } : {}),
		...(seg.canvasContext ? { hostCanvasContext: seg.canvasContext } : {}),
	};
	const taskRequest = { kind: "chat" as const, prompt: seg.prompt, extras };

	const ids: ChunkIds = {
		req: crypto.randomUUID().slice(0, 24),
		model,
		created: Math.floor(Date.now() / 1000),
	};
	const state = { toolIndex: 0 };

	if (!wantsStream) {
		const result = await runAgentsBridgeChatTask(c, userId, taskRequest, {});
		const text = String((result as Record<string, any>)?.response?.text ?? (result as Record<string, any>)?.text ?? "");
		return c.json({
			id: `chatcmpl-${ids.req}`,
			object: "chat.completion",
			created: ids.created,
			model,
			choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		});
	}

	return streamSSE(c, async (stream) => {
		const send = (payload: unknown) => stream.writeSSE({ data: JSON.stringify(payload) });
		await send(buildChunk(ids.req, model, ids.created, { role: "assistant" }, null));
		const heartbeat = setInterval(() => {
			void stream.write(": ping\n\n").catch(() => {});
		}, 15_000);
		try {
			await runAgentsBridgeChatTask(c, userId, taskRequest, {
				onStreamEvent: async (event: { event: string; data: Record<string, unknown> }) => {
					const chunk = translateStreamEvent(ids, event, state);
					if (chunk) await send(chunk);
				},
			});
			// 终帧：usage 单位 = 小T消耗的 quota（见接入文档"计费"节），v1 由结算异步完成，
			// 此处以 0 占位 + 后续任务(Task 5)接真实结算值。
			await send(buildChunk(ids.req, model, ids.created, {}, "stop", {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			}));
			await stream.write("data: [DONE]\n\n");
		} catch (error) {
			await send({
				error: { message: error instanceof Error ? error.message : "internal error", type: "server_error" },
			});
			await stream.write("data: [DONE]\n\n");
		} finally {
			clearInterval(heartbeat);
		}
	});
}
```

**实现时必须对齐的锚点**（照 `public-agents-chat.ts` 顶部 import 抄）：`AppError`/`AppContext` 的真实 import 路径、`runAgentsBridgeChatTask` 的第 4 参签名（`onStreamEvent`、`abortSignal`）、`streamSSE` 用法。

- [ ] **Step 4: 注册路由**

`apiKey.routes.ts`，import 块加：

```ts
import { handlePublicOpenAiChatRoute } from "../task/public-openai-compat";
```

在 `publicApiRouter.post("/agents/chat/interrupt", ...)` 旁加：

```ts
// OpenAI 兼容入口（画布宿主协议）：/public/v1/chat/completions
publicApiRouter.post("/v1/chat/completions", (c) => handlePublicOpenAiChatRoute(c as AppContext));
```

- [ ] **Step 5: 跑单测 + 类型检查**

```bash
pnpm --filter @tapcanvas/api exec vitest run src/modules/task/public-openai-compat.test.ts
pnpm --filter @tapcanvas/api build
```
Expected: PASS + 编译通过

- [ ] **Step 6: Commit**

```bash
git add apps/hono-api/src/modules/task/public-openai-compat.* apps/hono-api/src/modules/apiKey/apiKey.routes.ts
git commit -m "feat(host-protocol): OpenAI 兼容 facade /public/v1/chat/completions"
```

---

### Task 5: facade 接计费（beginChatBilling/settle → usage 终帧）

**Files:**
- Modify: `apps/hono-api/src/modules/task/public-openai-compat.ts`
- 参照: `apps/hono-api/src/modules/task/public-agents-chat.ts:446-459`（begin）、`:581`（settle）

- [ ] **Step 1: 读现有计费块**

```bash
grep -n "beginChatBilling\|settleChatBilling\|deriveChatConversationId" /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/task/public-agents-chat.ts | head
```
读函数定义确认签名与返回值（settle 是否返回本回合消耗 quota；若返回，记下字段名）。

- [ ] **Step 2: 在 facade 中镜像计费**

对齐 `public-agents-chat.ts` 的调用方式，在 `runAgentsBridgeChatTask` 前后加（伪差异，字段名以 Step 1 确认为准）：

```ts
const billingConversationId = sessionKey ? deriveChatConversationId(userId, sessionKey) : "";
if (billingConversationId) extras.billingConversationId = billingConversationId;
const billing = await beginChatBilling(c, userId, { conversationId: billingConversationId, /* 同参照处 */ });
// ...runAgentsBridgeChatTask...
const settled = await settleChatBilling(/* 同参照处参数 */);
const consumed = Math.max(0, Number((settled as Record<string, unknown>)?.consumedQuota ?? 0));
await send(buildChunk(ids.req, model, ids.created, {}, "stop", {
	prompt_tokens: 0,
	completion_tokens: consumed,
	total_tokens: consumed,
}));
```

**若 settle 不返回消耗值**：改为在 settle 前后各查一次该 key 的 quota 用量差值；若都不可行，终帧 usage 保持 0 并在接入文档注明"计费经宿主侧另行约定"，同时在本任务 commit message 记录该限制（Tanva 侧 Task 9 有按次兜底扣费）。

- [ ] **Step 3: 类型检查 + 回归**

```bash
pnpm --filter @tapcanvas/api build && pnpm --filter @tapcanvas/api test
```
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add apps/hono-api/src/modules/task/public-openai-compat.ts
git commit -m "feat(host-protocol): facade 终帧 usage 接会话结算 quota"
```

---

### Task 6: Docker 重建 + curl 直连 facade 验证

- [ ] **Step 1: 重建 api 容器**

```bash
cd /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api && docker compose up -d --build api
docker compose logs -f api --tail 20   # 等 health 通过后 Ctrl-C
curl -s http://localhost:8788/health/version
```
Expected: 版本 JSON

- [ ] **Step 2: 纯对话冒烟（无 manifest，回落原行为）**

```bash
export TC_KEY='<用户提供的 tc_sk key>'
curl -sN -m 120 -H "x-api-key: $TC_KEY" -H "content-type: application/json" \
  -d '{"model":"xiaot-agent","stream":true,"user":"linktest-openai-1","messages":[{"role":"user","content":"请只回复两个字：收到"}]}' \
  http://localhost:8788/public/v1/chat/completions
```
Expected: `data: {"id":"chatcmpl-...","object":"chat.completion.chunk",...delta:{"content":"收"}}` … 末尾 `finish_reason:"stop"` 帧 + `data: [DONE]`

- [ ] **Step 3: manifest 模式冒烟（flow_patch tool_calls）**

```bash
cat > /tmp/xiaot-manifest-test.json <<'EOF'
{"model":"xiaot-agent","stream":true,"user":"linktest-openai-2","messages":[
 {"role":"system","content":"<capability_manifest>{\"protocol_version\":\"1\",\"host\":\"tanva\",\"patchOps\":[\"addNode\",\"connectEdge\",\"focusNode\"],\"nodeSpecs\":[{\"type\":\"textNote\",\"label\":\"便签\",\"purpose\":\"画布纯文本便签\",\"params\":{\"text\":{\"type\":\"string\"}}}]}</capability_manifest>"},
 {"role":"system","content":"<canvas_context>{\"nodes\":[],\"edges\":[]}</canvas_context>"},
 {"role":"user","content":"在画布上加一个内容为hello的便签"}]}
EOF
curl -sN -m 180 -H "x-api-key: $TC_KEY" -H "content-type: application/json" \
  -d @/tmp/xiaot-manifest-test.json http://localhost:8788/public/v1/chat/completions | tee /tmp/xiaot-out.txt
grep -c "flow_patch" /tmp/xiaot-out.txt
```
Expected: 至少 1 帧 `delta.tool_calls` 且 `arguments` 含 `"op":"addNode"`、`"type":"textNote"`。若模型没调工具，检查 agents-cli 日志确认 manifest 进了系统提示（`docker compose logs agents-bridge --tail 100 | grep -i "host canvas"`），迭代提示措辞。

- [ ] **Step 4: TapCanvas 自身回归**

打开 TapCanvas 网页画布对话面板发一条消息，确认原聊天/画布写入行为不变。

- [ ] **Step 5: Commit（若有调参修改）**

```bash
git add -A && git commit -m "fix(host-protocol): 联调调参" || true
```

---

### Task 7: 三方接入文档《画布宿主接入（OpenAI 兼容）》

**Files:**
- Modify: `apps/web/src/ui/account/integration-doc-content.ts`（`DOC_SECTIONS` :166 附近）

- [ ] **Step 1: 新增 DocSection**

在 `DOC_SECTIONS` 数组的 `MESSAGE_STREAM` 之后插入 `{ id: "canvas-host", title: "画布宿主接入（OpenAI 兼容）", markdown: CANVAS_HOST }`，并定义常量（与其他节同风格，`{BASE}` 占位）：

````ts
const CANVAS_HOST = `## 画布宿主接入（OpenAI 兼容）

小T可以作为**你自己画布产品的驻场 Agent**：你的平台只需实现三件事——①随请求声明画布能力清单，②转发用户消息，③消费流里的画布操作指令。无需引入 SDK，标准 OpenAI chat/completions 协议，可直接挂在 new-api/OneAPI 等网关后面。

### 端点

\`\`\`
POST {BASE}/public/v1/chat/completions
x-api-key: tc_sk_xxx        # 或 Authorization: Bearer tc_sk_xxx
\`\`\`

### 上行格式

\`\`\`jsonc
{
  "model": "xiaot-agent",
  "stream": true,
  "user": "你的会话键",           // 服务端按此持久化跨轮记忆
  "messages": [
    { "role": "system", "content": "<capability_manifest>{...}</capability_manifest>" },
    { "role": "system", "content": "<canvas_context>{...}</canvas_context>" },
    { "role": "user", "content": "帮我把这两张图连到视频节点" }
  ]
}
\`\`\`

**capability_manifest**（必填才启用画布能力）——你的画布"说明书"，小T据此产出你词汇表内的操作：

\`\`\`jsonc
{
  "protocol_version": "1",
  "host": "your-platform",
  "patchOps": ["addNode", "updateNodeData", "connectEdge", "focusNode", "placeImage", "runNode"],
  "nodeSpecs": [
    { "type": "textNote", "label": "便签", "purpose": "画布纯文本便签",
      "params": { "text": { "type": "string" } } },
    { "type": "generate", "label": "图像生成", "purpose": "按 prompt 生成图片",
      "params": { "prompt": { "type": "string" }, "model": { "type": "string" } },
      "inputs": [{ "handle": "image", "accepts": "image" }],
      "outputs": [{ "handle": "image", "emits": "image" }],
      "constraints": ["最多 9 张参考图输入"] }
  ],
  "notes": ["连线只能 image→image 同类 handle"]
}
\`\`\`

**canvas_context**——当前画布快照（只读）：\`{"nodes":[{"id","type","label","imageUrl",...}],"edges":[{"source","target",...}]}\`

### 下行格式

标准 SSE \`chat.completion.chunk\`：

- 文本回复走 \`delta.content\`。
- **画布操作走 \`delta.tool_calls\`**，\`function.name\` 恒为 \`flow_patch\`，\`arguments\` 是单个操作 JSON：
  \`{"op":"addNode","node":{"id":"n_ab12","type":"textNote","data":{"text":"hello"},"position":{"x":100,"y":200}}}\`
  \`{"op":"connectEdge","source":"n_ab12","target":"n_cd34","sourceHandle":"image","targetHandle":"image"}\`
  \`{"op":"updateNodeData","id":"n_ab12","patch":{"text":"world"}}\`
  \`{"op":"runNode","id":"n_cd34"}\` / \`{"op":"focusNode","id":"n_ab12"}\` / \`{"op":"placeImage","url":"https://..."}\`
- 操作为**乐观应用**：宿主收到即执行、不回传结果；节点 id 由小T生成，宿主如需改写 id 请自行维护映射。
- 终帧 \`finish_reason:"stop"\` 且带 \`usage\`（\`total_tokens\` = 本回合消耗的小T配额单位，用于你侧计费换算）。
- 客户端断开连接即中止后续操作下发。

### 最小接入 checklist

1. 生成 API Key（见"生成 API Key"节）。
2. 定义你的 manifest（建议从 2-3 种节点起步），随每次请求发送。
3. 每次请求带当前画布快照 \`canvas_context\`。
4. 消费 SSE：\`delta.content\` 进聊天 UI；\`delta.tool_calls\` 校验 op ∈ 你声明的 patchOps 后落画布。
5. 终帧 usage 入账。

### curl 冒烟

\`\`\`bash
curl -sN -H "x-api-key: tc_sk_xxx" -H "content-type: application/json" \\
  -d '{"model":"xiaot-agent","stream":true,"user":"demo","messages":[{"role":"system","content":"<capability_manifest>{...}</capability_manifest>"},{"role":"user","content":"加一个便签"}]}' \\
  {BASE}/public/v1/chat/completions
\`\`\`
`;
````

- [ ] **Step 2: 前端构建校验 + 页面自查**

```bash
cd /Users/libiqiang/workspace/TapCanvas-pro && pnpm --filter web build
```
Expected: 构建通过。（可选：起 web dev 打开 `/docs/a2a` 确认新节渲染与侧边导航。）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/ui/account/integration-doc-content.ts
git commit -m "docs(host-protocol): 三方画布宿主接入指南（OpenAI 兼容）"
```

---

## Part B · Tanva 侧

### Task 8: 前端画布协议常量与 patch schema

**Files:**
- Create: `frontend/src/services/agentCanvasProtocol.ts`

- [ ] **Step 1: 实现**

```ts
// frontend/src/services/agentCanvasProtocol.ts
// 小T画布宿主协议（v1）：Tanva 的能力清单 + flow_patch 操作校验。
// 与设计文档 docs/superpowers/specs/2026-07-13-xiaot-agent-integration-design.md 对齐。

export const AGENT_PATCH_OPS = [
  "addNode",
  "updateNodeData",
  "connectEdge",
  "focusNode",
  "placeImage",
  "runNode",
] as const;
export type AgentPatchOp = (typeof AGENT_PATCH_OPS)[number];

export interface AgentFlowPatch {
  op: AgentPatchOp;
  node?: { id: string; type: string; data?: Record<string, unknown>; position?: { x: number; y: number } };
  id?: string;
  patch?: Record<string, unknown>;
  source?: string;
  target?: string;
  sourceHandle?: string;
  targetHandle?: string;
  url?: string;
  name?: string;
}

export function parseAgentFlowPatch(raw: unknown): AgentFlowPatch | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const p = obj as AgentFlowPatch;
  if (!AGENT_PATCH_OPS.includes(p.op)) return null;
  if (p.op === "addNode" && (!p.node?.id || !p.node?.type)) return null;
  if (p.op === "updateNodeData" && (!p.id || !p.patch)) return null;
  if (p.op === "connectEdge" && (!p.source || !p.target)) return null;
  if ((p.op === "focusNode" || p.op === "runNode") && !p.id) return null;
  if (p.op === "placeImage" && !p.url) return null;
  return p;
}

// 一期暴露给小T的节点能力清单（保守起步；type 必须存在于 FlowOverlay rawNodeTypes）
export const TANVA_CAPABILITY_MANIFEST = {
  protocol_version: "1" as const,
  host: "tanva",
  patchOps: [...AGENT_PATCH_OPS],
  nodeSpecs: [
    {
      type: "textNote",
      label: "便签",
      purpose: "画布上的纯文本便签，用于备注/说明",
      params: { text: { type: "string", description: "便签内容" } },
    },
    {
      type: "textChat",
      label: "文本对话",
      purpose: "调用 LLM 生成/改写文本；data.prompt 为输入",
      params: { prompt: { type: "string" } },
      outputs: [{ handle: "text", emits: "text" }],
    },
    {
      type: "generate",
      label: "图像生成",
      purpose: "按 prompt 生成图片；可连入参考图；创建后用 runNode 触发生成（由宿主计费执行）",
      params: {
        prompt: { type: "string", description: "生图提示词" },
        label: { type: "string" },
      },
      inputs: [{ handle: "image", accepts: "image" }],
      outputs: [{ handle: "image", emits: "image" }],
      constraints: ["生成异步完成，结果直接落节点，你无需等待"],
    },
    {
      type: "image",
      label: "图片",
      purpose: "承载一张已有图片（placeImage 的落点，或引用画布已有素材）",
      params: { imageUrl: { type: "string" }, label: { type: "string" } },
      outputs: [{ handle: "image", emits: "image" }],
    },
  ],
  notes: [
    "canvas_context.nodes 里的 id 是真实节点 id，操作已有节点必须用它",
    "addNode 的 position 缺省时宿主会自动排布",
  ],
};

export function buildManifestSystemMessage(): string {
  return `<capability_manifest>${JSON.stringify(TANVA_CAPABILITY_MANIFEST)}</capability_manifest>`;
}

export interface AgentCanvasSnapshot {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

export function buildCanvasContextSystemMessage(snapshot: AgentCanvasSnapshot): string {
  return `<canvas_context>${JSON.stringify(snapshot)}</canvas_context>`;
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b
```
Expected: 通过

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/business/Tanva && git add frontend/src/services/agentCanvasProtocol.ts && git commit -m "feat(agent): Tanva 画布能力清单与 flow_patch 协议(v1)"
```

---

### Task 9: 后端——xiaot run 分支 + SSE 转发 + 计费

**Files:**
- Create: `backend/src/agent/xiaot-agent.service.ts`
- Modify: `backend/src/agent/agent.types.ts:13-23`（AgentEventType 加 `assistant_delta`、`flow_patch`）
- Modify: `backend/src/agent/dto/agent-run.dto.ts`（加 mode/canvasContext 字段）
- Modify: `backend/src/agent/agent-runtime.service.ts:70-105`（createRun 分流）
- Modify: `backend/src/agent/agent.module.ts`（imports/providers）

- [ ] **Step 1: 扩展类型与 DTO**

`agent.types.ts`：

```ts
export type AgentEventType =
  | 'run_started' | 'step_started' | 'step_completed' | 'plan'
  | 'tool_selected' | 'research_text' | 'research_result'
  | 'assistant_delta'   // 新增：xiaot 文本增量 { delta }
  | 'flow_patch'        // 新增：xiaot 画布操作 { patch }
  | 'final' | 'error' | 'done';
```

`dto/agent-run.dto.ts` 加字段（class-validator 风格与现有字段一致）：

```ts
@IsOptional()
@IsIn(['research', 'canvasAgent'])
mode?: 'research' | 'canvasAgent';

@IsOptional()
@IsObject()
canvasContext?: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

@IsOptional()
@IsObject()
capabilityManifest?: Record<string, unknown>;
```

- [ ] **Step 2: 实现 XiaotAgentService**

```ts
// backend/src/agent/xiaot-agent.service.ts
// 经 Tanva new-api 渠道流式调用小T（xiaot-agent 模型），把标准 chat.completion.chunk
// 翻译成 AgentRunEvent 推给前端；按终帧 usage 扣积分。
// 流式解析参照 src/ai/services/veo-video.service.ts:105-190，扩展 tool_calls 与 usage。
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { CreditChargeService } from '../team-credits/credit-charge.service';
import { CreateAgentRunDto } from './dto/agent-run.dto';
import { AgentEventType } from './agent.types';

type EmitFn = (type: AgentEventType, payload: { title?: string; message?: string; data?: any }) => void;

@Injectable()
export class XiaotAgentService {
  private readonly logger = new Logger(XiaotAgentService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly creditsPerKUnit: number;

  constructor(
    private readonly config: ConfigService,
    private readonly creditsService: CreditsService,
    @Optional() private readonly creditCharge?: CreditChargeService,
  ) {
    this.baseUrl = (this.config.get<string>('NEW_API_BASE_URL') || 'http://localhost:4458').replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('NEW_API_KEY') || this.config.get<string>('NEW_API_TOKEN') || '';
    this.model = this.config.get<string>('XIAOT_AGENT_MODEL') || 'xiaot-agent';
    this.creditsPerKUnit = Number(this.config.get<string>('XIAOT_AGENT_CREDITS_PER_1K') || '10');
  }

  buildMessages(dto: CreateAgentRunDto): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (dto.capabilityManifest) {
      messages.push({ role: 'system', content: `<capability_manifest>${JSON.stringify(dto.capabilityManifest)}</capability_manifest>` });
    }
    if (dto.canvasContext) {
      messages.push({ role: 'system', content: `<canvas_context>${JSON.stringify(dto.canvasContext)}</canvas_context>` });
    }
    messages.push({ role: 'user', content: dto.prompt });
    return messages;
  }

  async run(dto: CreateAgentRunDto, userId: string, emit: EmitFn): Promise<void> {
    emit('run_started', { title: '小T已接入', data: { model: this.model } });
    let usageUnits = 0;
    let fullText = '';
    let patchCount = 0;
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        user: dto.sessionId || `tanva:${userId}`,
        messages: this.buildMessages(dto),
      }),
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`xiaot-agent 网关错误 ${response.status}: ${text.slice(0, 300)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.error) throw new Error(String(parsed.error.message || 'xiaot-agent upstream error'));
        const choice = parsed.choices?.[0];
        const delta = choice?.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          fullText += delta.content;
          emit('assistant_delta', { data: { delta: delta.content } });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (tc?.function?.name !== 'flow_patch') continue;
            let args: unknown = null;
            try { args = JSON.parse(String(tc.function.arguments || '{}')); } catch { /* 忽略坏帧 */ }
            if (args && typeof args === 'object') {
              patchCount += 1;
              emit('flow_patch', { data: { patch: args } });
            }
          }
        }
        const usage = parsed.usage;
        if (usage && typeof usage.total_tokens === 'number') {
          usageUnits = Math.max(usageUnits, usage.total_tokens);
        }
      }
    }
    await this.settleCredits(userId, usageUnits, { textChars: fullText.length, patchCount });
    emit('final', { message: fullText, data: { text: fullText, patchCount, usageUnits } });
    emit('done', {});
  }

  /** 按 usage(=小T quota 单位) 后扣；usage 为 0 时按次兜底 */
  private async settleCredits(
    userId: string,
    usageUnits: number,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const fallbackPerRun = Number(this.config.get<string>('XIAOT_AGENT_CREDITS_PER_RUN') || '5');
    const amount = usageUnits > 0
      ? Math.max(1, Math.ceil((usageUnits / 1000) * this.creditsPerKUnit))
      : fallbackPerRun;
    if (amount <= 0) return;
    try {
      await this.creditsService.deductExact(userId, null, amount, {
        serviceType: 'text' as any, // Step 3 在 credits.config 注册专属类型后替换
        serviceName: 'xiaot-agent',
        provider: 'new-api',
        model: this.model,
        requestParams: meta,
      });
    } catch (error) {
      this.logger.error(`xiaot-agent 扣费失败 user=${userId} amount=${amount}: ${String(error)}`);
    }
  }
}
```

- [ ] **Step 3: credits 配置注册**

```bash
grep -n "ServiceType" /Users/libiqiang/business/Tanva/backend/src/credits/credits.config.ts | head -5
```
在 `ServiceType` 联合/枚举中加 `'agent-chat'`（对齐现有命名风格），基础价 0（实际按 usage 动态扣）。将上面 `serviceType: 'text' as any` 替换为 `'agent-chat'`。若 ServiceType 是 Prisma enum 需迁移，则改用现有最接近的文本类 serviceType 并在 `serviceName: 'xiaot-agent'` 上区分（**不做 DB 迁移**）。

- [ ] **Step 4: runtime 分流 + module 装配**

`agent-runtime.service.ts` `createRun`（:70）开头加分流（保持原逻辑不动）：

```ts
if (dto.mode === 'canvasAgent') {
  const run = this.initRun(dto, userId, 'canvasAgent'); // 若无 initRun，按原 createRun 建 record 的代码内联复制
  setTimeout(() => {
    const emit: (type: AgentEventType, payload: any) => void = (type, payload) =>
      this.emit(run, type, payload);
    this.xiaotAgent
      .run(dto, userId, emit)
      .catch((error) => {
        this.emit(run, 'error', { message: String(error?.message || error) });
        this.emit(run, 'done', {});
      });
  }, 0);
  return this.toSummary(run); // 对齐原 createRun 返回逻辑
}
```

（实现时以原 createRun 的建 record/emit/summary 代码为准内联，不新造辅助函数除非已存在。）构造函数注入 `private readonly xiaotAgent: XiaotAgentService`。

`agent.module.ts`：

```ts
imports: [ConfigModule, OssModule, AiModule, CreditsModule, TeamCreditsModule],
providers: [AgentRuntimeService, VolcResearchSearchService, XiaotAgentService, ApiKeyOrJwtGuard],
```

- [ ] **Step 5: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/backend && npm run build
```
Expected: tsc 通过

- [ ] **Step 6: Commit**

```bash
cd /Users/libiqiang/business/Tanva && git add backend/src/agent backend/src/credits/credits.config.ts && git commit -m "feat(agent): xiaot canvasAgent run 分支——经 new-api 流式调用+SSE 转发+usage 扣费"
```

---

### Task 10: new-api 渠道配置 + 后端链路冒烟

- [ ] **Step 1: 配置渠道（手动，new-api 管理后台）**

打开 `http://localhost:4458`（tanva-new-api 管理后台）：
1. 渠道 → 新建：类型 **OpenAI**，Base URL `http://host.docker.internal:8788/public`（tanva-new-api 容器访问宿主机上 TapCanvas api 容器映射端口；若两容器同 docker 网络可用容器名），密钥 = tc_sk key，模型 `xiaot-agent`（自定义模型名）。
2. 令牌/分组确认 `NEW_API_KEY` 所属分组可调 `xiaot-agent`。
3. 模型定价：`xiaot-agent` 按 token 计价（值参照小T quota 单位换算，先随意设 1，Tanva 自己在后端扣积分，new-api 记账仅作对账）。

- [ ] **Step 2: 经 new-api 冒烟**

```bash
export TANVA_NEWAPI_KEY='<backend .env 里的 NEW_API_KEY>'
curl -sN -m 120 -H "Authorization: Bearer $TANVA_NEWAPI_KEY" -H "content-type: application/json" \
  -d '{"model":"xiaot-agent","stream":true,"user":"newapi-smoke-1","messages":[{"role":"user","content":"请只回复两个字：收到"}]}' \
  http://localhost:4458/v1/chat/completions | head -40
```
Expected: 标准 chunk 流透传（`delta.content` "收""到"）。若 `tool_calls` 帧被网关吞，检查 new-api 渠道类型/流转发设置；必要时在 new-api 打 patch（记录进 `new-api patch` 目录惯例 2026-07-13/001）。

- [ ] **Step 3: 起 Tanva 后端冒烟 run**

```bash
cd /Users/libiqiang/business/Tanva/backend && npm run dev &
sleep 8
# 用一个测试 JWT 或 API key（对齐 ApiKeyOrJwtGuard 现有联调方式）
curl -s -X POST http://localhost:4000/api/agent/runs -H "content-type: application/json" -H "Authorization: Bearer $TANVA_TEST_TOKEN" \
  -d '{"prompt":"请只回复两个字：收到","mode":"canvasAgent"}'
# 用返回的 runId：
curl -sN http://localhost:4000/api/agent/runs/<runId>/events -H "Authorization: Bearer $TANVA_TEST_TOKEN" | head -30
```
Expected: SSE 依次 `run_started` → `assistant_delta`（"收""到"）→ `final` → `done`；credits 表有对应扣费记录（`serviceName='xiaot-agent'`）。

- [ ] **Step 4: Commit（若有修复）**

```bash
git add -A && git commit -m "fix(agent): xiaot 链路联调修复" || true
```

---

### Task 11: 前端 patch applier + FlowOverlay 三个新事件桥

**Files:**
- Create: `frontend/src/services/agentPatchApplier.ts`
- Modify: `frontend/src/components/flow/FlowOverlay.tsx`（一个新 useEffect 挂载点；锚点 `flow:wirePromptMention` 监听器与 `runNode = React.useCallback` :15922）

- [ ] **Step 1: applier 实现**

```ts
// frontend/src/services/agentPatchApplier.ts
// 把小T下发的 flow_patch 翻译成画布 window 事件桥。乐观应用，失败仅 toast。
import { AgentFlowPatch, parseAgentFlowPatch } from "./agentCanvasProtocol";

function toast(message: string) {
  window.dispatchEvent(new CustomEvent("toast", { detail: { type: "warning", message } }));
}

/** agent 节点id → 画布真实id 映射（addNode 由 FlowOverlay 生成真实 id） */
const idMap = new Map<string, string>();
const realId = (id: string | undefined): string => (id && idMap.get(id)) || id || "";

export function resetAgentPatchSession(): void {
  idMap.clear();
}

export function applyAgentPatch(raw: unknown): boolean {
  const p: AgentFlowPatch | null = parseAgentFlowPatch(raw);
  if (!p) {
    toast("小T下发了无法识别的画布操作，已忽略");
    return false;
  }
  switch (p.op) {
    case "addNode": {
      window.dispatchEvent(
        new CustomEvent("flow:agent-add-node", {
          detail: {
            type: p.node!.type,
            data: p.node!.data ?? {},
            position: p.node!.position,
            done: (created: string | null) => {
              if (created) idMap.set(p.node!.id, created);
              else toast(`小T想创建的节点类型不可用: ${p.node!.type}`);
            },
          },
        }),
      );
      return true;
    }
    case "updateNodeData":
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", { detail: { id: realId(p.id), patch: p.patch } }),
      );
      return true;
    case "connectEdge":
      window.dispatchEvent(
        new CustomEvent("flow:agent-connect-edge", {
          detail: {
            source: realId(p.source),
            target: realId(p.target),
            sourceHandle: p.sourceHandle ?? null,
            targetHandle: p.targetHandle ?? null,
          },
        }),
      );
      return true;
    case "focusNode":
      window.dispatchEvent(new CustomEvent("flow:focus-node", { detail: { id: realId(p.id) } }));
      return true;
    case "runNode":
      window.dispatchEvent(new CustomEvent("flow:agent-run-node", { detail: { id: realId(p.id) } }));
      return true;
    case "placeImage":
      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: { imageUrl: p.url, fileName: p.name || "agent-image" },
        }),
      );
      return true;
    default:
      return false;
  }
}
```

（`triggerQuickImageUpload` 的 detail 形状实现时对齐 `aiChatStore.ts:2485` 现有派发处，字段名以现状为准。）

- [ ] **Step 2: FlowOverlay 挂载三个监听器**

在 `flow:wirePromptMention` 监听器 useEffect 附近（同一代码区域）新增一个独立 useEffect：

```tsx
// 小T agent 画布桥：建节点/连线/运行（详见 services/agentPatchApplier.ts）
React.useEffect(() => {
  const onAgentAddNode = (e: Event) => {
    const detail = (e as CustomEvent).detail as {
      type: string; data?: Record<string, any>; position?: { x: number; y: number };
      done?: (id: string | null) => void;
    };
    try {
      const world = detail.position ?? rf.project({
        x: window.innerWidth / 2, y: window.innerHeight / 2,
      });
      const id = createNodeAtWorldCenter(detail.type, world, detail.data);
      detail.done?.(id ?? null);
    } catch {
      detail.done?.(null);
    }
  };
  const onAgentConnectEdge = (e: Event) => {
    const d = (e as CustomEvent).detail as {
      source: string; target: string; sourceHandle: string | null; targetHandle: string | null;
    };
    onConnect({ source: d.source, target: d.target, sourceHandle: d.sourceHandle, targetHandle: d.targetHandle });
  };
  const onAgentRunNode = (e: Event) => {
    const d = (e as CustomEvent).detail as { id: string };
    const node = rf.getNodes().find((n) => n.id === d.id);
    if (!node) return;
    if (FLOW_GROUP_LOCAL_RUN_TYPES.has(String(node.type))) {
      window.dispatchEvent(new CustomEvent("flow:run-node", { detail: { id: d.id } }));
    } else {
      void runNode(d.id);
    }
  };
  window.addEventListener("flow:agent-add-node", onAgentAddNode as EventListener);
  window.addEventListener("flow:agent-connect-edge", onAgentConnectEdge as EventListener);
  window.addEventListener("flow:agent-run-node", onAgentRunNode as EventListener);
  return () => {
    window.removeEventListener("flow:agent-add-node", onAgentAddNode as EventListener);
    window.removeEventListener("flow:agent-connect-edge", onAgentConnectEdge as EventListener);
    window.removeEventListener("flow:agent-run-node", onAgentRunNode as EventListener);
  };
}, [createNodeAtWorldCenter, onConnect, runNode, rf]);
```

注意：`createNodeAtWorldCenter` 的 world 参数是画布世界坐标；`rf.project` 在 reactflow 11 中把屏幕坐标转世界坐标——实现时对齐 `flow:createImageNode` 监听器（:15390）现有取中心的写法。`FLOW_GROUP_LOCAL_RUN_TYPES` 是 :1311 现有常量（若为数组则用 `.includes`）。

- [ ] **Step 3: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b
```
Expected: 通过

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/business/Tanva && git add frontend/src/services/agentPatchApplier.ts frontend/src/components/flow/FlowOverlay.tsx
git commit -m "feat(agent): flow_patch applier + FlowOverlay agent 事件桥(建节点/连线/运行)"
```

---

### Task 12: 前端——小T模式发消息链路（store + UI 开关）

**Files:**
- Modify: `frontend/src/services/agentBackendAPI.ts`（CreateAgentRunRequest 加字段）
- Modify: `frontend/src/stores/aiChatStore.ts`（新增 xiaot 模式状态 + run 函数；锚点 `runAgentTrace` :8459 同区域）
- Modify: `frontend/src/components/chat/AIChatDialog.tsx`（模式开关按钮）

- [ ] **Step 1: agentBackendAPI 扩展**

`CreateAgentRunRequest`（:53-67）加：

```ts
mode?: "research" | "canvasAgent";
canvasContext?: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
capabilityManifest?: Record<string, unknown>;
```

`AgentEventType`（:10）加 `"assistant_delta" | "flow_patch"`。

- [ ] **Step 2: aiChatStore 增加 xiaot 模式**

状态区（`isVisible` 附近）加：

```ts
xiaotMode: false,
toggleXiaotMode: () => set((s) => ({ xiaotMode: !s.xiaotMode })),
```

新增方法 `runXiaotAgent(input: string)`（放在 `runAgentTrace` 同区域，复用其消息创建模式）：

```ts
runXiaotAgent: async (input: string) => {
  const { TANVA_CAPABILITY_MANIFEST } = await import("../services/agentCanvasProtocol");
  const { applyAgentPatch, resetAgentPatchSession } = await import("../services/agentPatchApplier");
  // 1) 取画布快照：请求即时重播（FlowOverlay 已有 flow:request-nodes-snapshot 机制）
  const snapshot = await new Promise<{ nodes: any[]; edges: any[] }>((resolve) => {
    const timer = setTimeout(() => resolve({ nodes: [], edges: [] }), 800);
    const onSnap = (e: Event) => {
      clearTimeout(timer);
      window.removeEventListener("flow:nodes-snapshot", onSnap);
      resolve({ nodes: (e as CustomEvent).detail?.nodes ?? [], edges: [] });
    };
    window.addEventListener("flow:nodes-snapshot", onSnap);
    window.dispatchEvent(new CustomEvent("flow:request-nodes-snapshot"));
  });
  // 2) 建用户消息 + assistant 占位消息（复用 sendMessage 现有的 addMessage 模式）
  const aiMessage = get().addMessage({ role: "assistant", content: "", status: "generating" });
  resetAgentPatchSession();
  try {
    const run = await createAgentRunViaAPI({
      prompt: input,
      mode: "canvasAgent",
      sessionId: get().currentSessionId ?? undefined,
      canvasContext: snapshot,
      capabilityManifest: TANVA_CAPABILITY_MANIFEST,
    });
    let text = "";
    await streamAgentRunEvents(run.id, (event) => {
      if (event.type === "assistant_delta") {
        text += String((event.data as any)?.delta ?? "");
        get().updateMessage(aiMessage.id, (m) => ({ ...m, content: text }));
      } else if (event.type === "flow_patch") {
        applyAgentPatch((event.data as any)?.patch);
        get().updateMessage(aiMessage.id, (m) => ({
          ...m,
          metadata: { ...m.metadata, agentPatchCount: ((m.metadata as any)?.agentPatchCount ?? 0) + 1 },
        }));
      } else if (event.type === "error") {
        get().updateMessage(aiMessage.id, (m) => ({ ...m, status: "error", content: text || String(event.message ?? "小T出错了") }));
      }
    });
    get().updateMessage(aiMessage.id, (m) => ({ ...m, status: "completed", content: text }));
  } catch (error) {
    get().updateMessage(aiMessage.id, (m) => ({ ...m, status: "error", content: String((error as Error)?.message ?? error) }));
  }
},
```

在 `sendMessage` 入口（走 agent 判定 :8425 之前）加拦截：

```ts
if (state.xiaotMode) {
  await get().runXiaotAgent(input);
  return;
}
```

（`addMessage`/`updateMessage`/`currentSessionId` 的真实方法名与签名，实现时以 aiChatStore 现状为准对齐；上述为语义代码。）

- [ ] **Step 3: AIChatDialog 加开关**

在对话框工具栏区域（模型选择器附近）加一个 toggle 按钮：

```tsx
<button
  className={`chat-toolbar-btn ${xiaotMode ? "active" : ""}`}
  title="小T画布智能体模式"
  onClick={() => toggleXiaotMode()}
>
  小T
</button>
```

样式对齐相邻按钮的现有 class；`xiaotMode`/`toggleXiaotMode` 从 store 取。开启时输入框 placeholder 提示"小T可以直接操作画布"。

- [ ] **Step 4: 类型检查 + lint**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b && npm run lint -- --quiet || true
```
Expected: tsc 通过

- [ ] **Step 5: Commit**

```bash
cd /Users/libiqiang/business/Tanva && git add frontend/src && git commit -m "feat(agent): 聊天面板小T模式——快照上送+delta渲染+flow_patch落画布"
```

---

### Task 13: 快照增强——canvas_context 带 edges

**Files:**
- Modify: `frontend/src/components/flow/FlowOverlay.tsx`（`flow:request-nodes-snapshot` 监听器 :15478 附近）

- [ ] **Step 1: 快照补 edges**

现有 `flow:nodes-snapshot` 只有 nodes。在 `flow:request-nodes-snapshot` 的重播逻辑里补边（保持向后兼容，追加字段）：

```ts
window.dispatchEvent(new CustomEvent("flow:nodes-snapshot", {
  detail: {
    nodes: summary,
    edges: rf.getEdges().map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
    })),
  },
}));
```

同步更新 Task 12 中 `runXiaotAgent` 的 snapshot resolve：`edges: (e as CustomEvent).detail?.edges ?? []`（代码已如此写，确认即可）。检查 `CanvasNodeTab.tsx:128` 消费方只读 `detail.nodes`，追加 edges 不影响它。

- [ ] **Step 2: 类型检查 + Commit**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b
cd /Users/libiqiang/business/Tanva && git add frontend/src/components/flow/FlowOverlay.tsx && git commit -m "feat(agent): 画布快照补 edges 供 canvas_context"
```

---

### Task 14: 端到端联调（验收）

- [ ] **Step 1: 全栈起服务**

TapCanvas Docker 栈已起（Task 6）；Tanva：`backend npm run dev` + `frontend npm run dev`；确认 new-api 渠道（Task 10）可用。

- [ ] **Step 2: 验收用例（浏览器操作 Tanva 画布）**

1. 打开画布 → 聊天面板 → 开"小T"模式。
2. 「帮我加一个便签，内容写今天的任务」→ 画布出现 textNote 节点，内容正确；聊天区有小T的文字答复。
3. 画布上先放一张图 → 「基于这张图创建一个图像生成节点，提示词'赛博朋克风格重绘'，连上线并开始生成」→ 出现 generate 节点、连线成功、节点进入生成中状态、完成后出图；积分按现有生成管线扣除。
4. 「聚焦到刚才那个便签」→ 视口居中到该节点。
5. 双端协作页面打开同画布 → 小T建的节点在协作端同步出现（走 `flow:updateNodeData`/建节点的既有协作广播）。
6. 检查积分流水：本轮对话有 `serviceName='xiaot-agent'` 扣费记录；生成节点另有生成扣费。
7. 关小T模式发普通消息 → 原聊天/生图行为不变；`manualAIMode==='auto'` 的 research agent trace 不受影响。

- [ ] **Step 3: 记录问题与回归修复，逐项 commit**

- [ ] **Step 4: 收尾**

两仓库分别确认 `git status` 干净、类型检查通过。按 superpowers:finishing-a-development-branch 处理 TapCanvas 的 `feat/canvas-host-protocol` 分支与 Tanva `feature/agent` 分支。

---

## 附：不做清单（YAGNI）

- 不做同步 remote tools（生成结果回传 agent 链式推理）——二期
- 不做子agent 团队 UI/富事件（thinking/agent_role 不进 v1 协议）——二期
- 不做中立协议第三实现、不做 TapCanvas 节点↔Tanva 节点映射表
- 不做 DB 迁移（两侧都不需要）
- 不动 aiChatStore 既有 research agent trace 链路
