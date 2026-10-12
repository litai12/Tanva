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
import GenerateNode from './src/components/flow/nodes/GenerateNode';
import { useAIChatStore } from './src/stores/aiChatStore';
import { getToapiImageSettings, resolveNanoImageModelForRoute, isToapiImageModel } from './src/services/toapiImageModels';
import { createImageGenerationTaskViaAPI, generateImageViaAPI } from './src/services/aiBackendAPI';
import { expandGptImageModelConfigs, expandNanoImageModelConfigs } from './src/services/gptImage25';
import './src/i18n';
const models = ['gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-2.5-flare-vip','gpt-image-2.5-sunburst-vip'];
const configs = [
{nodeKey:'gptImage25',nameZh:'GPT',nameEn:'GPT',category:'image',status:'normal',sortOrder:1,creditsPerCall:20,metadata:{type:'gptImage2',flowNodeType:'gptImage2',model:models[0],supportedModels:models,defaultData:{model:models[0]},showGoogleSearch:false,showGoogleImageSearch:false}},
{nodeKey:'nano2',nameZh:'Nano Banana 2.1',nameEn:'Nano Banana 2.1',category:'image',status:'normal',sortOrder:2,creditsPerCall:20,metadata:{type:'nano2',flowNodeType:'nano2',model:'gemini-nano-banana-2.1',managedModelKey:'gemini-nano-banana-2.1',showModelSelector:false,supportedModels:['gemini-3.1-flash-image-preview','gemini-nano-banana-2.1','gemini-nano-banana-2.1-official'],defaultData:{model:'gemini-nano-banana-2.1',managedModelKey:'gemini-nano-banana-2.1',resolution:'1K'},resolutions:['1K','2K','4K'],maxReferenceImages:14}}
];
const options = [...expandGptImageModelConfigs(configs),...expandNanoImageModelConfigs(configs)].map(c=>({model:c.metadata.model,nodeConfigKey:c.nodeKey,nodeConfigNameZh:c.nameZh,nodeConfigNameEn:c.nameEn,nodeConfigMetadata:c.metadata,creditsPerCall:c.creditsPerCall,enabled:true}));
useAIChatStore.setState({bananaImageRoute:'stable'});
function App(){
const [officialEnabled,setOfficialEnabled]=React.useState(true);
const [generateData,setGenerateData]=React.useState({modelProvider:'banana'});
React.useEffect(()=>{window.smokeGenerate=generateData},[generateData]);
const [data,setData]=React.useState(()=>JSON.parse(localStorage.getItem('smoke-node')||'null')||{model:models[0],nodeConfigKey:'gptImage25',nodeConfigMetadata:configs[0].metadata,resolution:'1K',aspectRatio:'1:1',quality:'max',imageUrl:'https://example.com/result.png',selected:true});
React.useEffect(()=>{const f=(e)=>e.detail.id==='generate' ? setGenerateData(d=>({...d,...e.detail.patch})) : setData(d=>({...d,...e.detail.patch}));window.addEventListener('flow:updateNodeData',f);return()=>window.removeEventListener('flow:updateNodeData',f)},[]);
React.useEffect(()=>{localStorage.setItem('smoke-node',JSON.stringify(data));window.smokeNode=data},[data]);
const activeOptions=options.filter(o=>o.nodeConfigKey===data.nodeConfigKey).map(o=>o.model==='gemini-nano-banana-2.1-official' ? {...o,enabled:officialEnabled} : o);
return <ReactFlowProvider><div style={{display:'flex',gap:20}}><div id="imageNode" style={{width:360,padding:10}}><button id="disableOfficial" onClick={()=>setOfficialEnabled(false)}>Disable official</button><button id="normal" onClick={()=>useAIChatStore.setState({bananaImageRoute:'normal'})}>Normal route</button><button id="stable" onClick={()=>useAIChatStore.setState({bananaImageRoute:'stable'})}>Stable route</button><button id="nano" onClick={()=>setData(d=>({...d,...configs[1].metadata.defaultData,nodeConfigKey:'nano2',nodeConfigNameZh:configs[1].nameZh,nodeConfigNameEn:configs[1].nameEn,nodeConfigMetadata:configs[1].metadata}))}>New independent 2.1</button><button id="legacy" onClick={()=>setData(d=>({...d,model:undefined,managedModelKey:undefined,nodeConfigKey:'nano2',nodeConfigNameZh:'Nano Banana 2',nodeConfigNameEn:'Nano Banana 2',nodeConfigMetadata:configs[1].metadata,gptImageModelOptions:[]}))}>Old missing model</button><Nano2Node id="existing" selected data={{...data,gptImageModelOptions:data.model===undefined ? [] : activeOptions,onRun:()=>{const model=data.nodeConfigKey==='nano2' ? resolveNanoImageModelForRoute(data.model,useAIChatStore.getState().bananaImageRoute) : data.model;const payload={prompt:'mock generation only',aiProvider:'nano2',...(isToapiImageModel(model) ? getToapiImageSettings(model,data.resolution,data.quality,data.aspectRatio) : {model,managedModelKey:'gemini-3.1-image',imageSize:data.resolution,aspectRatio:data.aspectRatio,providerOptions:{banana:{imageRoute:useAIChatStore.getState().bananaImageRoute}}})};return data.nodeConfigKey==='nano2' ? generateImageViaAPI(payload) : createImageGenerationTaskViaAPI(payload)}}}/></div><div id="generateNode"><GenerateNode id="generate" data={generateData}/></div></div></ReactFlowProvider>
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
      const body = request.postDataJSON();
      const resolution = body.requestParams.imageSize || '1K';
      const credits = body.model === 'gemini-nano-banana-2.1-official' ? { '1K':30,'2K':60,'4K':90 }[resolution] : body.model === 'gemini-nano-banana-2.1' ? { '1K':20,'2K':30,'4K':40 }[resolution] : 100;
      await route.fulfill({ json: { credits }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5179', 'Access-Control-Allow-Credentials': 'true' } });
    } else if (request.url().endsWith('/generate-image-async') || request.url().endsWith('/generate-image')) {
      requests.push({ type: 'execute', body: request.postDataJSON(), route: request.headers()['x-banana-image-route'] });
      await route.fulfill({ json: request.url().endsWith('/generate-image') ? { imageUrl: 'https://example.com/mocked-result.png' } : { taskId: 'mock-task', status: 'queued' }, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5179', 'Access-Control-Allow-Credentials': 'true' } });
    } else await route.fulfill({ json: {}, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5179', 'Access-Control-Allow-Credentials': 'true' } });
  });
  await page.goto(`http://127.0.0.1:5179/${name}.html`);
  await page.getByTitle(/选择图片模型|Select image model/).waitFor();
  for (const model of ['gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip']) {
    await page.getByTitle(/选择图片模型|Select image model/).click();
    await page.getByText(model, { exact: true }).click();
    await page.getByTitle(/选择图片质量|Select image quality/).click();
    await page.getByRole('button', { name: 'xhigh', exact: true }).click();
    await page.locator("#imageNode").getByTitle(/选择分辨率|Select resolution/).click();
    await page.locator('#imageNode').getByRole('button', { name: '2K', exact: true }).click();
    await page.waitForFunction(model => window.smokeNode.model === model && window.smokeNode.quality === 'xhigh' && window.smokeNode.resolution === '2K', model);
    await page.waitForTimeout(500);
    const preview = requests.filter(r=>r.type==='preview' && r.body.model===model).at(-1);
    assert.equal(preview.body.requestParams.quality,'xhigh');
    assert.equal(preview.body.requestParams.imageSize,'2K');
    assert.equal(preview.body.requestParams.providerOptions.banana.imageRoute,'normal');
    await page.locator('#imageNode .run-btn-with-credit').click();
    await page.waitForTimeout(300);
    const execution = requests.filter(r=>r.type==='execute' && r.body.model===model).at(-1);
    assert.equal(execution.body.quality,'xhigh');
    assert.equal(execution.body.imageSize,'2K');
    assert.equal(execution.route,'normal');
  }
  await page.locator('#nano').click();
  await page.locator('#imageNode .tanva-flow-node-title').filter({hasText:'Nano Banana 2.1'}).waitFor();
  assert.equal(await page.getByTitle(/选择图片模型|Select image model/).count(),0);
  await page.waitForFunction(()=>window.smokeNode.model==='gemini-nano-banana-2.1');
  await page.reload();
  await page.locator('#imageNode .tanva-flow-node-title').filter({hasText:'Nano Banana 2.1'}).waitFor();
  assert.equal(await page.getByTitle(/选择图片模型|Select image model/).count(),0);
  const restored = await page.evaluate(()=>window.smokeNode);
  assert.equal(restored.model,'gemini-nano-banana-2.1');
  assert.equal(restored.imageUrl,'https://example.com/result.png');
  assert.equal(restored.selected,true);
  assert.equal(restored.resolution,'1K');
  await page.locator("#imageNode").getByTitle(/选择分辨率|Select resolution/).click();
  assert.equal(await page.getByRole('button', { name: /^0\.5K/ }).count(),0);
  await page.locator('#imageNode').getByRole('button', { name: '4K', exact: true }).click();
  await page.locator('#imageNode .run-btn-with-credit').click();
  await page.waitForTimeout(300);
  let nano = requests.filter(r=>r.type==='execute' && r.body.model==='gemini-nano-banana-2.1-official').at(-1);
  assert.equal(nano.body.imageSize,'4K');
  assert.equal(nano.route,'stable');
  assert.equal(nano.body.quality,undefined);
  await page.waitForTimeout(500);
  const premiumQuote=requests.filter(r=>r.type==='preview' && r.body.model==='gemini-nano-banana-2.1-official').at(-1);
  assert.equal(premiumQuote.body.requestParams.imageSize,'4K');
  assert.equal(premiumQuote.body.requestParams.managedModelKey,'gemini-nano-banana-2.1-official');
  await page.waitForFunction(()=>document.querySelector('#imageNode .run-credit-badge')?.textContent?.includes('90'));
  await page.locator('#normal').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.smokeNode.model),'gemini-nano-banana-2.1');
  assert.equal(await page.evaluate(()=>window.smokeNode.imageUrl),'https://example.com/result.png');
  await page.locator('#imageNode .run-btn-with-credit').click();
  await page.waitForTimeout(300);
  nano=requests.filter(r=>r.type==='execute').at(-1);
  assert.equal(nano.body.model,'gemini-nano-banana-2.1');
  assert.equal(nano.route,'normal');
  await page.waitForFunction(()=>document.querySelector('#imageNode .run-credit-badge')?.textContent?.includes('40'));
  await page.locator('#stable').click();
  await page.locator('#disableOfficial').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#imageNode .run-btn-with-credit').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.smokeNode.model),'gemini-nano-banana-2.1');
  await page.locator('#legacy').click();
  await page.locator('#imageNode .tanva-flow-node-title').filter({hasText:/^Nano Banana 2$/}).waitFor();
  assert.equal(await page.getByTitle(/选择图片模型|Select image model/).count(),0);
  assert.equal(await page.locator('#imageNode .run-btn-with-credit').isEnabled(),true);
  await page.locator('#imageNode .run-btn-with-credit').click();
  await page.waitForTimeout(300);
  assert.equal(requests.filter(r=>r.type==='execute').at(-1).body.model,'gemini-3.1-flash-image-preview');
  assert.equal(requests.filter(r=>r.type==='execute').at(-1).route,'stable');
  assert.equal(await page.evaluate(()=>window.smokeNode.model),undefined);
  await page.locator('#generateNode').getByTitle(/切换模型模式|Switch model mode/).click();
  await page.locator('#generateNode').getByText('Nano Banana 2/Gemini 3.1', {exact:true}).click();
  await page.waitForFunction(()=>window.smokeGenerate.modelProvider==='banana-3.1');
  console.log('PASS: VIP controls; independent Nano2.1 has no model selector, reload persists logical identity, sync 4K preview/submission follow normal/official routes without replacing results; legacy Nano2 remains runnable; Generate Nano2 unchanged. All API calls mocked.');
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html,tsx].map(file=>unlink(file).catch(()=>{})));
}
