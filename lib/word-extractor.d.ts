declare module "word-extractor" {
  export default class WordExtractor {extract(bytes:Buffer):Promise<{getBody():string;getHeaders():string;getFootnotes():string}>;}
}
