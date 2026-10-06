import { AGGREGATES, ENUMS, EVENT_TYPES } from "./event-catalog.js";

const envelopeRequired = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];

const firstEventByAggregate = {
  site_commission: "COMMISSION_OPENED",
  community_input: "INPUT_CONSENTED",
  local_narrative: "NARRATIVE_RECORDED",
  feedback_case: "FEEDBACK_SUBMITTED",
  design_revision: "DESIGN_DRAFTED",
  material_item: "MATERIAL_PLEDGED",
  minor_participation: "MINOR_CONSENT_GRANTED",
  budget_case: "BUDGET_ALLOCATED",
  installation_work: "INSTALLATION_STARTED",
  maintenance_obligation: "MAINTENANCE_ASSIGNED",
  inspection_case: "INSPECTION_LOGGED",
  repair_case: "REPAIR_OPENED",
  correction_record: "RECORD_CORRECTED",
};

// 事件负载中与聚合标识同名的字段，必须等于 aggregate_id
const idFieldByAggregate = {
  community_input: "consent_id",
  local_narrative: "narrative_id",
  feedback_case: "feedback_id",
  design_revision: "revision_id",
  material_item: "item_id",
  minor_participation: "minor_consent_id",
  maintenance_obligation: "obligation_id",
  repair_case: "repair_id",
};

