Deno.serve(async(req)=>{
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
let secret:string|undefined;try{secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default;}catch{}
const supplied=req.headers.get("apikey");
const authorized=(typeof secret==="string"&&secret.startsWith("sb_secret_")&&supplied===secret)||(!!legacy&&req.headers.get("Authorization")==="Bearer "+legacy);
if(!authorized)return json({error:"Forbidden"},403);
if(req.method!=="GET")return json({error:"GET only"},405);
const u=new URL(req.url),kind=u.searchParams.get("kind");
if(kind==="health")return json({ok:true,providers:{price:!!Deno.env.get("ALPHA_VANTAGE_KEY"),dart:!!Deno.env.get("DART_API_KEY"),sec:!!Deno.env.get("SEC_CONTACT"),news:true}});
try{
let target:URL;let headers:Record<string,string>={};const symbol=u.searchParams.get("symbol")||"";
if(kind==="price"){
if(!/^[A-Z0-9.\-]{1,15}$/.test(symbol))return json({error:"invalid symbol"},400);
const key=Deno.env.get("ALPHA_VANTAGE_KEY");if(!key)return json({error:"price key not configured"},503);
target=new URL("https://www.alphavantage.co/query");target.search=new URLSearchParams({function:"TIME_SERIES_DAILY",symbol,apikey:key}).toString();
}else if(kind==="sec"){
const cik=u.searchParams.get("cik")||"";if(!/^\d{1,10}$/.test(cik))return json({error:"invalid CIK"},400);
const contact=Deno.env.get("SEC_CONTACT");if(!contact)return json({error:"SEC contact not configured"},503);
target=new URL("https://data.sec.gov/submissions/CIK"+cik.padStart(10,"0")+".json");headers={"User-Agent":"StockTrace educational project "+contact,"Accept":"application/json"};
}else if(kind==="dart"){
const corp=u.searchParams.get("corp_code")||"";if(!/^\d{8}$/.test(corp))return json({error:"invalid corp code"},400);
const key=Deno.env.get("DART_API_KEY");if(!key)return json({error:"DART key not configured"},503);
target=new URL("https://opendart.fss.or.kr/api/list.json");target.search=new URLSearchParams({crtfc_key:key,corp_code:corp,page_count:"30"}).toString();
}else if(kind==="news"){
const term=u.searchParams.get("term")||"";if(!/^[\p{L}\p{N} .&-]{3,80}$/u.test(term))return json({error:"invalid term"},400);
target=new URL("https://api.gdeltproject.org/api/v2/doc/doc");target.search=new URLSearchParams({query:'"'+term+'"',mode:"artlist",format:"json",maxrecords:"25",timespan:"7d"}).toString();
}else return json({error:"unknown kind"},400);
let d:any;let last="unknown";let source="GDELT";const sid=Number(u.searchParams.get("stock_id"));
if(kind==="news"&&sid===1&&/^(apple|aapl)$/i.test(u.searchParams.get("term")||"")){
try{const base=Deno.env.get("SUPABASE_URL"),key=secret||legacy;
const cr=await fetch(base+"/rest/v1/news?publisher=eq.Apple%20Newsroom&collected_at=gte."+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+"&published_at=not.is.null&select=id",{headers:{apikey:key!,...(secret?{}:{Authorization:"Bearer "+key})},signal:AbortSignal.timeout(5000)});
if(cr.ok){const cached=await cr.json();if(cached.length&&u.searchParams.get("save")==="1")return json({provider:"news",source:"Apple Newsroom",cached:true,saved:0,available:cached.length});}
}catch{}
try{const rr=await fetch("https://www.apple.com/newsroom/rss-feed.rss",{signal:AbortSignal.timeout(12000),redirect:"error"});if(rr.ok){const xml=await rr.text();const decode=(s:string)=>s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const articles=[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].slice(0,25).map(m=>{const b=m[1];const title=decode((b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1]||"").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,"$1")).trim();const url=decode(b.match(/<link\b[^>]*href=["']([^"']+)["']/)?.[1]||"");const date=b.match(/<published\b[^>]*>([^<]+)<\/published>/)?.[1]?.trim()||b.match(/<pubDate\b[^>]*>([^<]+)<\/pubDate>/i)?.[1]?.trim()||"";return {title,url,domain:"Apple Newsroom",published_iso:date};}).filter(a=>a.title&&a.url.startsWith("https://www.apple.com/newsroom/"));if(articles.length){d={articles};source="Apple Newsroom";}}}catch{}
}

for(let attempt=0;!d&&attempt<(kind==="news"?2:1);attempt++){
try{
const r=await fetch(target,{headers:{...headers,Accept:"application/json"},signal:AbortSignal.timeout(kind==="news"?25000:12000),redirect:"error"});
if(!r.ok){last="HTTP "+r.status;if(r.status===429||r.status<500)break;}else{d=await r.json();if(kind!=="news"||Array.isArray(d.articles))break;d=undefined;last="invalid news response";}
}catch(e){last=e instanceof Error?e.name:"network error";}
if(attempt===0&&kind==="news")await new Promise(resolve=>setTimeout(resolve,1500));
}
if(!d&&kind==="news"){
const id=Number(u.searchParams.get("stock_id"));
const mapped:Record<number,string>={1:"AAPL",2:"MSFT"};
const ticker=mapped[id];const ak=Deno.env.get("ALPHA_VANTAGE_KEY");
if(ticker&&ak){try{
const alt=new URL("https://www.alphavantage.co/query");alt.search=new URLSearchParams({function:"NEWS_SENTIMENT",tickers:ticker,limit:"25",apikey:ak}).toString();
const ar=await fetch(alt,{signal:AbortSignal.timeout(12000),redirect:"error"});
if(ar.ok){const a=await ar.json();if(Array.isArray(a.feed)){d={articles:a.feed.filter((x:any)=>x.ticker_sentiment?.some((t:any)=>t.ticker===ticker)).map((x:any)=>({title:x.title,url:x.url,domain:x.source, published:x.time_published}))};last="Alpha Vantage";source="Alpha Vantage";}}
}catch{last+="; fallback unavailable";}}
}
if(!d)return json({error:"upstream unavailable",provider:kind,detail:last},502);
if(kind==="price"&&!d["Time Series (Daily)"])return json({error:"price unavailable or quota exceeded"},502);
if(kind==="dart"&&d.status!=="000"&&d.status!=="013")return json({error:"DART unavailable",status:d.status},502);
const stockId=Number(u.searchParams.get("stock_id"));
if(u.searchParams.get("save")==="1"){
if(!Number.isSafeInteger(stockId)||stockId<1)return json({error:"stock_id required"},400);
const base=Deno.env.get("SUPABASE_URL"),key=secret||legacy;
const h={"apikey":key!,...(secret?{}:{"Authorization":"Bearer "+key}),"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"};
const sr=await fetch(base+"/rest/v1/stocks?id=eq."+stockId,{headers:h});if(!sr.ok)return json({error:"stock lookup failed"},502);
const stock=(await sr.json())[0];if(!stock)return json({error:"unknown stock"},404);
let table="",conflict="",rows:any[]=[];
if(kind==="price"){if(stock.symbol!==symbol||stock.country!=="US")return json({error:"symbol mismatch"},400);table="stock_prices";conflict="stock_id,trading_date";rows=Object.entries(d["Time Series (Daily)"]).map(([date,v]:[string,any])=>({stock_id:stockId,trading_date:date,open:Number(v["1. open"]),high:Number(v["2. high"]),low:Number(v["3. low"]),close:Number(v["4. close"]),volume:Number(v["5. volume"]),source_url:"https://www.alphavantage.co/documentation/",data_kind:"historical",collected_at:new Date().toISOString()}));}
if(kind==="news"){table="news";conflict="source_url";rows=(d.articles||[]).filter((a:any)=>a.title&&/^https?:\/\//.test(a.url)).map((a:any)=>({title:a.title,publisher:a.domain||"Unknown",source_url:a.url,category:a.domain==="Apple Newsroom"?"company_release":null,published_at:a.published_iso&&Number.isFinite(Date.parse(a.published_iso))?new Date(a.published_iso).toISOString():typeof a.published==="string"&&/^\d{8}T\d{6}$/.test(a.published)?a.published.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,"$1-$2-$3T$4:$5:$6Z"):null,collected_at:new Date().toISOString(),is_demo:false}));}
if(kind==="dart"||kind==="sec")return json({error:"filing identity mapping not yet configured"},501);
rows=[...new Map(rows.map(x=>[x.source_url+(x.trading_date||""),x])).values()];
if(rows.length){const wr=await fetch(base+"/rest/v1/"+table+"?on_conflict="+conflict,{method:"POST",headers:h,body:JSON.stringify(rows)});if(!wr.ok)return json({error:"database write failed",status:wr.status},502);}
return json({provider:kind,source:kind==="news"?source:kind,saved:rows.length});
}
return json({provider:kind,collected_at:new Date().toISOString(),data:kind==="news"?(d.articles||[]).map((a:any)=>({title:a.title,url:a.url,domain:a.domain,seen_at:a.seendate,language:a.language})):d});
}catch{return json({error:"upstream unavailable"},502);}
});