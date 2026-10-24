# Local work records

Work records are stored in the application's own data directory. Each member has a separate row with the task, date, actual duration, optional volunteer hours or performance, and a manually maintained “copied to table” flag. The flag never sends a request to a document provider. Editing substantive work data invalidates the flag; marking it again is a separate action after manually updating the external table.

The previous spreadsheet connectors, authorization endpoints and background workers have been removed. Old connector URLs return HTTP 410 after authentication. Startup removes only the two obsolete document integration credentials, leaving other integrations intact.

A one-time offline migration retains existing tasks, members, work logs and performance records, and projects previously imported document records into local work records. It keeps unknown dates and durations blank, distinguishes actual duration from volunteer credit, preserves original role assignments, and does not infer that volunteer-system entry markers mean a manual copy just occurred. Historical records known to exist in a source document start with the table flag set. Existing backups retain the original private data for recovery.

Complete a task to create per-member local records, or add a record directly. Use the department, month, member and table-status filters, edit hours as needed, and export CSV for manual use. Both departments have separate records. No normalization of performance or automatic volunteer-credit calculation is performed.

Validation: `node scripts/check-local-work.cjs`, the normal production build, and isolated integration/security checks.
