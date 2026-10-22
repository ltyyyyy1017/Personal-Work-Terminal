import path from "node:path";
const requireFromProject=process.getBuiltinModule("module").createRequire(path.join(process.cwd(),"package.json"));
export function pdfOptions(){const root=path.dirname(requireFromProject.resolve("pdfjs-dist/package.json")).replace(/\\/g,"/");return {cMapUrl:root+"/cmaps/",cMapPacked:true,standardFontDataUrl:root+"/standard_fonts/",useSystemFonts:true};}
