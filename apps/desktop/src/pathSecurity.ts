import path from 'node:path';

export const normalizeWebAssetPath = (webRoot: string, pathname: string) => {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.resolve(webRoot, relativePath || 'index.html');
  const relative = path.relative(path.resolve(webRoot), candidate);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
};
