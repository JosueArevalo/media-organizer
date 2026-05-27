import path from 'node:path';
import { hasDestructiveConfirmation } from '../http/localAccess.js';

export type ClearDestinationValidation =
  | {
      valid: true;
      destinationResolved: string;
      sourceResolved: string | null;
    }
  | {
      valid: false;
      status: 'invalid_request';
      message: string;
    };

const normalizeForComparison = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const isPathInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

export const validateClearDestinationRequest = (body: unknown): ClearDestinationValidation => {
  if (!hasDestructiveConfirmation(body, 'CLEAR_DESTINATION')) {
    return {
      valid: false,
      status: 'invalid_request',
      message: 'confirmation must be CLEAR_DESTINATION.'
    };
  }

  const candidate = body as { destinationPath?: unknown; sourcePath?: unknown };
  const destinationPath = typeof candidate.destinationPath === 'string' ? candidate.destinationPath.trim() : '';
  const sourcePath = typeof candidate.sourcePath === 'string' ? candidate.sourcePath.trim() : '';

  if (!destinationPath || !path.isAbsolute(destinationPath)) {
    return {
      valid: false,
      status: 'invalid_request',
      message: 'destinationPath must be an absolute path.'
    };
  }

  const destinationResolved = path.resolve(destinationPath);
  const sourceResolved = sourcePath && path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : null;

  if (sourceResolved && normalizeForComparison(sourceResolved) === normalizeForComparison(destinationResolved)) {
    return {
      valid: false,
      status: 'invalid_request',
      message: 'Destination path cannot be the same as source path.'
    };
  }

  if (
    sourceResolved &&
    isPathInside(normalizeForComparison(sourceResolved), normalizeForComparison(destinationResolved))
  ) {
    return {
      valid: false,
      status: 'invalid_request',
      message: 'Destination path cannot be inside source path.'
    };
  }

  return {
    valid: true,
    destinationResolved,
    sourceResolved
  };
};
