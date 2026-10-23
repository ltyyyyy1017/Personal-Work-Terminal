import {readStore} from "./store";
import {pendingTeamTasks,runTeamSheetSync} from "./team-sheet-sync";
import {SOURCE_POLL_MS,SOURCE_RETRY_MS} from "./source-task";
const processGlobal=globalThis as typeof globalThis&{__teamSheetWorker?:ReturnType<typeof setInterval>};
export function startTeamSheetWorker(){
 if(processGlobal.__teamSheetWorker||process.env.WORKBENCH_SKIP_SYNC==="true"||process.env.NEXT_PHASE==="phase-production-build")return;
 let busy=false;
 const tick=async()=>{if(busy)return;const state=readStore().teamSheets;if(!state?.enabled||state.lastErrorAt&&Date.now()-Date.parse(state.lastErrorAt)<SOURCE_RETRY_MS)return;const pullDue=!state.lastPullAt||Date.now()-Date.parse(state.lastPullAt)>=SOURCE_POLL_MS;if(!pullDue&&!pendingTeamTasks())return;busy=true;try{await runTeamSheetSync(pullDue?"all":"push");}catch{/* Status stays visible in the workbench. Never log credentials or remote payloads. */}finally{busy=false;}};
 processGlobal.__teamSheetWorker=setInterval(()=>void tick(),60_000);processGlobal.__teamSheetWorker.unref?.();
 void tick();
}
