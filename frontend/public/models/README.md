# 3D Models Directory

这个目录存储用于artboard项目的3D模型文件。

## 文件说明

### simple-box.glb (1.6KB)
- **描述**: 简单的红色立方体
- **来源**: Khronos Group glTF-Sample-Assets
- **用途**: 基础测试模型，适合验证3D模型加载功能
- **特点**: 最小文件大小，快速加载

### duck.glb (118KB)  
- **描述**: 经典的黄色橡皮鸭模型
- **来源**: Khronos Group glTF-Sample-Assets  
- **用途**: 更复杂的测试模型，带有纹理和更多几何细节
- **特点**: 中等复杂度，适合展示3D渲染效果

## 使用方法

在artboard应用中：
1. 点击3D模型工具按钮（立方体图标）
2. 在画布上拖拽创建占位框
3. 点击占位框中的上传按钮
4. 选择这里的任意一个GLB文件进行测试

## 模型来源

所有模型均来自Khronos Group的官方glTF示例资源库：
- Repository: https://github.com/KhronosGroup/glTF-Sample-Assets
- License: 这些模型是开源的，可以自由使用

## 添加新模型

如需添加新的3D模型：
1. 将GLB或GLTF文件放到此目录
2. 建议文件大小控制在50MB以内
3. 更新此README文件说明

## 支持的格式

- ✅ GLB (GL Transmission Format Binary)
- ✅ GLTF (GL Transmission Format)

## 注意事项

- GLB是二进制格式，包含所有资源在单个文件中
- GLTF是文本格式，可能需要额外的.bin和纹理文件
- 建议优先使用GLB格式以简化部署