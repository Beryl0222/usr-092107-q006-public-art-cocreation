import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDomainSchema } from "../src/build-schema.js";
import { EVENT_SPECS } from "../src/event-catalog.js";
import { toCommunityView, validateEvent, validateEventStream } from "../src/validator.js";

const readJson = (path) =>
  readFile(new URL(path, import.meta.url), "utf8").then((text) => JSON.parse(text));

// 构造一条最小合法记录，测试中按需覆盖
function event(overrides = {}) {
  return {
    event_id: overrides.event_id ?? "e1",
    event_type: overrides.event_type ?? "COMMISSION_OPENED",
    aggregate_type: overrides.aggregate_type ?? "site_commission",
    aggregate_id: overrides.aggregate_id ?? "C1",
    occurred_at: overrides.occurred_at ?? "2026-09-20T10:00:00+08:00",
    version: overrides.version ?? 1,
    summary: overrides.summary ?? "测试记录",
    visibility: overrides.visibility ?? "open",
    sensitivity: overrides.sensitivity ?? "none",
    payload: overrides.payload ?? {
      site_name: "测试站",
      site_kind: "transit_station",
      commissioning_party: "委托方",
    },
  };
}

let seq = 0;
const nextId = (prefix = "e") => `${prefix}${++seq}`;

test("最小样例符合领域约定", async () => {
  const sample = await readJson("../data/sample.json");
  assert.deepEqual(validateEvent(sample), []);
});

test("全流程样例通过事件级与事件流校验", async () => {
  const lifecycle = await readJson("../data/lifecycle.json");
  assert.deepEqual(validateEventStream(lifecycle), []);
  assert.ok(lifecycle.length >= 40);
});

test("目录中每个事件类型都能通过一条最小合法记录", () => {
  for (const spec of EVENT_SPECS) {
    const payload = {};
    for (const dotted of spec.required) {
      const [head] = dotted.split(".");
      if (head in payload) continue;
      const enumValues = spec.enums?.[head];
      payload[head] = enumValues
        ? enumValues[0]
        : head === "feedback_event_ids" ||
            head === "obligation_event_ids" ||
            head === "child_participation_refs" ||
            head === "based_on_input_event_ids"
          ? []
          : head === "accepted"
            ? true
            : head === "is_accessibility_related" ||
                head === "reversibility_confirmed" ||
                head === "follow_up_required"
              ? false
              : head === "total_amount" || head === "amount"
                ? 100
                : head === "credits"
                  ? []
                  : head === "category_breakdown"
                    ? {}
                    : "x";
    }
    const rec = event({
      event_id: `catalog-${spec.type}`,
      event_type: spec.type,
      aggregate_type: spec.aggregate ?? "site_commission",
      visibility: spec.visibility[0],
      sensitivity: spec.sensitivity[0],
      payload,
    });
    const errors = validateEvent(rec);
    assert.deepEqual(errors, [], `${spec.type} 最小记录报错：${errors.join("；")}`);
  }
});

// —— 信封与事件级规则 ——
test("缺少必备字段被拒绝", () => {
  const errors = validateEvent({});
  for (const name of ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary", "visibility", "payload"]) {
    assert.ok(errors.includes(`缺少字段：${name}`));
  }
});

test("version 必须为正整数", () => {
  assert.ok(validateEvent(event({ version: 0 })).some((m) => m.includes("version")));
  assert.ok(validateEvent(event({ version: 1.5 })).some((m) => m.includes("version")));
});

test("occurred_at 必须带时区", () => {
  assert.ok(validateEvent(event({ occurred_at: "2026-09-20 10:00:00" })).length > 0);
  assert.deepEqual(validateEvent(event({ occurred_at: "2026-09-20T10:00:00Z" })), []);
});

test("未知事件类型被拒绝", () => {
  assert.ok(validateEvent(event({ event_type: "NOPE" })).some((m) => m.includes("未知事件类型")));
});

test("事件绑定的聚合不可混用", () => {
  const rec = event({
    event_type: "DAMAGE_REPORTED",
    aggregate_type: "design_revision",
    visibility: "internal",
    payload: { damage_ref: "D1", description: "x", severity: "cosmetic", discovered_at: "2026-09-20T10:00:00+08:00" },
  });
  assert.ok(validateEvent(rec).some((m) => m.includes("defect_claim")));
});

