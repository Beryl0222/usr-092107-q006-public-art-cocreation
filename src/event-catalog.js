/**
 * 公共艺术共创履约簿——领域事件目录（单一事实源）
 *
 * 设计原则：
 * - 事件只追加、不可原地改写；更正以新的后继记录表达（replaces_event_id / correction_of）。
 * - 每条事件是"一次选择"的留痕，而不是方案成品；版本在聚合内单调递增。
 * - 个人、机构与商业敏感信息不进入事件正文，只以引用句柄（consent_id、document_ref）承载。
 */

export const ENUMS = {
  // 场地与委托
  site_kind: ["metro_station", "village", "other_public_space"],
  commission_status: ["opened", "brief_published", "scope_changed", "completed", "suspended", "withdrawn"],
  scope_change_reason: ["site_condition", "community_request", "safety", "budget", "curatorial", "other"],

  // 访谈与叙事
  participant_group: ["commuter", "resident", "village_resident", "merchant", "elder", "minor", "accessibility_user", "local_storyteller", "school_member", "operator", "other"],
  consent_scope: ["interview_only", "story_use", "likeness_use", "child_participation", "material_donation", "material_loan", "photo_documentation", "public_display"],
  consent_status: ["granted", "refused", "withdrawn", "expired"],
  consent_channel: ["paper_signed", "electronic", "guardian_counter_signed", "oral_with_witness"],
  narrativity_status: ["draft", "verified", "disputed", "retracted"],
  narrative_role: ["personal_memory", "block_history", "place_name_origin", "oral_tradition", "use_expectation", "other"],

  // 反馈
  feedback_channel: ["onsite_board", "public_meeting", "online_form", "interview", "workshop", "mail"],
  visibility_level: ["public", "restricted", "private"],
  representative_status: ["pending_triage", "individual_opinion", "group_position", "minority_or_accessibility_dissent", "duplicate", "out_of_scope"],
  feedback_topic: ["block_memory", "practical_use", "safety", "accessibility", "maintenance", "aesthetics", "discrimination_concern", "privacy", "other"],
  disposition: ["accepted_adopted", "accepted_partial", "noted_no_change", "rejected_creator", "referred_operator", "withdrawn_by_submitter"],

  // 方案
  revision_stage: ["concept_draft", "schematic", "developed", "construction_drawing", "as_built", "withdrawn"],
  safety_review: ["not_required", "pending", "passed", "failed"],
  change_kind: ["response_to_feedback", "site_constraint", "safety", "budget", "material", "curatorial", "other"],

  // 旧物与材料
  item_kind: ["furniture", "tool", "building_component", "textile", "vehicle_part", "ceramic", "document", "signage", "plant", "stone_soil", "other"],
  provenance_status: ["declared", "ownership_verified", "ownership_disputed", "third_party_claim", "cleared"],
  title_basis: ["self_attested", "household_registered", "collective_village_asset", "operator_asset", "purchase_invoice", "abandoned_asset_notice", "other"],
  reversibility_level: ["fully_reversible", "partially_reversible", "irreversible"],
  material_decision: ["donated", "loaned", "purchased", "returned", "declined_unclear_title", "in_dispute_hold"],
  loan_status: ["loaned_out", "recalled", "returned", "converted_to_donation"],
  withdrawal_fate: ["return_to_owner", "village_takeover", "operator_takeover", "school_archive", "decommission_destroy", "renegotiate"],

  // 采购与预算
  budget_change_kind: ["increase", "decrease", "transfer", "supplement"],
  procurement_kind: ["labor", "fabrication", "material", "tool_rental", "service", "transport", "insurance", "accessibility_facility", "other"],

  // 施工与验收
  safety_measure: ["barrier", "signage", "fireproof", "anti_collision", "electrical_safety", "structural_fix", "accessibility_passage", "other"],
  acceptance_result: ["accepted", "accepted_with_rectification", "rejected"],

  // 署名与公开发布
  credit_role: ["lead_creator", "co_creator", "community_contributor", "narrator", "facilitator", "fabricator", "sponsor", "operator", "child_participant"],
  credit_display: ["named", "pseudonym", "collective_name", "anonymous"],
  publication_audience: ["public", "community_only", "school_only", "operator_only"],

  // 养护、巡检、修复
  inspection_result: ["normal", "wear_natural", "damage_external", "damage_design_defect", "damage_construction", "safety_hazard", "accessibility_fault"],
  damage_category: ["design_defect", "construction_liability", "natural_wear", "external_force", "unclear_under_review"],
  repair_status: ["opened", "liability_attributed", "quoted", "in_progress", "completed", "disputed", "waived"],
  liable_party: ["school", "creator_student_team", "fabricator", "operator", "village_collective", "donor", "insurance", "undetermined"],
  caretaker_kind: ["operator", "village_collective", "school_practice_center", "third_party_contractor"],
  handoff_kind: ["student_graduation", "contractor_replacement", "operator_change", "long_term_custody", "temporary_custody"],
  obligation_status: ["active", "transferred", "suspended", "fulfilled", "terminated"],
};

