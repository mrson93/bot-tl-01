const CREATE_TABLE=`CREATE TABLE IF NOT EXISTS blog_post_products (
  post_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,brand TEXT,summary TEXT,image_url TEXT,
  affiliate_url TEXT NOT NULL,price_label TEXT,specs_json TEXT NOT NULL DEFAULT '{}',position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id,id),FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE)`;

export async function ensureBlogProducts(env) {
  await env.DB.prepare(CREATE_TABLE).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_blog_post_products_post ON blog_post_products(post_id,position)').run();
}

export function productSpecs(value) {
  try {
    const parsed=typeof value==='string'?JSON.parse(value):value;
    if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return {};
    return Object.fromEntries(Object.entries(parsed).slice(0,10).map(([key,item])=>[String(key).slice(0,50),String(item).slice(0,180)]).filter(([key,value])=>key&&value));
  } catch { return {}; }
}
