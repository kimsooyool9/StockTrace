export function analyze(news,stock,date,relations=[],evidence=[]){
const day=Date.parse(date);if(!Number.isFinite(day))return [];
const match=(t,words)=>words.filter(Boolean).some(w=>{const s=String(w).toLowerCase();if(!/^[a-z0-9 .-]+$/.test(s))return t.includes(s);return t.split(/[^a-z0-9.-]+/).includes(s)|| (s.includes(" ")&&t.includes(s));});
return news.filter(n=>!n.is_demo&&n.published_at&&Number.isFinite(Date.parse(n.published_at))).map(n=>{
const t=(n.title+" "+(n.summary||"")).toLowerCase(),days=Math.round((Date.parse(n.published_at.slice(0,10))-day)/86400000);
const apple=stock.symbol==="AAPL",ambiguous=apple&&/\bapple\b/.test(t)&&!match(t,["iphone","ipad","mac","ios","aapl","apple inc","apple newsroom","tim cook","apple watch","app store","macbook","애플"]);
const direct=(n.publisher==="Apple Newsroom"&&apple&&String(n.source_url).startsWith("https://www.apple.com/newsroom/"))||(!ambiguous&&match(t,[stock.name,stock.symbol,...(stock.keywords||[])]));
const industry=match(t,[stock.sector]),related=relations.some(r=>String(r.stock_id)===String(stock.id)&&r.source_url&&r.verified_on&&match(t,[r.related_name,...(r.keywords||[])]));
const verified=type=>evidence.some(e=>String(e.stock_id)===String(stock.id)&&e.news_url===n.source_url&&e.type===type&&e.verified===true&&/^https:\/\//.test(e.source_url||"")&&e.rationale);
const components={direct:direct?25:0,industry:industry?20:0,timing:Math.abs(days)<=3?20:Math.abs(days)<=7?10:days>=-30&&days<0?5:0,relations:related?15:0,pathway:verified("pathway")?15:0,market:verified("market")?5:0};
return {...n,days,components,score:Object.values(components).reduce((a,b)=>a+b,0),timing:days>0?"사후 보도":days===0?"당일":"이전",reason:"기업·산업·시점·관계 및 검증 근거 기반; 인과관계 미확인"};
}).filter(n=>n.days>=-30&&n.days<=7&&(n.components.direct||n.components.industry||n.components.relations)).sort((a,b)=>b.score-a.score);
}