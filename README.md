# 公共艺术共创履约簿

美院师生进入地铁站、乡村做公共艺术时，本仓库约定一套**只追加的领域事件契约**，承接从场地委托到长期养护的全过程。事件记录的是"每次选择"而非成品方案：访谈授权、地方叙事来源、方案版本、公开反馈及未采纳原因、旧物捐借、儿童参与同意、预算采购、施工验收、署名、巡检、修复责任与毕业/承包方更换交接，都以不可原地改写的记录留痕。

## 资料结构

| 路径 | 作用 |
| --- | --- |
| `src/event-catalog.js` | 单一事实源：12 个聚合、50 个事件、全部枚举与负载字段 |
| `src/validator.js` | `validateEvent`（单记录信封/负载）与 `validateStream`（跨记录履约门控） |
| `scripts/build-schema.mjs` | 从事件目录生成 `contracts/domain.schema.json` |
| `contracts/domain.schema.json` | 生成产物：每种事件一个 `oneOf` 变体，事件名↔聚合↔负载三者一致 |
| `data/sample.json` | 单条首事件样例 |
| `data/full-stream.json` | 贯穿完整生命周期的 41 条中文事件流样例 |
| `tests/contract.test.js` | 正样例 + 违规反例 |

## 聚合与事件总览

1. **site_commission 场地委托** — 立项、简报、范围变更、暂停、撤回
2. **community_input 社区访谈与授权** — 授权摘要（正文与授权句柄分离）、撤回、过期、扩范围
3. **local_narrative 地方叙事** — 来源、佐证、争议、撤回
4. **feedback_case 公开反馈** — 提交、代表性分流、回应（含未采纳原因）、升级
5. **design_revision 方案版本** — 草稿、对反馈的逐项回应、拒绝不安全/歧视性建议、冻结施工版
6. **material_item 旧物材料** — 认领登记、所有权核验、可逆范围评估、归属决定、召回、撤展
7. **minor_participation 儿童参与** — 监护人会签同意、作品纳入、撤回与个人信息处置
8. **budget_case 预算采购** — 预算、调整、采购凭据、捐赠物名义价值入账
9. **installation_work 施工验收** — 开工（安全措施+所用旧物）、施工事件、验收结论
10. **credit_publication 署名发布** — 署名意愿、公开发布、下架
11. **maintenance_obligation 养护责任** — 指派、毕业/承包方更换交接、状态变更
12. **inspection_case / repair_case 巡检修复** — 巡检事实、立案、责任认定、修复闭环、争议
13. **correction_record 更正** — `RECORD_CORRECTED` 后继更正，不删除原记录

## 记录规则

- 信封字段：`event_id`、`event_type`、`aggregate_type`、`aggregate_id`、`occurred_at`、`version`、`summary`、`payload`（可选 `replaces_event_id`）。
- 记录一经接收，标识、发生时间与版本**不得原地改写**；事实更正发新的 `RECORD_CORRECTED`。
- 每个聚合内 `version` 从 1 起连续递增，`occurred_at` 不倒流。
- 个人、机构与商业敏感信息不进事件正文，只以 `*_ref` 句柄（`person:`、`doc:`、`media:`、`party:`）引用实际文档库。

## 由 `validateStream` 强制执行的履约门控

**授权与叙事**

- 访谈摘要须在授权有效期内、且授权范围含 `interview_only`；叙事收录须含 `story_use`；撤回/过期后不得新增引用记录。
- 争议中（disputed）或已撤回（retracted）的叙事不得纳入方案。

**反馈代表性（数量不替代判断）**

- 反馈必须先 `FEEDBACK_TRIAGED` 分流，才能回应。
- 分流为 `minority_or_accessibility_dissent` 的少数群体/无障碍异议：必须 `separate_response_required=true`，且回应必须 `public_reply=true` 单独公开——不能用点赞数或多数意见覆盖。
- 每条未采纳反馈必须在 `not_adopted_reasons` 中逐条给出可公开原因。
- 创作者可以拒绝不安全或歧视性建议：走 `UNSAFE_OR_DISCRIMINATORY_INPUT_REJECTED`，写明 `basis` 依据与规章引用；对建议人的 `rejected_creator` 回应必须带 `refusal_basis`。

**旧物：先确权、定可逆，再改造**

- `MATERIAL_DISPOSITION_DECIDED` 之前必须先有 `OWNERSHIP_VERIFIED` 与 `REVERSIBILITY_ASSESSED`。
- 权属不清只能 `declined_unclear_title` / `in_dispute_hold`，不得投入施工。
- 不可逆改造必须所有者确认；归属、借还与撤展去向必须有签署协议（`owner_signed=true`），不能只靠口头约定。
- 撤展去向必须按事先约定执行，变更须记为 `renegotiate`；借展物召回与捐赠物撤展是不同事件。
- 开工事件挂接 `material_item_ids`，任一旧物未确权、未定可逆范围、未完成处置决定都不得施工。

**儿童参与**

- 必须监护人书面会签（`guardian_counter_signed`）；撤回时必须记录已纳入作品与个人信息的处置方式；发布时若含儿童作品须能查到有效同意下的纳入记录。

**方案—施工—发布—养护**

- 只有安全评审 `passed` 的版本可冻结；施工只能按冻结版本进行。
- 未通过验收不得形成作品资产、不得公开发布、不得指派养护责任；带整改通过须列整改项与期限并留存竣工文档。
- 发布版本必须与验收版本一致。

**巡检与修复：区分三类责任**

- 完成修复前必须先 `DAMAGE_LIABILITY_DETERMINED`：`design_defect`（学校/创作团队/保险）、`construction_liability`（承包方/保险）、`natural_wear`（运营/村集体）；责任类别与责任方不匹配会被拒绝。
- 责任异议须异议方与异议说明同时留痕；含居民旧物的作品修复完成必须说明可逆性是否保持。

**交接连续性**

- `MAINTENANCE_HANDOFF`（学生毕业、承包方/运营方更换）必须在 `handed_over_records` 中移交竣工文档、养护协议、旧物协议与完整事件流；状态转 `transferred` 只能经由交接事件。

## 可见性边界

- 事件与回应分 `public` / `restricted` / `private` 三级；居民可公开看到建议如何影响方案、以及未采纳原因。
- **学生个人作业评价不进入本履约簿**：评分只存于学校 `school_only` 系统，履约事件中如须引用仅放 `document_ref` 句柄，不对社区公开。
- 运营单位凭 `maintenance_obligation` 与交接记录，在人员毕业、承包方更换后仍能定位有效承诺与全部版本记录。

## 本地检查

```bash
node scripts/build-schema.mjs   # 从事件目录重新生成 JSON Schema
node --test                     # 25 项契约测试（正样例 + 违规反例）
```

## 扩展事件

1. 在 `src/event-catalog.js` 相应聚合的 `events` 中登记事件名、`payload` 字段（类型或 `enum:<名>`）与 `required`。
2. 运行 `node scripts/build-schema.mjs` 重新生成 schema。
3. 若事件涉及时序或跨聚合前提，在 `src/validator.js` 的 `validateStream` switch 中补一条门控，并在 `tests/contract.test.js` 加正反两例。