test("可见档位超出该事件允许范围被拒绝", () => {
  const rec = event({
    event_type: "INPUT_CONSENTED",
    aggregate_type: "community_input",
    visibility: "open", // 授权摘要不允许公开
    sensitivity: "personal",
    payload: { participant_ref: "P1", context_event_id: "x", consent_scope: {}, consent_basis: {} },
  });
  assert.ok(validateEvent(rec).some((m) => m.includes("visibility")));
});

test("学生评价只能 restricted/confidential", () => {
  const rec = event({
    event_type: "STUDENT_GRADED",
    aggregate_type: "student_assessment",
    visibility: "restricted",
    sensitivity: "confidential",
    payload: { student_ref: "S1", assignment_ref: "A1", grade: "A", graded_by: "评委" },
  });
  assert.deepEqual(validateEvent(rec), []);
  const bad = { ...rec, visibility: "community", sensitivity: "none" };
  assert.ok(validateEvent(bad).length > 0);
});

test("payload 必备字段与枚举受控", () => {
  const rec = event({
    event_type: "DEFECT_CLASSIFIED",
    aggregate_type: "defect_claim",
    visibility: "open",
    payload: { damage_event_id: "x", category: "天灾", responsibility_basis: "b", responsible_party_role: "r" },
  });
  assert.ok(validateEvent(rec).some((m) => m.includes("category")));
});

test("拒绝不安全/歧视性建议必须给出依据类别", () => {
  const ok = event({
    event_type: "SAFETY_OR_DISCRIMINATION_REFUSAL",
    aggregate_type: "design_revision",
    version: 2,
    payload: { refused_suggestion_summary: "s", basis_category: "fire_egress", basis_detail: "d" },
  });
  assert.deepEqual(validateEvent(ok), []);
  const bad = { ...ok, payload: { refused_suggestion_summary: "s" } };
  assert.ok(validateEvent(bad).some((m) => m.includes("basis_category")));
});

// —— 聚合版本与时间 ——
test("同一聚合 version 必须严格递增、时间不得倒流", () => {
  const e1 = event({ event_id: "a1", version: 1, occurred_at: "2026-09-01T10:00:00+08:00" });
  const e2 = event({ event_id: "a2", version: 1, occurred_at: "2026-09-02T10:00:00+08:00" });
  assert.ok(validateEventStream([e1, e2]).some((m) => m.includes("严格递增")));
  const e3 = event({ event_id: "a3", version: 3, occurred_at: "2026-08-01T10:00:00+08:00" });
  assert.ok(validateEventStream([e1, e3]).some((m) => m.includes("不得早于")));
});

// —— 授权与来源 ——
test("引用未授权访谈的方案初稿被拒绝", () => {
  const ctx = event({
    event_id: nextId(),
    event_type: "SITE_CONTEXT_RECORDED",
    aggregate_type: "community_input",
    aggregate_id: "C1#i1",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { participant_ref: "P1", source_type: "interview", narrative_summary: "n" },
  });
  const draft = event({
    event_id: nextId(),
    event_type: "DESIGN_DRAFTED",
    aggregate_type: "design_revision",
    aggregate_id: "C1#d1",
    occurred_at: "2026-10-01T10:00:00+08:00",
    visibility: "open",
    payload: { title: "t", based_on_input_event_ids: [ctx.event_id], proposal_summary: "p" },
  });
  assert.ok(validateEventStream([ctx, draft]).some((m) => m.includes("尚未取得")));
});

test("授权撤回后新方案版本不得继续引用该访谈", () => {
  const ctx = event({
    event_id: nextId("c"),
    event_type: "SITE_CONTEXT_RECORDED",
    aggregate_type: "community_input",
    aggregate_id: "C1#i1",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { participant_ref: "P1", source_type: "interview", narrative_summary: "n" },
  });
  const consent = event({
    event_id: nextId("c"),
    event_type: "INPUT_CONSENTED",
    aggregate_type: "community_input",
    aggregate_id: "C1#i1",
    version: 2,
    visibility: "restricted",
    sensitivity: "personal",
    payload: { participant_ref: "P1", context_event_id: ctx.event_id, consent_scope: {}, consent_basis: {} },
  });
  const withdrawal = event({
    event_id: nextId("c"),
    event_type: "CONSENT_WITHDRAWN",
    aggregate_type: "community_input",
    aggregate_id: "C1#i1",
    version: 3,
    occurred_at: "2026-11-01T10:00:00+08:00",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { consent_event_id: consent.event_id, scope_remaining: {}, effect_on_records: "下线音频" },
  });
  const laterDraft = event({
    event_id: nextId("c"),
    event_type: "DESIGN_DRAFTED",
    aggregate_type: "design_revision",
    aggregate_id: "C1#d2",
    occurred_at: "2026-12-01T10:00:00+08:00",
    visibility: "open",
    payload: { title: "t2", based_on_input_event_ids: [ctx.event_id], proposal_summary: "p" },
  });
  assert.ok(validateEventStream([ctx, consent, withdrawal, laterDraft]).some((m) => m.includes("授权已撤回")));
});

