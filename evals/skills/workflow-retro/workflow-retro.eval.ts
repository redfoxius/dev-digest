import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./workflow-retro.cases.js";

describeSkill("workflow-retro", () => runSkillCases("workflow-retro", cases));
