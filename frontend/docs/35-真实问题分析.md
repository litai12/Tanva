# 发现的真实问题 - 通过回退找到的根本原因

## 问题诊断

通过比对回退前后的代码，我找到了真实问题所在。

### 回退前（54f3720 - 有问题）的代码流程：

```javascript
// 1. 创建Raster，此时 raster.onLoad 尚未设置
const raster = new paper.Raster();

// 2. 设置onLoad回调 - 会在image加载完成时触发
raster.onLoad = () => {
  // 此时会 覆盖 raster.data！！！
  raster.data = {
    ...(raster.data || {}),
    originalWidth,
    originalHeight,
    aspectRatio
  };
};

// 3. 设置source - 触发异步image加载
raster.source = asset.url;

// 4. 这里设置metadata
raster.data = {
  ...(raster.data || {}),
  type: 'image',
  imageId: imageId,
  url: asset.url,
  // ... 其他metadata
};

// 5. 图片异步加载完成
// 👹 onLoad 触发，raster.data 被重置，丢失刚才设置的metadata！！！
```

### 根本问题

**时间竞态条件（Race Condition）**：

1. `raster.onLoad` 回调中有 `raster.data = { ... }`
2. 之后又设置了 `raster.data = { type: 'image', imageId, ... }`
3. **但是图片加载是异步的**
4. 如果网络很快，`onLoad` 可能在步骤2之前触发，导致metadata被覆盖

当网络快时的执行顺序：
```
1. raster = new Raster()
2. raster.onLoad = callback
3. raster.source = url  // 立即开始加载
4. [异步] onLoad触发 🔴 raster.data被重置为只有originalWidth/Height
5. raster.data = { imageId, ... } 这一步永远赶不上
6. 最终 raster.data 只有 originalWidth, originalHeight, aspectRatio
7. 没有 imageId！恢复失败！
```

### 回退后（3bd0692 - 正常）的代码：

```javascript
const raster = new paper.Raster();

// onLoad中设置metadata（原始尺寸）
raster.onLoad = () => {
  raster.data = {
    originalWidth,
    originalHeight,
    aspectRatio
  };
};

// 设置source
raster.source = asset.url;

// 不再在这里设置 raster.data！
// imageId通过 imageGroup.data 存储，不是 raster.data
```

在回退后的版本中，metadata信息存储在：
- `imageGroup.data` - 包含 imageId
- `tanvaImageInstances` 数组 - 全局存储完整的image metadata
- 不依赖 `raster.data` 中的 imageId

所以恢复逻辑会通过 `collectImageSnapshotsFromPaper()` 和 `mergeImagesWithPaperSnapshots()` 来重建完整信息。

## 为什么回退后图片能显示

虽然 `raster.data` 中没有 `imageId`，但恢复流程：

1. **加载保存的assets** - `imageAssets` 包含所有图片信息 ✓
2. **deserializePaperProject()** - 恢复Paper.js结构和Raster ✓
3. **restoreImageSources()** - 即使Raster没有imageId，也可以通过：
   - 位置匹配（bounds match）
   - 尺寸匹配（width/height match）
   - 顺序匹配
   ...来匹配asset到Raster

4. **fallback恢复机制** - 直接从assets快照水合图片 ✓

## 真正的修复方案（NOT 我的那个有问题的修复）

如果要正确地在Raster.data中存储metadata，应该这样做：

```typescript
// ✅ 正确方式：在onLoad后才设置metadata
const raster = new paper.Raster();

raster.onLoad = () => {
  const originalWidth = raster.width;
  const originalHeight = raster.height;
  const aspectRatio = originalWidth / originalHeight;

  // 在onLoad完成后再保存metadata
  // 这样不会被后续的 raster.data = {...} 覆盖
  raster.data = {
    type: 'image',
    imageId: imageId,
    originalWidth,
    originalHeight,
    aspectRatio,
    // 所有metadata在这里一次性设置
    url: asset.url,
    src: asset.url,
    fileName: asset.fileName,
  };
};

raster.source = asset.url;

// ❌ 不要再设置 raster.data 了！在onLoad中已经完成
```

但这样做的问题是：
- 图片加载失败时，imageId会丢失
- 需要在onError中也设置metadata
- 逻辑变复杂

## 结论

### 我的修复（54f3720）的问题：
❌ 没有考虑异步时间竞态
❌ 在onLoad回调之前和之后都设置raster.data，会相互覆盖
❌ 只在网络不够快时才能工作（网络快时会失败）

### 原版代码（3bd0692）的优势：
✅ 不依赖Raster.data中的imageId
✅ 使用imageGroup.data存储metadata（同步，不受异步影响）
✅ 使用tanvaImageInstances全局数组作为真实来源
✅ 有多层fallback机制（asset snapshot, position matching等）
✅ 最终通过fallback恢复机制确保图片恢复

### 真正的bug所在：
不是Raster.data中没有imageId
**而是：** 之前某个版本的提交引入的bug导致 `__tanva_initial_assets_hydrated__` 标志没有正确重置，或者fallback恢复机制未被触发

原版代码已经有完整的容错机制，我的修复反而破坏了这个机制！

## 需要深入调查的点

1. 在项目切换时，`__tanva_initial_assets_hydrated__` 是否被正确重置？
2. `collectImageSnapshotsFromPaper()` 和 `mergeImagesWithPaperSnapshots()` 是否正常工作？
3. fallback恢复机制 `tanva-force-assets-hydration` 事件是否被正确触发？
4. `hydrateFromSnapshot()` 方法是否有问题？

这些才是需要调查的真正问题！
