export const MATERIAL_EXTENSIONS=[".pdf",".ofd",".xml",".jpg",".jpeg",".png",".webp",".gif",".bmp",".tif",".tiff",".avif",".heic",".heif",".txt",".md",".csv",".json",".doc",".docx",".xls",".xlsx"] as const;
export const MATERIAL_ACCEPT=MATERIAL_EXTENSIONS.join(",");
export const MATERIAL_FORMAT_LABEL="PDF / OFD / XML、Word、Excel、CSV、TXT / MD / JSON，以及 JPG、PNG、WebP、GIF、BMP、TIFF、AVIF、HEIC 圖片";
export function materialExtension(name:string){return /\.[^.]+$/.exec(name)?.[0].toLowerCase()||"";}
export const supportedMaterial=(name:string)=>MATERIAL_EXTENSIONS.includes(materialExtension(name) as typeof MATERIAL_EXTENSIONS[number]);
export const textMaterial=(name:string)=>/\.(txt|md|csv|json|xml)$/i.test(name);
export const officeMaterial=(name:string)=>/\.(docx?|xlsx?)$/i.test(name);
/** Formats without a lossless built-in PDF conversion remain downloadable in their original format. */
export const retainedMaterial=(name:string)=>/\.(ofd|xml|txt|md|csv|json|docx?|xlsx?|gif|bmp|tiff?|avif|heic|heif)$/i.test(name);
export const exportExtension=(name:string)=>retainedMaterial(name)?materialExtension(name):".pdf";
