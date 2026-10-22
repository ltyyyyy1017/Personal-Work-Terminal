export type Department = string;
export type Organization = string;
export interface DepartmentProfile {id:string;name:string;organization:string;roles:string[];modules:string[]}
export interface Matter {id:string;title:string;department:Department;note:string;startDate?:string;endDate?:string;createdAt:string;updatedAt:string}

export type MatKind =
  | "发票"
  | "销售单"
  | "送货单"
  | "清单"
  | "行程单"
  | "同行人"
  | "支付截图"
  | "收据"
  | "合同"
  | "其他";

export interface InvoiceMeta {
  currency?: string;
  invoiceNo?: string;
  issuedAt?: string;
  amount?: number | null;
  buyerName?: string;
  buyerTaxId?: string;
  sellerName?: string;
  sellerTaxId?: string;
  invoiceType?: string;
  confidence?: number;
  rawHints?: string[];
}

export interface TripLeg {
  id: string;
  mode: "高铁" | "火车" | "飞机" | "打车" | "公交地铁" | "其他";
  date: string;
  from: string;
  to: string;
  amount: number | null;
  code?: string;
  note?: string;
}

export interface ReimbItem {
  id: string;
  name: string;
  amount: number | null;
  note?: string;
  trip?: TripLeg[];
}

export interface ReimbFile {
  id: string;
  itemId: string | null;
  originalName: string;
  storedName: string;
  size: number;
  mime: string;
  kind: MatKind;
  order: number;
  pages?: number;
  meta?: InvoiceMeta;
  addedAt: string;
  generated?: boolean;
}

export interface ReimbOutput {
  builtAt: string;
  dir: string;
  zipName: string;
  xlsxName: string;
  mergedName?: string | null;
  totalAmount: number;
  fileCount: number;
  manifest: { name: string; size: number; kind: string; fileId?: string; originalName?: string }[];
  warnings: string[];
}

