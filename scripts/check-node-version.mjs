const minimumVersion = "22.13.0";
const recommendedVersion = "22.22.3";

const parseVersion = (version) => version.split(".").map((part) => Number.parseInt(part, 10));

const compareVersions = (left, right) => {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

const currentVersion = process.versions.node;

if (compareVersions(currentVersion, minimumVersion) >= 0) {
  process.exit(0);
}

const isWindows = process.platform === "win32";
const installHint = isWindows
  ? "Install Node.js 22.22.3 or newer, then run: npm.cmd ci"
  : "Install nvm, then run: nvm install && nvm use && npm ci";

console.error("");
console.error("Media Organizer cannot run with this Node.js version.");
console.error("");
console.error(`Current Node.js: ${currentVersion}`);
console.error(`Required Node.js: >=${minimumVersion}`);
console.error(`Recommended Node.js: ${recommendedVersion}`);
console.error("");
console.error("Reason: the backend uses Node's built-in node:sqlite module.");
console.error("Node 22.9.0 is too old for this project setup.");
console.error("");
console.error(installHint);
console.error("");

process.exit(1);