/**
 * 每个聚合：
 * - events：事件名 → { status?, payload: { 字段: 类型或枚举名 }, required: [...] }
 * - 字段类型以字符串表达：
 *   "string" | "integer" | "number" | "boolean" | "array<string>" |
 *   "enum:<枚举名>" | "array<enum:<枚举名>>" | "object"
 */
export const AGGREGATES = {
  site_commission: {
    description: "场地委托：地铁站、乡村等公共空间的共创项目主档",
    events: {
      COMMISSION_OPENED: {
        payload: {
          project_name: "string",
          site_kind: "enum:site_kind",
          site_name: "string",
          commissioning_party_ref: "string",
          school_practice_center_ref: "string",
          operator_ref: "string",
          intended_use: "string",
          public_visibility_default: "enum:visibility_level",
        },
        required: ["project_name", "site_kind", "site_name", "commissioning_party_ref", "school_practice_center_ref"],
      },
      BRIEF_PUBLISHED: {
        payload: {
          brief_version: "integer",
          document_ref: "string",
          feedback_channel: "array<enum:feedback_channel>",
          response_deadline: "string",
        },
        required: ["brief_version", "document_ref"],
      },
      SCOPE_CHANGED: {
        payload: {
          reason: "enum:scope_change_reason",
          change_description: "string",
          affected_aggregate_ids: "array<string>",
          notified_parties: "array<string>",
        },
        required: ["reason", "change_description"],
      },
      COMMISSION_SUSPENDED: {
        payload: { reason: "string", safety_or_legal_hold: "boolean" },
        required: ["reason"],
      },
      COMMISSION_WITHDRAWN: {
        payload: { reason: "string", notices_sent: "array<string>" },
        required: ["reason"],
      },
    },
  },

  community_input: {
    description: "社区访谈与授权摘要：授权句柄与正文分离，撤回即生效",
    events: {
      INPUT_CONSENTED: {
        payload: {
          participant_ref: "string",
          participant_group: "array<enum:participant_group>",
          consent_scope: "array<enum:consent_scope>",
          channel: "enum:consent_channel",
          scope_summary: "string",
          granted_at: "string",
          expires_at: "string",
          guardian_ref: "string",
          witness_ref: "string",
          visibility: "enum:visibility_level",
        },
        required: ["participant_ref", "consent_scope", "channel", "scope_summary"],
      },
      INTERVIEW_SUMMARIZED: {
        payload: {
          consent_id: "string",
          interview_ref: "string",
          summary_text: "string",
          topics: "array<enum:feedback_topic>",
          recorder_ref: "string",
          participant_checked: "boolean",
          visibility: "enum:visibility_level",
        },
        required: ["consent_id", "interview_ref", "summary_text"],
      },
      CONSENT_WITHDRAWN: {
        payload: {
          consent_id: "string",
          scope_withdrawn: "array<enum:consent_scope>",
          reason: "string",
          downstream_items_notified: "array<string>",
        },
        required: ["consent_id"],
      },
      CONSENT_EXPIRED: {
        payload: { consent_id: "string" },
        required: ["consent_id"],
      },
      CONSENT_SCOPE_EXTENDED: {
        payload: {
          consent_id: "string",
          added_scope: "array<enum:consent_scope>",
          channel: "enum:consent_channel",
          guardian_ref: "string",
        },
        required: ["consent_id", "added_scope", "channel"],
      },
    },
  },

  local_narrative: {
    description: "地方叙事来源：多版本、可争议、可撤回，使用范围受授权约束",
    events: {
      NARRATIVE_RECORDED: {
        payload: {
          narrative_id: "string",
          consent_id: "string",
          role: "enum:narrative_role",
          title: "string",
          content_summary: "string",
          source_type: "string",
          source_location_ref: "string",
          status: "enum:narrativity_status",
          visibility: "enum:visibility_level",
        },
        required: ["narrative_id", "consent_id", "role", "content_summary", "status"],
      },
      NARRATIVE_CORROBORATED: {
        payload: {
          narrative_id: "string",
          corroborated_by: "array<string>",
          note: "string",
        },
        required: ["narrative_id", "corroborated_by"],
      },
      NARRATIVE_DISPUTED: {
        payload: {
          narrative_id: "string",
          disputant_ref: "string",
          dispute_summary: "string",
          status_after: "enum:narrativity_status",
        },
        required: ["narrative_id", "dispute_summary"],
      },
      NARRATIVE_RETRACTED: {
        payload: {
          narrative_id: "string",
          reason: "string",
          derived_design_elements: "array<string>",
        },
        required: ["narrative_id"],
      },
    },
  },

  feedback_case: {
    description: "公开反馈：意见数量不自动等于代表性，少数群体与无障碍异议单独分流回应",
    events: {
      FEEDBACK_SUBMITTED: {
        payload: {
          submitter_ref: "string",
          channel: "enum:feedback_channel",
          topic: "array<enum:feedback_topic>",
          content_summary: "string",
          related_narrative_ids: "array<string>",
          related_revision_ids: "array<string>",
          public_token: "string",
          visibility: "enum:visibility_level",
        },
        required: ["channel", "content_summary"],
      },
      FEEDBACK_TRIAGED: {
        payload: {
          feedback_id: "string",
          representative_status: "enum:representative_status",
          group_evidence_ref: "string",
          duplicate_of: "string",
          triage_note: "string",
          separate_response_required: "boolean",
        },
        required: ["feedback_id", "representative_status"],
      },
      FEEDBACK_RESPONDED: {
        payload: {
          feedback_id: "string",
          disposition: "enum:disposition",
          response_summary: "string",
          reflected_in_revision_id: "string",
          refusal_basis: "string",
          responded_by_ref: "string",
          public_reply: "boolean",
        },
        required: ["feedback_id", "disposition", "response_summary"],
      },
      FEEDBACK_RESPONSE_ESCALATED: {
        payload: {
          feedback_id: "string",
          escalated_to_ref: "string",
          reason: "string",
          resolution_deadline: "string",
        },
        required: ["feedback_id", "escalated_to_ref", "reason"],
      },
    },
  },

  design_revision: {
    description: "方案版本：每次选择留痕，公开反馈如何影响方案及未采纳原因可追溯",
    events: {
      DESIGN_DRAFTED: {
        payload: {
          revision_no: "integer",
          stage: "enum:revision_stage",
          based_on_revision_id: "string",
          document_ref: "string",
          incorporated_narrative_ids: "array<string>",
          incorporated_feedback_ids: "array<string>",
          safety_review: "enum:safety_review",
          creators: "array<string>",
        },
        required: ["revision_no", "stage", "document_ref"],
      },
      DESIGN_RESPONDED: {
        payload: {
          revision_id: "string",
          change_kind: "enum:change_kind",
          change_summary: "string",
          feedback_ids_addressed: "array<string>",
          feedback_ids_not_adopted: "array<string>",
          not_adopted_reasons: "object",
          narrative_ids_addressed: "array<string>",
          new_revision_no: "integer",
        },
        required: ["revision_id", "change_kind", "change_summary"],
      },
      UNSAFE_OR_DISCRIMINATORY_INPUT_REJECTED: {
        payload: {
          source_feedback_id: "string",
          source_narrative_id: "string",
          refusal_kind: "string",
          basis: "string",
          regulation_or_standard_ref: "string",
          alternative_offered: "string",
          decided_by_ref: "string",
        },
        required: ["refusal_kind", "basis", "decided_by_ref"],
      },
      DESIGN_FROZEN_FOR_BUILD: {
        payload: {
          revision_id: "string",
          safety_review_result: "enum:safety_review",
          accessibility_check_ref: "string",
          approver_refs: "array<string>",
        },
        required: ["revision_id", "safety_review_result"],
      },
    },
  },

  material_item: {
    description: "居民捐借旧物：改造前确认所有权与可逆范围，归还/撤回命运事先约定",
    events: {
      MATERIAL_PLEDGED: {
        payload: {
          item_name: "string",
          item_kind: "enum:item_kind",
          owner_ref: "string",
          consent_id: "string",
          proposed_use: "string",
          intended_reversibility: "enum:reversibility_level",
          condition_report_ref: "string",
          photos_ref: "array<string>",
        },
        required: ["item_name", "item_kind", "owner_ref", "proposed_use"],
      },
      OWNERSHIP_VERIFIED: {
        payload: {
          item_id: "string",
          status: "enum:provenance_status",
          title_basis: "enum:title_basis",
          evidence_ref: "string",
          verifier_ref: "string",
          note: "string",
        },
        required: ["item_id", "status", "title_basis"],
      },
      REVERSIBILITY_ASSESSED: {
        payload: {
          item_id: "string",
          level: "enum:reversibility_level",
          reversible_actions: "array<string>",
          irreversible_actions: "array<string>",
          owner_confirmed: "boolean",
        },
        required: ["item_id", "level"],
      },
      MATERIAL_DISPOSITION_DECIDED: {
        payload: {
          item_id: "string",
          decision: "enum:material_decision",
          agreement_ref: "string",
          agreed_fate_on_withdrawal: "enum:withdrawal_fate",
          loan_due_at: "string",
          owner_signed: "boolean",
        },
        required: ["item_id", "decision", "agreement_ref", "agreed_fate_on_withdrawal"],
      },
      MATERIAL_RECALLED: {
        payload: {
          item_id: "string",
          loan_id: "string",
          recalled_by_ref: "string",
          reason: "string",
          condition_on_return_ref: "string",
          returned: "boolean",
        },
        required: ["item_id", "recalled_by_ref", "returned"],
      },
      WORK_WITHDRAWN_FROM_DISPLAY: {
        payload: {
          item_id: "string",
          work_asset_id: "string",
          reason: "string",
          fate: "enum:withdrawal_fate",
          agreement_ref: "string",
          completed_at: "string",
        },
        required: ["item_id", "reason", "fate"],
      },
    },
  },

  minor_participation: {
    description: "儿童参与：监护人书面同意、作品化处理、撤回与个人信息处置逐项记录",
    events: {
      MINOR_CONSENT_GRANTED: {
        payload: {
          minor_consent_id: "string",
          guardian_ref: "string",
          school_or_org_ref: "string",
          activity_scope: "array<string>",
          agreed_outputs: "array<string>",
          signed_agreement_ref: "string",
          consent_channel: "enum:consent_channel",
          expires_at: "string",
        },
        required: ["minor_consent_id", "guardian_ref", "activity_scope", "signed_agreement_ref"],
      },
      MINOR_WORK_INCORPORATED: {
        payload: {
          minor_consent_id: "string",
          work_description: "string",
          revision_id: "string",
          treatment: "string",
          credit_preference: "enum:credit_display",
        },
        required: ["minor_consent_id", "work_description", "revision_id"],
      },
      MINOR_CONSENT_WITHDRAWN: {
        payload: {
          minor_consent_id: "string",
          withdraw_scope: "array<string>",
          personal_data_action: "string",
          replacement_plan: "string",
          guardian_notified: "boolean",
        },
        required: ["minor_consent_id", "personal_data_action"],
      },
    },
  },

  budget_case: {
    description: "预算与采购：来源、凭据、捐借物零元入账可核对",
    events: {
      BUDGET_ALLOCATED: {
        payload: {
          total_amount: "number",
          currency: "string",
          funding_sources: "array<string>",
          earmark: "object",
          document_ref: "string",
        },
        required: ["total_amount"],
      },
      BUDGET_CHANGED: {
        payload: {
          kind: "enum:budget_change_kind",
          amount: "number",
          reason: "string",
          approval_ref: "string",
        },
        required: ["kind", "amount", "reason"],
      },
      PROCUREMENT_RECORDED: {
        payload: {
          kind: "enum:procurement_kind",
          vendor_ref: "string",
          amount: "number",
          currency: "string",
          invoice_ref: "string",
          linked_material_item_id: "string",
          linked_revision_id: "string",
        },
        required: ["kind", "amount", "invoice_ref"],
      },
      DONATED_ITEM_VALUED: {
        payload: {
          material_item_id: "string",
          nominal_value: "number",
          currency: "string",
          valuation_note: "string",
          tax_or_receipt_ref: "string",
        },
        required: ["material_item_id", "nominal_value"],
      },
    },
  },

  installation_work: {
    description: "施工与验收：安全措施、隐蔽工程、无障碍通道与验收结论",
    events: {
      INSTALLATION_STARTED: {
        payload: {
          revision_id: "string",
          fabricator_ref: "string",
          site_contact_ref: "string",
          safety_measures: "array<enum:safety_measure>",
          material_item_ids: "array<string>",
          start_date: "string",
        },
        required: ["revision_id", "fabricator_ref", "safety_measures"],
      },
      CONSTRUCTION_INCIDENT_RECORDED: {
        payload: {
          incident_ref: "string",
          description: "string",
          injury: "boolean",
          property_damage: "boolean",
          corrective_action: "string",
          authority_notified: "boolean",
        },
        required: ["incident_ref", "description"],
      },
      INSTALLATION_ACCEPTED: {
        payload: {
          work_asset_id: "string",
          revision_id: "string",
          result: "enum:acceptance_result",
          rectification_items: "array<string>",
          rectification_deadline: "string",
          acceptor_refs: "array<string>",
          as_built_doc_ref: "string",
          warranty_until: "string",
        },
        required: ["work_asset_id", "revision_id", "result", "acceptor_refs"],
      },
    },
  },

  credit_publication: {
    description: "署名与公开发布：署名意愿、学生个人评价不向社区公开",
    events: {
      CREDIT_PREFERENCE_RECORDED: {
        payload: {
          person_ref: "string",
          role: "enum:credit_role",
          display: "enum:credit_display",
          display_name: "string",
          scope: "array<string>",
        },
        required: ["person_ref", "role", "display"],
      },
      WORK_PUBLISHED: {
        payload: {
          work_asset_id: "string",
          revision_id: "string",
          audience: "enum:publication_audience",
          channels: "array<string>",
          credit_line_ref: "string",
          narrative_attribution_refs: "array<string>",
          includes_minor_work: "boolean",
        },
        required: ["work_asset_id", "revision_id", "audience"],
      },
      PUBLICATION_TAKEN_DOWN: {
        payload: {
          work_asset_id: "string",
          reason: "string",
          consent_or_claim_ref: "string",
          replacements_ref: "string",
        },
        required: ["work_asset_id", "reason"],
      },
    },
  },

  maintenance_obligation: {
    description: "养护责任：人员毕业、承包方更换后承诺仍可定位，版本记录完整交接",
    events: {
      MAINTENANCE_ASSIGNED: {
        payload: {
          work_asset_id: "string",
          caretaker_kind: "enum:caretaker_kind",
          caretaker_ref: "string",
          duties: "array<string>",
          cadence_days: "integer",
          valid_from: "string",
          valid_until: "string",
          backup_caretaker_ref: "string",
          agreement_ref: "string",
        },
        required: ["work_asset_id", "caretaker_kind", "caretaker_ref", "duties", "valid_from"],
      },
      MAINTENANCE_HANDOFF: {
        payload: {
          obligation_id: "string",
          kind: "enum:handoff_kind",
          outgoing_ref: "string",
          incoming_caretaker_kind: "enum:caretaker_kind",
          incoming_ref: "string",
          handed_over_records: "array<string>",
          effective_at: "string",
        },
        required: ["obligation_id", "kind", "incoming_ref", "effective_at"],
      },
      OBLIGATION_STATUS_CHANGED: {
        payload: {
          obligation_id: "string",
          status: "enum:obligation_status",
          reason: "string",
        },
        required: ["obligation_id", "status"],
      },
    },
  },

  inspection_case: {
    description: "巡检记录：只记录事实与初判，不直接等同最终责任",
    events: {
      INSPECTION_LOGGED: {
        payload: {
          work_asset_id: "string",
          inspector_ref: "string",
          result: "enum:inspection_result",
          findings_summary: "string",
          evidence_refs: "array<string>",
          next_due_at: "string",
        },
        required: ["work_asset_id", "inspector_ref", "result"],
      },
    },
  },

  repair_case: {
    description: "修复与责任：区分设计缺陷、施工责任与自然损耗，争议留痕、修复闭环",
    events: {
      REPAIR_OPENED: {
        payload: {
          work_asset_id: "string",
          inspection_id: "string",
          damage_description: "string",
          urgency: "string",
        },
        required: ["work_asset_id", "damage_description"],
      },
      DAMAGE_LIABILITY_DETERMINED: {
        payload: {
          repair_id: "string",
          category: "enum:damage_category",
          liable_party: "enum:liable_party",
          basis: "string",
          evidence_refs: "array<string>",
          warranty_applied: "boolean",
          dissenting_party_ref: "string",
          dissent_note: "string",
        },
        required: ["repair_id", "category", "liable_party", "basis"],
      },
      REPAIR_COMPLETED: {
        payload: {
          repair_id: "string",
          actions: "array<string>",
          cost: "number",
          currency: "string",
          repaired_by_ref: "string",
          reversibility_preserved: "boolean",
          acceptor_ref: "string",
        },
        required: ["repair_id", "actions"],
      },
      REPAIR_DISPUTED: {
        payload: {
          repair_id: "string",
          disputant_ref: "string",
          claim: "string",
          mediation_ref: "string",
          status_after: "enum:repair_status",
        },
        required: ["repair_id", "disputant_ref", "claim"],
      },
    },
  },

  correction_record: {
    description: "更正记录：对已接收事件的事实性更正，不删除原记录",
    events: {
      RECORD_CORRECTED: {
        payload: {
          corrected_event_id: "string",
          field: "string",
          corrected_value: "string",
          reason: "string",
          corrected_by_ref: "string",
        },
        required: ["corrected_event_id", "field", "reason", "corrected_by_ref"],
      },
    },
  },
};

export const EVENT_TYPES = Object.freeze(
  Object.fromEntries(
    Object.entries(AGGREGATES).flatMap(([aggregateType, def]) =>
      Object.keys(def.events).map((eventType) => [eventType, aggregateType]),
    ),
  ),
);

export const AGGREGATE_TYPES = Object.freeze(Object.keys(AGGREGATES));
