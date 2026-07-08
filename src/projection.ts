// Declarative response-field projection.
// Config maps a tool name to a list of dot-paths that are allowed to survive.
// Everything else in the structured payload is dropped before it reaches the model.
// Array wildcards use [] to mean "every element", e.g. "people[].email".

function getPath(obj: any, parts: string[]): any {
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(target: any, parts: string[], value: any): void {
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

// Walk one dot-path, honoring [] as an array fan-out, copying survivors into out.
function applyOne(src: any, out: any, tokens: string[]): void {
  const wildIdx = tokens.findIndex((t) => t.endsWith("[]"));
  if (wildIdx === -1) {
    const v = getPath(src, tokens);
    if (v !== undefined) setPath(out, tokens, v);
    return;
  }

  const before = tokens.slice(0, wildIdx);
  const arrKey = tokens[wildIdx].slice(0, -2);
  const after = tokens.slice(wildIdx + 1);

  const arr = getPath(src, [...before, arrKey]);
  if (!Array.isArray(arr)) return;

  const outArr = getPath(out, [...before, arrKey]);
  const target: any[] = Array.isArray(outArr) ? outArr : [];
  arr.forEach((el, i) => {
    if (target[i] == null) target[i] = {};
    if (after.length === 0) {
      target[i] = el;
    } else {
      applyOne(el, target[i], after);
    }
  });
  setPath(out, [...before, arrKey], target);
}

export function project(payload: any, fields: string[]): any {
  const out: any = {};
  for (const f of fields) {
    applyOne(payload, out, f.split("."));
  }
  return out;
}

// An MCP tool result carries content[] blocks. Structured JSON usually rides in a
// text block as a stringified object, so we parse, project, and re-stringify.
// If a block isn't JSON we leave it untouched.
export function projectToolResult(result: any, fields: string[]): any {
  if (!result || !Array.isArray(result.content)) return result;
  const content = result.content.map((block: any) => {
    if (block?.type !== "text" || typeof block.text !== "string") return block;
    let parsed: any;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return block;
    }
    const trimmed = project(parsed, fields);
    return { ...block, text: JSON.stringify(trimmed) };
  });
  return { ...result, content };
}
