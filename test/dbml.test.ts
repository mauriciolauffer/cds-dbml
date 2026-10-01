import { test } from "node:test";
import assert from "node:assert/strict";
import cds from "@sap/cds";
import { Parser } from "@dbml/core";
import "../cds-plugin.js";
import { compileToDBML } from "../lib/compile/index.js";

test("Simple Entity Compilation to DBML", () => {
  const csn = cds
    .compile(`
    namespace my.bookshop;

    entity Books {
      key ID : UUID;
      title  : String(100);
      price  : Decimal(9,2);
      stock  : Integer;
    }
  `)
    .to.csn();

  const dbml = compileToDBML(csn);

  assert.match(dbml, /Table "my\.bookshop\.Books"/);
  assert.match(dbml, /"ID" varchar\(36\) \[pk\]/);
  assert.match(dbml, /"title" varchar\(100\)/);
  assert.match(dbml, /"price" decimal\(9, 2\)/);
  assert.match(dbml, /"stock" integer/);
  assert.match(dbml, /TableGroup "my\.bookshop"/);

  // Validate syntax with @dbml/core
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Localized Entities and Example Schema Syntax Validation", async () => {
  const csn = await cds.load("example/db");
  const dbml = compileToDBML(csn);

  // Must not contain invalid Ref for localized_ID or pseudo association columns
  assert.doesNotMatch(dbml, /localized_ID/);
  assert.doesNotMatch(dbml, /"author"\s+association/);

  // Validate syntax with @dbml/core
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Data Types, Default Values, and Not Null", () => {
  const csn = cds
    .compile(`
    namespace my.sample;

    entity TypesTest {
      key ID        : UUID;
          code      : String(10) default 'ACT' not null;
          count     : Integer default 0;
          isActive  : Boolean default true;
          amount    : Decimal(10,4);
          created   : Timestamp;
          validDate : Date;
          validTime : Time;
          bigNum    : Int64;
          shortNum  : Int16;
          blobData  : LargeBinary;
          textData  : LargeString;
    }
  `)
    .to.csn();

  const dbml = compileToDBML(csn);

  assert.match(dbml, /"code" varchar\(10\) \[not null, default: 'ACT'\]/);
  assert.match(dbml, /"count" integer \[default: 0\]/);
  assert.match(dbml, /"isActive" boolean \[default: true\]/);
  assert.match(dbml, /"amount" decimal\(10, 4\)/);
  assert.match(dbml, /"created" timestamp/);
  assert.match(dbml, /"validDate" date/);
  assert.match(dbml, /"validTime" time/);
  assert.match(dbml, /"bigNum" bigint/);
  assert.match(dbml, /"shortNum" smallint/);
  assert.match(dbml, /"blobData" blob/);
  assert.match(dbml, /"textData" text/);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Enum Definitions and Mapping", () => {
  const csn = cds
    .compile(`
    namespace my.bookshop;

    type Genre : String enum {
      FICTION = 'F';
      NON_FICTION = 'NF';
    }

    entity Books {
      key ID    : UUID;
          title : String(100);
          genre : Genre;
    }
  `)
    .to.csn();

  const dbml = compileToDBML(csn);

  assert.match(dbml, /Enum "my\.bookshop\.Genre" {/);
  assert.match(dbml, /"FICTION"/);
  assert.match(dbml, /"NON_FICTION"/);
  assert.match(dbml, /"genre" "my\.bookshop\.Genre"/);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Managed Associations and Relationships", () => {
  const csn = cds
    .compile(`
    namespace my.bookshop;

    entity Books {
      key ID     : UUID;
          title  : String(100);
          author : Association to Authors;
    }

    entity Authors {
      key ID    : UUID;
          name  : String(100);
          books : Association to many Books on books.author = $self;
    }
  `)
    .to.csn();

  const dbml = compileToDBML(csn);

  assert.match(dbml, /"author_ID" varchar\(36\)/);
  assert.match(dbml, /Ref: "my\.bookshop\.Books"\."author_ID" > "my\.bookshop\.Authors"\."ID"/);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Compositions and Parent-Child Entities", () => {
  const csn = cds
    .compile(`
    namespace my.orders;

    entity Orders {
      key ID    : UUID;
          items : Composition of many OrderItems on items.parent = $self;
    }

    entity OrderItems {
      key ID     : UUID;
          parent : Association to Orders;
          pos    : Integer;
    }
  `)
    .to.csn();

  const dbml = compileToDBML(csn);

  assert.match(dbml, /Ref: "my\.orders\.OrderItems"\."parent_ID" > "my\.orders\.Orders"\."ID"/);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Doc Comments and Annotations (@title, @description)", () => {
  const csn = cds
    .compile(
      `
    namespace my.bookshop;

    /** Main Books Entity */
    @title: 'Book Catalog'
    entity Books {
      /** Primary Identifier */
      @title: 'Primary Identifier'
      key ID : UUID;

      /** Book Title */
      title  : String(100);
    }
  `,
      { docs: true },
    )
    .to.csn();

  const dbml = compileToDBML(csn);

  assert.match(dbml, /Table "my\.bookshop\.Books" \[note: 'Book Catalog'\]/);
  assert.match(dbml, /"ID" varchar\(36\) \[pk, note: 'Primary Identifier'\]/);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Options: Sorting, Project Header, Disable TableGroups", () => {
  const csn = cds
    .compile(`
    namespace my.bookshop;

    entity Zebra {
      key ID : UUID;
    }

    entity Alpha {
      key ID : UUID;
    }
  `)
    .to.csn();

  const dbml = compileToDBML(csn, {
    sort: true,
    project: "MyBookshopProject",
    tableGroups: false,
  });

  assert.match(dbml, /Project "MyBookshopProject"/);
  assert.doesNotMatch(dbml, /TableGroup/);

  // Verify Zebra comes after Alpha in sorted output
  const alphaIdx = dbml.indexOf('Table "my.bookshop.Alpha"');
  const zebraIdx = dbml.indexOf('Table "my.bookshop.Zebra"');
  assert.ok(alphaIdx >= 0 && zebraIdx >= 0);
  assert.ok(alphaIdx < zebraIdx);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});

test("Lifecycle Event Hooks (before and after)", () => {
  let beforeHookCalled = false;
  let afterHookCalled = false;

  cds.on("compile.to.dbml", ({ _csn, options }) => {
    beforeHookCalled = true;
    options.project = "EventHookProject";
  });

  cds.on("after:compile.to.dbml", ({ _csn, _options, _result }) => {
    afterHookCalled = true;
  });

  const csn = cds
    .compile(`
    namespace my.bookshop;
    entity Books { key ID : UUID; }
  `)
    .to.csn();

  const dbml = cds.compile.to.dbml(csn);

  assert.ok(beforeHookCalled);
  assert.ok(afterHookCalled);
  assert.match(dbml, /Project "EventHookProject"/);

  // Validate syntax
  const parsed = Parser.parse(dbml, "dbml");
  assert.ok(parsed);
});
