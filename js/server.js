import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = 3002;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicPath = path.join(__dirname, "..");

app.use(express.static(publicPath));

app.get("/", (_, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.on("error", (error) => {
  console.error("Server error:", error);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\nSIGTERM received, shutting down...");
  server.close(() => {
    process.exit(0);
  });
});
