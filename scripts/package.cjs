const fs = require("node:fs");
const manifest = require("../extension/manifest.json");
const source = `dist/x_brief-${manifest.version}.zip`,
  target = `dist/x-brief-${manifest.version}.xpi`;
fs.copyFileSync(source, target);
console.log(`Firefox package: ${target}`);
