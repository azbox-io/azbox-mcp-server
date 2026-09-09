import { DEFAULT_BASE_URL } from "../constants.js";

/**
 * Cliente de la API de AZbox.
 *
 * Solo lectura, y a propósito. La API tiene un POST /v1/translation/translate
 * que es un proxy directo a DeepL con la clave de AZbox y sin scope de
 * proyecto: exponerlo como herramienta permitiría a un agente en bucle gastar
 * la cuota de DeepL de la cuenta. Este servidor no lo ofrece.
 */

export class AzboxError extends Error {
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, options: { status?: number; detail?: string } = {}) {
    super(message);
    this.name = "AzboxError";
    this.status = options.status;
    this.detail = options.detail;
  }
}

export interface Credentials {
  token: string;
  baseUrl?: string;
}

/** Una keyword tal y como la devuelve la API. */
export interface RawKeyword {
  id: string;
  data: {
    /** El nombre de la clave. Esto es lo que se usa en el código, NO `id`. */
    keyword?: string;
    /** Ausente cuando esa clave no tiene texto en el idioma pedido. */
    translation?: string;
    context?: string;
    comment?: string;
    reference?: string;
    categories?: string[];
    createdAt?: unknown;
    updatedAt?: unknown;
  };
}

export interface RawProject {
  id: string;
  data: {
    name?: string;
    type?: string;
    languages?: (string | null)[];
    categories?: string[];
  };
}

function credentialsFrom(env: NodeJS.ProcessEnv): Credentials {
  const token = env.AZBOX_TOKEN ?? env.AZBOX_API_KEY;
  if (!token) {
    throw new AzboxError(
      "No hay credencial. Define AZBOX_TOKEN en la configuración del servidor MCP " +
        "con la clave de API que aparece en el panel de AZbox.",
    );
  }
  return { token, baseUrl: env.AZBOX_BASE_URL ?? DEFAULT_BASE_URL };
}

export class AzboxClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    credentials?: Credentials,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    const resolved = credentials ?? credentialsFrom(process.env);
    this.token = resolved.token;
    this.baseUrl = resolved.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = fetchImpl;
  }

  private async get<T>(
    path: string,
    params: Record<string, string | undefined> = {},
  ): Promise<T | null> {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set("token", this.token);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
      });
    } catch (cause) {
      throw new AzboxError(
        `No se pudo conectar con ${this.baseUrl}: ${(cause as Error).message}`,
      );
    }

    if (response.status === 404) {
      // La API usa 404 tanto para "no existe" como para "está vacío". Se
      // devuelve null y cada herramienta decide qué significa en su caso.
      const detail = await readDetail(response);
      if (detail && /language/i.test(detail)) {
        throw new AzboxError(
          "Ese idioma no existe en el proyecto. Consulta los idiomas con azbox_get_project.",
          { status: 404, detail },
        );
      }
      return null;
    }

    if (response.status === 401) {
      throw new AzboxError(
        "La API rechazó la credencial. Revisa AZBOX_TOKEN en la configuración del servidor.",
        { status: 401, detail: await readDetail(response) },
      );
    }

    if (!response.ok) {
      throw new AzboxError(`La API respondió ${response.status}.`, {
        status: response.status,
        detail: await readDetail(response),
      });
    }

    return (await response.json()) as T;
  }

  /** Proyectos de la cuenta. */
  async listProjects(): Promise<RawProject[]> {
    return (await this.get<RawProject[]>("/v1/projects/")) ?? [];
  }

  /** Un proyecto. `null` si no existe o no pertenece a esta cuenta. */
  async getProject(projectId: string): Promise<RawProject["data"] | null> {
    return await this.get<RawProject["data"]>(
      `/v1/projects/${encodeURIComponent(projectId)}`,
    );
  }

  /** Categorías de un proyecto. */
  async listCategories(projectId: string): Promise<RawProject[]> {
    return (
      (await this.get<RawProject[]>(
        `/v1/projects/${encodeURIComponent(projectId)}/categories`,
      )) ?? []
    );
  }

  /**
   * Keywords de un proyecto en un idioma.
   *
   * Lista vacía cuando no hay ninguna: la API contesta 404 en ese caso y eso
   * es "todavía no hay nada", no un fallo.
   */
  async listKeywords(
    projectId: string,
    language: string,
    afterUpdatedAt?: string,
  ): Promise<RawKeyword[]> {
    return (
      (await this.get<RawKeyword[]>(
        `/v1/projects/${encodeURIComponent(projectId)}/keywords`,
        { language, afterUpdatedAtStr: afterUpdatedAt },
      )) ?? []
    );
  }
}

async function readDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return undefined;
  }
}
