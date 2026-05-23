export type GroupingFolderKind = 'proposed' | 'manual' | 'template';
export type GroupingRuleId = 'date-event-multiple' | 'single-date-year-unique';

export type GroupingWorkspaceFolder = {
  id: string;
  label: string;
  kind: GroupingFolderKind;
  itemCount: number;
};

export type GroupingWorkspaceItem = {
  id: string;
  sourcePath: string;
  relativePath: string;
  outputPath: string;
  fileName: string;
  mediaType: 'image' | 'video' | 'unknown';
  sizeBytes: number;
  captureDate: string | null;
  targetGroupLabel: string | null;
  preservedStructure: boolean;
};

export type GroupingFolderTemplate = {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
};

export type GroupingWorkspace = {
  sessionId: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId: string | null;
  rules: GroupingRuleId[];
  preservedDirectories: string[];
  reorganizedDirectories: string[];
  folders: GroupingWorkspaceFolder[];
  items: GroupingWorkspaceItem[];
  templates: GroupingFolderTemplate[];
};

export type GroupingApplyResponse = {
  sessionId: string;
  status: 'completed' | 'failed';
  movedItems: number;
  deletedItems?: number;
  failedItems: number;
};

const readErrorBody = async (response: Response) => {
  const body = await response.text();
  return body || response.statusText;
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }

  return (await response.json()) as T;
};

export const createGroupingWorkspaceRequest = async (payload: {
  name?: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId: string;
}) =>
  requestJson<GroupingWorkspace>('/api/grouping/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const reorganizeGroupingWorkspaceRequest = async (
  sessionId: string,
  payload: {
    rules: GroupingRuleId[];
    preservedDirectories: string[];
    reorganizedDirectories: string[];
  }
) =>
  requestJson<GroupingWorkspace>(`/api/grouping/${sessionId}/reorganize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const getGroupingWorkspaceRequest = async (sessionId: string) =>
  requestJson<GroupingWorkspace>(`/api/grouping/${sessionId}/workspace`);

export const createGroupingFolderRequest = async (sessionId: string, label: string) =>
  requestJson<GroupingWorkspaceFolder>(`/api/grouping/${sessionId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });

export const createGroupingFolderFromTemplateRequest = async (sessionId: string, templateId: string) =>
  requestJson<GroupingWorkspaceFolder>(`/api/grouping/${sessionId}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId })
  });

export const renameGroupingFolderRequest = async (sessionId: string, folderId: string, label: string) =>
  requestJson<GroupingWorkspaceFolder>(`/api/grouping/${sessionId}/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });

export const deleteGroupingFolderRequest = async (sessionId: string, folderId: string) => {
  const response = await fetch(`/api/grouping/${sessionId}/folders/${folderId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`Could not delete folder (${response.status}): ${await readErrorBody(response)}`);
  }
};

export const assignGroupingItemsRequest = async (sessionId: string, itemIds: string[], targetGroupLabel: string) =>
  requestJson<GroupingWorkspace>(`/api/grouping/${sessionId}/items/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds, targetGroupLabel })
  });

export const deleteGroupingItemsRequest = async (sessionId: string, itemIds: string[]) =>
  requestJson<GroupingWorkspace>(`/api/grouping/${sessionId}/items/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds })
  });

export const applyGroupingWorkspaceRequest = async (sessionId: string) =>
  requestJson<GroupingApplyResponse>(`/api/grouping/${sessionId}/apply`, { method: 'POST' });

export const listGroupingTemplatesRequest = async () =>
  requestJson<{ templates: GroupingFolderTemplate[] }>('/api/grouping/templates');

export const createGroupingTemplateRequest = async (payload: { name: string; pattern: string; enabled?: boolean }) =>
  requestJson<{ templates: GroupingFolderTemplate[] }>('/api/grouping/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const updateGroupingTemplateRequest = async (
  templateId: string,
  payload: Partial<{ name: string; pattern: string; enabled: boolean }>
) =>
  requestJson<{ templates: GroupingFolderTemplate[] }>(`/api/grouping/templates/${templateId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const deleteGroupingTemplateRequest = async (templateId: string) => {
  const response = await fetch(`/api/grouping/templates/${templateId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`Could not delete template (${response.status}): ${await readErrorBody(response)}`);
  }
};

export const buildGroupingMediaUrl = (sessionId: string, itemId: string) => `/api/grouping/${sessionId}/items/${itemId}/media`;
