import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts", "setup-openclaw.sh");
const hasOpenClaw = spawnSync("openclaw", ["--version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!hasOpenClaw)("setup-openclaw.sh", () => {
  it("links the plugin and writes the OpenClaw memory config", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worthydb-setup-"));
    const stateDir = path.join(tempRoot, "state");
    const configPath = path.join(stateDir, "openclaw.json");

    await fs.mkdir(stateDir, { recursive: true });

    try {
      const input = `${new Array(23).fill("").join("\n")}\n`;
      const result = spawnSync("bash", [scriptPath], {
        cwd: repoRoot,
        encoding: "utf-8",
        input,
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: configPath,
          WORTHYDB_SETUP_SKIP_BUILD: "1",
        },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("Error:");

      const config = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        plugins?: {
          load?: { paths?: string[] };
          slots?: { memory?: string };
          entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
        };
      };

      expect(config.plugins?.load?.paths).toContain(repoRoot);
      expect(config.plugins?.slots?.memory).toBe("memory-worthydb");
      expect(config.plugins?.entries?.["memory-worthydb"]?.enabled).toBe(true);
      expect(config.plugins?.entries?.["memory-worthydb"]?.config).toMatchObject({
        extraction: {
          maxFacts: 5,
          primary: {
            provider: "gemini",
            apiKey: "${GEMINI_API_KEY}",
            model: "gemini-2.5-flash-lite",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            timeoutMs: 8000,
          },
        },
        embedding: {
          ollamaUrl: "http://localhost:11434",
          model: "qwen3-embedding:latest",
          dimensions: 4096,
        },
        dbPath: `${stateDir}/memory/worthydb/{agentId}`,
        autoCapture: true,
        autoRecall: true,
        maxRecallResults: 8,
        recallMinScore: 0.45,
        dedup: {
          threshold: 0.95,
        },
        ttl: {
          preference: 365,
          decision: 180,
          entity: 0,
          fact: 90,
          other: 30,
        },
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }, 15000);
});
