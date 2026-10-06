// 事件信封校验 + 事件流不变量校验 + 社区视图投影。
// 本模块不做 JSON Schema 全量校验，而是编码领域规则：
// 记录不可变、旧物权属/可逆前置、少数与无障碍异议逐条回应、
// 验收前置、损坏归责前置、学生评价不进社区视图、版本交接完整。
import {
  EVENT_TYPE_BY_SPEC,
  REDACTED_PAYLOAD_KEYS,
  SENSITIVITY,
  VISIBILITY,
} from "./event-catalog.js";

const ENVELOPE_REQUIRED = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
  "visibility",
  "payload",
];

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function hasOwn(record, key) {
  return record != null && typeof record === "object" && Object.prototype.hasOwnProperty.call(record, key);
}

// —— 单条记录的信封与事件级规则 ——
export function validateEvent(record) {
  const errors = [];

  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    return ["记录必须是对象"];
  }

  for (const name of ENVELOPE_REQUIRED) {
    if (!hasOwn(record, name)) errors.push(`缺少字段：${name}`);
  }
  if (errors.length > 0) return errors;

  if (typeof record.event_id !== "string" || record.event_id.trim() === "") {
    errors.push("event_id 必须是非空字符串");
  }
  if (typeof record.aggregate_id !== "string" || record.aggregate_id.trim() === "") {
    errors.push("aggregate_id 必须是非空字符串");
  }
  if (typeof record.summary !== "string" || record.summary.trim() === "") {
    errors.push("summary 必须是非空字符串");
  }
  if (!Number.isInteger(record.version) || record.version < 1) {
    errors.push("version 必须是正整数");
  }
  if (typeof record.occurred_at !== "string" || !ISO_DATE_TIME.test(record.occurred_at)) {
    errors.push("occurred_at 必须是带时区的 ISO 8601 日期时间");
  }
  if (record.payload == null || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    errors.push("payload 必须是对象");
  }
  if (!VISIBILITY.includes(record.visibility)) {
    errors.push(`visibility 必须是：${VISIBILITY.join(" / ")}`);
  }
  if (hasOwn(record, "sensitivity") && !SENSITIVITY.includes(record.sensitivity)) {
    errors.push(`sensitivity 必须是：${SENSITIVITY.join(" / ")}`);
  }

  const spec = EVENT_TYPE_BY_SPEC.get(record.event_type);
  if (!spec) {
    errors.push(`未知事件类型：${record.event_type}`);
    return errors;
  }

  // RECORD_CORRECTED 与被更正记录同聚合，目录中 aggregate 留空
  if (spec.aggregate && record.aggregate_type !== spec.aggregate) {
    errors.push(`${record.event_type} 的 aggregate_type 必须是 ${spec.aggregate}`);
  }
  if (!spec.visibility.includes(record.visibility)) {
    errors.push(`${record.event_type} 的 visibility 只能取：${spec.visibility.join(" / ")}`);
  }
  if (hasOwn(record, "sensitivity") && !spec.sensitivity.includes(record.sensitivity)) {
    errors.push(`${record.event_type} 的 sensitivity 只能取：${spec.sensitivity.join(" / ")}`);
  }

  const payload = record.payload ?? {};
  for (const dotted of spec.required) {
    const [head] = dotted.split(".");
    if (!hasOwn(payload, head)) {
      errors.push(`${record.event_type} 缺少 payload 字段：${dotted}`);
    }
  }
  for (const [key, allowed] of Object.entries(spec.enums ?? {})) {
    if (hasOwn(payload, key) && !allowed.includes(payload[key])) {
      errors.push(`${record.event_type} 的 payload.${key} 必须是：${allowed.join(" / ")}`);
    }
  }

  return errors;
}

