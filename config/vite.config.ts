import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { BUILD_DIRECTORY } from "./paths";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: BUILD_DIRECTORY,
    rollupOptions: {
      input: "editor.html"
    }
  }
});