function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function checkField(value, spec) {
  if (spec === "string") return typeof value === "string" && value.length > 0;
  if (spec === "integer") return Number.isInteger(value);
  if (spec === "number") return typeof value === "number" && Number.isFinite(value);
  if (spec === "boolean") return typeof value === "boolean";
  if (spec === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (spec.startsWith("array<")) {
    if (!Array.isArray(value)) return false;
    const inner = spec.slice("array<".length, -1);
    return value.every((item) => checkField(item, inner));
  }
  if (spec.startsWith("enum:")) {
    return ENUMS[spec.slice("enum:".length)]?.includes(value) ?? false;
  }
  return false;
}

function typeName(spec) {
  if (spec.startsWith("enum:")) return `枚举 ${spec.slice(5)}`;
  if (spec.startsWith("array<enum:")) return `枚举数组 ${spec.slice("array<enum:".length, -1)}`;
  if (spec.startsWith("array<")) return `数组（${spec.slice(6, -1)}）`;
  return { integer: "整数", number: "数字", boolean: "布尔", object: "对象", string: "非空字符串" }[spec] ?? spec;
}

/** 校验单条事件信封及其负载；不依赖事件流中的其他记录。 */
export function validateEvent(record) {
  const errors = [];
  if (typeof record !== "object" || record === null) return ["记录必须是对象"];

  for (const name of envelopeRequired) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  if (errors.length > 0 && !("event_type" in record)) return errors;

  const { event_type: eventType, aggregate_type: aggregateType, event_id: eventId } = record;

  if (!(eventType in EVENT_TYPES)) {
    errors.push(`未知事件类型：${eventType}`);
    return errors;
  }
  const expectedAggregate = EVENT_TYPES[eventType];
  if (aggregateType !== expectedAggregate) {
    errors.push(`事件 ${eventType} 的 aggregate_type 应为 ${expectedAggregate}，实际为 ${aggregateType}`);
  }
  if (typeof eventId !== "string" || eventId.length === 0) errors.push("event_id 必须是非空字符串");
  if (!isValidDate(record.occurred_at)) errors.push("occurred_at 必须是合法的 date-time 字符串");
  if (!Number.isInteger(record.version) || record.version < 1) errors.push("version 必须是正整数");
  if (typeof record.summary !== "string" || record.summary.length === 0) errors.push("summary 必须是非空字符串");

  const spec = AGGREGATES[expectedAggregate]?.events[eventType];
  if (!spec) return errors;

  const payload = record.payload;
  if (payload === undefined || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("payload 必须是对象");
    return errors;
  }
  for (const field of spec.required ?? []) {
    if (!(field in payload)) errors.push(`payload 缺少字段：${field}`);
  }
  for (const [field, value] of Object.entries(payload)) {
    const fieldSpec = spec.payload[field];
    if (!fieldSpec) {
      errors.push(`payload 含未登记字段：${field}（请先在事件目录中登记）`);
      continue;
    }
    if (value !== null && !checkField(value, fieldSpec)) {
      errors.push(`payload.${field} 类型应为 ${typeName(fieldSpec)}`);
    }
  }
  return errors;
}

const liabilityByCategory = {
  design_defect: ["school", "creator_student_team", "insurance", "undetermined"],
  construction_liability: ["fabricator", "insurance", "undetermined"],
  natural_wear: ["operator", "village_collective", "undetermined"],
  external_force: ["insurance", "operator", "village_collective", "undetermined"],
  unclear_under_review: ["undetermined"],
};

/**
 * 校验整条事件流：版本链、生命周期顺序，以及领域履约门控。
 * 记录按数组给出的顺序处理（应已按发生时间排序）。
 */
export function validateStream(records) {
  const errors = [];
  const fail = (eventId, message) => errors.push(`事件 ${eventId}：${message}`);

  // 单记录校验
  for (const record of records) {
    for (const message of validateEvent(record)) fail(record?.event_id ?? "<无标识>", message);
  }
  if (errors.length > 0) return errors; // 结构不过关时不做跨记录判断

  const seenEventIds = new Set();
  const aggregateState = new Map();

  // 跨聚合索引
  const consents = new Map(); // consentId → { status, scopes, at }
  const narratives = new Map(); // narrativeId → { status, at, consentId }
  const feedbacks = new Map(); // feedbackId → { triaged, latestTriage, responded: [{...}], escalated }
  const revisions = new Set();
  const frozenRevisions = new Map(); // revisionId → event
  const items = new Map(); // itemId → 状态机各阶段结果
  const minorConsents = new Map(); // id → { active, incorporated: [{revisionId, at}] }
  const works = new Map(); // workAssetId → { revisionId, itemIds, acceptedAt }
  const installations = new Map(); // installAggId → { started, revisionId, itemIds, accepted }
  const inspections = new Set();
  const repairs = new Map(); // repairId → { openedAt, workAssetId, determined, completed }
  const obligations = new Map();
  const publishedWorks = new Map(); // workAssetId → event

  for (const record of records) {
    const { event_id: eventId, event_type: eventType, aggregate_type: aggregateType, aggregate_id: aggregateId, version, occurred_at: at } = record;
    const p = record.payload ?? {};
    const now = Date.parse(at);

    if (seenEventIds.has(eventId)) {
      fail(eventId, "event_id 重复");
      continue;
    }
    seenEventIds.add(eventId);

    // 聚合版本链与生命周期
    let state = aggregateState.get(aggregateId);
    if (!state) {
      state = { lastVersion: 0, lastAt: 0, firstType: eventType };
      aggregateState.set(aggregateId, state);
      const requiredFirst = firstEventByAggregate[aggregateType];
      if (requiredFirst && eventType !== requiredFirst) {
        fail(eventId, `聚合 ${aggregateId} 的首条事件必须是 ${requiredFirst}`);
      }
    }
    if (version !== state.lastVersion + 1) {
      fail(eventId, `聚合 ${aggregateId} 的 version 必须从 1 起连续递增（上一版本 ${state.lastVersion}，本条 ${version}）`);
    }
    if (now < state.lastAt) fail(eventId, "occurred_at 早于同一聚合的已有事件");
    state.lastVersion = version;
    state.lastAt = now;

    const idField = idFieldByAggregate[aggregateType];
    if (idField && idField in p && p[idField] !== aggregateId) {
      fail(eventId, `payload.${idField} 必须等于 aggregate_id`);
    }

    const consentActiveAt = (consentId, when) => {
      const c = consents.get(consentId);
      return !!c && c.status === "granted" && c.at <= when;
    };

    switch (eventType) {
      // ---------- 场地委托 ----------
      case "COMMISSION_OPENED":
      case "BRIEF_PUBLISHED":
      case "SCOPE_CHANGED":
      case "COMMISSION_SUSPENDED":
      case "COMMISSION_WITHDRAWN":
        break;

      // ---------- 访谈与授权 ----------
      case "INPUT_CONSENTED": {
        if (p.consent_scope.includes("child_participation") && !p.guardian_ref) {
          fail(eventId, "授权范围含 child_participation 时必须记录 guardian_ref");
        }
        consents.set(aggregateId, { status: "granted", scopes: new Set(p.consent_scope), at: now });
        break;
      }
      case "INTERVIEW_SUMMARIZED": {
        const c = consents.get(p.consent_id);
        if (!c) fail(eventId, `引用的授权 ${p.consent_id} 不存在`);
        else if (!consentActiveAt(p.consent_id, now)) fail(eventId, "访谈摘要只能在授权有效期间记录（授权已撤回或过期）");
        else if (!c.scopes.has("interview_only")) fail(eventId, "授权范围不含 interview_only，不能记录访谈摘要");
        break;
      }
      case "NARRATIVE_RECORDED": {
        const c = consents.get(p.consent_id);
        if (!c) fail(eventId, `引用的授权 ${p.consent_id} 不存在`);
        else if (!consentActiveAt(p.consent_id, now)) fail(eventId, "地方叙事只能在授权有效期间记录");
        else if (!c.scopes.has("story_use")) fail(eventId, "授权范围不含 story_use，不能收录为地方叙事");
        narratives.set(aggregateId, { status: p.status, at: now, consentId: p.consent_id });
        break;
      }
      case "CONSENT_WITHDRAWN": {
        const c = consents.get(aggregateId);
        if (!c) fail(eventId, "撤回对象不存在");
        else if (c.status !== "granted") fail(eventId, "只有有效授权可以撤回");
        else c.status = "withdrawn";
        break;
      }
      case "CONSENT_EXPIRED": {
        const c = consents.get(aggregateId);
        if (!c) fail(eventId, "授权不存在");
        else c.status = "expired";
        break;
      }
      case "CONSENT_SCOPE_EXTENDED": {
        const c = consents.get(aggregateId);
        if (!c) fail(eventId, "授权不存在");
        else if (c.status !== "granted") fail(eventId, "授权已失效，不能扩展范围，应重新取得授权");
        else p.added_scope.forEach((scope) => c.scopes.add(scope));
        break;
      }

      // ---------- 地方叙事 ----------
      case "NARRATIVE_CORROBORATED": {
        const n = narratives.get(p.narrative_id);
        if (!n) fail(eventId, `叙事 ${p.narrative_id} 不存在`);
        else n.status = "verified";
        break;
      }
      case "NARRATIVE_DISPUTED": {
        const n = narratives.get(p.narrative_id);
        if (!n) fail(eventId, `叙事 ${p.narrative_id} 不存在`);
        else n.status = p.status_after ?? "disputed";
        break;
      }
      case "NARRATIVE_RETRACTED": {
        const n = narratives.get(p.narrative_id);
        if (!n) fail(eventId, `叙事 ${p.narrative_id} 不存在`);
        else n.status = "retracted";
        break;
      }

      // ---------- 公开反馈 ----------
      case "FEEDBACK_SUBMITTED":
        feedbacks.set(aggregateId, { triages: [], responses: [], escalated: false });
        break;
      case "FEEDBACK_TRIAGED": {
        const f = feedbacks.get(aggregateId);
        if (!f) fail(eventId, "反馈不存在");
        else f.triages.push({ ...p, at: now });
        break;
      }
      case "FEEDBACK_RESPONDED": {
        const f = feedbacks.get(aggregateId);
        if (!f) {
          fail(eventId, "反馈不存在");
          break;
        }
        const latestTriage = f.triages[f.triages.length - 1];
        if (!latestTriage) fail(eventId, "反馈在分流（FEEDBACK_TRIAGED）之前不得直接回应");
        if (p.disposition === "rejected_creator" && !p.refusal_basis) {
          fail(eventId, "创作者拒绝采纳建议时必须在 refusal_basis 中说明依据");
        }
        if (latestTriage?.representative_status === "minority_or_accessibility_dissent") {
          if (latestTriage.separate_response_required !== true) {
            fail(eventId, "少数群体或无障碍使用者的异议必须标记 separate_response_required");
          }
          if (p.public_reply !== true) {
            fail(eventId, "对少数群体或无障碍异议的回应必须公开（public_reply=true），不能以多数意见数量替代");
          }
        }
        if (p.reflected_in_revision_id && !revisions.has(p.reflected_in_revision_id)) {
          fail(eventId, `reflected_in_revision_id 引用的方案版本 ${p.reflected_in_revision_id} 不存在`);
        }
        f.responses.push({ ...p, at: now });
        break;
      }
      case "FEEDBACK_RESPONSE_ESCALATED": {
        const f = feedbacks.get(aggregateId);
        if (!f) fail(eventId, "反馈不存在");
        else f.escalated = true;
        break;
      }

      // ---------- 方案版本 ----------
      case "DESIGN_DRAFTED": {
        if (p.based_on_revision_id && !revisions.has(p.based_on_revision_id)) {
          fail(eventId, `based_on_revision_id 引用的版本 ${p.based_on_revision_id} 不存在`);
        }
        for (const fid of p.incorporated_feedback_ids ?? []) {
          if (!feedbacks.has(fid)) fail(eventId, `采纳的反馈 ${fid} 不存在`);
        }
        for (const nid of p.incorporated_narrative_ids ?? []) {
          const n = narratives.get(nid);
          if (!n) fail(eventId, `引用的叙事 ${nid} 不存在`);
          else if (n.status === "disputed") fail(eventId, `叙事 ${nid} 处于争议状态，不得纳入方案`);
          else if (n.status === "retracted") fail(eventId, `叙事 ${nid} 已撤回，不得纳入方案`);
        }
        revisions.add(aggregateId);
        break;
      }
      case "DESIGN_RESPONDED": {
        if (!revisions.has(p.revision_id)) fail(eventId, "回应所针对的方案版本不存在");
        for (const fid of [...(p.feedback_ids_addressed ?? []), ...(p.feedback_ids_not_adopted ?? [])]) {
          if (!feedbacks.has(fid)) fail(eventId, `引用的反馈 ${fid} 不存在`);
        }
        const reasons = p.not_adopted_reasons ?? {};
        for (const fid of p.feedback_ids_not_adopted ?? []) {
          if (!reasons[fid]) fail(eventId, `未采纳反馈 ${fid} 必须在 not_adopted_reasons 中公开原因`);
        }
        for (const nid of p.narrative_ids_addressed ?? []) {
          if (!narratives.has(nid)) fail(eventId, `引用的叙事 ${nid} 不存在`);
        }
        revisions.add(aggregateId);
        break;
      }
      case "UNSAFE_OR_DISCRIMINATORY_INPUT_REJECTED": {
        if (!p.source_feedback_id && !p.source_narrative_id) {
          fail(eventId, "必须指明被拒绝建议的来源（source_feedback_id 或 source_narrative_id）");
        }
        if (p.source_feedback_id && !feedbacks.has(p.source_feedback_id)) fail(eventId, "来源反馈不存在");
        if (p.source_narrative_id && !narratives.has(p.source_narrative_id)) fail(eventId, "来源叙事不存在");
        break;
      }
      case "DESIGN_FROZEN_FOR_BUILD": {
        if (!revisions.has(p.revision_id)) fail(eventId, "方案版本不存在");
        if (p.safety_review_result !== "passed") {
          fail(eventId, "安全评审未通过（passed）的方案不得冻结用于施工");
        } else {
          frozenRevisions.set(p.revision_id, record);
        }
        break;
      }

      // ---------- 旧物与材料 ----------
      case "MATERIAL_PLEDGED": {
        if (p.consent_id) {
          const c = consents.get(p.consent_id);
          if (!c) fail(eventId, `捐借授权 ${p.consent_id} 不存在`);
          else if (!c.scopes.has("material_donation") && !c.scopes.has("material_loan")) {
            fail(eventId, "授权范围不含 material_donation/material_loan，不能登记捐借旧物");
          }
        }
        items.set(aggregateId, { pledgeAt: now });
        break;
      }
      case "OWNERSHIP_VERIFIED": {
        const item = items.get(aggregateId);
        if (!item) fail(eventId, "旧物不存在");
        else item.ownership = { status: p.status, at: now };
        break;
      }
      case "REVERSIBILITY_ASSESSED": {
        const item = items.get(aggregateId);
        if (!item) fail(eventId, "旧物不存在");
        else item.reversibility = { level: p.level, ownerConfirmed: p.owner_confirmed === true, at: now };
        break;
      }
      case "MATERIAL_DISPOSITION_DECIDED": {
        const item = items.get(aggregateId);
        if (!item) {
          fail(eventId, "旧物不存在");
          break;
        }
        if (!item.ownership) fail(eventId, "旧物改造/使用前必须先完成所有权核验（OWNERSHIP_VERIFIED）");
        if (!item.reversibility) fail(eventId, "决定归属前必须先评估可逆范围（REVERSIBILITY_ASSESSED）");
        const clearTitle = ["ownership_verified", "cleared"].includes(item.ownership?.status);
        if (["donated", "loaned", "purchased", "returned"].includes(p.decision) && !clearTitle) {
          fail(eventId, "所有权未核验清楚时只能决定 declined_unclear_title 或 in_dispute_hold，不得投入使用");
        }
        if (["declined_unclear_title", "in_dispute_hold"].includes(p.decision) && clearTitle) {
          fail(eventId, "所有权已核验清楚，不应以权属不清为由搁置或拒收");
        }
        if (item.reversibility?.level === "irreversible" && item.reversibility.ownerConfirmed !== true) {
          fail(eventId, "不可逆改造必须经所有者书面确认（owner_confirmed=true）");
        }
        if (!p.owner_signed) fail(eventId, "归属与撤回展示安排须有签署协议（owner_signed=true），不能只靠口头约定");
        item.disposition = { decision: p.decision, fate: p.agreed_fate_on_withdrawal, at: now };
        break;
      }
      case "MATERIAL_RECALLED": {
        const item = items.get(aggregateId);
        if (!item) fail(eventId, "旧物不存在");
        else if (item.disposition?.decision !== "loaned") fail(eventId, "只有借展物可以召回；捐赠物的撤回应走 WORK_WITHDRAWN_FROM_DISPLAY");
        break;
      }
      case "WORK_WITHDRAWN_FROM_DISPLAY": {
        const item = items.get(aggregateId);
        if (!item) fail(eventId, "旧物不存在");
        else if (!item.disposition) fail(eventId, "尚未约定归属与撤回安排");
        else if (p.fate !== "renegotiate" && p.fate !== item.disposition.fate) {
          fail(eventId, `撤展去向必须按事先约定执行（约定：${item.disposition.fate}），重新协商须记为 renegotiate`);
        }
        break;
      }

      // ---------- 儿童参与 ----------
      case "MINOR_CONSENT_GRANTED": {
        if (p.consent_channel !== "guardian_counter_signed") {
          fail(eventId, "儿童参与必须由监护人书面会签（guardian_counter_signed）");
        }
        minorConsents.set(aggregateId, { active: true, incorporated: [] });
        break;
      }
      case "MINOR_WORK_INCORPORATED": {
        const mc = minorConsents.get(p.minor_consent_id);
        if (!mc) fail(eventId, "儿童参与同意不存在");
        else if (!mc.active) fail(eventId, "同意已撤回，不能再将儿童作品纳入方案");
        else if (!revisions.has(p.revision_id)) fail(eventId, "纳入的方案版本不存在");
        mc?.incorporated.push({ revisionId: p.revision_id, at: now });
        break;
      }
      case "MINOR_CONSENT_WITHDRAWN": {
        const mc = minorConsents.get(aggregateId);
        if (!mc) fail(eventId, "儿童参与同意不存在");
        else if (!mc.active) fail(eventId, "同意已失效");
        else mc.active = false;
        if (!p.personal_data_action) fail(eventId, "撤回必须说明已纳入作品与个人信息的处置方式");
        break;
      }

      // ---------- 预算采购 ----------
      case "BUDGET_ALLOCATED":
      case "BUDGET_CHANGED":
      case "PROCUREMENT_RECORDED":
      case "DONATED_ITEM_VALUED":
        break;

      // ---------- 施工与验收 ----------
      case "INSTALLATION_STARTED": {
        if (!frozenRevisions.has(p.revision_id)) {
          fail(eventId, "只能按已冻结且安全评审通过的版本施工（DESIGN_FROZEN_FOR_BUILD）");
        }
        for (const itemId of p.material_item_ids ?? []) {
          const item = items.get(itemId);
          if (!item) {
            fail(eventId, `施工使用的旧物 ${itemId} 不存在`);
            continue;
          }
          if (!["ownership_verified", "cleared"].includes(item.ownership?.status)) {
            fail(eventId, `旧物 ${itemId} 所有权未核验清楚，不得投入施工改造`);
          }
          if (!item.reversibility) fail(eventId, `旧物 ${itemId} 未评估可逆范围，不得投入施工改造`);
          if (!["donated", "loaned", "purchased"].includes(item.disposition?.decision)) {
            fail(eventId, `旧物 ${itemId} 未完成捐借/采购处置决定，不得投入施工改造`);
          }
        }
        installations.set(aggregateId, { started: true, revisionId: p.revision_id, itemIds: p.material_item_ids ?? [], accepted: false });
        break;
      }
      case "CONSTRUCTION_INCIDENT_RECORDED": {
        if (!installations.get(aggregateId)?.started) fail(eventId, "施工尚未开始，不能登记施工事件");
        break;
      }
      case "INSTALLATION_ACCEPTED": {
        const install = installations.get(aggregateId);
        if (!install?.started) fail(eventId, "施工未开始，不能验收");
        if (["accepted", "accepted_with_rectification"].includes(p.result) && !p.as_built_doc_ref) {
          fail(eventId, "通过验收（含带整改通过）必须留存竣工文档 as_built_doc_ref");
        }
        if (p.result === "accepted_with_rectification" && (!(p.rectification_items?.length > 0) || !p.rectification_deadline)) {
          fail(eventId, "带整改通过必须列出整改项与整改期限");
        }
        if (p.result === "rejected" && !(p.rectification_items?.length > 0)) {
          fail(eventId, "验收驳回必须列出不合格项");
        }
        install.accepted = p.result !== "rejected";
        if (install.accepted) {
          works.set(p.work_asset_id, { revisionId: p.revision_id, itemIds: install.itemIds, acceptedAt: now });
        }
        break;
      }

      // ---------- 署名与发布 ----------
      case "CREDIT_PREFERENCE_RECORDED":
        break;
      case "WORK_PUBLISHED": {
        const work = works.get(p.work_asset_id);
        if (!work) fail(eventId, "作品尚未通过验收，不能公开发布");
        else if (work.revisionId !== p.revision_id) fail(eventId, "发布所依据的版本与验收版本不一致");
        if (p.includes_minor_work) {
          const activeIncorporation = [...minorConsents.values()].some(
            (mc) => mc.active && mc.incorporated.some((inc) => inc.revisionId === p.revision_id),
          );
          if (!activeIncorporation) fail(eventId, "发布声明含儿童作品，但缺少有效同意下的儿童作品纳入记录");
        }
        publishedWorks.set(p.work_asset_id, record);
        break;
      }
      case "PUBLICATION_TAKEN_DOWN": {
        if (!publishedWorks.has(p.work_asset_id)) fail(eventId, "作品尚未发布，不能下架");
        publishedWorks.delete(p.work_asset_id);
        break;
      }

      // ---------- 养护责任 ----------
      case "MAINTENANCE_ASSIGNED": {
        if (!works.has(p.work_asset_id)) fail(eventId, "作品未通过验收，不能指派养护责任");
        obligations.set(aggregateId, { status: "active", at: now });
        break;
      }
      case "MAINTENANCE_HANDOFF": {
        const ob = obligations.get(p.obligation_id);
        if (!ob) fail(eventId, "养护责任不存在");
        if (!(p.handed_over_records?.length > 0)) {
          fail(eventId, "交接必须移交完整版本与养护记录（handed_over_records 不能为空），确保毕业或更换承包方后可追溯");
        }
        if (ob) ob.status = "transferred";
        break;
      }
      case "OBLIGATION_STATUS_CHANGED": {
        const ob = obligations.get(p.obligation_id);
        if (!ob) fail(eventId, "养护责任不存在");
        else if (p.status === "transferred" && ob.status !== "transferred") {
          fail(eventId, "状态转为 transferred 必须经由 MAINTENANCE_HANDOFF");
        } else ob.status = p.status;
        break;
      }

      // ---------- 巡检与修复 ----------
      case "INSPECTION_LOGGED": {
        if (!works.has(p.work_asset_id)) fail(eventId, "只能对已验收作品登记巡检");
        inspections.add(aggregateId);
        break;
      }
      case "REPAIR_OPENED": {
        if (!works.has(p.work_asset_id)) fail(eventId, "只能对已验收作品立案修复");
        if (p.inspection_id && !inspections.has(p.inspection_id)) fail(eventId, "引用的巡检记录不存在");
        repairs.set(aggregateId, { workAssetId: p.work_asset_id, determined: false, completed: false });
        break;
      }
      case "DAMAGE_LIABILITY_DETERMINED": {
        const repair = repairs.get(aggregateId);
        if (!repair) {
          fail(eventId, "修复案件不存在");
          break;
        }
        const allowed = liabilityByCategory[p.category];
        if (allowed && !allowed.includes(p.liable_party)) {
          fail(eventId, `责任类别 ${p.category} 与责任方 ${p.liable_party} 不匹配（允许：${allowed.join(" / ")}）`);
        }
        if ((p.dissenting_party_ref && !p.dissent_note) || (!p.dissenting_party_ref && p.dissent_note)) {
          fail(eventId, "异议方与异议说明必须同时出现");
        }
        repair.determined = true;
        break;
      }
      case "REPAIR_COMPLETED": {
        const repair = repairs.get(aggregateId);
        if (!repair) fail(eventId, "修复案件不存在");
        else if (!repair.determined) fail(eventId, "完成修复前必须先区分设计缺陷、施工责任或自然损耗（DAMAGE_LIABILITY_DETERMINED）");
        const work = works.get(repair.workAssetId);
        if (work?.itemIds?.length > 0 && typeof p.reversibility_preserved !== "boolean") {
          fail(eventId, "作品含居民旧物，修复完成必须说明可逆性是否保持（reversibility_preserved）");
        }
        if (repair) repair.completed = true;
        break;
      }
      case "REPAIR_DISPUTED": {
        if (!repairs.get(aggregateId)) fail(eventId, "修复案件不存在");
        break;
      }

      // ---------- 更正 ----------
      case "RECORD_CORRECTED": {
        if (!seenEventIds.has(p.corrected_event_id)) fail(eventId, "被更正的事件不存在");
        else {
          const original = records.find((r) => r.event_id === p.corrected_event_id);
          if (original && Date.parse(original.occurred_at) > now) fail(eventId, "更正记录不能早于原记录");
        }
        break;
      }

      default:
        fail(eventId, `未实现流校验的事件类型：${eventType}`);
    }
  }

  return errors;
}
