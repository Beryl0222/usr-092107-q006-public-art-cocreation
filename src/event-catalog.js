// 公共艺术共创履约簿：领域事件目录（单一事实源）
// 校验器（src/validator.js）与 JSON Schema（contracts/domain.schema.json）均从此处生成，
// 避免事件名称与必备字段在两处漂移。
//
// 设计约定：
// - 事件只记录“一次选择”，不记录成品状态；状态由事件流回放得到。
// - 记录一经接收，event_id / occurred_at / version 不得原地改写；更正只能追加 RECORD_CORRECTED。
// - visibility 控制谁能看到该记录；sensitivity 标注载荷中的敏感信息类别。
// - 个人、机构及商业敏感信息仅向履行职责所需的调用方开放（restricted）。

export const VISIBILITY = ["open", "community", "internal", "restricted"];

// open       任何人（含匿名居民页）
// community  登记的社区参与者（通勤者、村民、捐物人等）
// internal   校社会实践中心、运营单位等履约方
// restricted 仅具体职责所需人员（含个人隐私、儿童、商业、成绩信息）
export const VISIBILITY_MEANING = {
  open: "任何人可见",
  community: "登记社区参与者可见",
  internal: "履约相关机构可见",
  restricted: "职责所需最小范围可见",
};

export const SENSITIVITY = ["none", "personal", "minority", "commercial", "confidential"];

export const AGGREGATE_TYPES = [
  "site_commission",
  "community_input",
  "community_feedback",
  "design_revision",
  "material_agreement",
  "child_participation",
  "budget_procurement",
  "construction_acceptance",
  "defect_claim",
  "credit_attribution",
  "maintenance_obligation",
  "student_assessment",
];

