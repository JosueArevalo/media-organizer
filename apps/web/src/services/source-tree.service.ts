type ScannedFile = {
  kind: 'file';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileType: string;
};

type ScannedDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  children: Array<ScannedDirectory | ScannedFile>;
};

export const scanSourceTreeRequest = async (sourcePath: string): Promise<ScannedDirectory> => {
  const response = await fetch('/api/source-tree/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sourcePath })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not scan source tree (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { tree: ScannedDirectory };
  return payload.tree;
};
