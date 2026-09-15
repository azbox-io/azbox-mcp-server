export const SERVER_NAME = "azbox-mcp-server";
export const SERVER_VERSION = "0.1.1";

export const DEFAULT_BASE_URL = "https://api.azbox.io";

/**
 * Tope de caracteres por respuesta.
 *
 * Un proyecto grande tiene decenas de miles de claves, y volcarlas todas en la
 * ventana de contexto del agente no le sirve de nada: se queda sin sitio para
 * el código que está escribiendo. Todas las herramientas que listan pagina, y
 * si aun así una página se pasa de este tope se recorta avisando.
 */
export const CHARACTER_LIMIT = 25_000;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
