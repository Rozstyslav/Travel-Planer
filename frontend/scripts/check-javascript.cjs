const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(file);
    else if (entry.name.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], {
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}

checkDirectory(path.resolve(__dirname, "../static/travel"));
console.log("All frontend JavaScript files pass syntax checks.");
