# Team sheet synchronization

The workbench connects directly to Tencent's official MCP endpoint at `https://docs.qq.com/openapi/mcp`. The connection dialog opens Tencent's authorization page and checks authorization without asking users to paste tokens. The token is stored in the encrypted vault under the reserved integration namespace, never returned by the state API or included in a source export.

Configure the two existing document links and academic year in the work/volunteer page. Every original worksheet becomes a matter; assignment records and matched people's work descriptions become already-approved child tasks. Repeated pulls use stable content identities. Only people uniquely matched to the current department roster are imported. Unknown people and other departments are excluded from active records; mixed rows retain only matched department members. Matching supports simplified/traditional spellings without creating roster entries. Original hours are suggestions only: no source hour contributes to volunteer totals by the import. Existing sheet records are treated as approved, without asking the operator to review each one again. The source hour values remain references and are not copied into recognized local volunteer hours. Decimal durations and clock ranges are not treated as dates; missing dates remain empty.

For newly created local tasks, at completion choose **include in team documents** or **private record**. Included tasks require selecting an existing worksheet in each original document and online/offline work. No new worksheet is created. The selected IDs are checked against the authorized documents. A private completed task needs no hours, is kept in the workbench and is excluded from volunteer totals along with linked work logs. Leadership task details are written with blank volunteer hours; only regular members require confirmed hours.

The native writer uses the existing assignment columns and the existing hours form. It adopts matching/source assignment rows, preserves original source work descriptions, appends into blank rows and inserts a row at a department boundary if needed. It never writes another department's existing values. A local journal records the original and desired cells before sending a request; responses are read back, retries reuse the same rows and manual edits stop an overwrite. Moving a task or making it private restores adopted rows and clears only workbench-added content. Original source values are preserved for audit/reference. Added rows are excluded on the next import so publication does not create another local task. Native row positions are reconciled by cell contents after row moves.

Already-published legacy records remain available for migration. Choosing original destinations moves their publication out of the old managed tabs; no new legacy tab can be created. Existing personal notes and approved decisions are preserved during source refresh; conflicting changes are flagged.

Matters use compact progress cards; opening one reveals child tasks and reimbursements in a centered dialog. Independent tasks also stay collapsed in their own card.

Writes are checked by reading the resulting cells. A lost response or a failure in the second document leaves the task pending, and retrying updates the same keys. A saved cell snapshot protects rows that someone changed manually; synchronization stops instead of overwriting them. Imported task notes that have been edited locally are also preserved and conflicting source changes are flagged.

The server checks pending local tasks every minute and pulls source documents every five minutes. Saving a task also schedules a short delayed push. Transient errors remain visible in the UI and background retries back off for two minutes. `WORKBENCH_SKIP_SYNC=true` disables the worker for builds or isolated tests. The data directory is a single-process store; run one workbench process against it.

Validation:

- `node scripts/check-task-reporting.cjs` checks the initial card rendering, completion choices and leadership/private forms.
- `node scripts/check-team-sheets.cjs` tests parsing and synchronization against isolated in-memory documents, including lost responses, partial two-document writes, name matching, stable row movement, manual edits and removal.
- `node scripts/check-volunteer-ledger.mjs` tests per-person deduplication, explicit links, conflicting hours, month boundaries, pending work and zero hours.
- `node scripts/smoke-test.mjs` and `node scripts/check-security.mjs` run isolated integration/security checks.

References: [Tencent official MCP](https://docs.qq.com/open/document/mcp/), [GitHub integration examples](https://github.com/liyang58/tencent-docs).

Document pulls run before opt-in writes, so failed write-back does not prevent fresh source data being read. Source fields use a per-field baseline: a local note or approval no longer blocks updates to independent title, date or participant fields. Concurrent edits to the same field are retained and flagged. Source removals and records outside the current roster are marked missing and hidden from active task lists, not removed from original documents. The server continues polling with the browser closed; visible pages refresh every thirty seconds.
