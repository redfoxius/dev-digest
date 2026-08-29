import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./spec-creator.cases.js";

describeAgent("spec-creator", () => runAgentCases("spec-creator", cases));