// —— 事件流（同一委托线程）的领域不变量 ——
// events 按 occurred_at 与 version 排列；跨线程引用通过 aggregate_id 约定：
// 同一委托下的材料、方案、反馈等聚合 id 以 "<commission_id>#" 为前缀。
export function validateEventStream(events) {
  const errors = [];
  const byId = new Map();
  const byAggregate = new Map();

  const seenKey = new Set();
  for (const [index, event] of events.entries()) {
    const where = `第 ${index + 1} 条（${event.event_id ?? "无 event_id"}）`;
    for (const err of validateEvent(event)) errors.push(`${where}：${err}`);

    if (byId.has(event.event_id)) errors.push(`${where}：event_id 重复 ${event.event_id}`);
    byId.set(event.event_id, event);

    const key = `${event.aggregate_type}:${event.aggregate_id}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      byAggregate.set(key, []);
    }
    byAggregate.get(key).push(event);
  }

  // 聚合内版本号严格递增、时间不倒流
  for (const [key, list] of byAggregate) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].version <= list[i - 1].version) {
        errors.push(`聚合 ${key}：version 必须严格递增（${list[i - 1].version} → ${list[i].version}）`);
      }
      if (Date.parse(list[i].occurred_at) < Date.parse(list[i - 1].occurred_at)) {
        errors.push(`聚合 ${key}：occurred_at 不得早于前序记录`);
      }
    }
  }

  const ref = (id) => byId.get(id);
  const requireRef = (event, id, label) => {
    if (!id) {
      errors.push(`${event.event_type} ${event.event_id}：缺少 ${label} 引用`);
      return null;
    }
    const target = ref(id);
    if (!target) errors.push(`${event.event_type} ${event.event_id}：${label} ${id} 不存在`);
    return target;
  };

  // 材料状态机：捐赠/借用意向 → 所有权核实 → 书面协议 → 入作；撤回须有协议
  const materialIncorporatedRefs = new Set();
  for (const event of events) {
    const p = event.payload ?? {};
    switch (event.event_type) {
      case "INPUT_CONSENTED": {
        const ctx = requireRef(event, p.context_event_id, "访谈记录");
        if (ctx && ctx.event_type !== "SITE_CONTEXT_RECORDED") {
          errors.push(`${event.event_id}：授权必须指向 SITE_CONTEXT_RECORDED`);
        }
        break;
      }
      case "CONSENT_WITHDRAWN": {
        const consent = requireRef(event, p.consent_event_id, "授权记录");
        if (consent && consent.event_type !== "INPUT_CONSENTED") {
          errors.push(`${event.event_id}：撤回必须指向 INPUT_CONSENTED`);
        }
        break;
      }
      case "DESIGN_DRAFTED": {
        for (const id of p.based_on_input_event_ids ?? []) {
          const src = requireRef(event, id, "社区输入");
          if (src && src.event_type === "SITE_CONTEXT_RECORDED" && !hasConsent(events, src.event_id)) {
            errors.push(`${event.event_id}：引用的访谈 ${src.event_id} 尚未取得 INPUT_CONSENTED 授权`);
          }
        }
        break;
      }
      case "DESIGN_RESPONDED":
      case "OBJECTION_RESPONDED": {
        const fb = requireRef(event, p.feedback_event_id ?? p.objection_event_id, "反馈/异议");
        if (fb && fb.event_type !== "FEEDBACK_RECORDED") {
          errors.push(`${event.event_id}：回应必须指向 FEEDBACK_RECORDED`);
        }
        break;
      }
      case "MATERIAL_PLEDGED":
        break;
      case "OWNERSHIP_VERIFIED": {
        if (!findMaterialEvent(events, p.material_ref, "MATERIAL_PLEDGED")) {
          errors.push(`${event.event_id}：材料 ${p.material_ref} 缺少 MATERIAL_PLEDGED 意向`);
        }
        break;
      }
      case "MATERIAL_LOAN_AGREEMENT_SIGNED":
      case "MATERIAL_DONATION_AGREEMENT_SIGNED": {
        if (!findMaterialEvent(events, p.material_ref, "OWNERSHIP_VERIFIED")) {
          errors.push(`${event.event_id}：材料 ${p.material_ref} 未先确认 OWNERSHIP_VERIFIED，不得签署书面协议`);
        }
        break;
      }
      case "MATERIAL_INCORPORATED": {
        const verified = findMaterialEvent(events, p.material_ref, "OWNERSHIP_VERIFIED");
        if (!verified) {
          errors.push(`${event.event_id}：材料 ${p.material_ref} 入作前未确认所有权与可逆范围`);
        } else if (
          !findMaterialAgreement(events, p.material_ref)
        ) {
          errors.push(`${event.event_id}：材料 ${p.material_ref} 入作前缺少捐赠/借用书面协议`);
        }
        if (p.reversibility_confirmed !== true) {
          errors.push(`${event.event_id}：材料 ${p.material_ref} 入作时 reversibility_confirmed 必须为 true`);
        }
        materialIncorporatedRefs.add(p.material_ref);
        break;
      }
      case "MATERIAL_WITHDRAWN": {
        if (!findMaterialAgreement(events, p.material_ref)) {
          errors.push(`${event.event_id}：材料 ${p.material_ref} 撤回展示缺少书面协议依据（不得只靠口头约定）`);
        }
        break;
      }
      case "CHILD_WORK_AGREEMENT_RECORDED": {
        for (const id of p.child_participation_refs ?? []) {
          // 可引用同意事件 id，或同意记录中的 child_participation_ref
          const consentEvent =
            ref(id)?.event_type === "CHILD_PARTICIPATION_CONSENTED"
              ? ref(id)
              : events.find(
                  (e) =>
                    e.event_type === "CHILD_PARTICIPATION_CONSENTED" &&
                    e.payload?.child_participation_ref === id,
                );
          if (!consentEvent) {
            errors.push(`${event.event_id}：儿童作品协议须有监护人同意 ${id}`);
          }
        }
        break;
      }
      case "PROCUREMENT_RECORDED": {
        const budget = requireRef(event, p.budget_event_id, "预算");
        if (budget && budget.event_type !== "BUDGET_APPROVED") {
          errors.push(`${event.event_id}：采购必须指向 BUDGET_APPROVED`);
        }
        break;
      }
      case "INSTALLATION_ACCEPTED": {
        checkAcceptance(event, events, errors);
        break;
      }
      case "DEFECT_CLASSIFIED": {
        const dmg = requireRef(event, p.damage_event_id, "损坏上报");
        if (dmg && dmg.event_type !== "DAMAGE_REPORTED") {
          errors.push(`${event.event_id}：归责必须指向 DAMAGE_REPORTED`);
        }
        break;
      }
      case "REPAIR_RESOLVED": {
        const dmg = requireRef(event, p.damage_event_id, "损坏上报");
        if (dmg) {
          const classified = events.find(
            (e) => e.event_type === "DEFECT_CLASSIFIED" && e.payload?.damage_event_id === dmg.event_id,
          );
          if (!classified) {
            errors.push(`${event.event_id}：修复完成前必须先 DEFECT_CLASSIFIED 归责（设计缺陷/施工责任/自然损耗）`);
          }
        }
        break;
      }
      case "INSPECTION_LOGGED": {
        const ob = requireRef(event, p.obligation_event_id, "养护义务");
        if (ob && ob.event_type !== "MAINTENANCE_ASSIGNED") {
          errors.push(`${event.event_id}：巡检必须指向 MAINTENANCE_ASSIGNED`);
        }
        break;
      }
      case "STEWARDSHIP_HANDED_OVER": {
        for (const id of p.obligation_event_ids ?? []) {
          const ob = requireRef(event, id, "养护义务");
          if (ob && ob.event_type !== "MAINTENANCE_ASSIGNED") {
            errors.push(`${event.event_id}：交接清单中的 ${id} 不是 MAINTENANCE_ASSIGNED`);
          }
        }
        if (!p.archive_ref) errors.push(`${event.event_id}：交接必须包含完整版本档案 archive_ref`);
        break;
      }
      case "RECORD_CORRECTED": {
        const original = requireRef(event, p.corrected_event_id, "被更正记录");
        if (original) {
          if (original.aggregate_id !== event.aggregate_id || original.aggregate_type !== event.aggregate_type) {
            errors.push(`${event.event_id}：更正记录必须与原记录处于同一聚合`);
          }
          if (event.version <= original.version) {
            errors.push(`${event.event_id}：更正记录 version 必须大于原记录`);
          }
          if (rankVisibility(event.visibility) < rankVisibility(original.visibility)) {
            errors.push(`${event.event_id}：更正不得放宽原记录的可见档位`);
          }
        }
        if (p.corrected_event_type && original && p.corrected_event_type !== original.event_type) {
          errors.push(`${event.event_id}：corrected_event_type 与原记录不符`);
        }
        break;
      }
      default:
        break;
    }
  }

  // 被标记为少数群体/无障碍的反馈，必须有逐条回应，且不得只出现在归类里
  const flagged = events.filter(
    (e) =>
      e.event_type === "FEEDBACK_RECORDED" &&
      (e.payload?.is_accessibility_related === true ||
        e.payload?.submitter_category === "accessibility_user" ||
        e.payload?.submitter_category === "minority_group_member"),
  );
  for (const fb of flagged) {
    const answered = events.some(
      (e) =>
        (e.event_type === "OBJECTION_RESPONDED" || e.event_type === "DESIGN_RESPONDED") &&
        (e.payload?.objection_event_id === fb.event_id || e.payload?.feedback_event_id === fb.event_id),
    );
    if (!answered) {
      errors.push(`少数群体/无障碍反馈 ${fb.event_id} 必须有单独回应，不得以意见数量或多数意见合并处理`);
    }
  }

  // 撤回授权后，不得再有引用该访谈的新方案版本（时间序检查）
  const withdrawals = events.filter((e) => e.event_type === "CONSENT_WITHDRAWN");
  for (const w of withdrawals) {
    const consent = byId.get(w.payload?.consent_event_id);
    const ctxId = consent?.payload?.context_event_id;
    for (const e of events) {
      if (
        Date.parse(e.occurred_at) >= Date.parse(w.occurred_at) &&
        (e.event_type === "DESIGN_DRAFTED" || e.event_type === "DESIGN_REVISION_PUBLISHED") &&
        JSON.stringify(e.payload ?? {}).includes(ctxId ?? "__none__")
      ) {
        errors.push(`${e.event_id}：访谈 ${ctxId} 的授权已撤回，后续版本不得继续引用`);
      }
    }
  }

  return errors;
}

function hasConsent(events, contextEventId) {
  return events.some(
    (e) => e.event_type === "INPUT_CONSENTED" && e.payload?.context_event_id === contextEventId,
  );
}

function findMaterialEvent(events, materialRef, type) {
  return events.find(
    (e) => e.event_type === type && e.payload?.material_ref === materialRef,
  );
}

function findMaterialAgreement(events, materialRef) {
  return events.find(
    (e) =>
      (e.event_type === "MATERIAL_LOAN_AGREEMENT_SIGNED" ||
        e.event_type === "MATERIAL_DONATION_AGREEMENT_SIGNED") &&
      e.payload?.material_ref === materialRef,
  );
}

function checkAcceptance(event, events, errors) {
  // 验收前置：预算已批准
  const budget = events.find((e) => e.event_type === "BUDGET_APPROVED");
  if (!budget) errors.push(`${event.event_id}：验收前必须有 BUDGET_APPROVED`);

  // 验收前置：所有入作旧物已确权、已签约、可逆性已确认
  const incorporated = events.filter((e) => e.event_type === "MATERIAL_INCORPORATED");
  for (const inc of incorporated) {
    const ref0 = inc.payload?.material_ref;
    if (!findMaterialEvent(events, ref0, "OWNERSHIP_VERIFIED")) {
      errors.push(`${event.event_id}：入作旧物 ${ref0} 未确权，不得验收`);
    }
    if (!findMaterialAgreement(events, ref0)) {
      errors.push(`${event.event_id}：入作旧物 ${ref0} 缺少书面捐借协议，不得验收`);
    }
  }

  // 验收前置：被标记的少数群体/无障碍异议均已逐条回应
  const flaggedIds = events
    .filter(
      (e) =>
        e.event_type === "FEEDBACK_RECORDED" &&
        (e.payload?.is_accessibility_related === true ||
          e.payload?.submitter_category === "accessibility_user" ||
          e.payload?.submitter_category === "minority_group_member"),
    )
    .map((e) => e.event_id);
  for (const id of flaggedIds) {
    const answered = events.some(
      (e) =>
        (e.event_type === "OBJECTION_RESPONDED" || e.event_type === "DESIGN_RESPONDED") &&
        (e.payload?.objection_event_id === id || e.payload?.feedback_event_id === id),
    );
    if (!answered) errors.push(`${event.event_id}：无障碍/少数群体异议 ${id} 未单独回应，不得验收`);
  }
}

// open 最公开（秩最低），restricted 最严格；更正只能收紧不能放宽
function rankVisibility(v) {
  return VISIBILITY.indexOf(v);
}

// —— 社区视图投影 ——
// 居民能看到：公开反馈、方案版本、建议如何影响方案与未采纳理由、
// 异议回应、署名、巡检、归责与修复；看不到：个人作业评价、
// 采购商业细节、访谈个人身份。投影按事件白名单 + 载荷脱敏双重处理。
const COMMUNITY_ALLOWED_TYPES = new Set([
  "COMMISSION_OPENED",
  "STEWARDSHIP_HANDED_OVER",
  "EXHIBITION_WITHDRAWN",
  "FEEDBACK_RECORDED",
  "OBJECTION_RESPONDED",
  "DESIGN_DRAFTED",
  "DESIGN_REVISION_PUBLISHED",
  "DESIGN_RESPONDED",
  "SAFETY_OR_DISCRIMINATION_REFUSAL",
  "MATERIAL_WITHDRAWN",
  "INSTALLATION_ACCEPTED",
  "DEFECT_CLASSIFIED",
  "REPAIR_RESOLVED",
  "ATTRIBUTION_RECORDED",
  "MAINTENANCE_ASSIGNED",
  "INSPECTION_LOGGED",
  "RECORD_CORRECTED",
]);

function redactPayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactPayload(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = REDACTED_PAYLOAD_KEYS.includes(key) ? "【已脱敏】" : redactPayload(child);
    }
    return out;
  }
  return value;
}

export function toCommunityView(events) {
  return events
    .filter(
      (e) =>
        (e.visibility === "open" || e.visibility === "community") &&
        COMMUNITY_ALLOWED_TYPES.has(e.event_type) &&
        e.event_type !== "STUDENT_GRADED",
    )
    .map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      aggregate_id: e.aggregate_id,
      occurred_at: e.occurred_at,
      version: e.version,
      summary: e.summary,
      payload: redactPayload(e.payload),
    }));
}
