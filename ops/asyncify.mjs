// Build-time helper for adapting the fixed SQLite implementation to async queries.
// Generated output is ordinary source: no runtime code generation.
import {parse} from 'acorn';
export function asyncify(source,{database=false,names=[]}={}){
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[],functions=new Set(),calls=[];
 const functionTypes=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
 function visit(node,ancestors=[]){
  if(!node||typeof node!=='object')return;
  if(node.type==='CallExpression'){
   const callee=source.slice(node.callee.start,node.callee.end);
   if((database&&/^db\.(exec|prepare\([\s\S]*\)\.(get|all|run))$/.test(callee))||names.includes(callee)){
    calls.push(node);const owner=[...ancestors].reverse().find(x=>functionTypes.has(x.type));if(owner)functions.add(owner);
   }
  }
  for(const [key,value]of Object.entries(node)){if(['start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(x=>visit(x,[...ancestors,node]));else if(value&&typeof value==='object')visit(value,[...ancestors,node]);}
 }
 visit(tree);
 for(const node of calls){edits.push([node.start,'(await '],[node.end,')']);}
 for(const node of functions)if(!node.async)edits.push([node.start,'async ']);
 // All async array mappings are awaited together, never returned as promises.
 function mapVisit(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='map'&&functions.has(node.arguments[0]))edits.push([node.start,'(await Promise.all('],[node.end,'))']);for(const v of Object.values(node))if(Array.isArray(v))v.forEach(mapVisit);else if(v&&typeof v==='object')mapVisit(v);}
 mapVisit(tree);
 edits.sort((a,b)=>b[0]-a[0]);for(const [at,text]of edits)source=source.slice(0,at)+text+source.slice(at);return source;
}
