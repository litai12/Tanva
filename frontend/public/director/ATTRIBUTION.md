# 导演台 3D 素体模型署名

本目录下的 3D 角色素体模型用于导演台（directorConsole）3D blocking。

导演台菜单中的男性、女性、宽厚、健壮、纤细、少年、儿童与二头身八套默认素体，现由 Tanva 在运行时以独立参数化网格和统一关节骨架生成，不再基于本目录的 X Bot 缩放派生；这八套程序化素体是项目自有实现，不涉及第三方模型文件授权。

| 文件 | 来源 | 许可证 |
|---|---|---|
| `xbot.glb` | Adobe Mixamo「X Bot」（经 three.js 官方示例仓库分发；标准 Mixamo 骨骼、T-pose 绑定，保留用于上传模型/骨骼兼容回归） | Mixamo 使用条款（项目内免版税使用） |
| `cesium-man.glb` | Cesium（glTF 官方示例模型 CesiumMan，已不默认使用，保留回退） | CC-BY 4.0 |
| `rigged-figure.glb` | Cesium（glTF 官方示例模型 RiggedFigure，已不默认使用，保留回退） | CC-BY 4.0 |

- 许可证全文：https://creativecommons.org/licenses/by/4.0/
- 模型由 Cesium 捐赠给 Khronos glTF 项目用于测试：https://github.com/KhronosGroup/glTF-Sample-Models
- 按 CC-BY 4.0 要求，已在产品「3D导演台」界面内展示署名（模型 © Cesium，CC-BY 4.0）。

用户上传的远程 GLB/GLTF 仍走通用人形骨骼映射，并须由上传者保证资产授权。
