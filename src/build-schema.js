// 从事件目录（src/event-catalog.js）生成 contracts/domain.schema.json。
// 测试会断言已提交的 schema 与本生成器输出一致，防止目录与契约漂移。
import { AGGREGATE_TYPES, EVENT_SPECS, SENSITIVITY, VISIBILITY } from "./event-catalog.js";

export function buildDomainSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "公共艺术共创履约簿领域事件",
    type: "object",
    required: [
      "event_id",
      "event_type",
      "aggregate_type",
      "aggregate_id",
      "occurred_at",
      "version",
      "summary",
      "visibility",
      "payload",
    ],
    properties: {
      event_id: { type: "string", minLength: 1 },
      event_type: { type: "string", enum: EVENT_SPECS.map((spec) => spec.type) },
      aggregate_type: { type: "string", enum: AGGREGATE_TYPES },
      aggregate_id: { type: "string", minLength: 1 },
      occurred_at: { type: "string", format: "date-time" },
      version: { type: "integer", minimum: 1 },
      summary: { type: "string", minLength: 1 },
      visibility: { type: "string", enum: VISIBILITY },
      sensitivity: { type: "string", enum: SENSITIVITY },
      payload: { type: "object" },
    },
    additionalProperties: true,
    // 每种事件绑定的聚合、允许的可见档位与 payload 必备字段
    allOf: EVENT_SPECS.map((spec) => ({
      if: {
        type: "object",
        properties: { event_type: { const: spec.type } },
        required: ["event_type"],
      },
      then: {
        type: "object",
        properties: {
          ...(spec.aggregate ? { aggregate_type: { const: spec.aggregate } } : {}),
          visibility: { type: "string", enum: spec.visibility },
          sensitivity: { type: "string", enum: spec.sensitivity },
          payload: {
            type: "object",
            required: spec.required,
            properties: Object.fromEntries(
              Object.entries(spec.enums ?? {}).map(([key, values]) => [
                key,
                { type: "string", enum: values },
              ]),
            ),
          },
        },
        required: ["payload"],
      },
    })),
  };
}
