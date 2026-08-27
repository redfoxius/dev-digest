import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./run-plan.cases.js";

describeSkill("run-plan", () => runSkillCases("run-plan", cases));
