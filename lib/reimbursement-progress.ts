import type {ReimbActivity} from "./types";
export const isReported=(a:Pick<ReimbActivity,"reported"|"status">)=>a.reported??["submitted","done"].includes(a.status);
export const isFunded=(a:Pick<ReimbActivity,"fundingStatus">)=>a.fundingStatus==="paid";
