import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "recommends concrete mitigations for a 'Type instantiation is excessively deep' error",
    kind: "quality",
    prompt:
      "I'm getting 'error TS2589: Type instantiation is excessively deep and possibly infinite' on a " +
      "type built from several chained intersections and a large union of over 100 members. What " +
      "should I actually change?",
    practices: [
      "the answer recommends at least one of the specific documented mitigations: replacing type intersections with interfaces, splitting the large union type (>100 members) into smaller pieces, or avoiding circular generic constraints",
      "the answer's recommendations are concrete/actionable (name a specific technique), not a vague 'simplify your types' statement",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "recommends branded types for a domain-primitive mixing risk",
    kind: "quality",
    prompt:
      "We have functions like `processOrder(orderId: string, userId: string)` and it's easy to " +
      "accidentally pass a userId where an orderId is expected since both are just strings. How would " +
      "you prevent that at the type level?",
    practices: [
      "the answer recommends branded/nominal types (e.g. a Brand<K, T> pattern) to distinguish OrderId from UserId at the type level",
      "the answer explains this prevents accidental mixing of same-shaped domain primitives that plain string types wouldn't catch",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
