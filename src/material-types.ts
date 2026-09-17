export type Material = {
  id: string;
  courseId: number;
  path: string;
  title: string;
  sourceUrl: string;
  revision: string;
  contentRevision?: string;
  text?: string;
  downloadUrl?: string;
  size?: number;
};
export type MaterialCatalog = {
  notices?: string[];
  responses?: Record<string,{at:number;successfulAt?:number;value:any[];error?:string;notice?:boolean}>;
  checkedAt: string;
  resources: Material[];
  errors: string[];
};
export type MaterialReceipt = { revision: string; hash: string; path: string; title: string; sourceUrl: string; syncedAt: string };
