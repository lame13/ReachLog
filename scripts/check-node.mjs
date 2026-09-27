const major = Number(process.versions.node.split(".")[0]);

if (major !== 22 && major !== 24) {
  console.error(
    `ReachLog requires Node.js 22 or 24; you are running ${process.version}. ` +
    "Switch Node versions before running tests or publishing. With nvm, run: nvm install && nvm use"
  );
  process.exit(1);
}
