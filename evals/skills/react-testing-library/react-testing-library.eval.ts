import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./react-testing-library.cases.js";

describeSkill("react-testing-library", () => runSkillCases("react-testing-library", cases));
