export type ExpenseDateBasis="payment"|"itinerary"|"explicit";
export function validExpenseDate(value:string){const m=value.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/);if(!m)return;const date=`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`,d=new Date(date+"T12:00:00Z");return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===date?date:undefined;}
export function expenseDates(text:string):{date?:string;basis?:ExpenseDateBasis;candidates:string[]}{
  const patterns:[ExpenseDateBasis,string][]=[['itinerary','行程(?:起止)?(?:时间|時間|日期)|出行(?:时间|時間|日期)|乘[车車](?:时间|時間|日期)|用[车車](?:时间|時間|日期)|上[车車](?:时间|時間)|出[发發]日期'],['payment','支付(?:完成)?(?:时间|時間|日期)|付款(?:时间|時間|日期)|交易(?:成功)?(?:时间|時間|日期)|扣款(?:时间|時間|日期)'],['explicit','[费費]用日期|[报報][销銷]日期']];
  for(const [basis,label] of patterns){
    const values=[...text.matchAll(new RegExp(`(?:${label})[ \\t]*[:：]?[ \\t]*([^\\n]*)(?:\\n|$)`,'g'))].flatMap(m=>{
      let value=m[1];if(!value.trim())value=text.slice((m.index||0)+m[0].length).split('\n')[0]||'';
      return [...value.matchAll(/20\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}/g)].map(v=>validExpenseDate(v[0])).filter((v):v is string=>!!v);
    });
    const candidates=[...new Set(values)].sort();if(candidates.length)return {date:candidates.length===1?candidates[0]:undefined,basis,candidates};
  }
  return {candidates:[]};
}
