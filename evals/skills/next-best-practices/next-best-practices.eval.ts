import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./next-best-practices.cases.js";

describeSkill("next-best-practices", () => runSkillCases("next-best-practices", cases));
