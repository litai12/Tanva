const fs=require('fs'),jwt=require('jsonwebtoken'),WebSocket=require('ws');
const s=(fs.readFileSync('/Users/libiqiang/business/Tanva/backend/.env','utf8').match(/^JWT_ACCESS_SECRET=(.*)$/m)?.[1]||'').replace(/^["']|["']$/g,'').trim();
const T='0105f4b5-29f2-4575-b119-6a748b9082e7',P='957bf782-272d-4abc-8b43-cea19deb23d7',B='415583cc-69b9-443f-aeae-e531236f7a1d';
const tok=jwt.sign({sub:B,name:'UserB',role:'user'},s,{algorithm:'HS256',expiresIn:'1h'});
const ws=new WebSocket(`ws://localhost:4000/ws/collab?token=${tok}&teamId=${T}&projectId=${P}`);
ws.on('open',()=>console.log('B open'));
ws.on('message',raw=>{let e;try{e=JSON.parse(raw.toString());}catch{return;}
 if(e.type==='connected')console.log('B connected', e.payload?.connId?.slice(0,8));
 else if(e.type==='node_patch'){const u=(e.payload.upsertNodes||[])[0];const r=(e.payload.removeNodeIds||[]);console.log(new Date().toISOString().slice(11,23),'node_patch', u?`up id=${u.id} pos=${JSON.stringify(u.position)}`:(r.length?'rm '+r.join(','):JSON.stringify(e.payload).slice(0,80)));}});
ws.on('error',e=>console.error('B err',e.message));
ws.on('close',()=>console.log('B closed'));
setTimeout(()=>process.exit(0),180000);
