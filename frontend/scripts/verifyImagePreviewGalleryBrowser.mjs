import assert from 'node:assert/strict';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Exercise production node entry points and the production Flow node wrapper.
// Only project nodes are persisted; history stays empty, as on another device.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.image-preview-gallery-${process.pid}`;
const html = path.join(root, `${name}.html`);
const tsx = path.join(root, `${name}.tsx`);
const modalSelector = '[data-image-preview-modal="true"]';
let server, browser, page;
try {
  await writeFile(html, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, applyNodeChanges } from '@xyflow/react';
import { guardFlowNodeTypes } from './src/components/flow/FlowNodeErrorBoundary';
import Nano2Node from './src/components/flow/nodes/Nano2Node';
import ImageNode from './src/components/flow/nodes/ImageNode';
import AnalyzeNode from './src/components/flow/nodes/AnalyzeNode';
import Generate4Node from './src/components/flow/nodes/Generate4Node';
import NodeGroupNode from './src/components/flow/nodes/NodeGroupNode';
import TextNoteNode from './src/components/flow/nodes/TextNoteNode';
import { useImageHistoryStore } from './src/stores/imageHistoryStore';
import { useProjectContentStore } from './src/stores/projectContentStore';
import './src/i18n';
import './src/index.css';
import '@xyflow/react/dist/style.css';
const asset = key => location.origin + '/gallery-fixture/' + key + '.svg';
const storageKey = 'preview-gallery-project';
useImageHistoryStore.setState({history: [], _hydrated: true});
useProjectContentStore.setState({projectId: 'gallery-reopened-project'});
const initialNodes = [
  {id:'gpt',type:'gptImage2',position:{x:30,y:90},data:{imageUrl:asset('gpt'),status:'succeeded',model:'gpt-image-2.5-flare',nodeConfigKey:'gptImage25',nodeConfigMetadata:{type:'gptImage2',flowNodeType:'gptImage2',model:'gpt-image-2.5-flare',showModelSelector:false},nodeConfigNameEn:'GPT Image 2.5',nodeConfigNameZh:'GPT Image 2.5'}},
  {id:'image',type:'image',position:{x:330,y:90},data:{imageUrl:asset('image'),imageName:'Uploaded reference',boxW:260,boxH:240}},
  {id:'nano',type:'nano2',position:{x:630,y:90},data:{imageUrl:asset('nano'),status:'succeeded',model:'gemini-nano-banana-2.1'}},
  {id:'text',type:'textNote',position:{x:930,y:90},data:{text:'This is text, never an image candidate',imageUrl:asset('text-impostor')}},
  {id:'analyze',type:'analysis',position:{x:1190,y:90},data:{status:'idle'}},
  {id:'group-a',type:'nodeGroup',position:{x:30,y:600},style:{width:600,height:330},zIndex:-1,data:{groupName:'Same group',childNodeIds:['group-a-image','group-a-peer']}},
  {id:'group-a-image',type:'nano2',position:{x:60,y:665},data:{imageUrl:asset('group-a-image'),status:'succeeded',model:'gemini-nano-banana-2.1'}},
  {id:'group-a-peer',type:'nano2',position:{x:345,y:665},data:{imageUrl:asset('group-a-peer'),status:'succeeded',model:'gemini-nano-banana-2.1'}},
  {id:'group-b',type:'nodeGroup',position:{x:665,y:600},style:{width:350,height:330},zIndex:-1,data:{groupName:'Other group',childNodeIds:['group-b-image']}},
  {id:'group-b-image',type:'nano2',position:{x:710,y:665},data:{imageUrl:asset('group-b-image'),status:'succeeded',model:'gemini-nano-banana-2.1'}},
  {id:'group-four',type:'nodeGroup',position:{x:1050,y:600},style:{width:350,height:470},zIndex:-1,data:{groupName:'Explicit four results',childNodeIds:['four']}},
  {id:'four',type:'generate4',position:{x:1090,y:660},data:{status:'succeeded',imageUrls:[0,1,2,3].map(n=>asset('four-'+n))}},
];
const nodeTypes = guardFlowNodeTypes({nano2:Nano2Node,gptImage2:Nano2Node,image:ImageNode,analysis:AnalyzeNode,generate4:Generate4Node,nodeGroup:NodeGroupNode,textNote:TextNoteNode});
const edges = [{id:'image-to-analysis',source:'image',sourceHandle:'img',target:'analyze',targetHandle:'img'}];
function App(){
  const [nodes,setNodes] = React.useState(()=>JSON.parse(localStorage.getItem(storageKey)||'null')||initialNodes);
  const patches = React.useRef([]);
  const executions = React.useRef([]);
  React.useEffect(()=>{
    const update = event => {
      patches.current.push(event.detail);
      setNodes(current=>current.map(node=>node.id===event.detail.id ? {...node,data:{...node.data,...event.detail.patch}} : node));
    };
    window.addEventListener('flow:updateNodeData',update);
    return ()=>window.removeEventListener('flow:updateNodeData',update);
  },[]);
  React.useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify(nodes));},[nodes]);
  window.gallerySmoke = {snapshot:()=>({historyCount:useImageHistoryStore.getState().history.length,images:nodes.map(({id,type,data})=>({id,type,imageUrl:data.imageUrl,imageData:data.imageData,imageUrls:data.imageUrls,images:data.images,crop:data.crop})),patches:[...patches.current],executions:[...executions.current]}),cropImage:()=>setNodes(current=>current.map(node=>node.id==='image' ? {...node,data:{...node.data,imageUrl:location.origin+'/gallery-fixture/crop.png',crop:{x:100,y:0,width:100,height:120,sourceWidth:1000,sourceHeight:650}}} : node))};
  const liveNodes = nodes.map(node=>({...node,data:{...node.data,onRun:id=>executions.current.push(id),onSend:id=>executions.current.push('send:'+id)}}));
  return <div style={{width:'100vw',height:'100vh',background:'#eef2f7'}}><ReactFlow nodes={liveNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes=>setNodes(current=>applyNodeChanges(changes,current))} nodesDraggable={false} zoomOnDoubleClick={false} defaultViewport={{x:0,y:0,zoom:1}}/><div style={{position:'fixed',top:12,left:30,fontFamily:'sans-serif',pointerEvents:'none'}}>Reopened project: actual GPT Image 2.5 / Nano2 / Image / Analyze nodes, empty image history</div></div>;
}
createRoot(document.getElementById('root')).render(<ReactFlowProvider><App/></ReactFlowProvider>);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  page = await browser.newPage({ viewport: { width: 1500, height: 1150 } });
  const errors = [];
  const generationRequests = [];
  let cropPng;
  page.on('pageerror', error => errors.push(error.message));
  const svgAsset = url => {
    const key = new URL(url).pathname.split('/').at(-1).replace('.svg','');
    const colors = {gpt:'#235b8a',image:'#547a51',nano:'#aa6e46','group-a-image':'#69559a','group-a-peer':'#ac5b84','group-b-image':'#bb4545'};
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="${colors[key]||'#468a94'}"/><circle cx="500" cy="325" r="215" fill="none" stroke="#dfecc7" stroke-width="12"/><text x="500" y="340" fill="white" font-family="sans-serif" font-size="62" text-anchor="middle">${key.toUpperCase()}</text></svg>`;
  };
  await page.route('**/gallery-fixture/*.svg', route => route.fulfill({contentType:'image/svg+xml',body:svgAsset(route.request().url())}));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const source = url.searchParams.get('url');
    if (url.pathname.endsWith('/assets/proxy') && source?.endsWith('/gallery-fixture/crop.png')) return route.fulfill({contentType:'image/png',body:cropPng});
    if (url.pathname.endsWith('/assets/proxy') && source?.includes('/gallery-fixture/')) return route.fulfill({contentType:'image/svg+xml',body:svgAsset(source)});
    if (/generate|image-tasks|generation-tasks/.test(url.pathname)) generationRequests.push({url:request.url(),method:request.method()});
    await route.fulfill({json:url.pathname.endsWith('/credits/preview') ? {credits:20} : {}});
  });
  const modal = page.locator(modalSelector);
  const image = modal.locator('.image-preview__image');
  const thumbs = modal.locator('.image-preview__thumb');
  const snapshot = () => page.evaluate(() => window.gallerySmoke.snapshot());
  const keys = () => thumbs.locator('img').evaluateAll(elements=>elements.map(el=>new URL(el.src).pathname.split('/').at(-1).replace('.svg','')));
  const current = () => image.evaluate(el=>new URL(el.src).pathname.split('/').at(-1).replace('.svg',''));
  const expectCurrent = async key => {
    await page.waitForFunction(({selector,key})=>{
      const el=document.querySelector(selector);
      return el instanceof HTMLImageElement && el.complete && el.naturalWidth>0 && new URL(el.src).pathname.endsWith('/'+key+'.svg');
    },{selector:modalSelector+' .image-preview__image',key});
    assert.equal(await current(),key);
    assert.equal(await thumbs.filter({has:page.locator(`img[src$="/${key}.svg"]`)}).getAttribute('aria-current'),'true','current asset has active thumbnail');
  };
  const open = async (id,key) => {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.locator('img').first().waitFor({state:'visible'});
    if (id === 'analyze') await node.locator('img').first().click();
    else await node.locator('img').first().dblclick();
    await modal.waitFor({state:'visible'});
    await expectCurrent(key);
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await modal.waitFor({state:'hidden'});
  };
  const assertUnchanged = async (before,label) => {
    const after = await snapshot();
    assert.deepEqual(after.images,before.images,`${label}: gallery browsing must not change node assets`);
    assert.deepEqual(after.patches,before.patches,`${label}: gallery browsing must not dispatch node mutations`);
    assert.deepEqual(after.executions,[],`${label}: gallery browsing must not execute or send nodes`);
    assert.deepEqual(generationRequests,[],`${label}: no generation API submissions`);
    assert.equal(after.historyCount,0,`${label}: candidates must come from project nodes, not image history`);
  };

  await page.goto(`${origin}/${name}.html`);
  await page.waitForFunction(()=>Boolean(window.gallerySmoke));
  await page.locator('.react-flow__node[data-id="nano"] img').waitFor();
  const initial = await snapshot();
  assert.equal(initial.historyCount,0,'project fixture opens with empty history');

  // GPT Image 2.5 and Nano2 mount the same production Nano2Node component.
  await open('gpt','gpt');
  assert.deepEqual(await keys(),['gpt','image','nano'],'root gallery includes same-level images in canvas order, excludes grouped images and non-image nodes');
  await thumbs.filter({has:page.locator('img[src$="/image.svg"]')}).click();
  await expectCurrent('image');
  await page.keyboard.press('ArrowRight');
  await expectCurrent('nano');
  await page.keyboard.press('ArrowRight');
  await expectCurrent('gpt');
  await page.keyboard.press('ArrowLeft');
  await expectCurrent('nano');
  await assertUnchanged(initial,'GPT thumbnail and keyboard navigation');
  await page.waitForTimeout(250); // Let the image/thumbnail opacity transition settle for the artifact.
  await page.screenshot({path:'/tmp/tanva-preview-gallery.png'});
  await close();
  await open('gpt','gpt');
  await close();

  // AnalyzeNode explicitly passes an empty collection. Its actual input image
  // button must still resolve the sibling gallery through the Flow wrapper.
  await open('analyze','image');
  assert.deepEqual(await keys(),['gpt','image','nano']);
  await page.keyboard.press('ArrowLeft');
  await expectCurrent('gpt');
  await close();
  await open('analyze','image');
  await close();
  await open('nano','nano');
  assert.deepEqual(await keys(),['gpt','image','nano']);
  await close();

  await open('group-a-image','group-a-image');
  assert.deepEqual(await keys(),['group-a-image','group-a-peer'],'Tanva childNodeIds grouping isolates siblings');
  await page.keyboard.press('ArrowRight');
  await expectCurrent('group-a-peer');
  await close();
  await open('group-b-image','group-b-image');
  assert.deepEqual(await keys(),['group-b-image'],'different group stays isolated');
  await close();

  // Four-result nodes own an explicit collection which the canvas fallback must preserve.
  await open('four','four-0');
  assert.deepEqual(await keys(),['four-0','four-1','four-2','four-3'],'explicit four-image collection survives Flow gallery integration');
  await page.keyboard.press('ArrowRight');
  await expectCurrent('four-1');
  await thumbs.nth(3).click();
  await expectCurrent('four-3');
  await close();
  await assertUnchanged(initial,'all node entry points');

  await page.reload();
  await page.waitForFunction(()=>Boolean(window.gallerySmoke));
  await page.locator('.react-flow__node[data-id="analyze"] img').waitFor();
  const restored = await snapshot();
  assert.equal(restored.historyCount,0,'reload restores project nodes without restoring runtime history');
  assert.deepEqual(restored.images,initial.images,'reload keeps every persisted project asset');
  await open('gpt','gpt');
  assert.deepEqual(await keys(),['gpt','image','nano'],'same-level candidates survive project reload');
  await close();
  await open('group-a-image','group-a-image');
  assert.deepEqual(await keys(),['group-a-image','group-a-peer'],'group gallery survives project reload');
  await close();
  await assertUnchanged(restored,'project reload');

  // The uploaded ImageNode displays this crop on canvas. Viewing/downloading
  // it as a sibling candidate must use that rendered crop rather than its source.
  // Chrome createImageBitmap does not decode SVG blobs, so use a lossless raster
  // of the same SVG for this production raster-crop path. Persist only its URL.
  cropPng = Buffer.from(await page.evaluate(async ()=>{
    const source = new Image();
    source.src=location.origin+'/gallery-fixture/image.svg';
    await source.decode();
    const canvas=document.createElement('canvas');
    canvas.width=source.naturalWidth;canvas.height=source.naturalHeight;
    canvas.getContext('2d').drawImage(source,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  await page.route('**/gallery-fixture/crop.png',route=>route.fulfill({contentType:'image/png',body:cropPng}));
  await page.evaluate(()=>window.gallerySmoke.cropImage());
  await page.waitForFunction(()=>window.gallerySmoke.snapshot().images.find(node=>node.id==='image')?.crop?.width===100);
  const cropped = await snapshot();
  await open('gpt','gpt');
  await thumbs.nth(1).click();
  await page.waitForFunction(selector=>{
    const el=document.querySelector(selector);
    return el instanceof HTMLImageElement && el.complete && el.naturalWidth===100 && el.naturalHeight===120 && el.src.startsWith('blob:');
  },modalSelector+' .image-preview__image');
  const downloadPromise = page.waitForEvent('download');
  await modal.getByRole('button',{name:/^(下载|Download)$/i}).click();
  const download = await downloadPromise;
  assert.equal(await download.failure(),null,'cropped candidate download succeeds');
  const png = await readFile(await download.path());
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10],'crop download is a real PNG');
  assert.equal(png.readUInt32BE(16),100,'download preserves rendered crop width');
  assert.equal(png.readUInt32BE(20),120,'download preserves rendered crop height');
  await close();
  await assertUnchanged(cropped,'cropped candidate preview and download');
  assert.deepEqual(errors,[],'no browser errors');
  console.log('PASS: real ReactFlow GPT Image 2.5/Nano2 double-click and Analyze input galleries with empty history; same-level order, group isolation, non-image exclusion, click/arrow navigation, no node mutation or generation, reopen reset, reload recovery, explicit four-result collection, and rendered ImageNode crop preview/download. All API calls mocked. Screenshot: /tmp/tanva-preview-gallery.png');
} catch (error) {
  await page?.screenshot({path:'/tmp/tanva-preview-gallery-failure.png'}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html,tsx].map(file=>unlink(file).catch(()=>{})));
}
