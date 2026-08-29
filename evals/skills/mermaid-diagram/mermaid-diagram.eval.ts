import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./mermaid-diagram.cases.js";

describeSkill("mermaid-diagram", () => runSkillCases("mermaid-diagram", cases));
