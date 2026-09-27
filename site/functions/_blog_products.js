const CREATE_TABLE=`CREATE TABLE IF NOT EXISTS blog_post_products (
  post_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,brand TEXT,summary TEXT,image_url TEXT,
  affiliate_url TEXT NOT NULL,price_label TEXT,price_checked_at INTEGER,specs_json TEXT NOT NULL DEFAULT '{}',position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id,id),FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE)`;
const CREATE_LINKS_TABLE=`CREATE TABLE IF NOT EXISTS blog_product_links (
  post_id TEXT NOT NULL,product_id TEXT NOT NULL,id TEXT NOT NULL,store TEXT NOT NULL,label TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY (post_id,product_id,id),
  FOREIGN KEY (post_id,product_id) REFERENCES blog_post_products(post_id,id) ON DELETE CASCADE)`;

export async function ensureBlogProducts(env) {
  await env.DB.prepare(CREATE_TABLE).run();
  const columns=await env.DB.prepare('PRAGMA table_info(blog_post_products)').all();
  if(!(columns.results||[]).some(column=>column.name==='price_checked_at')){
    await env.DB.prepare('ALTER TABLE blog_post_products ADD COLUMN price_checked_at INTEGER').run();
  }
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_blog_post_products_post ON blog_post_products(post_id,position)').run();
  await env.DB.prepare(CREATE_LINKS_TABLE).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_blog_product_links_product ON blog_product_links(post_id,product_id,position)').run();
}

export function productLinks(product={}) {
  const links=Array.isArray(product.links)?product.links.filter(link=>link?.affiliate_url):[];
  if(links.length)return links.slice(0,5);
  return product.affiliate_url?[{id:'legacy',store:'outro',label:'Ver produto',affiliate_url:product.affiliate_url,position:0}]:[];
}

export function productSpecs(value) {
  try {
    const parsed=typeof value==='string'?JSON.parse(value):value;
    if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return {};
    return Object.fromEntries(Object.entries(parsed).slice(0,10).map(([key,item])=>[String(key).slice(0,50),String(item).slice(0,180)]).filter(([key,value])=>key&&value));
  } catch { return {}; }
}
