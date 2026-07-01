export type SystemPickerFilter = {
  name: string;
  extensions: string[];
};

export type SystemPickerSelection = {
  status: 'selected';
  path: string;
  name: string;
};

export type SystemPickerResult =
  | SystemPickerSelection
  | { status: 'cancelled' }
  | { status: 'unsupported'; message: string };

type PickerRequest = {
  title?: string;
  initialPath?: string;
  filters?: SystemPickerFilter[];
};

const requestPicker = async (endpoint: string, request: PickerRequest): Promise<SystemPickerResult> => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });

  const payload = (await response.json().catch(() => null)) as Partial<SystemPickerResult> | null;
  const payloadMessage =
    payload && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : null;

  if (response.status === 501) {
    return {
      status: 'unsupported',
      message: payloadMessage ?? 'Native picker is not available. Paste the path manually.'
    };
  }

  if (!response.ok) {
    throw new Error(
      payloadMessage ?? `Picker request failed with status ${response.status}.`
    );
  }

  if (payload?.status === 'selected' && typeof payload.path === 'string' && typeof payload.name === 'string') {
    return {
      status: 'selected',
      path: payload.path,
      name: payload.name
    };
  }

  if (payload?.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  return {
    status: 'unsupported',
    message: 'Native picker returned an unexpected response. Paste the path manually.'
  };
};

export const pickDirectoryRequest = (request: PickerRequest) =>
  requestPicker('/api/system/picker/directory', request);

export const pickFileRequest = (request: PickerRequest) =>
  requestPicker('/api/system/picker/file', request);
