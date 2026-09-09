import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AzboxClient } from "../services/client.js";
import { capText } from "../services/format.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const responseFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("markdown para leerlo, json para procesarlo");

export function registerProjectTools(server: McpServer, client: AzboxClient): void {
  server.registerTool(
    "azbox_list_projects",
    {
      title: "List AZbox projects",
      description:
        "Lists the AZbox projects of the account the credential belongs to, with " +
        "their id, name and configured languages. Start here when you do not know " +
        "the project id: every other tool needs it.",
      inputSchema: { response_format: responseFormat },
      outputSchema: {
        projects: z.array(
          z.object({
            id: z.string(),
            name: z.string().nullable(),
            type: z.string().nullable(),
            languages: z.array(z.string()),
          }),
        ),
        total_count: z.number(),
      },
      annotations: READ_ONLY,
    },
    async ({ response_format }) => {
      const raw = await client.listProjects();
      const projects = raw.map((p) => ({
        id: p.id,
        name: p.data?.name ?? null,
        type: p.data?.type ?? null,
        languages: (p.data?.languages ?? []).filter(
          (l): l is string => typeof l === "string",
        ),
      }));
      const output = { projects, total_count: projects.length };

      const text =
        response_format === "json"
          ? JSON.stringify(output, null, 2)
          : projects.length === 0
            ? "Esta cuenta no tiene proyectos."
            : [
                `${projects.length} proyecto(s):`,
                "",
                ...projects.map(
                  (p) =>
                    `- **${p.name ?? "(sin nombre)"}** — \`${p.id}\`` +
                    (p.languages.length ? ` · idiomas: ${p.languages.join(", ")}` : ""),
                ),
              ].join("\n");

      return {
        content: [{ type: "text", text: capText(text, "Usa response_format json.") }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "azbox_get_project",
    {
      title: "Get an AZbox project",
      description:
        "Returns one project's name, type and the languages it is configured for. " +
        "Use it to find out which language codes are valid before asking for keywords.",
      inputSchema: {
        project_id: z.string().min(1).describe("Project id, from azbox_list_projects"),
        response_format: responseFormat,
      },
      outputSchema: {
        found: z.boolean(),
        id: z.string(),
        name: z.string().nullable(),
        type: z.string().nullable(),
        languages: z.array(z.string()),
      },
      annotations: READ_ONLY,
    },
    async ({ project_id, response_format }) => {
      const data = await client.getProject(project_id);
      if (data === null) {
        const output = {
          found: false,
          id: project_id,
          name: null,
          type: null,
          languages: [],
        };
        return {
          content: [
            {
              type: "text",
              text:
                `No hay ningún proyecto \`${project_id}\` en esta cuenta. ` +
                `Comprueba el id con azbox_list_projects.`,
            },
          ],
          structuredContent: output,
          isError: true,
        };
      }

      const output = {
        found: true,
        id: project_id,
        name: data.name ?? null,
        type: data.type ?? null,
        languages: (data.languages ?? []).filter(
          (l): l is string => typeof l === "string",
        ),
      };

      const text =
        response_format === "json"
          ? JSON.stringify(output, null, 2)
          : [
              `**${output.name ?? "(sin nombre)"}** — \`${output.id}\``,
              output.type ? `Tipo: ${output.type}` : null,
              `Idiomas: ${output.languages.length ? output.languages.join(", ") : "ninguno configurado"}`,
            ]
              .filter(Boolean)
              .join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "azbox_list_categories",
    {
      title: "List categories of an AZbox project",
      description:
        "Lists the categories a project uses to group its keywords. Useful to " +
        "understand how a large project is organised before pulling its keys.",
      inputSchema: {
        project_id: z.string().min(1).describe("Project id, from azbox_list_projects"),
        response_format: responseFormat,
      },
      outputSchema: {
        categories: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
        total_count: z.number(),
      },
      annotations: READ_ONLY,
    },
    async ({ project_id, response_format }) => {
      const raw = await client.listCategories(project_id);
      const categories = raw.map((c) => ({ id: c.id, name: c.data?.name ?? null }));
      const output = { categories, total_count: categories.length };

      const text =
        response_format === "json"
          ? JSON.stringify(output, null, 2)
          : categories.length === 0
            ? "Este proyecto no tiene categorías."
            : categories
                .map((c) => `- ${c.name ?? "(sin nombre)"} — \`${c.id}\``)
                .join("\n");

      return {
        content: [{ type: "text", text: capText(text, "Usa response_format json.") }],
        structuredContent: output,
      };
    },
  );
}
