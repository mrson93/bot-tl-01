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
        self.assertIn("/oferta/${slugify(offer.title)}--${encodeURIComponent(offer.id)}", app)
        self.assertIn("'@type':'Product'", detail)
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


if __name__ == "__main__":
    unittest.main()
