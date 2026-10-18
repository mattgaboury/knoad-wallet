const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/** Copies the enclave sources into a prebuild. Expo Go cannot load them. */
function withKnoadEnclave(config) {
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      copy(
        path.join(__dirname, "..", "native", "ios", "KnoadEnclave.swift"),
        path.join(cfg.modRequest.platformProjectRoot, "KnoadEnclave", "KnoadEnclave.swift"),
      );
      return cfg;
    },
  ]);
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      copy(
        path.join(__dirname, "..", "native", "android", "KnoadEnclave.kt"),
        path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "java", "io", "knoad", "wallet", "KnoadEnclave.kt"),
      );
      return cfg;
    },
  ]);
  config = withXcodeProject(config, (cfg) => {
    try {
      const project = cfg.modResults;
      const filepath = "KnoadEnclave/KnoadEnclave.swift";
      if (!project.hasFile?.(filepath)) {
        project.addSourceFile(filepath, { target: project.getFirstTarget().uuid });
      }
    } catch {
      // The Swift file is copied next to the project. Add it to the app target if this step cannot.
    }
    return cfg;
  });
  return config;
}

module.exports = withKnoadEnclave;
