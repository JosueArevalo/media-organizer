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

  if (sourceResolved && sourceResolved === destinationResolved) {
    return {
      valid: false,
      status: 'invalid_request',
      message: 'Destination path cannot be the same as source path.'
    };
  }

  return {
    valid: true,
    destinationResolved,
    sourceResolved
  };
};
