import type { Plugin } from "@opencode-ai/plugin";

const plugin: Plugin = async () => {
  console.log("[test-plugin] Loaded!");
  return {};
};

export default plugin;
