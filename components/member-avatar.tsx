"use client";
import {useState} from "react";
import type {Member} from "@/lib/types";
export default function MemberAvatar({member,preview,size="normal"}:{member:Member;preview?:string|null;size?:"small"|"normal"|"large"}){
 const [failed,setFailed]=useState("");
 const src=preview===null?"":preview|| (member.avatar?`/api/members/${encodeURIComponent(member.id)}/avatar?v=${encodeURIComponent(member.avatar)}`:"");
 return <span className={`member-avatar member-avatar-${size}`} aria-label={`${member.name}的头像`}>{src&&failed!==src?<img src={src} alt="" draggable={false} onError={()=>setFailed(src)}/>:<span aria-hidden="true">{member.name.slice(-1)}</span>}</span>;
}
