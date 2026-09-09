import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AzboxClient } from "../services/client.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import {
  capText,
  entriesToMarkdown,
  paginate,
  toEntries,
  type Entry,
} from "../services/format.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const entrySchema = z.object({
  key: z.string(),
  translation: z.string().nullable(),
  context: z.string().optional(),
  reference: z.string().optional(),
});

const pageFields = {
  total_count: z.number(),
  has_more: z.boolean(),
  next_offset: z.number().nullable(),
};

const common = {
  project_id: z.string().min(1).describe("Project id, from azbox_list_projects"),
  language: z
    .string()
    .min(1)
    .describe("Language code as configured in the project, e.g. EN or ES"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`How many keys to return, at most ${MAX_PAGE_SIZE}`),
  offset: z.number().int().min(0).default(0).describe("Where to start, for paging"),
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("markdown para leerlo, json para procesarlo"),
};

export function registerKeywordTools(server: McpServer, client: AzboxClient): void {
  server.registerTool(
    "azbox_list_keywords",
    {
      title: "List translations of an AZbox project",
      description:
        "Returns the translation keys of a project in one language, sorted by key. " +
        "The key you use in code is the `key` field. A key with no text yet in that " +
        "language comes back with translation null. Paginated: a real project has " +
        "thousands of keys, so ask for a page and narrow down with " +
        "azbox_search_keywords instead of pulling everything.",
      inputSchema: {
        ...common,
        updated_since: z
          .string()
          .optional()
          .describe("ISO date; only keys changed after it. Useful to see recent edits"),
      },
      outputSchema: { keywords: z.array(entrySchema), ...pageFields },
      annotations: READ_ONLY,
    },
    async ({ project_id, language, limit, offset, response_format, updated_since }) => {
      const entries = toEntries(
        await client.listKeywords(project_id, language, updated_since),
      );
      return render(entries, { limit, offset, response_format });
    },
  );

  server.registerTool(
    "azbox_search_keywords",
    {
      title: "Search translations of an AZbox project",
      description:
        "Finds keys whose name or translated text contains a piece of text, " +
        "case-insensitively. This is the tool to reach for when you are editing code " +
        "and need the key behind a string you can see in the UI, or want every key " +
        "under a prefix like `checkout.`. The API has no search endpoint, so this " +
        "fetches the language once and filters.",
      inputSchema: {
        ...common,
        query: z
          .string()
          .min(1)
          .describe("Text to look for in the key name or in the translation"),
        search_in: z
          .enum(["key", "translation", "both"])
          .default("both")
          .describe("Where to look"),
      },
      outputSchema: { keywords: z.array(entrySchema), ...pageFields },
      annotations: READ_ONLY,
    },
    async ({ project_id, language, query, search_in, limit, offset, response_format }) => {
      const needle = query.toLowerCase();
      const all = toEntries(await client.listKeywords(project_id, language));
      const entries = all.filter((e) => {
        const inKey = e.key.toLowerCase().includes(needle);
        const inValue = (e.translation ?? "").toLowerCase().includes(needle);
        if (search_in === "key") return inKey;
        if (search_in === "translation") return inValue;
        return inKey || inValue;
      });
      return render(entries, { limit, offset, response_format });
    },
  );

  server.registerTool(
    "azbox_find_untranslated",
    {
      title: "Find untranslated keys in an AZbox project",
      description:
        "Lists the keys that exist in the project but still have no text in the " +
        "given language. Answers 'what is missing in French?' in one call, which " +
        "otherwise means pulling every key and filtering by hand.",
      inputSchema: {
        project_id: common.project_id,
        language: common.language,
        limit: common.limit,
        offset: common.offset,
        response_format: common.response_format,
      },
      outputSchema: { keywords: z.array(entrySchema), ...pageFields },
      annotations: READ_ONLY,
    },
    async ({ project_id, language, limit, offset, response_format }) => {
      const all = toEntries(await client.listKeywords(project_id, language));
      const entries = all.filter((e) => e.translation === null);
      return render(entries, { limit, offset, response_format });
    },
  );
}

function render(
  entries: Entry[],
  opts: { limit: number; offset: number; response_format: "markdown" | "json" },
) {
  const page = paginate(entries, opts.offset, opts.limit);
  const output = {
    keywords: page.items,
    total_count: page.total_count,
    has_more: page.has_more,
    next_offset: page.next_offset,
  };

  const text =
    opts.response_format === "json"
      ? JSON.stringify(output, null, 2)
      : entriesToMarkdown(page.items, page);

  return {
    content: [
      {
        type: "text" as const,
        text: capText(
          text,
          `Pide menos con limit, o filtra con azbox_search_keywords.`,
        ),
      },
    ],
    structuredContent: output,
  };
}
