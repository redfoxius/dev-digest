import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./fastify-best-practices.cases.js";

describeSkill("fastify-best-practices", () => runSkillCases("fastify-best-practices", cases));
