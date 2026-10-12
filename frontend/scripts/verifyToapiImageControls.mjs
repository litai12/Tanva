import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.toapi-image-smoke-${process.pid}`;
const html = path.join(root, `${name}.html`);
const tsx = path.join(root, `${name}.tsx`);
let server, browser;
try {
  await writeFile(html, `<div id="root"></div><script type="module" src="/${name}.tsx"></script>`);
  await writeFile(tsx, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import Nano2Node from './src/components/flow/nodes/Nano2Node';
import { useAIChatStore } from './src/stores/aiChatStore';
import { getToapiImageSettings } from './src/services/toapiImageModels';
import { createImageGenerationTaskViaAPI } from './src/services/aiBackendAPI';
import { expandGptImageModelConfigs, expandNanoImageModelConfigs } from './src/services/gptImage25';
import './src/i18n';
const models = ['gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-2.5-flare-vip','gpt-image-2.5-sunburst-vip'];
const configs = [
{nodeKey:'gptImage25',nameZh:'GPT',nameEn:'GPT',category:'image',status:'normal',sortOrder:1,creditsPerCall:20,metadata:{type:'gptImage2',flowNodeType:'gptImage2',model:models[0],supportedModels:models,defaultData:{model:models[0]},showGoogleSearch:false,showGoogleImageSearch:false}},
{nodeKey:'nano2',nameZh:'Nano2',nameEn:'Nano2',category:'image',status:'normal',sortOrder:2,creditsPerCall:40,metadata:{type:'nano2',flowNodeType:'nano2',model:'gemini-3.1-flash-image-preview',supportedModels:['gemini-3.1-flash-image-preview','gemini-nano-banana-2.1'],defaultData:{model:'gemini-3.1-flash-image-preview'},resolutions:['0.5K','1K','2K','4K'],maxReferenceImages:14}}
];
const options = [...expandGptImageModelConfigs(configs),...expandNanoImageModelConfigs(configs)].map(c=>({model:c.metadata.model,nodeConfigKey:c.nodeKey,nodeConfigNameZh:c.nameZh,nodeConfigNameEn:c.nameEn,nodeConfigMetadata:c.metadata,creditsPerCall:c.creditsPerCall,enabled:true}));
useAIChatStore.setState({bananaImageRoute:'stable'});
function App(){
const [data,setData]=React.useState(()=>JSON.parse(localStorage.getItem('smoke-node')||'null')||{model:models[0],nodeConfigKey:'gptImage25',nodeConfigMetadata:configs[0].metadata,resolution:'1K',aspectRatio:'1:1',quality:'max',imageUrl:'https://example.com/result.png',selected:true});
React.useEffect(()=>{const f=(e)=>setData(d=>({...d,...e.detail.patch}));window.addEventListener('flow:updateNodeData',f);return()=>window.removeEventListener('flow:updateNodeData',f)},[]);
React.useEffect(()=>{localStorage.setItem('smoke-node',JSON.stringify(data));window.smokeNode=data},[data]);
const activeOptions=options.filter(o=>o.nodeConfigKey===data.nodeConfigKey);
return <ReactFlowProvider><div style={{width:360,padding:10}}><button id="nano" onClick={()=>setData(d=>({...d,model:'gemini-3.1-flash-image-preview',nodeConfigKey:'nano2',nodeConfigMetadata:configs[1].metadata}))}>Nano node</button><Nano2Node id="existing" selected data={{...data,gptImageModelOptions:activeOptions,onRun:()=>createImageGenerationTaskViaAPI({prompt:'mock generation only',aiProvider:'nano2',...getToapiImageSettings(data.model,data.resolution,data.quality,data.aspectRatio)})}}/></div></ReactFlowProvider>
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5179, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('Browser error:', error.message));
  const requests = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/credits/preview')) {
      requests.push({ type: 'preview', body: request.postDataJSON() });
      await route.fulfill({ json: { credits: 60 }, headers: { 'Access-Control-Allow-Origin': '*' } });
    } else if (request.url().endsWith('/generate-image-async')) {
      requests.push({ type: 'execute', body: request.postDataJSON(), route: request.headers()['x-banana-image-route'] });
      await route.fulfill({ json: { taskId: 'mock-task', status: 'queued' }, headers: { 'Access-Control-Allow-Origin': '*' } });
    } else await route.fulfill({ json: {}, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto(`http://127.0.0.1:5179/${name}.html`);
  await page.getByTitle(/选择图片模型|Select image model/).waitFor();
  for (const model of ['gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip']) {
    await page.getByTitle(/选择图片模型|Select image model/).click();
    await page.getByText(model, { exact: true }).click();
    await page.getByTitle(/选择图片质量|Select image quality/).click();
    await page.getByRole('button', { name: 'xhigh', exact: true }).click();
    await page.getByTitle(/选择分辨率|Select resolution/).click();
    await page.getByRole('button', { name: '2K', exact: true }).click();
    await page.waitForFunction(model => window.smokeNode.model === model && window.smokeNode.quality === 'xhigh' && window.smokeNode.resolution === '2K', model);
    await page.waitForTimeout(500);
    const preview = requests.filter(r=>r.type==='preview' && r.body.model===model).at(-1);
    assert.equal(preview.body.requestParams.quality,'xhigh');
    assert.equal(preview.body.requestParams.imageSize,'2K');
    assert.equal(preview.body.requestParams.providerOptions.banana.imageRoute,'normal');
    await page.locator('.run-btn-with-credit').click();
    await page.waitForTimeout(300);
    const execution = requests.filter(r=>r.type==='execute' && r.body.model===model).at(-1);
    assert.equal(execution.body.quality,'xhigh');
    assert.equal(execution.body.imageSize,'2K');
    assert.equal(execution.route,'normal');
  }
  await page.locator('#nano').click();
  await page.getByTitle(/选择图片模型|Select image model/).click();
  await page.getByText('Nano Banana 2.1', { exact: true }).click();
  await page.waitForFunction(()=>window.smokeNode.model==='gemini-nano-banana-2.1');
  await page.reload();
  await page.getByTitle(/选择图片模型|Select image model/).waitFor();
  const restored = await page.evaluate(()=>window.smokeNode);
  assert.equal(restored.model,'gemini-nano-banana-2.1');
  assert.equal(restored.imageUrl,'https://example.com/result.png');
  assert.equal(restored.selected,true);
  assert.equal(restored.resolution,'1K');
  await page.getByTitle(/选择分辨率|Select resolution/).click();
  assert.equal(await page.getByRole('button', { name: /^0\.5K/ }).count(),0);
  await page.getByRole('button', { name: '4K', exact: true }).click();
  await page.locator('.run-btn-with-credit').click();
  await page.waitForTimeout(300);
  const nano = requests.filter(r=>r.type==='execute' && r.body.model==='gemini-nano-banana-2.1').at(-1);
  assert.equal(nano.body.imageSize,'4K');
  assert.equal(nano.route,'normal');
  assert.equal(nano.body.quality,undefined);
  console.log('PASS: real Nano2Node selectors, VIP xhigh/2K preview + mocked API submission; Nano2.1 switch + reload + 4K submission; previous result/selection preserved. No paid requests.');
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html,tsx].map(file=>unlink(file).catch(()=>{})));
}
