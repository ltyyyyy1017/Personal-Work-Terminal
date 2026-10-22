import type {Settings} from "./types";

export interface ReimbursementExportFormat {format:"standard"|"income-expense";title?:string}
/** Stored per department so later positions can choose their own reporting format. */
export function reimbursementExportFormat(settings:Settings,department:string):ReimbursementExportFormat {
  return settings.reimbursement.exportFormats?.[department]||{format:department==="行政部"?"income-expense":"standard"};
}
