import {describe,it,expect} from 'vitest';
import {createCapturedTaskDeclarationAccumulator} from '../../../src/runtime/task-host/captured-task-declarations.js';
describe('current TaskHost event capture compatibility',()=>{
 it('captures execution-started from the current producer contract as a task reference',()=>{
  const capture=createCapturedTaskDeclarationAccumulator();
  capture.capture({events:[{type:'task_execution_started',taskId:'actual-task'}]},'snapshot');
  expect(capture.finish('actual-task',[]).references).toContainEqual({namespace:'task',relation:'snapshot.events[0].taskId',id:'actual-task'});
 });
 it.each([{}, {taskId:''}, {taskId:4}, {taskId:'bad\u0000id'}, {taskId:'actual-task',unexpected:true}])('rejects malformed execution-started payload %#',payload=>{
  const capture=createCapturedTaskDeclarationAccumulator();
  expect(()=>capture.capture({events:[{type:'task_execution_started',...payload}]},'snapshot')).toThrow('captured_task_declaration');
 });
 it.each(['unknown_task_event','toString','constructor'])('keeps unknown/inherited event %s closed',type=>{
  expect(()=>createCapturedTaskDeclarationAccumulator().capture({events:[{type,taskId:'actual-task'}]},'snapshot')).toThrow('captured_task_declaration');
 });
});
