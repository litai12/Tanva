// 测试 Kling API 用小图片的脚本
// 用于验证 OSS URL 方案是否解决了 524 超时问题

const fs = require('fs');

// 一个很小的 64x64 PNG 图片的 Base64（1x1 像素的透明 PNG，大小约 100 字节）
const SMALL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 测试 payload
const testPayload = {
  provider: 'kling',
  prompt: '测试小图片生成视频',
  referenceImages: [SMALL_PNG_BASE64],
  duration: 5,
  aspectRatio: '16:9'
};

console.log('测试 Kling API 用小图片的 payload:');
console.log(JSON.stringify(testPayload, null, 2));
console.log(`\n图片 Base64 长度: ${SMALL_PNG_BASE64.length} 字符`);
console.log(`总 payload 大小: ${JSON.stringify(testPayload).length} 字节`);

// 你可以复制这个 payload 到前端或 API 工具中测试
console.log('\n复制上面的 JSON 到前端测试，或使用 curl:');
console.log(`curl -X POST http://localhost:3000/ai/generate-video-provider \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '${JSON.stringify(testPayload)}'`);
