import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./doc-writer.cases.js";

describeAgent("doc-writer", () => runAgentCases("doc-writer", cases));
