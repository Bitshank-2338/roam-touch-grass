import express from 'express';
import {fileURLToPath} from 'node:url';
import {hashToken,owns} from '../core.mjs';

export function createAIGateway({key=process.env.ROAM_AI_GATEWAY_KEY,fetcher=fetch,ollama='http://127.0.0.1:11434',shield='http://127.0.0.1:4191',shieldKey=process.env.SHIELDGEMMA_SERVICE_KEY||'',model=process.env.GEMMA_MODEL||'gemma3:4b'}={}){
 if(typeof key!=='string'||key.length<32)throw new Error('Set a private gateway key of at least 32 characters.');
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!owns(req.headers.authorization?.replace(/^Bearer /,''),hashToken(key)))return res.sendStatus(403);next();});
 app.use(express.json({limit:'24mb'}));
 app.use(async(req,res)=>{
  const routes={'GET /api/tags':[ollama,'/api/tags'],'POST /api/chat':[ollama,'/api/chat'],'GET /health':[shield,'/health'],'POST /classify':[shield,'/classify']};
  const route=routes[`${req.method} ${req.path}`];if(!route)return res.sendStatus(404);
  if(req.path==='/api/chat'&&(req.body.model!==model||req.body.stream!==false))return res.status(400).json({error:'Use the configured model with bounded non-streaming requests.'});
  try{
   const upstream=await fetcher(route.join(''),{method:req.method,headers:{'Content-Type':'application/json',...(route[0]===shield&&shieldKey?{Authorization:`Bearer ${shieldKey}`}:{})},...(req.method==='POST'?{body:JSON.stringify(req.body)}:{}),signal:AbortSignal.timeout(180000),redirect:'error'});
   if(!upstream.ok)return res.status(503).json({error:'The private model service is unavailable.'});
   let total=0;const chunks=[];for await(const chunk of upstream.body){total+=chunk.length;if(total>4*1024*1024)throw new Error('Response limit');chunks.push(chunk);}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));res.json(value);
  }catch{res.status(503).json({error:'The private model service did not return a valid response.'});}
 });return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url))createAIGateway().listen(Number(process.env.ROAM_AI_GATEWAY_PORT||4192),'127.0.0.1',()=>console.log('Private AI gateway is ready on loopback. Put an HTTPS proxy in front of it.'));
