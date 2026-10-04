import fs from 'node:fs';

export const isAlreadyCopied = (item: { sourcePath: string; destinationPath: string }) => {
  if (!fs.existsSync(item.destinationPath)) return false;
  const sourceStats = fs.statSync(item.sourcePath);
  const destinationStats = fs.statSync(item.destinationPath);
  if (!destinationStats.isFile() || sourceStats.size !== destinationStats.size) return false;
  return fs.readFileSync(item.sourcePath).equals(fs.readFileSync(item.destinationPath));
};
