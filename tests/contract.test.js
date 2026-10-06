import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AGGREGATES, EVENT_TYPES } from "../src/event-catalog.js";
import { validateEvent, validateStream } from "../src/validator.js";

async function readStream() {
  return JSON.parse(await readFile(new URL("../data/full-stream.json", import.meta.url), "utf8"));
}

/** 删除若干事件后，按输入顺序重排各聚合的 version，保持版本链连续。 */
function renumber(records) {
  const counters = new Map();
  return records.map((r) => {
    const n = (counters.get(r.aggregate_id) ?? 0) + 1;
    counters.set(r.aggregate_id, n);
    return { ...r, version: n };
  });
}

const without = (records, ...ids) => renumber(records.filter((r) => !ids.includes(r.event_id)));
const patch = (records, id, payloadPatch) =>
  records.map((r) => {
    if (r.event_id !== id) return r;
    const payload = { ...r.payload, ...payloadPatch };
    for (const [key, value] of Object.entries(payloadPatch)) {
      if (value === undefined) delete payload[key];
    }
    return { ...r, payload };
  });

async function expectAccept() {
  const records = await readStream();
  assert.deepEqual(validateStream(records), []);
}

async function expectStreamError(mutate, fragment) {
  const records = mutate(await readStream());
  const errors = validateStream(records);
  assert.ok(errors.length > 0, "预期至少一条校验错误，但全部通过");
  if (fragment) assert.ok(errors.some((e) => e.includes(fragment)), `错误中应包含「${fragment}」，实际：\n${errors.join("\n")}`);
}

test("单条样例符合信封约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("完整生命周期事件流通过全部履约门控", async () => {
  await expectAccept();
});

test("事件目录中每个事件都有唯一且匹配的聚合归属", () => {
  let count = 0;
  for (const [aggregateType, def] of Object.entries(AGGREGATES)) {
    for (const eventType of Object.keys(def.events)) {
      assert.equal(EVENT_TYPES[eventType], aggregateType);
      count += 1;
    }
  }
  assert.equal(count, 50);
});

test("生成的 schema 与事件目录变体数量一致", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.oneOf.length, Object.values(AGGREGATES).reduce((n, d) => n + Object.keys(d.events).length, 0));
});

test("信封缺字段被拒绝", () => {
  const errors = validateEvent({ event_type: "COMMISSION_OPENED" });
  assert.ok(errors.some((e) => e.includes("缺少字段")));
});

test("事件类型与聚合类型不匹配被拒绝", () => {
  const errors = validateEvent({
    event_id: "x",
    event_type: "COMMISSION_OPENED",
    aggregate_type: "feedback_case",
    aggregate_id: "a",
    occurred_at: "2026-09-20T10:00:00+08:00",
    version: 1,
    summary: "x",
    payload: {},
  });
  assert.ok(errors.some((e) => e.includes("aggregate_type 应为 site_commission")));
});

test("payload 未登记字段被拒绝", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  sample.payload.unregistered_field = "x";
  assert.ok(validateEvent(sample).some((e) => e.includes("未登记字段")));
});

test("payload 枚举值非法被拒绝", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  sample.payload.site_kind = "shopping_mall";
  assert.ok(validateEvent(sample).some((e) => e.includes("site_kind")));
});

test("聚合首条事件类型错误被拒绝", async () => {
  await expectStreamError((records) => [
    ...records,
    {
      event_id: "bad-001",
      event_type: "OWNERSHIP_VERIFIED",
      aggregate_type: "material_item",
      aggregate_id: "I-X",
      occurred_at: "2026-11-01T10:00:00+08:00",
      version: 1,
      summary: "未经登记直接核验",
      payload: { item_id: "I-X", status: "ownership_verified", title_basis: "self_attested" },
    },
  ], "首条事件必须是 MATERIAL_PLEDGED");
});

test("version 不连续被拒绝", async () => {
  await expectStreamError((records) => {
    const copy = [...records];
    copy[10] = { ...copy[10], version: 9 };
    return copy;
  }, "连续递增");
});

