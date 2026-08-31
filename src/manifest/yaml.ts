import { ManifestParseError } from "./errors.js";

interface SourceLine {
  readonly number: number;
  readonly indent: number;
  readonly text: string;
}

interface KeyValue {
  readonly key: string;
  readonly value: string;
}

/**
 * Parse the deliberately small YAML vocabulary used by canonical task
 * manifests. Keeping this parser dependency-free is important because the
 * manifest is read by the daemon before any optional runtime is installed.
 * It supports block maps/sequences, flow sequences, quoted scalars, comments,
 * booleans, null, and numbers. Unsupported YAML constructs fail closed.
 */
export function parseManifestYaml(source: string): unknown {
  const lines = sourceLines(source);
  if (lines.length === 0) return null;

  if (lines[0]?.indent !== 0) {
    throw parseError(lines[0], "the document must start at indentation zero");
  }

  const parsed = parseBlock(lines, 0, lines[0]?.indent ?? 0);
  if (parsed.nextIndex !== lines.length) {
    const line = lines[parsed.nextIndex];
    throw parseError(line, "unexpected content after the document");
  }
  return parsed.value;
}

function sourceLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  for (const [index, rawLine] of normalized.split("\n").entries()) {
    if (/\t/.test(rawLine)) {
      throw new ManifestParseError(`YAML line ${index + 1}: tabs are not supported for indentation`);
    }
    const withoutComment = stripComment(rawLine);
    if (withoutComment.trim() === "") continue;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    const text = withoutComment.trim();
    if (text === "---" || text === "...") {
      throw new ManifestParseError(`YAML line ${index + 1}: multiple documents are not supported`);
    }
    result.push({ number: index + 1, indent, text });
  }
  return result;
}

function stripComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === "'" && character === "'") {
      if (line[index + 1] === "'") {
        index += 1;
      } else {
        quote = null;
      }
      continue;
    }
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === null && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (quote === null && character === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index);
    }
  }
  if (quote !== null) throw new ManifestParseError("YAML: unterminated quoted scalar");
  return line;
}

function parseBlock(lines: readonly SourceLine[], index: number, indent: number): { value: unknown; nextIndex: number } {
  const line = lines[index];
  if (line === undefined) throw new ManifestParseError("YAML: expected a value");
  if (line.indent !== indent) throw parseError(line, `expected indentation ${indent}`);
  return line.text === "-" || line.text.startsWith("- ")
    ? parseSequence(lines, index, indent)
    : parseMap(lines, index, indent);
}

function parseMap(lines: readonly SourceLine[], start: number, indent: number): { value: Record<string, unknown>; nextIndex: number } {
  const value: Record<string, unknown> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || line.indent !== indent || line.text === "-" || line.text.startsWith("- ")) break;
    const keyValue = splitKeyValue(line.text, line);
    if (keyValue === undefined) throw parseError(line, "mapping entry must contain a key");
    addMapEntry(value, keyValue, lines, index, indent);
    index = nextMapIndex(lines, index, indent, keyValue.value);
  }
  if (index === start) throw parseError(lines[start], "expected a mapping entry");
  return { value, nextIndex: index };
}

function nextMapIndex(lines: readonly SourceLine[], current: number, indent: number, rawValue: string): number {
  const next = current + 1;
  if (rawValue !== "" || next >= lines.length || (lines[next]?.indent ?? 0) <= indent) return next;
  const nested = parseBlock(lines, next, lines[next]?.indent ?? indent + 1);
  return nested.nextIndex;
}

function addMapEntry(target: Record<string, unknown>, keyValue: KeyValue, lines: readonly SourceLine[], index: number, parentIndent: number): void {
  if (Object.hasOwn(target, keyValue.key)) throw parseError(lines[index], `duplicate mapping key ${keyValue.key}`);
  target[keyValue.key] = parseEntryValue(keyValue.value, lines, index, parentIndent);
}