// visibility：该事件允许的可见档位（记录可在此基础上进一步收紧）
// sensitivity：该事件允许出现的敏感标注
// required：payload 必备字段（点号表示一层嵌套对象内的必备键）
// enums：载荷字段的受控取值
export const EVENT_SPECS = [
  // —— 场地委托 ——
  {
    type: "COMMISSION_OPENED",
    aggregate: "site_commission",
    visibility: ["open", "community"],
    sensitivity: ["none"],
    required: ["site_name", "site_kind", "commissioning_party"],
    enums: { site_kind: ["transit_station", "village", "school", "other_public_space"] },
    note: "场地委托设立，明确委托方与场地类型",
  },
  {
    type: "STEWARDSHIP_HANDED_OVER",
    aggregate: "site_commission",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none", "commercial"],
    required: ["handover_ref", "recipient_org", "obligation_event_ids", "archive_ref", "accepted"],
    note: "毕业/承包方更换后的养护责任与完整版本档案交接；义务必须先有责任主体",
  },
  {
    type: "EXHIBITION_WITHDRAWN",
    aggregate: "site_commission",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none"],
    required: ["reason", "decided_by", "community_notice", "disposition_of_components"],
    note: "作品整体撤展或停止展示，须说明部件去向与社区告知方式",
  },

  // —— 社区访谈与地方叙事 ——
  {
    type: "SITE_CONTEXT_RECORDED",
    aggregate: "community_input",
    visibility: ["internal", "restricted"],
    sensitivity: ["personal", "minority", "none"],
    required: ["participant_ref", "source_type", "narrative_summary"],
    enums: { source_type: ["interview", "workshop", "field_observation", "oral_history", "document"] },
    note: "街区记忆/地方叙事的访谈或工作坊摘要（授权前先以化名记录）",
  },
  {
    type: "INPUT_CONSENTED",
    aggregate: "community_input",
    visibility: ["restricted"],
    sensitivity: ["personal", "minority"],
    required: ["participant_ref", "context_event_id", "consent_scope", "consent_basis"],
    note: "访谈/叙事的使用授权摘要：用途范围、授权方式、可否撤回",
  },
  {
    type: "NARRATIVE_SOURCE_CITED",
    aggregate: "community_input",
    visibility: ["internal", "restricted"],
    sensitivity: ["personal", "minority", "none"],
    required: ["source_ref", "provenance_type", "access_grant"],
    enums: { provenance_type: ["resident_account", "family_archive", "local_record", "published_work", "oral_tradition"] },
    note: "地方叙事来源与出处，区分亲历、家藏、公开资料与口述传统",
  },
  {
    type: "CONSENT_WITHDRAWN",
    aggregate: "community_input",
    visibility: ["restricted", "internal"],
    sensitivity: ["personal", "minority"],
    required: ["consent_event_id", "scope_remaining", "effect_on_records"],
    note: "授权撤回：保留的范围与对已展示内容的处理（撤除音频等）",
  },

  // —— 公开反馈与代表性 ——
  {
    type: "FEEDBACK_RECORDED",
    aggregate: "community_feedback",
    visibility: ["community", "restricted"],
    sensitivity: ["personal", "minority", "none"],
    required: ["submitter_category", "content_summary", "is_accessibility_related"],
    enums: {
      submitter_category: ["commuter", "villager", "accessibility_user", "minority_group_member", "student", "operator", "other"],
    },
    note: "公开反馈原条；少数群体/无障碍使用身份自行声明，禁止反推",
  },
  {
    type: "FEEDBACK_TRIAGED",
    aggregate: "community_feedback",
    visibility: ["internal"],
    sensitivity: ["minority", "none"],
    required: ["feedback_event_ids", "reach_summary", "weighting_rationale", "minority_or_accessibility_flags"],
    note: "反馈归类：数量只描述覆盖度，不替代代表性；加权理由必须写明，被标记的少数/无障碍异议须逐条回应",
  },
  {
    type: "OBJECTION_RESPONDED",
    aggregate: "community_feedback",
    visibility: ["community", "internal"],
    sensitivity: ["minority", "none"],
    required: ["objection_event_id", "response", "disposition", "follow_up_required"],
    enums: { disposition: ["accepted", "partially_adopted", "not_adopted"] },
    note: "对少数群体或无障碍异议的单独回应，禁止以多数票数合并处理",
  },

  // —— 方案版本与回应 ——
  {
    type: "DESIGN_DRAFTED",
    aggregate: "design_revision",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none"],
    required: ["title", "based_on_input_event_ids", "proposal_summary"],
    note: "方案初稿；所依据的社区输入必须已授权",
  },
  {
    type: "DESIGN_REVISION_PUBLISHED",
    aggregate: "design_revision",
    visibility: ["open", "community"],
    sensitivity: ["none"],
    required: ["revision_no", "based_on_draft_event_id", "change_summary"],
    note: "公开发布的方案版本，完整保留旧版而非覆盖",
  },
  {
    type: "DESIGN_RESPONDED",
    aggregate: "design_revision",
    visibility: ["open", "community"],
    sensitivity: ["none"],
    required: ["feedback_event_id", "decision", "rationale"],
    enums: { decision: ["adopted", "partially_adopted", "not_adopted"] },
    note: "居民可见：建议如何影响方案，或未采纳的理由",
  },
  {
    type: "SAFETY_OR_DISCRIMINATION_REFUSAL",
    aggregate: "design_revision",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none"],
    required: ["refused_suggestion_summary", "basis_category", "basis_detail"],
    enums: {
      basis_category: ["safety_code", "structural_safety", "fire_egress", "accessibility_barrier", "discrimination", "privacy_harm", "other_legal"],
    },
    note: "创作者拒绝不安全或歧视性建议，并书面说明依据与替代方案",
  },

  // —— 旧物捐借 ——
  {
    type: "MATERIAL_PLEDGED",
    aggregate: "material_agreement",
    visibility: ["restricted", "internal"],
    sensitivity: ["personal", "none"],
    required: ["material_ref", "donor_category", "description", "intended_use"],
    enums: { donor_category: ["resident", "villager", "village_collective", "alumnus", "institution", "other"] },
    note: "旧物捐出/借出示意，尚未确认所有权，不得动工改造",
  },
  {
    type: "OWNERSHIP_VERIFIED",
    aggregate: "material_agreement",
    visibility: ["restricted", "internal"],
    sensitivity: ["personal", "none"],
    required: ["material_ref", "ownership_basis", "reversible_scope", "post_project_arrangement"],
    note: "所有权确认与可逆范围：可否复原、允许的改造方式、限制、项目结束后的安排",
  },
  {
    type: "MATERIAL_LOAN_AGREEMENT_SIGNED",
    aggregate: "material_agreement",
    visibility: ["restricted"],
    sensitivity: ["personal", "commercial", "none"],
    required: ["agreement_ref", "material_ref", "loan_period", "return_terms", "maintenance_duty", "withdrawal_terms"],
    note: "借用协议：期限、归还、维护与提前撤回展示条件，取代口头约定",
  },
  {
    type: "MATERIAL_DONATION_AGREEMENT_SIGNED",
    aggregate: "material_agreement",
    visibility: ["restricted"],
    sensitivity: ["personal", "commercial", "none"],
    required: ["agreement_ref", "material_ref", "ownership_transfer_terms", "maintenance_duty", "withdrawal_terms"],
    note: "捐赠协议：权属转移、维护责任与撤回展示安排",
  },
  {
    type: "MATERIAL_WITHDRAWN",
    aggregate: "material_agreement",
    visibility: ["community", "internal", "restricted"],
    sensitivity: ["personal", "none"],
    required: ["material_ref", "reason", "disposition", "community_notice"],
    enums: { disposition: ["returned_to_owner", "replaced_in_work", "removed_from_work"] },
    note: "旧物撤回展示：归还/替代/移除及社区告知；须已有书面协议",
  },
  {
    type: "MATERIAL_INCORPORATED",
    aggregate: "material_agreement",
    visibility: ["internal", "restricted"],
    sensitivity: ["none", "personal"],
    required: ["material_ref", "revision_event_id", "reversibility_confirmed"],
    note: "旧物实际用于某方案版本；前置：所有权已核实、协议已签、可逆性已确认",
  },

  // —— 儿童参与 ——
  {
    type: "CHILD_PARTICIPATION_CONSENTED",
    aggregate: "child_participation",
    visibility: ["restricted"],
    sensitivity: ["personal", "confidential"],
    required: ["child_participation_ref", "guardian_consent", "activity_scope", "withdrawal_policy_summary"],
    note: "监护人同意（形式、见证人、时间）与可随时撤回的说明",
  },
  {
    type: "CHILD_WORK_AGREEMENT_RECORDED",
    aggregate: "child_participation",
    visibility: ["restricted"],
    sensitivity: ["personal", "confidential"],
    required: ["agreement_ref", "child_participation_refs", "display_terms", "withdrawal_terms", "attribution_choice"],
    note: "儿童作品展示条款：署名方式（可匿名）、撤回后处理",
  },

  // —— 预算与采购 ——
  {
    type: "BUDGET_APPROVED",
    aggregate: "budget_procurement",
    visibility: ["internal"],
    sensitivity: ["none", "commercial"],
    required: ["budget_ref", "total_amount", "currency", "category_breakdown"],
    note: "预算批准；验收前必须存在已批准预算",
  },
  {
    type: "PROCUREMENT_RECORDED",
    aggregate: "budget_procurement",
    visibility: ["restricted", "internal"],
    sensitivity: ["commercial"],
    required: ["procurement_ref", "budget_event_id", "item_summary", "amount", "conflict_of_interest_declared"],
    note: "采购记录与利益冲突声明；商业信息不向社区公开",
  },

  // —— 施工与验收 ——
  {
    type: "CONSTRUCTION_LOGGED",
    aggregate: "construction_acceptance",
    visibility: ["internal"],
    sensitivity: ["none", "commercial"],
    required: ["scope", "contractor_ref", "started_at", "safety_review_ref"],
    note: "施工登记：范围、承包方、安全评审编号",
  },
  {
    type: "INSTALLATION_ACCEPTED",
    aggregate: "construction_acceptance",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none"],
    required: ["result", "inspector_roles", "accepted_at"],
    enums: { result: ["accepted", "accepted_with_conditions", "rejected"] },
    note: "施工验收；前置：预算已批准、被标记异议均已回应、入作旧物均已确权签约",
  },

  // —— 损坏、归责与修复 ——
  {
    type: "DAMAGE_REPORTED",
    aggregate: "defect_claim",
    visibility: ["internal", "restricted"],
    sensitivity: ["none"],
    required: ["damage_ref", "description", "severity", "discovered_at"],
    enums: { severity: ["cosmetic", "functional", "safety"] },
    note: "户外作品损坏上报",
  },
  {
    type: "DEFECT_CLASSIFIED",
    aggregate: "defect_claim",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none"],
    required: ["damage_event_id", "category", "responsibility_basis", "responsible_party_role"],
    enums: {
      category: ["design_defect", "construction_fault", "natural_wear", "third_party_damage", "undetermined"],
    },
    note: "区分设计缺陷、施工责任、自然损耗与第三方损坏；修复拨款前必须先归责",
  },
  {
    type: "REPAIR_RESOLVED",
    aggregate: "defect_claim",
    visibility: ["community", "internal"],
    sensitivity: ["commercial", "none"],
    required: ["damage_event_id", "actions", "cost_allocation", "completed_at"],
    note: "修复完成与费用承担依据；前置：已上报且已归责",
  },

  // —— 署名 ——
  {
    type: "ATTRIBUTION_RECORDED",
    aggregate: "credit_attribution",
    visibility: ["open", "community"],
    sensitivity: ["personal", "minority", "none"],
    required: ["credits", "display_form"],
    note: "署名记录：师生、居民叙事者、儿童可选择匿名或化名",
  },

  // —— 长期养护 ——
  {
    type: "MAINTENANCE_ASSIGNED",
    aggregate: "maintenance_obligation",
    visibility: ["open", "community", "internal"],
    sensitivity: ["none"],
    required: ["obligation_ref", "duty_holder_role", "duty_holder_org", "scope", "review_cycle"],
    note: "养护义务落到机构/岗位而非个人，毕业或换人后承诺仍可追溯",
  },
  {
    type: "INSPECTION_LOGGED",
    aggregate: "maintenance_obligation",
    visibility: ["community", "internal"],
    sensitivity: ["none"],
    required: ["obligation_event_id", "inspected_at", "inspector_role", "findings", "follow_up"],
    note: "周期巡检结果与待办",
  },
  {
    type: "OBLIGATION_ESCALATED",
    aggregate: "maintenance_obligation",
    visibility: ["internal", "restricted"],
    sensitivity: ["none"],
    required: ["obligation_event_id", "reason", "escalated_to", "status"],
    enums: { status: ["open", "in_progress", "closed"] },
    note: "养护义务未履行时的升级处理",
  },

  // —— 学生评价（与社区严格隔离）——
  {
    type: "STUDENT_GRADED",
    aggregate: "student_assessment",
    visibility: ["restricted"],
    sensitivity: ["confidential"],
    required: ["student_ref", "assignment_ref", "grade", "graded_by"],
    note: "学生个人作业评价，绝不进入社区视图",
  },

  // —— 更正（追加，不改写）——
  {
    type: "RECORD_CORRECTED",
    aggregate: undefined, // 与被更正记录同聚合，由校验器按 corrected_event_id 核对
    visibility: ["open", "community", "internal", "restricted"],
    sensitivity: ["none", "personal", "minority", "commercial", "confidential"],
    required: ["corrected_event_id", "corrected_event_type", "correction_reason"],
    note: "后继更正记录；与原记录同聚合、版本号更大，可见档位不得宽于原记录",
  },
];

export const EVENT_TYPE_BY_SPEC = new Map(EVENT_SPECS.map((spec) => [spec.type, spec]));

// 社区视图中一律脱敏的载荷键（不限事件类型）
export const REDACTED_PAYLOAD_KEYS = [
  "personal_name",
  "legal_name",
  "id_number",
  "phone",
  "email",
  "contact",
  "contact_info",
  "donor_name",
  "donor_contact",
  "address",
  "student_ref",
];
