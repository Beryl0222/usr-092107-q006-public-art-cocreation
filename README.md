# 公共艺术共创履约簿

美院师生进入地铁站与乡村做公共艺术时，作品初稿可能获得专业认可，却与通勤者的街区记忆、村民对实际用途的期待脱节；居民捐出的旧物，其归属、维护与撤回展示也不能只靠口头约定。本仓库用**只追加的领域事件流**承接从场地委托到长期养护的全过程：保留每一次选择，而不是给出一个成品状态。

本仓库只定义跨系统交换所需的**领域对象、事件名称与校验规则**，不含界面与数据库实现。

## 资料范围

| 路径 | 作用 |
| --- | --- |
| `src/event-catalog.js` | 事件目录（单一事实源）：35 个事件、12 类聚合、可见档位、敏感标注、各事件 payload 必备字段 |
| `src/build-schema.js` | 从目录生成 JSON Schema |
| `contracts/domain.schema.json` | 生成的领域事件 JSON Schema（draft 2020-12），勿手改 |
| `scripts/generate-schema.mjs` | 重新生成 schema：`node scripts/generate-schema.mjs` |
| `src/validator.js` | 事件级校验、事件流不变量、社区视图投影 |
| `data/sample.json` | 最小信封样例 |
| `data/lifecycle.json` | 地铁站项目全流程样例（48 条，含乡村借物场景） |
| `tests/contract.test.js` | 规则测试（29 项） |

## 不可变原则

- 记录一经接收，`event_id`、`occurred_at`、`version` 不得原地改写；
- 更正只能追加 `RECORD_CORRECTED`，与原记录同聚合、版本号更大，且**只能收紧、不能放宽**可见档位；
- 同一聚合内 `version` 严格递增、`occurred_at` 不倒流；
- 个人、机构及商业敏感信息仅向履行职责所需的调用方开放。

## 可见性与敏感标注

`visibility` 四档：`open`（任何人）/ `community`（登记社区参与者）/ `internal`（履约机构）/ `restricted`（职责所需最小范围）。
`sensitivity`：`none` / `personal` / `minority` / `commercial` / `confidential`。

社区视图（`toCommunityView`）只放行 `open` 与 `community` 的白名单事件，并对联系方式、姓名、学号等键递归脱敏；`STUDENT_GRADED`、访谈授权、采购等永不出现。

## 事件目录（按阶段）

| 阶段 | 事件 |
| --- | --- |
| 场地委托 | `COMMISSION_OPENED` · `STEWARDSHIP_HANDED_OVER` · `EXHIBITION_WITHDRAWN` |
| 访谈与叙事 | `SITE_CONTEXT_RECORDED` · `INPUT_CONSENTED` · `NARRATIVE_SOURCE_CITED` · `CONSENT_WITHDRAWN` |
| 反馈与代表性 | `FEEDBACK_RECORDED` · `FEEDBACK_TRIAGED` · `OBJECTION_RESPONDED` |
| 方案版本 | `DESIGN_DRAFTED` · `DESIGN_REVISION_PUBLISHED` · `DESIGN_RESPONDED` · `SAFETY_OR_DISCRIMINATION_REFUSAL` |
| 旧物捐借 | `MATERIAL_PLEDGED` · `OWNERSHIP_VERIFIED` · `MATERIAL_LOAN_AGREEMENT_SIGNED` · `MATERIAL_DONATION_AGREEMENT_SIGNED` · `MATERIAL_INCORPORATED` · `MATERIAL_WITHDRAWN` |
| 儿童参与 | `CHILD_PARTICIPATION_CONSENTED` · `CHILD_WORK_AGREEMENT_RECORDED` |
| 预算采购 | `BUDGET_APPROVED` · `PROCUREMENT_RECORDED` |
| 施工验收 | `CONSTRUCTION_LOGGED` · `INSTALLATION_ACCEPTED` |
| 损坏修复 | `DAMAGE_REPORTED` · `DEFECT_CLASSIFIED` · `REPAIR_RESOLVED` |
| 署名 | `ATTRIBUTION_RECORDED` |
| 长期养护 | `MAINTENANCE_ASSIGNED` · `INSPECTION_LOGGED` · `OBLIGATION_ESCALATED` |
| 学生评价 | `STUDENT_GRADED`（仅 restricted，不进社区视图） |
| 更正 | `RECORD_CORRECTED` |

## 校验器编码的关键领域规则

1. **授权先于使用**：`DESIGN_DRAFTED` 引用的访谈必须已有 `INPUT_CONSENTED`；`CONSENT_WITHDRAWN` 之后的方案版本不得再引用该叙事。
2. **意见数量不替代代表性**：`FEEDBACK_TRIAGED` 只记录覆盖度与加权理由；无障碍使用者与少数群体成员的异议必须有逐条 `OBJECTION_RESPONDED`，不得以多数票数合并。
3. **拒绝需有依据**：不安全或歧视性建议通过 `SAFETY_OR_DISCRIMINATION_REFUSAL` 拒绝，须给出规范类别、细节与替代方案。
4. **旧物先确权再动手**：`MATERIAL_PLEDGED → OWNERSHIP_VERIFIED → 书面捐赠/借用协议 → MATERIAL_INCORPORATED`；入作时 `reversibility_confirmed` 必须为 true；撤回展示必须有书面协议，不接受口头约定。
5. **验收前置**：预算已批准、入作旧物均已确权签约、被标记异议均已单独回应，方可 `INSTALLATION_ACCEPTED`。
6. **损坏先归责再修复**：`REPAIR_RESOLVED` 前必须 `DEFECT_CLASSIFIED`，类别区分设计缺陷（`design_defect`）、施工责任（`construction_fault`）、自然损耗（`natural_wear`）、第三方损坏与待定。
7. **居民看得见影响与理由**：`DESIGN_RESPONDED` 记录建议如何影响方案或未采纳原因，进入社区视图。
8. **学生评价不公开**：`STUDENT_GRADED` 恒为 restricted/confidential，社区投影中双重排除。
9. **责任随岗位与档案延续**：养护义务落至机构与岗位（`duty_holder_org`/`duty_holder_role`）；`STEWARDSHIP_HANDED_OVER` 必须携带义务清单与完整版本档案 `archive_ref`，人员毕业或承包方更换后仍可追溯。

## 本地检查

```bash
node --test                      # 校验规则与样例
node scripts/generate-schema.mjs # 目录变更后重新生成 schema
```

新增事件时只改 `src/event-catalog.js`，再重新生成 schema；测试会断言已提交 schema 与生成结果一致，防止两处漂移。
