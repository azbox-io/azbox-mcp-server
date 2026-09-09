#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { AzboxClient, AzboxError } from "./services/client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerKeywordTools } from "./tools/keywords.js";

/**
 * Servidor MCP de AZbox.
 *
 * stdio, porque el cliente es local: Claude Code, Cursor y compañía lo lanzan
 * como proceso hijo. Solo lectura: seis herramientas para que un agente que
 * está editando código pueda mirar las claves y traducciones del proyecto sin
 * salir del editor.
 */
async function main(): Promise<void> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // El cliente se construye una vez y lee la credencial del entorno. Si falta,
  // se falla aquí y no en la primera llamada: así el error aparece al arrancar
  // el servidor, que es donde el usuario lo va a ver.
  const client = new AzboxClient();

  registerProjectTools(server, client);
  registerKeywordTools(server, client);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  // stdout es el canal del protocolo: cualquier cosa que se escriba ahí rompe
  // el handshake. Los errores van por stderr.
  if (error instanceof AzboxError) {
    process.stderr.write(`${SERVER_NAME}: ${error.message}\n`);
  } else {
    process.stderr.write(
      `${SERVER_NAME}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
  }
  process.exit(1);
});
