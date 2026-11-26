Deno.serve(async(req)=>{
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
if(req.headers.get("Authorization")!== "Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))return json({error:"Forbidden"},403);
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
const r=await fetch(target,{headers,signal:AbortSignal.timeout(12000),redirect:"error"});if(!r.ok)return json({error:"upstream failure",status:r.status},502);
const d=await r.json();if(kind==="price"&&!d["Time Series (Daily)"])return json({error:"price unavailable or quota exceeded"},502);
if(kind==="dart"&&d.status!=="000"&&d.status!=="013")return json({error:"DART unavailable",status:d.status},502);
const stockId=Number(u.searchParams.get("stock_id"));
if(u.searchParams.get("save")==="1"){
if(!Number.isSafeInteger(stockId)||stockId<1)return json({error:"stock_id required"},400);
const base=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const h={"apikey":key!,"Authorization":"Bearer "+key,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"};
const sr=await fetch(base+"/rest/v1/stocks?id=eq."+stockId,{headers:h});if(!sr.ok)return json({error:"stock lookup failed"},502);
const stock=(await sr.json())[0];if(!stock)return json({error:"unknown stock"},404);
let table="",conflict="",rows:any[]=[];
if(kind==="price"){if(stock.symbol!==symbol||stock.country!=="US")return json({error:"symbol mismatch"},400);table="stock_prices";conflict="stock_id,trading_date";rows=Object.entries(d["Time Series (Daily)"]).map(([date,v]:[string,any])=>({stock_id:stockId,trading_date:date,open:Number(v["1. open"]),high:Number(v["2. high"]),low:Number(v["3. low"]),close:Number(v["4. close"]),volume:Number(v["5. volume"]),source_url:"https://www.alphavantage.co/documentation/",data_kind:"historical",collected_at:new Date().toISOString()}));}
if(kind==="news"){table="news";conflict="source_url";rows=(d.articles||[]).filter((a:any)=>a.title&&/^https?:\/\//.test(a.url)).map((a:any)=>({title:a.title,publisher:a.domain||"Unknown",source_url:a.url,collected_at:new Date().toISOString(),is_demo:false}));}
if(kind==="dart"||kind==="sec")return json({error:"filing identity mapping not yet configured"},501);
rows=[...new Map(rows.map(x=>[x.source_url+(x.trading_date||""),x])).values()];
if(rows.length){const wr=await fetch(base+"/rest/v1/"+table+"?on_conflict="+conflict,{method:"POST",headers:h,body:JSON.stringify(rows)});if(!wr.ok)return json({error:"database write failed",status:wr.status},502);}
return json({provider:kind,saved:rows.length});
}
return json({provider:kind,collected_at:new Date().toISOString(),data:kind==="news"?(d.articles||[]).map((a:any)=>({title:a.title,url:a.url,domain:a.domain,seen_at:a.seendate,language:a.language})):d});
}catch{return json({error:"upstream unavailable"},502);}
});