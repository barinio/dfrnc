// Production stubs for leva — zero leva imports, so the bundler drops leva
// entirely from the prod build. Re-implements just enough of useControls/folder/Leva
// to return the default values baked into each schema, matching leva's runtime shape
// for our call sites. TypeScript types still come from controls.dev.ts via the
// "@debug/controls" tsconfig path, so this file only needs to be runtime-compatible.

type Schema = Record<string, unknown>;

interface FolderMarker {
  __folder: true;
  schema: Schema;
}

export function folder(schema: Schema): FolderMarker {
  return { __folder: true, schema };
}

function isFolder(v: unknown): v is FolderMarker {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __folder?: unknown }).__folder === true
  );
}

function extractValues(schema: Schema, out: Record<string, unknown>): void {
  for (const key in schema) {
    const entry = schema[key];
    if (isFolder(entry)) {
      extractValues(entry.schema, out);
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      "value" in (entry as object)
    ) {
      out[key] = (entry as { value: unknown }).value;
    } else {
      out[key] = entry;
    }
  }
}

// Signature variants used in this app: (name, schema) | (name, () => schema).
export function useControls(...args: unknown[]): unknown {
  const schemaArg = typeof args[0] === "string" ? args[1] : args[0];
  const isFn = typeof schemaArg === "function";
  const schema = (isFn ? (schemaArg as () => Schema)() : schemaArg) as Schema;

  const values: Record<string, unknown> = {};
  extractValues(schema, values);

  // Function form returns [values, setter]; object form returns values.
  return isFn ? [values, () => {}] : values;
}

export function Leva(): null {
  return null;
}
