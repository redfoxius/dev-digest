import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./engineering-insights.cases.js";

describeSkill("engineering-insights", () => runSkillCases("engineering-insights", cases));
