import type { PluginLogger } from "openclaw/plugin-sdk";
import type { WorthyDbConfig } from "../shared/contracts.js";

type EmbeddingConfig = WorthyDbConfig["embedding"];

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

function assertVector(data: unknown, expectedDimensions: number): number[] {
  if (!Array.isArray(data) || !data.every((item) => typeof item === "number")) {
    throw new Error("Ollama response did not contain a numeric embedding vector");
  }
  if (data.length !== expectedDimensions) {
    throw new Error(
      `Ollama embedding dimension mismatch. Expected ${expectedDimensions}, got ${data.length}`,
    );
  }
  return data;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export class OllamaEmbeddingsClient {
  constructor(
    private readonly config: EmbeddingConfig,
    private readonly logger: PluginLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(text: string): Promise<number[]> {
    const prompt = text.trim();
    if (!prompt) {
      throw new Error("Cannot embed empty text");
    }

    const endpoints = [
      {
        path: "/api/embed",
        body: {
          model: this.config.model,
          input: prompt,
          keep_alive: this.config.keepAlive ?? "1h",
        },
        parse: (data: Record<string, unknown>) =>
          Array.isArray(data.embeddings) ? data.embeddings[0] : data.embedding,
      },
      {
        path: "/api/embeddings",
        body: {
          model: this.config.model,
          prompt,
          keep_alive: this.config.keepAlive ?? "1h",
        },
        parse: (data: Record<string, unknown>) => data.embedding,
      },
    ] as const;

    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        return await this.requestEmbedding(endpoint.path, endpoint.body, endpoint.parse);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.debug?.(`worthydb: Ollama embedding endpoint ${endpoint.path} failed`);
      }
    }

    throw lastError ?? new Error("Ollama embedding failed");
  }

  private async requestEmbedding(
    endpoint: string,
    body: Record<string, unknown>,
    parse: (data: Record<string, unknown>) => unknown,
  ): Promise<number[]> {
    const response = await this.fetchImpl(`${trimTrailingSlashes(this.config.ollamaUrl)}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const details = await readErrorBody(response);
      throw new Error(`Ollama request failed (${response.status}): ${details || response.statusText}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return assertVector(parse(payload), this.config.dimensions);
  }
}
