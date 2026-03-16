| 参数  | 参数格式 | 描述  |
| --- | --- | --- |
| 宽高比 | \\--aspect 或 --ar | 悠船图像最初是正方形，但你可以使用宽高比参数更改这一点 |
| 混沌  | \\--chaos 或 --c | 使用混沌参数为你的图像结果增添趣味 |
| 角色参考 | \\--cref | 想在多个图像和场景中使用相同的角色？你可以为悠船提供角色参考！ |
| 否定提示 | \\--no | 使用否定参数告诉悠船你不想在图像中看到什么 |
| 个性化 | \\--profile 或 --p | 使用个性化配置文件和情绪板创建自定义图像风格 |
| 质量  | \\--quality 或 --q | 使用质量参数控制图像的细节和处理时间 |
| 重复  | \\--repeat 或 --r | 想从单个提示生成多组图像？使用重复参数 |
| 种子  | \\--seed | 使用种子参数进行测试和实验 |
| 停止  | \\--stop | 需要更柔和或独特的外观？使用停止参数在半途完成图像 |
| 原始模式 | \\--raw | 使用原始模式获得对图像的更多控制 |
| 风格化 | \\--stylize 或 --s | 使用风格化参数控制图像中的艺术风格 |
| 风格参考 | \\--sref | 想要匹配另一张图像的外观和感觉？你可以为悠船提供风格参考！ |
| 平铺  | \\--tile | 使用平铺参数创建无缝重复图案 |
| 模型版本 | \\--version 或 --v | 使用版本参数探索和切换悠船的模型版本 |
| 草图  | \\--draft | 在V7中以一半的GPU成本生成草稿图像 |
| 怪异  | \\--weird 或 --w | 使用怪异参数使你的图像古怪和非常规 |
| 快速模式 | \\--fast | 将你的GPU速度切换到快速模式 |
| 图像权重 | \\--iw | 控制图像提示的影响 |
| 慢速模式 | \\--relax | 将你的GPU速度切换到慢速模式 |
| 极速模式 | \\--turbo | 将你的GPU速度切换到极速模式 |
| Niji | \\--niji | 使用我们专注于动漫和东方美学的模型 |
| 枚举  | {}  | 批次生成多个提示词并生成图片 |
| 实验参数 | \\--exp | 控制图像生成的美学效果 |
| 隐身/公开模式 | \\--stealth/--public | 暂不支持(悠船图片均不对外开放) |
| 重复参数 | \\--repeat | 暂不支持 |
| 动态模式 | \\--motion | 控制视频动态快慢(仅支持视频任务) |

**注意事项**

-   API目前支持以下模型：`v6`、`v6.1`、`niji 6` 和 `v7`
    
-   API目前不支持 `repeat`、`personalize` 和 `{}` 排列提示词
    

## **参数模型兼容表**

| **参数** | **v6** | **v6.1** | **niji 6** | **niji 7** | **v7** | **视频模型** |
| --- | --- | --- | --- | --- | --- | --- |
| 原始模式 | raw | raw | raw | raw | raw | raw |
| 平铺  | ![勾选图标](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/6556988671/p1046393.svg) | ![勾选图标](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/6556988671/p1046394.svg) | ![勾选图标](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/6556988671/p1046396.svg) | ![禁止图标](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/5556988671/p1046395.svg) | ![勾选图标](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/5556988671/p1046397.svg) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 混沌  | 0-100 | 0-100 | 0-100 | 0-100 | 0-100 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 种子  | 0-4294967295 | 0-4294967295 | 0-4294967295 | 0-4294967295 | 0-4294967295 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 停止  | 10-100 | 10-100 | 10-100 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 怪异  | 0-3000 | 0-3000 | 0-3000 | 0-3000 | 0-3000 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 风格化 | 0-1000 | 0-1000 | 0-1000 | 0-1000 | 0-1000 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 质量  | (0.5, 1, 2) | (0.5, 1, 2) | (0.5, 1, 2) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | (1, 2, 4) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 快速模式 | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 极速模式 | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 慢速模式 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 图像权重 | 0-3 | 0-3 | 0-3 | 0-2 | 0-3 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 否定提示 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 风格参考 | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 角色参考 | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 角色权重 | 0-100 | 0-100 | 0-100 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 风格版本 | (1, 2, 3, 4) | (1, 2, 3, 4) | (1, 2, 3, 4) | (1, 2, 3, 4) | (1, 2, 3, 4, 5, 6) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 风格权重 | 0-1000 | 0-1000 | 0-1000 | 0-1000 | 0-1000 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 重复参数 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 草图  | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 万物引用 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 万物引用权重 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | 1-1000 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 实验参数 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | 0-100 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 批次数量 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | (1, 2, 4) |
| 视频模型 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | 1   |
| 动态模式 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | (low, high) |
| 视频尾帧 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |
| 视频循环 | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![禁止图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) | ![勾选图标](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=) |

