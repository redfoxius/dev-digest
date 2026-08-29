import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./researcher.cases.js";

describeAgent("researcher", () => runAgentCases("researcher", cases));
