import cds from "@sap/cds";
import { Parser } from "@dbml/core";
import { csn2dbml } from "./csn2dbml.js";

export interface DBMLOptions {
  project?: string;
  sort?: boolean;
  tableGroups?: boolean;
  validate?: boolean;
}

type CompileEventPayload = {
  csn: object;
  options: DBMLOptions;
  result?: string;
};

type CdsWithEvents = typeof cds & {
  emit(event: string, payload: CompileEventPayload): boolean;
};

const cdsWithEvents = cds as CdsWithEvents;

const events = {
  before: "compile.to.dbml",
  after: "after:compile.to.dbml",
};

/**
 * Validates a DBML document using the DBML parser.
 *
 * @param dbml DBML source to validate.
 * @returns Nothing when the document is valid or empty.
 * @throws {Error} When the parser rejects the DBML document.
 */
export function validateDBML(dbml: string): void {
  if (!dbml || typeof dbml !== "string") return;
  try {
    Parser.parse(dbml, "dbml");
  } catch (err: unknown) {
    const msg = getDbmlParseErrorMessage(err);
    throw new Error(`DBML Syntax Error: ${msg || "Invalid DBML structure"}`, { cause: err });
  }
}

function getDbmlParseErrorMessage(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.message === "string") return error.message;
  if (!Array.isArray(error.diags)) return undefined;

  return error.diags
    .map((diagnostic) => {
      if (isRecord(diagnostic) && typeof diagnostic.message === "string") {
        return diagnostic.message;
      }
      return String(diagnostic);
    })
    .join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Compiles a CAP CSN model into a DBML document.
 *
 * Emits the compile-to-DBML lifecycle events, allowing listeners to adjust options or the result.
 * Validation runs by default.
 *
 * @param csn CAP model in CSN notation.
 * @param options Output options, including sorting, project metadata, table groups, and validation.
 * @returns The generated DBML document, terminated with a newline.
 * @throws {Error} When generated DBML validation fails.
 */
export function compileToDBML(csn: object, options: DBMLOptions = {}): string {
  cdsWithEvents.emit(events.before, { csn, options });
  let result = csn2dbml(csn, options);
  const param = { csn, options, result };
  cdsWithEvents.emit(events.after, param);
  if (param.result !== undefined) {
    result = param.result;
  }
  if (options.validate !== false) {
    validateDBML(result);
  }
  return result;
}

compileToDBML.events = events;
