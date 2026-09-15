export type Material = {
  id: string;
  courseId: number;
  path: string;
  title: string;
  sourceUrl: string;
  revision: string;
  text?: string;
  downloadUrl?: string;
  size?: number;
};
export type MaterialCatalog = {
  responses?: Record<string,{at:number;value:any[];error?:string}>;
  checkedAt: string;
  resources: Material[];
  errors: string[];
};
export type MaterialReceipt = { revision: string; hash: string; path: string; title: string; sourceUrl: string; syncedAt: string };