// —— 反馈代表性 ——
test("无障碍/少数群体异议没有单独回应时，流校验失败且不得验收", () => {
  const objection = event({
    event_id: nextId("f"),
    event_type: "FEEDBACK_RECORDED",
    aggregate_type: "community_feedback",
    aggregate_id: "C1#fb1",
    visibility: "community",
    payload: { submitter_category: "accessibility_user", content_summary: "盲道被占", is_accessibility_related: true },
  });
  assert.ok(validateEventStream([objection]).some((m) => m.includes("必须有单独回应")));

  const budget = event({
    event_id: nextId("b"),
    event_type: "BUDGET_APPROVED",
    aggregate_type: "budget_procurement",
    aggregate_id: "C1#bg",
    occurred_at: "2026-10-02T10:00:00+08:00",
    visibility: "internal",
    sensitivity: "commercial",
    payload: { budget_ref: "B1", total_amount: 1, currency: "CNY", category_breakdown: {} },
  });
  const accepted = event({
    event_id: nextId("a"),
    event_type: "INSTALLATION_ACCEPTED",
    aggregate_type: "construction_acceptance",
    aggregate_id: "C1#ca",
    occurred_at: "2026-11-02T10:00:00+08:00",
    version: 2,
    visibility: "open",
    payload: { result: "accepted", inspector_roles: ["工程师"], accepted_at: "2026-11-02T10:00:00+08:00" },
  });
  assert.ok(
    validateEventStream([objection, budget, accepted]).some((m) => m.includes("未单独回应，不得验收")),
  );
});

test("多数意见的数量不替代逐条回应：OBJECTION_RESPONDED 指向具体反馈", () => {
  const objection = event({
    event_id: "fb-minority",
    event_type: "FEEDBACK_RECORDED",
    aggregate_type: "community_feedback",
    aggregate_id: "C1#fb2",
    visibility: "community",
    sensitivity: "minority",
    payload: { submitter_category: "minority_group_member", content_summary: "表述问题", is_accessibility_related: false },
  });
  const answered = event({
    event_id: "or1",
    event_type: "OBJECTION_RESPONDED",
    aggregate_type: "community_feedback",
    aggregate_id: "C1#fb2",
    version: 2,
    occurred_at: "2026-10-03T10:00:00+08:00",
    visibility: "community",
    sensitivity: "minority",
    payload: { objection_event_id: "fb-minority", response: "r", disposition: "partially_adopted", follow_up_required: true },
  });
  assert.deepEqual(validateEventStream([objection, answered]), []);
});

// —— 旧物：确权、可逆、书面协议 ——
function materialChain() {
  const pledged = event({
    event_id: "mat-pledge",
    event_type: "MATERIAL_PLEDGED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m1",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { material_ref: "M1", donor_category: "resident", description: "旧物", intended_use: "嵌入" },
  });
  const verified = event({
    event_id: "mat-own",
    event_type: "OWNERSHIP_VERIFIED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m1",
    version: 2,
    occurred_at: "2026-09-21T10:00:00+08:00",
    visibility: "restricted",
    sensitivity: "personal",
    payload: {
      material_ref: "M1",
      ownership_basis: "b",
      reversible_scope: {},
      post_project_arrangement: "p",
    },
  });
  const agreement = event({
    event_id: "mat-agr",
    event_type: "MATERIAL_LOAN_AGREEMENT_SIGNED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m1",
    version: 3,
    occurred_at: "2026-09-22T10:00:00+08:00",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { agreement_ref: "A1", material_ref: "M1", loan_period: "1年", return_terms: "还", maintenance_duty: "d", withdrawal_terms: "w" },
  });
  const incorporated = event({
    event_id: "mat-inc",
    event_type: "MATERIAL_INCORPORATED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m1",
    version: 4,
    occurred_at: "2026-09-23T10:00:00+08:00",
    visibility: "internal",
    payload: { material_ref: "M1", revision_event_id: "rev1", reversibility_confirmed: true },
  });
  return [pledged, verified, agreement, incorporated];
}

test("旧物须先确权签书面协议并确认可逆，方可入作", () => {
  assert.deepEqual(validateEventStream(materialChain()), []);
});

