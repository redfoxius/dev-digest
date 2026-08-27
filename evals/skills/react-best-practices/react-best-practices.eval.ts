import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./react-best-practices.cases.js";

describeSkill("react-best-practices", () => runSkillCases("react-best-practices", cases));
