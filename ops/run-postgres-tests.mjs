import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {S3Client,CreateBucketCommand} from '@aws-sdk/client-s3';
import {createPostgres} from '../postgres.mjs';
import {tables} from './migrate-storage.mjs';
const connection=process.env.ROAM_TEST_DATABASE_URL||'postgres://roamtest:local-test-only@127.0.0.1:5442/roamtest';
const url=new URL(connection);if(!['localhost','127.0.0.1','roam-test-postgres'].includes(url.hostname)||url.pathname!=='/roamtest')throw new Error('Only the disposable local roamtest database may be reset.');
process.env.NODE_ENV='test';const db=await createPostgres(connection);try{await db.exec(`TRUNCATE ${tables.join(',')} RESTART IDENTITY`);}finally{await db.close();}
const env={...process.env,NODE_ENV:'test',DATABASE_URL:connection};
if(process.argv.includes('--s3')){
 const endpoint=process.env.ROAM_TEST_S3_ENDPOINT||'http://127.0.0.1:9005',host=new URL(endpoint).hostname;
 if(!['localhost','127.0.0.1','roam-test-minio'].includes(host))throw new Error('Only isolated MinIO may be used by this test runner.');
 const bucket='roam-suite-'+randomUUID();const credentials={accessKeyId:'roam-local-test',secretAccessKey:'local-test-password-only'};
 const client=new S3Client({endpoint,region:'us-east-1',forcePathStyle:true,credentials});await client.send(new CreateBucketCommand({Bucket:bucket}));client.destroy();
 Object.assign(env,{S3_ENDPOINT:endpoint,S3_REGION:'us-east-1',S3_BUCKET:bucket,S3_FORCE_PATH_STYLE:'1',S3_ACCESS_KEY_ID:credentials.accessKeyId,S3_SECRET_ACCESS_KEY:credentials.secretAccessKey});
}
const child=spawn(process.execPath,['--test','--test-concurrency=1','test/*.test.mjs'],{env,stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1;});
