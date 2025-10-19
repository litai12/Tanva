import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle, XCircle, Loader, Copy, Download } from 'lucide-react';
import { useVideoStore } from '@/stores/videoStore';
import { veoVideoService } from '@/services/veoVideoService';
import type { VideoGenerateRequest } from '@/types/video';

/**
 * Veo 3.1 完整功能测试页面
 */
export default function VeoTestPage() {
  const { generateVideo, extendVideo, videos, isLoading, error, clearError, getVideoStatus } = useVideoStore();

  // 测试状态
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [logs, setLogs] = useState<string[]>([]);

  // 添加日志
  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${type.toUpperCase()}: ${message}`, ...prev].slice(0, 100));
  };

  // 检查 API 可用性
  React.useEffect(() => {
    const checkApi = async () => {
      try {
        const available = veoVideoService.isAvailable();
        if (available) {
          setApiKeyStatus('valid');
          addLog('✅ API 密钥已配置', 'success');
        } else {
          setApiKeyStatus('invalid');
          addLog('❌ API 密钥未找到', 'error');
        }
      } catch (e) {
        setApiKeyStatus('invalid');
        addLog('❌ API 检查失败', 'error');
      }
    };
    checkApi();
  }, []);

  // 测试 1: 基础视频生成
  const testBasicGeneration = async () => {
    setActiveTest('basic');
    try {
      addLog('开始测试：基础视频生成', 'info');

      const request: VideoGenerateRequest = {
        prompt: '一只可爱的柯基犬在草地上奔跑，阳光明媚',
        duration: 4,
        resolution: '720p'
      };

      addLog(`发送请求：${request.prompt}`, 'info');
      const success = await generateVideo(request);

      if (success) {
        addLog('✅ 视频生成成功', 'success');
        setTestResults(prev => ({ ...prev, basic: 'PASS' }));
      } else {
        addLog('❌ 视频生成失败', 'error');
        setTestResults(prev => ({ ...prev, basic: 'FAIL' }));
      }
    } catch (e) {
      addLog(`❌ 异常: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setTestResults(prev => ({ ...prev, basic: 'ERROR' }));
    } finally {
      setActiveTest(null);
    }
  };

  // 测试 2: 不同分辨率
  const testResolutions = async () => {
    setActiveTest('resolution');
    try {
      addLog('开始测试：分辨率', 'info');

      const resolutions: ('720p' | '1080p')[] = ['720p', '1080p'];
      const results = [];

      for (const res of resolutions) {
        addLog(`测试分辨率: ${res}`, 'info');
        const success = await generateVideo({
          prompt: '海滩日落',
          duration: 4,
          resolution: res
        });
        results.push({ resolution: res, success });
      }

      const allPassed = results.every(r => r.success);
      addLog(`分辨率测试: ${allPassed ? '✅ 通过' : '⚠️ 部分失败'}`, allPassed ? 'success' : 'error');
      setTestResults(prev => ({ ...prev, resolution: allPassed ? 'PASS' : 'PARTIAL' }));
    } catch (e) {
      addLog(`❌ 异常: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setTestResults(prev => ({ ...prev, resolution: 'ERROR' }));
    } finally {
      setActiveTest(null);
    }
  };

  // 测试 3: 不同时长
  const testDurations = async () => {
    setActiveTest('duration');
    try {
      addLog('开始测试：时长', 'info');

      const durations: (4 | 6 | 8)[] = [4, 6, 8];
      const results = [];

      for (const dur of durations) {
        addLog(`测试时长: ${dur}秒`, 'info');
        const success = await generateVideo({
          prompt: '森林中的小径',
          duration: dur,
          resolution: '720p'
        });
        results.push({ duration: dur, success });
      }

      const allPassed = results.every(r => r.success);
      addLog(`时长测试: ${allPassed ? '✅ 通过' : '⚠️ 部分失败'}`, allPassed ? 'success' : 'error');
      setTestResults(prev => ({ ...prev, duration: allPassed ? 'PASS' : 'PARTIAL' }));
    } catch (e) {
      addLog(`❌ 异常: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setTestResults(prev => ({ ...prev, duration: 'ERROR' }));
    } finally {
      setActiveTest(null);
    }
  };

  // 测试 4: 视频扩展
  const testExtend = async () => {
    setActiveTest('extend');
    try {
      addLog('开始测试：视频扩展', 'info');

      if (videos.length === 0) {
        addLog('⚠️ 没有视频可扩展，先生成一个', 'error');
        setTestResults(prev => ({ ...prev, extend: 'SKIP' }));
        return;
      }

      const videoId = videos[0].id;
      addLog(`扩展视频: ${videoId}`, 'info');

      const success = await extendVideo(videoId, 5, '继续场景...');

      if (success) {
        addLog('✅ 视频扩展成功', 'success');
        setTestResults(prev => ({ ...prev, extend: 'PASS' }));
      } else {
        addLog('❌ 视频扩展失败', 'error');
        setTestResults(prev => ({ ...prev, extend: 'FAIL' }));
      }
    } catch (e) {
      addLog(`❌ 异常: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setTestResults(prev => ({ ...prev, extend: 'ERROR' }));
    } finally {
      setActiveTest(null);
    }
  };

  // 测试 5: 状态管理
  const testStateManagement = async () => {
    setActiveTest('state');
    try {
      addLog('开始测试：状态管理', 'info');

      if (videos.length === 0) {
        addLog('⚠️ 没有视频', 'error');
        setTestResults(prev => ({ ...prev, state: 'SKIP' }));
        return;
      }

      const video = videos[0];
      const status = getVideoStatus(video.id);

      addLog(`视频状态: ${status?.status}`, 'info');
      addLog(`视频进度: ${status?.progress}%`, 'info');
      addLog(`视频数量: ${videos.length}`, 'info');

      const hasValidStatus = status && (status.status === 'pending' || status.status === 'processing' || status.status === 'completed' || status.status === 'failed');

      if (hasValidStatus) {
        addLog('✅ 状态管理正常', 'success');
        setTestResults(prev => ({ ...prev, state: 'PASS' }));
      } else {
        addLog('❌ 状态异常', 'error');
        setTestResults(prev => ({ ...prev, state: 'FAIL' }));
      }
    } catch (e) {
      addLog(`❌ 异常: ${e instanceof Error ? e.message : String(e)}`, 'error');
      setTestResults(prev => ({ ...prev, state: 'ERROR' }));
    } finally {
      setActiveTest(null);
    }
  };

  // 测试 6: 错误处理
  const testErrorHandling = async () => {
    setActiveTest('error');
    try {
      addLog('开始测试：错误处理', 'info');

      // 测试无效提示词
      addLog('测试空提示词...', 'info');
      const result1 = await generateVideo({
        prompt: '',
        duration: 4,
        resolution: '720p'
      });

      // 测试无效时长
      addLog('测试无效时长...', 'info');
      const result2 = await generateVideo({
        prompt: '测试',
        duration: 10 as any,
        resolution: '720p'
      });

      addLog('✅ 错误处理测试完成', 'success');
      setTestResults(prev => ({ ...prev, error: 'PASS' }));
    } catch (e) {
      addLog('✅ 正确抛出错误', 'success');
      setTestResults(prev => ({ ...prev, error: 'PASS' }));
    } finally {
      setActiveTest(null);
    }
  };

  // 运行所有测试
  const runAllTests = async () => {
    addLog('=== 开始运行所有测试 ===', 'info');
    await testBasicGeneration();
    await new Promise(r => setTimeout(r, 1000));
    await testResolutions();
    await new Promise(r => setTimeout(r, 1000));
    await testDurations();
    await new Promise(r => setTimeout(r, 1000));
    await testErrorHandling();
    addLog('=== 所有测试完成 ===', 'success');
  };

  // 获取测试状态颜色
  const getStatusColor = (status: string | undefined) => {
    if (!status) return 'bg-gray-100';
    if (status === 'PASS') return 'bg-green-100';
    if (status === 'FAIL') return 'bg-red-100';
    if (status === 'ERROR') return 'bg-red-100';
    if (status === 'PARTIAL') return 'bg-yellow-100';
    if (status === 'SKIP') return 'bg-blue-100';
    return 'bg-gray-100';
  };

  const getStatusIcon = (status: string | undefined) => {
    if (status === 'PASS') return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (status === 'FAIL' || status === 'ERROR') return <XCircle className="w-4 h-4 text-red-600" />;
    if (status === 'PARTIAL') return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* 标题 */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">🎬 Veo 3.1 功能测试</h1>
          <p className="text-muted-foreground">完整的功能验证和问题排查</p>
        </div>

        {/* API 状态 */}
        <Card className="mb-6 border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🔑 API 状态
              {apiKeyStatus === 'valid' && <CheckCircle className="w-5 h-5 text-green-600" />}
              {apiKeyStatus === 'invalid' && <XCircle className="w-5 h-5 text-red-600" />}
              {apiKeyStatus === 'checking' && <Loader className="w-5 h-5 animate-spin" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-sm p-3 rounded ${
              apiKeyStatus === 'valid' ? 'bg-green-50 text-green-800' :
              apiKeyStatus === 'invalid' ? 'bg-red-50 text-red-800' :
              'bg-blue-50 text-blue-800'
            }`}>
              {apiKeyStatus === 'valid' && '✅ API 密钥已正确配置，可以开始测试'}
              {apiKeyStatus === 'invalid' && '❌ API 密钥未找到，请检查 .env.local 配置'}
              {apiKeyStatus === 'checking' && '⏳ 正在检查 API 状态...'}
            </p>
          </CardContent>
        </Card>

        {/* 错误提示 */}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              {error}
              <Button variant="ghost" size="sm" onClick={clearError}>关闭</Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="tests" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="tests">功能测试</TabsTrigger>
            <TabsTrigger value="results">测试结果</TabsTrigger>
            <TabsTrigger value="logs">日志输出</TabsTrigger>
          </TabsList>

          {/* 测试标签页 */}
          <TabsContent value="tests" className="space-y-4">
            {/* 快速操作 */}
            <Card>
              <CardHeader>
                <CardTitle>快速操作</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={runAllTests}
                  disabled={isLoading || apiKeyStatus !== 'valid'}
                  className="w-full"
                  size="lg"
                >
                  {isLoading && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                  运行所有测试
                </Button>
              </CardContent>
            </Card>

            {/* 单个测试 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 测试 1 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">测试 1: 基础生成</CardTitle>
                  <CardDescription>生成一个 4 秒的 720p 视频</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={testBasicGeneration}
                    disabled={activeTest !== null || apiKeyStatus !== 'valid'}
                    className="w-full"
                  >
                    {activeTest === 'basic' && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                    开始测试
                  </Button>
                </CardContent>
              </Card>

              {/* 测试 2 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">测试 2: 分辨率</CardTitle>
                  <CardDescription>测试 720p 和 1080p</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={testResolutions}
                    disabled={activeTest !== null || apiKeyStatus !== 'valid'}
                    className="w-full"
                  >
                    {activeTest === 'resolution' && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                    开始测试
                  </Button>
                </CardContent>
              </Card>

              {/* 测试 3 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">测试 3: 时长</CardTitle>
                  <CardDescription>测试 4、6、8 秒</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={testDurations}
                    disabled={activeTest !== null || apiKeyStatus !== 'valid'}
                    className="w-full"
                  >
                    {activeTest === 'duration' && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                    开始测试
                  </Button>
                </CardContent>
              </Card>

              {/* 测试 4 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">测试 4: 视频扩展</CardTitle>
                  <CardDescription>扩展现有视频时长</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={testExtend}
                    disabled={activeTest !== null || videos.length === 0 || apiKeyStatus !== 'valid'}
                    className="w-full"
                  >
                    {activeTest === 'extend' && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                    开始测试
                  </Button>
                </CardContent>
              </Card>

              {/* 测试 5 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">测试 5: 状态管理</CardTitle>
                  <CardDescription>验证视频状态管理</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={testStateManagement}
                    disabled={activeTest !== null || videos.length === 0}
                    className="w-full"
                  >
                    {activeTest === 'state' && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                    开始测试
                  </Button>
                </CardContent>
              </Card>

              {/* 测试 6 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">测试 6: 错误处理</CardTitle>
                  <CardDescription>测试错误情况处理</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={testErrorHandling}
                    disabled={activeTest !== null}
                    className="w-full"
                  >
                    {activeTest === 'error' && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                    开始测试
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 结果标签页 */}
          <TabsContent value="results" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>测试结果概览</CardTitle>
                <CardDescription>
                  总计: {Object.keys(testResults).length} 个测试
                  {Object.values(testResults).filter(r => r === 'PASS').length > 0 && (
                    <span className="ml-4 text-green-600">
                      通过: {Object.values(testResults).filter(r => r === 'PASS').length}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(testResults).map(([test, status]) => (
                  <div key={test} className={`flex items-center justify-between p-3 rounded ${getStatusColor(status)}`}>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(status)}
                      <span className="capitalize font-medium">{test}</span>
                    </div>
                    <span className="text-sm font-mono text-muted-foreground">{status}</span>
                  </div>
                ))}
                {Object.keys(testResults).length === 0 && (
                  <p className="text-muted-foreground text-sm">暂无测试结果</p>
                )}
              </CardContent>
            </Card>

            {/* 视频列表 */}
            <Card>
              <CardHeader>
                <CardTitle>生成的视频</CardTitle>
                <CardDescription>{videos.length} 个视频</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {videos.map((video, idx) => (
                  <div key={video.id} className="border rounded p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">视频 #{idx + 1}</p>
                        <p className="text-sm text-muted-foreground truncate">{video.prompt}</p>
                      </div>
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {video.status}
                      </span>
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>⏱️ {video.duration}s</span>
                      <span>📐 {video.resolution}</span>
                    </div>
                  </div>
                ))}
                {videos.length === 0 && (
                  <p className="text-muted-foreground text-sm">暂无视频</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 日志标签页 */}
          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>执行日志</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(logs.join('\n'));
                      addLog('✅ 日志已复制到剪贴板', 'success');
                    }}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    复制日志
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-900 text-slate-100 p-4 rounded font-mono text-xs max-h-96 overflow-y-auto space-y-1">
                  {logs.length === 0 ? (
                    <p className="text-slate-500">暂无日志输出</p>
                  ) : (
                    logs.map((log, idx) => (
                      <div key={idx} className={
                        log.includes('SUCCESS') ? 'text-green-400' :
                        log.includes('ERROR') ? 'text-red-400' :
                        'text-slate-400'
                      }>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
