"use client";
import {createContext,useContext,type ReactNode} from "react";
import {DEFAULT_DEPARTMENTS,departmentLabel} from "@/lib/organizations";
import type {DepartmentProfile} from "@/lib/types";
const Context=createContext<DepartmentProfile[]>(DEFAULT_DEPARTMENTS);
export function DepartmentProvider({departments,children}:{departments:DepartmentProfile[];children:ReactNode}){return <Context.Provider value={departments}>{children}</Context.Provider>;}
export const useDepartments=()=>useContext(Context);
export function useDepartmentLabel(){const profiles=useDepartments();return (id:string)=>departmentLabel(id,{departmentProfiles:profiles});}
