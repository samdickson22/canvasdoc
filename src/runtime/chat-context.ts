import type {PageContext} from '../types.ts';
export function pageReference(origin:string,page:PageContext):string {
  return JSON.stringify({
    sourceUrl:new URL(page.href,origin).href,
    kind:page.kind,
    title:page.title.slice(0,500),
    courseId:page.courseId,
    assignmentId:page.assignmentId,
    materialRoot:'courses/',
    instructions:'Read and search the synced course indexes and source files in the workspace for context. Do not infer coursework content from this routing metadata.',
  });
}
export function boundedChatContext(value:string):string {
  if(value.length<=95000)return value;
  return value.slice(0,94500)+'\n[Canvas reference truncated to fit the message. Some source details are omitted; consult the synced source files before relying on them.]';
}
