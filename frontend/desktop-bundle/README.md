# Tanva desktop capability bundle

This directory is the install-time slot for audited desktop skills and isolated runtimes.

To stage the user-supplied reference package, run:

```text
node scripts/importDesktopBundle.mjs --source /path/to/reference/app --dry-run
node scripts/importDesktopBundle.mjs --source /path/to/reference/app --force
```

The importer copies the isolated runtimes and MCP skill dependencies, removes
generated Python caches, and writes a manifest with the imported file count.
Tanva validates executable paths and MCP configuration before starting a service.

The logical capability surface is declared in `compute-use-manifest.json`.
External software, isolated runtimes, project knowledge, updates, and
renovation operations all go through the harness `compute-use` boundary and
return task/project-bound results.

建筑和供应链的 `architecture` / `business` 是 Electron 内置连接器，状态写入当前 Tanva 项目范围。Blender 使用 `Settings/Skills/blender-mcp/blender_bridge.py`：在检测到 Blender 时由 Blender 后台进程承载 `bpy` 操作；未安装 Blender 时仍可用受限场景模型跑协议与业务逻辑检查，不会伪造 GLB、渲染图或工程文件。

建筑规划能力还包含 `validate_site_setbacks`：输入场地边界、建筑轮廓和项目退界阈值后，Electron 会按栋输出四向实际退界、违规方向和方案筛查状态；`validate_parking_access` 会继续校验停车位、无障碍车位、道路/消防车道宽度和转弯半径，可继续接入体量生成与报规工作流；`estimate_energy_performance` 按项目提供的围护结构和度日参数估算能耗/EUI，并支持 EUI 上限校验。

供应链的 `reconcile_purchase_order` 会按订单行汇总已交、已验收、拒收和未交数量，并生成可持久化的对账结果；`close_purchase_order` 只允许无缺口、无拒收的订单进入关闭状态，`handover_to_accounts_payable` 再生成应付交接单；`review_payment_handover` 和 `record_payment` 负责审核、分次付款和余额收口，`close_finance` 在余额清零后关闭财务交接。
