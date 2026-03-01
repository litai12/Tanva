# localStorage 清理指南

## 🧹 一键清理脚本

### 方法 1: 完全清理（推荐）

在浏览器开发者工具中执行（F12 → Console）：

```javascript
// ========== 完全清理脚本 ==========
const storageKeys = [
  'canvas-settings',
  'flow-settings',
  'image-history',
  'tool-settings',
  'ui-preferences',
  'video-store',
  'ai-chat-store',
  'tanva-smart-offset',
  'tanva-offset-migrated'
];

console.log('🧹 开始清理 localStorage...');
console.log('准备删除的 keys:', storageKeys);

let deletedCount = 0;
let totalSize = 0;

// 计算总大小
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key) {
    const value = localStorage.getItem(key);
    if (value) {
      totalSize += key.length + value.length;
    }
  }
}

console.log(`📊 清理前 localStorage 大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

// 删除指定的 keys
storageKeys.forEach(key => {
  if (localStorage.getItem(key) !== null) {
    localStorage.removeItem(key);
    console.log(`✅ 已删除: ${key}`);
    deletedCount++;
  }
});

// 删除其他遗留数据（可选）
const keysToCheck = [];
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key && !storageKeys.includes(key) && key.length > 20) {
    keysToCheck.push(key);
  }
}

if (keysToCheck.length > 0) {
  console.log(`\n⚠️ 发现其他大型数据:`, keysToCheck);
  console.log('需要手动检查是否删除');
}

console.log(`\n✨ 清理完成！删除了 ${deletedCount} 个 keys`);
console.log('页面将在 2 秒后刷新...');

setTimeout(() => {
  location.reload();
}, 2000);
```

### 方法 2: 选择性清理

如果只想清理某些数据：

```javascript
// 清理图片历史（通常最大）
localStorage.removeItem('image-history');
console.log('✅ 已清理图片历史');

// 清理流程配置
localStorage.removeItem('flow-settings');
console.log('✅ 已清理流程配置');

// 清理画布设置
localStorage.removeItem('canvas-settings');
console.log('✅ 已清理画布设置');

location.reload();
```

### 方法 3: 完全核清（最彻底）

```javascript
// ⚠️ 谨慎：这将删除所有数据
console.warn('⚠️ 即将删除所有 localStorage 数据...');

// 显示要删除的所有数据
console.log('即将删除的 keys:');
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  console.log(`  - ${key}`);
}

// 执行清理
localStorage.clear();
console.log('✅ 所有 localStorage 数据已清理');

setTimeout(() => {
  location.reload();
}, 1000);
```

---

## 📈 执行步骤

1. **打开应用**
   ```
   http://localhost:5173
   ```

2. **打开开发者工具**
   - Windows/Linux: `F12`
   - Mac: `Cmd + Option + I`

3. **切换到 Console 标签**
   ```
   Console → 粘贴脚本 → Enter
   ```

4. **等待页面刷新**
   - 脚本会自动清理数据
   - 页面会自动刷新加载

---

## 🔍 查看清理结果

清理后检查效果：

```javascript
// 查看剩余数据
console.log('剩余 localStorage 数据:');
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key);
  console.log(`${key}: ${(value?.length ?? 0)} 字符`);
}

// 计算总大小
let totalSize = 0;
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key) {
    const value = localStorage.getItem(key);
    if (value) {
      totalSize += key.length + value.length;
    }
  }
}
console.log(`\n📊 清理后 localStorage 大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
```

---

## ⚠️ 注意事项

- ✅ 清理后可能需要重新配置一些UI设置
- ✅ 图片历史会被清除（如果有需要请先导出）
- ✅ 流程配置会重置
- ✅ 这些都可以随时重新创建

---

## 🚀 推荐流程

1. **先导出重要数据**（如果需要）
2. **执行方法 1 完全清理**
3. **刷新页面检查**
4. **验证应用是否正常运行**

---

## 📞 遇到问题？

如果清理后出现问题：

```javascript
// 恢复默认配置
sessionStorage.clear();
localStorage.clear();
location.reload();
```

这会将应用重置到初始状态，所有功能都能正常运行。
