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
  /**
   * Called before DBML conversion is started.
   * Can be used to modify the CSN or options before conversion.
   */
  before: "compile.to.dbml",
  /**
   * Called after DBML conversion is done.
   * Can be used to modify the resulting DBML string before returning.
   */
  after: "after:compile.to.dbml",
};

/**
 * Validates DBML string syntax using @dbml/core.
 * @param {string} dbml
 */
export function validateDBML(dbml: string): void {
  if (!dbml || typeof dbml !== "string") return;
  try {
    Parser.parse(dbml, "dbml");
  } catch (err) {
    let msg = err.message;
    if (!msg && err.diags && err.diags.length > 0) {
      msg = err.diags.map((d) => d.message || d.toString() || "DBML syntax error").join("; ");
    }
    throw new Error(`DBML Syntax Error: ${msg || "Invalid DBML structure"}`, { cause: err });
  }
}

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

export default compileToDBML;
