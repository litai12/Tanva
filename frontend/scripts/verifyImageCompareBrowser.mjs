import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.image-compare-smoke-${process.pid}`;
const files = [path.join(root, `${name}.html`), path.join(root, `${name}.tsx`)];
let server, browser;
try {
  await writeFile(files[0], `<div id="root"></div><script type="module" src="/${name}.tsx"></script>`);
  await writeFile(files[1], `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ImageCompareNode from './src/components/flow/nodes/ImageCompareNode';
import { useAIChatStore } from './src/stores/aiChatStore';
import './src/i18n';
const initial = [
{id:'one',type:'image',position:{x:0,y:0},data:{imageUrl:'/compare-one.svg',label:'First'}},
{id:'two',type:'image',position:{x:0,y:180},data:{imageUrl:'/compare-two.svg',label:'Second'}},
{id:'compare',type:'imageCompare',position:{x:300,y:60},selected:true,data:JSON.parse(localStorage.getItem('compare-smoke')||'null')||{compareMode:'side',splitPercent:50,overlayOpacity:50,boxW:480,boxH:320}}
];
const initialEdges = ['one','two'].map(id=>({id,source:id,target:'compare',sourceHandle:'img',targetHandle:'images'}));
const nodeTypes = {imageCompare:ImageCompareNode,image:()=> <div>Source</div>,imageSplit:()=> <div>Split source</div>};
function App(){
 const [nodes,setNodes]=React.useState(initial); const [edges,setEdges]=React.useState(initialEdges);
 React.useEffect(()=>{const handler=e=>setNodes(ns=>ns.map(n=>n.id===e.detail.id?{...n,data:{...n.data,...e.detail.patch}}:n));window.addEventListener('flow:updateNodeData',handler);return()=>window.removeEventListener('flow:updateNodeData',handler)},[]);
 React.useEffect(()=>{window.compareState={nodes,edges};localStorage.setItem('compare-smoke',JSON.stringify(nodes.find(n=>n.id==='compare').data))},[nodes,edges]);
 window.compareActions={update:(id,data)=>setNodes(ns=>ns.map(n=>n.id===id?{...n,data:{...n.data,...data}}:n)),disconnect:()=>setEdges([]),dark:()=>useAIChatStore.setState({chatTheme:'black'}),crop:()=>{setNodes(ns=>ns.map(n=>n.id==='one'?{...n,type:'imageSplit',data:{inputImageUrl:'/compare-crop.svg',sourceWidth:200,sourceHeight:100,splitRects:[{x:100,y:0,width:100,height:100}]}}:n));setEdges(es=>es.map(e=>e.source==='one'?{...e,sourceHandle:'image1'}:e));}};
 return <div style={{width:1100,height:650}}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes=>setNodes(ns=>applyNodeChanges(changes,ns))}/></div>
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5187, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  const errors = [];
  page.on('pageerror', error => {errors.push(error.message);console.error('Browser error:',error.message)});
  await page.route('**/api/**', route => route.fulfill({json:{}}));
  const fixtures = await page.evaluate(() => ['one','two','crop'].map(kind => {
    const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;
    const ctx=canvas.getContext('2d');ctx.fillStyle=kind==='two'?'blue':'red';ctx.fillRect(0,0,200,100);
    if(kind==='crop'){ctx.fillStyle='lime';ctx.fillRect(100,0,100,100)}
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.route('**/compare-*.svg', route => {
    const index=route.request().url().includes('-crop')?2:route.request().url().includes('-two')?1:0;
    return route.fulfill({contentType:'image/png',body:Buffer.from(fixtures[index],'base64')});
  });
  await page.goto(`http://127.0.0.1:5187/${name}.html`);
  const node = page.locator('.tanva-image-compare-node');
  await node.getByRole('tab', {name:/并排|Side by side/}).waitFor().catch(async error=>{console.error(await page.locator('body').innerText());await page.screenshot({path:'/tmp/tanva-compare-failure.png'});throw error});
  await page.waitForFunction(()=>document.querySelectorAll('.tanva-image-compare-node img').length===2 && [...document.querySelectorAll('.tanva-image-compare-node img')].every(img=>img.complete&&img.naturalWidth>0));
  assert.equal(await node.locator('img').count(),2);
  assert.equal(await node.locator('.react-flow__handle.source').count(),0);
  await node.getByRole('tab',{name:/滑动|Slide/}).click();
  const divider = node.getByRole('slider',{name:/分割位置|Split position/});
  await divider.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.compareState.nodes.find(n=>n.id==='compare').data.splitPercent===52);
  const stage = node.locator('.tanva-image-compare-node__stage--slider');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.5,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>Math.abs(window.compareState.nodes.find(n=>n.id==='compare').data.splitPercent-75)<2);
  assert.deepEqual(await page.evaluate(()=>window.compareState.nodes.find(n=>n.id==='compare').position),{x:300,y:60});
  await node.getByRole('tab',{name:/叠加|Overlay/}).click();
  const opacity = node.getByRole('slider',{name:/图 2 不透明度|Image 2 opacity/});
  await opacity.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.compareState.nodes.find(n=>n.id==='compare').data.overlayOpacity===1);
  await node.getByRole('tab',{name:/点按|Toggle/}).click();
  const toggle = node.locator('.tanva-image-compare-node__stage--toggle');
  const toggleBox=await toggle.boundingBox();
  await page.mouse.move(toggleBox.x+toggleBox.width/2,toggleBox.y+toggleBox.height/2);await page.mouse.down();
  assert.equal(await toggle.locator('img').nth(1).evaluate(el=>getComputedStyle(el).visibility),'visible');
  await page.mouse.up();
  assert.equal(await toggle.locator('img').nth(0).evaluate(el=>getComputedStyle(el).visibility),'visible');
  await node.getByRole('button',{name:/固定显示图 2|Pin image 2/}).click();
  assert.equal(await toggle.locator('img').nth(1).evaluate(el=>getComputedStyle(el).visibility),'visible');
  await page.evaluate(()=>window.compareActions.update('two',{imageUrl:'/compare-two-new.svg'}));
  await page.waitForFunction(()=>[...document.querySelectorAll('.tanva-image-compare-node img')].some(img=>img.src.includes('compare-two-new.svg')));
  await node.getByRole('tab',{name:/并排|Side by side/}).click();
  await page.evaluate(()=>window.compareActions.crop());
  await page.waitForFunction(()=>{const img=document.querySelector('.tanva-image-compare-node img');return img?.src.startsWith('blob:')&&img.complete&&img.naturalWidth===100});
  const pixel = await node.locator('img').first().evaluate(img=>{const c=document.createElement('canvas');c.width=100;c.height=100;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(50,50,1,1).data]});
  assert.deepEqual(pixel,[0,255,0,255]);
  const saved=await page.evaluate(()=>window.compareState.nodes.find(n=>n.id==='compare').data);
  assert.doesNotMatch(JSON.stringify(saved),/blob:|data:image|imageUrl|imageData/);
  await page.evaluate(()=>window.compareActions.dark());
  assert.equal(await node.evaluate(el=>getComputedStyle(el).getPropertyValue('--compare-bg').trim()),'#1c1c1c');
  await page.screenshot({path:'/tmp/tanva-image-compare-smoke.png'});
  await page.reload();
  await node.getByRole('tab',{name:/并排|Side by side/}).waitFor();
  assert.equal(await page.evaluate(()=>window.compareState.nodes.find(n=>n.id==='compare').data.splitPercent),saved.splitPercent);
  assert.equal(await page.evaluate(()=>window.compareState.nodes.find(n=>n.id==='compare').data.overlayOpacity),1);
  await page.evaluate(()=>window.compareActions.disconnect());
  await node.getByText(/把图片连到左侧输入端开始对比|Connect images to the left input to compare/).waitFor();
  assert.equal(await node.locator('img').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Image compare browser checks passed: modes, pointer/keyboard controls, upstream updates, crop pixels, theme, persistence and disconnect.');
} finally {
  await browser?.close(); await server?.close();
  await Promise.all(files.map(file=>unlink(file).catch(()=>{})));
}
