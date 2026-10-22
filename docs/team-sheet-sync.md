# Team sheet synchronization

The workbench connects directly to Tencent's official MCP endpoint at `https://docs.qq.com/openapi/mcp`. The connection dialog opens Tencent's authorization page and checks authorization without asking users to paste tokens. The token is stored in the encrypted vault under the reserved integration namespace, never returned by the state API or included in a source export.

Configure two document links and the academic year's starting year in the work/volunteer records page. An initial read imports department assignments into matters and tasks, and mirrors volunteer records separately. Template examples and other department sections are excluded. Existing roster IDs are used only for a unique name match; unknown collaborators remain visible for reconciliation, without becoming department members automatically.

Source hours are updated by stable content identities, not added to prior totals. A source record can therefore change its hours or move down a sheet without being counted twice. A missing date stays missing; decimal hours and clock ranges are not interpreted as dates. Source documents without valid hours or matching people remain visible in the reconciliation details. Imported assignment tasks do not add hours a second time: the source volunteer ledger supplies those values.

New local tasks created after enabling synchronization are written to a dedicated integration worksheet inside each configured document. A stable task/member key identifies each row. Editing, approving, removing participants or deleting a task updates or clears its own rows. Volunteer hours are blank until approval, and zero is a valid approved value. The entered/unentered flag records the operator's assessment; successful API transmission does not silently mark hours as entered in the institution's system.

Writes are checked by reading the resulting cells. A lost response or a failure in the second document leaves the task pending, and retrying updates the same keys. A checksum protects integration rows that someone changed manually; synchronization stops instead of overwriting them. Imported task notes that have been edited locally are also preserved and conflicting source changes are flagged.

The server checks pending local tasks every minute and pulls source documents hourly. Saving a task also schedules a short delayed push. Transient errors remain visible in the UI and background retries back off for twenty minutes. `WORKBENCH_SKIP_SYNC=true` disables the worker for builds or isolated tests. The data directory is a single-process store; run one workbench process against it.

Validation:

- `node scripts/check-team-sheets.cjs` tests parsing and synchronization against isolated in-memory documents, including lost responses, partial two-document writes, name matching, stable row movement, manual edits and removal.
- `node scripts/check-volunteer-ledger.mjs` tests per-person deduplication, explicit links, conflicting hours, month boundaries, pending work and zero hours.
- `node scripts/smoke-test.mjs` and `node scripts/check-security.mjs` run isolated integration/security checks.

References: [Tencent official MCP](https://docs.qq.com/open/document/mcp/), [GitHub integration examples](https://github.com/liyang58/tencent-docs).
