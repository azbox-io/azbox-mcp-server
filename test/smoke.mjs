/**
 * Prueba de extremo a extremo del servidor MCP: levanta una API falsa, arranca
 * el servidor por stdio, hace el handshake y llama a las herramientas.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const PROJECTS = [
  { id: "p-uno", data: { name: "App móvil", type: "app", languages: ["EN", "ES", "FR"] } },
  { id: "p-dos", data: { name: "Web", type: "web", languages: ["EN", "ES"] } },
];
const KEYWORDS = {
  ES: [
    { id: "aB1", data: { keyword: "home.title", translation: "Bienvenido" } },
    { id: "cD2", data: { keyword: "home.cta", translation: "Empezar ahora" } },
    { id: "eF3", data: { keyword: "checkout.pay", translation: "Pagar" } },
    { id: "gH4", data: { keyword: "checkout.total" } },
    { id: "iJ5", data: { keyword: "profile.name" } },
  ],
  FR: [],
};

/** Una clave con la forma de las de verdad, para comprobar cómo se envía. */
const CLAVE = "azb_live_" + "K".repeat(32);
const LEGACY = "uid-del-esquema-antiguo";

/** Cómo llegó la credencial en cada petición, y si el secreto acabó en la URL. */
const recibido = { porCabecera: 0, porQuery: 0, secretoEnUrl: 0 };

const api = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const cabecera = req.headers["x-api-key"];
  // `api_key` es el parámetro que acepta la API; `token` era el de una versión
  // anterior y hoy se rechaza, así que no debe aparecer nunca.
  const query = u.searchParams.get("api_key");
  if (u.searchParams.get("token")) return json(400, { error: "token está obsoleto" });
  if (cabecera === CLAVE) recibido.porCabecera++;
  else if (query) recibido.porQuery++;
  else return json(401, { error: "Access denied" });
  if (req.url.includes(CLAVE)) recibido.secretoEnUrl++;

  const m = u.pathname.match(/^\/v1\/projects\/?([^/]*)\/?(categories|keywords)?$/);
  if (!m) return json(404, { detail: "not found" });
  const [, pid, sub] = m;

  if (!pid) return json(200, PROJECTS);
  if (!sub) {
    const p = PROJECTS.find((x) => x.id === pid);
    return p ? json(200, p.data) : json(404, { detail: "No records found" });
  }
  if (sub === "categories") return json(404, { detail: "No categories found" });
  if (sub === "keywords") {
    const lang = u.searchParams.get("language");
    if (!lang) return json(404, { detail: "Language not found " });
    const kws = KEYWORDS[lang];
    if (kws === undefined) return json(404, { detail: "Language not found " });
    return kws.length ? json(200, kws) : json(404, { detail: "No keywords found" });
  }
});

await new Promise((r) => api.listen(4799, r));

