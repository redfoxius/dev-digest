import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./postgresql-table-design.cases.js";

describeSkill("postgresql-table-design", () => runSkillCases("postgresql-table-design", cases));
