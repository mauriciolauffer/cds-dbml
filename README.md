# @cap-js/dbml (cds-dbml)

> SAP Cloud Application Programming Model (CAP) plugin to generate Database Markup Language (DBML) schemas from CDS models.

[DBML](https://dbml.dbdocs.io/home/) (Database Markup Language) is an open-source, readable DSL designed to define and document database schema designs. Tools like [dbdocs](https://dbdocs.io) and [dbdiagram.io](https://dbdiagram.io) allow visualizing DBML schemas as interactive database documentation and diagrams.

This plugin allows you to automatically export your CAP data models (`.cds` files) into DBML format via the CAP CLI (`cds compile`) or programmatically via Node.js.

---

## Key Features

- **Entities & Tables**: Converts CDS entities into DBML `Table` blocks.
- **Data Types**: Translates CDS built-in types (`cds.UUID`, `cds.String`, `cds.Integer`, `cds.Decimal`, `cds.Boolean`, `cds.DateTime`, etc.) to standard SQL/DBML types.
- **Primary Keys & Constraints**: Translates `key` properties into DBML primary keys (`[pk]`) and `not null` constraints.
- **Default Values**: Preserves initial default values (`[default: ...]`).
- **Enums**: Maps CDS enum types to DBML `Enum` definitions and typed columns.
- **Associations & Compositions**: Translates CDS associations and compositions into DBML relationships (`Ref: TableA.col > TableB.col`).
- **Documentation & Notes**: Captures doc comments, `@title`, and `@description` annotations into DBML `Note` fields.
- **Table Groups**: Automatically groups entities by CDS namespace into DBML `TableGroup` blocks.
- **Event Hooks**: Synchronous lifecycle hooks (`compile.to.dbml` and `after:compile.to.dbml`) for custom CSN or DBML transformations.

---

## Installation

Install the plugin in your CAP project:

```sh
npm install --save-dev cds-dbml
```

_Note: `@sap/cds` >= 8 is required as a peer dependency._

---

## Usage

### CLI Usage

Once installed, the DBML target is registered automatically with `cds compile`.

```sh
# Generate DBML to stdout
cds compile db --to dbml

# Save DBML to a file
cds compile db --to dbml > schema.dbml

# Output DBML to a target directory
cds compile db --to dbml --dest gen/dbml
```

### Programmatic Usage

You can call the compiler programmatically in Node.js (ES Modules):

```js
import cds from "@sap/cds";
import "cds-dbml"; // Ensures plugin target is registered

const csn = await cds.load("db/schema.cds");

// Generate DBML string
const dbml = cds.compile.to.dbml(csn);
console.log(dbml);
```

Alternatively, import the compiler function directly:

```js
import { compileToDBML } from "cds-dbml";

const dbml = compileToDBML(csn, { sort: true });
```

---

## Event Hooks

You can hook into the compilation lifecycle to inspect or modify the CSN model before conversion, or customize the generated DBML string after conversion:

```js
import cds from "@sap/cds";

// Hook before conversion (modify CSN or options)
cds.on("compile.to.dbml", ({ csn, options }) => {
  // Modify csn or options
});

// Hook after conversion (modify resulting DBML output)
cds.on("after:compile.to.dbml", ({ csn, options, result }) => {
  // result is { dbml: string } or string
});
```

---

## Configuration Options

Options can be passed via CLI arguments or programmatically:

| Option        | Type      | Default     | Description                                                                         |
| ------------- | --------- | ----------- | ----------------------------------------------------------------------------------- |
| `sort`        | `boolean` | `false`     | Sorts entities, columns, and relationships alphabetically for deterministic output. |
| `project`     | `string`  | `undefined` | Project title for the DBML `Project` header block.                                  |
| `tableGroups` | `boolean` | `true`      | Group tables into DBML `TableGroup` blocks by CDS namespace.                        |

Example CLI usage with options:

```sh
cds compile db --to dbml --dbml:sort
```
