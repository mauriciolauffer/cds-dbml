import type { csn } from "@sap/cds";
import type { DBMLOptions } from "./index.js";
import cds from "@sap/cds";

type Csn = csn.CSN;
type CsnDefinition = csn.Definition & CsnTypeFacets & { enum?: Record<string, CsnEnumValue> };
type CsnElement = Omit<csn.EntityElements[string], "default"> & { default?: CsnDefault };
type CsnTypeFacets = Pick<CsnElement, "type" | "length" | "precision" | "scale">;
type CsnType = CsnTypeFacets;
type CsnEnumValue = Record<string, unknown> & { val?: string | number | boolean };
type CsnDefault = { val?: string | number | boolean; xpr?: unknown[] } | string | number | boolean;
type I18nResolver = (value: string | undefined) => string | undefined;
type DbmlEnum = { name: string; values: DbmlEnumValue[]; note?: string };
type DbmlEnumValue = { name: string; val: string | number | boolean; note?: string };
type DbmlColumn = {
  name: string;
  type: string;
  isPk: boolean;
  isNotNull: boolean;
  default?: string;
  note?: string;
};
type DbmlTable = { name: string; columns: DbmlColumn[]; note?: string };
type DbmlRelationship = { ref: string };
type DbmlTableGroup = { name: string; tables: string[] };

/**
 * Renders a CAP CSN model as DBML without lifecycle events or syntax validation.
 *
 * Resolves CAP i18n placeholders in notes using the model's default language bundle.
 *
 * @param csn CAP model in CSN notation.
 * @param options Output options controlling project metadata, ordering, and table groups.
 * @returns The generated DBML document, or an empty string when the model has no definitions.
 */
