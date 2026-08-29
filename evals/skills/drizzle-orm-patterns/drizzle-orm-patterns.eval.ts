import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./drizzle-orm-patterns.cases.js";

describeSkill("drizzle-orm-patterns", () => runSkillCases("drizzle-orm-patterns", cases));
