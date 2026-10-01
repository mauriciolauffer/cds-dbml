import cds from "@sap/cds";
import { compileToDBML } from "./lib/compile/index.js";

type CompileTargets = typeof cds.compile.to & { dbml?: typeof compileToDBML };

if (cds.compile?.to) {
  try {
    cds.extend(cds.compile.to.constructor).with(
      class {
        get dbml() {
          return compileToDBML;
        }
      },
    );
  } catch {
    // Fallback assignment if extend fails
    (cds.compile.to as CompileTargets).dbml = compileToDBML;
  }
}
