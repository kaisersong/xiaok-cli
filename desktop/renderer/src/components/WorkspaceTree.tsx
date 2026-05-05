import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';

interface FileChangeEvent {
  type: 'canvas_file_changed';
  filePath: string;
  change: 'add' | 'change' | 'unlink';
  eventId: string;
}

interface WorkspaceNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceNode[];
  deleted?: boolean;
}

interface WorkspaceTreeProps {
  fileChanges: FileChangeEvent[];
  onSelectFile: (path: string) => void;
}

export function WorkspaceTree({ fileChanges, onSelectFile }: WorkspaceTreeProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/']));

  const tree = useMemo(() => {
    const nodes = new Map<string, WorkspaceNode>();

    for (const change of fileChanges) {
      const path = change.filePath;
      const parts = path.split('/').filter(Boolean);

      // Build directory nodes for each level
      for (let i = 0; i < parts.length - 1; i++) {
        const dirPath = '/' + parts.slice(0, i + 1).join('/');
        if (!nodes.has(dirPath)) {
          nodes.set(dirPath, {
            path: dirPath,
            name: parts[i],
            type: 'directory',
            children: [],
          });
        }
      }

      // Build file node
      const filePath = path;
      if (change.change === 'unlink') {
        const existing = nodes.get(filePath);
        if (existing) existing.deleted = true;
      } else if (!nodes.has(filePath)) {
        nodes.set(filePath, {
          path: filePath,
          name: parts[parts.length - 1] || path,
          type: 'file',
        });
      }
    }

    // Build tree structure
    const rootChildren: WorkspaceNode[] = [];
    const allNodes = Array.from(nodes.values());

    for (const node of allNodes) {
      if (node.path === '/') continue;
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
      const parentKey = parentPath || '/';
      const parent = nodes.get(parentKey);

      if (parent && parent.type === 'directory') {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        rootChildren.push(node);
      }
    }

    // Sort: directories first, then files, alphabetically
    const sortNodes = (nodes: WorkspaceNode[]) => {
      return nodes.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
    };

    const buildTree = (nodes: WorkspaceNode[]): WorkspaceNode[] => {
      return sortNodes(nodes).map(node => ({
        ...node,
        children: node.type === 'directory' && node.children ? buildTree(node.children) : undefined,
      }));
    };

    return buildTree(rootChildren);
  }, [fileChanges]);

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (tree.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-[var(--c-text-tertiary)]">No files yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <TreeNode
        nodes={tree}
        expandedDirs={expandedDirs}
        onToggleDir={toggleDir}
        onSelectFile={onSelectFile}
        depth={0}
      />
    </div>
  );
}

interface TreeNodeProps {
  nodes: WorkspaceNode[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  depth: number;
}

function TreeNode({ nodes, expandedDirs, onToggleDir, onSelectFile, depth }: TreeNodeProps) {
  return (
    <>
      {nodes.filter(n => !n.deleted).map(node => (
        <div key={node.path}>
          {node.type === 'directory' ? (
            <div>
              <button
                type="button"
                onClick={() => onToggleDir(node.path)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-[var(--c-bg-deep)]"
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                {expandedDirs.has(node.path) ? (
                  <ChevronDown size={14} className="text-[var(--c-text-tertiary)]" />
                ) : (
                  <ChevronRight size={14} className="text-[var(--c-text-tertiary)]" />
                )}
                {expandedDirs.has(node.path) ? (
                  <FolderOpen size={14} className="text-[var(--c-accent)]" />
                ) : (
                  <Folder size={14} className="text-[var(--c-text-tertiary)]" />
                )}
                <span className="truncate text-[var(--c-text-secondary)]">{node.name}</span>
              </button>
              {expandedDirs.has(node.path) && node.children && node.children.length > 0 && (
                <TreeNode
                  nodes={node.children}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onSelectFile(node.path)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-[var(--c-bg-deep)]"
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
            >
              <File size={14} className="text-[var(--c-text-tertiary)]" />
              <span className="truncate text-[var(--c-text-secondary)]">{node.name}</span>
            </button>
          )}
        </div>
      ))}
    </>
  );
}
