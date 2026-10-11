import { Router } from "express";
import { wrap } from "./public.js";

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

export function seoRoutes({ cfg, store }) {
  const r = Router();
  r.get("/robots.txt", (req, res) => {
    const base = cfg.publicUrl || `${req.protocol}://${req.get("host")}`;
    res.type("text/plain").send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
  });
  r.get("/sitemap.xml", wrap(async (req, res) => {
    const base = cfg.publicUrl || `${req.protocol}://${req.get("host")}`;
    const [cats, prods] = await Promise.all([store.categories.all(), store.products.all()]);
    const urls = ["/", "/catalog", "/quote", ...cats.map((c) => `/catalog?category=${c.slug}`), ...prods.filter((p) => p.active).map((p) => `/product/${p.slug}`)];
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(base + u)}</loc></url>`).join("\n")}\n</urlset>\n`);
  }));
  return r;
}
