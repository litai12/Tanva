# 导演台 3D 素体模型署名

本目录下的 3D 角色素体模型用于导演台（directorConsole）3D blocking。

导演台菜单不再基于同一个 X Bot 做八种整体缩放。八个菜单项均使用下表所列的独立 CC0 开源蒙皮模型；高度归一化只负责米制落地，不用于把同一网格伪装成不同体型。

其中男性、女性默认素体已优先替换为 Quaternius「Universal Base Characters」免费 Standard 包的 Superhero Male/Female 模型；原程序化男女素体不再进入这两个菜单项。其余类型在取得对应开源模型前仍使用项目自有程序化回退。

| 文件 | 来源 | 许可证 |
|---|---|---|
| `xbot.glb` | Adobe Mixamo「X Bot」（经 three.js 官方示例仓库分发；标准 Mixamo 骨骼、T-pose 绑定，保留用于上传模型/骨骼兼容回归） | Mixamo 使用条款（项目内免版税使用） |
| `cesium-man.glb` | Cesium（glTF 官方示例模型 CesiumMan，已不默认使用，保留回退） | CC-BY 4.0 |
| `rigged-figure.glb` | Cesium（glTF 官方示例模型 RiggedFigure，已不默认使用，保留回退） | CC-BY 4.0 |
| `open-source/quaternius-universal-base/Superhero_Male_FullBody.gltf` 及依赖 | Quaternius「Universal Base Characters」Standard | CC0 1.0 Universal |
| `open-source/quaternius-universal-base/Superhero_Female_FullBody.gltf` 及依赖 | Quaternius「Universal Base Characters」Standard | CC0 1.0 Universal |
| `open-source/quaternius-ultimate-animated/Viking_Male.gltf` | Quaternius「Ultimate Animated Character Pack」 | CC0 1.0 Universal |
| `open-source/quaternius-ultimate-animated/Knight_Male.gltf` | Quaternius「Ultimate Animated Character Pack」 | CC0 1.0 Universal |
| `open-source/quaternius-ultimate-animated/Ninja_Female.gltf` | Quaternius「Ultimate Animated Character Pack」 | CC0 1.0 Universal |
| `open-source/quaternius-ultimate-animated/Elf.gltf` | Quaternius「Ultimate Animated Character Pack」 | CC0 1.0 Universal |
| `open-source/quaternius-ultimate-animated/Goblin_Male.gltf` | Quaternius「Ultimate Animated Character Pack」 | CC0 1.0 Universal |
| `open-source/quaternius-ultimate-animated/Goblin_Female.gltf` | Quaternius「Ultimate Animated Character Pack」 | CC0 1.0 Universal |

- 许可证全文：https://creativecommons.org/licenses/by/4.0/
- 模型由 Cesium 捐赠给 Khronos glTF 项目用于测试：https://github.com/KhronosGroup/glTF-Sample-Models
- 按 CC-BY 4.0 要求，已在产品「3D导演台」界面内展示署名（模型 © Cesium，CC-BY 4.0）。

用户上传的远程 GLB/GLTF 仍走通用人形骨骼映射，并须由上传者保证资产授权。
## CC0 rolling terrain Gaussian Splat

- File: `open-source/cc0-terrain/rolling-ground.splat`
- Generator: `frontend/scripts/generateDirectorTerrainSplat.mjs`
- Origin: deterministic synthetic asset authored for Tanva; no third-party scan or texture data
- License: CC0 1.0 Universal (see the asset directory's `LICENSE.txt`)