const child = spawn("node", ["dist/index.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, AZBOX_TOKEN: CLAVE, AZBOX_BASE_URL: "http://localhost:4799" },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.log("  ! no-JSON en stdout:", line.slice(0, 120)); continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout en ${method}`)), 15000);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const fallos = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "ok  " : "FALLA"} ${msg}`); if (!cond) fallos.push(msg); };

const init = await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
ok(init.result?.serverInfo?.name === "azbox-mcp-server", `handshake: ${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
notify("notifications/initialized", {});

const tools = await call("tools/list", {});
const nombres = (tools.result?.tools ?? []).map((t) => t.name).sort();
ok(nombres.length === 6, `6 herramientas: ${nombres.join(", ")}`);
ok(nombres.every((n) => n.startsWith("azbox_")), "todas con prefijo azbox_");
ok(
  (tools.result?.tools ?? []).every((t) => t.annotations?.readOnlyHint === true),
  "todas marcadas readOnlyHint",
);
ok(
  (tools.result?.tools ?? []).every((t) => t.description && t.description.length > 40),
  "todas con descripción",
);

const proyectos = await call("tools/call", { name: "azbox_list_projects", arguments: {} });
ok(proyectos.result?.structuredContent?.total_count === 2, "list_projects devuelve 2");
ok(/App móvil/.test(proyectos.result?.content?.[0]?.text ?? ""), "markdown legible");

const proyecto = await call("tools/call", {
  name: "azbox_get_project",
  arguments: { project_id: "p-uno", response_format: "json" },
});
ok(
  proyecto.result?.structuredContent?.languages?.join(",") === "EN,ES,FR",
  "get_project trae los idiomas",
);

const fantasma = await call("tools/call", {
  name: "azbox_get_project",
  arguments: { project_id: "no-existe" },
});
ok(fantasma.result?.isError === true, "un proyecto inexistente se marca como error");
ok(/azbox_list_projects/.test(fantasma.result?.content?.[0]?.text ?? ""), "y sugiere qué hacer");

const claves = await call("tools/call", {
  name: "azbox_list_keywords",
  arguments: { project_id: "p-uno", language: "ES", response_format: "json" },
});
const sc = claves.result?.structuredContent;
ok(sc?.total_count === 5, "list_keywords: 5 claves");
ok(sc?.keywords?.[0]?.key === "checkout.pay", "ordenadas por clave");
ok(sc?.keywords?.find((k) => k.key === "checkout.total")?.translation === null, "sin traducir -> null");

const pagina = await call("tools/call", {
  name: "azbox_list_keywords",
  arguments: { project_id: "p-uno", language: "ES", limit: 2, response_format: "json" },
});
ok(pagina.result?.structuredContent?.has_more === true, "paginación: has_more");
ok(pagina.result?.structuredContent?.next_offset === 2, "paginación: next_offset");

const busqueda = await call("tools/call", {
  name: "azbox_search_keywords",
  arguments: { project_id: "p-uno", language: "ES", query: "checkout.", response_format: "json" },
});
ok(busqueda.result?.structuredContent?.total_count === 2, "search por prefijo de clave");

const porTexto = await call("tools/call", {
  name: "azbox_search_keywords",
  arguments: { project_id: "p-uno", language: "ES", query: "empezar", search_in: "translation", response_format: "json" },
});
ok(porTexto.result?.structuredContent?.keywords?.[0]?.key === "home.cta", "search por texto traducido, sin distinguir mayúsculas");

const faltan = await call("tools/call", {
  name: "azbox_find_untranslated",
  arguments: { project_id: "p-uno", language: "ES", response_format: "json" },
});
ok(faltan.result?.structuredContent?.total_count === 2, "find_untranslated: 2");

const vacio = await call("tools/call", {
  name: "azbox_list_keywords",
  arguments: { project_id: "p-uno", language: "FR", response_format: "json" },
});
ok(vacio.result?.structuredContent?.total_count === 0 && !vacio.result?.isError, "idioma vacío: 0 claves y sin error");

const idiomaMalo = await call("tools/call", {
  name: "azbox_list_keywords",
  arguments: { project_id: "p-uno", language: "XX" },
});
ok(idiomaMalo.result?.isError === true, "idioma inexistente se marca como error");
ok(/azbox_get_project/.test(JSON.stringify(idiomaMalo.result?.content ?? "")), "y dice dónde mirar los idiomas");

ok(stderr === "", `stderr limpio${stderr ? `: ${stderr.slice(0, 200)}` : ""}`);

// Una clave de API viaja en la cabecera y nunca en la URL: un secreto en la
// query acaba en los logs del servidor y en los de cualquier proxy por medio.
ok(recibido.porCabecera > 0, `la clave viaja en x-api-key (${recibido.porCabecera} peticiones)`);
ok(recibido.porQuery === 0, "ninguna petición mandó la clave en la query");
ok(recibido.secretoEnUrl === 0, "el secreto no aparece en ninguna URL");

child.kill();

// Y una credencial del esquema antiguo sigue yendo por la query, que es donde
// la API la espera mientras dure la convivencia.
const viejo = spawn("node", ["dist/index.js"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, AZBOX_TOKEN: LEGACY, AZBOX_BASE_URL: "http://localhost:4799" },
  stdio: ["pipe", "pipe", "pipe"],
});
const antes = recibido.porQuery;
viejo.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
  }) + "\n",
);
await new Promise((r) => viejo.stdout.once("data", r));
viejo.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
viejo.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "azbox_list_projects", arguments: {} } }) + "\n",
);
await new Promise((r) => viejo.stdout.once("data", r));
ok(recibido.porQuery > antes, "una credencial antigua va por ?api_key=");
viejo.kill();

api.close();
console.log(`\n  ${fallos.length === 0 ? "TODO OK" : `${fallos.length} FALLO(S)`}`);
process.exit(fallos.length === 0 ? 0 : 1);
