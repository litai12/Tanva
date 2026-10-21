import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.video-analysis-smoke-${process.pid}`;
const files = [path.join(root, `${name}.html`), path.join(root, `${name}.tsx`)];
let server, browser;
try {
  await writeFile(files[0], `<div id="root"></div><script type="module" src="/${name}.tsx"></script>`);
  await writeFile(files[1], `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow,applyNodeChanges} from '@xyflow/react';
import VideoAnalyzeNode from './src/components/flow/nodes/VideoAnalyzeNode';
import './src/i18n';
import '@xyflow/react/dist/style.css';
const nodeTypes={videoAnalyze:VideoAnalyzeNode,textPrompt:({data})=><pre>{data.text}</pre>};
function App(){
 const [nodes,setNodes]=React.useState(()=>JSON.parse(localStorage.getItem('analysis-smoke')||'null')||[{id:'analysis',type:'videoAnalyze',position:{x:20,y:20},data:{videoUrl:'https://example.test/video.mp4',analysisPrompt:'Produce a storyboard table with absolute timestamps.',status:'idle'}}]);
 const [edges,setEdges]=React.useState([]);
 React.useEffect(()=>{const f=e=>setNodes(ns=>ns.map(n=>n.id===e.detail.id?{...n,data:{...n.data,...e.detail.patch}}:n));window.addEventListener('flow:updateNodeData',f);return()=>window.removeEventListener('flow:updateNodeData',f)},[]);
 React.useEffect(()=>{window.analysisState={nodes,edges};localStorage.setItem('analysis-smoke',JSON.stringify(nodes))},[nodes,edges]);
 return <div style={{width:1200,height:900}}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={cs=>setNodes(ns=>applyNodeChanges(cs,ns))} onEdgesChange={()=>{}} /></div>
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  server = await createServer({ root, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:5192') }, server: { host: '127.0.0.1', port: 5192, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1250, height: 950 } });
  const errors = [], submissions = [], reads = [];
  let phase = 'processing', attempt = 1;
  const analysis = '| 镜号 | 时间 | 内容 |\n| --- | --- | --- |\n| 1 | 00:00–00:30 | First clip |\n| 2 | 00:30–01:00 | Second clip |\n| 3 | 01:00–01:12.585 | Last clip |';
  const receipt = (taskId) => ({ taskId, status: phase, stage: phase === 'processing' ? 'analyzing' : phase,
    progress: { completed: phase === 'succeeded' ? 3 : 1, total: 3 }, durationSec: 72.585, attempt,
    ...(phase === 'failed' ? { error: '第二段暂时失败，已完成片段已保存', partialAnalysis: 'First clip' } : {}),
    ...(phase === 'succeeded' ? { result: { analysis, model: 'doubao-seed-2-1-lite-260915', analysisMode: 'segmented_remote_input_video' } } : {}) });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://example.test/**', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/**', async route => {
    const req = route.request();
    if (req.url().endsWith('/video-analysis-tasks') && req.method() === 'POST') {
      const body = req.postDataJSON(); submissions.push(body);
      if (body.resumeTaskId) { attempt += 1; phase = 'processing'; }
      const taskId = body.resumeTaskId || `task-${submissions.length}`;
      await route.fulfill({ json: receipt(taskId) });
    } else if (req.url().includes('/video-analysis-tasks/')) {
      const id = req.url().split('/').at(-1); reads.push(id);
      await route.fulfill({ json: receipt(id) });
    } else await route.fulfill({ json: req.url().includes('/credits/preview') ? { credits: 908 } : {} });
  });
  await page.goto(`http://127.0.0.1:5192/${name}.html`);
  const node = page.locator('.react-flow__node-videoAnalyze');
  await node.locator('select').waitFor();
  assert.equal(await node.locator('select').inputValue(), 'doubao-seed-2-1-lite-260915');
  assert.match(await node.locator('select').innerText(), /Seed 2\.1 Turbo/);
  await node.locator('.tanva-video-analyze-run-btn').click();
  await page.waitForFunction(() => window.analysisState.nodes[0].data.analysisTaskId === 'task-1');
  await node.getByText(/已处理 1\/3 段|Processed 1\/3 clips/).waitFor();
  assert.equal(submissions.length, 1);
  await page.reload();
  await node.getByText(/已处理 1\/3 段|Processed 1\/3 clips/).waitFor();
  assert.equal(submissions.length, 1, 'reload must only query the original task');
  phase = 'failed';
  await node.getByRole('button', { name: /重试|Retry/ }).waitFor();
  await node.getByRole('button', { name: /重试|Retry/ }).click();
  await page.waitForFunction(() => window.analysisState.nodes[0].data.analysisTaskStatus === 'processing');
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].resumeTaskId, 'task-1');
  assert.equal(submissions[1].model, 'doubao-seed-2-1-lite-260915');
  phase = 'succeeded';
  await page.waitForFunction(() => window.analysisState.nodes[0].data.status === 'succeeded');
  await page.waitForFunction(() => window.analysisState.nodes.some(n => n.id === 'storyboard-prompt-analysis'));
  const outputs = await page.evaluate(() => window.analysisState.nodes.filter(n => n.id === 'storyboard-prompt-analysis'));
  assert.equal(outputs.length, 1); assert.equal(outputs[0].data.text, analysis);
  await page.screenshot({ path: '/tmp/tanva-video-analysis-smoke.png' });
  phase = 'processing';
  await node.getByRole('button', { name: /重新分析|Analyze again/ }).click();
  await page.waitForFunction(() => window.analysisState.nodes[0].data.analysisTaskId === 'task-3');
  assert.equal(submissions.length, 3); assert.equal(submissions[2].resumeTaskId, undefined);
  assert.notEqual(submissions[2].clientRequestId, submissions[1].clientRequestId);
  assert.ok(reads.length >= 3);
  assert.deepEqual(errors, []);
  console.log('Video analysis browser checks passed: Seed 2.1, one submission, progress, reload recovery, failed-clip resume, storyboard output, explicit new attempt.');
} finally {
  await browser?.close(); await server?.close();
  await Promise.all(files.map(file => unlink(file).catch(() => {})));
}
