import { parseInvoiceText } from "./invoice";
export interface TextCell { str: string; x: number; y: number; height: number; width?: number }

/** Keep real table gaps while joining adjacent PDF glyphs into one cell. */
export function layoutLines(items: TextCell[]) {
  const rows: { y: number; items: TextCell[] }[] = [];
  for (const item of items.filter(i=>i.str.trim())) {
    let row = rows.find(row => Math.abs(row.y - item.y) <= Math.max(2, item.height * .35));
    if (!row) { row = { y: item.y, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    const cells=row.items.sort((a,b)=>a.x-b.x);
    return cells.map((cell,i)=>{
      if(!i)return cell.str;
      const prev=cells[i-1], gap=prev.width===undefined?undefined:cell.x-(prev.x+prev.width);
      const separator=gap===undefined?"  ":gap>Math.max(10,cell.height)?"\t":gap>Math.max(1,cell.height*.25)?" ":"";
      return separator+cell.str;
    }).join("");
  }).join("\n");
}

/** Read table columns by coordinates, including wrapped addresses and blank remark cells. */
export function itineraryTableText(items:TextCell[]):string|undefined{
  const cells=items.filter(c=>c.str.trim()),from=cells.find(c=>/^(?:起点|起點|出发地|出發地)$/.test(c.str.trim()));
  if(!from)return;
  const headers=cells.filter(c=>Math.abs(c.y-from.y)<=Math.max(3,c.height*.5)).sort((a,b)=>a.x-b.x);
  const to=headers.find(c=>/^(?:终点|終點|目的地|到达地|到達地)$/.test(c.str.trim())),number=headers.find(c=>/序[号號]/.test(c.str));if(!to||!number)return;
  const centers=headers.map(c=>c.x+(c.width||0)/2);
  const numberX=number.x+(number.width||0)/2;
  const rows=cells.filter(c=>/^\d{1,3}$/.test(c.str.trim())&&c.y<from.y-5&&Math.abs(c.x+(c.width||0)/2-numberX)<Math.max(12,number.height*2)).sort((a,b)=>b.y-a.y);
  if(!rows.length)return;
  const output:string[]=[];
  for(const [i,row] of rows.entries()){
    const top=i?(rows[i-1].y+row.y)/2:(from.y+row.y)/2,bottom=rows[i+1]?(row.y+rows[i+1].y)/2:row.y-Math.max(45,row.height*6);
    const values=new Map<TextCell,string>();
    for(const [col,h] of headers.entries()){
      const left=col?(centers[col-1]+centers[col])/2:-Infinity,right=col+1<centers.length?(centers[col]+centers[col+1])/2:Infinity;
      const found=cells.filter(c=>c.y<top&&c.y>bottom&&c.x+(c.width||0)/2>=left&&c.x+(c.width||0)/2<right);
      values.set(h,layoutLines(found).replace(/\n/g,"").trim());
    }
    if(values.get(from)&&values.get(to))output.push(`起点：${values.get(from)}\n终点：${values.get(to)}`);
    const time=headers.find(c=>/上[车車]时间|上[车車]時間|乘[车車]日期/.test(c.str));if(time&&values.get(time)&&/20\d{2}/.test(values.get(time)!))output.push(`行程日期：${values.get(time)}`);
  }
  return output.length?output.join("\n"):undefined;
}

/** Vertical 购买方/销售方 labels must not interleave the names in the two columns. */
export function invoiceColumnText(items: TextCell[]): string | undefined {
  const columns: { x: number; items: TextCell[] }[] = [];
  for (const cell of items.filter(i => i.str.trim())) {
    let column = columns.find(c => Math.abs(c.x - cell.x) < 5);
    if (!column) { column = { x: cell.x, items: [] }; columns.push(column); }
    column.items.push(cell);
  }
  const markers: { party: "购买方" | "销售方"; x: number; top: number }[] = [];
  for (const column of columns) {
    const sorted = column.items.sort((a,b) => b.y - a.y);
    for (let i = 0; i < sorted.length; i++) {
      let label = "";
      for (let j = i; j < Math.min(i + 6, sorted.length); j++) {
        if (j > i && sorted[j-1].y - sorted[j].y > Math.max(30, sorted[j].height * 2.5)) break;
        label += sorted[j].str.replace(/\s/g, "").replace(/購/g,"购").replace(/買/g,"买").replace(/銷/g,"销");
        if (label === "购买方" || label === "销售方" || label === "购买方信息" || label === "销售方信息") {
          markers.push({party: label.startsWith("购买") ? "购买方" : "销售方",x:column.x,top:sorted[i].y}); break;
        }
        if (label.length > 6) break;
      }
    }
  }
  const buyer = markers.find(m=>m.party==="购买方"), seller = markers.find(m=>m.party==="销售方");
  if (!buyer || !seller || Math.abs(buyer.x-seller.x)<60 || Math.abs(buyer.top-seller.top)>30) return;
  const mid=Math.max(buyer.x,seller.x)-3, top=Math.max(buyer.top,seller.top)+20;
  const table=items.filter(c=>/项目名称|货物或|规格型号/.test(c.str.replace(/\s/g,""))&&c.y<top).sort((a,b)=>b.y-a.y)[0];
  const bottom=table?.y??Math.min(buyer.top,seller.top)-150;
  const block=(m:typeof buyer)=>layoutLines(items.filter(c=>c.y<=top&&c.y>bottom&&c.x>=Math.min(buyer.x,seller.x)&&! /^(?:购|买|方|信|息|销|售|购买方(?:信息)?|销售方(?:信息)?)$/.test(c.str.replace(/\s/g,""))&&((m.x<mid&&c.x<mid)||(m.x>mid&&c.x>mid))));
  const text=`购买方信息\n${block(buyer)}\n销售方信息\n${block(seller)}`;
  const meta=parseInvoiceText(text);
  return meta.buyerName && meta.sellerName ? `购买方名称：${meta.buyerName}\n购买方税号：${meta.buyerTaxId||""}\n销售方名称：${meta.sellerName}\n销售方税号：${meta.sellerTaxId||""}` : undefined;
}
