export type ImportValidationCode =
  | 'missing_paths'
  | 'relative_source'
  | 'relative_destination'
  | 'same_path'
  | 'destination_inside_source'
  | 'source_not_found'
  | 'source_not_directory'
  | 'source_not_readable'
  | 'destination_parent_not_found'
  | 'destination_not_directory'
  | 'destination_not_writable'
  | 'request_failed';

export type ImportValidationResult =
  | { ok: true }
  | { ok: false; code: ImportValidationCode; message: string };

export const isLikelyAbsoluteImportPath = (value: string) => {
  if (!value.trim()) {
    return false;
  }

  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
};

const trimTrailingSeparators = (value: string) => value.replace(/[\\/]+$/, '');

export const normalizeImportPathForComparison = (value: string) =>
  trimTrailingSeparators(value.trim().replace(/\\/g, '/')).toLowerCase();

export const isDestinationInsideSourcePath = (sourcePath: string, destinationPath: string) => {
  const source = normalizeImportPathForComparison(sourcePath);
  const destination = normalizeImportPathForComparison(destinationPath);

  if (!source || !destination || source === destination) {
    return false;
  }

  return destination.startsWith(`${source}/`);
};

export const validateImportFoldersLocally = (
  sourcePathValue: string,
  destinationPathValue: string
): ImportValidationResult => {
  const sourcePath = sourcePathValue.trim();
  const destinationPath = destinationPathValue.trim();

  if (!sourcePath || !destinationPath) {
    return {
      ok: false,
      code: 'missing_paths',
      message: 'Source and Destination paths are required.'
    };
  }

  if (!isLikelyAbsoluteImportPath(sourcePath)) {
    return {
      ok: false,
      code: 'relative_source',
      message: 'Source path must be an absolute path.'
    };
  }

  if (!isLikelyAbsoluteImportPath(destinationPath)) {
    return {
      ok: false,
      code: 'relative_destination',
      message: 'Destination path must be an absolute path.'
    };
  }

  if (normalizeImportPathForComparison(sourcePath) === normalizeImportPathForComparison(destinationPath)) {
    return {
      ok: false,
      code: 'same_path',
      message: 'Source and Destination cannot be the same folder.'
    };
  }

  if (isDestinationInsideSourcePath(sourcePath, destinationPath)) {
    return {
      ok: false,
      code: 'destination_inside_source',
      message: 'Destination cannot be inside the Source folder.'
    };
  }

  return { ok: true };
};

export const validateImportFoldersRequest = async (
  sourcePath: string,
  destinationPath: string
): Promise<ImportValidationResult> => {
  const response = await fetch('/api/import/validate-folders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sourcePath, destinationPath })
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      code: 'request_failed',
      message: body || `Could not validate import folders (${response.status}).`
    };
  }

  return (await response.json()) as ImportValidationResult;
};
