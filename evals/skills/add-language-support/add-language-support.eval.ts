import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./add-language-support.cases.js";

describeSkill("add-language-support", () => runSkillCases("add-language-support", cases));
