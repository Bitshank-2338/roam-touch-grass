// Manual smoke check against the running local app and real Gemma; no posts created.
import sharp from 'sharp';
const photo=await sharp({create:{width:100,height:100,channels:3,background:'#416b48'}}).jpeg().toBuffer();
const body=new FormData();body.set('transcript','I visited Cubbon Park in Bengaluru. I spent 45 minutes walking with a friend. The entry was free. I recommend bringing a water bottle.');body.set('media',new Blob([photo],{type:'image/jpeg'}),'synthetic-test.jpg');
const response=await fetch('http://127.0.0.1:4180/api/story-draft',{method:'POST',body,signal:AbortSignal.timeout(160000)});
const result=await response.json();if(!response.ok||result.mediaAnalysed!=='photo'||!result.draft?.caption)throw new Error(JSON.stringify(result));console.log(JSON.stringify(result,null,2));