## **宽高比**

悠船图像默认为正方形，但您可以使用宽高比参数来改变这一点：`--ar`或`--aspect`

![不同宽高比的图像示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

### **参数详解**

宽高比是图像宽度与高度的比例关系，通常用两个数字表示（如1:1或4:3），第一个数字代表宽度，第二个数字代表高度；例如，4:3的宽高比表示图像宽度是高度的1.33倍。

悠船默认生成1:1的正方形图像，即宽度和高度相等；通过调整宽高比，您可以灵活控制图像的构图方向：

-   当第一个数字较大时（如16:9），生成横向的宽幅图像
    
-   当第二个数字较大时（如9:16），生成纵向的竖幅图像
    

合理选择宽高比可以帮助您更好地呈现图像内容，适应不同的展示场景和创作需求。

**重要提示：** 宽高比与图像尺寸不同。悠船图像的最终大小还取决于您使用的[模型版本](#模型版本)和[高清类型](https://help.aliyun.com/zh/marketplace/youchuan-api#高清-upscale)。

### **常用设置及应用场景**

以下是悠船支持的核心宽高比及其典型应用：

-   **1:1** - 标准正方形，适合社交媒体头像、Instagram帖子等场景
    
-   **4:3** - 传统矩形比例，适用于老式显示器、平板电脑等设备
    
-   **2:3** - 经典摄影比例，常用于相框、海报等印刷品
    
-   **16:9** - 现代宽屏比例，是高清视频、智能电视的主流标准
    
-   **9:16** - 竖屏比例，专为移动端短视频、社交媒体故事优化
    

### **宽高比与像素的关系**

您可以通过以下步骤快速确定并设置图像的宽高比：

1.  **基于像素尺寸**：例如1920x1080像素的图像，输入`--ar 1920:1080`，系统会自动简化为`--ar 16:9`
    
2.  **基于物理尺寸**：对于8.5x11英寸等尺寸，去除小数点后输入`--ar 85:110`
    
3.  **自定义比例**：支持任意整数比例，如`--ar 3:2`或`--ar 5:4`
    

### **注意事项**

-   默认宽高比为1:1，适合大多数基础场景
    
-   仅支持整数比例，如`139:100`替代`1.39:1`
    
-   不同模型版本对宽高比的支持程度可能不同
    
-   极端宽高比（如1:10或10:1）属于实验性功能，效果可能不稳定
    
-   高清处理时，部分宽高比可能会进行微调优化
    

## **混沌**

通过混沌参数 `--c` 或 `--chaos` 控制图像生成结果的多样性程度。

![chaos-header2.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> **兼容性说明**：该功能完全兼容悠船V7版本，参数设置与使用方式保持不变。

### **参数详解**

混沌参数用于调节图像生成过程中的随机性程度，直接影响生成结果的多样性表现。

**默认设置**：

-   混沌值：0
    
-   生成数量：4张图像
    
-   生成特征：基于提示词生成风格统一的图像
    

**参数调节**：

-   **取值范围**：0-100
    
-   **低值效果**（0-30）：生成结果保持高度一致性，严格遵循提示词
    
-   **中值效果**（30-70）：生成结果呈现适度变化，在保持主题的同时增加创意元素
    
-   **高值效果**（70-100）：生成结果具有显著差异，可能突破提示词限制，带来意想不到的艺术效果
    

### **使用建议**

-   创意探索时建议使用较高混沌值
    
-   需要精确控制生成效果时建议使用较低混沌值
    
-   首次使用时建议从30-50的中间值开始尝试
    

## **多提示词与权重**

通过多提示词和权重功能，您可以精确控制图像生成中的重点元素，实现更精细的创作效果。

![multi-prompt-header.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> **兼容性说明**：该功能与悠船V7版本不兼容

### **功能简介**

多提示词功能允许用户将不同的创意概念分别处理后再进行组合，从而实现更复杂的图像生成效果。该功能通过将提示词分割为多个独立部分，分别进行处理后再进行融合，为创作提供了更大的灵活性和控制力。

### **使用方法**

在提示词的不同部分之间使用双冒号 `::` 作为分隔符。例如：

-   普通提示：`太空飞船` → 生成科幻太空船
    
-   多提示：`太空:: 飞船` → 分别处理"太空"和"飞船"概念，可能生成在太空中航行的船
    

**支持版本**：该功能兼容悠船V1-V6、Niji 4-6以及6.1版本。

**格式要求**：

-   双冒号左侧不能有空格
    
-   双冒号右侧需要添加一个空格
    
-   所有参数仍应放置在提示词的最后
    

### **权重控制**

在多提示词的基础上，您可以通过设置权重来调整各个提示词的重要性程度。权重值直接影响生成结果中各元素的突出程度。

**设置方法**： 在分隔符 `::` 后直接添加数字表示权重。例如：`太空::2 飞船` 表示"太空"的重要性是"飞船"的两倍。

**权重规则**：

-   V1-V3版本：仅支持整数权重
    
-   V4-V6、Niji 4-6、6.1版本：支持小数权重，提供更精确的控制
    
-   默认权重：1（未指定时自动应用）
    

**注意事项**：

-   权重值应为正数
    
-   建议从中间值开始尝试，逐步调整
    
-   权重设置会影响生成时间，复杂权重可能需要更多计算资源
    

## **负面提示权重**

通过设置负权重，您可以明确指定不希望出现在生成图像中的元素。请注意，**所有提示词权重的总和必须为正数**。

### **使用示例**

-   有效示例：`静物画:: 水果::-0.5`
    
    解释：默认权重1 + 负权重-0.5 = 0.5（正数），生成成功
    
-   无效示例：`静物画:: 水果::-2`
    
    解释：默认权重1 + 负权重-2 = -1（负数），系统将返回错误
    

### **与否定参数的关系**

使用`--no`参数等同于设置-0.5的负权重。例如：

-   `生机勃勃的郁金香田 --no 红色`
    
-   `生机勃勃的郁金香田:: 红色::-0.5`
    

以上两种写法效果相同，都表示在生成图像时尽量避免出现红色元素。

### **使用建议**

1.  确保最终权重总和为正数
    
2.  负权重值建议在-0.1到-1.0之间
    
3.  对于简单排除需求，推荐使用`--no`参数
    
4.  需要精确控制排除程度时，可使用负权重
    

## **否定参数**

使用 `--no` 参数可以精确控制图像生成中需要排除的元素。

![否定参数使用示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 兼容性说明：此功能在悠船V7及以下版本中均可使用，参数设置保持不变

### **功能概述**

`--no` 参数用于指定生成图像时需要排除的元素或特征。该参数通过负权重机制实现，相当于为指定元素设置-0.5的权重值。

### **使用场景**

-   排除特定对象：如 `--no 水果,树木`
    
-   避免特定风格：如 `--no 卡通,抽象`
    
-   控制图像特征：如 `--no 阴影,高光`
    

## **枚举参数**

使用枚举功能快速生成多个提示词变体。

![permutation-header.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 兼容性：支持悠船V7及更高版本

### **功能概述**

枚举参数允许用户通过单一提示生成多个变体。使用大括号`{}`包裹多个选项，用逗号分隔，系统将自动生成所有可能的组合。

### **使用场景**

1.  **快速生成变体**：
    
    ```
    a {red, green, yellow} bird
    ```
    
    将生成：
    
    -   `a red bird`
        
    -   `a green bird`
        
    -   `a yellow bird`
        
2.  **参数组合测试**：
    
    ```
    --ar {1:1, 2:3, 3:5}
    ```
    
    将测试不同宽高比的效果
    

> **计费说明**：每个枚举生成的提示词将单独计费，请谨慎使用以避免快速消耗积分。

### **高级用法**

1.  **多组枚举**：
    
    ```
    一只 {红色, 绿色} 鸟在 {丛林, 沙漠}
    ```
    
    生成4个变体
    
2.  **嵌套枚举**：
    
    ```
    一个 {鸟 {在码头上, 在海滩上}, 狗 {在沙发上, 在卡车里}}
    ```
    
    生成4个变体
    
3.  **模型版本测试**：
    
    ```
    一只红色鸟 --v {4, 5, 6.1}
    ```
    
    测试不同模型版本效果
    
4.  **特殊字符处理**：
    
    ```
    {红色, 粉色 \, 黄色} 鸟
    ```
    
    生成：
    
    -   `一只红色鸟`
        
    -   `一只粉色, 黄色鸟`
        

### **最佳实践**

-   建议先测试少量组合，确认效果后再扩大枚举范围
    
-   注意控制枚举数量，避免生成过多变体
    
-   结合其他参数使用，可获得更丰富的效果
    

## **质量参数**

使用质量参数控制图像生成的质量和处理时间：`--quality` 或 `--q`

![不同质量参数效果对比](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 支持版本：v5.2、v6、v6.1、v7

### **参数说明**

质量参数用于控制图像生成的精细程度，类似于设置绘图时的投入程度。它直接影响图像生成的GPU时间消耗和最终效果。

-   **低质量设置**：快速生成草图效果，处理时间短，适合快速测试创意
    
-   **高质量设置**：生成更精细的图像，处理时间长，适合追求细节的场景
    

### **参数取值**

不同版本支持的质量参数范围：

| 版本  | 可选值 |
| --- | --- |
| v6.1 | 0.5, 1, 2 |
| v6  | 0.25, 0.5, 1 |
| v5.2 | 0.25, 0.5, 1 |
| Niji 5 | 0.25, 0.5, 1 |

默认质量级别为1，仅影响初始图像生成，不影响后续变体或放大操作。

### **使用方法**

`一只猫 --quality 1`

### **版本7更新**

在v7版本中，质量参数进行了优化：

1.  **默认优化**：v7模型默认使用`--q 1`，提供更好的手部连贯性，同时减少GPU时间消耗
    
2.  **历史模式**：如需使用优化前的v7模型，可添加`--q 2`
    
3.  **实验模式**：使用`--q 4`尝试新的生成模式，可能获得更好的细节表现
    
4.  **低质量模式**：如需更低质量设置，请参考
    

> 注意：质量参数会直接影响GPU时间消耗，请根据实际需求合理选择。

## **原始模式参数**

使用原始模式参数`--raw`可以禁用悠船默认的美化效果，获得更精确的图像生成控制。

![raw-mode-header.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 支持版本：v5.1、v6、v6.1、v7

### **功能说明**

原始模式通过以下方式工作：

-   禁用默认的美学风格优化
    
-   更严格地遵循提示词中的具体细节
    
-   减少自动"美化"处理
    
-   支持更真实或特定风格的图像生成
    

### **使用场景**

-   需要精确控制图像细节时
    
-   追求真实感而非艺术化效果时
    
-   自定义特定风格时
    
-   进行技术性图像生成时
    

### **使用方法**

在提示词末尾添加`--raw`参数：

## **重复参数**

使用重复参数可基于单个提示生成多组图像：`--repeat` 或简写 `--r`

![重复参数示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> **版本兼容性**：支持版本7及更高版本**API暂不支持**: API暂不支持此参数，有特殊需要请与我们联系

### **功能概述**

重复参数允许用户通过单次提示请求生成多个图像变体。该功能特别适用于：

-   需要从同一提示获取多个创意方案时
    
-   进行图像风格或细节的对比测试时
    
-   批量生成相似但独特的图像时
    

### **使用方法**

在提示词末尾添加 `--r` 参数，后跟所需生成次数：

## **种子参数**

使用种子参数控制图像生成的初始状态：`--seed`

![seed-header.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 支持版本：v5.1、v6、v6.1、v7

### **参数说明**

种子参数用于设置图像生成的初始随机状态，类似于计算机图形学中的随机数种子。通过指定相同的种子值，可以在相同提示词下获得相似的初始生成结果。

种子值范围为0到4294967295之间的整数。未指定时，系统将自动生成随机种子，每次生成结果都会不同。

### **使用方法**

在提示词末尾添加`--seed`参数，后跟种子值：

```
`a cat --seed 23453422
```

### **使用场景**

-   **测试与调试**：在调整提示词或参数时，使用固定种子可直观对比不同设置的效果
    
-   **批量生成**：需要基于相同初始状态生成多个变体时
    
-   **实验研究**：进行生成过程的可重复性实验时
    

### **注意事项**

1.  **一致性限制**：
    
    -   种子仅控制初始生成状态，无法保证完全一致的输出
        
    -   模型版本、参数设置等变化会影响最终结果
        
    -   不同会话间使用相同种子可能产生不同结果
        
2.  **功能限制**：
    
    -   无法用于保存或传递特定风格
        
    -   不适用于极速模式（`--turbo`）
        
    -   不能替代风格参考、角色参考等一致性控制工具
        
3.  **最佳实践**：
    
    -   建议在测试阶段使用固定种子
        
    -   对于正式生成，建议使用随机种子以获得更多样化的结果
        
    -   需要保持一致性时，建议结合使用风格参考等工具
        

## **停止参数**

使用停止参数 `--stop` 控制图像生成过程的完成度，获得独特视觉效果。

![停止参数在不同值下的示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> **兼容性说明**：该功能与悠船V7版本不兼容

### **功能概述**

停止参数用于在图像生成过程中提前终止渲染，通过控制生成完成度来获得不同视觉效果。该参数类似于视频播放中的暂停功能，允许用户在特定阶段冻结图像生成过程。

**默认值**：100（完全生成）

**取值范围**：1-100（整数）

### **参数详解**

停止参数通过百分比控制生成过程，数值代表生成完成度：

-   **1-30**：高度抽象效果，生成草图或模糊图像
    
-   **31-70**：半抽象效果，主要元素已形成但细节有限
    
-   **71-99**：接近完成，保留大部分细节但缺少精细处理
    
-   **100**：完全生成（默认值）
    

### **使用示例**

在提示词末尾添加 `--stop` 参数，后跟停止值：

```
vibrant Californiz poppies --stop 50
```

## **风格化参数**

使用 `--stylize` 或 `--s` 参数控制图像的艺术风格程度。

![stylize-header.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 兼容版本：v7

### **参数说明**

风格化参数用于调节图像生成在写实与艺术之间的平衡：

-   **低值（0-250）**：更忠实于提示词，生成写实风格图像
    
-   **中值（250-750）**：平衡写实与艺术性，适合大多数场景
    
-   **高值（750-1000）**：增强艺术表现力，生成更具创意的图像
    

默认值：100

### **使用示例**

```
child's drawing of a cat --s 100
```

### **使用场景**

| 值范围 | 特点  | 适用场景 |
| --- | --- | --- |
| 0-250 | 写实风格，细节清晰，色彩自然 | 产品设计、建筑渲染、概念插图 |
| 250-750 | 平衡写实与艺术性，适度风格化 | 插画、游戏美术、商业艺术 |
| 750-1000 | 强烈艺术性，大胆色彩构图 | 抽象艺术、概念艺术、风格化插画 |

## **平铺参数**

使用平铺参数创建无缝重复图案：`--tile`

![平铺参数示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> **兼容版本**：v7

### **参数说明**

平铺参数用于生成可无缝重复排列的图像，特别适合创建重复图案和纹理。该参数通过特殊算法确保图像边缘能够完美匹配，实现水平和垂直方向的无缝连接。

**主要特点**：

-   生成单个可重复的瓦片
    
-   确保图像边缘平滑过渡
    
-   支持四向无缝连接（上下左右）
    
-   适用于多种设计场景
    

### **参数详解**

#### **工作原理**

平铺参数通过以下方式实现无缝连接：

1.  在生成过程中同时考虑图像内容和边缘
    
2.  使用特殊算法优化边缘匹配
    
3.  确保图像在重复排列时自然过渡
    

#### **连接方式**

-   **水平无缝**：左右边缘完美匹配
    
-   **垂直无缝**：上下边缘完美匹配
    
-   **四向无缝**：所有边缘和角落完美匹配
    

### **使用方法**

在提示词末尾添加 `--tile` 参数即可启用平铺模式

### **应用场景**

#### **纹理和材质创建**

生成可用于3D建模、游戏开发或图形设计的无缝纹理：

```
 砖墙纹理，红褐色，风化效果 --tile
```

#### **背景和壁纸设计**

创建网页、演示文稿或桌面壁纸的重复背景：

```
 轻微抽象波浪图案，柔和蓝色调，数字背景 --tile
```

#### **织物和印花设计**

用于时装、家居装饰或印刷品的图案设计：

```
 小花卉图案，春季色彩，适合面料设计 --tile
```

#### **游戏美术资源**

创建用于游戏开发的平铺地图元素或背景：

```
 科幻金属面板，发光元素，游戏界面 --tile
```

## **模型版本**

使用 `--version` 或 `--v` 参数切换悠船API的模型版本。

![版本参数示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

### **版本说明**

悠船API提供多个模型版本，每个版本在图像生成质量、艺术风格和提示词处理方式上都有独特优势。版本更新类似于软件升级，会带来性能提升和新功能。

### **版本特性**

-   不同版本对提示词的处理方式存在差异
    
-   各版本具有独特的艺术风格表现
    
-   新版本通常提供更优的图像质量和细节表现
    

> **最新版本说明**：[版本7](https://help.aliyun.com/zh/marketplace/youchuan-api-model-overview#版本7)已发布，但默认仍使用版本6.1。如需使用版本7，需手动指定。

### **使用方法**

在API请求的提示词末尾添加 `--v #` 参数指定版本号。

示例：`a cat --v 7`

## **怪异参数**

使用 `--weird` 或 `--w` 参数为图像添加非常规和超现实元素。

![怪异参数示例](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

> 兼容版本：7

### **参数概述**

怪异参数通过以下方式影响图像生成：

-   引入非传统元素和意外组合
    
-   增加生成过程中的随机性
    
-   降低常规美学规则的权重
    
-   增强超现实和抽象表现
    
-   保持核心主题的实验性表达
    

### **参数值范围**

| 值范围 | 效果描述 |
| --- | --- |
| 10-300 | 轻微怪异，保持基本可识别性 |
| 300-1000 | 明显非传统元素和组合 |
| 1000-3000 | 极端超现实和抽象效果 |

### **应用场景**

怪异参数（--weird）通过引入非常规元素和超现实效果，为创意工作提供独特支持。主要应用包括：

1.  **创意探索**
    
    -   超现实艺术：`梦境场景，抽象感 --weird 800`
        
    -   突破瓶颈：`[现有概念] --weird 500`
        
2.  **视觉设计**
    
    -   品牌标识：`现代品牌标志，简约风格 --weird 250`
        
    -   音乐视觉：`实验电子音乐专辑封面 --weird 900`
        
3.  **专业创作**
    
    -   概念艺术：`外星生物概念设计 --weird 450`
        
    -   数字艺术：`数字抽象艺术，色彩丰富 --weird 800`
        
    -   广告视觉：`产品广告，现代风格 --weird 300`
        

### **使用技巧**

1.  **渐进实验**
    
    ```
    太空风景 --weird 100太空风景 --weird 500太空风景 --weird 1200
    ```
    
2.  **主题适配**
    
    -   自然：`热带植物 --weird 600`
        
    -   科技：`机械生物 --weird 700`
        
    -   抽象：`意识视觉化 --weird 900`
        
3.  **提示词平衡**
    
    -   高值：`详细描述的城市场景 --weird 1200`
        
    -   低值：`城市印象 --weird 200`
        

### **风格融合**

1.  超现实：`超现实主义场景 --weird 600`
    
2.  抽象：`抽象表现主义绘画 --weird 800`
    
3.  未来：`未来主义风格 --weird 700`
    

## **实验参数**

使用 `--exp` 参数控制图像生成的美学效果，这是一个实验性参数。

### **参数说明**

-   **取值范围**：0-100，默认值为0
    
-   **功能特点**：与 `--stylize` 参数类似但可结合使用，能够生成更详细、动态、创意且色调映射更丰富的图像
    
-   **效果变化**：随着参数值增加，提示词准确性和图像多样性会降低
    

### **推荐值**

建议主要使用以下值：5、10、25、50、100

### **使用建议**

1.  **效果变化**：5-50之间效果变化明显，50-100之间变化较小
    
2.  **参数组合**：当值超过25-50时，可能会覆盖 `--stylize` 和 `--p` 参数的效果，建议在组合使用时采用较低值
    

> **注意：**需要V7及以上模型版本

## **Niji**

使用 `--niji` 参数启用专注于动漫和东方美学的模型，特别适合生成日式动漫风格图像。

### **参数说明**

-   **模型特点**：专为动漫风格优化，擅长处理人物、场景和特效
    
-   **风格范围**：从传统手绘到现代数字动漫风格
    
-   **参数数值**：`[5, 6, 7]`
    

### **使用场景**

1.  **角色设计**
    
    ```
    日式动漫少女，粉色长发，魔法学院制服 --niji 7
    ```
    
2.  **场景绘制**
    
    ```
    日本传统街道，樱花飘落，黄昏时分 --niji 7
    ```
    
3.  **特效表现**
    
    ```
    战斗场景，能量爆发，炫目光效 --niji 7
    ```
    

### **参数组合建议**

-   与 `--stylize` 结合使用可调整艺术风格强度
    
-   与 `--weird` 结合可创造独特动漫效果
    
-   与 `--aspect` 结合可优化构图比例
    

### **注意事项**

-   该参数会覆盖默认模型设置
    
-   不适用于写实风格图像生成
    
-   建议在提示词中包含明确的动漫相关描述
    

## **隐身/公开参数**

使用 `--stealth` 或 `--public` 参数控制图像的可见性设置。

### **参数说明**

-   **隐身模式 (**`**--stealth**`**)**：生成的图像仅对创建者可见，不会出现在公共画廊中
    
-   **公开模式 (**`**--public**`**)**：生成的图像将出现在公共画廊中，供其他用户浏览
    

### **使用场景**

1.  **隐私保护**
    
    ```
    个人肖像，写实风格 --stealth
    ```
    
2.  **作品展示**
    
    ```
    概念艺术，未来城市 --public
    ```
    
3.  **商业项目**
    
    ```
    产品设计，未发布新品 --stealth
    ```
    

### **参数组合建议**

-   与 `--quality` 结合使用可控制图像细节
    
-   与 `--stylize` 结合可调整艺术风格
    
-   与 `--aspect` 结合可优化构图比例
    

### **注意事项**

-   默认设置为公开模式
    
-   隐身模式下的图像仍可通过直接链接访问
    
-   参数切换不会影响已生成图像的可见性设置
    

## **重复参数**

使用 `--repeat` 参数可以从单个提示生成多组图像，适用于需要批量生成或进行风格测试的场景。

### **参数说明**

-   **参数格式**：`--repeat <次数>` 或 `--r <次数>`
    
-   **数值范围**：1-10（默认值为1）
    
-   **功能特点**：基于相同提示词生成多个图像变体
    

### **使用场景**

1.  **批量生成**
    
    ```
    奇幻森林场景，月光照耀，精灵飞舞 --r 5
    ```
    
2.  **风格测试**
    
    ```
    未来城市，赛博朋克风格 --r 3 --stylize 100
    ```
    
3.  **创意探索**
    
    ```
    抽象艺术，色彩斑斓 --r 4 --weird 50
    ```
    

### **参数组合建议**

-   与 `--seed` 结合使用可控制图像变体范围
    
-   与 `--chaos` 结合可增加图像多样性
    
-   与 `--aspect` 结合可测试不同构图效果
    

### **注意事项**

-   每次重复都会消耗相应的GPU时间
    
-   重复次数过多可能导致图像质量下降
    
-   目前仅支持V7及以上模型版本
    

## **动态模式**

控制视频生成时的画面动态效果，使用`--motion`参数控制

### **模式选项**

1.  **低动态模式 (--motion low)** - 默认设置
    
    -   特点：静态场景为主，镜头运动平缓，角色动作细微
        
    -   适用场景：电影感画面、氛围营造、需要稳定视觉效果的场景
        
    -   效果示例：缓慢平移、淡入淡出、细微表情变化
        
2.  **高动态模式 (--motion high)**
    
    -   特点：大幅镜头运动，快速动作变化，强烈视觉冲击
        
    -   适用场景：动作场景、转场特效、需要突出动态感的画面
        
    -   注意事项：可能导致动作不自然或画面异常（如卡顿、穿模）
        

### **使用建议**

-   基础用法：`--motion low` 或 `--motion high`
    

## **万物引用**

使用万物引用允许您将参考图像中的角色、物体、车辆或非人类生物放入您的悠船创作中([详情参考](https://tob.youchuan.cn/openapi/guides/advanced-topics/use_images#%E4%B8%87%E7%89%A9%E5%BC%95%E7%94%A8))。

## **批次数量**

通过`--bs [1|2|3|4]`参数可以指定一个任务执行过程中生成的视频数量。

## **个性化**

通过`--p [moodboard id]`参数可以指定个性化模板，生成风格一致的图片。