function parseSequence(lines: readonly SourceLine[], start: number, indent: number): { value: unknown[]; nextIndex: number } {
  const value: unknown[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || line.indent !== indent || !(line.text === "-" || line.text.startsWith("- "))) break;
    const remainder = line.text.slice(1).trim();
    if (remainder === "") {
      if (index + 1 >= lines.length || (lines[index + 1]?.indent ?? 0) <= indent) {
        value.push(null);
        index += 1;
      } else {
        const nested = parseBlock(lines, index + 1, lines[index + 1]?.indent ?? indent + 1);
        value.push(nested.value);
        index = nested.nextIndex;
      }
      continue;
    }

    const firstEntry = splitKeyValue(remainder, line, true);
    if (firstEntry === undefined) {
      value.push(parseScalar(remainder, line));
      index += 1;
      continue;
    }

    const object: Record<string, unknown> = {};
    addMapEntry(object, firstEntry, lines, index, indent);
    index = nextMapIndex(lines, index, indent, firstEntry.value);
    while (index < lines.length && (lines[index]?.indent ?? 0) > indent) {
      const continuation = lines[index];
      if (continuation === undefined) break;
      const continuationEntry = splitKeyValue(continuation.text, continuation);
      if (continuationEntry === undefined) throw parseError(continuation, "sequence mapping continuation must contain a key");
      addMapEntry(object, continuationEntry, lines, index, continuation.indent);
      index = nextMapIndex(lines, index, continuation.indent, continuationEntry.value);
    }
    value.push(object);
  }
  if (index === start) throw parseError(lines[start], "expected a sequence entry");
  return { value, nextIndex: index };
}

function parseEntryValue(rawValue: string, lines: readonly SourceLine[], index: number, parentIndent: number): unknown {
  if (rawValue !== "") return parseScalar(rawValue, lines[index]);
  const next = lines[index + 1];
  if (next === undefined || next.indent <= parentIndent) return null;
  return parseBlock(lines, index + 1, next.indent).value;
}

function splitKeyValue(text: string, line: SourceLine, sequenceEntry = false): KeyValue | undefined {
  const colon = findUnquoted(text, ":");
  if (colon <= 0) {
    if (sequenceEntry) return undefined;
    throw parseError(line, "mapping entry must contain a key");
  }
  const key = parseKey(text.slice(0, colon).trim(), line);
  const value = text.slice(colon + 1).trim();
  return { key, value };
}

function findUnquoted(text: string, wanted: string): number {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote === "'" && character === "'") {
      if (text[index + 1] === "'") index += 1;
      else quote = null;
      continue;
    }
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === null && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (quote === null && character === wanted) return index;
  }
  return -1;
}

function parseKey(raw: string, line: SourceLine): string {
  const value = parseScalar(raw, line);
  if (typeof value !== "string" || value === "") throw parseError(line, "mapping keys must be non-empty strings");
  return value;
}

function parseScalar(raw: string, line: SourceLine | undefined): unknown {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith("[") || value.endsWith("]")) return parseFlowSequence(value, line);
  if (value.startsWith("{") || value.endsWith("}")) throw parseError(line, "flow mappings are not supported");
  if (value.startsWith("&") || value.startsWith("*") || value.startsWith("!") || value === "|" || value === ">") {
    throw parseError(line, "anchors, tags, and block scalars are not supported");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return parseQuoted(value, line);
  }
  if (value.includes("\0")) throw parseError(line, "NUL is not allowed");
  return value;
}

function parseFlowSequence(value: string, line: SourceLine | undefined): unknown[] {
  if (!value.startsWith("[") || !value.endsWith("]")) throw parseError(line, "unterminated flow sequence");
  const body = value.slice(1, -1).trim();
  if (body === "") return [];
  const items = splitFlowItems(body, line);
  return items.map((item) => parseScalar(item, line));
}

function splitFlowItems(body: string, line: SourceLine | undefined): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote === "'" && character === "'") {
      if (body[index + 1] === "'") index += 1;
      else quote = null;
      continue;
    }
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === null && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (quote !== null) continue;
    if (character === "[") depth += 1;
    if (character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      const item = body.slice(start, index).trim();
      if (item === "") throw parseError(line, "flow sequence contains an empty item");
      items.push(item);
      start = index + 1;
    }
  }
  if (quote !== null || depth !== 0) throw parseError(line, "malformed flow sequence");
  const finalItem = body.slice(start).trim();
  if (finalItem === "") throw parseError(line, "flow sequence contains an empty item");
  items.push(finalItem);
  return items;
}

function parseQuoted(value: string, line: SourceLine | undefined): string {
  const quote = value[0];
  if (value[value.length - 1] !== quote) throw parseError(line, "unterminated quoted scalar");
  const body = value.slice(1, -1);
  if (quote === "'") return body.replaceAll("''", "'");
  try {
    return JSON.parse(value) as string;
  } catch {
    throw parseError(line, "invalid double-quoted scalar");
  }
}

function parseError(line: SourceLine | undefined, message: string): ManifestParseError {
  return new ManifestParseError(line === undefined ? `YAML: ${message}` : `YAML line ${line.number}: ${message}`);
}
