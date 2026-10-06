#!/usr/bin/env node
/**
 * 从 src/event-catalog.js 生成 contracts/domain.schema.json：
 * 每种事件一个变体（event_type / aggregate_type 常量 + payload $ref），
 * 用 oneOf 鉴别，保证事件名、聚合类型与负载结构三者一致。
 */
import { writeFile } from "node:fs/promises";

import { AGGREGATES, ENUMS } from "../src/event-catalog.js";

function fieldSchema(spec) {
  if (spec === "string") return { type: "string", minLength: 1 };
  if (spec === "integer") return { type: "integer" };
  if (spec === "number") return { type: "number" };
  if (spec === "boolean") return { type: "boolean" };
  if (spec === "object") return { type: "object" };
  if (spec.startsWith("array<enum:")) {
    return { type: "array", items: { $ref: `#/$defs/enums/${spec.slice("array<enum:".length, -1)}` } };
  }
  if (spec.startsWith("array<")) {
    return { type: "array", items: fieldSchema(spec.slice(6, -1)) };
  }
  if (spec.startsWith("enum:")) {
    return { $ref: `#/$defs/enums/${spec.slice(5)}` };
  }
  throw new Error(`未支持的字段类型：${spec}`);
}

const defs = { enums: {} };
for (const [name, values] of Object.entries(ENUMS)) {
  defs.enums[name] = { enum: values };
}

const variants = [];
for (const [aggregateType, aggregate] of Object.entries(AGGREGATES)) {
  for (const [eventType, spec] of Object.entries(aggregate.events)) {
    const defName = `${aggregateType}__${eventType}`;
    const properties = {};
    for (const [field, fieldSpec] of Object.entries(spec.payload)) {
      properties[field] = fieldSchema(fieldSpec);
    }
    defs[defName] = {
      type: "object",
      additionalProperties: false,
      required: spec.required ?? [],
      properties,
    };
    variants.push({
      properties: {
        event_type: { const: eventType },
        aggregate_type: { const: aggregateType },
        payload: { $ref: `#/$defs/${defName}` },
      },
    });
  }
}

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "公共艺术共创履约簿领域事件",
  description:
    "事件只追加、不可原地改写；更正使用后继的 RECORD_CORRECTED。跨记录的履约门控（权属先于改造、异议单独回应等）由 src/validator.js 的 validateStream 校验。",
  type: "object",
  oneOf: variants,
  required: ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary", "payload"],
  properties: {
    event_id: { type: "string", minLength: 1 },
    event_type: { enum: variants.map((v) => v.properties.event_type.const) },
    aggregate_type: { enum: Object.keys(AGGREGATES) },
    aggregate_id: { type: "string", minLength: 1 },
    occurred_at: { type: "string", format: "date-time" },
    version: { type: "integer", minimum: 1 },
    summary: { type: "string", minLength: 1 },
    replaces_event_id: { type: "string", minLength: 1 },
    payload: { type: "object" },
  },
  $defs: defs,
};

await writeFile(
  new URL("../contracts/domain.schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
  "utf8",
);
console.log(`已生成 schema：${Object.keys(defs).length - 1} 个负载定义、${variants.length} 个事件变体`);
