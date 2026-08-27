import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./typescript-expert.cases.js";

describeSkill("typescript-expert", () => runSkillCases("typescript-expert", cases));
