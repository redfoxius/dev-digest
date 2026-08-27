import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./implementer.cases.js";

describeAgent("implementer", () => runAgentCases("implementer", cases));
