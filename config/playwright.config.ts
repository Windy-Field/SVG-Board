import { defineConfig } from "@playwright/test";
import { TEST_DIRECTORY } from "./paths";

export default defineConfig({
  testDir: "../tests/browser",
  outputDir: "../" + TEST_DIRECTORY,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true
  },
  webServer: {
    cwd: "..",
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true
  }
});
