import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./frontend-ui-architecture.cases.js";

describeSkill("frontend-ui-architecture", () => runSkillCases("frontend-ui-architecture", cases));
