# Member task workspace

Each department that enables both tasks and members receives a **Member tasks** sidebar entry. Select a person to view tasks they explicitly execute, are responsible for, or have reviewed. Roles remain distinct. Same-named people in other departments and missing source records are excluded; legacy assignee names are used only for exact, unique matches within the department.

The workspace displays per-person counts and completion progress, filters for unfinished/review/completed work, the parent matter and dates, and an action to open or assign a task. It reads existing data without generating or rewriting tasks.

The work record browser has its own member rail, month/text/table-status filters, summary cards and twenty-row pagination. Exports contain the full filtered result, not just the current page. Zero-hour entries remain distinguishable from missing hours. Phone layouts use a compact member selector and stacked record cards. All table flags remain local and manual.

Validation: `node scripts/check-member-tasks.cjs`, local-work persistence tests, isolated browser checks with fictional desktop/phone data, production build and integration/security checks.
