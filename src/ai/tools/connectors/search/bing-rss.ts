import {SearchProviderError,type SearchProvider} from './types.js';
function text(value:string):string {
 return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/\s+/g,' ').trim();
}
function field(item:string,name:string):string{return text(item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]??'');}
/** Independent public RSS transport used when the default HTML search is unavailable. */
export function createBingRssSearchProvider(options:{fetchFn?:typeof fetch}={}):SearchProvider {
 const fetchFn=options.fetchFn??fetch;
 return {name:'web_search.bing',displayName:'Bing RSS',async search(input){
  let response:Response;
  try{response=await fetchFn(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(input.query)}`,{signal:input.signal,headers:{Accept:'application/rss+xml, application/xml, text/xml'}});}catch(error){throw new SearchProviderError(error instanceof Error?error.message:String(error),{kind:'network'});}
  if(!response.ok)throw new SearchProviderError(`${response.status} ${response.statusText}`,{kind:'http',status:response.status});
  const body=await response.text();if(!/<rss\b/i.test(body))throw new SearchProviderError('Bing RSS response is not a search feed',{kind:'parse'});
  const hits=[];
  for(const match of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
   const title=field(match[1],'title'),raw=field(match[1],'link');let url:URL;try{url=new URL(raw);}catch{continue;}
   if(!title||!/^https?:$/.test(url.protocol))continue;
   hits.push({title,url:url.href,snippet:field(match[1],'description')});if(hits.length>=Math.max(1,input.count))break;
  }
  return hits;
 }};
}
