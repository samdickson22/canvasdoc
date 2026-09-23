import assert from "node:assert/strict";
import test from "node:test";
import {
  courseFolder,
  resourceName,
  validMaterialPath,
} from "../src/material-layout.ts";
test("readable paths retain IDs for duplicate titles and reject unsafe source paths", () => {
  assert.equal(
    courseFolder(192020, "CSC 3665 Databases"),
    "CSC-3665-Databases--192020",
  );
  assert.equal(resourceName(12, "Lab 2: SQL / Joins"), "Lab-2-SQL-Joins--12");
  assert.notEqual(resourceName(12, "Lab 2"), resourceName(13, "Lab 2"));
  assert.equal(
    validMaterialPath(
      "CSC-3665--192020/assignments/Lab-2--12/sources/assignment.md",
      192020,
    ),
    true,
  );
  assert.equal(
    validMaterialPath(
      "CSC-3665--192020/assignments/Lab-2--12/work/draft.md",
      192020,
    ),
    false,
  );
  assert.equal(
    validMaterialPath("CSC-3665--192020/materials/../../escape", 192020),
    false,
  );
  assert.equal(
    validMaterialPath("CSC-3665--192020/materials/syllabus.md", 1),
    false,
  );
});