test("event_id 重复被拒绝", async () => {
  await expectStreamError((records) => [{ ...records[0], aggregate_id: "C-DUP" }, ...records], "event_id 重复");
});

test("权属未核验清楚不得决定旧物归属", async () => {
  await expectStreamError((records) => without(records, "evt-009"), "所有权");
});

test("不可逆改造未经所有者确认被拒绝", async () => {
  await expectStreamError(
    (records) => patch(records, "evt-010", { level: "irreversible", owner_confirmed: false }),
    "不可逆改造",
  );
});

test("撤展去向与事先约定不一致被拒绝", async () => {
  await expectStreamError((records) => [
    ...records,
    {
      event_id: "evt-042",
      event_type: "WORK_WITHDRAWN_FROM_DISPLAY",
      aggregate_type: "material_item",
      aggregate_id: "I-001",
      occurred_at: "2028-01-10T10:00:00+08:00",
      version: 5,
      summary: "未按约定擅自交由运营单位留存",
      payload: { item_id: "I-001", reason: "站厅改造", fate: "operator_takeover" },
    },
  ], "撤展去向必须按事先约定");
});

test("无障碍异议的回应不公开被拒绝", async () => {
  await expectStreamError((records) => patch(records, "evt-020", { public_reply: false }), "异议");
});

test("无障碍异议未标记单独回应被拒绝", async () => {
  await expectStreamError((records) => patch(records, "evt-013", { separate_response_required: false }), "separate_response_required");
});

test("创作者拒绝建议但不说明依据被拒绝", async () => {
  await expectStreamError((records) => patch(records, "evt-023", { refusal_basis: undefined }), "refusal_basis");
});

test("未采纳反馈而不公开原因被拒绝", async () => {
  await expectStreamError(
    (records) => patch(records, "evt-019", { not_adopted_reasons: undefined }),
    "F-002",
  );
});

test("安全评审未通过的方案不得冻结施工", async () => {
  await expectStreamError((records) => patch(records, "evt-024", { safety_review_result: "failed" }), "安全评审未通过");
});

test("儿童参与未经监护人书面会签被拒绝", async () => {
  await expectStreamError((records) => patch(records, "evt-025", { consent_channel: "electronic" }), "监护人书面会签");
});

test("作品未通过验收不得发布或指派养护", async () => {
  await expectStreamError((records) => without(records, "evt-031"), "验收");
});

test("修复完成前必须先区分设计缺陷、施工责任与自然损耗", async () => {
  await expectStreamError((records) => without(records, "evt-039"), "完成修复前必须先区分");
});

test("责任类别与责任方不匹配被拒绝", async () => {
  await expectStreamError(
    (records) => patch(records, "evt-039", { category: "natural_wear", liable_party: "fabricator" }),
    "责任类别",
  );
});

test("毕业交接不移交完整记录被拒绝", async () => {
  await expectStreamError((records) => patch(records, "evt-041", { handed_over_records: [] }), "handed_over_records");
});

test("授权撤回后新增访谈摘要被拒绝", () => {
  const base = {
    aggregate_type: "community_input",
    aggregate_id: "K-9",
  };
  const records = [
    {
      event_id: "w-1",
      event_type: "INPUT_CONSENTED",
      ...base,
      occurred_at: "2026-09-01T10:00:00+08:00",
      version: 1,
      summary: "授权",
      payload: {
        participant_ref: "p",
        consent_scope: ["interview_only"],
        channel: "paper_signed",
        scope_summary: "x",
      },
    },
    {
      event_id: "w-2",
      event_type: "CONSENT_WITHDRAWN",
      ...base,
      occurred_at: "2026-09-02T10:00:00+08:00",
      version: 2,
      summary: "撤回",
      payload: { consent_id: "K-9" },
    },
    {
      event_id: "w-3",
      event_type: "INTERVIEW_SUMMARIZED",
      ...base,
      occurred_at: "2026-09-03T10:00:00+08:00",
      version: 3,
      summary: "撤回后仍记录摘要",
      payload: { consent_id: "K-9", interview_ref: "d", summary_text: "不应发生" },
    },
  ];
  assert.ok(validateStream(records).some((e) => e.includes("授权已撤回")));
});
