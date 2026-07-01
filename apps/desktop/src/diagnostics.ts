import fs from 'node:fs';

export const redactDiagnostics = (value: string, userProfile: string, token?: string) => {
  let redacted = value;
  if (userProfile) redacted = redacted.replaceAll(userProfile, '%USERPROFILE%');
  if (token) redacted = redacted.replaceAll(token, '[REDACTED_TOKEN]');
  return redacted;
};

export const readLogTail = (filePath: string, maxLines = 200) => {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8').trimEnd();
  if (!content) return '';
  return content.split(/\r?\n/).slice(-maxLines).join('\n');
};