export function csn2dbml(csn: Csn, options: DBMLOptions = {}) {
  if (!csn || !csn.definitions) {
    return "";
  }

  const model = (cds.reflect?.(csn) ?? csn) as unknown as Csn;
  const resolveI18nText = createI18nResolver(csn);
  let sqlModel: Csn | undefined;
  try {
    if (cds.compile?.for?.sql) {
      sqlModel = cds.compile.for.sql(csn) as unknown as Csn;
    }
  } catch {
    // Fallback if sql compile fails on partial CSN
  }

  const lines: string[] = [];

  if (options.project) {
    lines.push(`Project "${options.project}" {`);
    lines.push("  database_type: 'CAP CDS'");
    lines.push("}\n");
  }

  const enums = collectEnums(csn, model, resolveI18nText);
  const tables = collectTables(csn, model, sqlModel, enums, resolveI18nText);
  const relationships = collectRelationships(csn, model, sqlModel, tables);
  const tableGroups = collectTableGroups(tables, options);

  if (options.sort) {
    enums.sort((a, b) => a.name.localeCompare(b.name));
    tables.sort((a, b) => a.name.localeCompare(b.name));
    relationships.sort((a, b) => a.ref.localeCompare(b.ref));
    tableGroups.sort((a, b) => a.name.localeCompare(b.name));
  }

  for (const enm of enums) {
    lines.push(`Enum "${enm.name}" {`);
    for (const val of enm.values) {
      const noteStr = val.note ? ` [note: ${formatString(val.note)}]` : "";
      lines.push(`  "${val.name}"${noteStr}`);
    }
    lines.push("}\n");
  }

  for (const table of tables) {
    const tableNote = table.note ? ` [note: ${formatString(table.note)}]` : "";
    lines.push(`Table "${table.name}"${tableNote} {`);

    if (options.sort) {
      table.columns.sort((a, b) => a.name.localeCompare(b.name));
    }

    for (const col of table.columns) {
      const settings = [];
      if (col.isPk) settings.push("pk");
      if (col.isNotNull && !col.isPk) settings.push("not null");
      if (col.default !== undefined) settings.push(`default: ${col.default}`);
      if (col.note) settings.push(`note: ${formatString(col.note)}`);

      const settingsStr = settings.length ? ` [${settings.join(", ")}]` : "";
      lines.push(`  "${col.name}" ${col.type}${settingsStr}`);
    }

    lines.push("}\n");
  }

  if (relationships.length > 0) {
    for (const rel of relationships) {
      lines.push(rel.ref);
    }
    lines.push("");
  }

  if (options.tableGroups !== false) {
    for (const tg of tableGroups) {
      lines.push(`TableGroup "${tg.name}" {`);
      for (const tableName of tg.tables) {
        lines.push(`  "${tableName}"`);
      }
      lines.push("}\n");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function collectEnums(csn: Csn, _model: Csn, resolveI18nText: I18nResolver): DbmlEnum[] {
  const enums: DbmlEnum[] = [];
  const defs = (csn.definitions || {}) as unknown as Record<string, CsnDefinition>;

  for (const [name, def] of Object.entries(defs)) {
    if ((def.kind === "type" || !def.kind) && def.enum) {
      const values = [];
      for (const [key, valObj] of Object.entries(def.enum)) {
        const val = valObj.val ?? key;
        const note =
          getNote(valObj, resolveI18nText) || (val !== key ? `Value: ${val}` : undefined);
        values.push({ name: key, val, note });
      }
      enums.push({
        name,
        values,
        note: getNote(def, resolveI18nText),
      });
    }
  }

  return enums;
}

function collectTables(
  csn: Csn,
  model: Csn,
  sqlModel: Csn | undefined,
  enums: DbmlEnum[],
  resolveI18nText: I18nResolver,
): DbmlTable[] {
  const tables: DbmlTable[] = [];
  const defs = (model.definitions || csn.definitions || {}) as unknown as Record<
    string,
    CsnDefinition
  >;
  const sqlDefs = (sqlModel?.definitions || {}) as unknown as Record<string, CsnDefinition>;
  const enumNames = new Set(enums.map((e) => e.name));

  for (const [name, def] of Object.entries(defs)) {
    if (def.kind !== "entity") continue;
    if (def["@cds.persistence.skip"] === true || def["@cds.persistence.exists"] === true) continue;

    const sqlDef = sqlDefs[name];
    const elements = (sqlDef?.elements || def.elements || {}) as Record<string, CsnElement>;
    const origElements = (def.elements || {}) as Record<string, CsnElement>;
    const columns = [];

    const pkKeys = new Set();
    if (def.keys) {
      for (const [k, v] of Object.entries(def.keys)) {
        if (v.ref) {
          pkKeys.add(v.ref[0]);
        } else {
          pkKeys.add(k);
        }
      }
    }

    for (const [elName, elDef] of Object.entries(elements)) {
      const origElDef = origElements[elName] || elDef;
      // Associations and compositions are represented via Ref relationships, not table columns
      if (
        elDef.type === "cds.Association" ||
        elDef.type === "cds.Composition" ||
        origElDef.type === "cds.Association" ||
        origElDef.type === "cds.Composition"
      ) {
        continue;
      }
      const isPk = pkKeys.has(elName) || elDef.key === true || origElDef.key === true;
      const isNotNull =
        isPk ||
        elDef.notNull === true ||
        elDef["@mandatory"] === true ||
        origElDef.notNull === true;
      const type = resolveColumnType(elDef, origElDef, defs, enumNames);
      const defaultVal = formatDefaultValue(elDef.default || origElDef.default);
      const note = getNote(origElDef, resolveI18nText) || getNote(elDef, resolveI18nText);
      columns.push({
        name: elName,
        type,
        isPk,
        isNotNull,
        default: defaultVal,
        note,
      });
    }

    tables.push({
      name,
      columns,
      note: getNote(def, resolveI18nText),
    });
  }
  return tables;
}

function resolveColumnType(
  elDef: CsnType,
  origElDef: CsnType,
  defs: Record<string, CsnDefinition>,
  enumNames: Set<string>,
): string {
  const origType = origElDef?.type;
  if (origType && enumNames.has(origType)) {
    return `"${origType}"`;
  }
  if (origType && defs[origType]) {
    const typeDef = defs[origType];
    if (typeDef.kind === "type" && typeDef.enum && enumNames.has(origType)) {
      return `"${origType}"`;
    }
  }

  const rawType = elDef.type || origType;
  if (!rawType) return "varchar";

  if (rawType && enumNames.has(rawType)) {
    return `"${rawType}"`;
  }

  const typeDef = defs[rawType];
  if (typeDef && typeDef.kind === "type") {
    if (typeDef.enum && enumNames.has(rawType)) {
      return `"${rawType}"`;
    }
    if (typeDef.type) {
      return resolveColumnType(elDef, typeDef, defs, enumNames);
    }
  }

  const length = elDef.length || origElDef?.length;
  const precision = elDef.precision || origElDef?.precision;
  const scale = elDef.scale || origElDef?.scale;

  switch (rawType) {
    case "cds.UUID":
      return "varchar(36)";
    case "cds.String":
      return length ? `varchar(${length})` : "varchar";
    case "cds.LargeString":
      return "text";
    case "cds.Integer":
    case "cds.Int32":
      return "integer";
    case "cds.Int16":
      return "smallint";
    case "cds.Int64":
      return "bigint";
    case "cds.Decimal":
      return precision ? `decimal(${precision}, ${scale || 0})` : "decimal";
    case "cds.Double":
      return "double";
    case "cds.Float":
      return "float";
    case "cds.Boolean":
      return "boolean";
    case "cds.Date":
      return "date";
    case "cds.Time":
      return "time";
    case "cds.DateTime":
    case "cds.Timestamp":
      return "timestamp";
    case "cds.Binary":
      return length ? `binary(${length})` : "binary";
    case "cds.LargeBinary":
      return "blob";
    default:
      if (rawType?.startsWith("cds.")) {
        return rawType.replace(/^cds\./, "").toLowerCase();
      }
      return `"${rawType}"`;
  }
}

function collectRelationships(
  csn: Csn,
  model: Csn,
  _sqlModel: Csn | undefined,
  tables: DbmlTable[] = [],
): DbmlRelationship[] {
  const relationships: DbmlRelationship[] = [];
  const defs = (model.definitions || csn.definitions || {}) as unknown as Record<
    string,
    CsnDefinition
  >;
  const seenRefs = new Set<string>();
  const tableColumnsMap = new Map<string, Set<string>>();
  for (const t of tables) {
    tableColumnsMap.set(t.name, new Set(t.columns.map((c) => c.name)));
  }
  for (const [entityName, entityDef] of Object.entries(defs)) {
    if (entityDef.kind !== "entity") continue;
    if (
      entityDef["@cds.persistence.skip"] === true ||
      entityDef["@cds.persistence.exists"] === true
    )
      continue;

    const elements = entityDef.elements || {};
    for (const [elName, elDef] of Object.entries(elements)) {
      if (elDef.type !== "cds.Association" && elDef.type !== "cds.Composition") continue;

      const targetName = elDef.target;
      if (!targetName) continue;
      const targetDef = defs[targetName];
      if (!targetDef || targetDef.kind !== "entity") continue;

      const isToMany = elDef.cardinality?.max === "*";
      if (!isToMany) {
        // To-one association / composition
        // Foreign key field is usually in source entity (e.g., author_ID)
        let fkName = `${elName}_ID`;
        if (elDef.keys && elDef.keys[0]?.ref) {
          fkName = `${elName}_${elDef.keys[0].ref[0]}`;
        }

        // Target PK name
        let targetPk = "ID";
        if (targetDef.keys) {
          const firstKey = Object.keys(targetDef.keys)[0];
          if (firstKey) targetPk = firstKey;
        }

        // Verify that source and target tables exist and contain the foreign key and primary key columns
        const sourceCols = tableColumnsMap.get(entityName);
        const targetCols = tableColumnsMap.get(targetName);

        if (sourceCols?.has(fkName) && targetCols?.has(targetPk)) {
          const refLine = `Ref: "${entityName}"."${fkName}" > "${targetName}"."${targetPk}"`;
          if (!seenRefs.has(refLine)) {
            seenRefs.add(refLine);
            relationships.push({ ref: refLine });
          }
        }
      }
    }
  }

  return relationships;
}

function collectTableGroups(tables: DbmlTable[], _options: DBMLOptions): DbmlTableGroup[] {
  const groupsMap = new Map<string, string[]>();
  for (const table of tables) {
    const parts = table.name.split(".");
    if (parts.length > 1) {
      const namespace = parts.slice(0, -1).join(".");
      if (!groupsMap.has(namespace)) {
        groupsMap.set(namespace, []);
      }
      groupsMap.get(namespace)?.push(table.name);
    }
  }

  const tableGroups: DbmlTableGroup[] = [];
  for (const [name, groupTables] of groupsMap.entries()) {
    tableGroups.push({
      name,
      tables: groupTables,
    });
  }
  return tableGroups;
}

function formatDefaultValue(defaultVal: CsnDefault | undefined): string | undefined {
  if (defaultVal === undefined || defaultVal === null) return undefined;
  if (typeof defaultVal === "object" && "val" in defaultVal) {
    defaultVal = defaultVal.val;
  }
  if (typeof defaultVal === "string") {
    return `'${defaultVal}'`;
  }
  if (typeof defaultVal === "number" || typeof defaultVal === "boolean") {
    return `${defaultVal}`;
  }
  if (typeof defaultVal === "object" && "xpr" in defaultVal) {
    return "`expression`";
  }
  return `'${defaultVal}'`;
}

function createI18nResolver(model: Csn): I18nResolver {
  const texts = cds.i18n.bundle4(model).texts4(cds.env.i18n.default_language);

  return (value: string | undefined) =>
    typeof value === "string"
      ? value.replace(/\{i18n>([^}]+)\}/g, (placeholder, key) => {
          const translated = texts[key];
          return typeof translated === "string" ? translated : placeholder;
        })
      : value;
}

function getNote(def: object | undefined, resolveI18nText: I18nResolver) {
  if (!def) return undefined;
  const annotations = def as Record<string, unknown>;
  const note = [
    annotations["@title"],
    annotations["@description"],
    annotations.doc,
    annotations.comment,
    annotations["@cds.doc"],
  ].find((candidate): candidate is string => typeof candidate === "string");
  return resolveI18nText(note);
}

function formatString(str: string) {
  if (!str) return "''";
  const escaped = str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}