test("跳过所有权核实直接签协议被拒绝", () => {
  const pledged = event({
    event_id: "p",
    event_type: "MATERIAL_PLEDGED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m2",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { material_ref: "M2", donor_category: "resident", description: "d", intended_use: "u" },
  });
  const agreement = event({
    event_id: "a",
    event_type: "MATERIAL_DONATION_AGREEMENT_SIGNED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m2",
    version: 2,
    occurred_at: "2026-09-22T10:00:00+08:00",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { agreement_ref: "A2", material_ref: "M2", ownership_transfer_terms: "t", maintenance_duty: "d", withdrawal_terms: "w" },
  });
  assert.ok(validateEventStream([pledged, agreement]).some((m) => m.includes("OWNERSHIP_VERIFIED")));
});

test("入作时 reversibility_confirmed 不为 true 被拒绝", () => {
  const chain = materialChain();
  chain[3].payload.reversibility_confirmed = false;
  assert.ok(validateEventStream(chain).some((m) => m.includes("reversibility_confirmed")));
});

test("撤回展示缺少书面协议被拒绝（不得只靠口头约定）", () => {
  const pledged = event({
    event_id: "p",
    event_type: "MATERIAL_PLEDGED",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m3",
    visibility: "restricted",
    sensitivity: "personal",
    payload: { material_ref: "M3", donor_category: "villager", description: "d", intended_use: "u" },
  });
  const withdrawn = event({
    event_id: "w",
    event_type: "MATERIAL_WITHDRAWN",
    aggregate_type: "material_agreement",
    aggregate_id: "C1#m3",
    version: 2,
    occurred_at: "2026-09-25T10:00:00+08:00",
    visibility: "community",
    payload: { material_ref: "M3", reason: "r", disposition: "returned_to_owner", community_notice: "n" },
  });
  assert.ok(validateEventStream([pledged, withdrawn]).some((m) => m.includes("口头约定")));
});

// —— 验收前置 ——
test("没有已批准预算不得验收", () => {
  const accepted = event({
    event_id: "acc",
    event_type: "INSTALLATION_ACCEPTED",
    aggregate_type: "construction_acceptance",
    aggregate_id: "C1#ca2",
    version: 1,
    visibility: "open",
    payload: { result: "accepted", inspector_roles: ["x"], accepted_at: "2026-11-02T10:00:00+08:00" },
  });
  assert.ok(validateEventStream([accepted]).some((m) => m.includes("BUDGET_APPROVED")));
});

// —— 损坏归责 ——
test("修复完成前必须先归责（设计缺陷/施工责任/自然损耗）", () => {
  const reported = event({
    event_id: "dmg",
    event_type: "DAMAGE_REPORTED",
    aggregate_type: "defect_claim",
    aggregate_id: "C1#d1",
    visibility: "internal",
    payload: { damage_ref: "D1", description: "坏", severity: "functional", discovered_at: "2026-12-01T10:00:00+08:00" },
  });
  const repaired = event({
    event_id: "rep",
    event_type: "REPAIR_RESOLVED",
    aggregate_type: "defect_claim",
    aggregate_id: "C1#d1",
    version: 2,
    occurred_at: "2026-12-05T10:00:00+08:00",
    visibility: "community",
    payload: { damage_event_id: "dmg", actions: ["修"], cost_allocation: {}, completed_at: "2026-12-05T10:00:00+08:00" },
  });
  assert.ok(validateEventStream([reported, repaired]).some((m) => m.includes("DEFECT_CLASSIFIED")));

  const classified = event({
    event_id: "cls",
    event_type: "DEFECT_CLASSIFIED",
    aggregate_type: "defect_claim",
    aggregate_id: "C1#d1",
    version: 2,
    occurred_at: "2026-12-03T10:00:00+08:00",
    visibility: "open",
    payload: { damage_event_id: "dmg", category: "design_defect", responsibility_basis: "b", responsible_party_role: "设计方" },
  });
  const repaired2 = { ...repaired, version: 3, occurred_at: "2026-12-06T10:00:00+08:00" };
  assert.deepEqual(validateEventStream([reported, classified, repaired2]), []);
});

test("归责类别覆盖设计缺陷、施工责任、自然损耗、第三方与未定", () => {
  for (const category of ["design_defect", "construction_fault", "natural_wear", "third_party_damage", "undetermined"]) {
    const rec = event({
      event_type: "DEFECT_CLASSIFIED",
      aggregate_type: "defect_claim",
      visibility: "open",
      payload: { damage_event_id: "x", category, responsibility_basis: "b", responsible_party_role: "r" },
    });
    assert.deepEqual(validateEvent(rec), []);
  }
});

