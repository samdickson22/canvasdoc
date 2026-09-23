export type FileTabs = { paths: string[]; selected: string | null };
export type FileTabAction =
  { type: "open"; path: string } | { type: "close"; path: string };
export function fileTabs(state: FileTabs, action: FileTabAction): FileTabs {
  if (action.type === "open")
    return {
      paths: state.paths.includes(action.path)
        ? state.paths
        : [...state.paths, action.path],
      selected: action.path,
    };
  const index = state.paths.indexOf(action.path);
  const paths = state.paths.filter((path) => path !== action.path);
  return {
    paths,
    selected:
      state.selected === action.path
        ? (paths[Math.min(index, paths.length - 1)] ?? null)
        : state.selected,
  };
}
export type FileTreeNode = {
  name: string;
  path: string;
  children?: FileTreeNode[];
};
export function fileTree(paths: readonly string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const directories = paths.map((path) => path.split("/").slice(0, -1));
  let shared = directories[0]?.length ?? 0;
  for (const segments of directories) {
    let count = 0;
    while (count < shared && segments[count] === directories[0][count]) count++;
    shared = count;
  }
  const skip = Math.max(0, shared - 1);
  for (const path of paths) {
    let nodes = root;
    const segments = path.split("/");
    segments.forEach((name, index) => {
      if (index < skip) return;
      const directory = index < segments.length - 1;
      let node = nodes.find(
        (node) => node.name === name && !!node.children === directory,
      );
      if (!node) {
        node = {
          name,
          path: segments.slice(0, index + 1).join("/"),
          ...(directory ? { children: [] } : {}),
        };
        nodes.push(node);
      }
      if (node.children) nodes = node.children;
    });
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(!!b.children) - Number(!!a.children) ||
        a.name.localeCompare(b.name),
    );
    for (const node of nodes) if (node.children) sort(node.children);
  };
  sort(root);
  return root;
}
