import { CHARACTER_LIMIT } from "../constants.js";
import type { RawKeyword } from "./client.js";

/** Clave y traducción de una keyword, ya normalizadas. */
export interface Entry {
  key: string;
  translation: string | null;
  context?: string;
  reference?: string;
}

/**
 * Normaliza la respuesta cruda.
 *
 * La clave sale de `data.keyword`. El `id` de la respuesta es el identificador
 * interno del documento y se genera solo: indexar por él da un diccionario de
 * cadenas aleatorias.
 */
export function toEntries(keywords: RawKeyword[]): Entry[] {
  const entries: Entry[] = [];
  for (const item of keywords) {
    const key = item?.data?.keyword;
    if (typeof key !== "string" || key === "") continue;
    const raw = item.data.translation;
    entries.push({
      key,
      translation: typeof raw === "string" && raw !== "" ? raw : null,
      ...(item.data.context ? { context: item.data.context } : {}),
      ...(item.data.reference ? { reference: item.data.reference } : {}),
    });
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries;
}

export interface Page<T> {
  items: T[];
  total_count: number;
  has_more: boolean;
  next_offset: number | null;
}

export function paginate<T>(items: T[], offset: number, limit: number): Page<T> {
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return {
    items: slice,
    total_count: items.length,
    has_more: end < items.length,
    next_offset: end < items.length ? end : null,
  };
}

/**
 * Recorta el texto si se pasa del tope, dejando claro que está recortado.
 *
 * Es preferible a devolverlo entero: una respuesta que se come el contexto del
 * agente le impide seguir trabajando, y el agente no puede saber que le pasó
 * eso si no se lo dices.
 */
export function capText(text: string, hint: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[Recortado en ${CHARACTER_LIMIT} caracteres. ${hint}]`
  );
}

/** Tabla markdown de claves y traducciones. */
export function entriesToMarkdown(entries: Entry[], page: Page<Entry>): string {
  if (entries.length === 0) return "Sin resultados.";
  const lines = [
    `${page.total_count} claves en total, mostrando ${entries.length}.`,
    "",
    "| Clave | Traducción |",
    "| --- | --- |",
  ];
  for (const e of entries) {
    const value = e.translation === null ? "_(sin traducir)_" : escapeCell(e.translation);
    lines.push(`| \`${escapeCell(e.key)}\` | ${value} |`);
  }
  if (page.has_more) {
    lines.push("", `Hay más: repite con offset ${page.next_offset}.`);
  }
  return lines.join("\n");
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}
