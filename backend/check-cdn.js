#!/usr/bin/env node

/**
 * CDN配置检查脚本
 * 用于检查是否已配置CDN以及CDN是否正常工作
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 检查CDN配置...\n');

// 1. 检查环境变量文件
const envFiles = ['.env', '.env.production', '.env.local'];
let envContent = '';
let envFileFound = false;

for (const envFile of envFiles) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
    envFileFound = true;
    console.log(`✅ 找到环境变量文件: ${envFile}`);
    break;
  }
}

if (!envFileFound) {
  console.log('⚠️  未找到环境变量文件 (.env, .env.production, .env.local)');
  console.log('   请检查环境变量是否通过其他方式配置（如系统环境变量）\n');
}

// 2. 检查OSS_CDN_HOST配置
const cdnHostMatch = envContent.match(/OSS_CDN_HOST\s*=\s*(.+)/);
const cdnHost = cdnHostMatch ? cdnHostMatch[1].trim() : null;

console.log('\n📋 配置检查结果:');
console.log('─'.repeat(50));

if (cdnHost) {
  console.log(`✅ OSS_CDN_HOST 已配置: ${cdnHost}`);
} else {
  console.log('❌ OSS_CDN_HOST 未配置');
  console.log('   需要在环境变量中添加: OSS_CDN_HOST=your-cdn-domain.com');
}

// 3. 检查其他OSS相关配置
const ossRegion = envContent.match(/OSS_REGION\s*=\s*(.+)/)?.[1]?.trim();
const ossBucket = envContent.match(/OSS_BUCKET\s*=\s*(.+)/)?.[1]?.trim();

if (ossRegion) {
  console.log(`✅ OSS_REGION: ${ossRegion}`);
} else {
  console.log('⚠️  OSS_REGION 未配置');
}

if (ossBucket) {
  console.log(`✅ OSS_BUCKET: ${ossBucket}`);
} else {
  console.log('⚠️  OSS_BUCKET 未配置');
}

console.log('─'.repeat(50));

// 4. 检查代码中的CDN使用
console.log('\n📝 代码检查:');
console.log('─'.repeat(50));

const ossServicePath = path.join(__dirname, 'src/oss/oss.service.ts');
if (fs.existsSync(ossServicePath)) {
  const ossServiceCode = fs.readFileSync(ossServicePath, 'utf-8');
  
  if (ossServiceCode.includes('OSS_CDN_HOST')) {
    console.log('✅ 代码已支持CDN配置 (oss.service.ts)');
  }
  
  if (ossServiceCode.includes('cdnHost')) {
    console.log('✅ 代码已实现CDN域名优先逻辑');
  }
} else {
  console.log('⚠️  未找到 oss.service.ts 文件');
}

console.log('─'.repeat(50));

// 5. 提供验证建议
console.log('\n🧪 CDN验证方法:');
console.log('─'.repeat(50));

if (cdnHost) {
  console.log('\n1️⃣  检查CDN域名是否可访问:');
  console.log(`   curl -I https://${cdnHost.replace(/^https?:\/\//, '')}/test-image.jpg`);
  
  console.log('\n2️⃣  检查响应头中的CDN标识:');
  console.log('   应该看到以下响应头之一:');
  console.log('   - x-cache: HIT (命中缓存) ✅');
  console.log('   - x-cache: MISS (未命中，首次访问正常)');
  console.log('   - x-served-by: 阿里云CDN');
  console.log('   - server: AliyunOSS (如果没有CDN)');
  
  console.log('\n3️⃣  测试URL生成:');
  console.log('   启动后端服务，调用OSS服务的 publicUrl() 方法');
  console.log('   如果返回的URL包含CDN域名，说明配置生效 ✅');
  
  console.log('\n4️⃣  在阿里云控制台检查:');
  console.log('   - 登录阿里云控制台');
  console.log('   - 进入 CDN 服务');
  console.log('   - 查看加速域名列表');
  console.log('   - 确认域名状态为"已启动" ✅');
} else {
  console.log('\n⚠️  由于未配置 OSS_CDN_HOST，当前使用OSS直连:');
  if (ossBucket && ossRegion) {
    console.log(`   当前URL格式: https://${ossBucket}.${ossRegion}.aliyuncs.com/...`);
  }
  console.log('\n💡 配置CDN的步骤:');
  console.log('   1. 在阿里云控制台创建CDN加速域名');
  console.log('   2. 配置源站为OSS域名');
  console.log('   3. 在环境变量中添加: OSS_CDN_HOST=your-cdn-domain.com');
  console.log('   4. 重启后端服务');
}

console.log('\n' + '─'.repeat(50));
console.log('📚 更多信息请查看: frontend/docs/存储和CDN/01-OSS和CDN指南.md');
console.log('─'.repeat(50) + '\n');

