import type { DBMLOptions } from "./index.js";
import cds from "@sap/cds";

type Csn = { definitions?: Record<string, any> };

export function csn2dbml(csn: Csn, options: DBMLOptions = {}) {
  if (!csn || !csn.definitions) {
    return "";
  }

  const model = cds.reflect ? cds.reflect(csn) : csn;
  const resolveI18nText = createI18nResolver(csn);
  let sqlModel;
  try {
    if (cds.compile?.for?.sql) {
      sqlModel = cds.compile.for.sql(csn);
    }
  } catch {
    // Fallback if sql compile fails on partial CSN
  }

  const lines = [];

  // 1. Project Header (if provided)
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

  // Format Enums
  for (const enm of enums) {
    lines.push(`Enum "${enm.name}" {`);
    for (const val of enm.values) {
      const noteStr = val.note ? ` [note: ${formatString(val.note)}]` : "";
      lines.push(`  "${val.name}"${noteStr}`);
    }
    lines.push("}\n");
  }

  // Format Tables
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

  // Format Relationships
  if (relationships.length > 0) {
    for (const rel of relationships) {
      lines.push(rel.ref);
    }
    lines.push("");
  }

  // Format TableGroups
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

function collectEnums(csn, _model, resolveI18nText) {
  const enums = [];
  const defs: Record<string, any> = csn.definitions || {};

  for (const [name, def] of Object.entries(defs)) {
    if ((def.kind === "type" || !def.kind) && def.enum) {
      const values = [];
      for (const [key, valObj] of Object.entries(def.enum)) {
        const val =
          typeof valObj === "object" && valObj !== null && "val" in valObj ? valObj.val : key;
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

function collectTables(csn, model, sqlModel, enums, resolveI18nText) {
  const tables = [];
  const defs: Record<string, any> = model.definitions || csn.definitions || {};
  const sqlDefs: Record<string, any> = sqlModel?.definitions || {};
  const enumNames = new Set(enums.map((e) => e.name));

  for (const [name, def] of Object.entries(defs)) {
    if (def.kind !== "entity") continue;
    if (def["@cds.persistence.skip"] === true || def["@cds.persistence.exists"] === true) continue;

    const sqlDef = sqlDefs[name];
    const elements = sqlDef?.elements || def.elements || {};
    const origElements = def.elements || {};
    const columns = [];

    // Identify primary keys
    const pkKeys = new Set();
    if (def.keys) {
      for (const [k, v] of Object.entries(def.keys) as [string, any][]) {
        if (v && typeof v === "object" && v.ref) {
          pkKeys.add(v.ref[0]);
        } else {
          pkKeys.add(k);
        }
      }
    }

    for (const [elName, elDef] of Object.entries(elements) as [string, any][]) {
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

function resolveColumnType(elDef, origElDef, defs, enumNames) {
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

  // Check enum reference
  if (rawType && enumNames.has(rawType)) {
    return `"${rawType}"`;
  }

  // Check type alias in defs
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
      return rawType ? `"${rawType}"` : "varchar";
  }
}

function collectRelationships(csn, model, _sqlModel, tables = []) {
  const relationships = [];
  const defs: Record<string, any> = model.definitions || csn.definitions || {};
  const seenRefs = new Set();
  const tableColumnsMap = new Map();
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
    for (const [elName, elDef] of Object.entries(elements) as [string, any][]) {
      if (elDef.type !== "cds.Association" && elDef.type !== "cds.Composition") continue;

      const targetName = elDef.target;
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

function collectTableGroups(tables, _options) {
  const groupsMap = new Map();
  for (const table of tables) {
    const parts = table.name.split(".");
    if (parts.length > 1) {
      const namespace = parts.slice(0, -1).join(".");
      if (!groupsMap.has(namespace)) {
        groupsMap.set(namespace, []);
      }
      groupsMap.get(namespace).push(table.name);
    }
  }

  const tableGroups = [];
  for (const [name, groupTables] of groupsMap.entries()) {
    tableGroups.push({
      name,
      tables: groupTables,
    });
  }
  return tableGroups;
}

function formatDefaultValue(defaultVal) {
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

function createI18nResolver(model: Csn) {
  const texts = cds.i18n.bundle4(model).texts4(cds.env.i18n.default_language);

  return (value) =>
    typeof value === "string"
      ? value.replace(/\{i18n>([^}]+)\}/g, (placeholder, key) => {
          const translated = texts[key];
          return typeof translated === "string" ? translated : placeholder;
        })
      : value;
}

function getNote(def, resolveI18nText) {
  if (!def) return undefined;
  const note = def["@title"] || def["@description"] || def.doc || def.comment || def["@cds.doc"];
  return resolveI18nText(note);
}

function formatString(str) {
  if (!str) return "''";
  const escaped = str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}

export default csn2dbml;
