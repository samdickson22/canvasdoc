import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MaterialMirror } from "../companion/materials.ts";
const account="canvasdoc:v1:https://canvas.invalid:2";
const material={id:"1:assignment:2",courseId:1,path:"course-1/assignments/2/sources/assignment.md",title:"Lab",sourceUrl:"https://canvas.invalid/courses/1/assignments/2",revision:"v1"};
async function put(mirror:MaterialMirror, text:string, metadata=material, scope=account){
  const bytes=Buffer.from(text),hash=createHash("sha256").update(bytes).digest("hex");
  const {transferId}=await mirror.handle({account:scope,op:"begin",material:metadata}) as any;
  await mirror.handle({account:scope,op:"chunk",transferId,offset:0,base64:bytes.toString("base64")});
  return await mirror.handle({account:scope,op:"commit",transferId,size:bytes.length,hash}) as any;
}
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),"canvasdoc-materials-"));return {root,mirror:new MaterialMirror(root)}}
test("materials persist across restart, update incrementally, and retain local edits",async()=>{
 const {root,mirror}=await fixture();try{
  const first=await put(mirror,"First instructions");
  assert.equal(await readFile(path.join(root,first.path),"utf8"),"First instructions");
  const restarted=new MaterialMirror(root);
  assert.equal((await restarted.handle({account,op:"manifest"}) as any).receipts[material.id].revision,"v1");
  await put(restarted,"Updated instructions",{...material,revision:"v2"});
  await writeFile(path.join(root,first.path),"User edits");
  assert.equal((await restarted.handle({account,op:"manifest"}) as any).receipts[material.id],undefined);
  await assert.rejects(put(restarted,"Next instructions",{...material,revision:"v3"}),/Local edits preserved/);
  assert.equal(await readFile(path.join(root,first.path),"utf8"),"User edits");
 }finally{await rm(root,{recursive:true,force:true})}
});
test("sync rejects work folders, traversal, symlinks, and corrupt transfers",async()=>{
 const {root,mirror}=await fixture();try{
  for(const relative of ["course-1/assignments/2/work/draft.md","course-1/materials/../../escape.md"])
   await assert.rejects(mirror.handle({account,op:"begin",material:{...material,path:relative}}));
  const {directory}=await mirror.handle({account,op:"manifest"}) as any;
  await mkdir(path.join(root,directory),{recursive:true});
  await symlink(os.tmpdir(),path.join(root,directory,"course-1"));
  await assert.rejects(put(mirror,"unsafe"),/symlink/);
  const metadata={...material,courseId:2,path:"course-2/materials/file.txt"};
  const {transferId}=await mirror.handle({account,op:"begin",material:metadata}) as any;
  await assert.rejects(mirror.handle({account,op:"chunk",transferId,offset:5,base64:"YQ=="}),/chunk/);
  await assert.rejects(mirror.handle({account,op:"commit",transferId,size:0,hash:"incorrect"}),/verification/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test("different Canvas accounts never share course material paths",async()=>{
 const {root,mirror}=await fixture();try{
  const a=await put(mirror,"Account A"),b=await put(mirror,"Account B",material,account+"other");
  assert.notEqual(a.path,b.path);
  assert.equal(await readFile(path.join(root,a.path),"utf8"),"Account A");
 }finally{await rm(root,{recursive:true,force:true})}
});

test("renaming a synced source removes only its unchanged old copy",async()=>{
 const {root,mirror}=await fixture();try{
  const old=await put(mirror,"Original");
  const next=await put(mirror,"Original",{...material,path:"Programming--1/assignments/Lab--2/sources/assignment.md"});
  assert.notEqual(old.path,next.path);
  await assert.rejects(readFile(path.join(root,old.path)),{code:"ENOENT"});
  await writeFile(path.join(root,next.path),"Student edit");
  const renamed=await put(mirror,"Fresh source",{...material,path:"Programming--1/assignments/Calculator--2/sources/assignment.md",revision:"v2"});
  assert.equal(await readFile(path.join(root,next.path),"utf8"),"Student edit");
  assert.equal(await readFile(path.join(root,renamed.path),"utf8"),"Fresh source");
 }finally{await rm(root,{recursive:true,force:true})}
});
