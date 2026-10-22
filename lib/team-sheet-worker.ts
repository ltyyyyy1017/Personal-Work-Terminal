import {readStore} from "./store";
import {pendingTeamTasks,runTeamSheetSync} from "./team-sheet-sync";
const processGlobal=globalThis as typeof globalThis&{__teamSheetWorker?:ReturnType<typeof setInterval>};
export function startTeamSheetWorker(){
 if(processGlobal.__teamSheetWorker||process.env.WORKBENCH_SKIP_SYNC==="true"||process.env.NEXT_PHASE==="phase-production-build")return;
 let busy=false;
 const tick=async()=>{if(busy)return;const state=readStore().teamSheets;if(!state?.enabled||state.lastErrorAt&&Date.now()-Date.parse(state.lastErrorAt)<20*60_000)return;const pullDue=!state.lastPullAt||Date.now()-Date.parse(state.lastPullAt)>60*60_000;if(!pullDue&&!pendingTeamTasks())return;busy=true;try{await runTeamSheetSync(pullDue?"all":"push");}catch{/* Status stays visible in the workbench. Never log credentials or remote payloads. */}finally{busy=false;}};
 processGlobal.__teamSheetWorker=setInterval(()=>void tick(),60_000);processGlobal.__teamSheetWorker.unref?.();
}
