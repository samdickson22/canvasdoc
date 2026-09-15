import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,parseSavedData} from '../src/storage/data.ts';
test('Canvas cache refresh preserves browser-owned tasks and model preferences',()=>{
 const original={...empty(),model:{id:'model-a'},tasks:[{id:'task',title:'Study',description:'',link:'',courseId:null,dueAt:null,completed:false,createdAt:new Date().toISOString()}]};
 const updated=mutate(original,{type:'canvas-cache',cache:{courses:[],todos:[],fetchedAt:new Date().toISOString()}});
 assert.deepEqual(updated.tasks,original.tasks);assert.deepEqual(updated.model,original.model);
 assert.deepEqual(parseSavedData(JSON.stringify(updated)).canvasCache,updated.canvasCache);
 const corrupt={...updated,canvasCache:{courses:null}};
 const restored=parseSavedData(JSON.stringify(corrupt));assert.equal(restored.canvasCache,undefined);assert.deepEqual(restored.tasks,original.tasks);
});
