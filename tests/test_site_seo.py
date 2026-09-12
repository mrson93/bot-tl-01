import json
from html.parser import HTMLParser
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "site" / "public"


class HeadParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = []
        self.links = []
        self.in_json_ld = False
        self.json_ld = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta":
            self.meta.append(values)
        elif tag == "link":
            self.links.append(values)
        elif tag == "script" and values.get("type") == "application/ld+json":
            self.in_json_ld = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_json_ld = False

    def handle_data(self, data):
        if self.in_json_ld:
            self.json_ld += data


class SiteSeoTest(unittest.TestCase):
    def test_home_tem_metadados_canonicos_e_dados_estruturados(self):
        parser = HeadParser()
        parser.feed((PUBLIC / "index.html").read_text())
        canonical = [item for item in parser.links if item.get("rel") == "canonical"]
        self.assertEqual("https://canaltabarato.pages.dev/", canonical[0]["href"])
        self.assertTrue(any("max-image-preview:large" in item.get("content", "")
                            for item in parser.meta if item.get("name") == "robots"))
        data = json.loads(parser.json_ld)
        types = {item["@type"] for item in data["@graph"]}
        self.assertEqual({"WebSite", "Organization"}, types)

    def test_robots_permite_busca_e_anuncia_sitemap(self):
        robots = (PUBLIC / "robots.txt").read_text()
        self.assertIn("User-agent: OAI-SearchBot", robots)
        self.assertIn("User-agent: ChatGPT-User", robots)
        self.assertIn("Sitemap: https://canaltabarato.pages.dev/sitemap.xml", robots)
        self.assertIn("Disallow: /api/", robots)

    def test_ofertas_possuem_paginas_descobríveis(self):
        app = (PUBLIC / "app.js").read_text()
        detail = (ROOT / "site" / "functions" / "oferta" / "[id].js").read_text()
        sitemap = (ROOT / "site" / "functions" / "sitemap.xml.js").read_text()
        self.assertIn("/oferta/${slug(o.title)}--${encodeURIComponent(o.id)}", app)
        self.assertIn("'@type':'Product'", detail)
        self.assertIn("'@type':'BreadcrumbList'", detail)
        self.assertIn("<urlset", sitemap)

    def test_catalogo_tem_paginas_dinamicas_e_cupons(self):
        index = (PUBLIC / "index.html").read_text()
        coupons = (ROOT / "site" / "functions" / "cupons.js").read_text()
        categories = (ROOT / "site" / "functions" / "categorias" / "[slug].js").read_text()
        shops = (ROOT / "site" / "functions" / "lojas" / "[slug].js").read_text()
        migration = (ROOT / "site" / "migrations" / "0002_catalogo_e_cupons.sql").read_text()
        self.assertIn('data-sort="trending"', index)
        self.assertIn("Cupons ativos", coupons)
        self.assertIn("collectionPage(env,'category'", categories)
        self.assertIn("collectionPage(env,'shop'", shops)
        self.assertIn("CREATE TABLE IF NOT EXISTS coupons", migration)
        vouchers = (ROOT / "site" / "migrations" / "0003_vouchers_sem_codigo.sql").read_text()
        self.assertIn("ADD COLUMN kind", vouchers)
        self.assertIn("Ativar voucher", coupons)
        self.assertIn("api/public/coupons?active=true", coupons)
        self.assertIn("FOREIGN_REGION", coupons)
        self.assertIn("EXTERNAL_MAX_AGE_MS", coupons)
        self.assertIn("CupomDesconto", coupons)
        self.assertIn('target="_blank"', coupons)
        self.assertIn("coupon-redeem", (PUBLIC / "coupons.js").read_text())

    def test_llms_descreve_site_sem_promessas_enganosas(self):
        text = (PUBLIC / "llms.txt").read_text()
        self.assertIn("Catálogo brasileiro de ofertas", text)
        self.assertIn("preços e a disponibilidade podem mudar", text)

    def test_publicacao_avisa_indexnow_sem_bloquear_resposta(self):
        publish = (ROOT / "site" / "functions" / "api" / "publish.js").read_text()
        helper = (ROOT / "site" / "functions" / "_indexnow.js").read_text()
        key = "6b821dc1235f4fd38d7b9b203617c731"
        self.assertEqual(key, (PUBLIC / f"{key}.txt").read_text().strip())
        self.assertIn("https://api.indexnow.org/indexnow", helper)
        self.assertIn("context.waitUntil(notifyIndexNow(", publish)

    def test_atalhos_de_loja_sao_dinamicos_e_rastreados(self):
        index = (PUBLIC / "index.html").read_text()
        app = (PUBLIC / "app.js").read_text()
        stores = (ROOT / "site" / "functions" / "api" / "stores.js").read_text()
        redirect = (ROOT / "site" / "functions" / "loja" / "[slug].js").read_text()
        migration = (ROOT / "site" / "migrations" / "0004_store_links.sql").read_text()
        self.assertIn('id="store-shortcuts"', index)
        self.assertIn("fetch('/api/stores')", app)
        self.assertIn("ALLOWED_DESTINATION_HOSTS", stores)
        self.assertIn("store:${slug}", redirect)
        self.assertIn("CREATE TABLE IF NOT EXISTS store_links", migration)
        self.assertIn('target="_blank"', app)
        self.assertIn('id="vip-banner"', index)
        self.assertIn("Shopee VIP", stores)
        self.assertIn("shopee-vip", (ROOT / "site" / "functions" / "cupons.js").read_text())

    def test_catalogo_avancado_tem_total_real_historico_e_feedback(self):
        api = (ROOT / "site" / "functions" / "api" / "offers.js").read_text()
        app = (PUBLIC / "app.js").read_text()
        detail = (ROOT / "site" / "functions" / "oferta" / "[id].js").read_text()
        schema = (ROOT / "site" / "schema.sql").read_text()
        self.assertIn("COUNT(*)total", api)
        self.assertIn("has_more", api)
        self.assertIn("Carregar mais ofertas", (PUBLIC / "index.html").read_text())
        self.assertIn("offer_prices", detail)
        self.assertIn("/api/feedback", (PUBLIC / "offer.js").read_text())
        self.assertIn("CREATE TABLE IF NOT EXISTS offer_feedback", schema)
        self.assertIn("data-favorite", app)

    def test_historico_exibe_valores_datas_e_registros_recentes(self):
        detail = (ROOT / "site" / "functions" / "oferta" / "[id].js").read_text()
        styles = (PUBLIC / "styles.css").read_text()
        self.assertIn("ORDER BY observed_at DESC LIMIT 30", detail)
        self.assertIn("Menor observado", detail)
        self.assertIn("Média observada", detail)
        self.assertIn("Histórico em formação", detail)
        self.assertIn("prices.length>=7", detail)
        self.assertIn("Variação no período", detail)
        self.assertIn("price-line-chart", detail)
        self.assertIn("line-path", detail)
        self.assertIn("Cada ponto mostra", detail)
        self.assertNotIn('style="height:', detail)
        self.assertIn(".line-path", styles)
        self.assertIn("Os próximos preços serão adicionados diariamente", detail)
        self.assertIn("overflow-x:auto", styles)
        self.assertNotIn("price-chart span:hover i", styles)

    def test_paginas_fixadas_para_descoberta_de_precos(self):
        root = ROOT / "site"
        discovery = (root / "functions" / "_discovery.js").read_text()
        sitemap = (root / "functions" / "sitemap.xml.js").read_text()
        index = (PUBLIC / "index.html").read_text()
        for route in ("quedas-de-preco", "menores-precos", "mais-acessadas",
                      "mais-vendidos"):
            self.assertTrue((root / "functions" / f"{route}.js").exists())
            self.assertIn(f"/{route}", sitemap)
            self.assertIn(f'href="/{route}"', index)
        self.assertIn("previous_price", discovery)
        self.assertIn("observations>=2", discovery)
        self.assertIn("clicks_7d", discovery)
        self.assertTrue((root / "functions" / "faixas-de-preco" / "[slug].js").exists())
        self.assertIn("/faixas-de-preco/ate-50", sitemap)

    def test_visitas_sao_agregadas_sem_dados_pessoais(self):
        root = ROOT / "site"
        migration = (root / "migrations" / "0007_visitas_agregadas.sql").read_text()
        endpoint = (root / "functions" / "api" / "view.js").read_text()
        analytics = (root / "public" / "analytics.js").read_text()
        stats = (root / "functions" / "api" / "stats.js").read_text()
        privacy = (root / "functions" / "privacidade.js").read_text()
        self.assertIn("CREATE TABLE IF NOT EXISTS page_views_daily", migration)
        self.assertIn("ON CONFLICT(observed_on,path)", endpoint)
        self.assertIn("CREATE TABLE IF NOT EXISTS page_views_daily", endpoint)
        self.assertIn("sessionStorage", analytics)
        self.assertIn("outbound_clicks", stats)
        self.assertIn("endereço IP", privacy)

    def test_cloudflare_web_analytics_respeita_csp(self):
        helper = (ROOT / "site" / "functions" / "_site.js").read_text()
        headers = (PUBLIC / "_headers").read_text()
        index = (PUBLIC / "index.html").read_text()
        for text in (helper, headers, index):
            self.assertIn("static.cloudflareinsights.com", text)
        self.assertIn("https://cloudflareinsights.com", headers)
        self.assertIn("Cloudflare Web Analytics", (ROOT / "site" / "functions" / "privacidade.js").read_text())

    def test_catalogo_persistente_atualiza_precos_sem_apagar_produtos_antigos(self):
        root = ROOT / "site"
        migration = (root / "migrations" / "0006_catalogo_persistente.sql").read_text()
        publish = (root / "functions" / "api" / "publish.js").read_text()
        refresh = (root / "functions" / "api" / "refresh.js").read_text()
        offers = (root / "functions" / "api" / "offers.js").read_text()
        self.assertIn("last_checked_at", migration)
        self.assertIn("refresh_failures", migration)
        self.assertNotIn("DELETE FROM offers", publish)
        self.assertIn("refresh_failures+1>=3", refresh)
        self.assertIn("availability!='unavailable'", offers)

    def test_categoria_do_site_considera_titulo_do_produto(self):
        site = ROOT / "site" / "functions"
        helper = (site / "_site.js").read_text()
        publish = (site / "api" / "publish.js").read_text()
        refresh = (site / "api" / "refresh.js").read_text()
        self.assertIn("creatina|whey|suplement", helper)
        self.assertIn("${body.category||''} ${title}", publish)
        self.assertIn("${raw.category||''} ${title}", refresh)

    def test_paginas_de_confianca_foram_publicadas(self):
        for name in ("como-escolhemos", "faq", "privacidade", "exclusao-de-dados", "contato"):
            self.assertTrue((ROOT / "site" / "functions" / f"{name}.js").exists())
        self.assertIn("FAQPage", (ROOT / "site" / "functions" / "faq.js").read_text())
        privacy = (ROOT / "site" / "functions" / "privacidade.js").read_text()
        deletion = (ROOT / "site" / "functions" / "exclusao-de-dados.js").read_text()
        sitemap = (ROOT / "site" / "functions" / "sitemap.xml.js").read_text()
        self.assertIn("/exclusao-de-dados", privacy)
        self.assertIn("48 horas", deletion)
        self.assertIn("/exclusao-de-dados", sitemap)


if __name__ == "__main__":
    unittest.main()
