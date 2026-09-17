import test from 'node:test';import assert from 'node:assert/strict';
import {pageReference,boundedChatContext} from '../src/runtime/chat-context.ts';
test('chat carries page identity and filesystem pointers, never dashboard source dumps',()=>{
 const context=pageReference('https://canvas.invalid',{kind:'home',threadId:'home',title:'Home',href:'/'});
 const parsed=JSON.parse(context);
 assert.equal(parsed.materialRoot,'courses/');assert.equal(parsed.assignments,undefined);
 assert.ok(context.length<1000);
 const assignment=JSON.parse(pageReference('https://canvas.invalid',{kind:'assignment',threadId:'assignment:1:2',courseId:1,assignmentId:2,title:'Lab 2',href:'/courses/1/assignments/2'}));
 assert.equal(assignment.assignmentId,2);assert.equal(assignment.description,undefined);
 assert.ok(boundedChatContext('x'.repeat(200000)).length<100000);
});

test('source snapshot attributes assignment requirements, missing rubrics and endpoint failures',async()=>{
 const {materialSourceContext}=await import('../src/runtime/chat-context.ts');
 const key='/api/v1/courses/1/assignments?include[]=submission&per_page=100';
 const catalog={checkedAt:'2026-01-01',resources:[],errors:['Assignment refresh failed'],responses:{[key]:{at:200,successfulAt:100,error:'Canvas unavailable',value:[{id:2,html_url:'https://canvas.invalid/courses/1/assignments/2',description:'<p>Implement a parser</p>',rubric:[{description:'Tests',points:5}]}]}}};
 const context=JSON.parse(materialSourceContext(catalog,1,2));
 assert.equal(context.assignment.lastSuccessfulCheck,100);
 assert.match(context.assignment.descriptionHtml,/parser/);
 assert.match(context.assignment.rubric,/Tests/);
 assert.equal(context.checks[0].lastAttempt,200);
 assert.equal(context.checks[0].error,'Canvas unavailable');
 delete (catalog.responses[key].value[0] as any).rubric;
 assert.match(JSON.parse(materialSourceContext(catalog,1,2)).assignment.rubric,/Not returned/);
 assert.match(materialSourceContext(undefined,1,2),/not been collected/);
});
