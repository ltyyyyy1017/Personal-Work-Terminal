export interface BorrowedEquipment {
 key:string;deviceId?:string;deviceName:string;model:string;borrowerName:string;
 borrowedAt?:string;purpose:string;isOtherDevice:boolean;missingRecord:boolean;recordCount:number;
}
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value&&typeof value==="object"&&!Array.isArray(value)?value as Row:{};
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
/** Use active borrow records, with a fallback for inventory marked borrowed without a record. */
export function equipmentBorrowings(devices:unknown[],records:unknown[]):BorrowedEquipment[]{
 const inventory=devices.map(row),deviceMap=new Map(inventory.map(d=>[text(d.id),d])),items=new Map<string,BorrowedEquipment>(),seen=new Set<string>();
 for(const value of records){
  const r=row(value);if(r.type!=="borrow"||r.returnedAt||r.deletedAt)continue;
  const recordId=text(r.id);if(recordId&&seen.has(recordId))continue;if(recordId)seen.add(recordId);
  const deviceId=text(r.deviceId),isOtherDevice=r.isOtherDevice===true;
  const key=!isOtherDevice&&deviceId?`device:${deviceId}`:`record:${recordId||items.size}`;
  const device=isOtherDevice?undefined:deviceMap.get(deviceId),borrower=text(r.borrowerName)||"未填写借用人",borrowedAt=text(r.createdAt)||text(r.borrowTime)||text(r.borrowDate)||undefined;
  const previous=items.get(key);
  if(previous){previous.recordCount++;if(!previous.borrowerName.split("、").includes(borrower))previous.borrowerName+="、"+borrower;if(borrowedAt&&(!previous.borrowedAt||borrowedAt<previous.borrowedAt))previous.borrowedAt=borrowedAt;continue;}
  items.set(key,{key,deviceId:deviceId||undefined,deviceName:text(device?.name)||text(r.deviceName)||text(r.otherDeviceName)||"未命名设备",model:text(device?.model)||text(r.deviceModel),borrowerName:borrower,borrowedAt,purpose:text(r.purpose),isOtherDevice,missingRecord:false,recordCount:1});
 }
 for(const device of inventory){const id=text(device.id);if(!id||device.status!=="borrowed"||items.has(`device:${id}`))continue;items.set(`device:${id}`,{key:`device:${id}`,deviceId:id,deviceName:text(device.name)||"未命名设备",model:text(device.model),borrowerName:"缺少在借记录，请核对原站",purpose:"",isOtherDevice:false,missingRecord:true,recordCount:0});}
 return [...items.values()].sort((a,b)=>(a.borrowedAt||"9999").localeCompare(b.borrowedAt||"9999")||a.key.localeCompare(b.key));
}
export interface EquipmentBorrowingsSnapshot {items:BorrowedEquipment[];fetchedAt:string;organization:string}
