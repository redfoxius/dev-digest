import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./plan-verifier.cases.js";

describeAgent("plan-verifier", () => runAgentCases("plan-verifier", cases));
