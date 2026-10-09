import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo-name>/
  // without hard-coding the repository name.
  base: "./",
  plugins: [react(), tailwindcss()],
});
