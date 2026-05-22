import { Skill, SkillTool } from "../skill";
import { ToolDefinition } from "../../types";
import { logger } from "../../utils/logger";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GoogleSearchSkillConfig {
  /**
   * API key for the search provider.
   * - SerpAPI  (default): set provider = "serpapi"  or omit
   * - Brave Search API  : set provider = "brave"
   *
   * Falls back to env vars SERPAPI_KEY / BRAVE_SEARCH_API_KEY if not supplied.
   */
  apiKey?: string;
  provider?: "serpapi" | "brave";

  /** Maximum results returned per query (1–10, default 5) */
  maxResults?: number;
}

// ─── Result shape ─────────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ─── Provider adapters ────────────────────────────────────────────────────────

async function searchViaSerpApi(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    num: String(maxResults),
    hl: "en",
    gl: "us",
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpAPI error ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
    error?: string;
  };

  if (data.error) throw new Error(`SerpAPI: ${data.error}`);

  return (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "(no title)",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));
}

async function searchViaBrave(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<SearchResult[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    }
  );

  if (!res.ok) throw new Error(`Brave Search error ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "(no title)",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

// ─── Skill ────────────────────────────────────────────────────────────────────

export class GoogleSearchSkill implements Skill {
  readonly name = "google_search";
  readonly description = "Search the web and return ranked results with titles, URLs, and snippets";
  readonly category = "web" as const;
  readonly version = "1.0.0";

  private apiKey: string;
  private provider: "serpapi" | "brave";
  private maxResults: number;

  constructor(config: GoogleSearchSkillConfig = {}) {
    this.provider = config.provider ?? "serpapi";
    this.maxResults = Math.min(Math.max(config.maxResults ?? 5, 1), 10);

    const envKey =
      this.provider === "brave"
        ? process.env.BRAVE_SEARCH_API_KEY
        : process.env.SERPAPI_KEY;

    this.apiKey = config.apiKey ?? envKey ?? "";
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      const envName = this.provider === "brave" ? "BRAVE_SEARCH_API_KEY" : "SERPAPI_KEY";
      throw new Error(
        `GoogleSearchSkill: no API key supplied. ` +
          `Set the ${envName} environment variable or pass apiKey in the config.`
      );
    }
    logger.info(`[GoogleSearchSkill] Ready (provider: ${this.provider}, maxResults: ${this.maxResults})`);
  }

  getTools(): SkillTool[] {
    const definition: ToolDefinition = {
      name: "web_search",
      description: `Search the internet for current information.
Returns the top ${this.maxResults} organic results, each with:
  - title
  - url
  - snippet (short summary from the page)

Use this when you need factual information, recent events, documentation links,
or anything outside your training data.`,
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query. Be specific and concise for best results.",
          },
          max_results: {
            type: "number",
            description: `Number of results to return (1–${this.maxResults}). Default: ${this.maxResults}.`,
          },
        },
        required: ["query"],
      },
    };

    const handler = async (input: Record<string, unknown>): Promise<string> => {
      const query = input.query as string;
      const count = Math.min(
        Number(input.max_results ?? this.maxResults),
        this.maxResults
      );

      logger.info(`[GoogleSearchSkill] Searching: "${query}" (${count} results, via ${this.provider})`);

      try {
        const results =
          this.provider === "brave"
            ? await searchViaBrave(query, this.apiKey, count)
            : await searchViaSerpApi(query, this.apiKey, count);

        if (results.length === 0) return "No results found for that query.";

        // Format as a clean numbered list the LLM can easily parse
        return results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
          )
          .join("\n\n");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[GoogleSearchSkill] Search failed: ${msg}`);
        return `ERROR: Search failed — ${msg}`;
      }
    };

    return [{ definition, handler }];
  }
}
