import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';

const valid=name=>{if(!/^[a-zA-Z0-9-]+\.(webp|mp4|webm)$/.test(name))throw new Error('Invalid media filename.');return name;};
export function createMediaStore({dataDir,bucket=process.env.S3_BUCKET,client}={}){
 if(bucket){
  client||=new S3Client({region:process.env.S3_REGION||'us-east-1',endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='1',credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
  const key=name=>`quarantine/${valid(name)}`;
  return {kind:'s3',put:async(name,bytes)=>{await client.send(new PutObjectCommand({Bucket:bucket,Key:key(name),Body:bytes,ContentType:'image/webp'}));},get:async name=>{const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key(name)}));return Buffer.from(await response.Body.transformToByteArray());},remove:async name=>{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key(name)}));}};
 }
 return {kind:'local',put:async(name,bytes)=>{await mkdir(path.join(dataDir,'quarantine'),{recursive:true});await writeFile(path.join(dataDir,'quarantine',valid(name)),bytes);},get:async name=>{valid(name);try{return await readFile(path.join(dataDir,'quarantine',name));}catch(error){if(error.code!=='ENOENT')throw error;return readFile(path.join(dataDir,'uploads',name));}},remove:async name=>{for(const dir of ['quarantine','uploads'])try{await unlink(path.join(dataDir,dir,valid(name)));}catch(error){if(error.code!=='ENOENT')throw error;}}};
}