export interface ReimbActivity {
  handler?: string;
  bankName?: string;
  bankAccount?: string;
  matterId?: string;
  reported?: boolean;
  fundingStatus?: "unpaid" | "paid";
  taxi?: {from:string;to:string;companions:string[]};
  organization?: Organization;
  contact?: string;
  currency?: "CNY" | "MOP" | "HKD" | "TWD" | "USD";
  paidAmount?: number;
  reviewed?: boolean;
  id: string;
  name: string;
  category: "物资采购" | "活动物料" | "交通差旅" | "餐饮接待" | "打印制作" | "其他";
  department: Department;
  date: string;
  submitter: string;
  reason: string;
  status: "draft" | "packaged" | "submitted" | "done";
  items: ReimbItem[];
  files: ReimbFile[];
  output?: ReimbOutput | null;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalEvent {
  icloud?: {account:string;calendar:string;uid:string;objectUrl:string;etag?:string;readOnly:boolean;lastSyncedAt:string;localVersion?:string};
  organization?: Organization;
  demo?: boolean;
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  tags: string[];
  source: "ui" | "api" | "import" | "task" | "icloud";
  done?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  sourceRecorded?: boolean;
  sheetDestination?: {taskSheetId:string;hoursSheetId:string;hoursKind:"online"|"offline"};
  sheetOrigin?: {task?:{sheetId:string;row:number;rows?:Record<string,number>};hours?:{sheetId:string;row:number}};
  sourceHours?: Record<string,number>;
  /** Undefined: ask on completion; false: private record without volunteer hours. */
  reportToTeamSheets?: boolean;
  workDate?: string;
  sourceMissing?: boolean;
  sourceRefs?: string[];
  approvedAt?: string;
  volunteerHours?: Record<string,number>;
  volunteerEntered?: boolean;
  reviewRequired?: boolean;
  matterId?: string;
  organization?: Organization;
  memberIds?: string[];
  id: string;
  title: string;
  department: Department;
  status: "doing" | "review" | "done";
  assignee?: string;
  followUp?: string;
  link?: string;
  activityName?: string;
  kind?: "task" | "device";
  demo?: boolean;
  due?: string;
  priority: "low" | "normal" | "high";
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  department: Department;
  status: "idea" | "active" | "paused" | "done";
  repo?: string;
  link?: string;
  note?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastCommitAt?: string;
  openIssues?: number;
  openPRs?: number;
}

export interface DocFile {
  id: string;
  name: string;
  storedName: string;
  size: number;
  mime: string;
  folder: "shared" | "archive";
  note?: string;
  addedAt: string;
}

export interface ApiToken {
  id: string;
  label: string;
  hash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface GithubRepo {
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  pushedAt: string;
  defaultBranch: string;
  htmlUrl: string;
  archived?: boolean;
}

export interface GithubActivity {
  type: string;
  repo: string;
  title: string;
  url: string;
  at: string;
  detail?: string;
}

export interface GithubSnapshot {
  login: string;
  name: string;
  avatarUrl: string;
  fetchedAt: string;
  repos: GithubRepo[];
  activity: GithubActivity[];
  commits7d: number;
  openIssues: number;
  openPRs: number;
}

export interface Settings {
  departmentProfiles?: DepartmentProfile[];
  billingProfiles?: Partial<Record<Organization,{invoiceTitle:string;taxId:string}>>;
  name: string;
  org: string;
  school: string;
  departments: string[];
  reimbursement: {
    department: string;
    submitter: string;
    phone: string;
    bankName: string;
    bankAccount: string;
    invoiceTitle: string;
    taxId: string;
    namingTemplate: string;
    mergeAll: boolean;
    autoClassify: boolean;
    project: string;
    exportFormats?:Record<string,{format:"standard"|"income-expense";title?:string}>;
  };
  calendar: {
    weekStart: 0 | 1;
    defaultView: "month" | "agenda";
    reminderMinutes: number;
  };
  appearance: {
    compact: boolean;
  };
  updatedAt: string;
}

export interface LogEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
}

export interface Store {
  teamSheets?: TeamSheetState;
  performance: PerformanceEntry[];
  matters: Matter[];
  icloud?: {account:string;calendars:{id:string;url:string;name:string;color?:string}[];lastReadAt?:string;lastWriteAt?:string};
  workLogs: WorkLog[];
  members: Member[];
  resources: WorkResource[];
  version: number;
  createdAt: string;
  settings: Settings;
  events: CalEvent[];
  tasks: Task[];
  activities: ReimbActivity[];
  projects: Project[];
  docs: DocFile[];
  tokens: ApiToken[];
  log: LogEntry[];
  github?: GithubSnapshot | null;
  meta: {
    lastBuildAt?: string;
    lastSyncAt?: string;
    device?: string;
  };
}

export interface Member {
  avatar?: string;
  phone?: string;
  note?: string;
  organization?: Organization;
  school?: string;
  role?: string;
  className?: string;
  id: string;
  name: string;
  department: Department;
  preference?: string;
  sourceNumber?: number;
  source?: string;
  createdAt: string;
}

export interface WorkLog {
  taskId?: string;
  sourceRefs?: string[];
  volunteerEntered?: boolean;
  volunteerHours?: Record<string,number>;
  volunteerConfirmed?: boolean;
  volunteerEvidence?: string;
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  duty: string;
  memberIds: string[];
  note: string;
  status: "planned" | "done";
  createdAt: string;
  updatedAt: string;
}
export interface PerformanceEntry {id:string;memberId:string;date:string;title:string;activity:string;category:"fixed"|"free";rule:string;phase?:"pre"|"post";status:"done"|"leave"|"no-score";note:string;createdAt:string}

export interface WorkResource {
  organization?: Organization;
  id: string;
  title: string;
  url: string;
  description: string;
  category: "设备" | "审核" | "团学" | "校园";
}

export interface ResourceView extends WorkResource {
  username?: string;
  hasCredential: boolean;
}

export interface SyncedVolunteer {
 id:string;memberId?:string;name:string;title:string;matterTitle:string;date:string;
 sheetId?:string;row?:number;hours:number|null;workHours:number|null;entered:boolean;detail:string;sourceRefs:string[];localTaskId?:string;localVersion?:string;
}
export interface TeamSheetState {
 nativeLinks?:Record<string,NativeSheetLink[]>;
 enabled:boolean;department:string;taskFileId:string;hoursFileId:string;academicYear:number;enabledAt:string;
 taskSheetId?:string;hoursSheetId?:string;lastPullAt?:string;lastPushAt?:string;lastError?:string;lastErrorAt?:string;
 importHashes?:Record<string,{local:string;source:string}>;
 volunteers:SyncedVolunteer[];issues:string[];importedCount:number;taskHashes:Record<string,string>;
}
export interface NativeSheetLink {
 file:string;sheet:string;kind:"task"|"hours";memberId:string;row:number;owned:boolean;
 before:{col:number;value:string|number}[];after:{col:number;value:string|number}[];
 previous?:{col:number;value:string|number}[];
}