// —— 更正 ——
test("更正只能追加同聚合后继记录，且不得放宽可见档位", () => {
  const original = event({ event_id: "orig", version: 1 });
  const correction = event({
    event_id: "corr",
    event_type: "RECORD_CORRECTED",
    version: 2,
    occurred_at: "2026-10-01T10:00:00+08:00",
    visibility: "restricted", // 比 open 更严格，允许收紧
    sensitivity: "none",
    payload: { corrected_event_id: "orig", corrected_event_type: "COMMISSION_OPENED", correction_reason: "r" },
  });
  assert.ok(validateEventStream([original, correction]).some((m) => m.includes("更正不得放宽")) === false);

  const widened = { ...correction, event_id: "corr2" };
  // open 与 open 同级，不算放宽；用 internal 原记录 → open 更正才会放宽
  const internalOriginal = { ...original, visibility: "internal", event_id: "orig2" };
  const widenedCorrection = {
    ...widened,
    aggregate_id: "C1",
    visibility: "open",
    payload: { corrected_event_id: "orig2", corrected_event_type: "COMMISSION_OPENED", correction_reason: "r" },
  };
  assert.ok(validateEventStream([internalOriginal, widenedCorrection]).some((m) => m.includes("不得放宽")));
});

// —— 交接 ——
test("毕业后交接须携带养护义务与完整版本档案", () => {
  const obligation = event({
    event_id: "mo1",
    event_type: "MAINTENANCE_ASSIGNED",
    aggregate_type: "maintenance_obligation",
    aggregate_id: "C1#mo",
    occurred_at: "2026-10-01T10:00:00+08:00",
    visibility: "open",
    payload: { obligation_ref: "MO1", duty_holder_role: "维护岗", duty_holder_org: "运营方", scope: ["巡检"], review_cycle: "每月" },
  });
  const handover = event({
    event_id: "ho1",
    event_type: "STEWARDSHIP_HANDED_OVER",
    aggregate_type: "site_commission",
    version: 2,
    occurred_at: "2027-06-01T10:00:00+08:00",
    visibility: "open",
    payload: {
      handover_ref: "HO1",
      recipient_org: "运营方",
      obligation_event_ids: ["mo1"],
      archive_ref: "archive://C1/full",
      accepted: true,
    },
  });
  assert.deepEqual(validateEventStream([obligation, handover]), []);

  const badHandover = {
    ...handover,
    event_id: "ho2",
    payload: { ...handover.payload, archive_ref: "" },
  };
  assert.ok(validateEventStream([obligation, badHandover]).some((m) => m.includes("archive_ref")));
});

// —— 社区视图 ——
test("社区视图排除学生评价、内部与受限记录", async () => {
  const lifecycle = await readJson("../data/lifecycle.json");
  const view = toCommunityView(lifecycle);
  assert.ok(!view.some((e) => e.event_type === "STUDENT_GRADED"));
  assert.ok(!view.some((e) => e.event_type === "INPUT_CONSENTED"));
  assert.ok(!view.some((e) => e.event_type === "PROCUREMENT_RECORDED"));
  // 居民仍能看到：方案回应、异议回应、归责、巡检、交接
  for (const type of ["DESIGN_RESPONDED", "OBJECTION_RESPONDED", "DEFECT_CLASSIFIED", "INSPECTION_LOGGED", "STEWARDSHIP_HANDED_OVER"]) {
    assert.ok(view.some((e) => e.event_type === type), `社区视图缺少 ${type}`);
  }
});

test("社区视图对联系方式与捐物人姓名脱敏（含数组内对象）", async () => {
  const lifecycle = await readJson("../data/lifecycle.json");
  const view = toCommunityView(lifecycle);
  const raw = JSON.stringify(view);
  assert.ok(!raw.includes("138"));
  assert.ok(!raw.includes("wx_88"));
  assert.ok(!raw.includes("王某某"));
  assert.ok(!raw.includes("student_ref"));
  const feedback = view.find((e) => e.event_id === "evt-008");
  assert.equal(feedback.payload.contact_info, "【已脱敏】");
});

// —— 契约一致性 ——
test("已提交的 schema 与目录生成结果一致（防漂移）", async () => {
  const committed = await readJson("../contracts/domain.schema.json");
  assert.deepEqual(committed, buildDomainSchema());
});
